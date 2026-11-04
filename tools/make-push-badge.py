#!/usr/bin/env python3
"""Regenerates shared/pwa/badge.png - the small notification icon (Android status bar + the round icon in the notification header).
   python3 tools/make-push-badge.py      (needs Pillow + numpy)
Android only uses the ALPHA channel of this image and paints it white/tinted, so it must be a one-colour silhouette on transparent.
Source: tools/pwa-src/logo-orange.png (the full colour logo on transparent). The WHOLE logo is used:
bright artwork -> opaque white, dark outlines -> holes."""
from PIL import Image
import numpy as np, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, 'tools/pwa-src/logo-orange.png')).convert('RGBA')
S = src.width / 3464.0                       # crop box measured on the 3464 px master
box = tuple(round(v * S) for v in (500, 860, 2840, 2655))
a = np.array(src).astype(float); v = a[..., :3].max(axis=2); al = a[..., 3] / 255
t = np.clip((v - 70) / 80, 0, 1); lum = t * t * (3 - 2 * t) * al
m = Image.fromarray((lum * 255).astype('uint8'), 'L').crop(box)
m = m.crop(m.point(lambda p: 255 if p > 30 else 0).getbbox())
size, pad = 96, 2
k = (size - 2 * pad) / max(m.size)
m = m.resize((round(m.width * k), round(m.height * k)), Image.LANCZOS)
o = Image.new('L', (size, size), 0); o.paste(m, ((size - m.width) // 2, (size - m.height) // 2))
out = Image.new('RGBA', (size, size), (255, 255, 255, 0)); out.putalpha(o)
out.save(os.path.join(ROOT, 'shared/pwa/badge.png'), optimize=True)
print('badge.png written')
