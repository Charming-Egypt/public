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
let lang = 'ar'; try { lang = localStorage.getItem(KEY) || 'ar'; } catch (e) {}
if (!LANGS[lang]) lang = 'ar';
window.DS_ALANG = lang;
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
  wrap.onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.l === lang) return; try { localStorage.setItem(KEY, b.dataset.l); } catch (er) {} location.reload(); };
  return wrap;
}
function ensureSwitchers() {
  const body = document.body; if (!body) return;
  const host = document.querySelector('#login .lcard') || document.querySelector('.sfoot');
  const where = document.querySelector('#login:not(.hide) .lcard') || document.querySelector('#app:not(.hide) .sfoot');
  if (where && !where.querySelector('.dslang')) where.prepend(switcher());
  if (!where && !host && !body.querySelector('.dslang')) { const s = switcher(); s.classList.add('float'); body.appendChild(s); }
  else if (!host) { /* nothing */ }
  if (where) { const f = body.querySelector('.dslang.float'); if (f) f.remove(); }
}

const css = document.createElement('style');
css.textContent = `.dslang{display:inline-flex;gap:2px;padding:3px;border-radius:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);margin-bottom:14px}
.dslang button{border:0;background:transparent;color:#aab2d5;font:700 12px/1 Cairo,system-ui,sans-serif;padding:7px 11px;border-radius:9px;cursor:pointer}
.dslang button.on{background:#fbbf24;color:#111}.dslang button:hover:not(.on){color:#fff}
.sfoot .dslang{flex-direction:column;margin:0 0 10px;padding:2px}.sfoot .dslang button{padding:6px 7px;font-size:11px}
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
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (lang !== 'ar') {
    fetch('/lang/admin-' + lang + '.json').then(r => r.json()).then(d => {
      build(d);
      const _c = window.confirm, _a = window.alert, _p = window.prompt;
      window.confirm = m => _c.call(window, tx(m));
      window.alert = m => _a.call(window, tx(m));
      window.prompt = (m, v) => _p.call(window, tx(m), v);
      document.title = tx(document.title);
      walk(document.body);
    }).catch(() => {});
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
