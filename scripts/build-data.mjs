/*
  معالجة ملف التصدير الشهري.

  الاستخدام:
    1. ضع ملف التصدير في المجلد data/ (مثال: data/August_2026.xlsx)
    2. نفّذ: npm run data
    3. يُنتج الملفات في public/data/ ويتحدث التقرير تلقائياً

  الملف المرجعي data/syr_admin_boundaries.xlsx يربط ترميز المنطقة بالإحداثيات.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import zlib from 'node:zlib';

/*
  xlsx 0.20 (من مصدر SheetJS الرسمي) لا يحمّل نظام الملفات تلقائياً في
  وضع ESM، فنمرّره صراحةً. الترقية من 0.18.5 تُصلح ثغرتين معروفتين في
  قراءة ملفات Excel تحديداً (CVE-2023-30533، CVE-2024-22363).
*/
XLSX.set_fs(fs);

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, '..', 'data');
const outDir = path.join(root, '..', 'public', 'data');

const REF_FILE = 'syr_admin_boundaries.xlsx';

const num = (v) => {
  const n = Number(latinDigits(String(v ?? '').trim()));
  return Number.isFinite(n) ? n : 0;
};

/* الأرقام العربية-الهندية (٠-٩ و۰-۹) تُحوَّل إلى أرقام لاتينية في كل نص يُعرض */
const latinDigits = (s) => s
  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(/\u066A/g, '%');
const clean = (v) => latinDigits(String(v ?? '').trim());

/* ---------- الملف المرجعي: ترميز المنطقة ← إحداثيات ---------- */

function loadPlaces() {
  const wb = XLSX.readFile(path.join(dataDir, REF_FILE));
  const places = new Map();

  for (const row of XLSX.utils.sheet_to_json(wb.Sheets.syr_populatedplaces)) {
    const code = clean(row.pcode);
    if (!code) continue;
    places.set(code, {
      name: clean(row.featurename_ar) || clean(row.featurename_en),
      lat: Number(row.point_y),
      lon: Number(row.point_x),
      governorate: clean(row.adm1_ar),
      district: clean(row.adm2_ar),
      subdistrict: clean(row.adm3_ar),
    });
  }

  const governorates = XLSX.utils
    .sheet_to_json(wb.Sheets.syr_admin1)
    .map((row) => ({
      pcode: clean(row.adm1_pcode),
      name: clean(row.adm1_name1),
      lat: Number(row.center_lat),
      lon: Number(row.center_lon),
    }))
    .filter((g) => g.pcode);

  return { places, governorates };
}

/* ---------- ملف التصدير الشهري ---------- */

function findMonthlyFiles() {
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => (f.endsWith('.xlsx') || f.endsWith('.csv.gz')) && f !== REF_FILE && !f.startsWith('~$'))
    .sort();

  if (files.length === 0) {
    throw new Error(`لا يوجد ملف تصدير في ${dataDir}`);
  }
  return files;
}

const MONTHS = {
  january: 'كانون الثاني', february: 'شباط', march: 'آذار', april: 'نيسان',
  may: 'أيار', june: 'حزيران', july: 'تموز', august: 'آب',
  september: 'أيلول', october: 'تشرين الأول', november: 'تشرين الثاني',
  december: 'كانون الأول',
};

const MONTH_ORDER = Object.keys(MONTHS);

function describe(file) {
  const [rawMonth, rawYear] = file.replace(/\.xlsx$/i, '').split('_');
  const key = String(rawMonth).toLowerCase();
  return {
    label: `${MONTHS[key] ?? rawMonth} ${rawYear ?? ''}`.trim(),
    year: Number(rawYear) || 0,
    month: MONTH_ORDER.indexOf(key),
  };
}

const OPERATION_TYPES = [
  'عملية أطفاء',
  'إسعاف',
  'أعمال خدمية',
  'حادث سير',
  'انقاذ بارد',
  'انقاذ حيوان',
  'إنتشال غريق',
  'وسم أماكن خطرة',
  'هجمات',
  'إخلاء مدنيين',
];

function tally(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const key = clean(row[field]);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + num(row[field]), 0);
}

/* ---------- بناء التقارير ---------- */

/*
  باني تقارير عام: يُعطى اسم العملية، وقائمة الأبعاد (الحقول التي تُعدّ)،
  وقائمة المقاييس (الحقول التي تُجمع)، فيُخرج سجلات مضغوطة.

  تُرسل السجلات نفسها للمتصفح بدل المجاميع الجاهزة ليُعاد الحساب
  عند تغيير أي مرشّح. القيم النصية تُستبدل بفهارس لتصغير الحجم.

  ترتيب أعمدة السجل:
  [اليوم, المحافظة, المديرية, المركز, الموقع, ...الأبعاد, ...المقاييس]
*/

function indexer() {
  const list = [];
  const map = new Map();
  return {
    list,
    id(value) {
      const key = clean(value);
      if (!key) return -1;
      if (!map.has(key)) {
        map.set(key, list.length);
        list.push(key);
      }
      return map.get(key);
    },
  };
}

