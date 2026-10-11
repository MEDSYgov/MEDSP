import { getData } from '../data/api';
/*
  عمليات إزالة الأنقاض من تقرير الأعمال الخدمية.

  المصدر نفسه الذي يغذّي تقرير العمليات (services.json): كل سجل صف،
  ونحن نأخذ منه عمليات «ازالة أنقاض» و«إعادة تدوير الأنقاض» فقط،
  والكمية بالمتر المكعب وحدها (المسجّلة بالمتر المربع أو الطولي تُستبعد
  وتُحصى، لأن جمع وحدات مختلفة بلا معنى).

  يُستخدم داخل مشروع الأنقاض ليقارن المشاريع بالأعمال الاعتيادية.
*/

const FEEDS = new Map();

export function loadOps(feed = 'services') {
  if (!FEEDS.has(feed)) {
    FEEDS.set(feed, getData(feed).catch((e) => { FEEDS.delete(feed); throw e; }));
  }
  return FEEDS.get(feed);
}

const norm = (s) => String(s ?? '').trim().replace(/[إأآ]/g, 'ا');

/*
  data    محتوى services.json
  types   أنواع العمليات المطلوبة (بأي صيغة همزة)
  govOf   اسم المحافظة ← رمزها الرسمي
  filter  { gov: 'SY07' } اختياري
*/
export function summarizeOps(data, { types, govOf, filter = {}, highlight = null } = {}) {
  const want = new Set((types || []).map(norm));
  const dimIdx = Object.fromEntries(data.dims.map((d, i) => [d.key, 5 + i]));
  const metricIdx = Object.fromEntries(data.metrics.map((m, i) => [m.key, 5 + data.dims.length + i]));
  const dimValues = Object.fromEntries(data.dims.map((d) => [d.key, d.values]));

  const kindAt = dimIdx.kind;
  const qtyAt = metricIdx.rubble;
  const opsAt = metricIdx.rubbleOps;
  const otherAt = metricIdx.rubbleOther;

  const byGov = new Map();
  const counts = { ownership: new Map(), consent: new Map(), target: new Map() };
  const sites = new Map();
  let quantity = 0;
  let ops = 0;
  let otherUnits = 0;
  const days = [];

  for (const r of data.records) {
    if (!want.has(norm(dimValues.kind[r[kindAt]]))) continue;
    const govName = data.dict.govs[r[1]];
    const code = govOf?.(govName) || govName;
    /* filter.gov: رمز محافظة أو قائمة رموز (تحديد متعدد) */
    const govs = [].concat(filter.gov ?? []);
    if (govs.length && !govs.includes(code)) continue;

    /* الفلترة المتقاطعة: نحسب المجموعة المميَّزة وحدها */
    if (highlight) {
      if (highlight.dim === 'gov') { if (code !== highlight.value) continue; }
      else {
        const at = dimIdx[highlight.dim];
        if (at === undefined || dimValues[highlight.dim][r[at]] !== highlight.value) continue;
      }
    }

    const q = r[qtyAt] || 0;
    quantity += q;
    ops += r[opsAt] || 0;
    otherUnits += r[otherAt] || 0;
    if (r[0]) days.push(r[0]);

    const g = byGov.get(code) || { code, name: govName, quantity: 0, ops: 0 };
    g.quantity += q;
    g.ops += r[opsAt] || 0;
    byGov.set(code, g);

    for (const key of ['ownership', 'consent', 'target']) {
      if (dimIdx[key] === undefined) continue;
      const label = dimValues[key][r[dimIdx[key]]] || '';
      const k = label || '—';
      const cur = counts[key].get(k) || { label: k, count: 0, quantity: 0 };
      cur.count += 1;
      cur.quantity += q;
      counts[key].set(k, cur);
    }

    const site = data.dict.sites[r[4]];
    if (site) {
      const s = sites.get(site.code) || { lon: site.lon, lat: site.lat, name: site.name, count: 0 };
      s.count += 1;
      sites.set(site.code, s);
    }
  }

  const list = (m) => [...m.values()].sort((a, b) => b.count - a.count);
  days.sort();

  return {
    quantity: Math.round(quantity * 10) / 10,
    ops,
    otherUnits,
    avg: ops ? Math.round((quantity / ops) * 10) / 10 : 0,
    byGovernorate: [...byGov.values()].sort((a, b) => b.quantity - a.quantity),
    ownership: list(counts.ownership),
    consent: list(counts.consent),
    target: list(counts.target),
    locations: [...sites.values()].sort((a, b) => b.count - a.count),
    from: days[0] || null,
    to: days[days.length - 1] || null,
  };
}
