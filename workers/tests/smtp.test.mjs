import net from 'node:net';
import { Readable, Writable } from 'node:stream';
import { sendSmtp, buildMessage, addrOf } from '../lib/smtp.js';
let pass = 0, fail = 0; const ok = (n, c, d) => { c ? pass++ : (fail++, console.log('FAIL', n, d || '')); console.log((c ? 'PASS ' : 'FAIL ') + n); };

function fakeServer({ authOk = true, rcptCode = 250 } = {}) {
  const log = []; let data = '';
  const srv = net.createServer((sock) => {
    let inData = false, buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (c) => {
      buf += c.toString();
      let i; while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else data += line + '\n'; continue; }
        log.push(line);
        if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (log[log.length - 2] === 'AUTH LOGIN') sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (log[log.length - 3] === 'AUTH LOGIN') sock.write(authOk ? '235 ok\r\n' : '535 bad\r\n');
        else if (line.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
        else if (line.startsWith('RCPT TO')) sock.write(rcptCode + ' rcpt\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, log, getData: () => data, port: srv.address().port })));
}
const connectTo = (port) => () => { const sock = net.connect(port, '127.0.0.1'); return { readable: Readable.toWeb(sock), writable: Writable.toWeb(sock), close() { sock.destroy(); }, startTls() { return this; } }; };
const env = { SMTP_HOST: 'x', SMTP_PORT: '465', SMTP_USER: 'u@d.com', SMTP_PASS: 'p', MAIL_FROM: 'Discover Sharm <bookings@d.com>' };

ok('addrOf', addrOf('A B <a@b.com>') === 'a@b.com' && addrOf('a@b.com') === 'a@b.com');
ok('header injection stripped', !/\r\nBcc:/.test(buildMessage({ from: 'a@b.c', to: 'x@y.z', subject: 'hi\r\nBcc: evil@x.com', html: '<p>' })));

let f = await fakeServer();
const html = '<p>مرحبا\n.dot line</p>';
ok('send ok (implicit TLS path)', await sendSmtp(env, { to: 'cust@x.com', subject: 'تأكيد', html }, connectTo(f.port)) === true);
ok('MAIL FROM / RCPT TO correct', f.log.includes('MAIL FROM:<bookings@d.com>') && f.log.includes('RCPT TO:<cust@x.com>'));
ok('credentials sent base64', f.log.includes(Buffer.from('u@d.com').toString('base64')) && f.log.includes(Buffer.from('p').toString('base64')));
const body = f.getData(); const b64body = body.split('\n\n')[1].replace(/\n/g, '');
ok('body round-trips (UTF-8, base64)', Buffer.from(b64body, 'base64').toString('utf8') === html);
f.srv.close();

f = await fakeServer({ authOk: false });
let err; try { await sendSmtp(env, { to: 'c@x.com', subject: 's', html: 'h' }, connectTo(f.port)); } catch (e) { err = e; }
ok('bad auth rejects', err && /SMTP/.test(err.message), err && err.message); f.srv.close();

f = await fakeServer({ rcptCode: 550 });
err = null; try { await sendSmtp(env, { to: 'c@x.com', subject: 's', html: 'h' }, connectTo(f.port)); } catch (e) { err = e; }
ok('rejected recipient rejects', err && /RCPT/.test(err.message), err && err.message); f.srv.close();

err = null; try { await sendSmtp({}, { to: 'c@x.com', subject: 's', html: 'h' }, connectTo(1)); } catch (e) { err = e; }
ok('missing config rejects', err && /not configured/.test(err.message));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
