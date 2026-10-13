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
function registerProvider(context) {
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
      const folder = vscode.workspace.workspaceFolders?.[0];
      const out = await runClaudeStructured({
        claudePath: cfg.get('claudePath', 'claude'),
        model: model.id,
        cwd: folder ? folder.uri.fsPath : undefined,
        prompt: pc.messagesToPrompt(messages),
        system: pc.systemPrompt(tools, options.toolMode),
        schema: pc.SCHEMA,
        signal: abort.signal,
      });
      for (const part of pc.toParts(out, tools)) {
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
