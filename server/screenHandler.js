/*
  بوابة شاشات العرض — عامة، بلا تسجيل دخول.

    GET  /api/screen   الشرائح المفعّلة بأرقامها المجمّعة (للشاشات)
    POST /api/screen   معاينة إعدادات لم تُحفظ بعد (لمدير المنصة فقط)

  ما يُعرض يحدده مدير المنصة من مساحة العمل، ويُحفظ في جدول screen_settings،
  ويُقرأ بالدالة العامة screen_config(). الخادم لا يرسل إلا:
    - الشرائح المفعّلة فقط،
    - أرقاماً مجمّعة (لا سجلات ولا أسماء ولا إحداثيات)،
    - بعد حذف التصنيفات والمحافظات التي أخفاها المدير.
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { OPS, GOVS, normalizeConfig, SLIDES } from './screenCatalog.js';

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_KEY;
const DIR = process.env.MEDSP_DATA_DIR || path.join(process.cwd(), 'server-data');

const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const monthName = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');

const norm = (s) => String(s ?? '').replace(/[إأآ]/g, 'ا').replace(/ة\s*$/, 'ه').replace(/\s+/g, ' ').trim();
const GOV_BY_NORM = new Map(GOVS.map((g) => [norm(g), g]));
const govName = (g) => GOV_BY_NORM.get(norm(g)) || String(g || '').trim();

/* الملفات تُقرأ مرة، وتُعاد قراءتها إن تغيّرت (بعد نشر بيانات جديدة) */
const files = new Map();
function load(name) {
  const file = path.join(DIR, `${name}.json`);
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const hit = files.get(name);
  if (hit && hit.mtime === st.mtimeMs) return hit.data;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  files.set(name, { mtime: st.mtimeMs, data });
  return data;
}

