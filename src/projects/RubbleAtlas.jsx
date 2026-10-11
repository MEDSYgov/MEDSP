import { useEffect, useMemo, useState } from 'react';
import SyriaMap from '../components/SyriaMap';
import Dropdown from '../components/Dropdown';
import { getData } from '../data/api';

/*
  كميات الأنقاض في سوريا — قسم مستقل للاطلاع من قبل الجهات الراغبة بالمشاركة في إزالة الأنقاض.
  مصدره التقييم الميداني (KoBo) وحده؛ لا يتأثر ولا يؤثر بأي بيانات أخرى في المنصة.
  كل شريط قابل للضغط ويفلتر الصفحة كلها (على طريقة Power BI).
*/
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : fmt(n));
const PAL = ['#2f9e74', '#4f8fdc', '#d4a443', '#e0735a', '#8d6bc9', '#35b3ad', '#d2668f', '#86a23c', '#7a8a99'];
const GOOD = { 'سهل الوصول': '#2f9e74', 'متوسط الصعوبة': '#d4a443', 'صعب جداً': '#e0735a', نعم: '#2f9e74', لا: '#e0735a' };

const DIMS = [
  { key: 'access', t: 'سهولة الوصول' },
  { key: 'roads', t: 'حالة الطرق المؤدية' },
  { key: 'approval', t: 'الموافقة على الترحيل' },
  { key: 'uxo', t: 'مسح الذخائر غير المنفجرة', label: { نعم: 'تم المسح', لا: 'لم يُمسح' } },
  { key: 'use', t: 'عائدية الأنقاض', multi: true },
  { key: 'mix', t: 'تركيبة الأنقاض' },
  { key: 'owner', t: 'الجهة المالكة' },
  { key: 'setting', t: 'موقع التجمع' },
  { key: 'inhabited', t: 'هل الموقع مأهول؟' },
  { key: 'dumpOk', t: 'قدرة أقرب مكب على الاستيعاب' },
];
const GEO = [['gov', 'المحافظة', 'كل المحافظات'], ['area', 'المنطقة', 'كل المناطق'], ['town', 'البلدة', 'كل البلدات']];
const EMPTY = Object.fromEntries([...GEO.map((g) => g[0]), ...DIMS.map((d) => d.key)].map((k) => [k, []]));
const vals = (s, k) => (Array.isArray(s[k]) ? s[k] : [s[k] || 'غير محدد']);
const match = (s, f, skip) => Object.entries(f).every(([k, v]) => k === skip || !v.length || vals(s, k).some((x) => v.includes(x)));
const ready = (s) => s.access === 'سهل الوصول' && s.approval === 'نعم' && s.uxo === 'نعم';

function Breakdown({ dim, sites, all, f, toggle }) {
  const m = new Map();
  for (const s of sites) for (const v of vals(s, dim.key)) { const o = m.get(v) || { v, n: 0, vol: 0 }; o.n += 1; o.vol += s.vol; m.set(v, o); }
  const rows = [...m.values()].sort((a, b) => b.vol - a.vol);
  const tot = rows.reduce((a, r) => a + r.vol, 0) || 1;
  const sel = f[dim.key];
  return (
    <section className="atl-box">
      <h3>{dim.t}{sel.length > 0 && <button type="button" className="atl-clear" onClick={() => toggle(dim.key, null)}>إلغاء</button>}</h3>
      <div className="atl-stack">
        {rows.map((r, i) => <i key={r.v} style={{ flex: r.vol, background: GOOD[r.v] || PAL[i % PAL.length] }} title={`${r.v}: ${fmt(r.vol)} م³`} />)}
      </div>
      <ul className="atl-rows">
        {rows.map((r, i) => (
          <li key={r.v}>
            <button type="button" className={sel.includes(r.v) ? 'is-on' : sel.length ? 'is-dim' : ''} onClick={() => toggle(dim.key, r.v)}>
              <span className="atl-dot" style={{ background: GOOD[r.v] || PAL[i % PAL.length] }} />
              <span className="atl-rows__l">{dim.label?.[r.v] || r.v}</span>
              <b>{Math.round((r.vol / tot) * 100)}%</b>
              <small>{short(r.vol)} م³ · {fmt(r.n)} موقع</small>
            </button>
          </li>
        ))}
      </ul>
      {all && null}
    </section>
  );
}

