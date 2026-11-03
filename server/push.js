/*
  إشعارات المدراء عند تحديث البيانات.

  عند تشغيل الخادم (أي بعد كل نشر) تُحسب بصمة كل مجموعة بيانات في server-data،
  وتُرسل إلى القاعدة (push_announce). المجموعة التي تغيّرت بصمتها تولّد إشعاراً
  في جرس المنصة، ويُرسل إشعار دفع إلى أجهزة المدراء المشتركين.

  الإرسال مكتوب بـ node:crypto وحده (صورة التشغيل بلا node_modules):
    - تشفير المحتوى aes128gcm  (RFC 8291 + RFC 8188)
    - توقيع VAPID بـ ES256      (RFC 8292)
  الإشعار نص عام فقط («تم تحديث بيانات …»)، بلا أي أرقام.

  المتغيرات في .env (كلها مطلوبة، وإلا تُتجاوز الإشعارات بصمت مع رسالة في السجل):
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… أو https://…), PUSH_SECRET
*/
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/* مجموعات البيانات التي يُبلَّغ عن تحديثها */
export const GROUPS = [
  {
    dataset: 'operations',
    title: 'تم تحديث بيانات تقارير العمليات',
    body: 'البيانات الأسبوعية للعمليات أصبحت متاحة على المنصة.',
    link: '#/',
    test: (f) => !f.startsWith('rubble-') && !['govs', 'services'].includes(f),
  },
  {
    dataset: 'rubble',
    title: 'تم تحديث بيانات عمليات الأنقاض',
    body: 'بيانات الأنقاض المحدّثة أصبحت متاحة في إدارة الأنقاض.',
    link: '#/rubble',
    test: (f) => f.startsWith('rubble-') || f === 'services',
  },
];

export function dataVersions(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return GROUPS.map((g) => {
    const h = crypto.createHash('sha256');
    for (const f of files) {
      if (!g.test(f.slice(0, -5))) continue;
      h.update(f); h.update(fs.readFileSync(path.join(dir, f)));
    }
    return { dataset: g.dataset, hash: h.digest('hex'), title: g.title, body: g.body, link: g.link };
  });
}

/* ---------- VAPID ---------- */
function vapidKey(pub, priv) {
  const p = fromB64u(pub);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(fromB64u(priv)), x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)) },
    format: 'jwk',
  });
}
function vapidAuth(endpoint, { pub, priv, subject }) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: vapidKey(pub, priv), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

/* ---------- التشفير aes128gcm ---------- */
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

export function encrypt(payload, p256dh, authSecret, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPub = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const as = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) as.generateKeys();
  const asPub = as.getPublicKey();
  const shared = as.computeSecret(uaPub);
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0); header.writeUInt32BE(4096, 16); header.writeUInt8(asPub.length, 20);
  return Buffer.concat([header, asPub, ct]);
}

export async function sendPush(sub, message, vapid) {
  const body = encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: 'POST', body,
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(3 * 24 * 3600),
      Urgency: 'normal', Authorization: vapidAuth(sub.endpoint, vapid) },
    signal: AbortSignal.timeout(10000),
  });
  return r.status;
}

/* ---------- عند التشغيل ---------- */
async function rpc(fn, args) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_KEY;
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', body: JSON.stringify(args),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

export function vapidFromEnv(env = process.env) {
  const v = { pub: env.VAPID_PUBLIC_KEY, priv: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  return v.pub && v.priv && v.subject ? v : null;
}

export async function announceDataUpdates(dir) {
  const vapid = vapidFromEnv();
  const secret = process.env.PUSH_SECRET;
  if (!secret || secret.length < 24) {
    console.log('[MEDSP push] PUSH_SECRET غير معرّف (24 حرفاً على الأقل) — إشعارات المدراء معطّلة');
    return;
  }
  try {
    const res = await rpc('push_announce', { p_secret: secret, p_versions: dataVersions(dir) });
    if (!res.created.length) return console.log('[MEDSP push] لا تحديث جديد في البيانات');
    console.log(`[MEDSP push] إشعارات جديدة: ${res.created.map((c) => c.title).join('، ')}`);
    if (!vapid) return console.log('[MEDSP push] مفاتيح VAPID غير معرّفة — أُضيفت الإشعارات للجرس فقط');
    const dead = [];
    let ok = 0;
    for (const n of res.created) {
      for (const s of res.subs) {
        try {
          const st = await sendPush(s, { title: n.title, body: n.body, link: n.link, tag: `data-${n.id}` }, vapid);
          if (st === 404 || st === 410) dead.push(s.endpoint);
          else if (st < 300) ok += 1;
          else console.log(`[MEDSP push] ردّ ${st} من ${new URL(s.endpoint).host}`);
        } catch (e) {
          console.log(`[MEDSP push] تعذّر الوصول إلى ${new URL(s.endpoint).host}: ${e.message}`);
        }
      }
    }
    if (dead.length) await rpc('push_prune', { p_secret: secret, p_endpoints: [...new Set(dead)] });
    console.log(`[MEDSP push] أُرسل ${ok} إشعار دفع${dead.length ? `، وأُزيل ${dead.length} اشتراك منتهٍ` : ''}`);
  } catch (e) {
    console.error('[MEDSP push]', e.message);
  }
}
