"""Send real key presses to the X display (Xvfb in tests): xkeys.py ctrl+i "text:upper d" ctrl+Return"""
import sys
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

d = display.Display()


CHAR_NAMES = {
    " ": "space", "(": "parenleft", ")": "parenright", "?": "question", "!": "exclam", ".": "period",
    ",": "comma", ":": "colon", ";": "semicolon", "'": "apostrophe", '"': "quotedbl", "-": "minus",
    "_": "underscore", "/": "slash", "=": "equal", "+": "plus", "[": "bracketleft", "]": "bracketright",
    "{": "braceleft", "}": "braceright", "<": "less", ">": "greater", "*": "asterisk", "#": "numbersign",
    "@": "at", "&": "ampersand", "%": "percent", "$": "dollar", "`": "grave", "~": "asciitilde", "|": "bar",
    "\\": "backslash", "^": "asciicircum",
}


def keysym(name):
    sym = XK.string_to_keysym(CHAR_NAMES.get(name, name))
    if not sym:
        raise SystemExit(f"unknown key {name!r}")
    return sym


def keycode(name):
    return d.keysym_to_keycode(keysym(name))


def type_char(ch):
    sym = keysym(ch)
    code = d.keysym_to_keycode(sym)
    # Symbols like "(" live on a shifted key: press Shift when the unshifted keysym differs.
    if d.keycode_to_keysym(code, 0) != sym:
        press("Shift_L", ch)
    else:
        press(ch)


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
            press("Shift_L", ch.lower()) if ch.isupper() else type_char(ch)
    else:
        press(*[{"ctrl": "Control_L", "shift": "Shift_L", "alt": "Alt_L"}.get(p, p) for p in arg.split("+")])
