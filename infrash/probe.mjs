// Runs INSIDE the deployed application container. No credentials are printed.
import fs from 'node:fs';
import path from 'node:path';
function assert(value, message) { if (!value) throw new Error(message); }
async function request(url, options = {}) {
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
}
try {
  const local = 'http://127.0.0.1:3000';
  let r = await request(`${local}/healthz`);
  assert(r.status === 200 && (await r.text()).trim() === 'ok', 'APP_HEALTH_FAILED');
  r = await request(`${local}/`);
  assert(r.status === 200 && /<html/i.test(await r.text()), 'HTML_PAGE_FAILED');
  r = await request(`${local}/config.js`);
  const text = await r.text();
  const prefix = 'window.__MEDSP_CONFIG__ = ';
  assert(r.status === 200 && text.startsWith(prefix), 'RUNTIME_CONFIG_FAILED');
  const config = JSON.parse(text.slice(prefix.length).trim().replace(/;$/, ''));
  assert(config.SUPABASE_URL === process.env.SUPABASE_URL && config.SUPABASE_KEY === process.env.SUPABASE_KEY,
    'RUNTIME_CONFIG_MISMATCH');
  r = await request(`${local}/api/data?f=overview`);
  assert(r.status === 401, 'PROTECTED_DATA_ANONYMOUS_ACCESS_CHECK_FAILED');
  const data = JSON.parse(fs.readFileSync(path.join('/app/server-data', 'overview.json'), 'utf8'));
  assert(data && Array.isArray(data.records), 'BUILT_DATA_FAILED');
  const base = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const headers = { apikey: process.env.SUPABASE_KEY };
  // Opaque publishable keys are API keys, not JWT bearer tokens.
  if (process.env.SUPABASE_KEY.split('.').length === 3) headers.Authorization = `Bearer ${process.env.SUPABASE_KEY}`;
  r = await request(`${base}/auth/v1/health`, { headers });
  assert(r.status === 200, 'SUPABASE_AUTH_GATEWAY_FAILED');
  r = await request(`${base}/rest/v1/`, { headers });
  assert(r.status === 200 && /json/i.test(r.headers.get('content-type') || ''), 'SUPABASE_REST_GATEWAY_FAILED');
  console.log('PASS: application, runtime configuration, protected data, built dataset, Supabase Auth and REST.');
} catch (error) {
  // A fetch error can contain a private URL; send only known fixed diagnostic codes.
  const message = /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'CONTAINER_PROBE_FAILED';
  console.error(message);
  process.exit(1);
}
