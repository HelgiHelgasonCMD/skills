---
name: copilot-claude
description: Sets up VS Code so GitHub Copilot's own inline chat (Ctrl+I) and chat run on Claude through the user's Claude Code login (Pro, Team or Enterprise plan, no API key). It installs the claude-inline extension, which registers Claude Code as a VS Code model provider, and makes Claude the inline-chat default. Use when the user wants "Copilot but with Claude", "Claude in Copilot inline chat", "Ctrl+I with Claude", "use my Claude plan in VS Code", or "the Copilot experience in Claude".
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/setup.py *)
---

# Copilot's inline chat, running on Claude

The user keeps Copilot's UI exactly as it is: Ctrl+I, the inline diff, Keep/Undo and follow-ups.
Only the model changes. Claude answers through the Claude Code CLI on this machine, so their Claude
plan pays for it and no API key is needed.

## 1. Dry run first

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/setup.py --dry-run
```

It reports where the `claude` CLI is, whether the `code` command exists, whether the extension
is already installed, and which settings file it would change. Show the user that output.

If it lists problems under "To finish", tell the user exactly what to do and stop:
- **No `claude`:** install Claude Code, then run `claude` and `/login` once.
- **No `code`:** in VS Code, run *Shell Command: Install 'code' command in PATH*. In WSL, open
  the folder with `code .` once.

## 2. Apply

Use `--model opus` or `--model haiku` if the user asked for one; the default is Sonnet.

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/setup.py [--model sonnet|opus|haiku]
```

This installs the latest `claude-inline` release with `code --install-extension`. It also sets
`"inlineChat.defaultModel": "Claude Sonnet (claude-code)"` in the VS Code user settings, after
backing the file up to `settings.json.bak`. The script edits the settings file itself: don't
hand-edit it as well.

## 3. Tell the user how to use it

- Reload VS Code (*Developer: Reload Window*).
- Ctrl+I in a file opens Copilot's inline chat, with **Claude Sonnet** shown as the model.
- The model picker in Copilot Chat also lists Claude Sonnet, Opus and Haiku, so they can switch
  there too.
- Copilot still has to be signed in, because the inline chat UI belongs to Copilot. Their Copilot
  plan is not charged for these requests, since Claude answers them.
- Ghost-text tab completions keep using Copilot's own models. VS Code doesn't let other providers
  supply completions.

## If Ctrl+I still shows a Copilot model

- If the model under the input reads e.g. `GPT-…`, click it and pick **Claude Sonnet**. The choice
  sticks for the session.
- On Copilot Business or Enterprise, an organization policy can block models from other
  providers. Check whether Claude Sonnet appears in the Copilot Chat model picker. If it doesn't,
  it's the org's call: offer to draft the request to their GitHub admin for the
  *"Bring Your Own Language Model Key in VS Code"* policy.
- For errors in replies, the Claude Code CLI is the first thing to check: `claude -p "say ok"`
  in a terminal must work.
