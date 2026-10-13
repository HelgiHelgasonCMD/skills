#!/usr/bin/env python3
"""Lint every skill under skills/: frontmatter, naming, description, size, links."""
import re
import sys
from pathlib import Path

MAX_DESCRIPTION = 1024
MAX_LINES = 500
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
TRIGGER_RE = re.compile(r"\b(use when|use for|use before|use at|triggers?:)", re.I)
LINK_RE = re.compile(r"\]\(([^)\s]+)\)")


def parse_frontmatter(text):
    """Minimal YAML subset: top-level `key: value`, plus `>`/`|` block scalars."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, "missing frontmatter (first line must be ---)"
    try:
        end = next(i for i, l in enumerate(lines[1:], 1) if l.strip() == "---")
    except StopIteration:
        return None, "frontmatter is not closed with ---"
    fields, key = {}, None
    for line in lines[1:end]:
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if m:
            key, value = m.group(1), m.group(2).strip()
            fields[key] = "" if value in (">", "|", ">-", "|-") else value.strip("'\"")
        elif key and line.startswith((" ", "\t")):
            fields[key] = (fields[key] + " " + line.strip()).strip()
    return fields, None


def validate_skill(skill_dir):
    skill_dir = Path(skill_dir)
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"{skill_dir.name}: no SKILL.md"]
    text = skill_md.read_text(encoding="utf-8")
    fields, err = parse_frontmatter(text)
    if err:
        return [f"{skill_dir.name}: {err}"]

    errors = []
    name = fields.get("name", "")
    if not name:
        errors.append("missing `name`")
    elif not NAME_RE.match(name):
        errors.append(f"name {name!r} is not kebab-case")
    elif name != skill_dir.name:
        errors.append(f"name {name!r} does not match directory {skill_dir.name!r}")

    desc = fields.get("description", "")
    if not desc:
        errors.append("missing `description`")
    else:
        if len(desc) > MAX_DESCRIPTION:
            errors.append(f"description is {len(desc)} chars (max {MAX_DESCRIPTION})")
        if not TRIGGER_RE.search(desc):
            errors.append("description says what, not when: add 'Use when ...' or 'Triggers: ...'")

    n = len(text.splitlines())
    if n > MAX_LINES:
        errors.append(f"SKILL.md is {n} lines (max {MAX_LINES}); move detail into references/")

    for path in skill_dir.rglob("*.md"):
        for target in LINK_RE.findall(path.read_text(encoding="utf-8")):
            target = target.split("#")[0]
            if not target or re.match(r"^[a-z]+:", target):
                continue
            # *.local.md overlays are gitignored, so they are optional by design.
            if target.endswith(".local.md"):
                continue
            if not (path.parent / target).exists():
                errors.append(f"{path.relative_to(skill_dir)}: broken link {target}")

    return [f"{skill_dir.name}: {e}" for e in errors]


def main(argv):
    root = Path(argv[1] if len(argv) > 1 else Path(__file__).resolve().parent.parent / "skills")
    skills = sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))
    errors = [e for s in skills for e in validate_skill(s)]
    for e in errors:
        print(f"FAIL {e}", file=sys.stderr)
    print(f"validate: {len(skills)} skill(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
