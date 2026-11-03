/* Discover Sharm — admin / owner consoles: interface language.
 * The consoles are written in Arabic. For any other language this layer swaps every Arabic phrase for its translation
 * from /lang/admin-<code>.json (built from console/admin-lang/<code>.json) — in the page, in attributes, in toasts and in
 * confirm()/alert() dialogs — and flips the page direction (rtl <-> ltr). Phrases missing from a dictionary simply stay Arabic.
 * To add a language: add console/admin-lang/<code>.json ({ "عربي": "translation", … }) and one line in LANGS below, then rebuild.
 */
(function () {
'use strict';
const LANGS = { ar: { name: 'العربية', short: 'ع', dir: 'rtl' }, en: { name: 'English', short: 'EN', dir: 'ltr' } };
const KEY = 'ds_admin_lang';
let lang = 'en'; try { lang = localStorage.getItem(KEY) || 'en'; } catch (e) {}   // English is the main language of the consoles
if (!LANGS[lang]) lang = 'en';
window.DS_ALANG = lang;
if (lang !== 'ar') { document.documentElement.classList.add('dsl-wait'); setTimeout(() => document.documentElement.classList.remove('dsl-wait'), 2500); }   // no flash of Arabic before the dictionary is loaded
const de = document.documentElement;
de.lang = lang; de.dir = LANGS[lang].dir;

const AR = /[؀-ۿ]/;
let rx = null, dict = null;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function build(d) {
  dict = d;
  const keys = Object.keys(d).filter(k => d[k]).sort((a, b) => b.length - a.length);
  rx = keys.length ? new RegExp('(?<![\\u0600-\\u06FF])(?:' + keys.map(esc).join('|') + ')(?![\\u0600-\\u06FF])', 'g') : null;
}
const tx = s => (rx && typeof s === 'string' && AR.test(s)) ? s.replace(rx, m => dict[m] || m) : s;
window.DS_T = tx;

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-ph'];
function walk(root) {
  if (!rx || !root) return;
  if (root.nodeType === 3) { fixText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { fixAttrs(root); if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(root.tagName)) return; }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeType === 1 && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let n; while ((n = tw.nextNode())) { if (n.nodeType === 3) fixText(n); else fixAttrs(n); }
}
function fixText(n) { const v = n.nodeValue; if (v && AR.test(v)) { const t = tx(v); if (t !== v) n.nodeValue = t; } }
function fixAttrs(el) {
  for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && AR.test(v)) { const t = tx(v); if (t !== v) el.setAttribute(a, t); } }
  if (el.tagName === 'INPUT' && /^(button|submit)$/.test(el.type) && AR.test(el.value)) el.value = tx(el.value);
}

