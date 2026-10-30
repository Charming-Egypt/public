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

def canvas(w, h, logo_w=None, logo_h=None, cy=0.5, transparent=False):
    """the logo fitted into logo_w x logo_h, centred horizontally, centre at cy*h.
       transparent=False: on the solid splash colour, saved as opaque RGB (iOS launch images must be opaque).
       transparent=True : NO background at all, RGBA - for the manifest 'any' icons. Android draws its PWA splash from these on top of
                          manifest background_color, so a baked-in background shows up as a visible box."""
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0) if transparent else BG)
    k = min((logo_w or w) / src.width, (logo_h or h) / src.height)
    lg = src.resize((max(1, round(src.width * k)), max(1, round(src.height * k))), Image.LANCZOS)
    c.alpha_composite(lg, ((w - lg.width) // 2, round(h * cy - lg.height / 2)))
    return c if transparent else c.convert('RGB')

out = os.path.join(ROOT, 'shared/pwa')
os.makedirs(os.path.join(out, 'splash'), exist_ok=True)
# Two different pictures on purpose:
#   * HOME-SCREEN icon  = tools/pwa-src/app-icon.png  -> icon-maskable-*, apple-touch-icon, favicon (what the launcher draws)
#   * SPLASH / 'any'    = the full logo on the splash colour -> icon-192/512 (+ splash-logo.png, splash/*)
# (Android draws its splash from the manifest icons; launchers prefer the 'maskable' ones for the app icon.)
app = Image.open(os.path.join(ROOT, 'tools/pwa-src/app-icon.png')).convert('RGBA')
from PIL import ImageFilter
def app_icon(n, inner):
    """opaque square. inner=1: the artwork fills the square (its transparent rounded corners cropped away) - for iOS/favicon, which round it themselves.
       inner<1 (maskable): the artwork at `inner` of the side over a blurred copy of its own colours, so any mask shape (circle, squircle) works."""
    if inner >= 1:
        return app.crop((30, 30, 482, 482)).resize((n, n), Image.LANCZOS).convert('RGB')
    bg = app.crop((60, 60, 452, 452)).resize((n, n), Image.LANCZOS).filter(ImageFilter.GaussianBlur(n / 8))
    bg.putalpha(255)
    k = round(n * inner); ic = app.resize((k, k), Image.LANCZOS)
    bg.alpha_composite(ic, ((n - k) // 2, (n - k) // 2))
    return bg.convert('RGB')
for n in (192, 512):
    canvas(n, n, n * .88, n * .88, transparent=True).save(f'{out}/icon-{n}.png', optimize=True)   # transparent: the OS splash supplies the colour
    app_icon(n, .78).save(f'{out}/icon-maskable-{n}.png', optimize=True)   # 78%: inside the 80% safe circle for the text corners
app_icon(180, 1).save(f'{out}/apple-touch-icon.png', optimize=True)
app_icon(32, 1).save(f'{out}/favicon-32.png', optimize=True)
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
