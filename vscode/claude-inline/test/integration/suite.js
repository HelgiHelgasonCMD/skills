'use strict';
const assert = require('assert/strict');
const path = require('path');
const vscode = require('vscode');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional: CLAUDE_INLINE_SHOTS=<python with mss> <dir> saves screenshots of the real window.
function shot(name) {
  const spec = process.env.CLAUDE_INLINE_SHOTS;
  if (!spec) return;
  const [py, dir] = spec.split(' ');
  require('child_process').execFileSync(py, ['-c', `import mss; mss.mss().shot(mon=1, output=${JSON.stringify(path.join(dir, name + '.png'))})`]);
}

async function open(name) {
  const folder = vscode.workspace.workspaceFolders[0].uri;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, name));
  const editor = await vscode.window.showTextDocument(doc);
  return { doc, editor };
}

async function reset(doc, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
  await vscode.workspace.applyEdit(edit);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let api;

test('Ctrl+I records the selection and the first request starts one session per file', async () => {
  const { doc, editor } = await open('sample.txt');
  await reset(doc, 'a\nb\nc\nd\ne\n');
  editor.selection = new vscode.Selection(1, 0, 2, 1);
  await vscode.commands.executeCommand('claudeInline.start');
  assert.deepEqual(api.pending(doc.uri), { selStart: 1, selEnd: 2, selEmpty: false, cursor: 2 });
  await api.submitActive('upper b');
  const s = api.sessionFor(doc.uri);
  assert.ok(s, 'session started');
  assert.equal(s.thread.label, 'Claude');
  await vscode.commands.executeCommand('claudeInline.start');
  assert.equal(api.sessionFor(doc.uri), s, 'second Ctrl+I reuses the open widget');
  await vscode.commands.executeCommand('claudeInline.close', s.thread);
  assert.equal(api.sessionFor(doc.uri), undefined);
  assert.equal(doc.getText(), 'a\nb\nc\nd\ne\n', 'closing undid the pending change');
  editor.selection = new vscode.Selection(0, 0, 0, 0);
});

test('a request applies live and shows one Keep/Undo per change', async () => {
  const { doc } = await open('sample.txt');
  await reset(doc, 'a\nb\nc\nd\ne\n');
  await api.submitActive('upper b d');
  assert.equal(doc.getText(), 'a\nB\nc\nD\ne\n');
  assert.equal(api.hunks(doc.uri).length, 2);
  const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', doc.uri);
  assert.deepEqual(lenses.map((l) => l.command.title), ['Keep', 'Undo', 'Keep', 'Undo']);
  const thread = api.sessionFor(doc.uri).thread;
  assert.equal(thread.contextValue, 'claudeInline.pending');
  assert.match(thread.comments.at(-1).body.value, /upper-cased b, d.*2 changes/s);
});

test('Keep one change, Undo the other, and the widget closes', async () => {
  const { doc } = await open('sample.txt');
  await vscode.commands.executeCommand('claudeInline.keepHunk', doc.uri.toString(), 0);
  assert.equal(api.hunks(doc.uri).length, 1);
  assert.equal(doc.getText(), 'a\nB\nc\nD\ne\n');
  await vscode.commands.executeCommand('claudeInline.undoHunk', doc.uri.toString(), 0);
  assert.equal(doc.getText(), 'a\nB\nc\nd\ne\n');
  assert.equal(api.sessionFor(doc.uri), undefined, 'session ends when nothing is pending');
});

test('follow-ups refine in the same widget; Undo all restores the original', async () => {
  const { doc } = await open('sample.txt');
  await reset(doc, 'a\nb\nc\nd\ne\n');
  await api.submitActive('upper a');
  await api.submitActive('upper e');
  assert.equal(doc.getText(), 'A\nb\nc\nd\nE\n');
  const s = api.sessionFor(doc.uri);
  assert.deepEqual(s.history, ['upper a', 'upper e']);
  assert.equal(s.thread.comments.filter((c) => c.author.name === 'You').length, 2);
  await vscode.commands.executeCommand('claudeInline.undoAll', doc.uri.toString());
  assert.equal(doc.getText(), 'a\nb\nc\nd\ne\n');
  assert.equal(api.sessionFor(doc.uri), undefined);
});

// Real keystrokes need an X display and python-xlib: CLAUDE_INLINE_KEYS=<python with python-xlib>.
function keys(...seq) {
  require('child_process').execFileSync(process.env.CLAUDE_INLINE_KEYS, [path.join(__dirname, 'xkeys.py'), ...seq]);
}

if (process.env.CLAUDE_INLINE_KEYS) {
  test('keyboard: open the box, type, Ctrl+Enter, then Ctrl+Enter keeps it', async () => {
    const { doc, editor } = await open('sample.txt');
    await reset(doc, 'a\nb\nc\nd\ne\n');
    editor.selection = new vscode.Selection(3, 0, 3, 0);
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await wait(300);
    vscode.commands.executeCommand('claudeInline.start');
    for (let i = 0; i < 30 && !api.pending(doc.uri); i++) await wait(100);
    assert.ok(api.pending(doc.uri), 'Ctrl+I reached the extension');
    await wait(700);
    keys('text:upper d');
    shot('typed');
    keys('ctrl+Return');
    for (let i = 0; i < 50 && api.hunks(doc.uri).length === 0; i++) await wait(100);
    assert.equal(doc.getText(), 'a\nb\nc\nD\ne\n', 'typed text went to Claude, not into the file');
    shot('pending');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await wait(300);
    keys('ctrl+Return');
    for (let i = 0; i < 30 && api.sessionFor(doc.uri); i++) await wait(100);
    assert.equal(api.sessionFor(doc.uri), undefined, 'Ctrl+Enter in the editor kept the change');
    assert.equal(doc.getText(), 'a\nb\nc\nD\ne\n');
  });
}

test('Show diff opens the original next to the edited file', async () => {
  const { doc } = await open('sample.txt');
  await reset(doc, 'a\nb\nc\nd\ne\n');
  await api.submitActive('upper b');
  await vscode.commands.executeCommand('claudeInline.showDiff', doc.uri.toString());
  const left = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'claude-inline-base');
  assert.ok(left, 'baseline document opened');
  assert.equal(left.getText(), 'a\nb\nc\nd\ne\n');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await open('sample.txt');
  await vscode.commands.executeCommand('claudeInline.undoAll', doc.uri.toString());
});

