import { supabase } from '../projects/supabase';

/*
  جلب البيانات من بوابة البيانات (api/data) بعد التحقق من الحساب.
  الملفات العامة فقط (حدود الخريطة وشجرة المناطق) تُجلب مباشرة.
*/
const PUBLIC = new Set(['basemap', 'admin-areas']);
const memo = new Map();

export function clearData() { memo.clear(); }

export function getData(name) {
  if (PUBLIC.has(name)) return fetch(`data/${name}.json`).then((r) => r.json());
  if (!memo.has(name)) {
    const p = supabase.auth.getSession().then(({ data }) => fetch(`api/data?f=${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}` },
    })).then((r) => {
      if (!r.ok) throw Object.assign(new Error('غير مصرّح أو تعذّر التحميل'), { status: r.status });
      return r.json();
    });
    p.catch(() => memo.delete(name));
    memo.set(name, p);
  }
  return memo.get(name);
}
