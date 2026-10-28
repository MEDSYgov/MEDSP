import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import dataHandler, { publicHandler } from './server/dataHandler.js'
import screenHandler from './server/screenHandler.js'
import { configScript } from './server/runtimeConfig.js'

/* بوابة البيانات نفسها أثناء التطوير والمعاينة المحلية (على Vercel تعمل من api/data.js) */
const dataApi = () => {
  const mount = (server) => {
    server.middlewares.use('/api/data', (req, res) => {
      req.url = `/api/data${req.url}`;
      dataHandler(req, res);
    });
    server.middlewares.use('/api/public', (req, res) => {
      req.url = `/api/public${req.url}`;
      publicHandler(req, res);
    });
    server.middlewares.use('/api/screen', (req, res) => {
      req.url = `/api/screen${req.url}`;
      screenHandler(req, res);
    });
  };
  return { name: 'medsp-data-api', configureServer: mount, configurePreviewServer: mount };
};

/*
  /config.js — إعدادات وقت التشغيل.
  - التطوير والمعاينة المحلية: يُولَّد من .env / .env.local في كل طلب.
  - البناء: تُكتب نسخة في dist (تحتاجها Vercel فقط). على سيرفر الوزارة
    يتجاهلها server/index.mjs ويولّد الملف من .env عند التشغيل.
*/
const runtimeConfig = (env) => {
  const mount = (server) => {
    server.middlewares.use('/config.js', (req, res) => {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(configScript(env));
    });
  };
  return {
    name: 'medsp-runtime-config',
    configureServer: mount,
    configurePreviewServer: mount,
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'config.js', source: configScript(env) });
    },
  };
};

/*
  مستعرض التقارير (pdf.js): الخطوط القياسية وخرائط المحارف تُنسخ إلى dist/pdfjs،
  فيعرض المستعرض أي PDF دون اتصال بمواقع خارجية.
*/
const pdfjsAssets = () => {
  const src = path.resolve('node_modules/pdfjs-dist');
  const dirs = ['cmaps', 'standard_fonts'];
  return {
    name: 'medsp-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const file = path.join(src, decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(src + path.sep) || !dirs.some((d) => file.startsWith(path.join(src, d)))) return next();
        fs.readFile(file, (err, buf) => (err ? next() : res.end(buf)));
      });
    },
    writeBundle(opts) {
      for (const d of dirs) fs.cpSync(path.join(src, d), path.join(opts.dir || 'dist', 'pdfjs', d), { recursive: true });
    },
  };
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  /* متغيرات الخادم تُقرأ من process.env داخل بوابة البيانات أثناء التطوير */
  for (const k of ['SUPABASE_URL', 'SUPABASE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_KEY']) {
    if (env[k] && !process.env[k]) process.env[k] = env[k];
  }
  return { plugins: [react(), dataApi(), runtimeConfig(env), pdfjsAssets()] };
})
