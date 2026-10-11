import { useEffect, useMemo, useState } from 'react';
import Figure from '../components/Figure';
import Dropdown from '../components/Dropdown';
import SyriaMap from '../components/SyriaMap';
import { rubbleTransferFeed } from './store';
import { getData } from '../data/api';

/*
  مشروع ترحيل الأنقاض — إدارة تقييم الأضرار والتعافي.
  مراحل المشروع (مخطط/منفذ لكل منطقة) + الاستبيانات الميدانية من KoBoToolbox.
  البيانات في data/rubble-transfer.json وتُنسخ إلى public/data عند البناء.
*/

export const RUBBLE_PROJECT = {
  id: 'rubble-transfer',
  name: 'مشروع ترحيل الأنقاض',
  description: 'إدارة تقييم الأضرار والتعافي — متابعة خطة ترحيل الأنقاض عبر المحافظات، والاستبيانات الميدانية، وأداء الجهات المنفذة.',
  surveysCount: 1983,
};

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
/* توحيد الكتابة للمطابقة: ادلب = إدلب، ريف حلب = حلب */
const norm = (s) => String(s ?? '').trim().replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/\s+/g, ' ');
const govKey = (g) => { const n = norm(g); return n === 'ريف حلب' ? 'حلب' : n; };
const GOV_LABEL = { ادلب: 'إدلب', حماه: 'حماة', 'ريف دمشق': 'ريف دمشق' };
const govName = (raw) => {
  /* إجابات المنصة تحمل رمز المحافظة (SY07) */
  const g = (/^SY\d/.test(raw || '') && govNames?.get(raw)) || raw;
  return GOV_LABEL[govKey(g)] ?? govKey(g).replace(/ه$/, 'ة');
};
/* اسم الجهة المنفذة: يُدمج «شركة الفاتح» و«شركة الفاتح للانشاءات» وأخطاء الإملاء الشائعة */
export const coKey = (raw) => {
  const n = norm(raw);
  if (!n) return '';
  if (n.includes('الطوار')) return 'وزاره الطوارئ';
  if (n.includes('الدفاع المدني')) return 'الدفاع المدني';
  /* تُحذف الكلمات العامة و«ال» التعريف، وتُرتّب الكلمات: «ركان فرج عقدي» = «شركة فرج ركان عقدي» */
  return n.replace(/عبد /g, 'عبد').split(' ')
    .filter((w) => !/^(شركه|شركة|موسسه|مؤسسه|المقاول|للمقاولات|المقاولات|للانشاءات|الانشاءات|انشاءات|للاعمار|و)$/.test(w))
    .map((w) => w.replace(/^ال(?=..)/, '').replace(/^ل(?=ل)/, ''))
    .sort().join(' ');
};

let govNames = null;



/* لوحة ألوان المشروع: لون ثابت لكل فئة حتى يُعرف الشيء بلونه في كل الأقسام */
const PAL = ['#2f9e74', '#d4a443', '#e0735a', '#4f8fdc', '#8d6bc9', '#35b3ad', '#d2668f', '#86a23c'];
const PHASE_COLOR = ['#35b3ad', '#d4a443', '#8d6bc9'];
const PHASE_KEYS = ['المرحلة الأولى', 'المرحلة الثانية', 'المرحلة الثالثة'];
const projLabel = (s) => `المشروع ${['', 'الأول', 'الثاني', 'الثالث'][s.p] || ''}`;

/* درجة الإنجاز → لون الخلية في المصفوفة */
const heat = (r, planned) => {
  if (!planned) return 'none';
  if (r >= 100) return 'h4';
  if (r >= 60) return 'h3';
  if (r >= 20) return 'h2';
  if (r > 0) return 'h1';
  return 'h0';
};

function sumBy(list, key, val = () => 1) {
  const m = new Map();
  for (const x of list) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + val(x)); }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

/* ---------------- حلقة الإنجاز ---------------- */

function Ring({ value }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <svg className="rx-ring" viewBox="0 0 180 180" role="img" aria-label={`نسبة الإنجاز ${value}%`}>
      <defs>
        <linearGradient id="rxg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35b3ad" /><stop offset="1" stopColor="#d4a443" />
        </linearGradient>
      </defs>
      <circle cx="90" cy="90" r={r} className="rx-ring__track" />
      <circle cx="90" cy="90" r={r} className="rx-ring__val" stroke="url(#rxg)"
        strokeDasharray={`${(Math.min(100, value) / 100) * c} ${c}`} transform="rotate(-90 90 90)" />
      <text x="90" y="88" className="rx-ring__num">{value}%</text>
      <text x="90" y="112" className="rx-ring__cap">من الخطة منجز</text>
    </svg>
  );
}

/* ---------------- الفلاتر ---------------- */

/*
  كل عنصر في الصفحة قابل للضغط ويضيف/يزيل قيمته من الفلتر (مثل Power BI):
  شرائح الأشرطة، المراحل، خلايا المصفوفة، المناطق، الجهات، نقاط الخريطة، أزرار المحافظات.
  والفلاتر متعددة الاختيار وتُطبَّق على الصفحة كلها.
*/
const DIMS = [
  /* التسلسل الإداري أولاً: المحافظة ← المنطقة ← الناحية، وكل مستوى يتقلص حسب ما فوقه */
  { key: 'gov', label: 'المحافظة', all: 'كل المحافظات' },
  { key: 'area', label: 'المنطقة', all: 'كل المناطق' },
  { key: 'town', label: 'الناحية', all: 'كل النواحي' },
  { key: 'phase', label: 'المرحلة', all: 'كل المراحل' },
  { key: 'nature', label: 'طبيعة الموقع', all: 'كل المواقع' },
  { key: 'co', label: 'الجهة المنفذة', all: 'كل الجهات' },
  { key: 'dump', label: 'وجهة الأنقاض', all: 'كل الوجهات' },
];
const GEO = ['gov', 'area', 'town', 'village'];
const GEO_LABEL = { gov: 'المحافظة', area: 'المنطقة', town: 'الناحية', village: 'القرية' };

/* عند تغيير مستوى أعلى تُزال من المستويات الأدنى القيم التي لم تعد تتبعه */
function prune(f, surveys) {
  const out = { ...f };
  for (const key of ['area', 'town']) {
    if (!out[key].length) continue;
    const parents = GEO.slice(0, GEO.indexOf(key));
    const ok = new Set(surveys.filter((s) => parents.every((p) => !out[p]?.length || out[p].includes(valueOf[p](s))))
      .map((s) => valueOf[key](s)));
    out[key] = out[key].filter((v) => ok.has(v));
  }
  return out;
}
const EMPTY = Object.fromEntries(DIMS.map((d) => [d.key, []]));
const phaseOf = (s) => PHASE_KEYS[(s.p || 1) - 1];
const dumpOf = (s) => (s.dump || '').replace(/\s+/g, ' ');
/* قيمة السجل في كل بُعد */
const valueOf = {
  gov: (s) => govName(s.gov),
  phase: phaseOf,
  nature: (s) => s.nature,
  co: (s) => s.co,
  dump: dumpOf,
  area: (s) => s.area,
  town: (s) => s.town,
  village: (s) => s.village,
};

