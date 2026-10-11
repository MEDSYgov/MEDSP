import { useEffect, useMemo, useState } from 'react';
import RubbleTransfer from './RubbleTransfer';
import EstimateCalc from './EstimateCalc';
import TemplateDownload from '../components/TemplateDownload';
import DamagePanel from './DamagePanel';
import DroneCalc from './DroneCalc';
import RubbleOverview from './RubbleOverview';
import RubbleGallery from './RubbleGallery';
import RubbleAtlas from './RubbleAtlas';
import DirectorateWorks from './DirectorateWorks';
import RubbleMapView from './RubbleMapView';
import { fromResponse } from './RubbleTransfer';
import { Entities, Dumps, isEntityRegistry, entitiesFromProject } from './RubbleRegistry';
import { listPublishedProjects, listEntities, rubbleTransferFeed } from './store';

/*
  إدارة الأنقاض — دورة كاملة في تبويب واحد:
    التقدير ← التخطيط والدراسة ← التنفيذ (الترحيل) ← التدوير والاستثمار

  التنفيذ يأتي من الاستمارة الرسمية وتصديرات KoBo (صفحة مشروع ترحيل الأنقاض).
  بقية المراحل من القالب data/rubble-pipeline/pipeline.xlsx.
*/

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : fmt(n));

const STAGES = [
  {
    id: 'assessment', title: 'التقدير', color: '#4f8fdc', sub: 'حصر وتقدير كميات الأنقاض',
    kinds: ['assessment'], volLabel: 'الكمية المقدّرة',
    empty: 'لم تُسجَّل بعد أي مناطق مقدّرة. تُضاف من قالب «دورة إدارة الأنقاض» بمرحلة «تقدير».',
  },
  {
    id: 'planning', title: 'التخطيط والدراسة', color: '#8d6bc9', sub: 'المشاريع المخططة وقيد الدراسة والمتابعة',
    kinds: ['planned', 'study'], volLabel: 'الكمية المخطط لها',
    empty: 'لا توجد مشاريع مخططة أو قيد الدراسة بعد. تُضاف من القالب بمرحلة «مخطط» أو «قيد الدراسة».',
  },
  { id: 'execution', title: 'التنفيذ', color: '#2f9e74', sub: 'ترحيل الأنقاض — من الاستمارة الرسمية' },
  {
    id: 'recycling', title: 'التدوير والاستثمار', color: '#d4a443', sub: 'سحق الأنقاض وتدويرها واستثمار نواتجها',
    kinds: ['recycling', 'investment'], volLabel: 'الأنقاض المدخلة',
    empty: 'لا توجد مشاريع تدوير أو استثمار بعد. تُضاف من القالب بمرحلة «تدوير» أو «استثمار».',
  },
];

const KIND_LABEL = { assessment: 'تقدير', planned: 'مخطط', study: 'قيد الدراسة', recycling: 'تدوير', investment: 'استثمار' };

