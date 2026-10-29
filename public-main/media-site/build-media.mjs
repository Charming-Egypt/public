// Discover Sharm — build script of the MEDIA Cloudflare Pages project (media.discover-sharm.com).
//
// Put this file in the ROOT of the private GitHub data repo (the one the content Worker writes to). Cloudflare Pages runs it on every push that touches a photo:
//   Build command:           node build-media.mjs
//   Build output directory:  out
//   Build watch paths:       include  api/*/img/*   (so item/settings edits do not use up the 500 builds a month of the free plan)
//
// It copies every photo from  api/<category>/img/<16 hex>.<jpg|png|webp>  to  out/img/<category>/<file>  and writes out/img/manifest.json, the list of photos this
// deployment really contains. The content Worker reads that list and only points the catalog at media.discover-sharm.com for photos listed there (the rest keep
// loading through the Worker, so a photo is never broken while a build is running or if the monthly build allowance is used up).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || process.cwd(), OUT = path.join(ROOT, process.argv[3] || 'out');
const DIRS = ['hotels', 'excursions', 'transfers', 'restaurants', 'journal', 'destinations'];
const NAME = /^[a-f0-9]{16}\.(?:jpg|png|webp)$/;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });

const manifest = [];
for (const dir of DIRS) {
  const src = path.join(ROOT, 'api', dir, 'img');
  if (!fs.existsSync(src)) continue;
  for (const name of fs.readdirSync(src).sort()) {
    if (!NAME.test(name)) continue;
    fs.mkdirSync(path.join(OUT, 'img', dir), { recursive: true });
    fs.copyFileSync(path.join(src, name), path.join(OUT, 'img', dir, name));
    manifest.push(`${dir}/${name}`);
  }
}
fs.writeFileSync(path.join(OUT, 'img', 'manifest.json'), JSON.stringify(manifest));
// (a header that appears in two matching rules is merged by Pages, so photos and the manifest use rules that cannot overlap: /img/:dir/:file is exactly two segments)
fs.writeFileSync(path.join(OUT, '_headers'), [
  '/img/:dir/:file',
  '  Cache-Control: public, max-age=31536000, immutable',
  '  Access-Control-Allow-Origin: *',
  '  Cross-Origin-Resource-Policy: cross-origin',
  '  X-Content-Type-Options: nosniff',
  '/img/manifest.json',
  '  Cache-Control: no-cache',
  '  Access-Control-Allow-Origin: *',
  '',
].join('\n'));
fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Discover Sharm media</title>\n');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /catalog\n');
console.log(`media: ${manifest.length} photos → ${path.relative(process.cwd(), OUT) || OUT}`);
if (manifest.length > 18000) console.warn('⚠ close to the 20,000-files-per-site limit of the free Pages plan');
