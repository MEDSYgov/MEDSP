import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Dropdown from './Dropdown';
import { getData } from '../data/api';

/*
  خريطة العمليات — نسخة الويب من مشروع QGIS (MAPS/OpsMap).
  البيانات: ops-map.json من بوابة البيانات (تُبنى من تصدير العمليات الشامل في scripts/build-data.mjs)،
  مجمّعة حسب التجمع × نوع العملية × الشهر، فتُعاد كل الأرقام عند تغيير أي مرشّح.
  الحدود الإدارية: public/maps/ops/admin.json (عامة).
  المشهد الوطني: خلايا سداسية بعرض ~9 كم حسب كثافة العمليات.
  عند التكبير: رمز لكل نوع عملية في كل تجمع، حجمه بعدد العمليات.
*/

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const BOUNDS = L.latLngBounds([32.25, 35.55], [37.38, 42.45]);
const PAN = L.latLngBounds([31.2, 33.8], [38.4, 44.2]);
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const DETAIL = 9; /* التكبير الذي تظهر عنده التجمعات بدل الخلايا */
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

/* مجموعات العمليات: الشكل واللون نفسهما في QGIS وفي الويب */
const GROUPS = [
  { id: 'ambulance', name: 'الإسعاف', ops: ['إسعاف'], color: '#e8606f', shape: 'circle', div: 6, max: 26 },
  { id: 'fire', name: 'الإطفاء', ops: ['عملية أطفاء'], color: '#f28b45', shape: 'triangle', div: 3.5, max: 24 },
  { id: 'traffic', name: 'حوادث السير', ops: ['حادث سير'], color: '#f3c54f', shape: 'square', div: 2.6, max: 20 },
  { id: 'cold', name: 'الإنقاذ البارد', ops: ['انقاذ بارد'], color: '#6fa8dc', shape: 'diamond', div: 1, max: 18 },
  { id: 'drowning', name: 'انتشال الغرقى', ops: ['إنتشال غريق'], color: '#3ec6c2', shape: 'pentagon', div: 0.8, max: 18 },
  { id: 'services', name: 'الأعمال الخدمية', ops: ['أعمال خدمية'], color: '#8fc0b5', shape: 'hexagon', div: 4, max: 22 },
  { id: 'other', name: 'عمليات أخرى', ops: ['انقاذ حيوان', 'وسم أماكن خطرة', 'هجمات', 'إخلاء مدنيين'], color: '#c4ae7c', shape: 'star', div: 1.5, max: 16,
    hint: 'إنقاذ الحيوان، وسم الأماكن الخطرة، الهجمات، الإخلاء' },
];
/* ترتيب الرسم: الأكثر عدداً في الأسفل والأندر في الأعلى */
const DRAW = ['services', 'ambulance', 'fire', 'traffic', 'other', 'cold', 'drowning'];

