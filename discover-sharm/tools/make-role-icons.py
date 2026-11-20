#!/usr/bin/env python3
"""Role icons for the three console PWAs (admin / owner / seller).
Same Discover Sharm logo + navy base as the main app icon, plus a coloured role ring and a role pill, so the home screen tells them apart at a glance.
Usage:  python3 -I tools/make-role-icons.py      (reads shared/pwa/icon-512.png, writes shared/pwa-<role>/)"""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = Image.open(os.path.join(ROOT, 'shared/pwa/icon-512.png')).convert('RGB')
BG = SRC.getpixel((3, 3))
LOGO = SRC.crop((51, 99, 460, 413))                     # the logo artwork only (flat background around it)
FONT = '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf'
ROLES = {'admin': ('ADMIN', (124, 58, 237), (167, 139, 250)), 'owner': ('OWNER', (13, 148, 136), (45, 212, 191)), 'seller': ('SELLER', (22, 163, 74), (74, 222, 128))}
S = 4                                                    # supersample

def make(role, maskable):
    label, c1, c2 = ROLES[role]; N = 512 * S
    im = Image.new('RGB', (N, N), BG); d = ImageDraw.Draw(im)
    k = 0.8 if maskable else 1.0                         # maskable: everything inside the 80 % safe zone
    def X(v): return int((256 + (v - 256) * k) * S)
    if not maskable:                                     # coloured ring just inside the edge
        d.rounded_rectangle((10 * S, 10 * S, N - 10 * S, N - 10 * S), radius=110 * S, outline=c1, width=12 * S)
    lw = int(LOGO.width * 0.86 * k * S); lh = int(LOGO.height * 0.86 * k * S)
    logo = LOGO.resize((lw, lh), Image.LANCZOS); im.paste(logo, ((N - lw) // 2, X(64)))
    # role pill
    pw, ph = int(330 * k * S), int(88 * k * S); px, py = (N - pw) // 2, X(368)
    pill = Image.new('RGB', (pw, ph)); pd = ImageDraw.Draw(pill)
    for y in range(ph):
        t = y / ph; pd.line((0, y, pw, y), fill=tuple(int(c1[i] + (c2[i] - c1[i]) * (1 - t) * .55) for i in range(3)))
    mask = Image.new('L', (pw, ph), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw - 1, ph - 1), radius=ph // 2, fill=255)
    im.paste(pill, (px, py), mask)
    f = ImageFont.truetype(FONT, int(54 * k * S)); tw = d.textlength(label, font=f)
    d.text((px + (pw - tw) / 2, py + ph / 2 + 2 * S), label, font=f, fill='white', anchor='lm')
    return im.resize((512, 512), Image.LANCZOS)

for role in ROLES:
    out = os.path.join(ROOT, 'shared', 'pwa-' + role); os.makedirs(out, exist_ok=True)
    a, m = make(role, False), make(role, True)
    a.save(f'{out}/icon-512.png'); a.resize((192, 192), Image.LANCZOS).save(f'{out}/icon-192.png')
    m.save(f'{out}/icon-maskable-512.png'); m.resize((192, 192), Image.LANCZOS).save(f'{out}/icon-maskable-192.png')
    a.resize((180, 180), Image.LANCZOS).save(f'{out}/apple-touch-icon.png'); a.resize((32, 32), Image.LANCZOS).save(f'{out}/favicon-32.png')
    a.save(f'{out}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('ok')
