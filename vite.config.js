import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dataHandler from './server/dataHandler.js'

/* بوابة البيانات نفسها أثناء التطوير والمعاينة المحلية (على Vercel تعمل من api/data.js) */
const dataApi = () => {
  const mount = (server) => {
    server.middlewares.use('/api/data', (req, res) => {
      req.url = `/api/data${req.url}`;
      dataHandler(req, res);
    });
  };
  return { name: 'medsp-data-api', configureServer: mount, configurePreviewServer: mount };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dataApi()],
})