test('Keep all accepts everything', async () => {
  const { doc } = await open('sample.txt');
  await api.submitActive('upper c');
  await vscode.commands.executeCommand('claudeInline.keepAll', doc.uri.toString());
  assert.equal(doc.getText(), 'a\nb\nC\nd\ne\n');
  assert.equal(api.sessionFor(doc.uri), undefined);
});

test('a selection limits what Claude may change', async () => {
  const { doc, editor } = await open('sample.txt');
  await reset(doc, 'a\nb\nc\nd\ne\n');
  editor.selection = new vscode.Selection(2, 0, 3, 1);
  await api.submitActive('upper c d e');
  assert.equal(doc.getText(), 'a\nb\nC\nD\ne\n', 'e is outside the selection');
  await vscode.commands.executeCommand('claudeInline.undoAll', doc.uri.toString());
});

test('errors show in the widget and leave the file alone', async () => {
  const { doc, editor } = await open('sample.txt');
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await api.submitActive('fail');
  assert.equal(doc.getText(), 'a\nb\nc\nd\ne\n');
  const s = api.sessionFor(doc.uri);
  assert.match(s.thread.comments.at(-1).body.value, /Not logged in/);
  await vscode.commands.executeCommand('claudeInline.close', s.thread);
});

test('Claude models are offered to VS Code chat and inline chat', async () => {
  const models = await vscode.lm.selectChatModels({ vendor: 'claude-code' });
  assert.deepEqual(models.map((m) => m.name).sort(), ['Claude Haiku', 'Claude Opus', 'Claude Sonnet']);
});

test('Copilot inline chat (Ctrl+I) opens on Claude when inlineChat.defaultModel names it', async () => {
  const fs = require('fs');
  const warnings = () => {
    const out = [];
    const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.log')) out.push(...fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('inlineChat.defaultModel')));
    } };
    walk(process.env.CLAUDE_INLINE_LOGS);
    return out;
  };
  await vscode.workspace.getConfiguration().update('inlineChat.defaultModel', 'Claude Sonnet (claude-code)', vscode.ConfigurationTarget.Global);
  await open('greet.py');
  const before = warnings().length;
  vscode.commands.executeCommand('inlineChat.start'); // resolves only when the session ends
  await wait(3000);
  shot('copilot-inline-chat');
  assert.deepEqual(warnings().slice(before), [], 'VS Code did not log a model mismatch');
  await vscode.commands.executeCommand('inlineChat.close').then(undefined, () => {});
  await vscode.workspace.getConfiguration().update('inlineChat.defaultModel', undefined, vscode.ConfigurationTarget.Global);
});

