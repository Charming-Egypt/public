// Minimal SMTP client for Cloudflare Workers (TCP sockets). Used by the payments Worker when Resend is not configured or fails.
// Env: SMTP_HOST, SMTP_PORT (465 = implicit TLS [default], 587 = STARTTLS), SMTP_USER, SMTP_PASS, MAIL_FROM.
// Port 25 is blocked by Cloudflare — use 465 or 587.

const enc = new TextEncoder();
const dec = new TextDecoder();
const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64utf8 = (str) => b64(enc.encode(str));
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
export const addrOf = (s) => { const m = /<([^<>\s]+)>/.exec(String(s || '')); return clean(m ? m[1] : s); };

export function buildMessage({ from, to, subject, html }) {
  const id = `${crypto.randomUUID()}@${(addrOf(from).split('@')[1] || 'localhost')}`;
  return [
    `From: ${clean(from)}`, `To: ${clean(to)}`, `Subject: =?UTF-8?B?${b64utf8(clean(subject))}?=`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${id}>`, 'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    wrap76(b64utf8(String(html))),
  ].join('\r\n');
}

function session(socket) {
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let buf = '';
  const readReply = async () => {
    for (;;) {
      const lines = buf.split('\r\n');
      // a reply is complete when its last full line is "NNN <text>" (a space, not a dash) — the final element is the unfinished remainder
      if (lines.length > 1) {
        const last = lines[lines.length - 2];
        if (/^\d{3}( |$)/.test(last)) { const text = lines.slice(0, -1).join('\r\n'); buf = lines[lines.length - 1]; return { code: Number(last.slice(0, 3)), text }; }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP connection closed');
      buf += dec.decode(value, { stream: true });
    }
  };
  const send = (line) => writer.write(enc.encode(line + '\r\n'));
  const cmd = async (line, ok) => { await send(line); const r = await readReply(); if (!ok.includes(r.code)) throw new Error(`SMTP ${line.split(' ')[0]} failed: ${r.text.slice(0, 120)}`); return r; };
  const swap = (s) => { reader.releaseLock(); writer.releaseLock(); reader = s.readable.getReader(); writer = s.writable.getWriter(); };
  return { readReply, send, cmd, swap, close: async () => { try { await writer.close(); } catch {} try { reader.releaseLock(); } catch {} } };
}

export async function sendSmtp(env, { to, subject, html }, connectFn) {
  const host = clean(env.SMTP_HOST), user = env.SMTP_USER, pass = env.SMTP_PASS, from = env.MAIL_FROM || env.SMTP_USER;
  if (!host || !user || !pass || !from) throw new Error('SMTP is not configured');
  const port = Number(env.SMTP_PORT) || 465;
  const implicit = port === 465;
  const connect = connectFn || (await import('cloudflare:sockets')).connect;
  let socket = connect({ hostname: host, port }, { secureTransport: implicit ? 'on' : 'starttls', allowHalfOpen: false });
  const s = session(socket);
  const work = (async () => {
    const greet = await s.readReply(); if (greet.code !== 220) throw new Error('SMTP greeting: ' + greet.text.slice(0, 120));
    const ehlo = `EHLO ${addrOf(from).split('@')[1] || 'localhost'}`;
    await s.cmd(ehlo, [250]);
    if (!implicit) { await s.cmd('STARTTLS', [220]); socket = socket.startTls(); s.swap(socket); await s.cmd(ehlo, [250]); }
    await s.cmd('AUTH LOGIN', [334]);
    await s.cmd(b64utf8(user), [334]);
    await s.cmd(b64utf8(pass), [235]);
    await s.cmd(`MAIL FROM:<${addrOf(from)}>`, [250]);
    await s.cmd(`RCPT TO:<${addrOf(to)}>`, [250, 251]);
    await s.cmd('DATA', [354]);
    const body = buildMessage({ from, to, subject, html }).replace(/^\./gm, '..');   // dot-stuffing
    await s.send(body + '\r\n.');
    const done = await s.readReply(); if (done.code !== 250) throw new Error('SMTP DATA failed: ' + done.text.slice(0, 120));
    try { await s.send('QUIT'); } catch {}
    return true;
  })();
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('SMTP timeout')), 15000); });
  try { return await Promise.race([work, timeout]); }
  finally { clearTimeout(timer); await s.close(); try { socket.close(); } catch {} }
}
