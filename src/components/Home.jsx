import { useState } from 'react';
import useReportStats from '../hooks/useReportStats';
import Filters from './Filters';
import SyriaMap from './SyriaMap';
import BarChart from './BarChart';
import Figure from './Figure';
import Icon from './Icon';
import NewsTicker from './NewsTicker';
import { Panel, Toll } from './ReportShell';
import { categories } from '../data/categories';

const fmt = (n) => Number(n).toLocaleString('en-US');

/*
  إحصائيات طُلبت ولا تتوفر لها بيانات في ملف التصدير الحالي.
  تُعرض معطّلة تمهيداً لإضافتها حين يصبح مصدرها متاحاً.
*/
const PLANNED = [
  { label: 'عمليات الذخائر غير المنفجرة', icon: 'target' },
  { label: 'التدريبات', icon: 'staff' },
  { label: 'الإغاثة الطارئة', icon: 'area' },
  { label: 'الشكاوى والاقتراحات', icon: 'civilian' },
  { label: 'المستفيدون', icon: 'civilianHurt' },
];

const ICONS = {
  'عملية أطفاء': 'flame',
  إسعاف: 'civilianHurt',
  'أعمال خدمية': 'area',
  'حادث سير': 'target',
  'انقاذ بارد': 'staff',
  'انقاذ حيوان': 'staff',
  'إنتشال غريق': 'civilian',
  'وسم أماكن خطرة': 'target',
  هجمات: 'flame',
  'إخلاء مدنيين': 'civilian',
};

function OpCard({ name, op, value, onOpen }) {
  return (
    <button type="button" className="opcard" onClick={onOpen}>
      <Icon name={ICONS[op] ?? 'target'} className="opcard__icon" />
      <Figure value={value} className="opcard__value" />
      <span className="opcard__label">{name}</span>
    </button>
  );
}

export default function Home({ report, basemap, onOpen }) {
  const [range, setRange] = useState({ from: report.from, to: report.to });
  const [directorate, setDirectorate] = useState([]);
  const [center, setCenter] = useState([]);
  /* المحافظة ← المنطقة ← الناحية: تغيير مستوى يمسح ما تحته */
  const [geo, setGeo] = useState({ gov: [], area: [], sub: [] });
  const pickGeo = (level, v) => setGeo((g) => ({
    ...g, [level]: v,
    ...(level === 'gov' ? { area: [], sub: [] } : level === 'area' ? { sub: [] } : {}),
  }));

  const data = useReportStats(report, range, { directorate, center, geo });

  const pickDirectorate = (value) => {
    setDirectorate(value);
    setCenter([]);
  };

  const reset = () => {
    setRange({ from: report.from, to: report.to });
    setDirectorate([]);
    setCenter([]);
    setGeo({ gov: [], area: [], sub: [] });
  };

  const byOp = data.dims.operation.data;
  const valueOf = (op) => byOp.find((x) => x.label === op)?.value ?? 0;

  return (
    <>
      <NewsTicker />
      <Filters
        bounds={{ from: report.from, to: report.to }}
        range={range}
        onRange={setRange}
        directorates={data.directorates}
        centers={data.availableCenters}
        directorate={directorate}
        center={center}
        onDirectorate={pickDirectorate}
        onCenter={setCenter}
        onReset={reset}
        geo={geo}
        onGeo={pickGeo}
        geoOptions={data.geoOptions}
        count={data.total}
      />

      <section className="hero">
        <div className="hero__primary">
          <span className="hero__eyebrow">
            <Icon name="target" />
            إجمالي العمليات المسجّلة
          </span>
          <Figure value={data.total} className="hero__figure" />
          <span className="hero__sub">
            في {fmt(data.locations.length)} موقعاً ضمن {fmt(data.byGovernorate.length)} محافظة
          </span>
        </div>

        <div className="hero__side">
          <article className="stat">
            <span className="stat__head">
              <Icon name="civilianHurt" className="icon--teal" />
              <span className="stat__label">إجمالي الإصابات</span>
            </span>
            <span className="stat__value">
              <Figure value={data.metrics.injured.sum} className="stat__number" />
              <em>إصابة</em>
            </span>
            <span className="stat__note">مدنيون وكوادر الوزارة معاً</span>
          </article>

          <article className="stat">
            <span className="stat__head">
              <Icon name="civilian" className="icon--teal" />
              <span className="stat__label">إجمالي الوفيات</span>
            </span>
            <span className="stat__value">
              <Figure value={data.metrics.dead.sum} className="stat__number" />
              <em>وفاة</em>
            </span>
            <span className="stat__note">مدنيون وكوادر الوزارة معاً</span>
          </article>

          <article className="stat">
            <span className="stat__head">
              <Icon name="staff" className="icon--forest" />
              <span className="stat__label">الكادر المشارك</span>
            </span>
            <span className="stat__value">
              <Figure value={data.metrics.crew.sum} className="stat__number" />
              <em>مشاركة</em>
            </span>
            <span className="stat__note">
              {data.metrics.crew.anomalies > 0
                ? `استُبعدت ${fmt(data.metrics.crew.anomalies)} قيمة غير منطقية`
                : 'مجموع مشاركات الكوادر في كل العمليات'}
            </span>
          </article>
        </div>
      </section>

      <div className="panels">
        <Panel title="العمليات حسب النوع" note="اضغط أي بطاقة لفتح تقريرها" span="full">
          <div className="opgrid">
            {categories.map((c) => (
              <OpCard
                key={c.id}
                name={c.name}
                op={c.op}
                value={valueOf(c.op)}
                onOpen={() => onOpen(c.id)}
              />
            ))}
          </div>
        </Panel>

        <Panel
          title="إحصائيات قيد الإضافة"
          note="طُلبت ولا يتضمنها ملف التصدير الحالي — تُفعَّل فور توفّر مصدرها"
          span="full"
        >
          <div className="opgrid opgrid--muted">
            {PLANNED.map((p) => (
              <div className="opcard opcard--off" key={p.label}>
                <Icon name={p.icon} className="opcard__icon" />
                <span className="opcard__value">—</span>
                <span className="opcard__label">{p.label}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="الأثر البشري" note="مجموع الإصابات والوفيات في كل العمليات" span="full">
          <Toll
            rows={[
              { label: 'إجمالي الإصابات', value: data.metrics.injured.sum, icon: 'civilianHurt' },
              { label: 'إجمالي الوفيات', value: data.metrics.dead.sum, icon: 'civilian', staff: true },
            ]}
          />
        </Panel>

        <Panel
          span="full"
          title="التوزّع الجغرافي"
          note={`${fmt(data.locations.length)} موقعاً مُرمّزاً لكل أنواع العمليات`}
        >
          <SyriaMap basemap={basemap} locations={data.locations} />
        </Panel>

        <Panel title="عدد العمليات حسب النوع" span="wide">
          <BarChart data={byOp} tone="gold" showShare />
        </Panel>

        <Panel title="عدد العمليات حسب المحافظة" span="wide">
          <BarChart data={data.byGovernorate} showShare />
        </Panel>
      </div>
    </>
  );
}
