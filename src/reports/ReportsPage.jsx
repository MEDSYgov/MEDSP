import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import Glyph from './Glyph';
import { CATEGORIES, CAT, periodLabel, fmtDate, fmtSize } from './catalog';
import { listReports, signedUrls } from './store';
import '../styles/reports.css';

const PdfViewer = lazy(() => import('./PdfViewer'));

/*
  تبويب «التقارير»: مكتبة تقارير PDF مصنّفة، مع مستعرض داخل المنصة.
    #/reports          المكتبة
    #/reports/<id>     تقرير مفتوح في المستعرض (رابط يُنسخ ويُرسل)
  الزائر يرى التقارير «العامة» فقط، والحساب المسجّل يرى الداخلية أيضاً.
*/

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function Cover({ r, url, big }) {
  const cat = CAT[r.category];
  return (
    <div className={`rp-cover rp-cover--${r.category}${big ? ' rp-cover--big' : ''}`}>
      {url ? <img src={url} alt="" loading="lazy" /> : (
        <div className="rp-cover__blank">
          <Glyph name={cat?.icon} />
          <span>{cat?.short}</span>
        </div>
      )}
      <span className="rp-cover__pdf">PDF</span>
    </div>
  );
}

function Meta({ r, guest }) {
  return (
    <div className="rp-meta">
      {r.pages ? <span><bdi dir="ltr">{fmt(r.pages)}</bdi> صفحة</span> : null}
      {r.file_size ? <span>{fmtSize(r.file_size)}</span> : null}
      <span>{fmtDate(r.issued_on)}</span>
      {!guest && r.visibility === 'internal' && <span className="rp-meta__internal"><Glyph name="lock" />داخلي</span>}
    </div>
  );
}

function Card({ r, url, onOpen, guest }) {
  const cat = CAT[r.category];
  const period = periodLabel(r);
  return (
    <button type="button" className="rp-card" onClick={() => onOpen(r)}>
      <Cover r={r} url={url} />
      <div className="rp-card__body">
        <span className={`rp-chip rp-chip--${r.category}`}><Glyph name={cat?.icon} />{cat?.short}{period && <b>{period}</b>}</span>
        <h3>{r.title}</h3>
        {r.event && <p className="rp-card__event">{r.event}{r.govs?.length ? ` · ${r.govs.join('، ')}` : ''}</p>}
        <Meta r={r} guest={guest} />
      </div>
    </button>
  );
}