/* المخطط والمنفّذ لكل مشروع: منفّذ · متبقٍ في المحافظات التي بدأت · لم يبدأ تنفيذه */
const PC = { done: '#2f9e74', left: '#d4a443', wait: '#e0735a' };
function PlanChart({ items }) {
  const rows = items.filter((x) => x.parts).map((x) => {
    const done = x.parts.reduce((a, r) => a + (r.executed || 0), 0);
    const started = x.parts.filter((r) => r.executed > 0);
    const left = started.reduce((a, r) => a + Math.max(0, (r.planned || 0) - (r.executed || 0)), 0);
    const wait = x.parts.filter((r) => !(r.executed > 0)).reduce((a, r) => a + (r.planned || 0), 0);
    return { name: x.name.replace('مشروع ترحيل الأنقاض — ', ''), planned: x.volume || 0, done, left, wait, waitGovs: x.parts.filter((r) => !(r.executed > 0)).map((r) => r.gov) };
  });
  if (!rows.length) return null;
  const tot = rows.reduce((a, r) => ({ planned: a.planned + r.planned, done: a.done + r.done, left: a.left + r.left, wait: a.wait + r.wait }), { planned: 0, done: 0, left: 0, wait: 0 });
  const max = Math.max(...rows.map((r) => Math.max(r.planned, r.done + r.left + r.wait)), 1);
  const KINDS = [['done', 'منفّذ'], ['left', 'متبقٍّ'], ['wait', 'لم يبدأ']];
  const pct = (v, r) => `${Math.round((v / (r.planned || 1)) * 100)}%`;
  const Bar = ({ r, scale }) => (
    <span className="pc-wrap">
      <span className="pc-bar">
        {KINDS.map(([k, l]) => r[k] > 0 && (
          <i key={k} style={{ width: `${(r[k] / scale) * 100}%`, background: PC[k] }} title={`${l}: ${fmt(r[k])} م³ (${pct(r[k], r)})`}>
            {r[k] / scale > 0.1 && <b>{short(r[k])} · {pct(r[k], r)}</b>}
          </i>
        ))}
      </span>
      <span className="pc-vals">
        {KINDS.map(([k, l]) => r[k] > 0 && (
          <span key={k}><i style={{ background: PC[k] }} />{l} <b>{fmt(r[k])} م³</b> <em>({pct(r[k], r)})</em></span>
        ))}
      </span>
    </span>
  );
  return (
    <section className="pc">
      <h3>الكميات المنفّذة والمخطط لها التي لم يبدأ تنفيذها</h3>
      <div className="pc-legend">
        <span><i style={{ background: PC.done }} /> منفّذ <b>{fmt(tot.done)} م³</b></span>
        <span><i style={{ background: PC.left }} /> متبقٍّ في محافظات بدأ فيها التنفيذ <b>{fmt(tot.left)} م³</b></span>
        <span><i style={{ background: PC.wait }} /> مخطط لم يبدأ تنفيذه <b>{fmt(tot.wait)} م³</b></span>
      </div>
      <div className="pc-rows">
        {rows.map((r) => (
          <div key={r.name} className="pc-row">
            <span className="pc-row__n">{r.name}<small>{r.waitGovs.length ? `لم يبدأ: ${r.waitGovs.join('، ')}` : (r.done >= r.planned ? `منجز · ${((r.done / (r.planned || 1)) * 100).toFixed(0)}% من المخطط له` : 'بدأ التنفيذ في كل المحافظات')}</small></span>
            <Bar r={r} scale={max} />
            <span className="pc-row__t">{short(r.planned)}<small>م³ مخطط له</small></span>
          </div>
        ))}
        <div className="pc-row pc-row--total">
          <span className="pc-row__n">الإجمالي<small>{tot.planned ? `${((tot.done / tot.planned) * 100).toFixed(1)}% منفّذ من المخطط له` : ''}</small></span>
          <Bar r={tot} scale={Math.max(tot.planned, tot.done + tot.left + tot.wait)} />
          <span className="pc-row__t">{short(tot.planned)}<small>م³ مخطط له</small></span>
        </div>
      </div>
    </section>
  );
}

