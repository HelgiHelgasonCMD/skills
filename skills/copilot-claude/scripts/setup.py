#!/usr/bin/env python3
"""Make Claude the model behind VS Code's Copilot inline chat (Ctrl+I), on a Claude plan login.

1. installs the claude-inline extension (registers Claude Code as a VS Code language-model provider)
2. sets "inlineChat.defaultModel" in the VS Code user settings to the Claude model
3. checks that the Claude Code CLI is installed

Usage: setup.py [--model sonnet|opus|haiku] [--vsix PATH] [--settings PATH] [--dry-run]
"""
import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO = "HelgiHelgasonCMD/skills"
EXTENSION_ID = "helgihelgason.claude-inline"
MODEL_NAMES = {"sonnet": "Claude Sonnet", "opus": "Claude Opus", "haiku": "Claude Haiku"}
KEY = "inlineChat.defaultModel"


def qualified_name(model):
    # VS Code matches inlineChat.defaultModel against "<name> (<vendor>)".
    return f"{MODEL_NAMES[model]} (claude-code)"


def set_setting(text, key, value):
    """Set a top-level string setting in a JSONC settings file, keeping comments and layout."""
    encoded = json.dumps(value)
    pattern = re.compile(r'("' + re.escape(key) + r'"\s*:\s*)("(?:[^"\\]|\\.)*"|[^,\n}]+)')
    if pattern.search(text):
        return pattern.sub(lambda m: m.group(1) + encoded, text, count=1)
    stripped = text.strip()
    if not stripped:
        return "{\n  " + json.dumps(key) + ": " + encoded + "\n}\n"
    brace = text.index("{")
    rest = text[brace + 1:]
    has_entries = re.search(r'"\s*:', rest) is not None
    insert = "\n  " + json.dumps(key) + ": " + encoded + ("," if has_entries else "")
    return text[:brace + 1] + insert + rest


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def is_wsl():
    return "microsoft" in platform.uname().release.lower()


def settings_path():
    home = Path.home()
    system = platform.system()
    if system == "Darwin":
        return home / "Library/Application Support/Code/User/settings.json"
    if system == "Windows":
        return Path(os.environ["APPDATA"]) / "Code/User/settings.json"
    if is_wsl():
        # User settings for a WSL window live on the Windows side.
        appdata = run(["cmd.exe", "/c", "echo %APPDATA%"]).stdout.strip()
        if appdata and "%" not in appdata:
            return Path(run(["wslpath", appdata]).stdout.strip()) / "Code/User/settings.json"
    return home / ".config/Code/User/settings.json"


def latest_vsix(dest):
    with urllib.request.urlopen(f"https://api.github.com/repos/{REPO}/releases?per_page=20") as r:
        releases = json.load(r)
    for rel in releases:
        for asset in rel.get("assets", []):
            if asset["name"].startswith("claude-inline-") and asset["name"].endswith(".vsix"):
                path = Path(dest) / asset["name"]
                urllib.request.urlretrieve(asset["browser_download_url"], path)
                return path
    raise SystemExit("no claude-inline .vsix found in the GitHub releases")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", choices=sorted(MODEL_NAMES), default="sonnet")
    ap.add_argument("--vsix", type=Path, help="install this file instead of the latest release")
    ap.add_argument("--settings", type=Path, help="VS Code user settings.json (default: detected)")
    ap.add_argument("--dry-run", action="store_true", help="report what would change, change nothing")
    args = ap.parse_args(argv)

    problems = []
    claude = shutil.which("claude") or next(
        (str(p) for p in [Path.home() / ".local/bin/claude", Path.home() / ".claude/local/claude"] if p.exists()), None)
    print(f"claude CLI: {claude or 'NOT FOUND'}")
    if not claude:
        problems.append("Install Claude Code and log in once (`claude`, then /login).")

    code = shutil.which("code")
    print(f"code CLI:   {code or 'NOT FOUND'}")
    if not code:
        problems.append("The `code` command isn't on PATH (VS Code: 'Shell Command: Install code command in PATH').")
    else:
        installed = EXTENSION_ID in run([code, "--list-extensions"]).stdout.lower()
        print(f"extension:  {'installed' if installed else 'not installed'}")
        if args.dry_run:
            print(f"would install {args.vsix or 'the latest claude-inline release'}")
        else:
            with tempfile.TemporaryDirectory() as tmp:
                vsix = args.vsix or latest_vsix(tmp)
                res = run([code, "--install-extension", str(vsix), "--force"])
                print(res.stdout.strip() or res.stderr.strip())
                if res.returncode:
                    problems.append(f"Extension install failed: {res.stderr.strip()[:200]}")

    path = args.settings or settings_path()
    value = qualified_name(args.model)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    new = set_setting(old, KEY, value)
    print(f"settings:   {path}")
    if new == old:
        print(f"            {KEY} already \"{value}\"")
    elif args.dry_run:
        print(f"            would set {KEY} = \"{value}\"")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        if old:
            shutil.copy2(path, path.with_suffix(".json.bak"))
        path.write_text(new, encoding="utf-8")
        print(f"            set {KEY} = \"{value}\" (backup: {path.with_suffix('.json.bak').name})")

    if problems:
        print("\nTo finish:\n" + "\n".join(f"- {p}" for p in problems))
        return 1
    print("\nDone. Reload VS Code, press Ctrl+I in a file, and the inline chat runs on Claude.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
