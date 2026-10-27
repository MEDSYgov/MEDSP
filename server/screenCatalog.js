/*
  شاشات العرض: كتالوج الشرائح وإعداداتها الافتراضية.
  ملف مشترك بين الخادم (server/screenHandler.js) ولوحة الإدارة (src/admin/ScreenPanel.jsx).
  لا يعتمد على أي مكتبة، فيعمل في Node وفي المتصفح.

  مبدأ الأمان: صفحة الشاشات عامة، لذلك يرسل الخادم أرقاماً مجمّعة فقط،
  ولا يرسل إلا الشرائح المفعّلة. لا سجلات تفصيلية ولا أسماء أشخاص.
*/

export const SLIDES = [
  { id: 'ops-total', group: 'العمليات', title: 'إجمالي العمليات', hint: 'عدد عمليات الشهر الأخير ومقارنته بالشهر السابق، مع الإجمالي منذ بداية التسجيل.' },
  { id: 'ops-breakdown', group: 'العمليات', title: 'العمليات حسب النوع', hint: 'توزيع عمليات الشهر الأخير على التصنيفات (يمكن إخفاء تصنيفات بعينها من الأسفل).' },
  { id: 'ops-govs', group: 'العمليات', title: 'العمليات حسب المحافظة', hint: 'المحافظات مرتبة حسب عدد عمليات الشهر الأخير.' },
  { id: 'ops-impact', group: 'العمليات', title: 'الأثر الإنساني', hint: 'المستفيدون والإصابات والوفيات في الشهر الأخير.' },
  { id: 'ops-trend', group: 'العمليات', title: 'تطور العمليات شهرياً', hint: 'عدد العمليات في آخر 12 شهراً.' },
  { id: 'rubble-progress', group: 'إدارة الأنقاض', title: 'إنجاز ترحيل الأنقاض', hint: 'الكمية المخطط لها والمنفّذة ونسبة الإنجاز، من التقرير المرحلي.' },
  { id: 'rubble-govs', group: 'إدارة الأنقاض', title: 'الترحيل حسب المحافظة', hint: 'المخطط له والمنفّذ في كل محافظة.' },
  { id: 'rubble-assessment', group: 'إدارة الأنقاض', title: 'كميات الأنقاض في سوريا', hint: 'عدد المواقع المقيّمة وإجمالي الكميات وأعلى المحافظات.' },
  { id: 'message', group: 'رسالة', title: 'رسالة أو إعلان', hint: 'نص حر تكتبه أنت: خبر، إنجاز، أو مناسبة.' },
];

/* تصنيفات العمليات: التسمية في البيانات ← الاسم المعروض (كما في src/data/categories.js) */
export const OPS = [
  { op: 'عملية أطفاء', name: 'الإطفاء' },
  { op: 'إسعاف', name: 'الإسعاف' },
  { op: 'أعمال خدمية', name: 'الأعمال الخدمية' },
  { op: 'حادث سير', name: 'حوادث السير' },
  { op: 'انقاذ بارد', name: 'الإنقاذ البارد' },
  { op: 'انقاذ حيوان', name: 'إنقاذ الحيوان' },
  { op: 'إنتشال غريق', name: 'انتشال الغرقى' },
  { op: 'وسم أماكن خطرة', name: 'وسم الأماكن الخطرة' },
  { op: 'هجمات', name: 'الهجمات' },
  { op: 'إخلاء مدنيين', name: 'إخلاء المدنيين' },
];

export const GOVS = ['دمشق', 'ريف دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس', 'إدلب', 'درعا', 'السويداء', 'القنيطرة', 'دير الزور', 'الرقة', 'الحسكة'];

export const SLIDE_IDS = SLIDES.map((s) => s.id);

export const DEFAULT_CONFIG = {
  /* مدة كل شريحة بالثواني */
  interval: 15,
  /* ترتيب الشرائح وحالتها */
  slides: SLIDES.map((s) => ({ id: s.id, on: s.id !== 'message' })),
  /* تصنيفات العمليات المخفية (بالتسمية كما في البيانات) */
  hiddenOps: ['هجمات'],
  /* المحافظات المخفية من شرائح المحافظات */
  hiddenGovs: [],
  message: { title: '', text: '' },
  /* إيقاف كل الشاشات مؤقتاً (تعرض الشعار فقط) */
  paused: false,
};

/* دمج إعدادات محفوظة مع الافتراضي: شرائح جديدة تُضاف، والمحذوفة من الكتالوج تُهمل */
export function normalizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const slides = [];
  for (const s of Array.isArray(c.slides) ? c.slides : []) {
    if (s && SLIDE_IDS.includes(s.id) && !seen.has(s.id)) { seen.add(s.id); slides.push({ id: s.id, on: !!s.on }); }
  }
  for (const d of DEFAULT_CONFIG.slides) if (!seen.has(d.id)) slides.push({ ...d });
  const n = Number(c.interval);
  const strs = (a, def) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : def);
  return {
    interval: Number.isFinite(n) ? Math.min(120, Math.max(5, Math.round(n))) : DEFAULT_CONFIG.interval,
    slides,
    hiddenOps: strs(c.hiddenOps, DEFAULT_CONFIG.hiddenOps),
    hiddenGovs: strs(c.hiddenGovs, DEFAULT_CONFIG.hiddenGovs),
    message: {
      title: String(c.message?.title ?? '').slice(0, 120),
      text: String(c.message?.text ?? '').slice(0, 600),
    },
    paused: !!c.paused,
  };
}
