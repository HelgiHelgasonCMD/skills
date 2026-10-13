import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "inline-comments" / "scripts" / "find_markers.py"
sys.path.insert(0, str(SCRIPT.parent))

import find_markers as fm  # noqa: E402

M = "@" + "claude"  # keep this file free of literal markers


def src(s):
    return textwrap.dedent(s).lstrip("\n").replace("@C", M)


def markers(text, ext="py"):
    return fm.find_markers_in_text(text, fm.lang_for(f"x.{ext}"))


class MarkerTest(unittest.TestCase):
    def test_standalone_line_marker_deletes_whole_line(self):
        text = src("""
            def f():
                # @C make this async
                return 1
            """)
        [m] = markers(text)
        self.assertEqual((m.kind, m.instruction, m.line), ("edit", "make this async", 2))
        out = fm.apply_removal(text, m)
        self.assertEqual(out, "def f():\n    return 1\n")
        compile(out, "x.py", "exec")

    def test_trailing_marker_keeps_code(self):
        text = src("""
            const x = load(); // @C cache this
            const y = 2;
            """)
        [m] = markers(text, "ts")
        self.assertEqual(m.removal["type"], "span")
        self.assertEqual(fm.apply_removal(text, m), "const x = load();\nconst y = 2;\n")

    def test_multiline_block_marker(self):
        text = src("""
            int a;
            /* @C split this into
               two functions */
            int b;
            """)
        [m] = markers(text, "c")
        self.assertEqual(m.instruction, "split this into two functions")
        self.assertEqual(fm.apply_removal(text, m), "int a;\nint b;\n")

    def test_inline_block_marker_keeps_code(self):
        text = "call(a /* @C rename a */, b);\n".replace("@C", M)
        [m] = markers(text, "c")
        self.assertEqual(fm.apply_removal(text, m), "call(a, b);\n")

    def test_marker_line_inside_doc_comment(self):
        text = src("""
            /**
             * Adds numbers.
             * @C handle overflow
             */
            function add(a, b) { return a + b; }
            """)
        [m] = markers(text, "js")
        self.assertEqual(m.instruction, "handle overflow")
        self.assertEqual(fm.apply_removal(text, m),
                         "/**\n * Adds numbers.\n */\nfunction add(a, b) { return a + b; }\n")

    def test_html_comment(self):
        text = "<p>hi</p>\n<!-- @C add aria label -->\n".replace("@C", M)
        [m] = markers(text, "html")
        self.assertEqual(fm.apply_removal(text, m), "<p>hi</p>\n")

    def test_strings_and_templates_are_ignored(self):
        cases = {
            "py": 's = "# @C nope"\nt = """\n# @C nope\n"""\n',
            "js": "const a = '// @C nope';\nconst b = `\n// @C nope ${x}\n`;\n",
            "go": "s := `// @C nope`\n",
            "sh": 'echo "# @C nope"\nn=${#arr}\n',
        }
        for ext, text in cases.items():
            with self.subTest(ext=ext):
                self.assertEqual(markers(text.replace("@C", M), ext), [])

    def test_rust_lifetime_does_not_hide_comment(self):
        text = "fn f<'a>(x: &'a str) {} // @C doc this\n".replace("@C", M)
        self.assertEqual(len(markers(text, "rs")), 1)

    def test_prose_mentioning_marker_is_not_a_marker(self):
        self.assertEqual(markers(src("# leave @C notes for review\n")), [])
        self.assertEqual(markers(src("# @Cfoo is not a marker\n")), [])

    def test_unknown_file_types_are_not_scanned(self):
        self.assertIsNone(fm.lang_for("README.md"))
        self.assertIsNone(fm.lang_for("notes.txt"))

    def test_multiple_markers_in_one_file(self):
        text = src("""
            a = 1  # @C rename
            # @C? why is this 2
            b = 2
            # @C add docstring
            """)
        ms = markers(text)
        self.assertEqual([(m.line, m.kind) for m in ms], [(1, "edit"), (2, "question"), (4, "edit")])
        # Removing bottom-up keeps earlier line numbers valid.
        out = text
        for m in reversed([m for m in ms if m.kind == "edit"]):
            out = fm.apply_removal(out, m)
        self.assertEqual(out, src("a = 1\n# @C? why is this 2\nb = 2\n"))

    def test_question_is_read_only(self):
        [m] = markers(src("# @C? is this thread safe\n"))
        self.assertEqual((m.kind, m.instruction, m.removal), ("question", "is this thread safe", {}))

    def test_empty_instruction_needs_clarification(self):
        [m] = markers(src("x = 1  # @C\n"))
        self.assertTrue(m.needs_clarification)


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo)
        git = ["git", "-C", str(self.repo)]
        subprocess.run(git + ["init", "-q"], check=True)
        (self.repo / ".gitignore").write_text("ignored.py\n")
        (self.repo / "tracked.py").write_text(f"# {M} tracked\n")
        subprocess.run(git + ["add", "."], check=True)
        (self.repo / "untracked.py").write_text(f"# {M} untracked\n")
        (self.repo / "ignored.py").write_text(f"# {M} ignored\n")
        (self.repo / "demo.py").write_text(f"# {fm.SKIP_PRAGMA}\n# {M} demo\n")
        (self.repo / "notes.md").write_text(f"# {M} markdown\n")

    def run_cli(self, *args):
        out = subprocess.run([sys.executable, str(SCRIPT), "--json", *args], cwd=self.repo,
                             capture_output=True, text=True, check=True).stdout
        return sorted(json.loads(l)["instruction"] for l in out.splitlines())

    def test_default_scan_respects_gitignore_and_skip_pragma(self):
        self.assertEqual(self.run_cli(), ["tracked", "untracked"])

    def test_explicit_paths_scanned_even_if_ignored_or_pragma(self):
        self.assertEqual(self.run_cli("ignored.py", "demo.py"), ["demo", "ignored"])

    def test_same_file_twice_reported_once(self):
        self.assertEqual(self.run_cli("tracked.py", "./tracked.py"), ["tracked"])

    def test_outside_git_walks_directory(self):
        shutil.rmtree(self.repo / ".git")
        self.assertIn("ignored", self.run_cli())


if __name__ == "__main__":
    unittest.main()
