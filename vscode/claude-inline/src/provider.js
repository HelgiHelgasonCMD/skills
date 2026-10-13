'use strict';
const vscode = require('vscode');
const pc = require('./providerCore');
const { runClaudeStructured } = require('./claude');

// Aliases the Claude Code CLI resolves to its current models.
const MODELS = [
  { id: 'sonnet', name: 'Claude Sonnet', family: 'claude-sonnet' },
  { id: 'opus', name: 'Claude Opus', family: 'claude-opus' },
  { id: 'haiku', name: 'Claude Haiku', family: 'claude-haiku' },
];

/** Makes Claude, via the Claude Code CLI login, a model in VS Code's own chat and inline chat (Ctrl+I). */
function describePart(p) {
  const kind = p?.constructor?.name || typeof p;
  const keys = p && typeof p === 'object' ? Object.keys(p).join(',') : '';
  return `${kind}{${keys}}`;
}

function registerProvider(context) {
  const log = vscode.window.createOutputChannel('Claude Code', { log: true });
  context.subscriptions.push(log);
  const provider = {
    provideLanguageModelChatInformation() {
      return MODELS.map((m) => ({
        ...m,
        version: 'claude-code',
        detail: 'via Claude Code',
        tooltip: 'Runs through your local Claude Code CLI login; no API key.',
        maxInputTokens: 200000,
        maxOutputTokens: 32000,
        capabilities: { toolCalling: true, imageInput: false },
      }));
    },

    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
      const cfg = vscode.workspace.getConfiguration('claudeInline');
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      const tools = options.tools || [];
      log.info(`request model=${model.id} messages=${messages.length} toolMode=${options.toolMode} tools=[${tools.map((t) => t.name).join(', ')}]`);
      messages.forEach((m, i) => log.info(`  msg ${i} role=${m.role} parts=${(m.content || []).map(describePart).join(' ')}`));
      const folder = vscode.workspace.workspaceFolders?.[0];
      const prompt = pc.messagesToPrompt(messages);
      const system = pc.systemPrompt(tools, options.toolMode);
      if (process.env.CLAUDE_INLINE_DUMP) {
        // Diagnostics only: the exact text sent to the CLI for each request.
        const stamp = Date.now();
        require('fs').writeFileSync(require('path').join(process.env.CLAUDE_INLINE_DUMP, `${stamp}-system.txt`), system);
        require('fs').writeFileSync(require('path').join(process.env.CLAUDE_INLINE_DUMP, `${stamp}-prompt.txt`), prompt);
      }
      const out = await runClaudeStructured({
        claudePath: cfg.get('claudePath', 'claude'),
        model: model.id,
        cwd: folder ? folder.uri.fsPath : undefined,
        prompt,
        system,
        schema: pc.SCHEMA,
        signal: abort.signal,
      });
      const parts = pc.toParts(out, tools);
      log.info(`reply ${parts.map((p) => (p.kind === 'tool' ? `tool:${p.name}` : `text(${p.value.length})`)).join(' ')}`);
      for (const part of parts) {
        progress.report(part.kind === 'text'
          ? new vscode.LanguageModelTextPart(part.value)
          : new vscode.LanguageModelToolCallPart(part.callId, part.name, part.input));
      }
    },

    async provideTokenCount(model, text) {
      return pc.estimateTokens(typeof text === 'string' ? text : pc.messagesToPrompt([text]));
    },
  };
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('claude-code', provider));
}

// VS Code's inlineChat.defaultModel matches "<name> (<vendor>)".
const qualifiedName = (m) => `${m.name} (claude-code)`;

module.exports = { registerProvider, MODELS, qualifiedName };
