import { supabase } from '../projects/supabase';
import { BUCKET, MAX_BYTES } from './catalog';

/*
  مكتبة التقارير: القراءة والرفع.
  - القراءة تمر بسياسات RLS: الزائر يرى «العام» المنشور فقط، والحساب المسجّل يرى الداخلي أيضاً،
    والمدير يرى كل شيء بما فيه المسودات.
  - الملفات في حاوية خاصة، وتُفتح بروابط مؤقتة (ساعة) يمنحها التخزين لمن يحق له قراءة التقرير.
*/

const fail = (error, fallback) => {
  if (!error) return;
  const m = String(error.message || '');
  if (/bucket not found/i.test(m)) throw new Error('حاوية التقارير غير موجودة على الخادم. يلزم تطبيق تعديل قاعدة البيانات الخاص بالتقارير وتفعيل خدمة التخزين.');
  if (/relation .*reports.* does not exist|schema cache/i.test(m)) throw new Error('جدول التقارير غير موجود بعد. يلزم تطبيق تعديل قاعدة البيانات الخاص بالتقارير.');
  if (/exceeded|too large|payload/i.test(m)) throw new Error('حجم الملف أكبر من المسموح على الخادم.');
  throw new Error(fallback ? `${fallback}: ${m}` : m);
};

export async function listReports() {
  const { data, error } = await supabase.from('reports').select('*')
    .order('issued_on', { ascending: false }).order('created_at', { ascending: false });
  fail(error, 'تعذّر تحميل التقارير');
  return data || [];
}

/* روابط مؤقتة لعدة ملفات دفعة واحدة (أغلفة البطاقات) */
export async function signedUrls(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(list, 3600);
  if (error) return {};
  return Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}

export async function fileUrl(path, { download } = {}) {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, 3600, download ? { download } : undefined);
  fail(error, 'تعذّر فتح الملف');
  return data.signedUrl;
}

/* ===== للإدارة ===== */

export async function createReport({ file, thumb, pages, meta }) {
  if (!file || file.type !== 'application/pdf') throw new Error('الملف يجب أن يكون بصيغة PDF');
  if (file.size > MAX_BYTES) throw new Error('حجم الملف أكبر من 50 ميغابايت');
  const id = crypto.randomUUID();
  const filePath = `files/${id}.pdf`;
  const thumbPath = thumb ? `thumbs/${id}.jpg` : null;
  const bucket = supabase.storage.from(BUCKET);

  const up = await bucket.upload(filePath, file, { contentType: 'application/pdf', upsert: false, cacheControl: '3600' });
  fail(up.error, 'تعذّر رفع الملف');
  if (thumb) {
    const t = await bucket.upload(thumbPath, thumb, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
    if (t.error) console.warn('[reports] thumb', t.error.message);
  }
  const { data: me } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('reports')
    .insert({ ...meta, id, file_path: filePath, thumb_path: thumbPath, file_size: file.size, pages, created_by: me?.user?.id ?? null })
    .select().single();
  if (error) {
    /* لا نترك ملفاً يتيماً بلا سجل */
    await bucket.remove([filePath, thumbPath].filter(Boolean));
    fail(error, 'تعذّر حفظ بيانات التقرير');
  }
  return data;
}

/* تعديل البيانات، واستبدال الملف اختيارياً */
export async function updateReport(report, { meta, file, thumb, pages }) {
  const patch = { ...meta };
  const bucket = supabase.storage.from(BUCKET);
  if (file) {
    if (file.type !== 'application/pdf') throw new Error('الملف يجب أن يكون بصيغة PDF');
    if (file.size > MAX_BYTES) throw new Error('حجم الملف أكبر من 50 ميغابايت');
    const up = await bucket.upload(report.file_path, file, { contentType: 'application/pdf', upsert: true, cacheControl: '3600' });
    fail(up.error, 'تعذّر رفع الملف');
    patch.file_size = file.size;
    patch.pages = pages;
    if (thumb) {
      const thumbPath = report.thumb_path || `thumbs/${report.id}.jpg`;
      const t = await bucket.upload(thumbPath, thumb, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
      if (!t.error) patch.thumb_path = thumbPath;
    }
  }
  const { data, error } = await supabase.from('reports').update(patch).eq('id', report.id).select().single();
  fail(error, 'تعذّر حفظ التعديل');
  return data;
}

export async function deleteReport(report) {
  /* الملفات أولاً ثم السجل، حتى لا يبقى ملف بلا سجل يدل عليه */
  const rm = await supabase.storage.from(BUCKET).remove([report.file_path, report.thumb_path].filter(Boolean));
  if (rm.error) console.warn('[reports] remove', rm.error.message);
  const { error } = await supabase.from('reports').delete().eq('id', report.id);
  fail(error, 'تعذّر الحذف');
}
