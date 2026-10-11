import { useEffect, useMemo, useState } from 'react';
import { damageRubble } from './rubbleMethod';
import { archiveItems } from './RubbleGallery';
import { buildDumps } from './RubbleRegistry';
import { getData } from '../data/api';

/* لمحة عامة (Overview) عن مشروع إدارة الأنقاض: كل المراحل في شاشة واحدة */
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : fmt(n));

export default function RubbleOverview({ plan = {}, planItems = [], surveys, pipe, registry, go }) {
  const [damage, setDamage] = useState([]);
  useEffect(() => { getData('rubble-damage').then((d) => setDamage(d.rows || [])).catch(() => {}); }, []);

  const o = useMemo(() => {
    const sum = (l, k) => l.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    const of = (...k) => pipe.filter((x) => k.includes(x.stage));
    const estDamage = damage.reduce((a, r) => a + damageRubble(r).volume, 0);
    const est = estDamage + sum(of('assessment'), 'volume');
    const planned = sum(of('planned', 'study'), 'volume') + (plan.planned || 0);
    const done = sum(surveys, 'vol');
    const recycled = sum(of('recycling'), 'volume');
    const govs = new Map();
    const g = (k) => { if (!govs.has(k)) govs.set(k, { gov: k, est: 0, done: 0, sites: 0 }); return govs.get(k); };
    for (const r of damage) g(r.gov).est += damageRubble(r).volume;
    for (const x of of('assessment')) if (x.gov) g(x.gov).est += x.volume || 0;
    for (const s of surveys) if (s.gov) { const t = g(s.gov); t.done += s.vol || 0; t.sites += 1; }
    const archive = archiveItems(surveys, pipe);
    const recent = [...surveys].filter((s) => (s.photos || []).some(Boolean)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
    return {
      est, planned, done, recycled, sites: surveys.length,
      cos: new Set(surveys.map((s) => s.co).filter(Boolean)).size,
      govs: [...govs.values()].filter((x) => x.gov).sort((a, b) => b.done + b.est - a.done - a.est),
      archive: archive.length, recent, dumps: buildDumps(surveys, registry),
    };
  }, [surveys, pipe, damage, registry, plan]);

  const stages = [
    { id: 'assessment', t: 'التقدير', v: o.est, c: '#4f8fdc', note: o.est ? 'من بيانات الضرر والمناطق المقدّرة' : 'بانتظار بيانات الضرر' },
    { id: 'planning', t: 'التخطيط والدراسة', v: o.planned, c: '#8d6bc9', note: `${fmt(planItems.length + pipe.filter((x) => ['planned', 'study'].includes(x.stage)).length)} مشاريع` },
    { id: 'execution', t: 'التنفيذ (مُرحّل)', v: plan.executed || o.done, c: '#2f9e74', note: `${fmt(o.sites)} موقع عمل` },
    { id: 'recycling', t: 'التدوير والاستثمار', v: o.recycled, c: '#d4a443', note: `${fmt(pipe.filter((x) => ['recycling', 'investment'].includes(x.stage)).length)} مشروعاً` },
  ];
  const max = Math.max(1, ...stages.map((s) => s.v));
  const gmax = Math.max(1, ...o.govs.map((x) => Math.max(x.est, x.done)));

  return (
    <div className="ov">
      <div className="ov-hero">
        <div>
          <span className="rt-kicker">لمحة عامة · Overview</span>
          <h2>مشروع إدارة الأنقاض في الجمهورية العربية السورية</h2>
          <p>من تقدير الكميات إلى الترحيل والتدوير — مؤشرات المراحل كلها في مكان واحد.</p>
        </div>
        <div className="ov-hero__big">
          <b>{short(plan.executed || o.done)}</b><span>م³ رُحّلت حتى الآن</span>
          {plan.planned > 0 && <em>{((plan.executed / plan.planned) * 100).toFixed(1)}% من المخطط ({short(plan.planned)} م³){plan.asOf ? ` · ${plan.asOf}` : ''}</em>}
        </div>
      </div>

      <div className="ov-kpis">
        <div><span>مواقع العمل</span><b>{fmt(o.sites)}</b></div>
        <div><span>الجهات المنفذة</span><b>{fmt(o.cos)}</b></div>
        <div><span>المحافظات</span><b>{fmt(o.govs.filter((x) => x.done).length)}</b></div>
        <div><span>الجهات في السجل</span><b>{fmt(registry.entities.length)}</b></div>
        <div><span>المكبات</span><b>{fmt(o.dumps.length)}</b><small>{fmt(o.dumps.filter((d) => d.status === 'معتمد').length)} معتمد · {fmt(o.dumps.filter((d) => d.status !== 'معتمد').length)} مقترح</small></div>
        <div><span>مواقع موثّقة بالصور</span><b>{fmt(o.archive)}</b></div>
      </div>

      <div className="ov-grid">
        <section className="ov-box">
          <h3>دورة إدارة الأنقاض</h3>
          {stages.map((s) => (
            <button type="button" key={s.t} className="ov-stage" style={{ '--c': s.c }} onClick={() => go(s.id)}>
              <span className="ov-stage__t">{s.t}<small>{s.note}</small></span>
              <span className="ov-stage__bar"><i style={{ width: `${(s.v / max) * 100}%` }} /></span>
              <b>{s.v ? `${short(s.v)} م³` : '—'}</b>
            </button>
          ))}
        </section>
        <section className="ov-box">
          <h3>المحافظات: المقدّر والمُرحّل</h3>
          <div className="ov-govs">
            {o.govs.slice(0, 10).map((x) => (
              <div key={x.gov} className="ov-gov">
                <span>{x.gov}</span>
                <span className="ov-gov__bars">
                  {x.est > 0 && <i className="is-est" style={{ width: `${(x.est / gmax) * 100}%` }} title={`مقدّر ${fmt(x.est)}`} />}
                  <i className="is-done" style={{ width: `${(x.done / gmax) * 100}%` }} title={`مُرحّل ${fmt(x.done)}`} />
                </span>
                <b>{short(x.done)}</b>
              </div>
            ))}
          </div>
          <p className="dmg__note"><i className="ov-key is-done" /> مُرحّل &nbsp; <i className="ov-key is-est" /> مقدّر (يظهر مع بيانات الضرر)</p>
        </section>
      </div>

      {o.recent.length > 0 && (
        <section className="ov-box">
          <h3>من الميدان: أحدث المواقع الموثّقة <button type="button" className="ov-link" onClick={() => go('gallery')}>الأرشيف المصور ←</button></h3>
          <div className="ov-recent">
            {o.recent.map((s) => (
              <figure key={s.id}>
                <img src={s.photos[2] || s.photos[0] || s.photos[1]} alt="" loading="lazy" referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                <figcaption>{s.addr || s.area}<small>{[s.gov, s.date].filter(Boolean).join(' · ')}</small></figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
