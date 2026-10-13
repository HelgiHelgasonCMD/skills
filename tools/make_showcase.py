#!/usr/bin/env python3
"""Render docs/<skill>/design/*.dc.html to PNG with headless Chromium and stitch them into a GIF.

Needs Pillow (`pip install pillow` in a venv) and a Chromium: $CHROME, or Playwright's
headless shell from ~/.cache/ms-playwright.
Usage: make_showcase.py docs/inline-comments Main Review Summary
"""
import glob
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

W, H = 880, 640
# GIF delays are stored in 10 ms units, so keep these multiples of 10.
HOLD_MS, FADE_STEPS, FADE_MS = 3200, 8, 50
BG = (16, 18, 22)


def chrome():
    found = os.environ.get("CHROME") or next(iter(sorted(glob.glob(os.path.expanduser(
        "~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell")), reverse=True)), None)
    if not found:
        sys.exit("no Chromium: set CHROME or install Playwright's headless shell")
    return found


def render(design_dir, names, out_dir):
    for n in names:
        subprocess.run([chrome(), "--headless", "--disable-gpu", "--hide-scrollbars",
                        "--force-device-scale-factor=2", f"--window-size={W},{H}",
                        "--virtual-time-budget=4000", f"--screenshot={out_dir}/{n}.png",
                        (design_dir / f"{n}.dc.html").resolve().as_uri()],
                       check=True, capture_output=True)


def gif(png_dir, names, out):
    frames = [Image.open(f"{png_dir}/{n}.png").convert("RGB").resize((W, H), Image.LANCZOS) for n in names]
    # One palette for every frame keeps colours stable instead of flickering between frames.
    # The background and half-faded frames are in it too, so fades don't snap to frame colours.
    bg = Image.new("RGB", (W, H), BG)
    tiles = frames + [bg] + [Image.blend(f, bg, 0.5) for f in frames]
    sheet = Image.new("RGB", (W, H * len(tiles)))
    for i, f in enumerate(tiles):
        sheet.paste(f, (0, i * H))
    palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)

    seq, durations = [], []
    half = FADE_STEPS // 2
    for i, f in enumerate(frames):
        nxt = frames[(i + 1) % len(frames)]
        seq.append(f); durations.append(HOLD_MS)
        # Fade through the background rather than crossfading, so two screens of text never overlap.
        for k in range(1, half + 1):
            seq.append(Image.blend(f, bg, k / half)); durations.append(FADE_MS)
        for k in range(1, half):
            seq.append(Image.blend(bg, nxt, k / half)); durations.append(FADE_MS)

    q = [s.quantize(palette=palette, dither=Image.Dither.NONE) for s in seq]
    q[0].save(out, save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)


def main(argv):
    docs, names = Path(argv[1]), argv[2:]
    with tempfile.TemporaryDirectory() as tmp:
        render(docs / "design", names, tmp)
        gif(tmp, names, docs / "walkthrough.gif")
    print(docs / "walkthrough.gif")


if __name__ == "__main__":
    main(sys.argv)
