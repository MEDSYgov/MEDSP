/*
  توليد مفاتيح إشعارات الدفع — يُشغَّل مرة واحدة على خادم الوزارة:
      node server/push-keys.mjs
  ثم تُنسخ الأسطر الناتجة إلى ملف .env، وتُعاد تشغيل الخدمة.
  المفتاح الخاص و PUSH_SECRET لا يُرسلان لأحد ولا يوضعان في GitHub.
  (تغيير المفاتيح لاحقاً يُلغي اشتراكات الأجهزة، فيعيد المدراء التفعيل من الجرس.)
*/
import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');

console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log('VAPID_SUBJECT=mailto:planning@example.gov.sy');
console.log(`PUSH_SECRET=${crypto.randomBytes(32).toString('base64url')}`);