export default function ReportsPage({ route, guest = false }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [thumbs, setThumbs] = useState({});
  const [cat, setCat] = useState('all');
  const [year, setYear] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    listReports()
      .then(async (rows) => {
        if (!alive) return;
        setList(rows);
        const urls = await signedUrls(rows.map((r) => r.thumb_path));
        if (alive) setThumbs(urls);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);

  const openId = route?.id || null;
  const opened = useMemo(() => list?.find((r) => r.id === openId) || null, [list, openId]);
  const open = (r) => { window.location.hash = `#/reports/${r.id}`; };
  const close = () => { window.location.hash = '#/reports'; };

  const years = useMemo(() => [...new Set((list || []).map((r) => r.period_year || Number(String(r.issued_on).slice(0, 4))))]
    .filter(Boolean).sort((a, b) => b - a), [list]);
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c.id, (list || []).filter((r) => r.category === c.id).length])), [list]);

  const shown = useMemo(() => {
    const t = q.trim();
    return (list || []).filter((r) => (cat === 'all' || r.category === cat)
      && (year === 'all' || (r.period_year || Number(String(r.issued_on).slice(0, 4))) === Number(year))
      && (!t || r.title.includes(t) || r.summary?.includes(t) || r.event?.includes(t)));
  }, [list, cat, year, q]);

  /* التقرير المميّز: آخر تقرير مميَّز، وإلا الأحدث — في عرض «الكل» دون بحث فقط */
  const hero = cat === 'all' && year === 'all' && !q.trim() && list?.length
    ? (list.find((r) => r.featured) || list[0]) : null;
  const grid = hero ? shown.filter((r) => r.id !== hero.id) : shown;
  const latestEmergency = (list || []).find((r) => r.category === 'emergency');

  return (
    <section className="shell rp">
      <div className="report__head"><h1>التقارير</h1></div>
      <p className="report__summary">تقارير مديرية التخطيط والإحصاء: الشهرية والسنوية والطارئة وتقارير المتابعة والدراسات، تُقرأ هنا مباشرة أو تُحمَّل.</p>

      {err && <div className="pending"><h3>تعذّر تحميل التقارير</h3><p>{err}</p></div>}
      {!err && !list && <div className="pending"><p>جارٍ التحميل…</p></div>}

      {list && list.length === 0 && (
        <div className="pending rp-empty">
          <Glyph name="pdf" className="rp-empty__icon" />
          <h3>لا توجد تقارير منشورة بعد</h3>
          <p>{guest ? 'التقارير المتاحة للعموم تظهر هنا فور نشرها. قد تتوفر تقارير أخرى بعد تسجيل الدخول.' : 'يرفع مدير المنصة التقارير من مساحة العمل ← «التقارير».'}</p>
        </div>
      )}

      {list && list.length > 0 && (
        <>
          {latestEmergency && cat === 'all' && hero?.id !== latestEmergency.id && (
            <button type="button" className="rp-alert" onClick={() => open(latestEmergency)}>
              <span className="rp-alert__tag"><Glyph name="emergency" />تقرير طارئ</span>
              <span className="rp-alert__title">{latestEmergency.title}</span>
              <span className="rp-alert__date">{fmtDate(latestEmergency.issued_on)}</span>
            </button>
          )}

          <nav className="rp-tabs" aria-label="أنواع التقارير">
            <button type="button" className={cat === 'all' ? 'is-on' : ''} onClick={() => setCat('all')}>
              <Glyph name="all" />الكل<bdi dir="ltr">{fmt(list.length)}</bdi>
            </button>
            {CATEGORIES.filter((c) => counts[c.id] > 0).map((c) => (
              <button key={c.id} type="button" className={`rp-tabs--${c.id}${cat === c.id ? ' is-on' : ''}`} onClick={() => setCat(c.id)}>
                <Glyph name={c.icon} />{c.name}<bdi dir="ltr">{fmt(counts[c.id])}</bdi>
              </button>
            ))}
          </nav>

          <div className="rp-filters">
            <label className="rp-search">
              <Glyph name="search" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في عناوين التقارير…" />
            </label>
            {years.length > 1 && (
              <div className="rp-years">
                <button type="button" className={year === 'all' ? 'is-on' : ''} onClick={() => setYear('all')}>كل السنوات</button>
                {years.map((y) => (
                  <button key={y} type="button" className={String(year) === String(y) ? 'is-on' : ''} onClick={() => setYear(String(y))}><bdi dir="ltr">{y}</bdi></button>
                ))}
              </div>
            )}
          </div>

          {cat !== 'all' && <p className="rp-cathint">{CAT[cat].hint}</p>}

          {hero && (
            <button type="button" className="rp-hero" onClick={() => open(hero)}>
              <Cover r={hero} url={thumbs[hero.thumb_path]} big />
              <div className="rp-hero__body">
                <span className="rp-hero__kicker">{hero.featured ? 'تقرير مميّز' : 'أحدث تقرير'}</span>
                <span className={`rp-chip rp-chip--${hero.category}`}><Glyph name={CAT[hero.category]?.icon} />{CAT[hero.category]?.short}{periodLabel(hero) && <b>{periodLabel(hero)}</b>}</span>
                <h2>{hero.title}</h2>
                {hero.summary && <p>{hero.summary}</p>}
                <Meta r={hero} guest={guest} />
                <span className="rp-hero__cta">اقرأ التقرير</span>
              </div>
            </button>
          )}

          {grid.length > 0 && <div className="rp-grid">{grid.map((r) => <Card key={r.id} r={r} url={thumbs[r.thumb_path]} onOpen={open} guest={guest} />)}</div>}
          {shown.length === 0 && <div className="pending"><p>لا تقارير تطابق اختيارك.</p></div>}
        </>
      )}

      {openId && list && !opened && (
        <div className="pending"><h3>التقرير غير متاح</h3><p>ربما أُلغي نشره، أو يحتاج تسجيل الدخول لرؤيته.</p><a className="q-btn" href="#/reports">كل التقارير</a></div>
      )}
      {opened && (
        <Suspense fallback={null}>
          <PdfViewer key={opened.id} report={opened} onClose={close} />
        </Suspense>
      )}
    </section>
  );
}
