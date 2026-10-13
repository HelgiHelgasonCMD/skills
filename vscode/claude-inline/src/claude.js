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
 */
function runClaude({ claudePath, model, cwd, prompt, signal, timeoutMs = 180000 }) {
  const args = [
    '-p', '--output-format', 'json',
    '--tools', '',
    '--setting-sources', '',
    '--no-session-persistence',
    '--json-schema', JSON.stringify(RESULT_SCHEMA),
    '--system-prompt', SYSTEM_PROMPT,
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
      try {
        resolve(parseResult(out));
      } catch (e) {
        reject(new Error(code ? `${e.message}: ${(err || out).trim().slice(0, 300)}` : e.message));
      }
    });
    child.stdin.end(prompt);
  });
}

module.exports = { runClaude, resolveClaude };
