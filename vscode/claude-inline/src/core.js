'use strict';
// Pure logic: no vscode import, so it runs under plain `node --test`.

/** Line diff of two arrays of strings → hunks of changed lines (0-based, end exclusive). */
function diffHunks(base, cur) {
  let pre = 0;
  while (pre < base.length && pre < cur.length && base[pre] === cur[pre]) pre++;
  let suf = 0;
  while (suf < base.length - pre && suf < cur.length - pre &&
         base[base.length - 1 - suf] === cur[cur.length - 1 - suf]) suf++;

  const a = base.slice(pre, base.length - suf);
  const b = cur.slice(pre, cur.length - suf);
  const n = a.length, m = b.length;
  // LCS table over the trimmed middle only; edits are small, so this stays cheap.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const hunks = [];
  let i = 0, j = 0, open = null;
  const close = () => { if (open) { open.baseEnd = pre + i; open.curEnd = pre + j; hunks.push(open); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { close(); i++; j++; continue; }
    if (!open) open = { baseStart: pre + i, curStart: pre + j };
    if (j < m && (i >= n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) j++;
    else i++;
  }
  close();
  return hunks;
}

/** Accept one hunk: the baseline takes the current lines for it. */
function keepHunk(base, cur, h) {
  return [...base.slice(0, h.baseStart), ...cur.slice(h.curStart, h.curEnd), ...base.slice(h.baseEnd)];
}

/** Reject one hunk: the current text takes the baseline lines back. */
function undoHunk(base, cur, h) {
  return [...cur.slice(0, h.curStart), ...base.slice(h.baseStart, h.baseEnd), ...cur.slice(h.curEnd)];
}

/** Lines Claude may rewrite: the selection, else the whole file when small, else a window round the cursor. */
function pickRegion({ lineCount, selStart, selEnd, selEmpty, cursor, maxWholeFile = 800, window = 60 }) {
  if (!selEmpty) return { start: selStart, end: selEnd };
  if (lineCount <= maxWholeFile) return { start: 0, end: lineCount - 1 };
  return { start: Math.max(0, cursor - window), end: Math.min(lineCount - 1, cursor + window) };
}

function buildPrompt({ path, languageId, lines, region, cursor, instruction, history = [] }) {
  const numbered = lines.map((l, i) => `${String(i + 1).padStart(5)}| ${l}`).join('\n');
  const regionText = lines.slice(region.start, region.end + 1).join('\n');
  const past = history.length
    ? `\nEarlier requests in this session (already applied to the file above):\n${history.map((h) => `- ${h}`).join('\n')}\n`
    : '';
  return [
    `File: ${path} (${languageId})`,
    `Cursor: line ${cursor + 1}`,
    '',
    'Full file, for context:',
    numbered,
    '',
    `Region to rewrite: lines ${region.start + 1}-${region.end + 1}, exactly:`,
    '<<<REGION',
    regionText,
    'REGION>>>',
    past,
    `Request: ${instruction}`,
  ].join('\n');
}

const SYSTEM_PROMPT = [
  'You are an inline code editor, like Copilot inline chat.',
  'Rewrite ONLY the given region of the file to satisfy the request.',
  'Return `replacement`: the complete new text for that region (every line you keep, plus your changes),',
  'with the original indentation style, no markdown fences, no line numbers.',
  'To insert code at the cursor, return the region with the new code inserted.',
  'If the request is a question and needs no edit, return the region unchanged and answer in `summary`.',
  'Return `summary`: one short sentence saying what you changed.',
].join(' ');

const RESULT_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, replacement: { type: 'string' } },
  required: ['summary', 'replacement'],
};

/** Parse `claude -p --output-format json --json-schema` stdout. */
function parseResult(stdout) {
  let d;
  try { d = JSON.parse(stdout); } catch { throw new Error('Claude returned output that is not JSON'); }
  if (d.is_error) throw new Error(d.result || 'Claude reported an error');
  const out = d.structured_output || (() => { try { return JSON.parse(d.result); } catch { return null; } })();
  if (!out || typeof out.replacement !== 'string') throw new Error('Claude returned no replacement');
  return { summary: String(out.summary || ''), replacement: out.replacement };
}

/** Models add or drop a final newline at random; keep whatever the original region had. */
function fitReplacement(regionText, replacement) {
  const trailing = regionText.match(/\n*$/)[0];
  return replacement.replace(/\r?\n*$/, '') + trailing;
}

/**
 * Whether a document change may close a session. VS Code also fires change events with no
 * content changes (dirty-state flips); one landing between "baseline set" and "edit applied"
 * looked like "nothing pending" and ended the session before the edit arrived.
 */
function shouldSettle(contentChangeCount, applying) {
  return contentChangeCount > 0 && !applying;
}

module.exports = { shouldSettle, fitReplacement, diffHunks, keepHunk, undoHunk, pickRegion, buildPrompt, parseResult, SYSTEM_PROMPT, RESULT_SCHEMA };
