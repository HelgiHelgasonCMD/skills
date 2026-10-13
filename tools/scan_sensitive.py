#!/usr/bin/env python3
"""Fail if anything that would be committed looks like it leaks a private environment.

Generic patterns (GUIDs, emails, Azure DevOps org URLs) run everywhere, including CI.
Employer/org names live in the gitignored .sensitive-terms.local, one per line, so the
denylist itself is never published.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b")
ADO_ORG_RE = re.compile(r"dev\.azure\.com[:/](?:v3/)?([A-Za-z0-9_-]+)")
ALLOWED_EMAIL_DOMAINS = ("example.com", "example.org", "users.noreply.github.com")
NULL_GUID = "00000000-0000-0000-0000-000000000000"


def load_terms(path):
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [l.strip().lower() for l in lines if l.strip() and not l.startswith("#")]


def scan_text(text, terms):
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        for m in GUID_RE.finditer(line):
            if m.group(0) != NULL_GUID:
                hits.append((n, f"GUID {m.group(0)}"))
        for m in EMAIL_RE.finditer(line):
            if not m.group(0).lower().endswith(ALLOWED_EMAIL_DOMAINS):
                hits.append((n, f"email {m.group(0)}"))
        for m in ADO_ORG_RE.finditer(line):
            hits.append((n, f"Azure DevOps org {m.group(1)!r} (use <org>)"))
        low = line.lower()
        for t in terms:
            if t in low:
                hits.append((n, f"denylisted term {t!r}"))
    return hits


def candidate_files(root):
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout
    return [root / p for p in out.splitlines() if p]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", type=Path, help="default: every file git would track")
    ap.add_argument("--terms", type=Path, default=ROOT / ".sensitive-terms.local")
    args = ap.parse_args(argv)

    terms = load_terms(args.terms)
    files = args.files or candidate_files(ROOT)
    total = 0
    for f in files:
        if f.name.endswith(".local.md") or f.name == args.terms.name or not f.is_file():
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for n, msg in scan_text(text, terms):
            print(f"LEAK {f}:{n}: {msg}", file=sys.stderr)
            total += 1
    print(f"scan: {len(files)} file(s), {len(terms)} local term(s), {total} hit(s)")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
