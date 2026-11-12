// Shared by the content Worker and the settings Worker: the private GitHub data repo (Contents API + GraphQL), nothing else.
export const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
const now = () => new Date().toISOString();

const utf8 = new TextEncoder();
export const unutf8 = new TextDecoder();
export function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
export function fromB64(b64) { const s = atob(b64.replace(/\s+/g, '')), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
export const textToB64 = (t) => toB64(utf8.encode(t));


// ---- GitHub ---------------------------------------------------------------------------------------------------------------
export function github(env) {
  const repo = String(env.GITHUB_REPO || '').trim(), branch = String(env.GITHUB_BRANCH || 'main').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !env.GITHUB_TOKEN) throw fail(500, 'github_not_configured');
  if (!/^[\w./-]+$/.test(branch)) throw fail(500, 'github_branch_invalid');
  const api = 'https://api.github.com';
  const H = (accept) => ({ Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: accept || 'application/vnd.github+json', 'User-Agent': 'discover-sharm-content-worker', 'X-GitHub-Api-Version': '2022-11-28' });
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const url = (p) => `${api}/repos/${repo}/contents/${enc(p)}`;
  const upstream = async (res, what) => { if (res.ok) return; const t = await res.text().catch(() => ''); throw fail(res.status === 401 || res.status === 403 ? 502 : res.status === 404 ? 404 : 502, `github_${what}_${res.status}`, { detail: t.slice(0, 200), upstream: res.status }); };

  return {
    /** → { sha, bytes } | null */
    async getFile(path) {
      const res = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers: H() });
      if (res.status === 404) return null;
      await upstream(res, 'get');
      const j = await res.json();
      if (j.encoding === 'base64' && j.content) return { sha: j.sha, bytes: fromB64(j.content) };
      const raw = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers: H('application/vnd.github.raw+json') });   // > 1 MB: the JSON form has no content
      await upstream(raw, 'raw');
      return { sha: j.sha, bytes: new Uint8Array(await raw.arrayBuffer()) };
    },
    async getJSON(path) { const f = await this.getFile(path); return f ? { sha: f.sha, json: JSON.parse(unutf8.decode(f.bytes)) } : null; },
    /** create or update; `sha` required when the file exists. Returns the new sha. 409/422 = somebody else changed it first. */
    async putFile(path, b64, sha, message) {
      const res = await fetch(url(path), { method: 'PUT', headers: { ...H(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: b64, branch, ...(sha ? { sha } : {}) }) });
      if (res.status === 409 || res.status === 422) throw fail(409, 'github_conflict');
      await upstream(res, 'put');
      return (await res.json()).content.sha;
    },
    async delFile(path, sha, message) {
      const res = await fetch(url(path), { method: 'DELETE', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha, branch }) });
      if (res.status === 404) return;
      if (res.status === 409 || res.status === 422) throw fail(409, 'github_conflict');
      await upstream(res, 'del');
    },
    /** file names in a folder (no content): [{ name, sha }] — [] when the folder does not exist yet */
    async listDir(path) {
      const res = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers: H() });
      if (res.status === 404) return [];
      await upstream(res, 'list');
      const j = await res.json();
      return Array.isArray(j) ? j.filter(f => f.type === 'file').map(f => ({ name: f.name, sha: f.sha })) : [];
    },
    /** many text files in ONE request (GraphQL) → { path: text | null }. Paths come from validated ids only. */
    async readMany(paths) {
      const out = {};
      for (let i = 0; i < paths.length; i += 80) {
        const chunk = paths.slice(i, i + 80);
        const q = `query{repository(owner:${JSON.stringify(repo.split('/')[0])},name:${JSON.stringify(repo.split('/')[1])}){${chunk.map((p, n) => `o${n}:object(expression:${JSON.stringify(branch + ':' + p)}){...on Blob{text isTruncated}}`).join('')}}}`;
        const res = await fetch(`${api}/graphql`, { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
        await upstream(res, 'graphql');
        const j = await res.json();
        const repoData = j.data && j.data.repository;
        if (!repoData) throw fail(502, 'github_graphql_failed', { detail: JSON.stringify(j.errors || j).slice(0, 200) });
        chunk.forEach((p, n) => { const o = repoData['o' + n]; out[p] = o && !o.isTruncated ? o.text : null; });
      }
      return out;
    },
    /** read-modify-write with retry when two staff members save at the same moment. fn(json|null) → json | undefined (= nothing to do) */
    async mutateJSON(path, fn, message) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const cur = await this.getJSON(path);
        const next = fn(cur ? cur.json : null);
        if (next === undefined) return cur ? cur.json : null;
        try { await this.putFile(path, textToB64(JSON.stringify(next, null, 1)), cur && cur.sha, message); return next; }
        catch (e) { if (e.message !== 'github_conflict' || attempt === 4) throw e; }
      }
    },
    async raw(path) {
      const res = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers: H('application/vnd.github.raw+json') });
      return res;
    },
  };
}