test('the provider round-trips text and tool calls through the CLI', async () => {
  const [model] = await vscode.lm.selectChatModels({ vendor: 'claude-code', id: 'sonnet' });
  const read = async (resp) => { const parts = []; for await (const p of resp.stream) parts.push(p); return parts; };
  const textParts = await read(await model.sendRequest([vscode.LanguageModelChatMessage.User('say pong')], {}));
  assert.equal(textParts.map((p) => p.value).join(''), 'pong');
  const tools = [{ name: 'replace_string_in_file', description: 'Edit a file', inputSchema: { type: 'object' } }];
  const toolParts = await read(await model.sendRequest(
    [vscode.LanguageModelChatMessage.User('use the tool')], { tools, toolMode: vscode.LanguageModelChatToolMode.Required }));
  const call = toolParts.find((p) => p instanceof vscode.LanguageModelToolCallPart);
  assert.ok(call, 'a tool call came back');
  assert.equal(call.name, 'replace_string_in_file');
  assert.deepEqual(call.input, { filePath: 'greet.py' });
});

if (process.env.CLAUDE_INLINE_REAL) {
  test('real Claude answers through VS Code\'s model API and calls a Copilot-style edit tool', async () => {
    await vscode.workspace.getConfiguration('claudeInline').update('claudePath', 'claude', vscode.ConfigurationTarget.Workspace);
    const [model] = await vscode.lm.selectChatModels({ vendor: 'claude-code', id: 'sonnet' });
    const tools = [{
      name: 'replace_string_in_file',
      description: 'Replace one exact string in a file with another.',
      inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, oldString: { type: 'string' }, newString: { type: 'string' } }, required: ['filePath', 'oldString', 'newString'] },
    }];
    const resp = await model.sendRequest([vscode.LanguageModelChatMessage.User(
      'File greet.py contains:\ndef greet(name):\n    return "Hello, " + name\n\nAdd type hints to greet.')], { tools, toolMode: vscode.LanguageModelChatToolMode.Auto });
    const parts = [];
    for await (const p of resp.stream) parts.push(p);
    const call = parts.find((p) => p instanceof vscode.LanguageModelToolCallPart);
    console.log('    real reply parts:', JSON.stringify(parts.map((p) => p.value ?? { tool: p.name, input: p.input })));
    assert.ok(call, 'Claude chose the edit tool');
    assert.equal(call.name, 'replace_string_in_file');
    assert.match(call.input.newString, /name: str/);
    await vscode.workspace.getConfiguration('claudeInline').update('claudePath', process.env.CLAUDE_INLINE_FAKE, vscode.ConfigurationTarget.Workspace);
  });

  test('real Claude Code edits a Python function', async () => {
    await vscode.workspace.getConfiguration('claudeInline').update('claudePath', 'claude', vscode.ConfigurationTarget.Workspace);
    const { doc, editor } = await open('greet.py');
    const request = 'add type hints and a docstring';
    if (process.env.CLAUDE_INLINE_KEYS) {
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      await wait(300);
      vscode.commands.executeCommand('claudeInline.start');
      await wait(800);
      keys(`text:${request}`);
      shot('real-typed');
      keys('ctrl+Return');
    } else {
      await api.submitActive(request);
    }
    for (let i = 0; i < 1200 && api.hunks(doc.uri).length === 0; i++) await wait(100);
    await wait(500);
    shot('real-result');
    const text = doc.getText();
    console.log('    real Claude produced:\n' + text.replace(/^/gm, '      | '));
    assert.match(text, /name: str/);
    assert.ok(api.hunks(doc.uri).length >= 1);
    await vscode.commands.executeCommand('claudeInline.keepAll', doc.uri.toString());
  });
}

async function run() {
  const unhandled = [];
  process.on('unhandledRejection', (e) => unhandled.push(e));
  const ext = vscode.extensions.getExtension('helgihelgason.claude-inline');
  api = await ext.activate();
  await vscode.workspace.getConfiguration('claudeInline').update(
    'claudePath', process.env.CLAUDE_INLINE_FAKE, vscode.ConfigurationTarget.Workspace);
  await wait(200);
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✔ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✖ ${t.name}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`);
    }
  }
  if (unhandled.length) { failed++; console.log(`  ✖ ${unhandled.length} unhandled rejection(s): ${unhandled[0]}`); }
  console.log(`${tests.length - failed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} integration test(s) failed`);
}

module.exports = { run };
