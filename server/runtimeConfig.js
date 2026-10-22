/*
  يولّد محتوى /config.js الذي تقرؤه الواجهة عند فتح الصفحة.

  لا يُرسَل للمتصفح إلا القيم العلنية: عنوان قاعدة البيانات والمفتاح العلني.
  وإن وُضع بالخطأ مفتاح سرّي (service_role أو sb_secret_) يُرفض ولا يُنشر.
*/

function isSecretKey(key) {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload.role === 'service_role';
    } catch { return false; }
  }
  return false;
}

export function publicConfig(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const key = env.SUPABASE_KEY || env.VITE_SUPABASE_KEY || '';
  if (isSecretKey(key)) {
    throw new Error('SUPABASE_KEY في .env مفتاح سرّي (service_role). ضع المفتاح العلني (anon / publishable) فقط.');
  }
  return { SUPABASE_URL: url, SUPABASE_KEY: key };
}

export function configScript(env = process.env) {
  return `window.__MEDSP_CONFIG__ = ${JSON.stringify(publicConfig(env))};\n`;
}