function buildReport(rows, places, { operation, dims, metrics }) {
  const subset = operation
    ? rows.filter((r) => clean(r['اسم العملية']) === operation)
    : rows;

  const govs = indexer();
  const directorates = indexer();
  const centers = indexer();
  const sites = indexer();
  const siteInfo = [];
  const dimIndex = dims.map(() => indexer());

  let unmatched = 0;
  const anomalies = metrics.map(() => 0);
  const records = [];

  for (const row of subset) {
    const raw = row['التاريخ'];
    const date = raw instanceof Date ? raw : new Date(raw);
    /* +12 ساعة: التاريخ يُقرأ كمنتصف ليل محلي، فتحويله إلى UTC كان يرجعه يوماً (31 أيار بدل 1 حزيران) */
    const day = Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + 12 * 3600e3).toISOString().slice(0, 10);

    const code = clean(row['ترميز المنطقة']);
    const place = places.get(code);
    let siteIdx = -1;

    if (place && Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
      siteIdx = sites.id(code);
      if (!siteInfo[siteIdx]) {
        siteInfo[siteIdx] = {
          code,
          name: place.name,
          governorate: place.governorate,
          district: place.district,
          subdistrict: place.subdistrict,
          lat: Number(place.lat.toFixed(4)),
          lon: Number(place.lon.toFixed(4)),
        };
      }
    } else {
      unmatched += 1;
    }

    const record = [
      day,
      govs.id(row['المحافظة']),
      directorates.id(row['المديرية']),
      centers.id(row['المركز']),
      siteIdx,
    ];

    dims.forEach((dim, i) => record.push(dimIndex[i].id(row[dim.column])));
    metrics.forEach((metric, i) => {
      /* مقياس بشرط: يُحتسب فقط للسجلات التي تحقق when */
      if (metric.when && !metric.when(row)) { record.push(0); return; }
      const value = metric.constant ?? metric.columns.reduce((sum, col) => sum + num(row[col]), 0);
      /*
        قيم مستحيلة تدخل أحياناً بالخطأ (مثل مئات الملايين من الكوادر).
        تُستبعد بدل أن تُجمع، ويُحصى عددها لإظهاره في التقرير.
      */
      if (metric.cap && value > metric.cap) {
        anomalies[i] += 1;
        record.push(0);
      } else {
        const k = 10 ** (metric.decimals || 0);
        record.push(Math.round(value * k) / k);
      }
    });

    records.push(record);
  }

  const days = records.map((r) => r[0]).filter(Boolean).sort();

  return {
    total: subset.length,
    unmatched,
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
    dims: dims.map((dim, i) => ({
      key: dim.key,
      title: dim.title,
      note: dim.note ?? null,
      exclude: dim.exclude ?? null,
      values: dimIndex[i].list,
    })),
    metrics: metrics.map((m, i) => ({ key: m.key, title: m.title, anomalies: anomalies[i] })),
    dict: {
      govs: govs.list,
      directorates: directorates.list,
      centers: centers.list,
      sites: siteInfo,
    },
    records,
  };
}

/* ---------- تعريف التقارير ---------- */

const FIRE = {
  operation: 'عملية أطفاء',
  dims: [
    { key: 'cause', title: 'أسباب الحرائق', column: 'نوع العملية', exclude: 'مجهول' },
    { key: 'placeType', title: 'نوع مكان الحريق', column: 'نوع مكان الحريق' },
    { key: 'inhabited', title: 'طبيعة الموقع', column: 'نوع المكان' },
    { key: 'target', title: 'المكان المستهدف', column: 'المكان المستهدف' },
  ],
  metrics: [
    { key: 'area', title: 'المساحة المحترقة', columns: ['المساحة المحترقة (دنم)'] },
    {
      key: 'civInjured',
      title: 'إصابات المدنيين',
      columns: ['عدد المصابين الأطفال', 'عدد المصابين الرجال', 'عدد المصابين النساء'],
    },
    {
      key: 'civDead',
      title: 'وفيات المدنيين',
      columns: ['عدد الشهداء الأطفال', 'عدد الشهداء الرجال', 'عدد الشهداء النساء'],
    },
    {
      key: 'staffInjured',
      title: 'إصابات كوادر الوزارة',
      columns: ['عدد المصابين من وزارة الطوارئ و إدارة الكوارث'],
    },
    {
      key: 'staffDead',
      title: 'وفيات كوادر الوزارة',
      columns: ['عدد شهداء وزارة الطوارئ و إدارة الكوارث'],
    },
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
  ],
};

const AMBULANCE = {
  operation: 'إسعاف',
  dims: [
    { key: 'reason', title: 'سبب طلب الإسعاف', column: 'نوع العملية' },
    { key: 'condition', title: 'حالة المصاب', column: 'حالة الاسعاف', note: 'مسجّلة في جزء من البلاغات' },
    { key: 'destination', title: 'جهة النقل', column: 'نوع مكان الاسعاف الى' },
    { key: 'referral', title: 'الإحالة', column: 'احالة' },
  ],
  metrics: [
    { key: 'benMen', title: 'مستفيدون رجال', columns: ['عدد المستفيدين الرجال'] },
    { key: 'benWomen', title: 'مستفيدات نساء', columns: ['عدد المستفيدين النساء'] },
    { key: 'benKids', title: 'مستفيدون أطفال', columns: ['عدد المستفيدين الأطفال الذكور', 'عدد المستفيدين الأطفال الاناث'] },
    { key: 'injMen', title: 'مصابون رجال', columns: ['عدد المصابين الرجال'] },
    { key: 'injWomen', title: 'مصابات نساء', columns: ['عدد المصابين النساء'] },
    { key: 'injKids', title: 'مصابون أطفال', columns: ['عدد المصابين الأطفال'] },
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
    { key: 'toHospital', title: 'زمن النقل للمشفى', columns: ['زمن الوصول للمشفى بالدقائق'], cap: 1440 },
    { key: 'crew', title: 'الكادر المشارك', columns: ['عدد الكادر المشارك'], cap: 500 },
  ],
};