/* أيقونات الأنواع: شارة دائرية بلون النوع، وداخلها رمز يدل عليه */
const ICON = {
  ambulance: '<path d="M10.2 5.5h3.6v4.7h4.7v3.6h-4.7v4.7h-3.6v-4.7H5.5v-3.6h4.7z"/>',
  fire: '<path d="M12.3 4.6c.6 2.6 4.2 4.4 4.2 8.4a4.5 4.5 0 01-9 0c0-2 .9-3.4 2.1-4.4 0 1.5.7 2.6 1.7 3.1-.3-2.8.4-5 1-7.1z"/><path d="M12 13.2c.9 1 1.6 1.6 1.6 2.7a1.6 1.6 0 01-3.2 0c0-1 .7-1.7 1.6-2.7z" fill-opacity=".35"/>',
  traffic: '<path d="M7.6 8.2c.3-.9 1-1.4 1.9-1.4h5c.9 0 1.6.5 1.9 1.4l1 2.8h.6c.6 0 1 .4 1 1v3.6h-1.4v1.2a1 1 0 01-2 0v-1.2H8.4v1.2a1 1 0 01-2 0v-1.2H5V12c0-.6.4-1 1-1h.6z"/><path d="M8.3 11h7.4l-.8-2.3a.8.8 0 00-.7-.5H9.8a.8.8 0 00-.7.5z" fill-opacity=".35"/><circle cx="8" cy="13.4" r=".95" fill-opacity=".35"/><circle cx="16" cy="13.4" r=".95" fill-opacity=".35"/>',
  cold: '<path d="M5.5 14.6a6.5 6.5 0 0113 0v.4h-13z"/><path d="M4.5 15.8h15v1.9h-15z"/><path d="M11.1 7.6h1.8v4.6h-1.8z" fill-opacity=".35"/>',
  drowning: '<circle cx="12" cy="7.6" r="2.3"/><path d="M4.5 13.6c1.25 0 1.25-1 2.5-1s1.25 1 2.5 1 1.25-1 2.5-1 1.25 1 2.5 1 1.25-1 2.5-1 1.25 1 2.5 1M4.5 17.3c1.25 0 1.25-1 2.5-1s1.25 1 2.5 1 1.25-1 2.5-1 1.25 1 2.5 1 1.25-1 2.5-1 1.25 1 2.5 1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  services: '<path d="M15.6 5.2a3.8 3.8 0 00-4.7 4.9l-5.3 5.3a1.6 1.6 0 002.3 2.3l5.3-5.3a3.8 3.8 0 004.9-4.7l-2.3 2.3-2.2-.6-.6-2.2z"/>',
  other: '<path d="M12 5l2.1 4.4 4.8.6-3.5 3.3.9 4.8L12 15.8l-4.3 2.3.9-4.8L5.1 10l4.8-.6z"/>',
};
/* لون الرمز داخل الشارة: داكن على الألوان الفاتحة ليبقى واضحاً */
const INK = { traffic: '#2a2205', drowning: '#062a28', services: '#0e2a25', other: '#2a2208' };
const glyph = (g, s, ring = '#0b1f1c') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${g.color}" stroke="${ring}" stroke-width="1.4"/><g fill="${INK[g.id] || '#ffffff'}" style="color:${INK[g.id] || '#ffffff'}">${ICON[g.id]}</g></svg>`;

/* تدرّج الكثافة — نفس فئات QGIS */
const RAMP = [
  [1, '#12443d'], [10, '#1f6157'], [40, '#3a8476'], [150, '#7fb3a3'], [500, '#c9b47e'], [1500, '#e9cf8f'], [5000, '#fff1c9'],
];
const rampColor = (v) => { let c = RAMP[0][1]; for (const [b, col] of RAMP) if (v >= b) c = col; return c; };

/* شبكة سداسية في إسقاط الخريطة (متر) */
const HEX_R = 5200;
function hexKey(x, y) {
  const w = Math.sqrt(3) * HEX_R; const h = 1.5 * HEX_R;
  let row = Math.round(y / h); let col = Math.round((x - (row & 1) * w / 2) / w);
  /* تصحيح لأقرب مركز سداسي فعلي */
  let best = null;
  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
    const r = row + dr; const c = col + dc;
    const cx = c * w + (r & 1) * w / 2; const cy = r * h;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (!best || d < best[0]) best = [d, r, c, cx, cy];
  }
  [, row, col] = best;
  return { key: `${row}:${col}`, cx: best[3], cy: best[4] };
}
function hexRing(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(L.CRS.EPSG3857.unproject(L.point(cx + HEX_R * Math.cos(a), cy + HEX_R * Math.sin(a))));
  }
  return pts;
}

const row = (k, v) => (v === null || v === undefined || v === '' ? '' : `<tr><th>${k}</th><td>${v}</td></tr>`);
const card = (title, sub, rows) => `<div class="omap-pop"><header><b>${title || ''}</b><small>${sub || ''}</small></header><table>${rows}</table></div>`;

