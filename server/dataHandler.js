/*
  بوابة البيانات: لا يُرسَل أي رقم قبل التحقق من الحساب.
  1) الرمز (JWT) يُتحقق منه في قاعدة البيانات عبر my_role (PostgREST يرفض الرمز المزوّر).
  2) الدور والأقسام: هل يحق لهذا الحساب رؤية هذا الملف؟
  3) المحافظات: تُحذف السجلات خارج محافظات الحساب قبل الإرسال.
  يعمل كما هو على Vercel (api/data.js) وعلى خادم الوزارة (Node) وفي المعاينة المحلية.
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://wyyvsntytjtcrmllptfs.supabase.co';
const SB_KEY = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_KEY || 'sb_publishable_HRhdNiHxp46Zj7014bVbzg_sTqfLyKX';
const DIR = process.env.MEDSP_DATA_DIR || path.join(process.cwd(), 'server-data');

const OPS = ['overview', 'summary', 'fire', 'ambulance', 'traffic', 'drowning', 'cold-rescue', 'animal-rescue', 'hazard-marking', 'attacks', 'evacuation'];
const SECTIONS = Object.fromEntries([
  ...OPS.map((f) => [f, ['ops', 'monthly']]),
  ['services', ['ops', 'monthly', 'rubble']],
  ...['rubble-transfer', 'rubble-pipeline', 'rubble-registry', 'rubble-damage', 'rubble-assessment'].map((f) => [f, ['rubble']]),
]);

const norm = (s) => String(s ?? '').replace(/[إأآ]/g, 'ا').replace(/ة\s*$/, 'ه').replace(/\s+/g, ' ').trim();
const cache = new Map();
function load(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8')));
  return cache.get(name);
}

async function whoAmI(token) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/my_role`, {
    method: 'POST', body: '{}',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!r.ok) return null;
  return r.json();
}

/* حذف ما هو خارج محافظات الحساب */
function scope(name, data, allowed) {
  const ok = (g) => allowed.has(norm(g));
  if (OPS.includes(name) && name !== 'summary' || name === 'services') {
    const keep = new Set(data.dict.govs.map((g, i) => (ok(g) ? i : -1)).filter((i) => i >= 0));
    const records = data.records.filter((r) => keep.has(r[1]));
    return { ...data, records, total: records.length };
  }
  if (name === 'summary') {
    const ov = scope('overview', load('overview'), allowed);
    const at = 5 + ov.dims.findIndex((d) => d.key === 'operation');
    const op = ov.dims.find((d) => d.key === 'operation');
    const counts = new Map();
    for (const r of ov.records) { const l = op?.values[r[at]]; if (l) counts.set(l, (counts.get(l) || 0) + 1); }
    return { ...data, totalRecords: ov.records.length, byOperation: data.byOperation.map((o) => ({ ...o, value: counts.get(o.label) || 0 })) };
  }
  if (name === 'rubble-transfer') return { ...data, surveys: data.surveys.filter((s) => ok(s.gov)), phases: (data.phases || []).filter((r) => ok(r.gov)) };
  if (name === 'rubble-assessment') return { ...data, sites: data.sites.filter((s) => ok(s.gov)) };
  if (name === 'rubble-pipeline') return { ...data, items: data.items.filter((x) => ok(x.gov)) };
  if (name === 'rubble-damage') return { ...data, rows: data.rows.filter((x) => ok(x.gov)) };
  if (name === 'rubble-registry') return { ...data, dumps: data.dumps.filter((x) => ok(x.gov)) };
  return data;
}

function send(req, res, status, body) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && json.length > 2048) {
    res.setHeader('Content-Encoding', 'gzip');
    res.end(zlib.gzipSync(json));
  } else res.end(json);
}

export default async function handler(req, res) {
  try {
    const name = new URL(req.url, 'http://x').searchParams.get('f') || '';
    if (!SECTIONS[name]) return send(req, res, 404, { error: 'غير موجود' });
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return send(req, res, 401, { error: 'يلزم تسجيل الدخول' });
    const me = await whoAmI(token);
    if (!me || !me.role) return send(req, res, 401, { error: 'الجلسة غير صالحة' });

    const full = me.role === 'super_admin' || me.role === 'admin';
    if (!full) {
      if (me.role === 'collector') return send(req, res, 403, { error: 'غير مصرّح' });
      const secs = me.sections || [];
      if (secs.length && !SECTIONS[name].some((s) => secs.includes(s))) return send(req, res, 403, { error: 'غير مصرّح' });
    }
    let data = load(name);
    const govs = me.govs || [];
    if (govs.length) {
      const names = load('govs').filter((g) => govs.includes(g.code)).map((g) => norm(g.name));
      data = scope(name, data, new Set(names));
    }
    return send(req, res, 200, data);
  } catch (e) {
    return send(req, res, 500, { error: 'تعذّر تحميل البيانات' });
  }
}
