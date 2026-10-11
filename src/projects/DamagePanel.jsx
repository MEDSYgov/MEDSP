import { useEffect, useMemo, useState } from 'react';
import TemplateDownload from '../components/TemplateDownload';
import Dropdown from '../components/Dropdown';
import { DAMAGE, damageRubble } from './rubbleMethod';
import { getData } from '../data/api';

/*
  ربط بيانات الضرر بالأنقاض:
   1) أصناف الضرر وأنواع المباني  2) نسب الضرر والأنقاض الناتجة عنها
   3) أولويات التخطيط والتنفيذ = الأنقاض المقدّرة × شدة الضرر − ما رُحّل فعلاً
*/
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

export default function DamagePanel({ surveys = [] }) {
  const [rows, setRows] = useState(null);
  const [govs, setGovs] = useState([]);
  const [kinds, setKinds] = useState([]);

  useEffect(() => {
    getData('rubble-damage').then((d) => setRows(d.rows || [])).catch(() => setRows([]));
  }, []);

  const list = useMemo(() => (rows || []).filter((r) =>
    (!govs.length || govs.includes(r.gov)) && (!kinds.length || kinds.includes(r.kind))), [rows, govs, kinds]);

  const tot = useMemo(() => {
    const t = Object.fromEntries(DAMAGE.map((d) => [d.key, { n: 0, v: 0 }]));
    let assumed = false;
    for (const r of list) {
      const x = damageRubble(r); assumed ||= x.assumed;
      for (const d of DAMAGE) { t[d.key].n += r[d.key] || 0; t[d.key].v += x.by[d.key]; }
    }
    const n = DAMAGE.reduce((a, d) => a + t[d.key].n, 0);
    const v = DAMAGE.reduce((a, d) => a + t[d.key].v, 0);
    return { t, n, v, assumed };
  }, [list]);

  const byKind = useMemo(() => {
    const m = new Map();
    for (const r of list) {
      const o = m.get(r.kind) || { kind: r.kind, n: 0, v: 0 };
      o.n += DAMAGE.reduce((a, d) => a + (r[d.key] || 0), 0); o.v += damageRubble(r).volume; m.set(r.kind, o);
    }
    return [...m.values()].sort((a, b) => b.v - a.v);
  }, [list]);

  /* الأولويات حسب المنطقة: الأنقاض المتبقية × مؤشر الشدة */
  const priorities = useMemo(() => {
    const done = new Map();
    for (const s of surveys) { const k = `${s.gov}|${s.area || ''}`; done.set(k, (done.get(k) || 0) + (s.vol || 0)); }
    const m = new Map();
    for (const r of list) {
      const k = `${r.gov}|${r.area || ''}`;
      const o = m.get(k) || { gov: r.gov, area: r.area, v: 0, n: 0, w: 0 };
      const x = damageRubble(r);
      for (const d of DAMAGE) { o.n += r[d.key] || 0; o.w += (r[d.key] || 0) * d.weight; }
      o.v += x.volume; m.set(k, o);
    }
    const out = [...m.entries()].map(([k, o]) => {
      const moved = done.get(k) || 0;
      const left = Math.max(0, o.v - moved);
      const sev = o.n ? o.w / o.n / 4 : 0;
      return { ...o, moved, left, sev, score: left * sev };
    }).sort((a, b) => b.score - a.score);
    const max = out[0]?.score || 1;
    return out.map((o, i) => ({ ...o, rank: i + 1, level: o.score / max > 0.6 ? 'عاجلة' : o.score / max > 0.25 ? 'مرتفعة' : 'عادية' }));
  }, [list, surveys]);

  /* معامل التصحيح لكل محافظة = المُرحّل فعلاً ÷ التقدير النظري (البند 6.1-ج) */
  const correction = useMemo(() => {
    const est = new Map(); const moved = new Map();
    for (const r of rows || []) est.set(r.gov, (est.get(r.gov) || 0) + damageRubble(r).volume);
    for (const x of surveys) moved.set(x.gov, (moved.get(x.gov) || 0) + (x.vol || 0));
    return [...est.entries()].filter(([g]) => !govs.length || govs.includes(g)).map(([gov, v]) => ({ gov, v, moved: moved.get(gov) || 0, k: v ? (moved.get(gov) || 0) / v : null }))
      .sort((a, b) => b.v - a.v);
  }, [rows, surveys, govs]);

  if (rows === null) return null;
  if (!rows.length) {
    return (
      <div className="hub-empty dmg-empty" style={{ '--c': '#b3261e' }}>
        <h3>ربط بيانات الضرر بالأنقاض</h3>
        <p>بانتظار بيانات الضرر من وزارة الإدارة المحلية. تُضاف عبر القالب <b dir="ltr">data/rubble-damage/damage.xlsx</b>:
          سطر لكل منطقة/ناحية ونوع مبنى بأعداد (مدمر كلياً، شديد، متوسط، خفيف). عندها تظهر أصناف الضرر ونسبه،
          والأنقاض الناتجة عن كل فئة بالمعادلة المعتمدة، وترتيب أولويات المناطق.</p>
        <TemplateDownload id="damage" />
      </div>
    );
  }

  const opts = (k) => [...new Set(rows.map((r) => r[k]).filter(Boolean))].map((v) => ({ value: v, label: v }));

  return (
    <section className="dmg">
      <header className="dmg__head">
        <h3>الضرر والأنقاض الناتجة عنه</h3>
        <div className="dmg__filters">
          <Dropdown multi label="المحافظة" placeholder="كل المحافظات" value={govs} onChange={setGovs} options={opts('gov')} />
          <Dropdown multi label="نوع المبنى" placeholder="كل الأنواع" value={kinds} onChange={setKinds} options={opts('kind')} />
        </div>
      </header>
      <TemplateDownload id="damage" />

      <div className="dmg__cats">
        {DAMAGE.map((d) => (
          <div key={d.key} className="dmg__cat" style={{ '--c': d.color }}>
            <span>{d.label}</span>
            <b>{fmt(tot.t[d.key].n)}</b><small>مبنى · {pct(tot.t[d.key].n, tot.n)}</small>
            <em>{fmt(tot.t[d.key].v)} م³ أنقاض · {pct(tot.t[d.key].v, tot.v)}</em>
          </div>
        ))}
      </div>

      <div className="dmg__bar" aria-label="نسب الضرر">
        {DAMAGE.map((d) => tot.t[d.key].n > 0 && (
          <span key={d.key} style={{ flex: tot.t[d.key].n, background: d.color }} title={`${d.label} ${pct(tot.t[d.key].n, tot.n)}`} />
        ))}
      </div>
      <p className="dmg__note">إجمالي الأنقاض المقدّرة من الضرر: <b>{fmt(tot.v)} م³</b> (≈ {fmt(tot.v * 1.35)} طن).
        المنهجية المعتمدة: الحجم الإنشائي (المساحة × الطوابق × 3 م) × معامل التحويل: {DAMAGE.map((d) => `${d.label} ${d.share}`).join(' · ')}.
        {tot.assumed && ' بعض الأسطر بلا مساحة/طوابق فاعتُمد 120 م² و3 طوابق.'}</p>

      <div className="dmg__box">
        <h4>معايرة التقدير: معامل التصحيح لكل محافظة</h4>
        <table className="dmg__table"><thead><tr><th>المحافظة</th><th>التقدير النظري م³</th><th>المُرحّل فعلاً م³</th><th>معامل التصحيح</th></tr></thead>
          <tbody>{correction.map((c) => (
            <tr key={c.gov}><td>{c.gov}</td><td>{fmt(c.v)}</td><td>{fmt(c.moved)}</td><td>{c.moved ? c.k.toFixed(2) : '—'}</td></tr>
          ))}</tbody></table>
        <p className="dmg__note">الكمية النهائية = الكمية النظرية × معامل التصحيح. يكتمل المعامل كلما اكتمل الترحيل في المحافظة؛ قبل ذلك يمثّل نسبة الإنجاز.</p>
      </div>

      <div className="dmg__grid">
        <div className="dmg__box">
          <h4>حسب نوع المبنى / المنشأة</h4>
          <table className="dmg__table"><thead><tr><th>النوع</th><th>المباني المتضررة</th><th>الأنقاض م³</th><th>الحصة</th></tr></thead>
            <tbody>{byKind.map((k) => <tr key={k.kind}><td>{k.kind}</td><td>{fmt(k.n)}</td><td>{fmt(k.v)}</td><td>{pct(k.v, tot.v)}</td></tr>)}</tbody></table>
        </div>
        <div className="dmg__box">
          <h4>أولويات التخطيط والتنفيذ</h4>
          <table className="dmg__table"><thead><tr><th>#</th><th>المنطقة</th><th>المقدّر م³</th><th>المُرحّل</th><th>المتبقي</th><th>الأولوية</th></tr></thead>
            <tbody>{priorities.slice(0, 15).map((p) => (
              <tr key={p.gov + p.area}><td>{p.rank}</td><td>{[p.gov, p.area].filter(Boolean).join(' · ')}</td><td>{fmt(p.v)}</td>
                <td>{fmt(p.moved)}</td><td>{fmt(p.left)}</td><td><span className={`dmg__lvl is-${p.level}`}>{p.level}</span></td></tr>
            ))}</tbody></table>
          <p className="dmg__note">الأولوية = الأنقاض المتبقية (المقدّر − المُرحّل فعلاً من الاستمارة) × مؤشر شدة الضرر.</p>
        </div>
      </div>
    </section>
  );
}