async function rpc(fn, token, body = {}) {
  if (!SB_URL || !SB_KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY غير معرّفين في .env');
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token || SB_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw Object.assign(new Error(`${fn}: ${r.status}`), { status: r.status });
  return r.json();
}

/* الإعدادات المحفوظة — تُحفظ في الذاكرة 30 ثانية حتى لا تُسأل القاعدة مع كل شاشة */
let cfgCache = { at: 0, value: null };
async function savedConfig() {
  if (Date.now() - cfgCache.at < 30_000 && cfgCache.value) return cfgCache.value;
  try {
    const value = normalizeConfig(await rpc('screen_config'));
    cfgCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    /* القاعدة غير متاحة: آخر إعدادات معروفة، وإلا تتوقف الشاشات (لا نعرض شيئاً لم يُعتمد) */
    console.error('[MEDSP api/screen] config:', e.message);
    return cfgCache.value || normalizeConfig({ paused: true });
  }
}

/* ---------- حساب الأرقام ---------- */

function opsStats(cfg) {
  const ov = load('overview');
  if (!ov) return null;
  const opVals = ov.dims[0].values;
  const hidden = new Set(cfg.hiddenOps);
  const shown = OPS.filter((o) => !hidden.has(o.op));
  const opIdx = new Map(shown.map((o) => [opVals.indexOf(o.op), o]).filter(([i]) => i >= 0));
  const hiddenGov = new Set(cfg.hiddenGovs.map(norm));
  const govs = ov.dict.govs;
  const at = 5 + ov.dims.length; // أول مقياس
  const mi = Object.fromEntries(ov.metrics.map((m, i) => [m.key, at + i]));

  const byMonth = new Map();
  let total = 0;
  for (const r of ov.records) {
    if (!opIdx.has(r[5]) || !r[0]) continue;
    total += 1;
    const ym = r[0].slice(0, 7);
    let m = byMonth.get(ym);
    if (!m) byMonth.set(ym, (m = { n: 0, ops: new Map(), govs: new Map(), injured: 0, dead: 0, beneficiaries: 0 }));
    m.n += 1;
    m.ops.set(r[5], (m.ops.get(r[5]) || 0) + 1);
    if (r[1] >= 0) m.govs.set(r[1], (m.govs.get(r[1]) || 0) + 1);
    m.injured += r[mi.injured] || 0;
    m.dead += r[mi.dead] || 0;
    m.beneficiaries += r[mi.beneficiaries] || 0;
  }
  const months = [...byMonth.keys()].sort();
  const last = months.at(-1);
  const prev = months.at(-2);
  const L = byMonth.get(last) || { n: 0, ops: new Map(), govs: new Map() };
  const P = byMonth.get(prev) || { n: 0, ops: new Map() };
  return {
    ov, last, prev, total, L, P, opIdx, months, byMonth,
    govRows: [...L.govs].map(([i, n]) => ({ name: govName(govs[i]), value: n }))
      .filter((g) => !hiddenGov.has(norm(g.name))).sort((a, b) => b.value - a.value),
  };
}

function rubbleStats(cfg) {
  const t = load('rubble-transfer');
  if (!t?.phases?.length) return null;
  const hiddenGov = new Set(cfg.hiddenGovs.map(norm));
  const byGov = new Map();
  let planned = 0; let executed = 0;
  for (const p of t.phases) {
    const g = govName(p.gov);
    if (hiddenGov.has(norm(g))) continue;
    planned += p.planned || 0; executed += p.executed || 0;
    const row = byGov.get(g) || { name: g, planned: 0, executed: 0 };
    row.planned += p.planned || 0; row.executed += p.executed || 0;
    byGov.set(g, row);
  }
  return { asOf: t.planAsOf, planned, executed, govs: [...byGov.values()].sort((a, b) => b.planned - a.planned) };
}

export function buildSlides(cfg) {
  const out = [];
  let ops; let rub;
  const getOps = () => (ops === undefined ? (ops = opsStats(cfg)) : ops);
  const getRub = () => (rub === undefined ? (rub = rubbleStats(cfg)) : rub);

  for (const s of cfg.slides) {
    if (!s.on) continue;
    const meta = SLIDES.find((x) => x.id === s.id);
    const base = { id: s.id, title: meta.title };

    if (s.id === 'ops-total') {
      const o = getOps(); if (!o?.last) continue;
      out.push({ ...base, month: monthName(o.last), prevMonth: monthName(o.prev), value: o.L.n, prev: o.P.n, total: o.total, since: monthName(o.months[0]) });
    } else if (s.id === 'ops-breakdown') {
      const o = getOps(); if (!o?.last) continue;
      const items = [...o.opIdx].map(([i, op]) => ({ name: op.name, value: o.L.ops.get(i) || 0, prev: o.P.ops.get(i) || 0 }))
        .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
      out.push({ ...base, month: monthName(o.last), items });
    } else if (s.id === 'ops-govs') {
      const o = getOps(); if (!o?.last || !o.govRows.length) continue;
      out.push({ ...base, month: monthName(o.last), items: o.govRows });
    } else if (s.id === 'ops-impact') {
      const o = getOps(); if (!o?.last) continue;
      out.push({ ...base, month: monthName(o.last), beneficiaries: o.L.beneficiaries, injured: o.L.injured, dead: o.L.dead });
    } else if (s.id === 'ops-trend') {
      const o = getOps(); if (!o?.last) continue;
      const items = o.months.slice(-12).map((m) => ({ name: monthName(m), short: MONTHS[Number(m.slice(5, 7)) - 1], value: o.byMonth.get(m).n }));
      out.push({ ...base, items });
    } else if (s.id === 'rubble-progress') {
      const r = getRub(); if (!r || !r.planned) continue;
      out.push({ ...base, asOf: r.asOf, planned: r.planned, executed: r.executed, pct: Math.round((r.executed / r.planned) * 1000) / 10 });
    } else if (s.id === 'rubble-govs') {
      const r = getRub(); if (!r?.govs.length) continue;
      out.push({ ...base, asOf: r.asOf, items: r.govs });
    } else if (s.id === 'rubble-assessment') {
      const a = load('rubble-assessment'); if (!a?.sites?.length) continue;
      const hiddenGov = new Set(cfg.hiddenGovs.map(norm));
      const byGov = new Map(); let vol = 0; let n = 0;
      for (const x of a.sites) {
        const g = govName(x.gov);
        if (hiddenGov.has(norm(g))) continue;
        n += 1; vol += x.vol || 0;
        byGov.set(g, (byGov.get(g) || 0) + (x.vol || 0));
      }
      if (!n) continue;
      out.push({ ...base, sites: n, volume: Math.round(vol), items: [...byGov].map(([name, value]) => ({ name, value: Math.round(value) })).sort((p, q) => q.value - p.value).slice(0, 6) });
    } else if (s.id === 'message') {
      if (!cfg.message.title && !cfg.message.text) continue;
      out.push({ ...base, heading: cfg.message.title, text: cfg.message.text });
    }
  }
  return out;
}

function send(req, res, status, body) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && json.length > 2048) {
    res.setHeader('Content-Encoding', 'gzip');
    res.end(zlib.gzipSync(json));
  } else res.end(json);
}

function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 50_000) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { fail(e); } });
    req.on('error', fail);
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      /* معاينة: لمدير المنصة فقط */
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return send(req, res, 401, { error: 'يلزم تسجيل الدخول' });
      const me = await rpc('my_role', token).catch(() => null);
      if (!me || !['super_admin', 'admin'].includes(me.role)) return send(req, res, 403, { error: 'غير مصرّح' });
      const cfg = normalizeConfig(await readBody(req));
      return send(req, res, 200, { interval: cfg.interval, paused: cfg.paused, slides: buildSlides(cfg) });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { error: 'غير مسموح' });
    const cfg = await savedConfig();
    const slides = cfg.paused ? [] : buildSlides(cfg);
    return send(req, res, 200, { interval: cfg.interval, paused: cfg.paused, slides });
  } catch (e) {
    console.error('[MEDSP api/screen]', e.message);
    return send(req, res, 500, { error: 'تعذّر تحميل الشاشة' });
  }
}
