/*
  مسودات الاستبيان — «حفظ والمتابعة لاحقاً».

  تُحفظ على الجهاز وحده (IndexedDB، لأن الصور تتجاوز حد localStorage)، فتعمل
  بلا إنترنت وبلا حساب، ولا تدخل قاعدة الوزارة بيانات ناقصة غير مراجعة.
  تُحذف المسودة تلقائياً عند إرسال الاستمارة.
*/
const DB = 'medsp-drafts';
const STORE = 'drafts';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('survey', 'surveyId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result ?? r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('تعذّر حفظ المسودة على الجهاز'));
  });
}

export const newDraftId = () => (crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function saveDraft(d) {
  await tx('readwrite', (s) => s.put({ ...d, updatedAt: new Date().toISOString() }));
}

export async function listDrafts(surveyId) {
  const all = await tx('readonly', (s) => s.index('survey').getAll(surveyId));
  return (all || []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function removeDraft(id) {
  await tx('readwrite', (s) => s.delete(id));
}

/* وصف مختصر للمسودة: القرية/الناحية المختارة إن وُجدت، وإلا أول إجابة نصية */
export function draftLabel(answers = {}) {
  for (const v of Object.values(answers)) {
    if (v && typeof v === 'object' && v.names) {
      const n = v.names;
      const place = n.community || n.subdistrict || n.district;
      if (place) return place;
    }
  }
  for (const v of Object.values(answers)) {
    if (typeof v === 'string' && v.trim().length > 1 && v.length < 60 && !/^\d{4}-\d{2}/.test(v)) return v.trim();
  }
  return 'استمارة بلا عنوان بعد';
}

/* عدد الإجابات المعبّأة (لعرض التقدم) */
export function answeredCount(answers = {}) {
  return Object.values(answers).filter((v) => v !== '' && v != null && !(Array.isArray(v) && !v.length)).length;
}
