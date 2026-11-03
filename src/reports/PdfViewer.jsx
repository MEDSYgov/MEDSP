import { useCallback, useEffect, useRef, useState } from 'react';
import Glyph from './Glyph';
import { openPdf } from './pdf';
import { fileUrl } from './store';
import { CAT, periodLabel } from './catalog';

/*
  مستعرض PDF داخل المنصة (pdf.js)، بملء النافذة.
  - الصفحات تُرسم عند ظهورها فقط، فالتقرير الطويل يفتح فوراً.
  - تكبير وتصغير وملاءمة العرض، والانتقال لصفحة، وتحميل، وملء الشاشة، ونسخ الرابط.
  - يعمل على الهاتف كما على الحاسوب، بخلاف مستعرض المتصفح المدمج.
*/

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const GAP = 16;

function Page({ doc, n, width, onVisible, register }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const [ratio, setRatio] = useState(1.414);
  const [drawn, setDrawn] = useState(0);
  const [near, setNear] = useState(n <= 2);

  useEffect(() => register(n, box.current), [n, register]);

  useEffect(() => {
    const el = box.current;
    const io = new IntersectionObserver(([e]) => {
      setNear(e.isIntersecting);
      if (e.intersectionRatio > 0.35) onVisible(n);
    }, { rootMargin: '120% 0px', threshold: [0, 0.35, 0.7] });
    io.observe(el);
    return () => io.disconnect();
  }, [n, onVisible]);

  useEffect(() => {
    if (!near || !width || drawn === width) return undefined;
    let task; let dead = false;
    doc.getPage(n).then((page) => {
      if (dead) return;
      const v1 = page.getViewport({ scale: 1 });
      setRatio(v1.height / v1.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (width / v1.width) * dpr });
      const c = canvas.current;
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      task = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
      task.promise.then(() => { if (!dead) setDrawn(width); }).catch(() => {});
    });
    return () => { dead = true; task?.cancel(); };
  }, [doc, n, width, near, drawn]);

  return (
    <div ref={box} className="pv-page" data-page={n} style={{ width, height: width * ratio }}>
      <canvas ref={canvas} className={drawn ? 'is-on' : ''} />
      {!drawn && <span className="pv-page__wait"><bdi dir="ltr">{n}</bdi></span>}
    </div>
  );
}

export default function PdfViewer({ report, onClose }) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState('fit');
  const [baseW, setBaseW] = useState(0);
  const [stageW, setStageW] = useState(0);
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState('');
  const [copied, setCopied] = useState(false);
  const stage = useRef(null);
  const root = useRef(null);
  const pages = useRef(new Map());

  /* فتح الملف */
  useEffect(() => {
    let alive = true; let d;
    fileUrl(report.file_path)
      .then(openPdf)
      .then(async (x) => {
        d = x;
        const p1 = await x.getPage(1);
        if (alive) { setBaseW(p1.getViewport({ scale: 1 }).width); setDoc(x); } else x.destroy();
      })
      .catch((e) => { console.error('[reports] open', e); if (alive) setErr(e?.message || String(e)); });
    return () => { alive = false; d?.destroy(); };
  }, [report.file_path]);

  /* عرض المسرح (لملاءمة العرض) */
  useEffect(() => {
    const el = stage.current;
    const ro = new ResizeObserver(([e]) => setStageW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* منع تمرير الصفحة خلف المستعرض */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const fitW = Math.max(240, Math.min(stageW - GAP * 2, 1100));
  const width = zoom === 'fit' ? fitW : Math.round((baseW || 600) * zoom * 1.333);
  const pct = Math.round((width / ((baseW || 600) * 1.333)) * 100);

  const zoomBy = useCallback((dir) => {
    const cur = width / ((baseW || 600) * 1.333);
    const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.01) : [...ZOOMS].reverse().find((z) => z < cur - 0.01);
    if (next) setZoom(next);
  }, [width, baseW]);

  const register = useCallback((n, el) => { pages.current.set(n, el); return () => pages.current.delete(n); }, []);
  const onVisible = useCallback((n) => setPage(n), []);
  const goTo = (n) => {
    const t = Math.min(Math.max(1, n), doc?.numPages || 1);
    pages.current.get(t)?.scrollIntoView({ block: 'start' });
    setPage(t);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      else if (e.key === '+' || e.key === '=') zoomBy(1);
      else if (e.key === '-') zoomBy(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoomBy]);

  const download = async () => {
    const name = `${report.title}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
    window.location.href = await fileUrl(report.file_path, { download: name });
  };
  const full = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.current?.requestFullscreen?.().catch(() => {});
  };
  const share = () => {
    navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}#/reports/${report.id}`);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const cat = CAT[report.category];
  const period = periodLabel(report);

  return (
    <div className="pv" ref={root} role="dialog" aria-modal="true" aria-label={report.title}>
      <header className="pv-bar">
        <button type="button" className="pv-btn pv-btn--close" onClick={onClose} aria-label="إغلاق"><Glyph name="close" /></button>
        <div className="pv-title">
          <strong>{report.title}</strong>
          <span>{cat?.short}{period && ` · ${period}`}</span>
        </div>
        <div className="pv-tools">
          {doc && (
            <form className="pv-pager" onSubmit={(e) => { e.preventDefault(); if (jump) goTo(Number(jump)); setJump(''); }}>
              <input dir="ltr" inputMode="numeric" aria-label="رقم الصفحة"
                value={jump || page} onFocus={(e) => { setJump(String(page)); e.target.select(); }}
                onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))} onBlur={() => setJump('')} />
              <span>من <bdi dir="ltr">{doc.numPages}</bdi></span>
            </form>
          )}
          <div className="pv-zoom">
            <button type="button" className="pv-btn" onClick={() => zoomBy(-1)} aria-label="تصغير"><Glyph name="minus" /></button>
            <button type="button" className={`pv-pct${zoom === 'fit' ? ' is-on' : ''}`} onClick={() => setZoom('fit')} title="ملاءمة العرض">
              <bdi dir="ltr">{pct}%</bdi>
            </button>
            <button type="button" className="pv-btn" onClick={() => zoomBy(1)} aria-label="تكبير"><Glyph name="plus" /></button>
          </div>
          <button type="button" className="pv-btn pv-hide-sm" onClick={share} title="نسخ رابط التقرير"><Glyph name="link" /></button>
          <button type="button" className="pv-btn pv-hide-sm" onClick={full} title="ملء الشاشة"><Glyph name="expand" /></button>
          <button type="button" className="pv-btn pv-btn--primary" onClick={download} title="تحميل"><Glyph name="download" /><span className="pv-hide-sm">تحميل</span></button>
        </div>
        {copied && <span className="pv-toast">نُسخ الرابط</span>}
      </header>

      <div className="pv-stage" ref={stage}>
        {err && <div className="pv-msg"><strong>تعذّر فتح التقرير</strong><span>{err}</span></div>}
        {!err && !doc && <div className="pv-msg"><span className="pv-spin" />جارٍ فتح التقرير…</div>}
        {doc && (
          <div className="pv-pages" style={{ gap: GAP, padding: GAP }}>
            {Array.from({ length: doc.numPages }, (_, i) => (
              <Page key={i + 1} doc={doc} n={i + 1} width={width} onVisible={onVisible} register={register} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
