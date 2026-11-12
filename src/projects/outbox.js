/*
  صندوق الصادر — الاستمارات المحفوظة على الجهاز بانتظار الإرسال.

  يُخزَّن في IndexedDB لا localStorage: الاستمارات بالصور تتجاوز حد
  localStorage (نحو 5 ميغابايت) بسرعة.

  كل استمارة تحمل clientId يولّده الجهاز لحظة الإرسال. إن وصلت للخادم
  وانقطعت الشبكة قبل عودة التأكيد، يعيد الجهاز الإرسال بنفس المعرّف
  فيتعرّف الخادم عليها ولا ينشئ نسخة ثانية.
*/

const DB = 'medsp-offline';
const STORE = 'outbox';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'clientId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('تعذّر الحفظ على الجهاز'));
  });
}

export async function enqueue(item) {
  await tx('readwrite', (s) => s.put({ ...item, queuedAt: new Date().toISOString(), attempts: 0 }));
  notify();
}

export async function list(surveyId) {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || [])
    .filter((i) => !surveyId || i.surveyId === surveyId)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function remove(clientId) {
  await tx('readwrite', (s) => s.delete(clientId));
  notify();
}

async function update(item) {
  await tx('readwrite', (s) => s.put(item));
}

/* ---------- تمييز انقطاع الشبكة عن رفض الخادم ---------- */

/*
  انقطاع الشبكة: نحتفظ بالاستمارة ونعيد المحاولة لاحقاً.
  رفض الخادم (استبيان أُغلق، كلمة مرور تغيّرت): إعادة المحاولة لن تفيد،
  فنعلّمها ونعرض السبب للباحث.
*/
export function isNetworkError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(err?.cause?.message || err?.message || err || '');
  return /fetch|network|Load failed|NetworkError|timeout|ECONN/i.test(msg);
}

/* ---------- الإرسال ---------- */

let flushing = null;

/*
  يرسل كل ما في الصندوق بالترتيب. send(item) يُرجع وعداً.
  يُرجع { sent, failed, remaining }.
*/
export function flush(send, only = null) {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let failed = 0;
    const items = await list();
    for (const item of items) {
      if (only && item.clientId !== only) continue;
      if (item.rejected && !only) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await send(item);
        // eslint-disable-next-line no-await-in-loop
        await remove(item.clientId);
        sent += 1;
      } catch (err) {
        if (isNetworkError(err) || err?.auth) break; /* بلا شبكة أو بلا دخول — تبقى محفوظة حتى يُحلّ ذلك */
        if (err?.retry) {
          /* خطأ مؤقت في السيرفر: تبقى في الصادر بلا وسم «مرفوضة»، ويُعاد إرسالها في المرة القادمة */
          // eslint-disable-next-line no-await-in-loop
          await update({ ...item, attempts: item.attempts + 1, lastError: err.message });
          continue;
        }
        failed += 1;
        // eslint-disable-next-line no-await-in-loop
        await update({ ...item, attempts: item.attempts + 1, rejected: true, lastError: err.message });
      }
    }
    const remaining = (await list()).length;
    notify();
    return { sent, failed, remaining };
  })().finally(() => { flushing = null; });
  return flushing;
}

/* إعادة استمارة «مرفوضة» إلى الانتظار لتُرسل من جديد */
export async function retry(clientId) {
  const all = await list();
  const item = all.find((i) => i.clientId === clientId);
  if (item) await update({ ...item, rejected: false });
  notify();
}

/* ---------- الاشتراك في التغييرات ---------- */

const listeners = new Set();
function notify() { listeners.forEach((fn) => fn()); }
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function newClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* وصف مختصر للجهاز — للمشرف لا للتتبع */
export function deviceLabel() {
  const ua = navigator.userAgent || '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'غير معروف';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : '';
  const mobile = /Mobi|Android|iPhone/i.test(ua) ? 'هاتف' : 'حاسوب';
  return [mobile, os, br].filter(Boolean).join('، ');
}
