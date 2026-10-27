/*
  بوابة البيانات: لا يُرسَل أي رقم قبل التحقق من الحساب.
  1) الرمز (JWT) يُتحقق منه في قاعدة البيانات عبر my_role (PostgREST يرفض الرمز المزوّر).
  2) الدور والأقسام: هل يحق لهذا الحساب رؤية هذا الملف؟
  3) المحافظات: تُحذف السجلات خارج محافظات الحساب قبل الإرسال.
  استثناء: ملفات النظرة العامة (PUBLIC_FILES) متاحة للزائر بلا تسجيل دخول.
  يعمل كما هو على Vercel (api/data.js) وعلى خادم الوزارة (Node) وفي المعاينة المحلية.
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* من ملف .env (أو متغيرات بيئة Vercel) — لا قيم مكتوبة في الكود */
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_KEY;
const DIR = process.env.MEDSP_DATA_DIR || path.join(process.cwd(), 'server-data');

const OPS = ['overview', 'summary', 'fire', 'ambulance', 'traffic', 'drowning', 'cold-rescue', 'animal-rescue', 'hazard-marking', 'attacks', 'evacuation'];
const SECTIONS = Object.fromEntries([
  ...OPS.map((f) => [f, ['ops', 'monthly']]),
  ['services', ['ops', 'monthly', 'rubble']],
  ...['rubble-transfer', 'rubble-pipeline', 'rubble-registry', 'rubble-damage', 'rubble-assessment', 'rubble-map'].map((f) => [f, ['rubble']]),
  ['ops-map', ['ops']],
]);

/* ملفات النظرة العامة: متاحة للزائر دون تسجيل دخول (بطلب من المدير، 2026-10-27).
   الحساب المسجّل يمر بالتحقق المعتاد، فيرى نسخة مقيدة بمحافظاته إن كانت له قيود. */
const PUBLIC_FILES = new Set(['summary', 'overview']);

const norm = (s) => String(s ?? '').replace(/[إأآ]/g, 'ا').replace(/ة\s*$/, 'ه').replace(/\s+/g, ' ').trim();
const cache = new Map();
function load(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8')));
  return cache.get(name);
}

async function whoAmI(token) {
  if (!SB_URL || !SB_KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY غير معرّفين في .env');
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
  if (name === 'ops-map') {
    /* التجمعات خارج محافظات الحساب تُحذف، وتُعاد فهرسة السجلات */
    const map = new Map(); const places = [];
    data.places.forEach((p, i) => { if (ok(p[6])) { map.set(i, places.length); places.push(p); } });
    const rows = data.rows.filter((r) => map.has(r[0])).map((r) => [map.get(r[0]), ...r.slice(1)]);
    return { ...data, places, rows };
  }
  if (name === 'rubble-map') {
    const fc = (g, key = 'adm1_name1') => ({ ...g, features: g.features.filter((f) => ok(f.properties[key])) });
    const govCodes = new Set(data.governorates.features.filter((f) => ok(f.properties.adm1_name1)).map((f) => f.properties.adm1_pcode));
    const byCode = (g) => ({ ...g, features: g.features.filter((f) => govCodes.has(f.properties.adm1_pcode)) });
    return { ...data, governorates: fc(data.governorates), districts: byCode(data.districts), subdistricts: byCode(data.subdistricts),
      sites: byCode(data.sites), dumps: byCode(data.dumps), machinery: byCode(data.machinery), flows: data.flows.filter((r) => ok(r[6])) };
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
    const isPublic = PUBLIC_FILES.has(name);
    if (!token) {
      if (isPublic) return send(req, res, 200, load(name));
      return send(req, res, 401, { error: 'يلزم تسجيل الدخول' });
    }
    const me = await whoAmI(token);
    if (!me || !me.role) {
      if (isPublic) return send(req, res, 200, load(name));
      return send(req, res, 401, { error: 'الجلسة غير صالحة' });
    }

    const full = me.role === 'super_admin' || me.role === 'admin';
    if (!full) {
      const secs = me.sections || [];
      const blocked = me.role === 'collector' || (secs.length && !SECTIONS[name].some((s) => secs.includes(s)));
      /* ما هو متاح للعموم لا يُمنع عن حساب مسجّل */
      if (blocked) return isPublic ? send(req, res, 200, load(name)) : send(req, res, 403, { error: 'غير مصرّح' });
    }
    let data = load(name);
    const govs = me.govs || [];
    if (govs.length) {
      const names = load('govs').filter((g) => govs.includes(g.code)).map((g) => norm(g.name));
      data = scope(name, data, new Set(names));
    }
    return send(req, res, 200, data);
  } catch (e) {
    console.error('[MEDSP api/data]', e.message);
    return send(req, res, 500, { error: 'تعذّر تحميل البيانات' });
  }
}
