import { useEffect, useState } from 'react';

/*
  شريط «آخر الإحصائيات» على نمط الشريط الإخباري، أعلى النظرة العامة.

  مصدره نفس مصدر شاشات العرض (/api/screen)، فيعرض فقط ما اعتمده
  مدير المنصة من لوحة «شاشات العرض»: الشرائح المخفية والتصنيفات
  والمحافظات المخفية لا تظهر هنا أيضاً، وإيقاف الشاشات يخفي الشريط.
*/

const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: d });
const mil = (n) => (n >= 1e6 ? `${fmt(n / 1e6, 1)} مليون` : fmt(n));
const N = ({ children }) => <bdi dir="ltr" className="ticker__n">{children}</bdi>;

/* كل شريحة تتحول إلى خبر أو أكثر */
function itemsOf(s) {
  switch (s.id) {
    case 'ops-total': {
      const pct = s.prev ? ((s.value - s.prev) / s.prev) * 100 : null;
      return [
        <>عمليات الدفاع المدني في {s.month}: <N>{fmt(s.value)}</N> عملية
          {pct !== null && <> <span className={pct >= 0 ? 'ticker__up' : 'ticker__down'}>{pct >= 0 ? '▲' : '▼'} <N>{fmt(Math.abs(pct), 1)}%</N></span> عن {s.prevMonth}</>}</>,
        <>إجمالي العمليات منذ {s.since}: <N>{fmt(s.total)}</N> عملية</>,
      ];
    }
    case 'ops-breakdown':
      return s.items.slice(0, 5).map((x) => <>{x.name} في {s.month}: <N>{fmt(x.value)}</N> عملية</>);
    case 'ops-govs':
      return s.items.slice(0, 3).map((x, i) => <>{i === 0 ? 'المحافظة الأكثر عمليات' : x.name} في {s.month}: {i === 0 && <>{x.name} بـ</>}<N>{fmt(x.value)}</N> عملية</>);
    case 'ops-impact':
      return [
        s.injured > 0 && <>إسعاف <N>{fmt(s.injured)}</N> إصابة خلال {s.month}</>,
        s.beneficiaries > 0 && <><N>{fmt(s.beneficiaries)}</N> مستفيداً من خدمات الدفاع المدني في {s.month}</>,
      ].filter(Boolean);
    case 'ops-trend': {
      const top = [...s.items].sort((a, b) => b.value - a.value)[0];
      return top ? [<>الشهر الأعلى نشاطاً خلال العام: {top.name} بـ<N>{fmt(top.value)}</N> عملية</>] : [];
    }
    case 'rubble-progress':
      return [<>ترحيل الأنقاض: إنجاز <N>{fmt(s.pct, 1)}%</N> من الكمية المخطط لها، بترحيل <N>{mil(s.executed)}</N> م³</>];
    case 'rubble-govs': {
      const top = [...s.items].sort((a, b) => b.executed - a.executed)[0];
      return top?.executed ? [<>{top.name} في صدارة ترحيل الأنقاض بـ<N>{mil(top.executed)}</N> م³</>] : [];
    }
    case 'rubble-assessment':
      return [<>التقييم الميداني: <N>{mil(s.volume)}</N> م³ من الأنقاض في <N>{fmt(s.sites)}</N> موقعاً</>];
    case 'message':
      return [s.heading || s.text];
    default:
      return [];
  }
}

export default function NewsTicker() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    const load = () => fetch('api/screen', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setItems(d.paused ? [] : d.slides.flatMap(itemsOf)); })
      .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!items.length) return null;

  /* السرعة ثابتة مهما كان عدد الأخبار: نحو 5 ثوانٍ لكل خبر */
  const list = items.map((it, i) => <li key={i}>{it}</li>);
  return (
    <aside className="ticker" aria-label="آخر الإحصائيات">
      <span className="ticker__label"><span className="ticker__dot" aria-hidden="true" />آخر الإحصائيات</span>
      <div className="ticker__view">
        <div className="ticker__track" style={{ '--dur': `${Math.max(20, items.length * 6)}s` }}>
          <ul>{list}</ul>
          <ul aria-hidden="true">{list}</ul>
        </div>
      </div>
    </aside>
  );
}
