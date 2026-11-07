// Generate the VAPID key pair that signs push messages. Run once, then keep the private half secret.
//   node scripts/gen-vapid.mjs
import { webcrypto as crypto } from 'node:crypto';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicKey = raw.toString('base64url');

if (process.argv.includes('--quiet')) {
  console.log(`${publicKey} ${jwk.d}`);
} else {
  console.log(`
Cặp khoá VAPID (giữ khoá riêng cẩn thận — ai có nó gửi được thông báo nhân danh bạn):

  VAPID_PUBLIC_KEY   ${publicKey}
  VAPID_PRIVATE_KEY  ${jwk.d}

Cài vào Cloudflare:

  npx wrangler secret put VAPID_PRIVATE_KEY     # dán khoá riêng ở trên
  npx wrangler secret put VAPID_SUBJECT         # ví dụ: mailto:ban@congty.com

và thêm khoá công khai vào "vars" trong wrangler.jsonc:

  "VAPID_PUBLIC_KEY": "${publicKey}"

Chạy ở máy mình thì cho cả ba vào .dev.vars.
`);
}
