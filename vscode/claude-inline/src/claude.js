'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseResult, SYSTEM_PROMPT, RESULT_SCHEMA } = require('./core');

/** VS Code's extension host often lacks the login shell's PATH, so look where the installer puts claude. */
function resolveClaude(configured) {
  if (configured && configured !== 'claude') return configured;
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'claude';
}

/**
 * One headless Claude Code call: no tools, no settings, no saved session — it can only
 * answer, never touch files. Uses the CLI's own login (Pro/Team/Enterprise plan or key).
 * Resolves with the raw `--output-format json` stdout.
 */
function runClaudeRaw({ claudePath, model, cwd, prompt, system, schema, signal, timeoutMs = 180000 }) {
  const args = [
    '-p', '--output-format', 'json',
    '--tools', '',
    '--setting-sources', '',
    '--no-session-persistence',
    '--json-schema', JSON.stringify(schema),
    '--system-prompt', system,
  ];
  if (model) args.push('--model', model);

  return new Promise((resolve, reject) => {
    const child = spawn(resolveClaude(claudePath), args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT'
        ? 'Claude Code CLI not found. Install it and log in, or set claudeInline.claudePath.'
        : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      resolve({ out, err, code });
    });
    child.stdin.end(prompt);
  });
}

function withExitDetail(e, { out, err, code }) {
  return new Error(code ? `${e.message}: ${(err || out).trim().slice(0, 300)}` : e.message);
}

/** Inline-chat edit: returns { summary, replacement }. */
async function runClaude(opts) {
  const res = await runClaudeRaw({ ...opts, system: SYSTEM_PROMPT, schema: RESULT_SCHEMA });
  try { return parseResult(res.out); } catch (e) { throw withExitDetail(e, res); }
}

/** Generic structured call for the language-model provider: returns the structured object. */
async function runClaudeStructured(opts) {
  const res = await runClaudeRaw(opts);
  let d;
  try {
    d = JSON.parse(res.out);
    if (d.is_error) throw new Error(d.result || 'Claude reported an error');
  } catch (e) {
    throw withExitDetail(e.message.includes('JSON') ? new Error('Claude returned output that is not JSON') : e, res);
  }
  return d.structured_output || JSON.parse(d.result);
}

module.exports = { runClaude, runClaudeStructured, resolveClaude };
