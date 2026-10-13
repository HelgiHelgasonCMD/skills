import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import scan_sensitive  # noqa: E402
import validate  # noqa: E402

GOOD_DESC = "Does a thing. Use when the user asks for the thing."


def make_skill(root, dirname, frontmatter=None, body="# Body\n", extra=None):
    d = Path(root) / dirname
    d.mkdir(parents=True)
    fm = frontmatter if frontmatter is not None else f"---\nname: {dirname}\ndescription: {GOOD_DESC}\n---\n"
    (d / "SKILL.md").write_text(fm + body)
    for rel, content in (extra or {}).items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_text(content)
    return d


class ValidateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def errors(self, *args, **kw):
        return validate.validate_skill(make_skill(self.tmp, *args, **kw))

    def test_good_skill_passes(self):
        self.assertEqual(self.errors("good-skill", body="See [ref](references/a.md).\n",
                                     extra={"references/a.md": "x"}), [])

    def test_block_scalar_description(self):
        fm = "---\nname: folded\ndescription: >\n  Does a thing.\n  Use when asked.\n---\n"
        self.assertEqual(self.errors("folded", frontmatter=fm), [])

    def test_missing_frontmatter(self):
        self.assertIn("missing frontmatter", self.errors("nofm", frontmatter="")[0])

    def test_name_mismatch(self):
        fm = f"---\nname: other\ndescription: {GOOD_DESC}\n---\n"
        self.assertIn("does not match", self.errors("mine", frontmatter=fm)[0])

    def test_name_not_kebab(self):
        fm = f"---\nname: Bad_Name\ndescription: {GOOD_DESC}\n---\n"
        self.assertIn("kebab-case", self.errors("Bad_Name", frontmatter=fm)[0])

    def test_description_missing(self):
        self.assertIn("missing `description`", self.errors("nodesc", frontmatter="---\nname: nodesc\n---\n")[0])

    def test_description_too_long(self):
        fm = f"---\nname: long\ndescription: Use when {'x' * 1100}\n---\n"
        self.assertIn("chars", self.errors("long", frontmatter=fm)[0])

    def test_description_without_trigger(self):
        fm = "---\nname: vague\ndescription: Helps with things.\n---\n"
        self.assertIn("says what, not when", self.errors("vague", frontmatter=fm)[0])

    def test_too_many_lines(self):
        self.assertIn("lines", self.errors("big", body="x\n" * 600)[0])

    def test_broken_link(self):
        self.assertIn("broken link", self.errors("links", body="[a](references/missing.md)\n")[0])

    def test_local_overlay_link_may_be_missing(self):
        self.assertEqual(self.errors("overlay", body="[env](references/env.local.md)\n"), [])

    def test_empty_skills_dir_passes(self):
        self.assertEqual(validate.main(["validate", self.tmp]), 0)


class ScanTest(unittest.TestCase):
    def hits(self, text, terms=()):
        return [m for _, m in scan_sensitive.scan_text(text, list(terms))]

    def test_guid(self):
        self.assertTrue(self.hits("tenant " + "1234abcd" + "-1234-1234-1234-1234567890ab"))

    def test_null_guid_allowed(self):
        self.assertEqual(self.hits(scan_sensitive.NULL_GUID), [])

    def test_email(self):
        self.assertTrue(self.hits("ping " + "someone" + "@corp.io"))

    def test_allowed_emails(self):
        self.assertEqual(self.hits("a" + "@example.com 1+u" + "@users.noreply.github.com"), [])

    def test_ado_org(self):
        self.assertTrue(self.hits("https://dev.azure.com/" + "acme/proj"))
        self.assertEqual(self.hits("https://dev.azure.com/<org>/<project>"), [])

    def test_denylisted_term_case_insensitive(self):
        self.assertTrue(self.hits("Works at AcmeCorp", ["acmecorp"]))

    def test_clean_text(self):
        self.assertEqual(self.hits("nothing to see", ["acmecorp"]), [])

    def test_main_skips_local_overlays(self):
        with tempfile.TemporaryDirectory() as d:
            terms = Path(d, "terms")
            terms.write_text("# comment\nacmecorp\n")
            overlay = Path(d, "env.local.md")
            overlay.write_text("acmecorp tenant\n")
            public = Path(d, "SKILL.md")
            public.write_text("generic\n")
            self.assertEqual(scan_sensitive.main(["--terms", str(terms), str(overlay), str(public)]), 0)
            public.write_text("acmecorp\n")
            self.assertEqual(scan_sensitive.main(["--terms", str(terms), str(public)]), 1)


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo = self.tmp / "repo"
        (self.repo / "tools").mkdir(parents=True)
        shutil.copy(ROOT / "tools" / "install.sh", self.repo / "tools")
        make_skill(self.repo / "skills", "alpha")
        self.dest = self.tmp / "dest"
        self.dest.mkdir()

    def run_install(self):
        env = dict(os.environ, CLAUDE_SKILLS_DIR=str(self.dest))
        return subprocess.run(["bash", str(self.repo / "tools" / "install.sh")],
                              env=env, capture_output=True, text=True)

    def test_links_and_is_idempotent(self):
        r = self.run_install()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.dest / "alpha").is_symlink())
        r = self.run_install()
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_never_clobbers_foreign_entries(self):
        (self.dest / "alpha").mkdir()
        (self.dest / "alpha" / "SKILL.md").write_text("mine")
        r = self.run_install()
        self.assertEqual(r.returncode, 1)
        self.assertEqual((self.dest / "alpha" / "SKILL.md").read_text(), "mine")

    def test_prunes_own_dangling_links_only(self):
        self.run_install()
        shutil.rmtree(self.repo / "skills" / "alpha")
        (self.dest / "foreign").symlink_to(self.tmp / "nowhere")
        self.run_install()
        self.assertFalse((self.dest / "alpha").is_symlink())
        self.assertTrue((self.dest / "foreign").is_symlink())


if __name__ == "__main__":
    unittest.main()
