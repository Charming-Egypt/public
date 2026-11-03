// node tools/gen-vapid.mjs  -> prints a VAPID key pair for Web Push (no dependencies)
import { generateKeyPairSync } from 'node:crypto';
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
console.log('VAPID_PUBLIC_KEY  (also Cloudflare var DS_VAPID_PUBLIC_KEY) =', pub);
console.log('VAPID_PRIVATE_KEY (Supabase secret only, never commit)      =', jwk.d);
