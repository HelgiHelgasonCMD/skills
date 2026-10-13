# Skills repo

This repo is public. Every skill here is authored for anyone to read.

## Creating or changing a skill
- Use the `anthropic-skills:skill-creator` skill, with the skill directory at `skills/<name>/`.
  Use its eval loop (`evals/evals.json`) for anything beyond a trivial skill, and its
  description optimizer when triggering is unreliable.
- The `description` is the trigger. Say what it does and **when**: "Use when …" plus
  concrete trigger phrases a user would actually type.
- Keep `SKILL.md` lean (<500 lines). Push detail to `references/` and deterministic work to
  `scripts/` with tests.

## Never publish environment specifics
Tenant/subscription ids, org names, internal hostnames, people, work item numbers: put them
in `skills/<name>/references/<topic>.local.md` (gitignored) and have SKILL.md say
"If `references/<topic>.local.md` exists, read it first." The committed skill must make
sense without it. If `make check` reports a LEAK, move the content to an overlay — do not
weaken the scanner.

## Done means
`make check` is green, then `make install` so the skill is live in `~/.claude/skills`.
