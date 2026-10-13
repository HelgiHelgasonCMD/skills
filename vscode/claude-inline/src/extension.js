'use strict';
const vscode = require('vscode');
const core = require('./core');
const { runClaude } = require('./claude');

const BASE_SCHEME = 'claude-inline-base';
const ME = { name: 'You' };
const CLAUDE = { name: 'Claude' };

/** One inline-chat session per document: the widget, the pre-edit baseline and the region being worked on. */
class Session {
  constructor(doc, thread) {
    this.uri = doc.uri;
    this.thread = thread;
    this.baseline = null; // string[] while changes await Keep/Undo
    this.region = null;
    this.history = [];
    this.abort = null;
  }
}

function linesOf(doc) {
  return doc.getText().split(/\r?\n/);
}

function md(text) {
  const s = new vscode.MarkdownString(text);
  s.isTrusted = { enabledCommands: ['claudeInline.keepAll', 'claudeInline.undoAll', 'claudeInline.showDiff'] };
  s.supportThemeIcons = true;
  return s;
}

function cmdLink(label, command, uri) {
  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([uri.toString()]))})`;
}

function activate(context) {
  const sessions = new Map();
  const lensesChanged = new vscode.EventEmitter();
  const baseChanged = new vscode.EventEmitter(); // fires Uris: the diff view's left side
  const controller = vscode.comments.createCommentController('claudeInline', 'Claude');
  controller.options = { prompt: 'Ask Claude to edit…', placeHolder: 'Ask Claude to edit or generate code (Ctrl+Enter to send)' };
  // Every line accepts a Claude box: needed for "Add Comment" (Ctrl+I) to work anywhere.
  controller.commentingRangeProvider = {
    provideCommentingRanges: (doc) => [new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0)],
  };
  context.subscriptions.push(controller, lensesChanged, baseChanged);

  const added = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  const removed = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderStyle: 'solid',
    borderWidth: '2px 0 0 0',
    borderColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  context.subscriptions.push(added, removed);

  const sessionFor = (uriLike) => sessions.get(String(uriLike?.uri ?? uriLike));
  const sessionForThread = (thread) => [...sessions.values()].find((s) => s.thread === thread);

  function hunks(s) {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === s.uri.toString());
    if (!doc || !s.baseline) return [];
    return core.diffHunks(s.baseline, linesOf(doc));
  }

  function refresh() {
    for (const editor of vscode.window.visibleTextEditors) {
      const s = sessionFor(editor.document.uri);
      const hs = s ? hunks(s) : [];
      const last = Math.max(0, editor.document.lineCount - 1);
      editor.setDecorations(added, hs.filter((h) => h.curEnd > h.curStart)
        .map((h) => new vscode.Range(h.curStart, 0, h.curEnd - 1, 0)));
      editor.setDecorations(removed, hs.filter((h) => h.baseEnd > h.baseStart).map((h) => ({
        range: new vscode.Range(Math.min(h.curStart, last), 0, Math.min(h.curStart, last), 0),
        hoverMessage: new vscode.MarkdownString().appendMarkdown('**Removed**').appendCodeblock(
          s.baseline.slice(h.baseStart, h.baseEnd).join('\n'), editor.document.languageId),
      })));
    }
    const active = vscode.window.activeTextEditor;
    const s = active && sessionFor(active.document.uri);
    vscode.commands.executeCommand('setContext', 'claudeInline.pending', Boolean(s && hunks(s).length));
    lensesChanged.fire();
    for (const sess of sessions.values()) baseChanged.fire(baseUri(sess.uri));
  }

  function baseUri(uri) {
    return vscode.Uri.from({ scheme: BASE_SCHEME, path: uri.path, query: uri.toString() });
  }

  function setClaudeComment(s, body) {
    const mine = s.thread.comments.filter((c) => c.author !== CLAUDE || !c.claudeInlineLive);
    const live = { body: md(body), mode: vscode.CommentMode.Preview, author: CLAUDE, claudeInlineLive: true };
    s.thread.comments = [...mine, live];
  }

  function finalizeComments(s) {
    s.thread.comments = s.thread.comments.map((c) => ({ ...c, claudeInlineLive: false }));
  }

  function end(s) {
    s.abort?.abort();
    s.thread.dispose();
    sessions.delete(s.uri.toString());
    refresh();
  }

  function settleIfDone(s) {
    if (s.baseline && hunks(s).length === 0) {
      s.baseline = null;
      end(s);
    } else {
      s.thread.contextValue = s.baseline ? 'claudeInline.pending' : 'claudeInline.idle';
    }
  }

  // What the user had selected when they pressed Ctrl+I, until VS Code hands us the thread.
  const pendingRequests = new Map();

  function requestFrom(sel) {
    return { selStart: sel.start.line, selEnd: sel.end.line, selEmpty: sel.isEmpty, cursor: sel.active.line };
  }

  async function start() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const existing = sessionFor(editor.document.uri);
    if (existing) {
      existing.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      return;
    }
    pendingRequests.set(editor.document.uri.toString(), requestFrom(editor.selection));
    // VS Code's own "Add Comment" is the only route that opens the box with the cursor in it;
    // threads created through the API open unfocused (CommentThread.reveal is still proposed).
    await vscode.commands.executeCommand('workbench.action.addComment');
  }

  /** Adopt the thread VS Code created for this file as an inline-chat session. */
  function adopt(thread) {
    const key = thread.uri.toString();
    const s = new Session({ uri: thread.uri }, thread);
    const r = thread.range;
    s.request = pendingRequests.get(key) || (r
      ? { selStart: r.start.line, selEnd: r.end.line, selEmpty: r.isEmpty, cursor: r.end.line }
      : { selStart: 0, selEnd: 0, selEmpty: true, cursor: 0 });
    pendingRequests.delete(key);
    thread.label = 'Claude';
    thread.canReply = true;
    thread.contextValue = 'claudeInline.idle';
    sessions.get(key)?.thread.dispose();
    sessions.set(key, s);
    return s;
  }

  async function submit(reply) {
    const text = (reply.text || '').trim();
    if (!text) return;
    const s = sessionForThread(reply.thread) || adopt(reply.thread);
    const doc = await vscode.workspace.openTextDocument(s.uri);
    const cfg = vscode.workspace.getConfiguration('claudeInline', doc.uri);

    s.thread.comments = [...s.thread.comments, { body: text, mode: vscode.CommentMode.Preview, author: ME }];
    setClaudeComment(s, '$(loading~spin) Thinking…');

    const lines = linesOf(doc);
    const region = s.region || core.pickRegion({
      lineCount: lines.length, ...s.request, maxWholeFile: cfg.get('maxWholeFileLines', 800),
    });
    const prompt = core.buildPrompt({
      path: vscode.workspace.asRelativePath(doc.uri), languageId: doc.languageId, lines, region,
      cursor: s.request.cursor, instruction: text, history: s.history,
    });

    s.abort = new AbortController();
    let result;
    try {
      const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
      result = await runClaude({
        claudePath: cfg.get('claudePath', 'claude'), model: cfg.get('model', 'sonnet'),
        cwd: folder ? folder.uri.fsPath : undefined, prompt, signal: s.abort.signal,
      });
    } catch (e) {
      if (sessions.has(s.uri.toString())) { setClaudeComment(s, `$(error) ${e.message}`); finalizeComments(s); }
      return;
    } finally {
      s.abort = null;
    }
    if (!sessions.has(s.uri.toString())) return; // closed while thinking

    const before = linesOf(doc);
    const regionText = before.slice(region.start, region.end + 1).join('\n');
    result.replacement = core.fitReplacement(regionText, result.replacement);
    const regionEnd = doc.lineAt(Math.min(region.end, doc.lineCount - 1));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(region.start, 0, regionEnd.lineNumber, regionEnd.text.length), result.replacement);
    if (result.replacement !== regionText) {
      if (!s.baseline) s.baseline = before;
      await vscode.workspace.applyEdit(edit);
    }
    s.region = { start: region.start, end: region.start + result.replacement.split('\n').length - 1 };
    s.history.push(text);

    const n = hunks(s).length;
    const actions = n ? `\n\n${cmdLink('Keep', 'claudeInline.keepAll', s.uri)} · ${cmdLink('Undo', 'claudeInline.undoAll', s.uri)} · ${cmdLink('Show diff', 'claudeInline.showDiff', s.uri)}` : '';
    setClaudeComment(s, `${result.summary || 'Done.'}${n ? ` _(${n} change${n > 1 ? 's' : ''})_` : ''}${actions}`);
    finalizeComments(s);
    s.thread.contextValue = s.baseline ? 'claudeInline.pending' : 'claudeInline.idle';
    refresh();
  }

  async function replaceAll(s, newLines) {
    const doc = await vscode.workspace.openTextDocument(s.uri);
    const edit = new vscode.WorkspaceEdit();
    const lastLine = doc.lineAt(doc.lineCount - 1);
    edit.replace(doc.uri, new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length), newLines.join('\n'));
    await vscode.workspace.applyEdit(edit);
  }

  async function keepHunk(uri, index) {
    const s = sessionFor(uri);
    const h = s && hunks(s)[index];
    if (!h) return;
    const doc = await vscode.workspace.openTextDocument(s.uri);
    s.baseline = core.keepHunk(s.baseline, linesOf(doc), h);
    settleIfDone(s);
    refresh();
  }

  async function undoHunk(uri, index) {
    const s = sessionFor(uri);
    const h = s && hunks(s)[index];
    if (!h) return;
    const doc = await vscode.workspace.openTextDocument(s.uri);
    await replaceAll(s, core.undoHunk(s.baseline, linesOf(doc), h));
    settleIfDone(s);
    refresh();
  }

  async function keepAll(uriOrThread) {
    const s = uriOrThread?.comments ? sessionForThread(uriOrThread) : sessionFor(uriOrThread ?? vscode.window.activeTextEditor?.document.uri);
    if (!s) return;
    end(s);
  }

  async function undoAll(uriOrThread) {
    const s = uriOrThread?.comments ? sessionForThread(uriOrThread) : sessionFor(uriOrThread ?? vscode.window.activeTextEditor?.document.uri);
    if (!s) return;
    if (s.baseline) await replaceAll(s, s.baseline);
    end(s);
  }

  async function showDiff(uriLike) {
    const s = sessionFor(uriLike ?? vscode.window.activeTextEditor?.document.uri);
    if (!s || !s.baseline) return;
    await vscode.commands.executeCommand('vscode.diff', baseUri(s.uri), s.uri, `${vscode.workspace.asRelativePath(s.uri)} (Claude's changes)`);
  }

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, {
      onDidChange: baseChanged.event,
      provideTextDocumentContent: (uri) => (sessions.get(uri.query)?.baseline || []).join('\n'),
    }),
    vscode.languages.registerCodeLensProvider({ scheme: '*' }, {
      onDidChangeCodeLenses: lensesChanged.event,
      provideCodeLenses(doc) {
        const s = sessionFor(doc.uri);
        if (!s) return [];
        return hunks(s).flatMap((h, i) => {
          const line = Math.min(h.curStart, doc.lineCount - 1);
          const range = new vscode.Range(line, 0, line, 0);
          return [
            new vscode.CodeLens(range, { title: 'Keep', command: 'claudeInline.keepHunk', arguments: [doc.uri.toString(), i] }),
            new vscode.CodeLens(range, { title: 'Undo', command: 'claudeInline.undoHunk', arguments: [doc.uri.toString(), i] }),
          ];
        });
      },
    }),
    vscode.commands.registerCommand('claudeInline.start', start),
    vscode.commands.registerCommand('claudeInline.submit', submit),
    vscode.commands.registerCommand('claudeInline.keepHunk', keepHunk),
    vscode.commands.registerCommand('claudeInline.undoHunk', undoHunk),
    vscode.commands.registerCommand('claudeInline.keepAll', keepAll),
    vscode.commands.registerCommand('claudeInline.undoAll', undoAll),
    vscode.commands.registerCommand('claudeInline.showDiff', showDiff),
    vscode.commands.registerCommand('claudeInline.close', async (thread) => {
      const s = thread?.comments ? sessionForThread(thread) : sessionFor(vscode.window.activeTextEditor?.document.uri);
      if (!s) return thread?.dispose?.(); // a box closed before its first request
      if (s.baseline) await undoAll(s.uri.toString());
      else end(s);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const s = sessionFor(e.document.uri);
      if (s) { settleIfDone(s); refresh(); }
    }),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.window.onDidChangeVisibleTextEditors(refresh),
    vscode.workspace.onDidCloseTextDocument((d) => { const s = sessionFor(d.uri); if (s) end(s); }),
  );

  // Handle used by the integration tests; not a public API.
  return {
    sessionFor,
    hunks: (uri) => { const s = sessionFor(uri); return s ? hunks(s) : []; },
    pending: (uri) => pendingRequests.get(String(uri)),
    submitActive: (text) => {
      const editor = vscode.window.activeTextEditor;
      let thread = sessionFor(editor.document.uri)?.thread;
      if (!thread) {
        // Stand-in for the thread "Add Comment" creates when a person presses Ctrl+I.
        const sel = editor.selection;
        if (!pendingRequests.has(editor.document.uri.toString())) pendingRequests.set(editor.document.uri.toString(), requestFrom(sel));
        thread = controller.createCommentThread(editor.document.uri, new vscode.Range(sel.start, sel.end), []);
      }
      return submit({ thread, text });
    },
  };
}

function deactivate() {}

module.exports = { activate, deactivate };