/*
  الأنقاض المرحّلة بالأعمال الاعتيادية (خارج مشاريع الترحيل):
  عمليات «ازالة أنقاض» و«إعادة تدوير الأنقاض» — والكمية بالمتر المكعب فقط.
  بعض عمليات التدوير مسجّلة بالمتر المربع أو الطولي؛ جمعها مع المكعب
  يعطي رقماً بلا معنى، فتُستبعد وتُحصى لتُذكر تحت الرقم.
*/
const normAr = (v) => clean(v).replace(/[إأآ]/g, 'ا');
const RUBBLE_OPS = new Set(['ازالة انقاض', 'اعادة تدوير الانقاض']);
const isRubble = (row) => RUBBLE_OPS.has(normAr(row['نوع العملية']));
const isCubic = (row) => clean(row['الواحدة']) === 'متر مكعب';

const SERVICES = {
  operation: 'أعمال خدمية',
  dims: [
    { key: 'sector', title: 'قطاع الخدمة', column: 'اسم القطاع(خدمات)' },
    { key: 'kind', title: 'نوع العمل المنفَّذ', column: 'نوع العملية' },
    { key: 'target', title: 'المكان المستهدف', column: 'المكان المستهدف' },
    { key: 'status', title: 'حالة النشاط', column: 'حالة النشاط' },
    /* يُسجَّلان لعمليات إزالة الأنقاض — يُعرضان في مشروع الأنقاض */
    { key: 'ownership', title: 'ملكية الموقع', column: 'ملكية الموقع المستهدف بعملية ازالة الانقاض' },
    { key: 'consent', title: 'موافقة المالكين على الترحيل', column: 'هل توجد موافقة مالكي العقارات بازالة و ترحيل الانقاض؟' },
  ],
  metrics: [
    { key: 'rubble', title: 'الأنقاض المرحّلة', columns: ['الكمية'], when: (r) => isRubble(r) && isCubic(r), decimals: 1 },
    { key: 'rubbleOps', title: 'عمليات الأنقاض', constant: 1, when: (r) => isRubble(r) && isCubic(r) },
    { key: 'rubbleOther', title: 'أنقاض بوحدات أخرى', constant: 1, when: (r) => isRubble(r) && !isCubic(r) },
  ],
};

const TRAFFIC = {
  operation: 'حادث سير',
  dims: [
    { key: 'crashType', title: 'نوع حادث السير', column: 'نوع حادث السير' },
    { key: 'cause', title: 'سبب الحادث', column: 'سبب الحادث' },
    { key: 'vehicle', title: 'نوع المركبة', column: 'نوع السيارة' },
    { key: 'road', title: 'حالة الطريق وقت الحادث', column: 'حالة الطريق وقت الحادث' },
    { key: 'light', title: 'الإضاءة في موقع الحادث', column: 'الإضاءة في موقع الحادث' },
    { key: 'signs', title: 'وجود إشارات مرورية', column: 'هل توجد إشارات مرورية وتنظيم مروري بالموقع' },
    { key: 'destination', title: 'جهة نقل المصابين', column: 'نوع مكان الاسعاف الى', note: 'مسجّلة في جزء من الحوادث' },
  ],
  metrics: [
    { key: 'injMen', title: 'مصابون رجال', columns: ['عدد المصابين الرجال'] },
    { key: 'injWomen', title: 'مصابات نساء', columns: ['عدد المصابين النساء'] },
    { key: 'injKids', title: 'مصابون أطفال', columns: ['عدد المصابين الأطفال'] },
    { key: 'deadMen', title: 'وفيات رجال', columns: ['عدد الشهداء الرجال'] },
    { key: 'deadWomen', title: 'وفيات نساء', columns: ['عدد الشهداء النساء'] },
    { key: 'deadKids', title: 'وفيات أطفال', columns: ['عدد الشهداء الأطفال'] },
    {
      key: 'injured',
      title: 'المصابون',
      columns: ['عدد المصابين الأطفال', 'عدد المصابين الرجال', 'عدد المصابين النساء'],
    },
    {
      key: 'dead',
      title: 'الوفيات',
      columns: ['عدد الشهداء الأطفال', 'عدد الشهداء الرجال', 'عدد الشهداء النساء'],
    },
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
  ],
};

const DROWNING = {
  operation: 'إنتشال غريق',
  dims: [
    { key: 'cause', title: 'سبب الغرق', column: 'سبب الغرق' },
    { key: 'state', title: 'حالة الغريق', column: 'حالة الغريق' },
    { key: 'mission', title: 'بحث أم انتشال', column: 'بحث/انتشال' },
    { key: 'warnings', title: 'وجود لوحات تحذيرية', column: 'هل يوجود تحذيرات أو لوحات إرشادية في مكان الحادث' },
    { key: 'firstAid', title: 'الإسعافات الأولية المقدمة', column: 'الإسعافات الأولية المقدمة' },
    { key: 'place', title: 'مكان الغرق', column: 'نوع العملية' },
  ],
  metrics: [
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
    { key: 'crew', title: 'الكادر المشارك', columns: ['عدد الكادر المشارك'], cap: 500 },
  ],
};

