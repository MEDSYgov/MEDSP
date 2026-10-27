import { useEffect, useRef, useState } from 'react';

/*
  عارض شرائح الشاشات. يُستخدم في:
    - صفحة الشاشات العامة (#/screen) بملء الشاشة
    - معاينة لوحة الإدارة، داخل إطار مصغّر بنسبة 16:9
  الأرقام لاتينية دائماً، وتُعزل باتجاه LTR داخل النص العربي.
*/

const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const big = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return { n: fmt(v / 1e6, 1), unit: 'مليون' };
  return { n: fmt(v), unit: '' };
};

/* عدّ تصاعدي قصير عند ظهور الشريحة */
function Count({ value, decimals = 0, run }) {
  const [v, setV] = useState(run ? 0 : value);
  useEffect(() => {
    if (!run) { setV(value); return undefined; }
    let raf; const t0 = performance.now(); const dur = 1400;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      setV(value * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, run]);
  return <bdi className="sx-num" dir="ltr">{fmt(v, decimals)}</bdi>;
}

function Delta({ now, prev, label }) {
  if (!prev) return null;
  const pct = ((now - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span className={`sx-delta ${up ? 'is-up' : 'is-down'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <bdi dir="ltr">{fmt(Math.abs(pct), 1)}%</bdi>
      <span className="sx-delta__lbl">{label}</span>
    </span>
  );
}

function Bars({ items, run, max = 8, unit }) {
  const list = items.slice(0, max);
  const top = Math.max(...list.map((x) => x.value), 1);
  return (
    <ol className="sx-bars">
      {list.map((x, i) => (
        <li key={x.name} style={{ '--i': i }}>
          <span className="sx-bars__name">{x.name}</span>
          <span className="sx-bars__track">
            <span className="sx-bars__fill" style={{ '--w': `${(x.value / top) * 100}%` }} />
          </span>
          <span className="sx-bars__val"><Count value={x.value} run={run} />{unit && <small> {unit}</small>}</span>
        </li>
      ))}
    </ol>
  );
}

function Ring({ pct, run }) {
  const r = 84; const c = 2 * Math.PI * r;
  return (
    <svg className="sx-ring" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r={r} className="sx-ring__track" />
      <circle cx="100" cy="100" r={r} className="sx-ring__fill"
        style={{ strokeDasharray: c, strokeDashoffset: c * (1 - Math.min(100, pct) / 100), '--c': c, animationPlayState: run ? 'running' : 'paused' }}
        transform="rotate(-90 100 100)" />
    </svg>
  );
}

function Slide({ s, run }) {
  if (s.id === 'ops-total') {
    return (
      <div className="sx-hero">
        <p className="sx-kicker">عمليات الدفاع المدني · {s.month}</p>
        <div className="sx-giant"><Count value={s.value} run={run} /></div>
        <p className="sx-sub">عملية نُفّذت خلال الشهر</p>
        <Delta now={s.value} prev={s.prev} label={`مقارنة بـ${s.prevMonth}`} />
        <div className="sx-foot-stat">
          <span>منذ {s.since}</span>
          <strong><Count value={s.total} run={run} /></strong>
          <span>عملية</span>
        </div>
      </div>
    );
  }
  if (s.id === 'ops-breakdown' || s.id === 'ops-govs') {
    const sum = s.items.reduce((a, x) => a + x.value, 0);
    return (
      <div className="sx-split">
        <div className="sx-side">
          <p className="sx-kicker">{s.month}</p>
          <h2 className="sx-title">{s.title}</h2>
          <div className="sx-mid"><Count value={sum} run={run} /></div>
          <p className="sx-sub">عملية في {s.id === 'ops-govs' ? `${s.items.length} محافظة` : `${s.items.length} تصنيفات`}</p>
        </div>
        <Bars items={s.items} run={run} max={s.id === 'ops-govs' ? 10 : 8} />
      </div>
    );
  }
  if (s.id === 'ops-impact') {
    const cells = [
      ['الإصابات المُسعفة', s.injured],
      ['الوفيات', s.dead],
      ['المستفيدون', s.beneficiaries],
    ].filter(([, v]) => v > 0);
    return (
      <div className="sx-stack">
        <p className="sx-kicker">{s.month}</p>
        <h2 className="sx-title">{s.title}</h2>
        <div className="sx-tiles" style={{ '--n': cells.length }}>
          {cells.map(([l, v], i) => (
            <div key={l} className="sx-tile" style={{ '--i': i }}>
              <div className="sx-mid"><Count value={v} run={run} /></div>
              <span className="sx-tile__lbl">{l}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (s.id === 'ops-trend') {
    const top = Math.max(...s.items.map((x) => x.value), 1);
    return (
      <div className="sx-stack">
        <p className="sx-kicker">آخر {s.items.length} شهراً</p>
        <h2 className="sx-title">{s.title}</h2>
        <div className="sx-cols">
          {s.items.map((x, i) => (
            <div key={x.name} className={`sx-col${i === s.items.length - 1 ? ' is-last' : ''}`} style={{ '--i': i }}>
              <bdi dir="ltr" className="sx-col__val">{fmt(x.value)}</bdi>
              <span className="sx-col__bar" style={{ '--h': `${(x.value / top) * 100}%` }} />
              <span className="sx-col__lbl">{x.short}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (s.id === 'rubble-progress') {
    const p = big(s.planned); const e = big(s.executed);
    return (
      <div className="sx-split">
        <div className="sx-ringbox">
          <Ring pct={s.pct} run={run} />
          <div className="sx-ringbox__in">
            <div className="sx-mid"><Count value={s.pct} decimals={1} run={run} /><span className="sx-pct">%</span></div>
            <span className="sx-sub">نسبة الإنجاز</span>
          </div>
        </div>
        <div className="sx-side">
          <p className="sx-kicker">مشروع ترحيل الأنقاض · حتى {s.asOf}</p>
          <h2 className="sx-title">{s.title}</h2>
          <dl className="sx-pairs">
            <div><dt>الكمية المخطط لها</dt><dd><bdi dir="ltr">{p.n}</bdi> {p.unit} م³</dd></div>
            <div className="is-gold"><dt>الكمية المنفّذة</dt><dd><bdi dir="ltr">{e.n}</bdi> {e.unit} م³</dd></div>
          </dl>
        </div>
      </div>
    );
  }
  if (s.id === 'rubble-govs') {
    const top = Math.max(...s.items.map((x) => Math.max(x.planned, x.executed)), 1);
    return (
      <div className="sx-stack">
        <p className="sx-kicker">بالمتر المكعب · حتى {s.asOf}</p>
        <h2 className="sx-title">{s.title}</h2>
        <div className="sx-legend"><span className="sx-lg-plan">المخطط له</span><span className="sx-lg-done">المنفّذ</span></div>
        <ol className="sx-bars sx-bars--pair">
          {s.items.slice(0, 8).map((x, i) => (
            <li key={x.name} style={{ '--i': i }}>
              <span className="sx-bars__name">{x.name}</span>
              <span className="sx-bars__track">
                <span className="sx-bars__fill is-plan" style={{ '--w': `${(x.planned / top) * 100}%` }} />
                <span className="sx-bars__fill is-done" style={{ '--w': `${(x.executed / top) * 100}%` }} />
              </span>
              <span className="sx-bars__val"><bdi dir="ltr">{fmt(x.executed)}</bdi><small> / <bdi dir="ltr">{fmt(x.planned)}</bdi></small></span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (s.id === 'rubble-assessment') {
    const v = big(s.volume);
    return (
      <div className="sx-split">
        <div className="sx-side">
          <p className="sx-kicker">التقييم الميداني</p>
          <h2 className="sx-title">{s.title}</h2>
          <div className="sx-mid"><bdi dir="ltr" className="sx-num">{v.n}</bdi> <span className="sx-unit">{v.unit} م³</span></div>
          <p className="sx-sub">في <bdi dir="ltr">{fmt(s.sites)}</bdi> موقعاً مُقيّماً</p>
        </div>
        <Bars items={s.items} run={run} unit="م³" />
      </div>
    );
  }
  if (s.id === 'message') {
    return (
      <div className="sx-message">
        {s.heading && <h2 className="sx-giant-text">{s.heading}</h2>}
        {s.text && <p className="sx-message__text">{s.text}</p>}
      </div>
    );
  }
  return null;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('ar-SY-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return <div className="sx-clock"><bdi dir="ltr" className="sx-clock__t">{time}</bdi><span>{date}</span></div>;
}

export default function ScreenDeck({ data, preview = false }) {
  const slides = data?.slides || [];
  const [i, setI] = useState(0);
  const [tick, setTick] = useState(0);
  const sec = Math.max(5, data?.interval || 15);
  const key = slides.map((s) => s.id).join('|');
  const last = useRef(key);

  useEffect(() => { if (last.current !== key) { last.current = key; setI(0); } }, [key]);
  useEffect(() => {
    if (slides.length < 2) return undefined;
    const t = setTimeout(() => { setI((x) => (x + 1) % slides.length); setTick((n) => n + 1); }, sec * 1000);
    return () => clearTimeout(t);
  }, [i, sec, slides.length]);

  const cur = slides[Math.min(i, slides.length - 1)];
  return (
    <div className={`sx${preview ? ' sx--preview' : ''}`} style={{ '--sec': `${sec}s` }}>
      <header className="sx-top">
        <img className="sx-emblem" src="brand/emblem.svg" alt="" />
        <div className="sx-brand">
          <strong>وزارة الطوارئ وإدارة الكوارث</strong>
          <span>مديرية التخطيط والإحصاء</span>
        </div>
        <Clock />
      </header>
      <div className="sx-band" aria-hidden="true" />

      <main className="sx-stage">
        {cur ? (
          <section key={`${cur.id}-${tick}`} className="sx-slide">
            <Slide s={cur} run />
          </section>
        ) : (
          <section className="sx-slide sx-idle">
            <img src="brand/emblem.svg" alt="" />
            <p>وزارة الطوارئ وإدارة الكوارث</p>
          </section>
        )}
      </main>

      {slides.length > 1 && (
        <nav className="sx-dots" aria-hidden="true">
          {slides.map((s, k) => (
            <span key={s.id} className={k === i ? 'is-on' : k < i ? 'is-past' : ''}>
              {k === i && <span key={tick} className="sx-dots__run" />}
            </span>
          ))}
        </nav>
      )}
    </div>
  );
}
