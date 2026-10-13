'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../src/core');

const L = (s) => (s === '' ? [] : s.split('\n'));

test('diffHunks finds a single replaced line', () => {
  assert.deepEqual(core.diffHunks(L('a\nb\nc'), L('a\nB\nc')),
    [{ baseStart: 1, baseEnd: 2, curStart: 1, curEnd: 2 }]);
});

test('diffHunks finds pure insertions and deletions', () => {
  assert.deepEqual(core.diffHunks(L('a\nc'), L('a\nb\nc')),
    [{ baseStart: 1, baseEnd: 1, curStart: 1, curEnd: 2 }]);
  assert.deepEqual(core.diffHunks(L('a\nb\nc'), L('a\nc')),
    [{ baseStart: 1, baseEnd: 2, curStart: 1, curEnd: 1 }]);
});

test('diffHunks separates distant changes into separate hunks', () => {
  const base = L('1\n2\n3\n4\n5\n6');
  const cur = L('1\nX\n3\n4\nY\n6');
  assert.equal(core.diffHunks(base, cur).length, 2);
});

test('diffHunks on identical text is empty', () => {
  assert.deepEqual(core.diffHunks(L('a\nb'), L('a\nb')), []);
});

test('keeping every hunk makes baseline equal current', () => {
  let base = L('def f():\n    return 1\n\ndef g():\n    pass');
  const cur = L('def f() -> int:\n    return 1\n\ndef g():\n    """Doc."""\n    pass');
  for (let h = core.diffHunks(base, cur)[0]; h; h = core.diffHunks(base, cur)[0]) base = core.keepHunk(base, cur, h);
  assert.deepEqual(base, cur);
});

test('undoing every hunk restores the baseline', () => {
  const base = L('a\nb\nc\nd');
  let cur = L('a\nB\nc\nD\ne');
  for (let h = core.diffHunks(base, cur)[0]; h; h = core.diffHunks(base, cur)[0]) cur = core.undoHunk(base, cur, h);
  assert.deepEqual(cur, base);
});

test('keeping one hunk and undoing the other', () => {
  const base0 = L('1\n2\n3\n4\n5');
  const cur0 = L('1\nTWO\n3\n4\nFIVE');
  const [first, second] = core.diffHunks(base0, cur0);
  const base1 = core.keepHunk(base0, cur0, first);
  const cur1 = core.undoHunk(base1, cur0, core.diffHunks(base1, cur0)[0]);
  assert.deepEqual(cur1, L('1\nTWO\n3\n4\n5'));
  assert.deepEqual(core.diffHunks(base1, cur1), []);
  assert.ok(second);
});

test('pickRegion uses the selection when there is one', () => {
  assert.deepEqual(core.pickRegion({ lineCount: 100, selStart: 3, selEnd: 7, selEmpty: false, cursor: 7 }), { start: 3, end: 7 });
});

test('pickRegion uses the whole small file without a selection', () => {
  assert.deepEqual(core.pickRegion({ lineCount: 50, selStart: 4, selEnd: 4, selEmpty: true, cursor: 4 }), { start: 0, end: 49 });
});

test('pickRegion windows a large file round the cursor', () => {
  assert.deepEqual(core.pickRegion({ lineCount: 5000, selStart: 0, selEnd: 0, selEmpty: true, cursor: 10, window: 60 }), { start: 0, end: 70 });
});

test('buildPrompt carries region, instruction and history', () => {
  const p = core.buildPrompt({ path: 'a.py', languageId: 'python', lines: L('x = 1\ny = 2'), region: { start: 1, end: 1 }, cursor: 1, instruction: 'rename y', history: ['first ask'] });
  assert.match(p, /lines 2-2/);
  assert.match(p, /<<<REGION\ny = 2\nREGION>>>/);
  assert.match(p, /Request: rename y/);
  assert.match(p, /- first ask/);
});

test('parseResult reads structured output', () => {
  const out = JSON.stringify({ is_error: false, structured_output: { summary: 's', replacement: 'a\nb\n' } });
  assert.deepEqual(core.parseResult(out), { summary: 's', replacement: 'a\nb\n' });
});

test('fitReplacement keeps the region\'s trailing newlines', () => {
  assert.equal(core.fitReplacement('a\nb\n', 'A\nB'), 'A\nB\n');
  assert.equal(core.fitReplacement('a\nb', 'A\nB\n'), 'A\nB');
  assert.equal(core.fitReplacement('a\n', 'A\r\n'), 'A\n');
});

test('parseResult falls back to result text, and rejects errors and junk', () => {
  assert.equal(core.parseResult(JSON.stringify({ result: '{"summary":"s","replacement":"x"}' })).replacement, 'x');
  assert.throws(() => core.parseResult(JSON.stringify({ is_error: true, result: 'Not logged in' })), /Not logged in/);
  assert.throws(() => core.parseResult('nope'), /not JSON/);
  assert.throws(() => core.parseResult(JSON.stringify({ result: 'hi' })), /no replacement/);
});
