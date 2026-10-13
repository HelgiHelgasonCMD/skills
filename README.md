# skills

Personal [Claude Code skills](https://code.claude.com/docs/en/skills), one per directory under `skills/`.

<p align="center">
  <img src="docs/inline-comments/walkthrough.gif" width="720" alt="inline-comments walkthrough: leave @claude comments, accept or reject each change, get a summary">
</p>

## Skills

| Skill | What it does |
|---|---|
| [inline-comments](skills/inline-comments/) | Copilot-style "comment to change": write `@claude <instruction>` in your code, and each one becomes a separate edit you review in the IDE. |

## VS Code extension

| Extension | What it does |
|---|---|
| [claude-inline](vscode/claude-inline/) | Copilot's Ctrl+I inline chat, powered by Claude Code on your Claude plan (no API key): type a request at the cursor, the edit applies inline, Keep or Undo each change. |

<p align="center">
  <img src="docs/claude-inline/2-review.png" width="600" alt="claude-inline: an edit applied inline with Keep and Undo">
</p>

Install: download the `.vsix` from [Releases](https://github.com/HelgiHelgasonCMD/skills/releases), then `code --install-extension claude-inline-<version>.vsix`.

## Install the skills

As a Claude Code plugin (2.1.275+):

```
/plugin install helgi-skills --marketplace HelgiHelgasonCMD/skills
```

Older versions: `/plugin marketplace add HelgiHelgasonCMD/skills`, then `/plugin install helgi-skills@helgi-skills`.

## Developing

```bash
make install   # symlink skills/* into ~/.claude/skills (never overwrites anything it didn't create)
make check     # validate skills, scan for leaks, run tests
```

## Conventions

- `skills/<name>/SKILL.md` with `name` matching the directory and a `description` that says **when** to use it.
- Detail goes in `references/`, scripts in `scripts/`; keep `SKILL.md` under 500 lines.
- Anything environment-specific (tenants, org names, internal hosts) goes in a gitignored
  `references/*.local.md` that the skill reads if present. The public skill stays generic.
- `tools/scan_sensitive.py` blocks commits containing GUIDs, emails, Azure DevOps org URLs,
  or any term in the local, gitignored `.sensitive-terms.local`.

Enable the pre-commit hook after cloning: `git config core.hooksPath .githooks`.
