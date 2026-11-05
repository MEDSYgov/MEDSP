import { createClient } from '@supabase/supabase-js';

/*
  الاتصال بقاعدة البيانات.

  المفتاح هنا "مفتاح علني" (publishable) مصمّم ليُضمَّن في كود الواجهة —
  لا يمنح بمفرده أي صلاحية. الحماية الفعلية في قاعدة البيانات نفسها:
  كل الجداول مغلقة بسياسات RLS، والزائر لا يصل إلا عبر دوال محددة
  (جلب استبيان مفتوح، إرسال إجابة، قراءة المنشور).

  لا يوضع هنا أبداً مفتاح service_role — ذاك يتجاوز كل الحماية.

  القيمتان تُقرآن وقت التشغيل من ملف .env على السيرفر (انظر src/config.js).
*/

import { SUPABASE_URL, SUPABASE_KEY, configMissing } from '../config.js';

/* عند نقص الإعدادات لا تنهار الصفحة: تفتح، وتفشل طلبات البيانات برسالة واضحة في الكونسول */
const URL = configMissing ? 'http://config-missing.invalid' : SUPABASE_URL;
const KEY = configMissing ? 'config-missing' : SUPABASE_KEY;

/*
  «تذكّرني»: الجلسة تُحفظ في localStorage (تبقى بعد إغلاق المتصفح)،
  وبدونه في sessionStorage (تنتهي بإغلاق المتصفح). الافتراضي: تذكّر.
*/
export const REMEMBER_KEY = 'medsp-remember';
const safe = (fn, fb = null) => { try { return fn(); } catch { return fb; } };
const authStorage = {
  getItem: (k) => safe(() => localStorage.getItem(k)) ?? safe(() => sessionStorage.getItem(k)),
  setItem: (k, v) => {
    if (safe(() => localStorage.getItem(REMEMBER_KEY)) === '0') {
      safe(() => sessionStorage.setItem(k, v)); safe(() => localStorage.removeItem(k));
    } else {
      safe(() => localStorage.setItem(k, v)); safe(() => sessionStorage.removeItem(k));
    }
  },
  removeItem: (k) => { safe(() => localStorage.removeItem(k)); safe(() => sessionStorage.removeItem(k)); },
};

export const supabase = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storage: authStorage },
});

export default supabase;
