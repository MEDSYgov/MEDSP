/*
  تحميل pdf.js عند الحاجة فقط (لا يثقل باقي المنصة).
  الخطوط القياسية وخرائط المحارف تُنسخ إلى dist/pdfjs عند البناء (vite.config.js)،
  فيعمل المستعرض على شبكة الوزارة دون أي اتصال خارجي.
*/
let lib;

export async function pdfjs() {
  if (!lib) {
    /* النسخة «legacy» تعمل على المتصفحات الأقدم أيضاً (أجهزة الوزارة لا تُحدَّث دائماً) */
    lib = import('pdfjs-dist/legacy/build/pdf.min.mjs').then((m) => {
      /* العامل يُبنى ملفاً بامتداد .js: بعض إعدادات Nginx ترسل ملفات .mjs بنوع خاطئ
         فيرفض المتصفح تشغيلها (السبب المرجّح لتعذّر القراءة على سيرفر التجربة، 2026-10-28) */
      m.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdf.worker.js', import.meta.url), { type: 'module' });
      return m;
    });
  }
  return lib;
}

const base = () => new URL('pdfjs/', window.location.href).href;

export async function openPdf(src) {
  const m = await pdfjs();
  return m.getDocument({
    ...(typeof src === 'string' ? { url: src } : { data: src }),
    cMapUrl: `${base()}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base()}standard_fonts/`,
    isEvalSupported: false,
    /* pdf.js يرسم الحروف بنفسه بدل تسليم الخطوط للمتصفح: بدونه تتقطّع الحروف العربية
       في كثير من ملفات Word وغيره (جُرّب على 2026-10-28) */
    disableFontFace: true,
  }).promise;
}

/* عند الرفع: عدد الصفحات + صورة غلاف (JPEG) من الصفحة الأولى */
export async function inspectPdf(file) {
  const doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const scale = 560 / v1.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const thumb = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
    return { pages: doc.numPages, thumb, preview: canvas.toDataURL('image/jpeg', 0.7) };
  } finally {
    doc.destroy();
  }
}