const COLD_RESCUE = {
  operation: 'انقاذ بارد',
  dims: [
    { key: 'kind', title: 'نوع عملية الإنقاذ', column: 'نوع العملية' },
    { key: 'inhabited', title: 'طبيعة الموقع', column: 'نوع المكان' },
  ],
  metrics: [
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
    { key: 'duration', title: 'الوقت المستغرق', columns: ['الوقت المستغرق'], cap: 10080 },
    { key: 'crew', title: 'الكادر المشارك', columns: ['عدد الكادر المشارك'], cap: 500 },
  ],
};

const ANIMAL_RESCUE = {
  operation: 'انقاذ حيوان',
  dims: [{ key: 'inhabited', title: 'طبيعة الموقع', column: 'نوع المكان' }],
  metrics: [
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
    { key: 'duration', title: 'الوقت المستغرق', columns: ['الوقت المستغرق'], cap: 10080 },
    { key: 'crew', title: 'الكادر المشارك', columns: ['عدد الكادر المشارك'], cap: 500 },
  ],
};

const HAZARD = {
  operation: 'وسم أماكن خطرة',
  dims: [{ key: 'inhabited', title: 'طبيعة الموقع', column: 'نوع المكان' }],
  metrics: [
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
    { key: 'duration', title: 'الوقت المستغرق', columns: ['الوقت المستغرق'], cap: 10080 },
    { key: 'crew', title: 'الكادر المشارك', columns: ['عدد الكادر المشارك'], cap: 500 },
  ],
};

const ATTACKS = {
  operation: 'هجمات',
  dims: [
    { key: 'kind', title: 'نوع الهجوم', column: 'نوع العملية' },
    { key: 'actor', title: 'الجهة التي يُعتقد أنها نفّذت الهجوم', column: 'الجهه التي يعتقد أنها قامت بتنفيذ الهجوم' },
    { key: 'inhabited', title: 'طبيعة الموقع', column: 'نوع المكان' },
  ],
  metrics: [
    {
      key: 'injured',
      title: 'المصابون',
      columns: ['عدد المصابين الأطفال', 'عدد المصابين الرجال', 'عدد المصابين النساء'],
    },
    {
      key: 'dead',
      title: 'الشهداء',
      columns: ['عدد الشهداء الأطفال', 'عدد الشهداء الرجال', 'عدد الشهداء النساء'],
    },
    { key: 'affected', title: 'المتضررون', columns: ['عدد المتضررين'] },
    { key: 'raids', title: 'عدد الغارات', columns: ['عدد الغارات'] },
    { key: 'munitions', title: 'الذخائر المستخدمة', columns: ['عدد الذخائر المستخدمة أثناء الهجوم'] },
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
  ],
};

const EVACUATION = {
  operation: 'إخلاء مدنيين',
  dims: [
    { key: 'kind', title: 'نوع العملية', column: 'نوع العملية' },
    { key: 'inhabited', title: 'طبيعة الموقع', column: 'نوع المكان' },
  ],
  metrics: [
    { key: 'evacuated', title: 'الذين تم إخلاؤهم', columns: ['عدد الذين تم اخلائهم'] },
    { key: 'eta', title: 'زمن الوصول للموقع', columns: ['زمن الوصول للموقع بالدقائق'], cap: 1440 },
    { key: 'crew', title: 'الكادر المشارك', columns: ['عدد الكادر المشارك'], cap: 500 },
  ],
};

/* نظرة عامة: كل العمليات في مجموعة واحدة لتغذية الصفحة الرئيسية */
const OVERVIEW = {
  operation: null,
  dims: [
    { key: 'operation', title: 'عدد العمليات حسب النوع', column: 'اسم العملية' },
  ],
  metrics: [
    {
      key: 'injured',
      title: 'الإصابات',
      columns: [
        'عدد المصابين الأطفال', 'عدد المصابين الرجال', 'عدد المصابين النساء',
        'عدد المصابين من وزارة الطوارئ و إدارة الكوارث',
      ],
    },
    {
      key: 'dead',
      title: 'الوفيات',
      columns: [
        'عدد الشهداء الأطفال', 'عدد الشهداء الرجال', 'عدد الشهداء النساء',
        'عدد شهداء وزارة الطوارئ و إدارة الكوارث',
      ],
    },
    {
      key: 'beneficiaries',
      title: 'المستفيدون',
      columns: [
        'عدد المستفيدين المباشر', 'عدد المستفيدين غير المباشر',
        'عدد المستفيدين الرجال', 'عدد المستفيدين النساء',
        'عدد المستفيدين الأطفال الذكور', 'عدد المستفيدين الأطفال الاناث',
      ],
    },
    { key: 'crew', title: 'الكادر المشارك', columns: ['عدد الكادر المشارك'], cap: 500 },
  ],
};

const REPORTS = {
  overview: OVERVIEW,
  fire: FIRE,
  ambulance: AMBULANCE,
  services: SERVICES,
  traffic: TRAFFIC,
  drowning: DROWNING,
  'cold-rescue': COLD_RESCUE,
  'animal-rescue': ANIMAL_RESCUE,
  'hazard-marking': HAZARD,
  attacks: ATTACKS,
  evacuation: EVACUATION,
};

