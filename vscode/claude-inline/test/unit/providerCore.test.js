'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pc = require('../../src/providerCore');

const text = (value) => ({ value });

test('messagesToPrompt labels roles and flattens text, tool calls and results', () => {
  const p = pc.messagesToPrompt([
    { role: 1, content: [text('fix the bug')] },
    { role: 2, content: [{ callId: 'c1', name: 'read_file', input: { path: 'a.py' } }] },
    { role: 1, content: [{ callId: 'c1', content: [text('print(1)')] }] },
  ]);
  assert.match(p, /### User\nfix the bug/);
  assert.match(p, /### Assistant\n\[tool call c1\] read_file \{"path":"a.py"\}/);
  assert.match(p, /\[tool result c1\]\nprint\(1\)/);
});

test('data parts: text-like decoded, binary omitted', () => {
  assert.equal(pc.renderPart({ mimeType: 'text/plain', data: Buffer.from('hi') }), 'hi');
  assert.match(pc.renderPart({ mimeType: 'image/png', data: Buffer.from([1, 2]) }), /omitted/);
});

test('systemPrompt lists tools and enforces required mode', () => {
  const tools = [{ name: 'edit', description: 'Edit a file', inputSchema: { type: 'object' } }];
  assert.doesNotMatch(pc.systemPrompt([], 1), /tool_calls/);
  assert.match(pc.systemPrompt(tools, 1), /- edit: Edit a file/);
  assert.match(pc.systemPrompt(tools, 2), /MUST call at least one tool/);
});

test('toParts keeps text and only known tools', () => {
  const parts = pc.toParts({ text: 'ok', tool_calls: [{ name: 'edit', input: { a: 1 } }, { name: 'rm_rf', input: {} }] }, [{ name: 'edit' }]);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0], { kind: 'text', value: 'ok' });
  assert.equal(parts[1].kind, 'tool');
  assert.equal(parts[1].name, 'edit');
  assert.deepEqual(parts[1].input, { a: 1 });
});

test('toParts never returns nothing', () => {
  assert.deepEqual(pc.toParts({ text: '' }), [{ kind: 'text', value: '' }]);
});
