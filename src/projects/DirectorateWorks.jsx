import { useEffect, useMemo, useState } from 'react';
import SyriaMap from '../components/SyriaMap';
import Dropdown from '../components/Dropdown';

/*
  أعمال المديريات في إزالة الأنقاض — منفصلة تماماً عن المشاريع المشتركة.
  المصدر: تقارير العمليات (الأعمال الخدمية ← عمليات الأنقاض بالمتر المكعب).
  مفتاح ثلاثي داخل هذا القسم فقط: المديريات · المشاريع المشتركة · الدمج.
  في الدمج تبقى الألوان منفصلة ليظهر نصيب كل مسار.
*/
const SRC = {
  dir: { t: 'أعمال المديريات', c: '#4f8fdc' },
  proj: { t: 'المشاريع المشتركة', c: '#2f9e74' },
};
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : fmt(n));
const norm = (s) => String(s || '').replace(/[إأآ]/g, 'ا').replace(/ة$/, 'ه').replace(/\s+/g, ' ').trim();
const ymLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function Bars({ rows, sel, onPick, mode, unit = 'م³' }) {
  const max = Math.max(1, ...rows.map((r) => r.dir + r.proj));
  return (
    <ul className="dw-bars">
      {rows.map((r) => (
        <li key={r.k}>
          <button type="button" className={sel.includes(r.k) ? 'is-on' : sel.length ? 'is-dim' : ''} onClick={() => onPick(r.k)}>
            <span className="dw-bars__n">{r.k}<small>{fmt(r.n)} {mode === 'proj' ? 'موقع' : mode === 'dir' ? 'عملية' : 'عملية/موقع'}</small></span>
            <span className="dw-bars__bar">
              {mode !== 'proj' && r.dir > 0 && <i style={{ width: `${(r.dir / max) * 100}%`, background: SRC.dir.c }} title={`${SRC.dir.t}: ${fmt(r.dir)} ${unit}`} />}
              {mode !== 'dir' && r.proj > 0 && <i style={{ width: `${(r.proj / max) * 100}%`, background: SRC.proj.c }} title={`${SRC.proj.t}: ${fmt(r.proj)} ${unit}`} />}
            </span>
            <b>{short(r.dir + r.proj)}</b>
            {mode === 'mix' && <small className="dw-bars__split">{SRC.dir.t} {short(r.dir)} · {SRC.proj.t} {short(r.proj)}</small>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function DirectorateWorks({ basemap, projSurveys = [], planRows = [] }) {
  const [svc, setSvc] = useState(null);
  const [mode, setMode] = useState('dir');
  const [f, setF] = useState({ gov: [], area: [], town: [], ym: [] });

  useEffect(() => { fetch('data/services.json').then((r) => r.json()).then(setSvc).catch(() => setSvc(false)); }, []);

  /* اسم المحافظة الموحّد من الخريطة */
  const canon = useMemo(() => {
    const m = new Map((basemap?.governorates || []).map((g) => [norm(g.name), g.name]));
    return (g) => m.get(norm(g)) || g || 'غير محدد';
  }, [basemap]);

  const all = useMemo(() => {
    if (!svc) return [];
    const B = 5 + svc.dims.length;
    const a = svc.metrics.findIndex((m) => m.key === 'rubble');
    const dir = [];
    for (const r of svc.records) {
      const vol = r[B + a] || 0;
      if (!(vol > 0)) continue;
      const site = svc.dict.sites[r[4]];
      dir.push({ src: 'dir', date: r[0], ym: r[0].slice(0, 7), gov: canon(svc.dict.govs[r[1]] || site?.governorate), area: site?.district || 'غير محدد',
        town: site?.subdistrict || 'غير محدد', lat: site?.lat, lon: site?.lon, key: site?.code, vol });
    }
    const proj = projSurveys.filter((s) => s.vol > 0).map((s) => ({ src: 'proj', date: s.date, ym: String(s.date || '').slice(0, 7), gov: canon(s.gov),
      area: s.area || 'غير محدد', town: s.town || 'غير محدد', lat: s.lat, lon: s.lon, key: `p${s.id}`, vol: s.vol }));
    return [...dir, ...proj];
  }, [svc, projSurveys, canon]);

  const inMode = (x) => mode === 'mix' || x.src === mode;
  const match = (x, skip) => Object.entries(f).every(([k, v]) => k === skip || !v.length || v.includes(x[k]));
  const items = all.filter((x) => inMode(x) && match(x));

  const toggle = (k, v) => setF((c) => {
    const n = { ...c, [k]: c[k].includes(v) ? c[k].filter((x) => x !== v) : [...c[k], v] };
    if (k === 'gov') { n.area = []; n.town = []; }
    if (k === 'area') n.town = [];
    return n;
  });

  if (svc === null) return <p className="results__empty">جارٍ التحميل…</p>;
  if (svc === false) return <div className="hub-empty"><p>تعذّر تحميل تقارير العمليات.</p></div>;

  const sum = (l, src) => l.filter((x) => !src || x.src === src).reduce((s, x) => s + x.vol, 0);
  const tDir = sum(items, 'dir'); const tProj = sum(items, 'proj');
  /* الرقم الرسمي للمشاريع (التقرير المرحلي) متاح على مستوى المحافظة فقط وبلا تواريخ */
  const officialOk = !f.area.length && !f.town.length && !f.ym.length;
  const official = planRows.filter((r) => !f.gov.length || f.gov.includes(canon(r.gov))).reduce((s, r) => s + (r.executed || 0), 0);
  const projTotal = officialOk && official ? official : tProj;
  const total = (mode !== 'proj' ? tDir : 0) + (mode !== 'dir' ? projTotal : 0);

  const group = (k, skip) => {
    const m = new Map();
    for (const x of all) {
      if (!inMode(x) || !match(x, skip)) continue;
      const o = m.get(x[k]) || { k: x[k], dir: 0, proj: 0, n: 0 };
      o[x.src] += x.vol; o.n += 1; m.set(x[k], o);
    }
    return [...m.values()];
  };
  const govs = group('gov', 'gov').sort((a, b) => b.dir + b.proj - a.dir - a.proj);
  const areas = group('area', 'area').filter((r) => r.k !== 'غير محدد').sort((a, b) => b.dir + b.proj - a.dir - a.proj).slice(0, 12);
  const months = group('ym', 'ym').filter((r) => r.k).sort((a, b) => a.k.localeCompare(b.k));
  const mmax = Math.max(1, ...months.map((r) => r.dir + r.proj));

  /* نقاط الخريطة: تُجمع حسب الموقع */
  const pts = new Map();
  for (const x of items) {
    if (!x.lat || !x.lon) continue;
    const k = `${x.src}-${x.key}`;
    const o = pts.get(k) || { code: k, name: `${x.town} — ${SRC[x.src].t}`, governorate: x.gov, lat: x.lat, lon: x.lon, vol: 0, color: SRC[x.src].c };
    o.vol += x.vol; pts.set(k, o);
  }
  const locations = [...pts.values()].map((p) => ({ ...p, name: `${p.name} · ${fmt(p.vol)} م³`, count: Math.max(1, Math.round(Math.sqrt(p.vol / 50))) }));
  const active = Object.values(f).some((v) => v.length);
  const opts = (k) => [...new Set(all.filter((x) => inMode(x) && match(x, k)).map((x) => x[k]))].filter(Boolean).sort()
    .map((v) => ({ value: v, label: k === 'ym' ? ymLabel(v) : v }));

  return (
    <div className="dw">
      <div className="dw-head">
        <div>
          <h2>أعمال المديريات في إزالة الأنقاض</h2>
          <p>الأعمال التي تنفّذها مديريات الطوارئ وإدارة الكوارث في المحافظات، وهي منفصلة عن المشاريع المشتركة. يمكن عرضها وحدها أو مع المشاريع.</p>
        </div>
        <div className="dw-switch" role="tablist" aria-label="مصدر الأرقام">
          {[['dir', SRC.dir.t], ['proj', SRC.proj.t], ['mix', 'الدمج']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} className={`is-${k}${mode === k ? ' is-on' : ''}`} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="ov-kpis dw-kpis">
        <div className={`dw-kpi-main is-${mode}`}>
          <span>{mode === 'mix' ? 'إجمالي الأنقاض المُزالة (المسارين)' : `الأنقاض المُزالة — ${SRC[mode].t}`}</span>
          <b>{fmt(total)}</b><small>م³</small>
        </div>
        {mode !== 'proj' && <div><span>{SRC.dir.t}</span><b style={{ color: SRC.dir.c }}>{short(tDir)}</b><small>{fmt(items.filter((x) => x.src === 'dir').length)} عملية{mode === 'mix' && total ? ` · ${Math.round((tDir / total) * 100)}%` : ''}</small></div>}
        {mode !== 'dir' && <div><span>{SRC.proj.t}</span><b style={{ color: SRC.proj.c }}>{short(projTotal)}</b><small>{fmt(items.filter((x) => x.src === 'proj').length)} موقع{mode === 'mix' && total ? ` · ${Math.round((projTotal / total) * 100)}%` : ''}</small></div>}
        <div><span>المحافظات</span><b>{fmt(new Set(items.map((x) => x.gov)).size)}</b></div>
      </div>
      {mode !== 'dir' && (
        <p className="dmg__note">{officialOk && official
          ? 'رقم المشاريع المشتركة من التقرير المرحلي (الرسمي)، والتفاصيل الشهرية والمناطق والخريطة من استمارات المواقع الميدانية.'
          : 'مع فلتر المنطقة أو الناحية أو الشهر، تُحسب أرقام المشاريع من استمارات المواقع الميدانية، لأن التقرير المرحلي على مستوى المحافظة فقط.'}</p>
      )}

      <div className="filters atl-filters">
        <div className="filters__fields" style={{ '--n': 4 }}>
          {[['gov', 'المحافظة', 'كل المحافظات'], ['area', 'المنطقة', 'كل المناطق'], ['town', 'الناحية', 'كل النواحي'], ['ym', 'الشهر', 'كل الأشهر']].map(([k, l, ph]) => (
            <div className="ffield" key={k}><span className="ffield__label">{l}</span>
              <Dropdown multi label={l} placeholder={ph} value={f[k]} options={opts(k)}
                onChange={(v) => setF((c) => ({ ...c, [k]: v, ...(k === 'gov' ? { area: [], town: [] } : k === 'area' ? { town: [] } : {}) }))} /></div>
          ))}
        </div>
      </div>
      {active && <button type="button" className="atl-clear" onClick={() => setF({ gov: [], area: [], town: [], ym: [] })}>مسح كل الفلاتر</button>}

      {mode === 'mix' && (
        <div className="pc-legend dw-legend">
          <span><i style={{ background: SRC.dir.c }} /> {SRC.dir.t}</span>
          <span><i style={{ background: SRC.proj.c }} /> {SRC.proj.t}</span>
        </div>
      )}

      <section className="atl-box">
        <h3>الاتجاه الشهري <small>اضغط على شهر لتصفية القسم</small></h3>
        <div className="dw-months">
          {months.map((r) => (
            <button key={r.k} type="button" className={`dw-month${f.ym.includes(r.k) ? ' is-on' : f.ym.length ? ' is-dim' : ''}`} onClick={() => toggle('ym', r.k)}
              title={`${ymLabel(r.k)}: ${fmt(r.dir + r.proj)} م³`}>
              <span className="dw-month__col">
                {mode !== 'dir' && r.proj > 0 && <i style={{ height: `${(r.proj / mmax) * 100}%`, background: SRC.proj.c }} />}
                {mode !== 'proj' && r.dir > 0 && <i style={{ height: `${(r.dir / mmax) * 100}%`, background: SRC.dir.c }} />}
              </span>
              <b>{short(r.dir + r.proj)}</b>
              <small>{Number(r.k.slice(5, 7))}/{r.k.slice(2, 4)}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="atl-main">
        <section className="atl-box atl-mapbox">
          <h3>خريطة المواقع</h3>
          {basemap && <SyriaMap basemap={basemap} locations={locations} noun="المواقع" height={typeof window !== 'undefined' && window.innerWidth < 640 ? 340 : 460} className="rx-map"
            onPickGovernorate={(code) => { const g = basemap.governorates.find((x) => x.code === code)?.name; if (g && govs.some((r) => r.k === g)) toggle('gov', g); }} />}
        </section>
        <section className="atl-box">
          <h3>حسب المحافظة</h3>
          <Bars rows={govs} sel={f.gov} onPick={(v) => toggle('gov', v)} mode={mode} />
        </section>
      </div>

      <section className="atl-box">
        <h3>أكثر المناطق</h3>
        <Bars rows={areas} sel={f.area} onPick={(v) => toggle('area', v)} mode={mode} />
      </section>

      <p className="dmg__note">مصدر أعمال المديريات: تقارير العمليات (الأعمال الخدمية — عمليات الأنقاض المسجّلة بالمتر المكعب). العمليات المسجّلة بوحدات أخرى غير محسوبة.</p>
    </div>
  );
}