/* ---------- التنفيذ ---------- */

/* قارئ CSV (يدعم الحقول المقتبسة والأسطر داخلها) ← مصفوفة كائنات بأسماء الأعمدة */
function readCsvGz(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ''])));
}

function run() {
  fs.mkdirSync(outDir, { recursive: true });

  const { places, governorates } = loadPlaces();
  const files = findMonthlyFiles();

  /*
    تراكمي: تُقرأ كل الملفات الشهرية الموجودة وتُدمج.
    رقم التقرير فريد، فإعادة رفع ملف سبق تحميله لا تُضاعف أي رقم.
  */
  const seen = new Map();
  const periods = [];

  for (const file of files) {
    let batch;
    if (file.endsWith('.csv.gz')) {
      /* التصدير الكبير يُحفظ CSV مضغوطاً (ورقة «التقارير» فقط): أسرع بكثير وأصغر حجماً من xlsx */
      batch = readCsvGz(path.join(dataDir, file));
    } else {
      const wb = XLSX.readFile(path.join(dataDir, file), { cellDates: true });
      const sheet = wb.Sheets['التقارير'];
      if (!sheet) {
        console.warn(`  تخطّي ${file} — لا تحتوي على ورقة "التقارير"`);
        continue;
      }
      batch = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    }
    /* التصدير الشامل (2025–2026) يستخدم تسميات أقدم لبعض الأعمدة: توحَّد مع الحالية */
    const ALIAS = {
      'عدد شهداء الدفاع المدني السوري': 'عدد شهداء وزارة الطوارئ و إدارة الكوارث',
      'عدد المصابين من الدفاع المدني السوري': 'عدد المصابين من وزارة الطوارئ و إدارة الكوارث',
      'المساحة المحترقة': 'المساحة المحترقة (دنم)',
    };
    for (const row of batch) for (const [from, to] of Object.entries(ALIAS)) if (from in row && !(to in row)) row[to] = row[from];
    let added = 0;
    for (const row of batch) {
      const key = clean(row['رقم التقرير']);
      if (!key || seen.has(key)) continue;
      seen.set(key, row);
      added += 1;
    }
    console.log(`  ${file}: ${batch.length} سجلاً، جديد منها ${added}`);
  }

  const rows = [...seen.values()];
  /* الفترة من تواريخ السجلات نفسها (لا من أسماء الملفات): يصلح لملف شهري أو ملف شامل لعدة سنوات */
  const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  let minD = null; let maxD = null;
  for (const r of rows) {
    const d = r['التاريخ'] instanceof Date ? r['التاريخ'] : new Date(r['التاريخ']);
    if (Number.isNaN(d.getTime())) continue;
    const t = new Date(d.getTime() + 12 * 3600e3);
    if (!minD || t < minD) minD = t;
    if (!maxD || t > maxD) maxD = t;
  }
  const lbl = (d) => `${AR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const period = !minD ? '' : lbl(minD) === lbl(maxD) ? lbl(minD) : `${lbl(minD)} — ${lbl(maxD)}`;

  const overview = {
    period,
    generatedAt: new Date().toISOString().slice(0, 10),
    totalRecords: rows.length,
    byOperation: OPERATION_TYPES.map((name) => ({
      label: name,
      value: rows.filter((r) => clean(r['اسم العملية']) === name).length,
    })).filter((o) => o.value > 0),
  };

  write('summary.json', overview);
  for (const [id, config] of Object.entries(REPORTS)) {
    write(`${id}.json`, buildReport(rows, places, config));
  }

  console.log(`\nالفترة: ${period} — ${rows.length} سجلاً بعد إزالة التكرار`);
}

function write(name, payload) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, JSON.stringify(payload));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ✓ ${name} (${kb} كيلوبايت)`);
}

