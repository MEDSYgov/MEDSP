/*
  عامل الخدمة — يجعل المنصة تُفتح بلا إنترنت بعد أول زيارة.

  الصفحة (التنقل): الشبكة أولاً ثم النسخة المحفوظة. فبعد أي نشر جديد
  يحصل المتصل على الأحدث فوراً، وغير المتصل على آخر نسخة.

  الملفات (سكربتات، خطوط، بيانات): تُعرض من النسخة المحفوظة فوراً
  وتُحدَّث في الخلفية. أسماء السكربتات فيها بصمة المحتوى، فلا تتقادم.

  الطلبات إلى نطاقات أخرى (قاعدة البيانات) لا تُمَس إطلاقاً — الإرسال
  بلا شبكة يتولاه صندوق الصادر في الصفحة نفسها.
*/

const VERSION = 'medsp-v5';

/*
  ignoreVary: سكربتات Vite تُطلب بوضع crossorigin فتحمل ترويسة Origin،
  والخادم يرسل Vary: Origin — فبدونه لا تطابق النسخةُ المحفوظة الطلبَ
  وتفشل الصفحة بلا شبكة رغم أن الملفات محفوظة.
*/
const MATCH = { ignoreVary: true };
const SHELL = ['./', './index.html', './data/basemap.json', './brand/emblem.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* الصفحة تُرسل قائمة ما حمّلته قبل أن يتولى العامل التحكم، فيحفظها */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls') return;
  const urls = (event.data.urls || []).filter((u) => {
    try { return new URL(u).origin === self.location.origin; } catch { return false; }
  });
  event.waitUntil(
    caches.open(VERSION).then((c) => Promise.allSettled(urls.map((u) => c.add(u)))),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  /* بوابة البيانات: خاصة بكل حساب، لا تُحفظ أبداً */
  if (url.pathname.includes('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await Promise.race([fetch(req), timeout(5000)]);
        const c = await caches.open(VERSION);
        c.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html', MATCH)) || (await caches.match('./', MATCH)) || Response.error();
      }
    })());
    return;
  }

  /*
    ملفات البيانات (data/*.json): الشبكة أولاً ثم المحفوظة.
    أسماؤها ثابتة بلا بصمة، فعرض المحفوظ أولاً كان يقدّم بيانات قديمة
    للكود الجديد بعد كل نشر (مثل مرشّح بلا خيارات).
  */
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const res = await Promise.race([fetch(req), timeout(8000)]);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        return (await c.match(req, MATCH)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const c = await caches.open(VERSION);
    const cached = await c.match(req, MATCH);
    const network = fetch(req)
      .then((res) => { if (res.ok) c.put(req, res.clone()); return res; })
      .catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || Response.error();
  })());
});
