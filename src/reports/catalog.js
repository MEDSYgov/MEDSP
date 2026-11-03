/*
  مكتبة التقارير: الأنواع وتسمياتها.
  المعرّفات تطابق قيد category في جدول reports (ملف الترحيل 20261028120000).
*/

export const CATEGORIES = [
  { id: 'monthly', name: 'التقارير الشهرية', short: 'شهري', icon: 'monthly',
    hint: 'حصاد عمليات الوزارة ونشاطها خلال الشهر.', period: 'month' },
  { id: 'annual', name: 'التقارير السنوية', short: 'سنوي', icon: 'annual',
    hint: 'الحصيلة الكاملة للعام والمقارنة بالأعوام السابقة.', period: 'year' },
  { id: 'emergency', name: 'التقارير الطارئة', short: 'طارئ', icon: 'emergency',
    hint: 'تقارير الحوادث والكوارث فور وقوعها: زلازل، فيضانات، حرائق كبرى.', period: 'event' },
  { id: 'progress', name: 'تقارير المشاريع والمتابعة', short: 'مرحلي', icon: 'progress',
    hint: 'تقارير مرحلية لسير المشاريع، كمشروع ترحيل الأنقاض.', period: 'none' },
  { id: 'study', name: 'الدراسات والتقارير التحليلية', short: 'دراسة', icon: 'study',
    hint: 'دراسات معمّقة وتحليلات لقضايا بعينها.', period: 'none' },
  { id: 'other', name: 'تقارير أخرى', short: 'أخرى', icon: 'other',
    hint: 'ما لا يندرج تحت الأنواع السابقة.', period: 'none' },
];

export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

export const GOVS = ['دمشق', 'ريف دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس', 'إدلب', 'درعا', 'السويداء', 'القنيطرة', 'دير الزور', 'الرقة', 'الحسكة'];

/* وصف الفترة كما يُعرض على البطاقة */
export function periodLabel(r) {
  if (r.category === 'monthly' && r.period_month && r.period_year) return `${MONTHS[r.period_month - 1]} ${r.period_year}`;
  if (r.period_year && (r.category === 'annual' || !r.period_month)) return `عام ${r.period_year}`;
  if (r.period_month && r.period_year) return `${MONTHS[r.period_month - 1]} ${r.period_year}`;
  return '';
}

export const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
};

export const fmtSize = (b) => {
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} ك.ب`;
  return `${(b / 1024 / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} م.ب`;
};

export const BUCKET = 'reports';
export const MAX_BYTES = 50 * 1024 * 1024;
