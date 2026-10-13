# skills

Personal [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills), one per directory under `skills/`.

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
