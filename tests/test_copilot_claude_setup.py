import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "copilot-claude" / "scripts" / "setup.py"
sys.path.insert(0, str(SCRIPT.parent))

import setup as cc  # noqa: E402

KEY = "inlineChat.defaultModel"


def jsonc_load(text):
    """Strip // comments and trailing commas, enough to check the result parses."""
    import re
    text = re.sub(r"(^|\s)//[^\n\"]*$", "", text, flags=re.M)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return json.loads(text)


class SetSettingTest(unittest.TestCase):
    def test_empty_file(self):
        self.assertEqual(jsonc_load(cc.set_setting("", KEY, "X")), {KEY: "X"})

    def test_empty_object(self):
        self.assertEqual(jsonc_load(cc.set_setting("{}", KEY, "X")), {KEY: "X"})

    def test_inserts_and_keeps_comments_and_other_keys(self):
        src = '{\n  // my font\n  "editor.fontSize": 14,\n  "files.autoSave": "off",\n}\n'
        out = cc.set_setting(src, KEY, "Claude Sonnet (claude-code)")
        self.assertIn("// my font", out)
        self.assertEqual(jsonc_load(out), {KEY: "Claude Sonnet (claude-code)", "editor.fontSize": 14, "files.autoSave": "off"})

    def test_replaces_existing_value_only(self):
        src = '{\n  "inlineChat.defaultModel": "GPT-4o (copilot)", // was\n  "a": 1\n}'
        out = cc.set_setting(src, KEY, "Claude Opus (claude-code)")
        self.assertIn("// was", out)
        self.assertEqual(jsonc_load(out), {KEY: "Claude Opus (claude-code)", "a": 1})

    def test_idempotent(self):
        once = cc.set_setting('{"a": 1}', KEY, "X")
        self.assertEqual(cc.set_setting(once, KEY, "X"), once)

    def test_qualified_name_matches_provider(self):
        provider = (ROOT / "vscode/claude-inline/src/provider.js").read_text()
        for alias, name in cc.MODEL_NAMES.items():
            self.assertIn(f"id: '{alias}', name: '{name}'", provider)
            self.assertEqual(cc.qualified_name(alias), f"{name} (claude-code)")


class MainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.log = self.tmp / "code.log"
        (self.bin / "code").write_text(f"#!/bin/sh\necho \"$@\" >> {self.log}\n")
        (self.bin / "claude").write_text("#!/bin/sh\nexit 0\n")
        for f in self.bin.iterdir():
            f.chmod(0o755)
        self.settings = self.tmp / "settings.json"
        self.settings.write_text('{\n  "editor.fontSize": 14\n}\n')
        self.vsix = self.tmp / "claude-inline-9.9.9.vsix"
        self.vsix.write_text("x")

    def run_setup(self, *args, path=None):
        env = dict(os.environ, PATH=path if path is not None else f"{self.bin}:/usr/bin:/bin", HOME=str(self.tmp))
        return subprocess.run([sys.executable, str(SCRIPT), "--settings", str(self.settings), "--vsix", str(self.vsix), *args],
                              capture_output=True, text=True, env=env)

    def test_installs_extension_and_sets_model(self):
        r = self.run_setup("--model", "opus")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(f"--install-extension {self.vsix} --force", self.log.read_text())
        self.assertEqual(jsonc_load(self.settings.read_text())[KEY], "Claude Opus (claude-code)")
        self.assertTrue(self.settings.with_suffix(".json.bak").exists())

    def test_dry_run_changes_nothing(self):
        before = self.settings.read_text()
        r = self.run_setup("--dry-run")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("would set", r.stdout)
        self.assertEqual(self.settings.read_text(), before)
        self.assertNotIn("--install-extension", self.log.read_text() if self.log.exists() else "")

    def test_reports_missing_tools(self):
        (self.bin / "code").unlink()
        (self.bin / "claude").unlink()
        r = self.run_setup("--dry-run", path=str(self.bin))
        self.assertEqual(r.returncode, 1)
        self.assertIn("Install Claude Code", r.stdout)
        self.assertIn("`code` command", r.stdout)


if __name__ == "__main__":
    unittest.main()
