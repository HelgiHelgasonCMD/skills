"""Send real key presses to the X display (Xvfb in tests): xkeys.py ctrl+i "text:upper d" ctrl+Return"""
import sys
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

d = display.Display()


def keycode(name):
    sym = XK.string_to_keysym({" ": "space"}.get(name, name))
    if not sym:
        raise SystemExit(f"unknown key {name!r}")
    return d.keysym_to_keycode(sym)


def press(*names):
    codes = [keycode(n) for n in names]
    for c in codes:
        xtest.fake_input(d, X.KeyPress, c)
    for c in reversed(codes):
        xtest.fake_input(d, X.KeyRelease, c)
    d.sync()
    time.sleep(0.03)


for arg in sys.argv[1:]:
    if arg.startswith("text:"):
        for ch in arg[5:]:
            press("Shift_L", ch.lower()) if ch.isupper() else press(ch)
    else:
        press(*[{"ctrl": "Control_L", "shift": "Shift_L", "alt": "Alt_L"}.get(p, p) for p in arg.split("+")])
