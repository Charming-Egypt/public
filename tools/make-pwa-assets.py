#!/usr/bin/env python3
"""Regenerates every PWA / splash image from ONE source logo (tools/pwa-src/logo.png, transparent PNG).
   python3 tools/make-pwa-assets.py      (needs Pillow)
Writes into shared/pwa/: icons (any + maskable), apple-touch-icon, splash-logo.png (the in-page splash) and splash/*.png (iOS launch screens).
The background colour MUST match SPLASH_BG in tools/build.mjs (manifest background_color, theme-color and the in-page splash all use it)."""
from PIL import Image
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = (13, 13, 15, 255)  # #0d0d0f  == SPLASH_BG
src = Image.open(os.path.join(ROOT, 'tools/pwa-src/logo.png')).convert('RGBA')
src = src.crop(src.split()[3].point(lambda a: 255 if a > 8 else 0).getbbox())   # trim empty margin

def canvas(w, h, logo_w=None, logo_h=None, cy=0.5):
    """solid background + the logo fitted into logo_w x logo_h, centred horizontally, centre at cy*h"""
    c = Image.new('RGBA', (w, h), BG)
    k = min((logo_w or w) / src.width, (logo_h or h) / src.height)
    lg = src.resize((max(1, round(src.width * k)), max(1, round(src.height * k))), Image.LANCZOS)
    c.alpha_composite(lg, ((w - lg.width) // 2, round(h * cy - lg.height / 2)))
    return c.convert('RGB')

out = os.path.join(ROOT, 'shared/pwa')
os.makedirs(os.path.join(out, 'splash'), exist_ok=True)
for n in (192, 512):
    canvas(n, n, n * .88, n * .88).save(f'{out}/icon-{n}.png', optimize=True)
    # maskable: the OS may crop to a circle of 80% diameter -> the whole logo must sit inside it (a square of 0.56 has its corners on that circle)
    canvas(n, n, n * .56, n * .56).save(f'{out}/icon-maskable-{n}.png', optimize=True)
canvas(180, 180, 180 * .88, 180 * .88).save(f'{out}/apple-touch-icon.png', optimize=True)
canvas(32, 32, 32, 32).save(f'{out}/favicon-32.png', optimize=True)
# in-page splash: transparent, the page supplies the background
k = 480 / src.width
src.resize((480, round(src.height * k)), Image.LANCZOS).save(f'{out}/splash-logo.png', optimize=True)

# iOS launch screens (apple-touch-startup-image). (css width, css height, pixel ratio) — keep in sync with IOS_SPLASH in tools/build.mjs
IOS = [(430,932,3),(393,852,3),(428,926,3),(390,844,3),(375,812,3),(414,896,3),(414,896,2),(414,736,3),(375,667,2),(320,568,2),
       (402,874,3),(440,956,3),(834,1194,2),(820,1180,2),(1024,1366,2),(810,1080,2),(744,1133,2)]
for w, h, r in IOS:
    W, H = w * r, h * r
    # same spot as the in-page splash: centred, a touch above the middle; ~62% of the screen width (phones) / 40% (tablets)
    frac = .62 if w < 600 else .40
    canvas(W, H, W * frac, H * .5, cy=.46).save(f'{out}/splash/{W}x{H}.png', optimize=True)
print('done')