export default function OpsMapView() {
  const box = useRef(null);
  const map = useRef(null);
  const svg = useRef(null);
  const svgHex = useRef(null);
  const layers = useRef({});
  const [data, setData] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [zoom, setZoom] = useState(7);
  const [view, setView] = useState(0);
  const [sel, setSel] = useState('ambulance'); /* نوع واحد في كل مرة — عرض كل الأنواع معاً كان بطيئاً */
  const [f, setF] = useState({ year: [], month: [], gov: [], dis: [], sub: [] });

  useEffect(() => {
    getData('ops-map').then(setData).catch(() => setData(false));
    fetch('maps/ops/admin.json').then((r) => r.json()).then(setAdmin).catch(() => setAdmin(false));
  }, []);

  useEffect(() => {
    if (!box.current || map.current) return undefined;
    const m = L.map(box.current, { minZoom: 6, maxZoom: 15, zoomSnap: 0.25, maxBounds: PAN, maxBoundsViscosity: 0.8, attributionControl: false, zoomControl: false });
    L.control.zoom({ position: 'topleft' }).addTo(m);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution('خريطة الأساس: Esri').addTo(m);
    m.fitBounds(BOUNDS);
    L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16 }).addTo(m);
    m.createPane('relief').style.zIndex = 210;
    m.getPane('relief').classList.add('omap-relief');
    L.tileLayer(`${ESRI}/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}`, { pane: 'relief', maxNativeZoom: 13, opacity: 0.22 }).addTo(m);
    for (const [name, z] of [['hex', 390], ['admin', 400], ['pts', 440], ['labels', 460]]) m.createPane(name).style.zIndex = z;
    m.getPane('labels').style.pointerEvents = 'none';
    svg.current = L.svg({ pane: 'admin' }).addTo(m);
    svgHex.current = L.svg({ pane: 'hex' }).addTo(m);
    m.on('zoomend', () => setZoom(m.getZoom()));
    m.on('moveend', () => setView((v) => v + 1));
    setZoom(m.getZoom());
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  /* فهارس الأنواع والأشهر */
  const meta = useMemo(() => {
    if (!data) return null;
    const groupOfType = data.types.map((t) => GROUPS.findIndex((g) => g.ops.includes(t)));
    const years = [...new Set(data.months.map((m) => m.slice(0, 4)))];
    return { groupOfType, years };
  }, [data]);

  /* السجلات بعد مرشّحات الزمن والمكان (دون مرشّح النوع — يُطبَّق عند الرسم والعدّ) */
  const scoped = useMemo(() => {
    if (!data || !meta) return null;
    const mOk = data.months.map((m) => (!f.year.length || f.year.includes(m.slice(0, 4))) && (!f.month.length || f.month.includes(String(Number(m.slice(5))))));
    const pOk = data.places.map((p) => (!f.gov.length || f.gov.includes(p[3])) && (!f.dis.length || f.dis.includes(p[4])) && (!f.sub.length || f.sub.includes(p[5])));
    return data.rows.filter((r) => mOk[r[2]] && pOk[r[0]]);
  }, [data, meta, f]);

  const gIdx = useMemo(() => new Set([GROUPS.findIndex((g) => g.id === sel)]), [sel]);
  const cur = GROUPS.find((g) => g.id === sel);

  /* تجميع حسب التجمع والنوع، والمؤشرات */
  const agg = useMemo(() => {
    if (!scoped || !meta) return null;
    const byPlace = new Map();
    const byGroup = GROUPS.map(() => 0);
    let n = 0; let inj = 0; let dead = 0; let as = 0; let an = 0;
    for (const r of scoped) {
      const g = meta.groupOfType[r[1]];
      if (g < 0) continue;
      byGroup[g] += r[3];
      if (!gIdx.has(g)) continue;
      n += r[3]; inj += r[4]; dead += r[5]; as += r[6]; an += r[7];
      const p = byPlace.get(r[0]) || { g: GROUPS.map(() => 0), n: 0, inj: 0, dead: 0, as: 0, an: 0 };
      p.g[g] += r[3]; p.n += r[3]; p.inj += r[4]; p.dead += r[5]; p.as += r[6]; p.an += r[7];
      byPlace.set(r[0], p);
    }
    return { byPlace, byGroup, n, inj, dead, arr: an ? as / an : null, places: byPlace.size };
  }, [scoped, meta, gIdx]);

  /* الخلايا السداسية */
  const hexes = useMemo(() => {
    if (!agg || !data) return [];
    const cells = new Map();
    for (const [pi, p] of agg.byPlace) {
      const pl = data.places[pi];
      const pt = L.CRS.EPSG3857.project(L.latLng(pl[1], pl[2]));
      const h = hexKey(pt.x, pt.y);
      const c = cells.get(h.key) || { ...h, n: 0, inj: 0, places: 0, top: null };
      c.n += p.n; c.inj += p.inj; c.places += 1;
      if (!c.top || p.n > c.top[1]) c.top = [pl[0], p.n];
      cells.set(h.key, c);
    }
    return [...cells.values()];
  }, [agg, data]);

  /* الرسم */
  useEffect(() => {
    const m = map.current;
    if (!m || !agg || !admin || !data) return;
    Object.values(layers.current).forEach((l) => l.remove());
    const Lr = {};
    const detail = zoom >= DETAIL;

    /* تعتيم ما خارج سوريا: مستطيل العالم وثقوبه حلقات المحافظات */
    const holes = admin.governorates.features.flatMap((ft) => (ft.geometry.type === 'MultiPolygon' ? ft.geometry.coordinates : [ft.geometry.coordinates]).map((poly) => poly[0].map(([x, y]) => [y, x])));
    Lr.mask = L.polygon([[[10, 20], [10, 60], [55, 60], [55, 20]], ...holes], { pane: 'admin', renderer: svg.current, stroke: false, fillColor: '#040c0b', fillOpacity: 0.62, interactive: false });
    Lr.land = L.geoJSON(admin.governorates, { pane: 'hex', renderer: svgHex.current, interactive: false, style: { stroke: false, fillColor: '#09201d', fillOpacity: 0.5 } });
    Lr.gov = L.geoJSON(admin.governorates, {
      pane: 'admin', renderer: svg.current, interactive: false,
      style: (ft) => ({ color: '#b9a779', weight: f.gov.includes(ft.properties.adm1_pcode) ? 2.4 : 1.1, fill: false, className: 'omap-gov' }),
    });
    if (detail || f.gov.length) {
      Lr.sub = L.geoJSON({ ...admin.subdistricts, features: admin.subdistricts.features.filter((ft) => !f.gov.length || f.gov.includes(ft.properties.adm1_pcode)) }, {
        pane: 'admin', renderer: svg.current, interactive: false,
        style: (ft) => ({ color: '#b9a779', opacity: f.sub.includes(ft.properties.adm3_pcode) ? 0.9 : 0.28, weight: f.sub.includes(ft.properties.adm3_pcode) ? 2 : 0.6, fill: false }),
      });
    }

    if (!detail) {
      Lr.hex = L.layerGroup(hexes.map((c) => L.polygon(hexRing(c.cx, c.cy), {
        pane: 'hex', renderer: svgHex.current, color: '#0b1f1c', weight: 0.5, fillColor: rampColor(c.n), fillOpacity: 0.86,
      }).bindPopup(card(`${fmt(c.n)} عملية`, 'خلية بعرض 9 كم تقريباً', row('عدد التجمعات', fmt(c.places)) + row('الأكثر نشاطاً', c.top ? `${c.top[0]} (${fmt(c.top[1])})` : '—') + row('المصابون', fmt(c.inj))))));
      /* أسماء المحافظات وعدد عملياتها */
      const govN = new Map();
      for (const [pi, p] of agg.byPlace) { const k = data.places[pi][3]; govN.set(k, (govN.get(k) || 0) + p.n); }
      Lr.labels = L.layerGroup(admin.governorates.features.filter((ft) => !f.gov.length || f.gov.includes(ft.properties.adm1_pcode)).map((ft) => L.marker(ft.properties.c, {
        pane: 'labels', interactive: false,
        icon: L.divIcon({ className: 'omap-label', html: `<span>${ft.properties.adm1_name1}<small>${fmt(govN.get(ft.properties.adm1_pcode) || 0)}</small></span>`, iconSize: null }),
      })));
    } else {
      const vb = m.getBounds().pad(0.15);
      const marks = [];
      for (const gid of DRAW) {
        const gi = GROUPS.findIndex((g) => g.id === gid);
        if (!gIdx.has(gi)) continue;
        const g = GROUPS[gi];
        for (const [pi, p] of agg.byPlace) {
          const v = p.g[gi];
          if (!v) continue;
          const pl = data.places[pi];
          if (!vb.contains([pl[1], pl[2]])) continue;
          const s = Math.round(Math.min(16 + (Math.sqrt(v) / g.div) * 2, 34));
          const parts = GROUPS.map((x, k) => (p.g[k] ? `<tr><th><i style="color:${x.color}">●</i> ${x.name}</th><td>${fmt(p.g[k])}</td></tr>` : '')).join('');
          marks.push(L.marker([pl[1], pl[2]], {
            pane: 'pts', zIndexOffset: DRAW.indexOf(gid) * 100,
            icon: L.divIcon({ className: 'omap-ico', html: glyph(g, s), iconSize: [s, s] }),
          }).bindPopup(card(pl[0], [pl[8], pl[7], pl[6]].filter(Boolean).join(' · '),
            row('إجمالي العمليات', `<b>${fmt(p.n)}</b>`) + parts + row('المصابون', fmt(p.inj)) + row('الوفيات', fmt(p.dead))
            + row('متوسط زمن الوصول', p.an ? `${Math.round(p.as / p.an)} دقيقة` : '—'))));
        }
      }
      Lr.pts = L.layerGroup(marks);
      Lr.labels = L.layerGroup(admin.subdistricts.features.filter((ft) => m.getBounds().contains(ft.properties.c)).map((ft) => L.marker(ft.properties.c, {
        pane: 'labels', interactive: false, icon: L.divIcon({ className: 'omap-label omap-label--sub', html: `<span>${ft.properties.adm3_name1}</span>`, iconSize: null }),
      })));
    }
    Object.values(Lr).forEach((l) => l.addTo(m));
    layers.current = Lr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agg, hexes, admin, zoom, view, f.gov, f.sub]);

  /* التكبير على الاختيار الجغرافي */
  useEffect(() => {
    const m = map.current;
    if (!m || !admin) return;
    const [layer, key, codes] = f.sub.length ? ['subdistricts', 'adm3_pcode', f.sub] : f.dis.length ? ['districts', 'adm2_pcode', f.dis] : f.gov.length ? ['governorates', 'adm1_pcode', f.gov] : [];
    if (!layer) { m.flyToBounds(BOUNDS, { duration: 0.6 }); return; }
    const fs = admin[layer].features.filter((x) => codes.includes(x.properties[key]));
    if (fs.length) m.flyToBounds(L.geoJSON({ type: 'FeatureCollection', features: fs }).getBounds(), { padding: [24, 24], duration: 0.6 });
  }, [f.gov, f.dis, f.sub, admin]);

  const opt = (layer, nameKey, codeKey, keep) => (admin ? admin[layer].features.map((x) => x.properties).filter(keep)
    .map((p) => ({ value: p[codeKey], label: p[nameKey] })).sort((a, b) => a.label.localeCompare(b.label, 'ar')) : []);
  const set = (k, v) => setF((c) => ({ ...c, [k]: v, ...(k === 'gov' ? { dis: [], sub: [] } : k === 'dis' ? { sub: [] } : {}) }));

  if (data === false) return <p className="omap-err">تعذّر تحميل بيانات الخريطة. تأكد من تسجيل الدخول وصلاحية الاطلاع على العمليات.</p>;
  const maxG = agg ? Math.max(...agg.byGroup, 1) : 1;

  return (
    <section className="omap">
      <div className="omap-filters">
        <Dropdown multi label="السنة" placeholder="كل السنوات" value={f.year} onChange={(v) => set('year', v)}
          options={(meta?.years || []).map((y) => ({ value: y, label: y }))} />
        <Dropdown multi label="الشهر" placeholder="كل الأشهر" value={f.month} onChange={(v) => set('month', v)}
          options={AR_MONTHS.map((n, i) => ({ value: String(i + 1), label: n }))} />
        <Dropdown multi label="المحافظة" placeholder="كل المحافظات" value={f.gov} onChange={(v) => set('gov', v)}
          options={opt('governorates', 'adm1_name1', 'adm1_pcode', () => true)} />
        <Dropdown multi label="المنطقة" placeholder="كل المناطق" value={f.dis} onChange={(v) => set('dis', v)}
          options={opt('districts', 'adm2_name1', 'adm2_pcode', (p) => !f.gov.length || f.gov.includes(p.adm1_pcode))} />
        <Dropdown multi label="الناحية" placeholder="كل النواحي" value={f.sub} onChange={(v) => set('sub', v)}
          options={opt('subdistricts', 'adm3_name1', 'adm3_pcode', (p) => (!f.gov.length || f.gov.includes(p.adm1_pcode)) && (!f.dis.length || f.dis.includes(p.adm2_pcode)))} />
      </div>

      <div className="omap-chips" role="group" aria-label="فرز حسب نوع العملية">
        {GROUPS.map((g) => (
          <button type="button" key={g.id} className={sel === g.id ? 'is-on' : ''} aria-pressed={sel === g.id} onClick={() => setSel(g.id)}
            style={{ '--c': g.color }} title={g.hint}>
            <span dangerouslySetInnerHTML={{ __html: glyph(g, 22, 'transparent') }} />{g.name}
            {agg && <small>{fmt(agg.byGroup[GROUPS.indexOf(g)])}</small>}
          </button>
        ))}
      </div>

      <div className="omap-body">
        <div className="omap-canvas">
          <div ref={box} className="omap-map" />
          {(!data || !admin) && <div className="omap-loading">جارٍ تحميل الخريطة…</div>}
          {zoom < DETAIL && agg && <div className="omap-hint">كبّر الخريطة أو اختر محافظة لعرض العمليات حسب النوع في كل تجمع</div>}
        </div>

        <aside className="omap-side">
          <div className="omap-box">
            <h4>مفتاح الخريطة</h4>
            <p>كثافة العمليات <em>— المشهد الوطني</em></p>
            <ul className="omap-ramp">
              {RAMP.map(([b, c], i) => <li key={b}><i style={{ background: c }} /><span dir="ltr">{i < RAMP.length - 1 ? `${fmt(b)} – ${fmt(RAMP[i + 1][0])}` : `${fmt(b)}+`}</span></li>)}
            </ul>
            <p>نوع العملية <em>— اضغط للاختيار؛ يظهر عند التكبير وحجمه بعدد العمليات</em></p>
            <ul className="omap-types">
              {GROUPS.map((g) => (
                <li key={g.id}>
                  <button type="button" className={sel === g.id ? 'is-on' : ''} onClick={() => setSel(g.id)}>
                    <span dangerouslySetInnerHTML={{ __html: glyph(g, 22) }} />
                    <span className="omap-types__t">{g.name}{g.hint && <small>{g.hint}</small>}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {agg && (
            <div className="omap-box omap-kpi">
              <h4>{cur.name}</h4>
              <b className="omap-kpi__big">{fmt(agg.n)}</b>
              <span className="omap-kpi__sub">عملية في {fmt(agg.places)} تجمعاً · {data.period}</span>
              <ul className="omap-kpi__grid">
                <li><span>المصابون</span><b className="is-red">{fmt(agg.inj)}</b></li>
                <li><span>الوفيات</span><b>{fmt(agg.dead)}</b></li>
                <li><span>متوسط زمن الوصول</span><b className="is-teal">{agg.arr ? `${agg.arr.toFixed(1)} د` : '—'}</b></li>
              </ul>
              <ul className="omap-bars">
                {GROUPS.map((g, i) => (
                  <li key={g.id} className={sel === g.id ? 'is-sel' : ''}>
                    <span>{g.name}</span><b>{fmt(agg.byGroup[i])}</b>
                    <i><em style={{ width: `${(agg.byGroup[i] / maxG) * 100}%`, background: g.color }} /></i>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
      <p className="omap-src">المصدر: تقارير عمليات الدفاع المدني المعتمدة ({data ? fmt(data.rows.reduce((a, r) => a + r[3], 0)) : '…'} عملية محددة الموقع على مستوى التجمع). خريطة الأساس: Esri.</p>
    </section>
  );
}