function StageList({ stage, items }) {
  const [kind, setKind] = useState('all');
  const [gov, setGov] = useState('all');
  const list = items.filter((x) => (kind === 'all' || x.stage === kind) && (gov === 'all' || (x.govs || [x.gov]).includes(gov)));
  const govs = [...new Set(items.flatMap((x) => x.govs || [x.gov]).filter(Boolean))];
  const vol = list.reduce((a, x) => a + (x.volume || 0), 0);
  const out = list.reduce((a, x) => a + (x.output || 0), 0);
  const budget = list.reduce((a, x) => a + (x.budget || 0), 0);

  if (!items.length) {
    return (
      <div className="hub-empty" style={{ '--c': stage.color }}>
        <h3>{stage.title}</h3>
        <p>{stage.empty}</p>
        <TemplateDownload id="pipeline" />
      </div>
    );
  }

  return (
    <div className="hub-stage">
      <TemplateDownload id="pipeline" />
      <div className="hub-kpis" style={{ '--c': stage.color }}>
        <div><span>المشاريع</span><b>{fmt(list.length)}</b></div>
        <div><span>{stage.volLabel}</span><b>{short(vol)}</b><small>م³</small></div>
        {stage.id === 'recycling' && <div><span>الركام المعاد تدويره</span><b>{short(out)}</b><small>م³ / $</small></div>}
        <div><span>الكلفة التقديرية</span><b>{budget ? `$${short(budget)}` : '—'}</b></div>
      </div>

      <div className="hub-chips">
        {stage.kinds.length > 1 && ['all', ...stage.kinds].map((k) => (
          <button type="button" key={k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>
            {k === 'all' ? 'الكل' : KIND_LABEL[k]} <small>{fmt(k === 'all' ? items.length : items.filter((x) => x.stage === k).length)}</small>
          </button>
        ))}
        {govs.length > 1 && ['all', ...govs].map((g) => (
          <button type="button" key={g} className={gov === g ? 'is-on' : ''} onClick={() => setGov(g)}>
            {g === 'all' ? 'كل المحافظات' : g}
          </button>
        ))}
      </div>

      <div className="hub-cards">
        {list.map((x) => (
          <article key={x.id} className="hub-card" style={{ '--c': stage.color }}>
            <header>
              <span className="hub-card__kind">{KIND_LABEL[x.stage]}</span>
              {x.status && <span className="hub-card__status">{x.status}</span>}
            </header>
            <h4>{x.name}</h4>
            <p className="hub-card__where">{[x.gov, x.area, x.town].filter(Boolean).join(' · ') || '—'}</p>
            <dl>
              {x.volume != null && <div><dt>{stage.volLabel}</dt><dd>{fmt(x.volume)} م³</dd></div>}
              {x.output != null && <div><dt>{x.stage === 'investment' ? 'قيمة الاستثمار' : 'الناتج'}</dt><dd>{fmt(x.output)}{x.stage === 'investment' ? ' $' : ' م³'}</dd></div>}
              {x.budget != null && <div><dt>الكلفة</dt><dd>${fmt(x.budget)}</dd></div>}
              {x.partner && <div><dt>الجهة / الشريك</dt><dd>{x.partner}</dd></div>}
              {(x.start || x.end) && (String(x.start).startsWith('تقرير') ? <div><dt>المصدر</dt><dd>{x.start}</dd></div> : <div><dt>المدة</dt><dd dir="ltr">{x.start || '…'} → {x.end || '…'}</dd></div>)}
            </dl>
            {x.progress != null && (
              <div className="hub-card__prog"><span className="hub-card__track"><span style={{ width: `${Math.min(100, x.progress)}%` }} /></span><b>{x.progress}%</b></div>
            )}
            {x.notes && <p className="hub-card__notes">{x.notes}</p>}
            {x.parts && (
              <ul className="hub-card__parts">
                {x.parts.filter((r) => gov === 'all' || r.gov === gov).map((r) => (
                  <li key={r.gov}><b>{r.gov}</b> — {r.planned ? `${fmt(r.planned)} م³` : 'الكمية قيد التحديد'}{' · '}<em className={r.executed > 0 ? 'is-go' : 'is-wait'}>{r.executed > 0 ? `منفّذ ${fmt(r.executed)} م³` : 'لم يبدأ'}</em>{r.notes && <small>{r.notes}</small>}</li>
                ))}
              </ul>
            )}
            {(x.photos || []).some((l) => l.length) && (
              <div className="hub-card__photos">
                {['قبل', 'أثناء', 'بعد'].map((l, i) => x.photos[i][0] && (
                  <a key={l} href={x.photos[i][0]} target="_blank" rel="noreferrer">
                    <img src={x.photos[i][0]} alt={l} loading="lazy" referrerPolicy="no-referrer" /><small>{l}</small>
                  </a>
                ))}
              </div>
            )}
            {x.folder && <a className="hub-card__folder" href={x.folder} target="_blank" rel="noreferrer">مجلد الصور والوثائق ↗</a>}
          </article>
        ))}
      </div>
    </div>
  );
}

export default function RubbleHub({ basemap, initial }) {
  const [stage, setStage] = useState(initial || 'overview');
  const [pipe, setPipe] = useState({ items: [] });
  const [exec, setExec] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [plan, setPlan] = useState({ planned: 0, executed: 0, asOf: null, rows: [] });
  const [registry, setRegistry] = useState({ dumps: [], entities: [] });

  useEffect(() => {
    /* السجل: قالب Excel + سجلات مشروع «سجل الجهات» المعتمدة في مساحة العمل (الأحدث يُضاف فوقه) */
    Promise.all([
      fetch('data/rubble-registry.json').then((r) => r.json()).catch(() => ({ dumps: [], entities: [] })),
      listPublishedProjects().catch(() => []),
      listEntities().catch(() => []),
    ]).then(([file, projects, table]) => {
      const live = projects.filter(isEntityRegistry).flatMap(entitiesFromProject);
      /* السجل الرسمي (جدول مساحة العمل) أخيراً حتى يغلب اسمه وتصنيفه */
      setRegistry({ dumps: file.dumps || [], entities: [...(file.entities || []), ...live, ...table] });
    });
    fetch('data/rubble-pipeline.json').then((r) => r.json()).then(setPipe).catch(() => setPipe({ items: [] }));
    Promise.all([
      fetch('data/rubble-transfer.json').then((r) => r.json()).catch(() => ({ surveys: [] })),
      rubbleTransferFeed().catch(() => []),
    ]).then(([d, live]) => {
      const all = [...(d.surveys || []), ...live.map(fromResponse)];
      const ph = d.phases || [];
      setPlan({ rows: ph, planned: ph.reduce((a, r) => a + (r.planned || 0), 0), executed: ph.reduce((a, r) => a + (r.executed || 0), 0), asOf: d.planAsOf });
      setSurveys(all); setExec({ n: all.length, vol: all.reduce((a, s) => a + (s.vol || 0), 0) });
    });
  }, []);

  /* مشاريع خطة الترحيل الثلاثة ← «التخطيط والدراسة»: بطاقة لكل مشروع مع محافظاته وحالة كل منها */
  const planItems = useMemo(() => {
    const m = new Map();
    for (const r of plan.rows) {
      const o = m.get(r.phase) || { id: `plan-${r.phase}`, stage: 'planned', name: `مشروع ترحيل الأنقاض — ${r.phase}`,
        govs: [], volume: 0, done: 0, parts: [], start: plan.asOf ? `تقرير ${plan.asOf}` : '', photos: [[], [], []] };
      o.govs.push(r.gov); o.volume += r.planned || 0; o.done += r.executed || 0; o.parts.push(r);
      m.set(r.phase, o);
    }
    return [...m.values()].map((o) => {
      const waiting = o.parts.filter((r) => !(r.executed > 0)).length;
      const progress = o.volume ? Math.round((o.done / o.volume) * 100) : 0;
      const status = !waiting && progress >= 100 ? 'منجز' : waiting === o.parts.length ? 'لم يبدأ التنفيذ'
        : waiting ? `قيد التنفيذ · ${waiting} من ${o.parts.length} محافظات لم يبدأ فيها` : 'قيد التنفيذ';
      return { ...o, gov: o.govs.join('، '), progress, status };
    });
  }, [plan]);

  const byStage = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.id,
    s.kinds ? [...(s.id === 'planning' ? planItems : []), ...pipe.items.filter((x) => s.kinds.includes(x.stage))] : []])), [pipe, planItems]);

  const summary = (s) => {
    if (s.id === 'execution') return exec ? `${short(exec.vol)} م³ · ${fmt(exec.n)} موقعاً` : '…';
    const it = byStage[s.id];
    if (!it.length) return 'لا مشاريع بعد';
    return `${fmt(it.length)} مشروعاً · ${short(it.reduce((a, x) => a + (x.volume || 0), 0))} م³`;
  };

  /* إجابات الاستمارة الرسمية تحمل رمز المحافظة (SY..) — نعرض الاسم */
  const named = useMemo(() => {
    const m = new Map((basemap?.governorates || []).map((g) => [g.code, g.name]));
    return surveys.map((s) => (/^SY\d/.test(s.gov || '') && m.get(s.gov) ? { ...s, gov: m.get(s.gov) } : s));
  }, [surveys, basemap]);

  const current = STAGES.find((s) => s.id === stage);

  return (
    <div className="hub">
      <nav className="hub-flow" aria-label="مراحل إدارة الأنقاض">
        {STAGES.map((s, i) => (
          <button type="button" key={s.id} className={`hub-step${stage === s.id ? ' is-on' : ''}`} style={{ '--c': s.color }}
            onClick={() => setStage(s.id)} aria-current={stage === s.id ? 'step' : undefined}>
            <span className="hub-step__n">{i + 1}</span>
            <span className="hub-step__t">{s.title}<small>{s.sub}</small></span>
            <span className="hub-step__s">{summary(s)}</span>
          </button>
        ))}
      </nav>

      {/* سجلّان يخدمان كل المراحل: من يعمل، وأين تذهب الأنقاض */}
      <nav className="hub-side" aria-label="سجلات">
        <button type="button" className={stage === 'overview' ? 'is-on' : ''} onClick={() => setStage('overview')}>
          لمحة عامة
        </button>
        <button type="button" className={`hub-side__atlas${stage === 'atlas' ? ' is-on' : ''}`} onClick={() => setStage('atlas')}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5c-2.6 0-4.5 2-4.5 4.4C3.5 9.3 8 14.5 8 14.5s4.5-5.2 4.5-8.6C12.5 3.5 10.6 1.5 8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="8" cy="6" r="1.7" fill="currentColor" /></svg>
          كميات الأنقاض في سوريا
        </button>
        <button type="button" className={`hub-side__map${stage === 'map' ? ' is-on' : ''}`} onClick={() => setStage('map')}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5 5.5 2l5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5Z M5.5 2v10.5 M10.5 3.5V14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          الخريطة
        </button>
        <button type="button" className={stage === 'directorates' ? 'is-on' : ''} onClick={() => setStage('directorates')}>
          أعمال المديريات
        </button>
        <button type="button" className={stage === 'gallery' ? 'is-on' : ''} onClick={() => setStage('gallery')}>
          الأرشيف المصور
        </button>
        <button type="button" className={stage === 'entities' ? 'is-on' : ''} onClick={() => setStage('entities')}>
          الجهات العاملة وأدوارها
        </button>
        <button type="button" className={stage === 'dumps' ? 'is-on' : ''} onClick={() => setStage('dumps')}>
          المكبات المعتمدة والمقترحة
        </button>
      </nav>

      {stage === 'overview' && <RubbleOverview plan={plan} planItems={planItems} surveys={named} pipe={pipe.items} registry={registry} go={setStage} />}
      {stage === 'directorates' && <DirectorateWorks basemap={basemap} projSurveys={named} planRows={plan.rows} />}
      {stage === 'atlas' && <RubbleAtlas basemap={basemap} />}
      {stage === 'map' && <RubbleMapView />}
      {stage === 'gallery' && <RubbleGallery surveys={named} pipe={pipe.items} />}
      {stage === 'entities' && <Entities surveys={surveys} registry={registry} />}
      {stage === 'dumps' && <Dumps surveys={surveys} registry={registry} basemap={basemap} />}
      {!current ? null : current.id === 'execution'
        ? <RubbleTransfer basemap={basemap} />
        : (
          <>
            {current.id === 'assessment' && <><DamagePanel surveys={surveys} /><EstimateCalc /><DroneCalc /></>}
            {current.id === 'planning' && <PlanChart items={byStage.planning} />}
            <StageList key={current.id} stage={current} items={byStage[current.id]} />
          </>
        )}
    </div>
  );
}