/*
  مشروع ترحيل الأنقاض: تصديرات KoBo الخام في data/rubble-transfer/
    p1-*.xlsx  المشروع الأول (المنشآت)
    p2-*.xlsx  المشروع الثاني (الطرق)
    p3-*.xlsx  المشروع الثالث
  رقم المشروع من بداية اسم الملف. والخطة (المخطط لكل منطقة) اختيارية في plan.json.
  للتحديث: استبدل الملف بتصدير جديد من KoBo بنفس الاسم وأعد البناء.
*/
function buildRubble() {
  const dir = path.join(root, '..', 'data', 'rubble-transfer');
  if (!fs.existsSync(dir)) return;
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; };
  const str = (v) => latinDigits(String(v ?? '').trim()).replace(/\s+/g, ' ');
  const day = (v) => {
    if (v instanceof Date) return new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
    if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
    return str(v).slice(0, 10);
  };
  const HOURS = ['ما هو عدد ساعات العمل (1)', 'ما هو عدد ساعات العمل (2)', 'كم عدد ساعات عمل الآليات الهندسية للمقاول في تهذيب المكب؟', 'عدد ساعات العمل الفعلية'];
  const surveys = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^p\d.*\.xlsx$/i.test(f)).sort()) {
    const p = Number(file[1]);
    const wb = XLSX.readFile(path.join(dir, file), { cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    for (const r of rows) {
      if (!r['المحافظة'] && !r['كمية الأنقاض التي تم ترحيلها من موقع العمل بالمتر المكعب (M3)']) continue;
      const hours = HOURS.reduce((a, k) => a + num(r[k]), 0);
      const fam = num(r.num_families || r['كم عدد العائلات المستفيدة؟']);
      surveys.push({
        id: r._id || r._index, p,
        date: day(r['تاريخ تنفيذ عملية رفع البيانات'] || r._submission_time),
        by: str(r['اسم مدلي البيانات']).replace(/^م\.? /, ''),
        co: str(r['اسم الجهة المتعاقد معها لتنفيذ أعمال الترحيل']) || 'غير محدد',
        nature: str(r['طبيعة الموقع']), addr: str(r['عنوان وتوصيف الموقع']),
        gov: str(r['المحافظة']), area: str(r['المنطقة']), town: str(r['البلدة']), village: str(r['القرية']),
        lat: Math.round(num(r['_تحديد موقع تنفيذ الأعمال_latitude']) * 1e5) / 1e5,
        lon: Math.round(num(r['_تحديد موقع تنفيذ الأعمال_longitude']) * 1e5) / 1e5,
        vol: Math.round(num(r['كمية الأنقاض التي تم ترحيلها من موقع العمل بالمتر المكعب (M3)']) * 10) / 10,
        dump: str(r['الجهة التي تم ترحيل الأنقاض اليها']),
        dumpName: str(r['اسم المكب'] || r['اسم  الموقع']),
        /* إحداثيات المكب: المعتمد في حقل، والمقترح من الجهة المحلية في حقل آخر */
        dumpLat: Math.round(num(r['_موقع المكب على الخريطة_latitude'] || r['_تحديد الموقع على الخريطة (للموقع المقترح من قبل الجهة المحلية)_latitude']) * 1e5) / 1e5 || null,
        dumpLon: Math.round(num(r['_موقع المكب على الخريطة_longitude'] || r['_تحديد الموقع على الخريطة (للموقع المقترح من قبل الجهة المحلية)_longitude']) * 1e5) / 1e5 || null,
        dist: str(r['ما هي المسافة المقطوعة إلى مكب الأنقاض؟']).replace(/\s+/g, ''),
        hours: hours || null, fam: fam || null,
        receipts: num(r['عدد الايصالات']) || null,
        machines: num(r['عدد الآليات المستخدمة في موقع العمل']) || null,
        capacity: num(r['أكبر سعة للآليات المستخدمة في موقع العمل']) || null,
        /* في تصدير KoBo هذا الحقل ساعات يومية (لا إجمالي)، فلا يُضرب بأيام غير مسجلة */
        dailyHours: num(r['عدد ساعات العمل الفعلية']) || null,
        photos: ['صور لموقع العمل قبل البدء_URL', 'صور لموقع العمل أثناء التنفيذ_URL', 'صور لموقع العمل بعد الانتهاء من التنفيذ_URL'].map((k) => r[k] || ''),
      });
    }
  }
  /* الخطة: plan.xlsx (تقرير مرحلي: المرحلة | المحافظة | المخطط | المنفذ | النسبة | ملاحظات) أو plan.json */
  let phases = [];
  const planX = path.join(dir, 'plan.xlsx');
  const planFile = path.join(dir, 'plan.json');
  if (fs.existsSync(planX)) {
    const wb = XLSX.readFile(planX, { cellDates: true });
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const h = grid.findIndex((r) => r.some((c) => str(c).startsWith('المحافظة')));
    let phase = '';
    for (const r of grid.slice(h + 1)) {
      const c0 = str(r[0]);
      if (c0.startsWith('اجمالي') || c0.startsWith('إجمالي')) continue;
      if (c0) phase = /الأولى|الاولى/.test(c0) ? 'المرحلة الأولى' : /الثانية/.test(c0) ? 'المرحلة الثانية' : /الثالثة/.test(c0) ? 'المرحلة الثالثة' : c0;
      const gov = str(r[1]);
      if (!gov || !phase) continue;
      phases.push({ phase, gov, region: '—', planned: num(r[2]), executed: num(r[3]), notes: str(r[5]), sites: 0 });
    }
    const asOf = grid.find((r) => str(r[0]).startsWith('تاريخ التقرير'));
    if (asOf) phases.asOf = day(asOf[1]);
    const norm = (g) => str(g).replace(/[إأآ]/g, 'ا').replace(/ة$/, 'ه');
    const PN = ['', 'المرحلة الأولى', 'المرحلة الثانية', 'المرحلة الثالثة'];
    for (const r of phases) r.sites = surveys.filter((x) => PN[x.p] === r.phase && norm(x.gov) === norm(r.gov)).length;
  } else if (fs.existsSync(planFile)) phases = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  fs.writeFileSync(path.join(outDir, 'rubble-transfer.json'), JSON.stringify({ title: 'مشروع ترحيل الأنقاض', phases, planAsOf: phases.asOf || null, surveys }));
  console.log(`  ✓ rubble-transfer.json (${surveys.length} استمارة، ${phases.length} صف خطة)`);
}

/*
  دورة إدارة الأنقاض: data/rubble-pipeline/pipeline.xlsx (قالب بعمود «المرحلة»:
  تقدير / مخطط / قيد الدراسة / تدوير / استثمار) ← public/data/rubble-pipeline.json
*/
function buildPipeline() {
  const file = path.join(root, '..', 'data', 'rubble-pipeline', 'pipeline.xlsx');
  const STAGE = { 'تقدير': 'assessment', 'مخطط': 'planned', 'قيد الدراسة': 'study', 'تدوير': 'recycling', 'استثمار': 'investment' };
  let rows = [];
  if (fs.existsSync(file)) {
    const wb = XLSX.readFile(file, { cellDates: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  }
  const n = (v) => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && String(v).trim() !== '' ? x : null; };
  const d = (v) => (v instanceof Date ? new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10) : clean(v).slice(0, 10));
  const items = rows.map((r, i) => ({
    id: i + 1,
    stage: STAGE[clean(r['المرحلة'])] || null,
    name: clean(r['اسم المشروع']),
    gov: clean(r['المحافظة']), area: clean(r['المنطقة']), town: clean(r['الناحية']),
    volume: n(r['الكمية (م³)']), output: n(r['الناتج']), budget: n(r['الكلفة التقديرية ($)']),
    progress: n(r['نسبة الإنجاز (%)']),
    status: clean(r['الحالة']), partner: clean(r['الجهة المنفذة / الشريك']),
    start: d(r['تاريخ البدء']), end: d(r['تاريخ الانتهاء']), notes: clean(r['ملاحظات']),
    photos: ['صور قبل التنفيذ (روابط)', 'صور أثناء التنفيذ (روابط)', 'صور بعد الإنجاز (روابط)']
      .map((k) => String(r[k] ?? '').split(/[\s,،]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u))),
    folder: /^https?:\/\//.test(String(r['رابط مجلد الصور والوثائق'] ?? '').trim()) ? String(r['رابط مجلد الصور والوثائق']).trim() : '',
  })).filter((x) => x.stage && x.name);
  fs.writeFileSync(path.join(outDir, 'rubble-pipeline.json'), JSON.stringify({ items }));
  console.log(`  ✓ rubble-pipeline.json (${items.length} مشروعاً)`);
}

