import { supabase } from '../projects/supabase';

/*
  جلب البيانات من بوابة البيانات (api/data) بعد التحقق من الحساب.
  الملفات العامة فقط (حدود الخريطة وشجرة المناطق) تُجلب مباشرة.
*/
const PUBLIC = new Set(['basemap', 'admin-areas']);
/* متاحة للزائر بلا تسجيل دخول عبر /api/public (النظرة العامة) */
const GUEST = new Set(['summary', 'overview']);
const memo = new Map();

export function clearData() { memo.clear(); }

export function getData(name) {
  if (PUBLIC.has(name)) return fetch(`data/${name}.json`).then((r) => r.json());
  /* الحفظ لكل حساب على حدة: نسخة الزائر العامة لا تُستعمل بعد الدخول (ولا العكس) */
  return supabase.auth.getSession().then(({ data }) => {
    const key = `${data.session?.user?.id || 'guest'}|${name}`;
    if (!memo.has(key)) {
      const guest = !data.session && GUEST.has(name);
      const p = fetch(`api/${guest ? 'public' : 'data'}?f=${encodeURIComponent(name)}`, {
        headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
      }).then((r) => {
        if (!r.ok) throw Object.assign(new Error('غير مصرّح أو تعذّر التحميل'), { status: r.status });
        return r.json();
      });
      p.catch(() => memo.delete(key));
      memo.set(key, p);
    }
    return memo.get(key);
  });
}
