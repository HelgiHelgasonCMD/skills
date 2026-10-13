import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

try:
    from PIL import Image
    import make_showcase
except ImportError:  # Pillow is a docs-only dependency; CI runs without it.
    Image = None


@unittest.skipIf(Image is None, "Pillow not installed")
class GifTest(unittest.TestCase):
    def test_loops_through_every_frame_with_fades(self):
        names = ["a", "b", "c"]
        with tempfile.TemporaryDirectory() as d:
            for n, colour in zip(names, [(200, 0, 0), (0, 200, 0), (0, 0, 200)]):
                Image.new("RGB", (1760, 1280), colour).save(f"{d}/{n}.png")
            out = Path(d, "out.gif")
            make_showcase.gif(d, names, out)
            g = Image.open(out)
            self.assertEqual(g.size, (make_showcase.W, make_showcase.H))
            self.assertEqual(g.info.get("loop"), 0)
            # Pillow merges identical consecutive frames, so check the timeline, not the frame count.
            timeline, t = [], 0
            for i in range(g.n_frames):
                g.seek(i)
                timeline.append((t, g.convert("RGB").getpixel((10, 10))))
                t += g.info["duration"]
            fade = (make_showcase.FADE_STEPS - 1) * make_showcase.FADE_MS
            cycle = make_showcase.HOLD_MS + fade
            self.assertEqual(t, len(names) * cycle)

            def colour_at(ms):
                return [c for start, c in timeline if start <= ms][-1]

            for i, channel in enumerate(range(3)):
                self.assertGreater(colour_at(i * cycle + make_showcase.HOLD_MS // 2)[channel], 150)
            self.assertLess(max(colour_at(make_showcase.HOLD_MS + fade // 2)), 60)  # mid-fade is near background

if __name__ == "__main__":
    unittest.main()