/*
  المكبات والجهات العاملة:
  - المكبات تُستخرج تلقائياً من الاستمارات (تجميع بالإحداثيات ~1 كم) مع الكمية المستقبلة،
    وتُكمَّل من data/rubble-registry/dumps.xlsx (المساحة، السعة، المشغّل، الحالة الرسمية).
  - الجهات من data/rubble-registry/entities.xlsx (الأدوار المتعددة)، وتُضاف إليها
    تلقائياً كل جهة منفذة وردت في الاستمارات.
*/
function readSheet(file) {
  if (!fs.existsSync(file)) return [];
  const wb = XLSX.readFile(file, { cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}
function buildRegistry() {
  const dir = path.join(root, '..', 'data', 'rubble-registry');
  const n = (v) => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && String(v).trim() !== '' ? x : null; };
  const list = (v) => clean(v).split(/[،,;]/).map((x) => x.trim()).filter(Boolean);
  const dumps = readSheet(path.join(dir, 'dumps.xlsx')).map((r) => ({
    name: clean(r['اسم المكب']), gov: clean(r['المحافظة']),
    lat: n(r['خط العرض']), lon: n(r['خط الطول']),
    status: clean(r['الحالة']), area: n(r['المساحة (م²)']), capacity: n(r['السعة التصميمية (م³)']), height: n(r['متوسط ارتفاع الأنقاض (م)']),
    operator: clean(r['الجهة المشغّلة']), notes: clean(r['ملاحظات']),
  })).filter((d) => d.name);
  const entities = readSheet(path.join(dir, 'entities.xlsx')).map((r) => ({
    name: clean(r['اسم الجهة']), aliases: list(r['تسميات بديلة']), type: clean(r['نوع الجهة']),
    roles: list(r['الأدوار']), govs: list(r['المحافظات']), contact: clean(r['التواصل']), notes: clean(r['ملاحظات']),
  })).filter((e) => e.name);
  fs.writeFileSync(path.join(outDir, 'rubble-registry.json'), JSON.stringify({ dumps, entities }));
  console.log(`  ✓ rubble-registry.json (${dumps.length} مكباً، ${entities.length} جهة في السجل)`);
}

/* بيانات الأضرار (وزارة الإدارة المحلية / المسوح): data/rubble-damage/damage.xlsx */
function buildDamage() {
  const n = (v) => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && String(v).trim() !== '' ? x : 0; };
  const rows = readSheet(path.join(root, '..', 'data', 'rubble-damage', 'damage.xlsx')).map((r) => ({
    gov: clean(r['المحافظة']), area: clean(r['المنطقة']), town: clean(r['الناحية']), kind: clean(r['نوع المبنى / المنشأة']) || 'غير محدد',
    destroyed: n(r['مدمر كلياً']), severe: n(r['ضرر شديد'] ?? r['أضرار جسيمة']), moderate: n(r['ضرر متوسط'] ?? r['أضرار متوسطة']), light: n(r['ضرر خفيف'] ?? r['أضرار طفيفة']),
    avgArea: n(r['متوسط مساحة المبنى (م²)']) || null, avgFloors: n(r['متوسط عدد الطوابق']) || null,
    source: clean(r['المصدر']), date: clean(r['تاريخ التقييم']).slice(0, 10), notes: clean(r['ملاحظات']),
  })).filter((r) => r.gov && (r.destroyed || r.severe || r.moderate || r.light));
  fs.writeFileSync(path.join(outDir, 'rubble-damage.json'), JSON.stringify({ rows }));
  console.log(`  ✓ rubble-damage.json (${rows.length} سطر أضرار)`);
}

