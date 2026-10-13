# Claude for Copilot Inline Chat

Keep **GitHub Copilot's inline chat exactly as it is** (Ctrl+I, the inline diff, Keep/Undo, follow-ups)
and have **Claude** answer, through your Claude Code login. A Claude Pro, Team or Enterprise plan
works; no API key.

**Ctrl+I in Copilot, answered by Claude:**

<img src="https://raw.githubusercontent.com/HelgiHelgasonCMD/skills/main/docs/claude-inline/gifs/copilot-ctrl-i.gif" width="720" alt="Copilot inline chat: Ctrl+I, type a request, Claude Sonnet edits the function inline, Keep">

**Copilot Chat agent mode on Claude:** pick Claude Sonnet under *Claude Code* in the model picker. The agent reads
the file, edits it, runs a check, and you Keep the result.

<img src="https://raw.githubusercontent.com/HelgiHelgasonCMD/skills/main/docs/claude-inline/gifs/copilot-chat-agent.gif" width="720" alt="Copilot Chat agent: choose Claude Sonnet, ask for docstrings, the agent edits and verifies">

The extension registers Claude Code as a VS Code language-model provider, so **Claude Sonnet**, **Opus**
and **Haiku** appear in Copilot's model pickers. Setting `inlineChat.defaultModel` makes Ctrl+I open on Claude.

## Set up

From Claude Code, with the [helgi-skills plugin](https://github.com/HelgiHelgasonCMD/skills) installed:

> set up Copilot inline chat with Claude

The `copilot-claude` skill installs this extension and sets the default model. It downloads the latest release,
installs it, sets the model, and Ctrl+I opens on Claude Sonnet:

<img src="https://raw.githubusercontent.com/HelgiHelgasonCMD/skills/main/docs/claude-inline/gifs/setup.gif" width="640" alt="The setup script installs the extension and sets the default model, then Ctrl+I opens on Claude Sonnet">

By hand:

1. Install the Claude Code CLI and log in once: run `claude`, then `/login`.
2. Download `claude-inline-<version>.vsix` from the
   [latest release](https://github.com/HelgiHelgasonCMD/skills/releases) and run
   `code --install-extension claude-inline-<version>.vsix`.
3. In your VS Code user settings:
   ```json
   "inlineChat.defaultModel": "Claude Sonnet (claude-code)"
   ```
   Use `Claude Opus (claude-code)` or `Claude Haiku (claude-code)` for the other models.
4. Reload VS Code and press Ctrl+I.

Copilot stays signed in: the inline chat UI is Copilot's. Requests to these models go to Claude,
not to your Copilot quota. Ghost-text completions keep using Copilot's own models, because VS Code
doesn't let other providers supply them.

In WSL or Remote SSH windows the extension runs on the remote side, so the `claude` CLI must be
installed and logged in there.

On Copilot Business or Enterprise, an organization policy can hide models from other providers. If
Claude doesn't show up in the Copilot Chat model picker, ask your GitHub admin about the
*Bring Your Own Language Model Key in VS Code* policy.

## How requests run

Each request is one `claude -p` call with Claude Code's own tools disabled and no settings or
saved session. Copilot's edit tools are passed to Claude, and Claude's tool calls go back to
Copilot, so Copilot applies the edits and shows its normal diff. Claude can't run anything on its
own.

## Without Copilot

The command **Claude: Inline Chat** opens a Claude prompt box at the cursor using VS Code's comment
widget. Bind it to a key yourself. The edit applies inline with Keep/Undo above each change;
Ctrl+Enter keeps everything, Ctrl+Backspace undoes everything.

<img src="https://raw.githubusercontent.com/HelgiHelgasonCMD/skills/main/docs/claude-inline/gifs/claude-inline-box.gif" width="720" alt="Claude: Inline Chat box: request, two changes, Keep one, Undo the other">

## Settings

| Setting | Default | |
|---|---|---|
| `claudeInline.claudePath` | `claude` | CLI path; `~/.local/bin/claude` and the usual install locations are found automatically. |
| `claudeInline.model` | `sonnet` | Model for the fallback box. |
| `claudeInline.maxWholeFileLines` | `800` | Fallback box: with no selection, files up to this size are editable whole. |

## Development

```bash
npm install
npm run test:unit
xvfb-run -a npm run test:integration                       # real VS Code, stub CLI
CLAUDE_INLINE_REAL=1 xvfb-run -a npm run test:integration  # plus real Claude calls
npm run package
```