function Site({ s, onClose }) {
  const F = ([k, v]) => v ? <div key={k}><dt>{k}</dt><dd>{v}</dd></div> : null;
  return (
    <div className="gal-view" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="gal-view__box atl-site" onClick={(e) => e.stopPropagation()}>
        <header>
          <div><h3>{[s.village, s.hood].filter(Boolean).join(' — ') || s.town}</h3><p>{[s.gov, s.area, s.town].filter(Boolean).join(' · ')}</p></div>
          <button type="button" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>
        <div className="atl-site__vol"><b>{fmt(s.vol)}</b> م³ مقدّرة</div>
        <dl>{[
          ['الشارع', s.street], ['تاريخ التقييم', s.date], ['موقع التجمع', s.setting], ['مأهول بالسكان', s.inhabited],
          ['سهولة الوصول', s.access], ['الطرق المؤدية', s.roads], ['تعرض للقصف', s.shelled], ['مسح الذخائر', s.uxo],
          ['الجهة المالكة', s.owner], ['الموافقة على الترحيل', s.approval], ['سبب عدم الموافقة', s.noApproval],
          ['عائدية الأنقاض', s.use.join('، ')], ['كيفية الوجود', s.spread], ['التركيبة', s.mix],
          ['أقرب مكب', s.dump && `${s.dump}${s.dumpKm ? ` (${s.dumpKm} كم)` : ''}`], ['قدرة المكب', s.dumpOk],
          ['جهات عاملة في الموقع', s.partner || s.partners],
          ['الإحداثيات', s.lat ? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}` : ''],
        ].map(F)}</dl>
        <div className="atl-site__links">
          {s.lat && <a className="tpl__btn" href={`https://www.google.com/maps?q=${s.lat},${s.lon}`} target="_blank" rel="noreferrer">فتح على الخريطة</a>}
          {s.photo && <a className="tpl__btn" href={s.photo} target="_blank" rel="noreferrer">صورة الموقع</a>}
        </div>
      </div>
    </div>
  );
}

export default function RubbleAtlas({ basemap }) {
  const [data, setData] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [open, setOpen] = useState(null);
  const [limit, setLimit] = useState(15);
  const [onlyReady, setOnlyReady] = useState(false);

  useEffect(() => { getData('rubble-assessment').then((d) => setData(d.sites || [])).catch(() => setData([])); }, []);

  const toggle = (k, v) => setF((c) => {
    const next = { ...c, [k]: v == null ? [] : c[k].includes(v) ? c[k].filter((x) => x !== v) : [...c[k], v] };
    if (k === 'gov') { next.area = []; next.town = []; }
    if (k === 'area') next.town = [];
    return next;
  });

  const sites = useMemo(() => (data || []).filter((s) => match(s, f) && (!onlyReady || ready(s))), [data, f, onlyReady]);
  if (!data) return <p className="results__empty">جارٍ التحميل…</p>;
  if (!data.length) return <div className="rx-empty"><h2>بانتظار البيانات</h2></div>;

  const total = sites.reduce((a, s) => a + s.vol, 0);
  const rdy = sites.filter(ready);
  const geoOpts = (k) => [...new Set(data.filter((s) => match(s, f, k) && (k === 'gov' || true)).map((s) => s[k]).filter(Boolean))].sort()
    .map((v) => ({ value: v, label: v }));

  const byGov = new Map();
  for (const s of data.filter((x) => match(x, f, 'gov') && (!onlyReady || ready(x)))) { const o = byGov.get(s.gov) || { g: s.gov, vol: 0, n: 0 }; o.vol += s.vol; o.n += 1; byGov.set(s.gov, o); }
  const govs = [...byGov.values()].sort((a, b) => b.vol - a.vol);
  const gmax = govs[0]?.vol || 1;

  const codeOf = new Map((basemap?.governorates || []).map((g) => [g.name, g.code]));
  const govFill = Object.fromEntries(govs.map((g) => [codeOf.get(g.g), `rgba(224,115,90,${0.15 + 0.6 * (g.vol / gmax)})`]).filter(([k]) => k));
  const locations = sites.filter((s) => s.lat && s.lon).map((s) => ({
    code: s.id, name: `${[s.village, s.hood].filter(Boolean).join(' — ') || s.town} · ${fmt(s.vol)} م³`, governorate: s.gov,
    lat: s.lat, lon: s.lon, count: Math.max(1, Math.round(Math.sqrt(s.vol / 100))), color: ready(s) ? '#2f9e74' : '#e0a33a',
  }));
  const top = [...sites].sort((a, b) => b.vol - a.vol);
  const active = Object.values(f).some((v) => v.length) || onlyReady;

  return (
    <div className="atl">
      <div className="ov-hero atl-hero">
        <div>
          <span className="rt-kicker">التقييم الميداني · للجهات الراغبة بالمشاركة</span>
          <h2>أين تتوزع الأنقاض في سوريا، وما حجمها؟</h2>
          <p>مواقع تجمّع الأنقاض التي قيّمتها الفرق الميدانية، مع ظروف كل موقع: الوصول، والموافقات، والسلامة، وأقرب مكب.
            اضغط على أي شريط أو محافظة لتصفية الصفحة كلها.</p>
        </div>
        <div className="ov-hero__big"><b>{short(total)}</b><span>م³ أنقاض مقدّرة</span><em>≈ {short(total * 1.35)} طن</em></div>
      </div>

      <div className="ov-kpis atl-kpis">
        <div><span>مواقع مقيّمة</span><b>{fmt(sites.length)}</b></div>
        <div><span>المحافظات</span><b>{fmt(new Set(sites.map((s) => s.gov)).size)}</b></div>
        <div><span>متوسط الموقع</span><b>{short(sites.length ? total / sites.length : 0)}</b><small>م³</small></div>
        <div className="is-ready"><span>جاهزة للعمل فوراً</span><b>{fmt(rdy.length)}</b><small>{short(rdy.reduce((a, s) => a + s.vol, 0))} م³ · وصول سهل + موافقة + مسح ذخائر</small></div>
        <div><span>بلا موافقة على الترحيل</span><b>{fmt(sites.filter((s) => s.approval === 'لا').length)}</b></div>
        <div><span>بلا مسح ذخائر</span><b>{fmt(sites.filter((s) => s.uxo !== 'نعم').length)}</b></div>
      </div>

      <div className="filters atl-filters">
        <div className="filters__fields" style={{ '--n': 3 }}>
          {GEO.map(([k, l, all]) => (
            <div className="ffield" key={k}><span className="ffield__label">{l}</span>
              <Dropdown multi label={l} placeholder={all} value={f[k]} onChange={(v) => setF((c) => ({ ...c, [k]: v, ...(k === 'gov' ? { area: [], town: [] } : k === 'area' ? { town: [] } : {}) }))} options={geoOpts(k)} /></div>
          ))}
        </div>
      </div>
      <div className="atl-bar">
        <label className="gal-toggle"><input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} /> المواقع الجاهزة للعمل فوراً فقط</label>
        {active && <button type="button" className="atl-clear" onClick={() => { setF(EMPTY); setOnlyReady(false); }}>مسح كل الفلاتر</button>}
      </div>

      <div className="atl-main">
        <section className="atl-box atl-mapbox">
          <h3>خريطة المواقع <small><i className="atl-dot" style={{ background: '#2f9e74' }} /> جاهز للعمل <i className="atl-dot" style={{ background: '#e0a33a' }} /> يحتاج متطلبات</small></h3>
          {basemap ? <SyriaMap basemap={basemap} locations={locations} noun="المواقع" govFill={govFill} height={typeof window !== 'undefined' && window.innerWidth < 640 ? 340 : 460} className="rx-map"
            onPickGovernorate={(code) => { const g = basemap.governorates.find((x) => x.code === code)?.name; if (g && byGov.has(g)) toggle('gov', g); }} /> : null}
        </section>
        <section className="atl-box">
          <h3>الكميات حسب المحافظة{f.gov.length > 0 && <button type="button" className="atl-clear" onClick={() => toggle('gov', null)}>إلغاء</button>}</h3>
          <ul className="atl-govs">
            {govs.map((g) => (
              <li key={g.g}>
                <button type="button" className={f.gov.includes(g.g) ? 'is-on' : f.gov.length ? 'is-dim' : ''} onClick={() => toggle('gov', g.g)}>
                  <span className="atl-govs__n">{g.g}<small>{fmt(g.n)} موقع</small></span>
                  <span className="atl-govs__bar"><i style={{ width: `${(g.vol / gmax) * 100}%` }} /></span>
                  <b>{short(g.vol)}</b>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="atl-grid">
        {DIMS.map((d) => <Breakdown key={d.key} dim={d} sites={data.filter((s) => match(s, f, d.key) && (!onlyReady || ready(s)))} f={f} toggle={toggle} />)}
      </div>

      <section className="atl-box">
        <h3>المواقع حسب الكمية <small>{fmt(sites.length)} موقع — اضغط لعرض التفاصيل</small></h3>
        <div className="atl-table">
          <table className="dmg__table">
            <thead><tr><th>#</th><th>الموقع</th><th>المحافظة</th><th>الكمية م³</th><th>الوصول</th><th>الموافقة</th><th>مسح الذخائر</th><th>أقرب مكب</th></tr></thead>
            <tbody>{top.slice(0, limit).map((s, i) => (
              <tr key={s.id} onClick={() => setOpen(s)} className="atl-tr">
                <td>{i + 1}</td><td>{[s.village, s.hood].filter(Boolean).join(' — ') || s.town}<small> · {s.area}</small></td><td>{s.gov}</td>
                <td><b>{fmt(s.vol)}</b></td><td>{s.access}</td><td>{s.approval}</td><td>{s.uxo}</td><td>{s.dump}{s.dumpKm ? ` (${s.dumpKm} كم)` : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <ul className="atl-cards">
          {top.slice(0, limit).map((s, i) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s)}>
                <span className="atl-cards__n">{i + 1}</span>
                <span className="atl-cards__t"><b>{[s.village, s.hood].filter(Boolean).join(' — ') || s.town}</b>
                  <small>{[s.gov, s.area].filter(Boolean).join(' · ')}</small>
                  <span className="atl-cards__tags">
                    <em className={s.access === 'سهل الوصول' ? 'ok' : 'no'}>{s.access}</em>
                    <em className={s.approval === 'نعم' ? 'ok' : 'no'}>{s.approval === 'نعم' ? 'موافقة' : 'بلا موافقة'}</em>
                    <em className={s.uxo === 'نعم' ? 'ok' : 'no'}>{s.uxo === 'نعم' ? 'ممسوح' : 'بلا مسح'}</em>
                  </span>
                </span>
                <span className="atl-cards__v"><b>{short(s.vol)}</b><small>م³</small></span>
              </button>
            </li>
          ))}
        </ul>
        {top.length > limit && <button type="button" className="gal-more" onClick={() => setLimit((n) => n + 30)}>عرض المزيد ({fmt(top.length - limit)})</button>}
      </section>

      <p className="dmg__note">المصدر: استبيان «التقييم الميداني لكميات الأنقاض» — الكميات تقديرات ميدانية أولية قابلة للتحديث. الوزن محسوب بكثافة 1.35 طن/م³.</p>
      {open && <Site s={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