/* شجرة المناطق الإدارية للاستبيانات: محافظة ← منطقة ← ناحية ← قرية/بلدة (قوائم منسدلة، بلا إدخال يدوي) */
function buildAdminAreas() {
  const wb = XLSX.readFile(path.join(dataDir, REF_FILE));
  const rows = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n]);
  const districts = rows('syr_admin2').map((r) => [clean(r.adm2_pcode), clean(r.adm2_name1) || clean(r.adm2_name), clean(r.adm1_pcode)]).filter((x) => x[0]);
  const subs = rows('syr_admin3').map((r) => [clean(r.adm3_pcode), clean(r.adm3_name1) || clean(r.adm3_name), clean(r.adm2_pcode)]).filter((x) => x[0]);
  const seen = new Set();
  const communities = rows('syr_populatedplaces').map((r) => [clean(r.pcode), clean(r.featurename_ar) || clean(r.featurename_en), clean(r.adm3_pcode)])
    .filter((x) => x[0] && x[2] && !seen.has(x[0]) && seen.add(x[0]));
  fs.writeFileSync(path.join(outDir, 'admin-areas.json'), JSON.stringify({ districts, subdistricts: subs, communities }));
  console.log(`  ✓ admin-areas.json (${districts.length} منطقة، ${subs.length} ناحية، ${communities.length} قرية/بلدة)`);
}

/*
  قسم مستقل: التقييم الميداني لكميات الأنقاض في عموم سوريا (للجهات الراغبة بالمشاركة).
  data/rubble-assessment/*.xlsx (تصدير KoBo) ← public/data/rubble-assessment.json
  لا يُربط بأي بيانات أخرى في المنصة، ولا تُنشر بيانات جامعي البيانات الشخصية.
*/
function buildAssessment() {
  const dir = path.join(root, '..', 'data', 'rubble-assessment');
  if (!fs.existsSync(dir)) return;
  const num = (v) => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) ? x : 0; };
  const day = (v) => (v instanceof Date ? new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10) : clean(v).slice(0, 10));
  const GOV = { 'ادلب': 'إدلب', 'حماه': 'حماة', 'درعا ': 'درعا' };
  const OWN = ['منشآت حكومية', 'منشآت تعليمية', 'نقاط طبية', 'مساجد/دور عبادة', 'منشآت خدمية/بنى تحتية', 'منشآت سكنية', 'مختلطة من كل ما تم ذكره', 'أخرى'];
  const sites = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xlsx'))) {
    for (const r of readSheet(path.join(dir, f))) {
      const vol = num(r['ما هي كمية الانقاض مقدرة بالمتر المكعب ؟']);
      const gov = clean(r['المحافظة']); if (!gov || !vol) continue;
      sites.push({
        id: clean(r._id), date: day(r['تاريخ جمع البيانات']),
        gov: GOV[gov] || gov, area: clean(r['المنطقة']), town: clean(r['البلدة']), village: clean(r['القرية']),
        hood: clean(r['الحي']), street: clean(r['الشارع']),
        lat: num(r['_يرجى تحديد موقع الانقاض_latitude']) || null, lon: num(r['_يرجى تحديد موقع الانقاض_longitude']) || null,
        vol, setting: clean(r['أين يقع تجمع الأنقاض بالنسبة لموقع المدينة؟']), inhabited: clean(r['هل الموقع مأهولاً بالسكان؟']),
        access: clean(r['هل الوصول الى الموقع سهل؟']), roads: clean(r['حالة الطرق المؤدية الى الموقع']),
        shelled: clean(r['هل تعرض الموقع للقصف؟']), uxo: clean(r['هل تم إجراء مسح للموقع للتأكد من خلوه من الذخائر غير المنفجرة؟']) || 'غير محدد',
        owner: clean(r['حدد الجهة المالكة']), approval: clean(r['هل توجد موافقة على ترحيل الأنقاض؟']),
        noApproval: clean(r['ما هو سبب عدم الموافقة ؟']),
        use: OWN.filter((k) => num(r[`عائدية الأنقاض ؟/${k}`]) === 1),
        spread: clean(r['كيفية وجود الأنقاض']), mix: clean(r['ما هي تركيبة الأنقاض ؟']),
        dump: clean(r['ما هو اسم/موقع أقرب مكب؟']), dumpKm: num(r['كم يبعد المكب (كم)']) || null,
        dumpOk: clean(r['هل المكب قادر على الاستيعاب؟']), partners: clean(r['هل توجد جهات محلية للتعاون او منظمات او جهات خاصة عاملة في الموقع لإزالة الأنقاض؟']),
        partner: clean(r['ما اسم تلك الجهة؟']), photo: clean(r['يرجى ارفاق صور للموقع_URL']),
      });
    }
  }
  fs.writeFileSync(path.join(outDir, 'rubble-assessment.json'), JSON.stringify({ sites }));
  console.log(`  ✓ rubble-assessment.json (${sites.length} موقع، ${Math.round(sites.reduce((a, s) => a + s.vol, 0)).toLocaleString('en-US')} م³)`);
}

run();
buildAssessment();
buildAdminAreas();
buildRubble();
buildPipeline();
buildRegistry();
buildDamage();