function switcher() {
  const wrap = document.createElement('div'); wrap.className = 'dslang';
  wrap.innerHTML = Object.entries(LANGS).map(([c, l]) => `<button type="button" data-l="${c}" class="${c === lang ? 'on' : ''}" title="${l.name}" aria-label="${l.name}">${l.short}</button>`).join('');
  wrap.onclick = e => { const b = e.target.closest('button'); if (b) setLang(b.dataset.l); };
  return wrap;
}
function setLang(c) { if (c === lang || !LANGS[c]) return; try { localStorage.setItem(KEY, c); } catch (er) {} location.reload(); }
// sidebar: the round button under "sign out" opens a small language menu; phones get a button in the top bar
function langMenu(btn) {
  let m = document.querySelector('.dsl-menu'); if (m) { m.remove(); return; }
  m = document.createElement('div'); m.className = 'dsl-menu';
  m.innerHTML = Object.entries(LANGS).map(([c, l]) => `<button type="button" data-l="${c}" class="${c === lang ? 'on' : ''}"><b>${l.short}</b>${l.name}</button>`).join('');
  m.onclick = e => { const b = e.target.closest('button'); if (b) setLang(b.dataset.l); };
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), rtl = de.dir === 'rtl';
  m.style.bottom = Math.max(8, innerHeight - r.bottom) + 'px';
  if (btn.closest('.sfoot')) { if (rtl) m.style.right = (innerWidth - r.left + 8) + 'px'; else m.style.left = (r.right + 8) + 'px'; }
  else { m.style.bottom = 'auto'; m.style.top = (r.bottom + 8) + 'px'; m.style[rtl ? 'left' : 'right'] = '12px'; }
  setTimeout(() => document.addEventListener('click', function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', h); } }), 0);
}
const GLOBE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/></svg>';
function mkBtn(cls) {
  const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.title = LANGS[lang].name; b.setAttribute('aria-label', 'Language');
  b.innerHTML = GLOBE + '<i>' + LANGS[lang].short + '</i>'; b.onclick = e => { e.stopPropagation(); langMenu(b); }; return b;
}
function ensureSwitchers() {
  const body = document.body; if (!body) return;
  const login = document.querySelector('#login:not(.hide) .lcard');
  if (login && !login.querySelector('.dslang')) login.prepend(switcher());
  const app = document.querySelector('#app:not(.hide)');
  if (app) {
    const sf = app.querySelector('.sfoot');
    if (sf && !sf.querySelector('.dsl-btn')) { const av = sf.querySelector('.av'); const b = mkBtn('dsl-btn'); if (av) av.replaceWith(b); else sf.appendChild(b); }
    const top = app.querySelector('header.top');
    if (top && !top.querySelector('.dsl-btn-m')) { const o = top.querySelector('#out2'); const b = mkBtn('ib mob dsl-btn-m'); o ? top.insertBefore(b, o) : top.appendChild(b); }
  }
  const f = body.querySelector('.dslang.float'); if (!login && !app && !f) { const s = switcher(); s.classList.add('float'); body.appendChild(s); } else if ((login || app) && f) f.remove();
}

const css = document.createElement('style');
css.textContent = `.dslang{display:inline-flex;gap:2px;padding:3px;border-radius:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);margin-bottom:14px}
.dslang button{border:0;background:transparent;color:#aab2d5;font:700 12px/1 Cairo,system-ui,sans-serif;padding:7px 11px;border-radius:9px;cursor:pointer}
.dslang button.on{background:#fbbf24;color:#111}.dslang button:hover:not(.on){color:#fff}
.sfoot .dsl-btn{position:relative;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--accent2,#8b5cf6),var(--accent,#6366f1));color:#fff;display:grid;place-items:center}
.sfoot .dsl-btn:hover{color:#fff;filter:brightness(1.1)}.dsl-btn i,.dsl-btn-m i{font:800 9px/1 system-ui,sans-serif;font-style:normal;position:absolute;bottom:5px;opacity:.95}.dsl-btn svg{margin-top:-6px}
.dsl-btn-m{position:relative}.dsl-btn-m svg{margin-top:-5px}
.dsl-menu{position:fixed;z-index:99999;min-width:170px;padding:6px;border-radius:14px;background:#171a2b;border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 40px rgba(0,0,0,.45)}
.dsl-menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;color:#cfd5f2;font:600 13px/1 Cairo,system-ui,sans-serif;padding:11px 12px;border-radius:10px;cursor:pointer;text-align:start}
.dsl-menu button b{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.08);font-size:11px}
.dsl-menu button:hover{background:rgba(255,255,255,.07)}.dsl-menu button.on{background:#fbbf24;color:#111}.dsl-menu button.on b{background:rgba(0,0,0,.12)}
html.dsl-wait body{visibility:hidden}
.dslang.float{position:fixed;top:10px;inset-inline-end:10px;z-index:99999;margin:0}`;
document.head.appendChild(css);

let queued = false;
function start() {
  ensureSwitchers();
  const mo = new MutationObserver(muts => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensureSwitchers();
      if (!rx) return;
      for (const m of muts) {
        if (m.type === 'characterData') fixText(m.target);
        else if (m.type === 'attributes') fixAttrs(m.target);
        else m.addedNodes.forEach(n => walk(n));
      }
    });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat('class') });
  if (lang !== 'ar') {
    fetch('/lang/admin-' + lang + '.json').then(r => r.json()).then(d => {
      build(d);
      const _c = window.confirm, _a = window.alert, _p = window.prompt;
      window.confirm = m => _c.call(window, tx(m));
      window.alert = m => _a.call(window, tx(m));
      window.prompt = (m, v) => _p.call(window, tx(m), v);
      document.title = tx(document.title);
      walk(document.body); document.documentElement.classList.remove('dsl-wait');
    }).catch(() => { document.documentElement.classList.remove('dsl-wait'); });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