function matchSurvey(s, f, skip) {
  return DIMS.every(({ key }) => {
    if (key === skip || !f[key].length) return true;
    if (key === 'co') { const k = coKey(s.co); return f.co.some((n) => coKey(n) === k); }
    return f[key].includes(valueOf[key](s));
  });
}
/* صفوف الخطة تتأثر بالمحافظة والمرحلة فقط (لا تحمل بقية الأبعاد) */
const matchPlan = (r, f) => (!f.gov.length || f.gov.includes(govName(r.gov)))
  && (!f.phase.length || f.phase.includes(r.phase));

function FilterBar({ f, setF, surveys, toggle }) {
  const [open, setOpen] = useState(false);
  const opts = (key) => {
    const pool = surveys.filter((s) => matchSurvey(s, f, key));
    const m = new Map();
    for (const s of pool) {
      let v = valueOf[key](s);
      if (key === 'co') v = v || 'غير محدد';
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    for (const v of f[key]) if (!m.has(v)) m.set(v, 0);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: value, count }));
  };
  const active = DIMS.flatMap((d) => f[d.key].map((v) => ({ dim: d, v })));
  return (
    <div className={`rx-filters${open ? ' is-open' : ''}`}>
      {/* على الهاتف تُطوى الفلاتر خلف زر حتى لا تحتل الشاشة الأولى */}
      <button type="button" className="rx-filters__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>الفلاتر{active.length ? <b>{active.length}</b> : null}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div className="rx-filters__grid">
        {DIMS.map((d) => (
          <div className="ffield" key={d.key}>
            <span className="ffield__label">{d.label}</span>
            <Dropdown multi label={d.label} placeholder={d.all} value={f[d.key]}
              onChange={(v) => setF({ ...f, [d.key]: v })} options={opts(d.key)} />
          </div>
        ))}
      </div>
      {active.length > 0 && (
        <div className="rx-active">
          <span>التصفية الحالية:</span>
          {active.map(({ dim, v }) => (
            <button type="button" key={dim.key + v} onClick={() => toggle(dim.key, v)} title="إزالة">
              <small>{dim.label}</small> {v} <b>✕</b>
            </button>
          ))}
          <button type="button" className="rx-active__clear" onClick={() => setF(EMPTY)}>مسح الكل</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- قراءات ذكية ---------------- */

function insights({ govs, surveys, t, contractors }) {
  const out = [];
  const active = govs.filter((g) => g.planned > 0);
  const best = [...active].sort((a, b) => b.rate - a.rate)[0];
  if (best) out.push({ tone: 0, icon: '▲', text: <>محافظة <b>{best.name}</b> الأعلى إنجازاً بنسبة <b>{best.rate}%</b> من مخططها.</> });
  const remaining = active.map((g) => ({ ...g, rem: Math.max(0, g.planned - g.executed) })).filter((g) => g.rem > 0).sort((a, b) => b.rem - a.rem);
  const remTotal = remaining.reduce((a, g) => a + g.rem, 0);
  if (remaining.length > 1) {
    const top = remaining.slice(0, Math.min(3, remaining.length));
    out.push({ tone: 2, icon: '◎', text: <><b>{pct(top.reduce((a, g) => a + g.rem, 0), remTotal)}%</b> من الكميات المتبقية تتركز في {top.map((g) => g.name).join(' و')}.</> });
  }
  const idle = active.filter((g) => g.executed === 0);
  if (idle.length) out.push({ tone: 3, icon: '◷', text: <>{idle.length === 1 ? 'محافظة واحدة' : `${idle.length} محافظات`} لم يبدأ فيها التنفيذ ({idle.map((g) => g.name).join('، ')}) بمخطط <b>{fmt(idle.reduce((a, g) => a + g.planned, 0))} م³</b>.</> });
  if (surveys.length) {
    if (!active.length) {
      const byGov = sumBy(surveys, (x) => govName(x.gov), (x) => x.vol);
      if (byGov[0]) out.push({ tone: 0, icon: '▲', text: <>محافظة <b>{byGov[0].label}</b> الأعلى ترحيلاً بـ<b>{fmt(byGov[0].value)} م³</b>، أي <b>{pct(byGov[0].value, t.surveyVol)}%</b> من الإجمالي.</> });
      const byPhase = sumBy(surveys, phaseOf, (x) => x.vol);
      if (byPhase.length > 1) out.push({ tone: 3, icon: '◷', text: <><b>{byPhase[0].label}</b> تستأثر بـ<b>{pct(byPhase[0].value, t.surveyVol)}%</b> من الكميات الموثقة.</> });
    }
    const roads = surveys.filter((s) => /طريق/.test(s.nature)).length;
    out.push({ tone: 5, icon: '⇢', text: <><b>{pct(roads, surveys.length)}%</b> من المواقع الموثقة طرق رئيسية وفرعية.</> });
    const localVol = surveys.filter((s) => s.dump && !/معتمد/.test(s.dump)).reduce((a, s) => a + s.vol, 0);
    if (localVol) out.push({ tone: 2, icon: '!', text: <><b>{pct(localVol, t.surveyVol)}%</b> من الأنقاض الموثقة نُقلت إلى مواقع مقترحة محلياً لا إلى مكبات معتمدة.</> });
    if (contractors.length > 1) {
      const n = Math.min(5, contractors.length);
      out.push({ tone: 4, icon: '★', text: <>أكبر {n} جهات رحّلت <b>{pct(contractors.slice(0, n).reduce((a, c) => a + c.vol, 0), t.surveyVol)}%</b> من الكميات الموثقة، وتتصدرها <b>{contractors[0].name}</b>.</> });
    }
    out.push({ tone: 1, icon: '≈', text: <>متوسط الكمية في الموقع الواحد <b>{fmt(t.surveyVol / surveys.length)} م³</b>.</> });
  }
  return out;
}


/* اختصار الأحجام الكبيرة: 1.2M / 845K */
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : fmt(n));
/* درجة الكثافة للحجم الموثّق (حين لا توجد خطة): نسبة إلى أكبر خلية */
const vheat = (v, max) => (!v ? 'none' : `v${Math.min(4, Math.max(1, Math.ceil((v / (max || 1)) * 4)))}`);

/* حلقة توزيع الكميات على المراحل (بديل حلقة الإنجاز حين لا توجد خطة) */
function PhaseDonut({ phases, total }) {
  const r = 70; const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg className="rx-ring" viewBox="0 0 180 180" role="img" aria-label="توزيع الكميات على المراحل">
      <circle cx="90" cy="90" r={r} className="rx-ring__track" />
      {phases.map((p, i) => {
        const len = total ? (p.executed / total) * c : 0;
        const el = len > 0 ? <circle key={p.key} cx="90" cy="90" r={r} fill="none" stroke={PHASE_COLOR[i]} strokeWidth="16"
          strokeDasharray={`${Math.max(0, len - 3)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 90 90)" /> : null;
        off += len;
        return el;
      })}
      <text x="90" y="88" className="rx-ring__num" style={{ fontSize: 28 }}>{short(total)}</text>
      <text x="90" y="112" className="rx-ring__cap">م³ مرحّلة</text>
    </svg>
  );
}

/* ---------------- الأقسام ---------------- */

function Summary({ t, items, filtered, plan, phases, counts }) {
  return (
    <section className="rx-top">
      <div className="rx-top__ring">{plan ? <Ring value={pct(t.executed, t.planned)} /> : <PhaseDonut phases={phases} total={t.surveyVol} />}</div>
      {!plan ? (
        <div className="rx-top__nums">
          <div className="rx-num rx-num--b"><span>الأنقاض المرحّلة</span><Figure value={t.surveyVol} className="rx-num__v" /><em>م³ موثّقة ميدانياً</em></div>
          <div className="rx-num rx-num--d"><span>مواقع العمل</span><Figure value={t.surveys} className="rx-num__v" /><em>استمارة ميدانية</em></div>
          <div className="rx-num rx-num--a"><span>المحافظات</span><Figure value={counts.govs} className="rx-num__v" /><em>{fmt(counts.areas)} منطقة</em></div>
          <div className="rx-num rx-num--c"><span>الجهات المنفذة</span><Figure value={counts.cos} className="rx-num__v" /><em>جهة</em></div>
        </div>
      ) : <div className="rx-top__nums">
        <div className="rx-num rx-num--a"><span>المخطط ترحيله</span><Figure value={t.planned} className="rx-num__v" /><em>م³</em></div>
        <div className="rx-num rx-num--b"><span>تم ترحيله</span><Figure value={t.executed} className="rx-num__v" /><em>م³</em></div>
        <div className="rx-num rx-num--c"><span>بانتظار الترحيل</span><Figure value={Math.max(0, t.planned - t.executed)} className="rx-num__v" /><em>م³</em></div>
        <div className="rx-num rx-num--d"><span>مواقع موثّقة ميدانياً</span><Figure value={t.surveys} className="rx-num__v" /><em>{fmt(t.surveyVol)} م³ موثّقة</em></div>
      </div>}
      <div className="rx-insights">
        <h3>ماذا تقول الأرقام؟ {filtered && <small>(ضمن التصفية الحالية)</small>}</h3>
        <ul>
          {items.map((x, i) => (
            <li key={i} style={{ '--c': PAL[x.tone] }}><span className="rx-insights__ic">{x.icon}</span><p>{x.text}</p></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PhaseRibbon({ phases, f, toggle, plan }) {
  const size = (p) => (plan ? p.planned : p.executed);
  const total = phases.reduce((a, p) => a + size(p), 0) || 1;
  const on = (k) => f.phase.includes(k);
  const dim = f.phase.length > 0;
  return (
    <section className="rx-block">
      <header className="rx-head"><h2>مسار المراحل الثلاث</h2><p>{plan ? 'عرض كل مرحلة بحجمها المخطط، والجزء الملوّن ما أُنجز منها.' : 'عرض كل مرحلة بحجم ما رُحّل فيها فعلاً.'} اضغط مرحلة لتصفية الصفحة عليها.</p></header>
      <div className="rx-ribbon">
        {phases.filter((p) => size(p) > 0).map((p) => (
          <button type="button" key={p.key} className={`rx-ribbon__seg${dim && !on(p.key) ? ' is-dim' : ''}${on(p.key) ? ' is-on' : ''}`}
            style={{ flexGrow: size(p) / total, '--c': PHASE_COLOR[PHASE_KEYS.indexOf(p.key)] }} onClick={() => toggle('phase', p.key)}>
            <span className="rx-ribbon__fill" style={{ width: `${plan ? Math.min(100, p.rate) : 100}%` }} />
            <span className={`rx-ribbon__pct${plan && p.rate < 50 ? ' is-low' : ''}`}>{plan ? `${p.rate}%` : `${pct(p.executed, total)}%`}</span>
          </button>
        ))}
      </div>
      <div className="rx-phases">
        {phases.map((p, i) => (
          <button type="button" key={p.key} className={`rx-phase${dim && !on(p.key) ? ' is-dim' : ''}`} style={{ '--c': PHASE_COLOR[i] }} onClick={() => toggle('phase', p.key)}>
            <span className="rx-dot" />
            <span>
              <b className="rx-phase__t">{p.title} <small>{!plan ? `${fmt(p.sites)} موقعاً` : !p.planned ? '—' : p.rate >= 100 ? 'منجزة' : p.executed > 0 ? 'قيد التنفيذ' : 'إعداد وتجهيز'}</small></b>
              <span className="rx-phase__d"><b>{fmt(p.executed)}</b>{plan ? ` من ${fmt(p.planned)}` : ''} م³{p.govs.length ? ` — ${p.govs.join('، ')}` : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Matrix({ govs, f, toggle, setF, plan }) {
  const [open, setOpen] = useState(null);
  const cellOf = (g, k) => {
    const rs = g.regions.filter((r) => r.phase === k);
    return { pl: rs.reduce((a, r) => a + r.planned, 0), ex: rs.reduce((a, r) => a + r.executed, 0) };
  };
  const maxCell = Math.max(1, ...govs.flatMap((g) => PHASE_KEYS.map((k) => cellOf(g, k).ex)));
  const maxGov = Math.max(1, ...govs.map((g) => g.executed));
  return (
    <section className="rx-block">
      <header className="rx-head">
        <h2>المحافظات عبر المراحل</h2>
        <p>{plan ? 'كل خلية نسبة الإنجاز في محافظة ضمن مرحلة.' : 'كل خلية حجم الأنقاض المرحّلة (م³) في محافظة ضمن مرحلة، وكلما اشتد اللون زاد الحجم.'} اضغط اسم المحافظة أو أي خلية لتصفية الصفحة عليها، والسهم يعرض مناطقها.</p>
      </header>
      {plan ? (
        <div className="rx-legend">
          <span className="h0">لم يبدأ</span><span className="h1">أقل من 20%</span><span className="h2">20–59%</span><span className="h3">60–99%</span><span className="h4">مكتمل</span>
        </div>
      ) : (
        <div className="rx-legend"><span>أقل</span><span className="v1">&nbsp;</span><span className="v2">&nbsp;</span><span className="v3">&nbsp;</span><span className="v4">&nbsp;</span><span>أكثر</span></div>
      )}
      <div className="rx-matrix" role="table">
        <div className="rx-matrix__row rx-matrix__row--head" role="row">
          <span role="columnheader">المحافظة</span>
          {PHASE_KEYS.map((k, i) => <span key={k} role="columnheader" style={{ color: PHASE_COLOR[i] }}>{k}</span>)}
          <span role="columnheader">الإجمالي</span>
        </div>
        {govs.map((g) => (
          <div key={g.key} className="rx-matrix__group">
            <div className={`rx-matrix__row${f.gov.includes(g.name) ? ' is-on' : ''}`} role="row">
              <span className="rx-matrix__govcell">
                <button type="button" className="rx-matrix__gov" onClick={() => toggle('gov', g.name)}>
                  {g.name}<small>{plan ? `${fmt(g.planned)} م³` : `${fmt(g.sites)} موقعاً`}</small>
                </button>
                <button type="button" className="rx-matrix__exp" aria-expanded={open === g.key} aria-label="عرض المناطق"
                  onClick={() => setOpen(open === g.key ? null : g.key)}>▾</button>
              </span>
              {PHASE_KEYS.map((k) => {
                const { pl, ex } = cellOf(g, k);
                const r = pct(ex, pl);
                if (!plan) {
                  return ex ? (
                    <button type="button" key={k} className={`rx-cell rx-cell--${vheat(ex, maxCell)}`} title={`${fmt(ex)} م³`}
                      onClick={() => setF({ ...f, gov: [g.name], phase: [k] })}>{short(ex)}</button>
                  ) : <span key={k} className="rx-cell rx-cell--none">—</span>;
                }
                return pl ? (
                  <button type="button" key={k} className={`rx-cell rx-cell--${heat(r, pl)}`} title={`${fmt(ex)} من ${fmt(pl)} م³`}
                    onClick={() => setF({ ...f, gov: [g.name], phase: [k] })}>
                    {r}%<small>{fmt(pl)}</small>
                  </button>
                ) : <span key={k} className="rx-cell rx-cell--none">—</span>;
              })}
              {plan
                ? <span role="cell" className={`rx-cell rx-cell--total rx-cell--${heat(g.rate, g.planned)}`}>{g.rate}%</span>
                : <span role="cell" className={`rx-cell rx-cell--total rx-cell--${vheat(g.executed, maxGov)}`}>{short(g.executed)}</span>}
            </div>
            {open === g.key && (
              <ul className="rx-regions">
                <li className="rx-regions__head">{plan ? `تفاصيل ${g.name} حسب المرحلة: الشريط يمثل نسبة ما نُفّذ من الكمية المخطط لها، مع ملاحظات المتابعة من التقرير المرحلي` : `مناطق ${g.name}: الشريط يمثل حصة كل منطقة من كميات المحافظة المرحّلة`}</li>
                {g.regions.filter((r) => (plan ? r.planned > 0 : r.executed > 0)).sort((a, b) => (plan ? 0 : b.executed - a.executed)).map((r, i) => (
                  <li key={i} style={{ '--c': PHASE_COLOR[PHASE_KEYS.indexOf(r.phase)] }}>
                    <b>{plan ? r.phase : r.region}{!plan && <small className="rx-regions__ph"> · {r.phase}</small>}</b>
                    <span className="rx-mini" title={plan ? 'نسبة المنفّذ من المخطط له' : 'الحصة من كميات المحافظة'}><span style={{ width: `${Math.min(100, plan ? pct(r.executed, r.planned) : (r.executed / g.executed) * 100)}%` }} /></span>
                    <span className="rx-regions__n">{plan
                      ? <>منفّذ <strong>{fmt(r.executed)}</strong> من <strong>{fmt(r.planned)}</strong> م³ مخطط له · <strong>{pct(r.executed, r.planned).toFixed(1)}%</strong></>
                      : `${fmt(r.executed)} م³`}</span>
                    {r.notes && <em><span className="rx-regions__lbl">ملاحظات المتابعة: </span>{r.notes}</em>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {govs.length === 0 && <p className="rt-empty">لا توجد مراحل ضمن التصفية الحالية.</p>}
      </div>
    </section>
  );
}

/* شريط نسب قابل للضغط: كل شريحة ومفتاحها يصفّيان على قيمتهما */
function Stack({ data, total, unit, dim, f, toggle, colors = PAL }) {
  const sel = f[dim] || [];
  const isOff = (l) => sel.length > 0 && !sel.includes(l);
  return (
    <>
      <div className="rx-stack">
        {data.map((d, i) => (
          <button type="button" key={d.label} className={isOff(d.label) ? 'is-dim' : ''} style={{ flexGrow: d.value, background: colors[i % colors.length] }}
            title={`${d.label}: ${fmt(d.value)} ${unit}`} onClick={() => toggle(dim, d.label)} />
        ))}
      </div>
      <ul className="rx-keys">
        {data.map((d, i) => (
          <li key={d.label}>
            <button type="button" className={`${isOff(d.label) ? 'is-dim' : ''}${sel.includes(d.label) ? ' is-on' : ''}`} onClick={() => toggle(dim, d.label)}>
              <i style={{ background: colors[i % colors.length] }} />{d.label}<b>{pct(d.value, total)}%</b><small>{fmt(d.value)} {unit}</small>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/* هل النقطة داخل حدود سوريا؟ (ray casting على MultiPolygon من basemap.country) */
function inside(poly, x, y) {
  let hit = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}
function inSyria(basemap, lon, lat) {
  const geoms = (basemap?.country || []).map((c) => c.g);
  if (!geoms.length) return true;
  return geoms.some((g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some((poly) => inside(poly, lon, lat)));
}
/* تصحيح الإحداثيات: المقلوبة تُعدَّل، وما خارج الحدود يُستبعد من الخريطة */
function placed(basemap, s) {
  if (!s.lat || !s.lon) return null;
  if (inSyria(basemap, s.lon, s.lat)) return [s.lat, s.lon];
  if (inSyria(basemap, s.lat, s.lon)) return [s.lon, s.lat];
  return null;
}

/*
  الكميات حسب المستوى الإداري: يعرض دائماً المستوى التالي لما هو مختار —
  لا شيء ← المحافظات، محافظة ← مناطقها، منطقة ← نواحيها، ناحية ← قراها.
  الضغط على أي صف ينزل مستوى، و«الشريط» أعلاه يعيد إلى أي مستوى سابق.
*/
function Levels({ surveys, f, setF }) {
  const depth = GEO.findIndex((k) => k !== 'village' && f[k]?.length !== 1);
  const level = GEO[depth === -1 ? 3 : depth];
  const rows = sumBy(surveys, (s) => valueOf[level](s), (s) => s.vol);
  const sites = new Map(sumBy(surveys, (s) => valueOf[level](s)).map((d) => [d.label, d.value]));
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const peak = rows[0]?.value || 1;
  const crumbs = [{ label: 'سوريا', go: () => setF({ ...f, gov: [], area: [], town: [] }) }];
  for (const k of ['gov', 'area', 'town']) {
    if (f[k].length === 1) {
      const i = GEO.indexOf(k);
      crumbs.push({ label: f[k][0], go: () => setF({ ...f, ...Object.fromEntries(GEO.slice(i + 1, 3).map((x) => [x, []])) }) });
    } else break;
  }
  const drill = (v) => { if (level !== 'village') setF({ ...f, [level]: [v] }); };
  return (
    <section className="rx-block">
      <header className="rx-head">
        <h2>الكميات حسب المستوى الإداري</h2>
        <p>الكميات المرحّلة على المستوى التالي للاختيار الحالي. اضغط أي صف للنزول مستوى.</p>
      </header>
      <nav className="rx-crumbs" aria-label="المستوى الجغرافي">
        {crumbs.map((c, i) => (
          <span key={c.label}>
            {i > 0 && <i>‹</i>}
            <button type="button" className={i === crumbs.length - 1 ? 'is-on' : ''} onClick={c.go}>{c.label}</button>
          </span>
        ))}
        <small>{GEO_LABEL[level]} · {fmt(rows.length)}</small>
      </nav>
      <ol className="rx-levels">
        {rows.slice(0, 15).map((r, i) => (
          <li key={r.label}>
            <button type="button" onClick={() => drill(r.label)} disabled={level === 'village'} style={{ '--c': PAL[i % PAL.length] }}>
              <span className="rx-levels__n">{i + 1}</span>
              <span className="rx-levels__name">{r.label}<small>{fmt(sites.get(r.label))} موقعاً</small></span>
              <span className="rx-levels__bar"><span style={{ width: `${(r.value / peak) * 100}%` }} /></span>
              <b>{fmt(r.value)}<small> م³ · {pct(r.value, total)}%</small></b>
            </button>
          </li>
        ))}
      </ol>
      {rows.length > 15 && <p className="rx-foot">وأخرى ({fmt(rows.length - 15)}) بكميات أصغر — استخدم الفلاتر أو البحث في سجل المواقع.</p>}
    </section>
  );
}

/* تدرّج الكثافة للمحافظات: من فاتح إلى أخضر الهوية العميق */
const SCALE = ['#e6f2ee', '#bfe1d6', '#8cc9b8', '#55a996', '#2f8a77', '#126b5b'];

function Field({ surveys, allSurveys, basemap, t, f, toggle }) {
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const pts = useMemo(() => {
    const m = new Map();
    let outside = 0;
    for (const s of surveys) {
      const ll = placed(basemap, s);
      if (!ll) { if (s.lat && s.lon) outside += 1; continue; }
      const code = `${ll[0].toFixed(3)},${ll[1].toFixed(3)}`;
      const cur = m.get(code) || { code, name: [s.village || s.town, s.area].filter(Boolean).join(' — '), governorate: govName(s.gov), lat: ll[0], lon: ll[1], count: 0 };
      cur.count += 1;
      m.set(code, cur);
    }
    return { list: [...m.values()].sort((a, b) => b.count - a.count), outside };
  }, [surveys, basemap]);

  /* إطار الخريطة على منطقة العمل (من كل المواقع لا المصفّاة، حتى لا يقفز الإطار مع كل ضغطة) */
  const fit = useMemo(() => {
    const ll = allSurveys.map((s) => placed(basemap, s)).filter(Boolean);
    if (!ll.length) return null;
    const lats = ll.map((x) => x[0]); const lons = ll.map((x) => x[1]);
    /* هامش، وحدّ أدنى للإطار حتى لا تُكبَّر الخريطة على نقطة واحدة */
    const pad = 0.35;
    const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const hLat = Math.max(1.2, (Math.max(...lats) - Math.min(...lats)) / 2 + pad);
    const hLon = Math.max(1.5, (Math.max(...lons) - Math.min(...lons)) / 2 + pad);
    return { minLat: cLat - hLat, maxLat: cLat + hLat, minLon: cLon - hLon, maxLon: cLon + hLon };
  }, [allSurveys, basemap]);

  const gov = sumBy(surveys, (s) => govName(s.gov), (s) => s.vol);
  const govFill = useMemo(() => {
    if (!basemap) return null;
    const peak = gov[0]?.value || 1;
    const out = {};
    for (const g of basemap.governorates) {
      const v = gov.find((x) => x.label === govName(g.name))?.value || 0;
      if (v) out[g.code] = SCALE[Math.min(SCALE.length - 1, Math.ceil((v / peak) * (SCALE.length - 1)))];
    }
    return out;
  }, [basemap, gov]);

  const nature = sumBy(surveys, (s) => s.nature, (s) => s.vol);
  const dump = sumBy(surveys, dumpOf, (s) => s.vol);
  const areas = sumBy(surveys, (s) => s.area, (s) => s.vol).slice(0, 8);

  return (
    <section className="rx-block">
      <header className="rx-head"><h2>من الميدان</h2><p>ما وثّقته الاستمارات. اضغط أي شريحة أو منطقة أو نقطة على الخريطة لتصفية الصفحة.</p></header>
      {basemap && (
        <div className="rx-mapcard">
          <div className="rx-mapcard__legend">
            <span>كثافة الكميات بالمحافظة</span>
            <span className="rx-scale">{SCALE.map((c) => <i key={c} style={{ background: c }} />)}</span>
            <span className="rx-mapcard__dot"><i /> موقع عمل (الحجم = عدد الاستمارات)</span>
            {pts.outside > 0 && <span className="rx-mapcard__warn">{fmt(pts.outside)} استمارة بإحداثيات خارج الحدود لم تُرسم</span>}
          </div>
          <SyriaMap basemap={basemap} locations={pts.list} noun="الاستمارات" className="rx-map" height={narrow ? 400 : 520}
            fit={fit} govFill={govFill} onPickGovernorate={(g) => toggle('gov', govName(g))} />
        </div>
      )}
      <div className="rx-trio">
        <div className="rx-card"><h3>الكميات حسب المحافظة</h3><Stack data={gov} total={t.surveyVol} unit="م³" dim="gov" f={f} toggle={toggle} /></div>
        <div className="rx-card"><h3>نوع الموقع</h3><Stack data={nature} total={t.surveyVol} unit="م³" dim="nature" f={f} toggle={toggle} /></div>
        <div className="rx-card"><h3>وجهة الأنقاض</h3><Stack data={dump} total={t.surveyVol} unit="م³" dim="dump" f={f} toggle={toggle} colors={['#e0735a', '#2f9e74', '#4f8fdc']} /></div>
      </div>
      <div className="rx-card">
        <h3>المناطق الأكثر ترحيلاً</h3>
        <div className="rx-tiles">
          {areas.map((a, i) => (
            <button type="button" key={a.label} className={`rx-tile${f.area.length && !f.area.includes(a.label) ? ' is-dim' : ''}${f.area.includes(a.label) ? ' is-on' : ''}`}
              style={{ '--c': PAL[i % PAL.length] }} onClick={() => toggle('area', a.label)}>
              <span>{a.label}</span><b>{fmt(a.value)}</b><small>م³</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contractors({ list, total, f, toggle }) {
  const [all, setAll] = useState(false);
  const top = list[0]?.vol || 1;
  const shown = all ? list : list.slice(0, 8);
  const rest = list.slice(8);
  const on = (n) => f.co.some((x) => coKey(x) === coKey(n));
  return (
    <section className="rx-block">
      <header className="rx-head"><h2>من نفّذ العمل؟</h2><p>الجهات حسب الكميات الموثقة (دُمجت التسميات المختلفة للجهة الواحدة). اضغط جهة لتصفية الصفحة عليها.</p></header>
      <ol className="rx-cos">
        {shown.map((c, i) => (
          <li key={c.name}>
            <button type="button" className={`${f.co.length && !on(c.name) ? 'is-dim' : ''}${on(c.name) ? ' is-on' : ''}`} style={{ '--c': PAL[i % PAL.length] }} onClick={() => toggle('co', c.name)}>
              <span className="rx-cos__n">{i + 1}</span>
              <span className="rx-cos__name">{c.name}<small>{fmt(c.count)} موقعاً · {[...c.govs].join('، ')}</small></span>
              <span className="rx-cos__bar"><span style={{ width: `${(c.vol / top) * 100}%` }} /></span>
              <b>{fmt(c.vol)}<small> م³ · {pct(c.vol, total)}%</small></b>
            </button>
          </li>
        ))}
      </ol>
      {list.length === 0 && <p className="rt-empty">لا توجد جهات ضمن التصفية الحالية.</p>}
      {rest.length > 0 && (
        <button type="button" className="rx-more" onClick={() => setAll(!all)}>
          {all ? 'عرض أهم 8 جهات فقط' : `وبقية الجهات (${rest.length}) مجتمعةً ${pct(rest.reduce((a, c) => a + c.vol, 0), total)}% — عرض الكل`}
        </button>
      )}
    </section>
  );
}

function Registry({ surveys, f, toggle, allSurveys }) {
  const [q, setQ] = useState('');
  const [n, setN] = useState(12);
  const [view, setView] = useState(null);
  const govs = sumBy(allSurveys, (s) => govName(s.gov));
  const list = useMemo(() => {
    const k = norm(q);
    return surveys.filter((s) => !k || norm([s.co, s.by, s.area, s.town, s.village, s.addr, s.id].join(' ')).includes(k))
      .sort((a, b) => b.vol - a.vol);
  }, [surveys, q]);

  return (
    <section className="rx-block">
      <header className="rx-head"><h2>سجل المواقع</h2><p>{fmt(list.length)} موقعاً ضمن التصفية، مرتّبة من الأكبر كمية. اضغط أي موقع لتفاصيله.</p></header>
      <div className="rx-reg__bar">
        <input className="rt-search" type="search" value={q} placeholder="ابحث باسم الجهة أو القرية أو رقم الاستمارة…"
          onChange={(e) => { setQ(e.target.value); setN(12); }} />
        <div className="rx-chips">
          {govs.map((g, i) => (
            <button type="button" key={g.label} style={{ '--c': PAL[i % PAL.length] }} className={f.gov.includes(g.label) ? 'is-on' : ''}
              onClick={() => { toggle('gov', g.label); setN(12); }}>{g.label} <small>{fmt(g.value)}</small></button>
          ))}
        </div>
      </div>
      <div className="rx-sites">
        {list.slice(0, n).map((s) => (
          <button type="button" key={`${s.p}-${s.id}`} className="rx-site" onClick={() => setView(s)}>
            <span className="rx-site__vol">{fmt(s.vol)}<small>م³</small></span>
            <span className="rx-site__main">
              <b>{[s.village || s.town, s.area].filter(Boolean).join(' — ')}</b>
              <small>{govName(s.gov)} · {s.nature} · {s.co}</small>
            </span>
            <span className="rx-site__tag">{phaseOf(s)}</span>
          </button>
        ))}
        {list.length === 0 && <p className="rt-empty">لا نتائج.</p>}
      </div>
      {list.length > n && <button type="button" className="rx-more" onClick={() => setN(n + 24)}>عرض المزيد ({fmt(list.length - n)} متبقٍ)</button>}
      {view && <SurveyModal s={view} onClose={() => setView(null)} />}
    </section>
  );
}

function F({ k, v, strong }) {
  return v ? <div><dt>{k}</dt><dd className={strong ? 'is-strong' : ''}>{v}</dd></div> : null;
}

function SurveyModal({ s, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const photos = [['قبل البدء', s.photos?.[0]], ['أثناء التنفيذ', s.photos?.[1]], ['بعد الانتهاء', s.photos?.[2]]].filter((p) => p[1]);
  return (
    <div className="rt-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="rt-modal__box" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <span className="rt-kicker">استبيان ميداني رقم #{s.id}</span>
            <h3>{[s.village || s.town, s.area].filter(Boolean).join(' — ')}</h3>
            <p>{projLabel(s)} — محافظة {govName(s.gov)}</p>
          </div>
          <button type="button" className="rt-modal__x" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>
        <div className="rt-modal__vol"><Figure value={s.vol} className="rt-modal__fig" /> <span>م³ مرحّلة من الموقع</span></div>
        <dl className="rt-modal__grid">
          <F k="طبيعة الموقع" v={s.nature} />
          <F k="عنوان الموقع" v={s.addr} />
          <F k="الجهة المنفذة" v={s.co} strong />
          <F k="مدلي البيانات" v={s.by} />
          <F k="جهة الترحيل" v={s.dump.replace(/\s+/g, ' ')} />
          <F k="المسافة إلى المكب" v={s.dist} />
          <F k="اسم المكب / الموقع" v={s.dumpName} />
          <F k="عدد الإيصالات" v={s.receipts ? fmt(s.receipts) : null} />
          <F k="عدد الآليات" v={s.machines ? fmt(s.machines) : null} />
          <F k="الجهة المورّدة للآليات" v={s.supplier} />
          <F k="آليات التحميل" v={s.loaders ? fmt(s.loaders) : null} />
          <F k="أكبر سعة للآليات" v={s.capacity ? `${fmt(s.capacity)} م³` : null} />
          <F k="الرحلات إلى المكب" v={s.trips ? fmt(s.trips) : null} />
          <F k="أيام العمل × الساعات اليومية" v={s.days ? `${fmt(s.days)} يوم × ${s.dailyHours ?? '—'} ساعة` : null} />
          <F k="ساعات العمل اليومية" v={!s.days && s.dailyHours ? `${s.dailyHours} ساعة` : null} />
          <F k="ساعات العمل الفعلية" v={s.workHours ? `${fmt(s.workHours)} ساعة` : null} />
          <F k="الإنتاجية" v={s.workHours ? `${fmt(s.vol / s.workHours)} م³/ساعة` : null} strong />
          <F k="آليات النقار" v={s.breakers ? fmt(s.breakers) : null} />
          <F k="العمال" v={s.workers ? fmt(s.workers) : null} />
          <F k="الوقود" v={s.fuel ? `${fmt(s.fuel)} لتر` : null} />
          <F k="ملاحظات التنفيذ" v={s.notes} />
          <F k="ساعات عمل الآليات" v={s.hours ? `${fmt(s.hours)} ساعة` : null} />
          <F k="الأسر المستفيدة" v={s.fam ? fmt(s.fam) : null} />
          <F k="تاريخ رفع البيانات" v={s.date} />
          <F k="الإحداثيات" v={s.lat ? `${s.lat}, ${s.lon}` : null} />
          <F k="المصدر" v={s.live ? `استبيان المنصة${s.hasPhotos ? ' — الصور في مساحة العمل' : ''}` : 'KoBoToolbox'} />
        </dl>
        {photos.length > 0 && (
          <div className="rt-modal__photos">
            {photos.map(([label, url]) => (
              <a key={label} href={url} target="_blank" rel="noreferrer">صورة {label} ↗</a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* إجابة من استبيان المنصة ← صف بنفس شكل بيانات KoBo */
export function fromResponse(r, i) {
  const a = r.answers || {};
  const code = a.rt_gov?.governorate || '';
  return {
    id: `م-${i + 1}`, rid: r.id, p: Number(a.rt_phase) || 3, live: true,
    date: a.rt_date || String(r.submittedAt || '').slice(0, 10),
    by: a.rt_collector || '', co: a.rt_contractor || 'غير محدد', nature: a.rt_nature || '',
    addr: a.rt_address || '', gov: code, area: a.rt_gov?.names?.district || a.rt_area || '',
    town: a.rt_gov?.names?.subdistrict || a.rt_town || '', village: a.rt_gov?.names?.community || a.rt_village || '',
    lat: Number(a.rt_point?.lat) || 0, lon: Number(a.rt_point?.lng) || 0,
    vol: Number(a.rt_volume) || 0, dump: a.rt_dump || '', dist: a.rt_distance || '',
    hours: Number(a.rt_hours) || null, fam: Number(a.rt_families) || null, photos: [],
    hasPhotos: Boolean(r.photos),
    /* بيانات التشغيل والإنتاجية (أُضيفت للاستمارة الرسمية) */
    receipts: Number(a.rt_receipts) || null,
    trips: Number(a.rt_trips) || null,
    loaders: Number(a.rt_loaders) || null,
    machines: Number(a.rt_machines_total) || null,
    capacity: Number(a.rt_max_capacity) || null,
    days: Number(a.rt_work_days) || null,
    dailyHours: Number(a.rt_daily_hours) || null,
    workHours: (Number(a.rt_work_days) || 0) * (Number(a.rt_daily_hours) || 0) || null,
    breakers: Number(a.rt_breakers) || null,
    workers: Number(a.rt_workers) || null,
    fuel: Number(a.rt_fuel) || null,
    notes: a.rt_ops_notes || '',
    supplier: a.rt_supplier_same === 'لا' ? (a.rt_supplier || '') : '',
  };
}

/*
  التشغيل والإنتاجية: تُحسب كل نسبة من المواقع التي سجّلت حقلَيها معاً فقط
  (مثلاً م³/رحلة من المواقع التي فيها رحلات وكمية)، وإلا كانت النسبة مضلِّلة.
*/
function ratio(list, num, den) {
  const ok = list.filter((s) => num(s) > 0 && den(s) > 0);
  const a = ok.reduce((x, s) => x + num(s), 0);
  const b = ok.reduce((x, s) => x + den(s), 0);
  return { value: b ? a / b : 0, n: ok.length };
}

function Productivity({ surveys, f, toggle }) {
  const sum = (k) => surveys.reduce((a, s) => a + (s[k] || 0), 0);
  const covered = (k) => surveys.filter((s) => s[k]).length;
  const perHour = ratio(surveys, (s) => s.vol, (s) => s.workHours);
  const perTrip = ratio(surveys, (s) => s.vol, (s) => s.trips || s.receipts);
  const perMachine = ratio(surveys, (s) => s.vol, (s) => s.machines);
  const tiles = [
    { label: 'الإيصالات', value: sum('receipts'), unit: 'إيصال', n: covered('receipts'), c: PAL[1] },
    { label: 'الرحلات إلى المكبات', value: sum('trips'), unit: 'رحلة', n: covered('trips'), c: PAL[3] },
    { label: 'ساعات العمل الفعلية', value: sum('workHours'), unit: 'ساعة', n: covered('workHours'), c: PAL[4] },
    { label: 'الإنتاجية', value: perHour.value, unit: 'م³ / ساعة', n: perHour.n, c: PAL[0] },
    { label: 'متوسط حمولة الرحلة', value: perTrip.value, unit: 'م³ / رحلة', n: perTrip.n, c: PAL[5] },
    { label: 'إنتاج الآلية الواحدة', value: perMachine.value, unit: 'م³ / آلية', n: perMachine.n, c: PAL[2] },
  ];
  /* ترتيب الجهات بالإنتاجية (م³/ساعة) لمن سجّلت ساعات عمل */
  const cm = new Map();
  for (const s of surveys) {
    if (!(s.workHours > 0 && s.vol > 0)) continue;
    const k = coKey(s.co);
    const c = cm.get(k) || { name: s.co, vol: 0, hours: 0, n: 0 };
    c.vol += s.vol; c.hours += s.workHours; c.n += 1;
    cm.set(k, c);
  }
  const ranks = [...cm.values()].filter((c) => c.n >= 2).map((c) => ({ ...c, rate: c.vol / c.hours })).sort((a, b) => b.rate - a.rate).slice(0, 8);
  const top = ranks[0]?.rate || 1;
  const any = tiles.some((t) => t.n);

  return (
    <section className="rx-block">
      <header className="rx-head">
        <h2>التشغيل والإنتاجية</h2>
        <p>من الحقول التشغيلية في الاستمارة. كل رقم محسوب من المواقع التي سجّلته فقط، والعدد تحته يبيّن كم موقعاً سجّله.</p>
      </header>
      {!any ? (
        <p className="rx-foot rx-pending">لم تُسجَّل بيانات تشغيلية بعد. ستظهر هنا فور وصول استمارات تحمل الحقول الجديدة (الإيصالات، الرحلات، الآليات، ساعات العمل).</p>
      ) : (
        <>
          <div className="rx-prod">
            {tiles.map((t) => (
              <div key={t.label} className={`rx-prod__tile${t.n ? '' : ' is-empty'}`} style={{ '--c': t.c }}>
                <span>{t.label}</span>
                <b>{t.n ? (t.value >= 100 ? fmt(t.value) : (Math.round(t.value * 10) / 10).toLocaleString('en-US')) : '—'}</b>
                <small>{t.unit} · {fmt(t.n)} موقعاً</small>
              </div>
            ))}
          </div>
          {ranks.length > 0 && (
            <div className="rx-card">
              <h3>الجهات الأعلى إنتاجية (م³ لكل ساعة عمل)</h3>
              <ol className="rx-levels">
                {ranks.map((c, i) => (
                  <li key={c.name}>
                    <button type="button" style={{ '--c': PAL[i % PAL.length] }} onClick={() => toggle('co', c.name)}
                      className={f.co.some((x) => coKey(x) === coKey(c.name)) ? 'is-on' : ''}>
                      <span className="rx-levels__n">{i + 1}</span>
                      <span className="rx-levels__name">{c.name}<small>{fmt(c.n)} موقعاً · {fmt(c.hours)} ساعة</small></span>
                      <span className="rx-levels__bar"><span style={{ width: `${(c.rate / top) * 100}%` }} /></span>
                      <b>{(Math.round(c.rate * 10) / 10).toLocaleString('en-US')}<small> م³/ساعة</small></b>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------------- الصفحة ---------------- */

function build(planRows, surveys, live, plan) {
  /* بلا خطة: تُبنى صفوف «منفَّذ» من الاستمارات (مرحلة × محافظة × منطقة) */
  let phasesRows = planRows;
  if (!plan) {
    const m = new Map();
    for (const s of surveys) {
      const k = `${phaseOf(s)}|${govName(s.gov)}|${s.area}`;
      const r = m.get(k) || { phase: phaseOf(s), gov: govName(s.gov), region: s.area || '—', planned: 0, executed: 0, notes: '', sites: 0 };
      r.executed += s.vol; r.sites += 1;
      m.set(k, r);
    }
    phasesRows = [...m.values()];
  }
  const gm = new Map();
  for (const r of phasesRows) {
    const k = govKey(r.gov);
    const g = gm.get(k) || { key: k, name: govName(r.gov), planned: 0, executed: 0, sites: 0, regions: [] };
    g.planned += r.planned; g.executed += r.executed; g.sites += r.sites || 0; g.regions.push(r);
    gm.set(k, g);
  }
  const govs = [...gm.values()].map((g) => ({ ...g, rate: pct(g.executed, g.planned) })).sort((a, b) => (plan ? b.planned - a.planned : b.executed - a.executed));
  const phases = PHASE_KEYS.map((key) => {
    const rs = phasesRows.filter((r) => r.phase === key);
    const planned = rs.reduce((a, r) => a + r.planned, 0);
    const executed = rs.reduce((a, r) => a + r.executed, 0);
    return { key, title: key, planned, executed, rate: pct(executed, planned), sites: rs.reduce((a, r) => a + (r.sites || 0), 0), govs: [...new Set(rs.map((r) => govName(r.gov)))] };
  });
  const cm = new Map();
  for (const s of surveys) {
    const k = coKey(s.co) || 'غير محدد';
    const c = cm.get(k) || { names: new Map(), count: 0, vol: 0, govs: new Set() };
    c.names.set(s.co, (c.names.get(s.co) || 0) + 1);
    c.count += 1; c.vol += s.vol; c.govs.add(govName(s.gov));
    cm.set(k, c);
  }
  const contractors = [...cm.values()].map((c) => ({ ...c, name: [...c.names.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.vol - a.vol);
  const t = {
    planned: phasesRows.reduce((a, r) => a + r.planned, 0),
    executed: Math.round(phasesRows.reduce((a, r) => a + r.executed, 0)),
    surveys: surveys.length, live,
    surveyVol: surveys.reduce((a, s) => a + s.vol, 0),
  };
  const counts = { govs: govs.length, areas: new Set(surveys.map((x) => x.area)).size, cos: contractors.length };
  return { govs, phases, contractors, t, counts, items: insights({ govs, surveys, t, contractors }) };
}

export default function RubbleTransfer({ basemap }) {
  if (basemap && !govNames) govNames = new Map((basemap.governorates || []).map((g) => [g.code, g.name]));
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [f, setF] = useState(EMPTY);

  useEffect(() => {
    /*
      البيانات الأساسية (KoBo) من الملف، ثم تُضاف إليها الإجابات المعتمدة من
      استبيان المنصة. إن تعذّر الاتصال بقاعدة البيانات يبقى التقرير بالبيانات الأساسية.
    */
    Promise.all([
      getData('rubble-transfer'),
      rubbleTransferFeed().catch(() => []),
    ]).then(([base, live]) => setData({ ...base, live: live.length, surveys: [...base.surveys, ...live.map(fromResponse)] }))
      .catch(() => setError(true));
  }, []);

  /* كل تغيير في الفلاتر يمرّ بـ prune حتى يبقى التسلسل الإداري متّسقاً */
  const setFp = (next) => setF((cur) => prune(typeof next === 'function' ? next(cur) : next, data?.surveys || []));
  const toggle = (dim, v) => setFp((cur) => ({ ...cur, [dim]: cur[dim].includes(v) ? cur[dim].filter((x) => x !== v) : [...cur[dim], v] }));

  const view = useMemo(() => {
    if (!data) return null;
    const surveys = data.surveys.filter((s) => matchSurvey(s, f));
    /* الخطة معتمدة على مستوى المحافظة × المرحلة فقط؛ أي فلتر أدق منها (منطقة، ناحية، جهة…)
       لا يمكن أن يقابله مخطط، فتُحسب الأرقام من الاستمارات المطابقة (المنفّذ فعلاً) */
    const deep = data.phases.length > 0 && DIMS.some((d) => !['gov', 'phase'].includes(d.key) && f[d.key]?.length);
    const plan = data.phases.length > 0 && !deep;
    const rows = plan ? data.phases.filter((r) => matchPlan(r, f)) : [];
    return { plan, deep, surveys, ...build(rows, surveys, data.live || 0, plan) };
  }, [data, f]);

  if (error) return <div className="pending"><h3>تعذّر تحميل بيانات المشروع</h3><p>حدّث الصفحة وحاول مجدداً.</p></div>;
  if (!view) return <p className="results__empty">جارٍ التحميل…</p>;
  const filtered = DIMS.some((d) => f[d.key].length);

  /* لا خطة ولا استمارات بعد: صفحة انتظار بدل لوحات فارغة */
  if (!data.phases.length && !data.surveys.length) {
    return (
      <div className="rx-empty">
        <img src="brand/emblem.svg" alt="" aria-hidden="true" />
        <h2>بانتظار البيانات</h2>
        <p>أُفرغت بيانات المشروع تمهيداً لرفع النسخة المحدّثة. ستظهر هنا خطة المراحل والمحافظات ومواقع العمل فور رفعها،
          وكذلك كل استمارة معتمدة من «استبيان ترحيل الأنقاض الميداني».</p>
      </div>
    );
  }

  return (
    <div className="rx">
      <FilterBar f={f} setF={setFp} surveys={data.surveys} toggle={toggle} />
      {view.deep && (
        <p className="rx-deep">الخطة (الكمية المخطط لها) معتمدة على مستوى المحافظة والمرحلة فقط، لذلك تعرض الأرقام عند الفلترة بالمنطقة أو الناحية أو الجهة
          الكمياتِ المنفّذة فعلاً من استمارات المواقع المطابقة، دون نسب إنجاز.</p>
      )}
      <Summary t={view.t} items={view.items} filtered={filtered} plan={view.plan} phases={view.phases} counts={view.counts} />
      <PhaseRibbon phases={view.phases} f={f} toggle={toggle} plan={view.plan} />
      <Levels surveys={view.surveys} f={f} setF={setFp} />
      <Matrix govs={view.govs} f={f} toggle={toggle} setF={setFp} plan={view.plan} />
      <Field surveys={view.surveys} allSurveys={data.surveys} basemap={basemap} t={view.t} f={f} toggle={toggle} />
      <Productivity surveys={view.surveys} f={f} toggle={toggle} />
      <Contractors list={view.contractors} total={view.t.surveyVol} f={f} toggle={toggle} />
      <Registry surveys={view.surveys} allSurveys={data.surveys} f={f} toggle={toggle} />
      <button type="button" className="rx-more rx-print" onClick={() => window.print()}>طباعة التقرير</button>
    </div>
  );
}
