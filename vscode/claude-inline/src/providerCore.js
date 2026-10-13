'use strict';
// Pure translation between VS Code's language-model API and one `claude -p` call.

const ROLE = { 1: 'User', 2: 'Assistant', 3: 'System' };

function renderPart(p) {
  if (p == null) return '';
  if (typeof p === 'string') return p;
  if (typeof p.value === 'string') return p.value; // text part
  if (p.callId && p.name !== undefined && p.input !== undefined) {
    return `[tool call ${p.callId}] ${p.name} ${JSON.stringify(p.input)}`;
  }
  if (p.callId && Array.isArray(p.content)) {
    return `[tool result ${p.callId}]\n${p.content.map(renderPart).join('\n')}`;
  }
  if (p.mimeType && p.data) {
    const data = Buffer.from(p.data);
    return /^text\/|json/.test(p.mimeType) ? data.toString('utf8') : `[${p.mimeType} attachment omitted]`;
  }
  return '';
}

function messagesToPrompt(messages) {
  return messages
    .map((m) => `### ${ROLE[m.role] || 'User'}\n${(m.content || []).map(renderPart).filter(Boolean).join('\n')}`)
    .join('\n\n');
}

const BASE_SYSTEM = [
  'You are the language model behind a VS Code chat feature.',
  'The conversation below is the full request; follow the instructions inside it exactly, including any',
  'required output format for code edits. Put your whole reply in `text`.',
].join(' ');

function systemPrompt(tools = [], toolMode = 1) {
  if (!tools.length) return BASE_SYSTEM;
  const list = tools.map((t) => `- ${t.name}: ${t.description || ''}\n  input schema: ${JSON.stringify(t.inputSchema || {})}`).join('\n');
  return `${BASE_SYSTEM}

You are acting as an agent with these tools. To call one or more, put them in \`tool_calls\` (name + input
matching the schema exactly) and keep \`text\` to a short note; the caller runs them and sends the results back.
Whenever the request means changing, creating or inserting code in a file, make that change by calling an edit
tool: never paste the new code into \`text\` instead, because text is not applied to the file.
${toolMode === 2 ? 'You MUST call at least one tool in this reply.' : 'Answer in text only when no file needs to change or every needed tool call is done.'}
${list}`;
}

const SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    tool_calls: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, input: { type: 'object' } }, required: ['name', 'input'] },
    },
  },
  required: ['text'],
};

/** Structured output → ordered response parts: text first, then tool calls. */
function toParts(out, tools = []) {
  const known = new Set(tools.map((t) => t.name));
  const parts = [];
  if (out.text) parts.push({ kind: 'text', value: out.text });
  (out.tool_calls || []).forEach((c, i) => {
    if (known.has(c.name)) parts.push({ kind: 'tool', callId: `call_${Date.now().toString(36)}_${i}`, name: c.name, input: c.input || {} });
  });
  if (!parts.length) parts.push({ kind: 'text', value: '' });
  return parts;
}

/** Rough count: VS Code only uses this for budgeting. */
function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

module.exports = { messagesToPrompt, systemPrompt, toParts, estimateTokens, renderPart, SCHEMA };
