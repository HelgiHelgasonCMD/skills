# Claude Inline

Copilot's inline chat, with Claude Code doing the work. Uses the Claude Code CLI's
own login, so a **Claude Pro, Team or Enterprise plan works with no API key**.

<p>
  <img src="https://raw.githubusercontent.com/HelgiHelgasonCMD/skills/main/docs/claude-inline/1-ask.png" width="49%" alt="Ctrl+I opens a prompt box at the cursor">
  <img src="https://raw.githubusercontent.com/HelgiHelgasonCMD/skills/main/docs/claude-inline/2-review.png" width="49%" alt="The edit is applied inline with Keep and Undo">
</p>

Real screenshots of the extension running in VS Code with Claude Code.

| | |
|---|---|
| **Ctrl+I** (Cmd+I) | Opens an empty prompt box at the cursor. Select code first to limit what Claude may touch. |
| **Ctrl+Enter** in the box | Sends it. The edit is applied straight away, shown as green lines, with removed lines marked in red (hover to see them). |
| **Keep / Undo** above each change | Accept or reject that change on its own. |
| **Ctrl+Enter** in the editor | Keep all. |
| **Ctrl+Backspace** in the editor | Undo all. |
| Type again in the same box | Follow-up: refines the pending change with the earlier requests as context. |
| Box toolbar | Keep all · Undo all · Show diff · Close (closing undoes anything pending). |

With no selection, Claude may rewrite the whole file (up to `claudeInline.maxWholeFileLines`,
default 800); in larger files it works on 60 lines either side of the cursor.

## Install

1. Install the Claude Code CLI and log in once: `claude` in a terminal, then `/login`.
2. Download `claude-inline-<version>.vsix` from the
   [latest release](https://github.com/HelgiHelgasonCMD/skills/releases) and run
   `code --install-extension claude-inline-<version>.vsix`
   (or Extensions view → `…` → *Install from VSIX…*).
3. **If GitHub Copilot is installed**, it also uses Ctrl+I. Give it to Claude by adding this to
   your keybindings (`Preferences: Open Keyboard Shortcuts (JSON)`):

   ```json
   { "key": "ctrl+i", "command": "-inlineChat.start" },
   { "key": "ctrl+i", "command": "claudeInline.start", "when": "editorTextFocus && !editorReadonly" }
   ```

   Use `cmd+i` on macOS.

In WSL or Remote SSH windows the extension runs on the remote side, so the `claude` CLI must
be installed and logged in there.

## Settings

| Setting | Default | |
|---|---|---|
| `claudeInline.model` | `sonnet` | Passed to `claude --model` (`sonnet`, `opus`, `haiku` or a full id). |
| `claudeInline.claudePath` | `claude` | CLI path; `~/.local/bin/claude` and the usual install locations are found automatically. |
| `claudeInline.maxWholeFileLines` | `800` | See above. |

## How it differs from Copilot

- Removed lines aren't drawn inline: VS Code doesn't let extensions insert virtual lines. They are
  marked with a red rule; hover to see them, or use **Show diff**.
- The prompt box is VS Code's comment widget, so it looks like a review comment rather than
  Copilot's floating bar, and a new box is titled "Start discussion" until you send.
- Every line accepts a Claude box (that's what lets Ctrl+I open one anywhere), so VS Code shows a
  comment icon in the gutter on hover; clicking it opens the box too.
- The extension sets `comments.openView` to `never` by default so the Comments panel doesn't
  pop open. Set it back in your settings if another extension relies on it.
- No ghost-text completions.

Each request is a fresh `claude -p` call with tools disabled, so Claude can only propose text;
it can't run commands or edit other files.

## Development

```bash
npm install
npm run test:unit                    # pure logic
xvfb-run -a npm run test:integration # drives a real VS Code with a stub CLI
CLAUDE_INLINE_REAL=1 xvfb-run -a npm run test:integration  # plus one real Claude call
npm run package                      # builds the .vsix
```
