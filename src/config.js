/*
  إعدادات المنصة — تُقرأ وقت التشغيل لا وقت البناء.

  على السيرفر: يولّد server/index.mjs الملف /config.js من ملف .env
  عند كل تشغيل، فيكفي تعديل .env وإعادة تشغيل الخدمة دون إعادة بناء.

  أثناء التطوير المحلي (npm run dev): يولّده Vite من .env.local.

  لا توجد هنا أي قيمة مكتوبة في الكود.
*/

const runtime = (typeof window !== 'undefined' && window.__MEDSP_CONFIG__) || {};

export const SUPABASE_URL = runtime.SUPABASE_URL || '';
export const SUPABASE_KEY = runtime.SUPABASE_KEY || '';

export const configMissing = !SUPABASE_URL || !SUPABASE_KEY;

if (configMissing) {
  console.error('[MEDSP] إعدادات الاتصال ناقصة: تأكد من SUPABASE_URL و SUPABASE_KEY في ملف .env');
}
