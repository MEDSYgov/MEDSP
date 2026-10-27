/*
  خادم المنصة على سيرفر الوزارة.

  يقرأ ملف .env عند التشغيل، ثم يقدّم:
    /config.js   إعدادات الواجهة، مولّدة من .env (لا تُبنى في الكود)
    /api/data    بوابة البيانات المحمية (server/dataHandler.js)
    /api/screen  شاشات العرض العامة (server/screenHandler.js)
    /api/public  بيانات النظرة العامة للزائر (publicHandler)
    كل ما عداه   ملفات الموقع المبنية من مجلد dist

  تعديل .env يكفيه إعادة تشغيل الخدمة، دون إعادة بناء الموقع.
  يوضع خلف Nginx (انظر deploy/nginx.conf).
*/
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* 1) تحميل .env قبل أي شيء (متغيرات النظام/Docker لها الأولوية) */
const envFile = process.env.MEDSP_ENV_FILE || path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

/* 2) بعد تحميل .env فقط تُستورد الوحدات التي تقرأ المتغيرات */
const { default: dataHandler, publicHandler } = await import('./dataHandler.js');
const { default: screenHandler } = await import('./screenHandler.js');
const { configScript, publicConfig } = await import('./runtimeConfig.js');

const cfg = publicConfig();
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) {
  console.error('[MEDSP] خطأ: SUPABASE_URL و SUPABASE_KEY مطلوبان في ملف .env');
  process.exit(1);
}
const CONFIG_JS = configScript();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DIST = path.resolve(process.env.MEDSP_DIST_DIR || path.join(root, 'dist'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.pbf': 'application/x-protobuf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function sendFile(res, file, req) {
  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
  /* ملفات Vite ذات البصمة لا تتغير أبداً؛ الصفحة وعامل الخدمة تُطلب دائماً من جديد */
  if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else if (ext === '.html' || file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  else res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');

  if (pathname === '/config.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(CONFIG_JS);
  }
  if (pathname === '/api/data' || pathname.startsWith('/api/data/')) return dataHandler(req, res);
  if (pathname === '/api/screen') return screenHandler(req, res);
  if (pathname === '/api/public') return publicHandler(req, res);
  if (pathname === '/healthz') { res.setHeader('Content-Type', 'text/plain'); return res.end('ok'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }

  /* ملفات الموقع — مع منع الخروج من مجلد dist */
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.statusCode = 400; return res.end(); }
  const file = path.resolve(DIST, `.${rel}`);
  if (!file.startsWith(DIST + path.sep) && file !== DIST) { res.statusCode = 403; return res.end(); }

  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return sendFile(res, file, req);
    /* تطبيق صفحة واحدة: أي مسار غير موجود بلا امتداد يُعيد index.html */
    if (!path.extname(rel)) return sendFile(res, path.join(DIST, 'index.html'), req);
    res.statusCode = 404; res.end('Not found');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[MEDSP] يعمل على http://${HOST}:${PORT} — قاعدة البيانات: ${cfg.SUPABASE_URL}`);
});
