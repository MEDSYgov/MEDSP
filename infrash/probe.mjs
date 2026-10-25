// Run INSIDE the candidate/deployed MEDSP container.
// Keeps readiness checks; never prints URLs, keys, or response bodies.
import fs from 'node:fs';
import path from 'node:path';

class ProbeFailure extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.httpStatus = status;
  }
}
let stage = 'PROBE_START';
function assert(value, code, status) {
  if (!value) throw new ProbeFailure(code, status);
}
async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
}
const safeCauses = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH',
  'EHOSTUNREACH', 'ECONNRESET', 'EACCES', 'ENOENT', 'EPERM',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);
const safeNames = new Set(['TimeoutError', 'AbortError', 'SyntaxError', 'TypeError']);

try {
  const local = 'http://127.0.0.1:3000';
  stage = 'APP_HEALTH';
  let response = await request(`${local}/healthz`);
  assert(response.status === 200 && (await response.text()).trim() === 'ok',
    'APP_HEALTH_FAILED', response.status);

  stage = 'HTML_PAGE';
  response = await request(`${local}/`);
  assert(response.status === 200 && /<html/i.test(await response.text()),
    'HTML_PAGE_FAILED', response.status);

  stage = 'RUNTIME_CONFIG';
  response = await request(`${local}/config.js`);
  const text = await response.text();
  const prefix = 'window.__MEDSP_CONFIG__ = ';
  assert(response.status === 200 && text.startsWith(prefix),
    'RUNTIME_CONFIG_FAILED', response.status);
  const config = JSON.parse(text.slice(prefix.length).trim().replace(/;$/, ''));
  assert(config.SUPABASE_URL === process.env.SUPABASE_URL
    && config.SUPABASE_KEY === process.env.SUPABASE_KEY, 'RUNTIME_CONFIG_MISMATCH');

  stage = 'PROTECTED_DATA';
  response = await request(`${local}/api/data?f=overview`);
  assert(response.status === 401,
    'PROTECTED_DATA_ANONYMOUS_ACCESS_CHECK_FAILED', response.status);

  stage = 'BUILT_DATA';
  const data = JSON.parse(
    fs.readFileSync(path.join('/app/server-data', 'overview.json'), 'utf8'));
  assert(data && Array.isArray(data.records), 'BUILT_DATA_FAILED');

  stage = 'SUPABASE_CONFIGURATION';
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_KEY || '';
  assert(base && key, 'SUPABASE_CONFIGURATION_MISSING');
  const headers = { apikey: key };
  if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`;

  stage = 'SUPABASE_AUTH';
  response = await request(`${base}/auth/v1/health`, { headers });
  assert(response.status === 200, 'SUPABASE_AUTH_GATEWAY_FAILED', response.status);

  stage = 'SUPABASE_REST';

  response = await request(
    `${base}/rest/v1/projects?select=id&limit=0`,
    { headers: { ...headers, Accept: 'application/json' } }
  );

  assert(
    response.status === 200 &&
    /json/i.test(response.headers.get('content-type') || ''),
    'SUPABASE_REST_GATEWAY_FAILED',
    response.status
  );

  console.log('PASS: application, configuration, protected data, dataset, Supabase Auth and REST.');
} catch (error) {
  const report = {
    stage,
    error: error instanceof ProbeFailure ? error.code : 'CONTAINER_PROBE_FAILED',
  };
  if (error instanceof ProbeFailure && Number.isInteger(error.httpStatus)) {
    report.http_status = error.httpStatus;
  }
  const cause = error?.cause?.code || error?.code;
  if (safeCauses.has(cause)) report.cause = cause;
  if (safeNames.has(error?.name)) report.type = error.name;
  console.error(JSON.stringify(report));
  process.exit(1);
}
