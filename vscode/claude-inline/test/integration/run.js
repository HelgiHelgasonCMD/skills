'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-inline-ws-'));
  fs.writeFileSync(path.join(workspace, 'sample.txt'), 'a\nb\nc\nd\ne\n');
  fs.writeFileSync(path.join(workspace, 'greet.py'), 'def greet(name):\n    return "Hello, " + name\n');
  try {
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust'],
      extensionTestsEnv: { ...process.env, CLAUDE_INLINE_FAKE: path.join(root, 'test/fixtures/fake-claude.js') },
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
