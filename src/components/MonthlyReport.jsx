import { useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import BarChart from './BarChart';
import Donut from './Donut';
import Dropdown from './Dropdown';
import Icon from './Icon';
import { getData } from '../data/api';

/*
  التقرير الشهري: الأشكال الإحصائية التي كانت تُجهَّز يدوياً من Excel.
  الفلتر الزمني بالسنة والشهر فقط، وكل شكل قابل للتحميل كصورة PNG.

  ترتيب أعمدة السجل: [اليوم, المحافظة, المديرية, المركز, الموقع, ...الأبعاد, ...المقاييس]
*/

const BASE = 5;
const FEEDS = ['overview', 'fire', 'ambulance', 'traffic', 'drowning', 'cold-rescue',
  'hazard-marking', 'attacks', 'services'];

const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

const fmt = (n) => Number(n).toLocaleString('en-US');
const round1 = (n) => Math.round(n * 10) / 10;

/* تجميع السجلات حسب مفتاح (محافظة، بعد، موقع) مع العدّ أو جمع مقياس */
function group(rep, rows, by, metric = null) {
  if (!rep) return [];
  const dimPos = rep.dims.findIndex((d) => d.key === by);
  const mPos = metric ? rep.metrics.findIndex((m) => m.key === metric) : -1;
  const m = new Map();
  for (const r of rows) {
    let label;
    if (by === 'gov') label = rep.dict.govs[r[1]];
    else if (by === 'site') label = rep.dict.sites[r[4]]?.name;
    else label = dimPos >= 0 ? rep.dims[dimPos].values[r[BASE + dimPos]] : null;
    if (!label) continue;
    const v = mPos >= 0 ? r[BASE + rep.dims.length + mPos] || 0 : 1;
    m.set(label, (m.get(label) || 0) + v);
  }
  return [...m.entries()].map(([label, value]) => ({ label, value: round1(value) }))
    .filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
}

function sums(rep, rows, parts) {
  if (!rep) return [];
  return parts.map(([key, label]) => {
    const pos = rep.metrics.findIndex((x) => x.key === key);
    const value = pos < 0 ? 0 : rows.reduce((a, r) => a + (r[BASE + rep.dims.length + pos] || 0), 0);
    return { label, value: round1(value) };
  }).filter((d) => d.value > 0);
}

function ChartCard({ title, period, note, data, kind = 'bar', tone = 'forest', max = 14, unit }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const empty = !data || data.length === 0;

  const download = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor || '#f6f4e9';
      const url = await toPng(ref.current, { pixelRatio: 2, backgroundColor: bg, cacheBust: true,
        filter: (n) => !(n.classList && n.classList.contains('mchart__dl')) });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title} - ${period}.png`;
      a.click();
    } finally { setBusy(false); }
  };

  return (
    <section className={`mchart${empty ? ' is-empty' : ''}`} ref={ref}>
      <header className="mchart__head">
        <div>
          <h3>{title}</h3>
          <p className="mchart__period">{period}{note ? ` — ${note}` : ''}</p>
        </div>
        {!empty && (
          <button type="button" className="mchart__dl" onClick={download} disabled={busy} title="تحميل كصورة">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10"
              fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {busy ? 'جارٍ التحميل…' : 'صورة'}
          </button>
        )}
      </header>
      <div className="mchart__body">
        {empty ? (
          <p className="mchart__none">لا يوجد بيانات بعد</p>
        ) : kind === 'donut' ? (
          <Donut data={data.map((d) => ({ ...d, key: d.label }))} tone={tone} unit={unit} />
        ) : (
          <BarChart data={data.map((d) => ({ ...d, key: d.label }))} tone={tone} max={max} showShare />
        )}
      </div>
    </section>
  );
}

export default function MonthlyReport() {
  const [reps, setReps] = useState(null);
  const [error, setError] = useState(false);
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);

  useEffect(() => {
    Promise.all(FEEDS.map((f) => getData(f)))
      .then((list) => setReps(Object.fromEntries(FEEDS.map((f, i) => [f, list[i]]))))
      .catch(() => setError(true));
  }, []);

  /* الأشهر المتاحة من السجلات الفعلية */
  const available = useMemo(() => {
    if (!reps) return [];
    const set = new Set();
    for (const r of reps.overview.records) if (r[0]) set.add(r[0].slice(0, 7));
    return [...set].sort();
  }, [reps]);

  useEffect(() => {
    if (available.length && !year) {
      const last = available[available.length - 1];
      setYear(last.slice(0, 4));
      setMonth(last.slice(5, 7));
    }
  }, [available, year]);

  const years = [...new Set(available.map((m) => m.slice(0, 4)))].reverse();
  const monthsOfYear = available.filter((m) => m.startsWith(`${year}-`)).map((m) => m.slice(5, 7));

  const prefix = month ? `${year}-${month}` : `${year}-`;
  const period = year ? (month ? `${MONTHS[Number(month) - 1]} ${year}` : `عام ${year}`) : '';

  const charts = useMemo(() => {
    if (!reps || !year) return null;
    const rows = Object.fromEntries(FEEDS.map((f) => [f, reps[f].records.filter((r) => r[0]?.startsWith(prefix))]));
    const R = (f) => [reps[f], rows[f]];

    const trafficSites = (() => {
      const [rep, rs] = R('traffic');
      const count = new Map(group(rep, rs, 'site').map((d) => [d.label, d.value]));
      const injured = new Map(group(rep, rs, 'site', 'injured').map((d) => [d.label, d.value]));
      return [...count.entries()]
        .map(([label, n]) => ({ label: `${label} (${fmt(n)} حادث)`, value: injured.get(label) || 0, n }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value || b.n - a.n);
    })();

    const ambGender = (() => {
      const [rep, rs] = R('ambulance');
      const ben = sums(rep, rs, [['benMen', 'رجال'], ['benWomen', 'نساء'], ['benKids', 'أطفال']]);
      if (ben.length) return { data: ben, note: null };
      return { data: sums(rep, rs, [['injMen', 'رجال'], ['injWomen', 'نساء'], ['injKids', 'أطفال']]),
        note: 'محسوبة من أعداد المصابين المسعَفين' };
    })();

    return [
      { title: 'عدد الاستجابات حسب نوع العملية', data: group(...R('overview'), 'operation') },
      { title: 'عدد الاستجابات حسب المحافظات', data: group(...R('overview'), 'gov'), tone: 'teal' },
      { title: 'توزع الاستجابات حسب نوع الانفجار أو الهجوم', data: group(...R('attacks'), 'kind'), tone: 'gold' },
      { title: 'أسباب الحرائق', data: group(...R('fire'), 'cause') },
      { title: 'توزع الحرائق حسب المحافظات', data: group(...R('fire'), 'gov'), tone: 'teal' },
      { title: 'عمليات الإنقاذ البارد حسب نوعها', data: group(...R('cold-rescue'), 'kind'), tone: 'gold' },
      {
        title: 'توزع المصابين والوفيات خلال حوادث السير',
        data: sums(...R('traffic'), [['injMen', 'مصابون — رجال'], ['injWomen', 'مصابون — نساء'], ['injKids', 'مصابون — أطفال'],
          ['deadMen', 'وفيات — رجال'], ['deadWomen', 'وفيات — نساء'], ['deadKids', 'وفيات — أطفال']]),
      },
      { title: 'أكثر المناطق التي شهدت حوادث سير وأعداد المصابين', data: trafficSites, max: 10, tone: 'teal',
        note: 'الطول = عدد المصابين' },
      { title: 'توزع حالات الغرق حسب مكان الغرق', data: group(...R('drowning'), 'place'), kind: 'donut', tone: 'teal' },
      { title: 'توزع حالات الغرق حسب سبب الغرق', data: group(...R('drowning'), 'cause'), tone: 'gold' },
      { title: 'توزع المستفيدين من خدمة الإسعاف (رجال، نساء، أطفال)', data: ambGender.data, note: ambGender.note,
        kind: 'donut', unit: 'مستفيد' },
      { title: 'أنماط عمليات الإسعاف الأكثر شيوعاً', data: group(...R('ambulance'), 'reason'), max: 10, tone: 'teal' },
      { title: 'توزع عمليات وسم الأماكن الخطرة حسب المحافظة', data: group(...R('hazard-marking'), 'gov'), tone: 'gold' },
      { title: 'توزع أعمال التعافي المبكر حسب المحافظات', data: group(...R('services'), 'gov') },
      { title: 'توزع أعمال التعافي حسب قطاع الاستجابة', data: group(...R('services'), 'sector'), kind: 'donut', tone: 'teal' },
      { title: 'كمية الأنقاض المُزالة من المناطق المستهدفة حسب المحافظة', data: group(...R('services'), 'gov', 'rubble'),
        tone: 'gold', note: 'بالمتر المكعب' },
      { title: 'الدورات والتدريبات المنفذة', data: [] },
      { title: 'عدد التدريبات والمستفيدون منها حسب المديرية', data: [] },
      { title: 'توزع أعمال الإغاثة الطارئة حسب المحافظة', data: [] },
      { title: 'توزع أعمال الإغاثة الطارئة حسب القطاع الإنساني', data: [] },
      { title: 'عدد الاستجابات والأسر المستفيدة حسب مقدمي الخدمة', data: [] },
      { title: 'توزع أعمال المسح والإزالة حسب النوع', data: [] },
      { title: 'توزع عمليات المسح والإزالة حسب المحافظة', data: [] },
    ];
  }, [reps, year, prefix]);

  if (error) return <div className="pending"><h3>تعذّر تحميل البيانات</h3><p>حدّث الصفحة وحاول مجدداً.</p></div>;
  if (!charts) return <p className="results__empty">جارٍ التحميل…</p>;

  return (
    <>
      <div className="filters mfilters">
        <div className="filters__fields" style={{ '--n': 2 }}>
          <div className="ffield">
            <span className="ffield__label">السنة</span>
            <Dropdown label="السنة" placeholder="اختر السنة" value={year}
              onChange={(v) => { if (!v) return; setYear(v); setMonth(available.filter((m) => m.startsWith(`${v}-`)).pop()?.slice(5, 7) ?? null); }}
              options={years.map((y) => ({ value: y, label: y }))} />
          </div>
          <div className="ffield">
            <span className="ffield__label">الشهر</span>
            <Dropdown label="الشهر" placeholder="كل أشهر السنة" value={month}
              onChange={setMonth}
              options={monthsOfYear.map((m) => ({ value: m, label: `${MONTHS[Number(m) - 1]} (${Number(m)})` }))} />
          </div>
        </div>
      </div>

      <p className="mreport__lead">
        <Icon name="target" /> التقرير الشهري — <b>{period}</b>. اضغط «صورة» أعلى أي شكل لتحميله.
      </p>

      <div className="mgrid">
        {charts.map((c) => <ChartCard key={c.title} period={period} {...c} />)}
      </div>
    </>
  );
}
