#!/usr/bin/env python3
"""Draw the Predict app icons into app/icons/.

A paper-coloured serif P and a seal-red full stop on ink: the full stop is the moment you commit.
Needs Pillow and a bold serif font (DejaVu Serif Bold by default; set PREDICT_ICON_FONT to use another).
The PNGs are committed, so you only run this to change the design:  python3 tools/make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

INK, PAPER, SEAL = (28, 26, 23), (244, 240, 232), (179, 64, 42)
FONT = os.environ.get("PREDICT_ICON_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "icons")


def draw(size, cap_height, name):
    """Square, full-bleed, no transparency (iOS and maskable icons need that).
    cap_height is the height of the P as a fraction of the canvas."""
    s = size * 4  # draw large, then shrink for smooth edges
    img = Image.new("RGB", (s, s), INK)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 100)
    left, top, right, bottom = f.getbbox("P")
    f = ImageFont.truetype(FONT, max(8, int(100 * cap_height * s / (bottom - top))))
    left, top, right, bottom = f.getbbox("P")
    w, h = right - left, bottom - top
    r = 0.055 * s          # radius of the full stop
    gap = 0.04 * s         # space between the P and the full stop
    x0 = (s - (w + gap + 2 * r)) / 2
    y0 = (s - h) / 2
    d.text((x0 - left, y0 - top), "P", font=f, fill=PAPER)
    cx, cy = x0 + w + gap + r, y0 + h - r      # the full stop sits on the baseline
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SEAL)
    img = img.resize((size, size), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, name), optimize=True)
    print("wrote", name, img.size)


if __name__ == "__main__":
    draw(192, 0.50, "icon-192.png")
    draw(512, 0.50, "icon-512.png")
    draw(512, 0.38, "maskable-512.png")       # smaller mark: stays inside the maskable safe zone
    draw(180, 0.50, "apple-touch-icon.png")
