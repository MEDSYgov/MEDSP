import { useEffect, useRef, useState } from 'react';
import Glyph from '../reports/Glyph';
import { CATEGORIES, CAT, MONTHS, GOVS, periodLabel, fmtDate, fmtSize, MAX_BYTES } from '../reports/catalog';
import { listReports, createReport, updateReport, deleteReport } from '../reports/store';
import { inspectPdf } from '../reports/pdf';
import '../styles/reports.css';

/*
  إدارة التقارير (للمدير العام ومدير المنصة): رفع PDF، وتصنيفه، ونشره.
  عند اختيار الملف يُقرأ في المتصفح لعدّ صفحاته وصنع صورة غلاف من صفحته الأولى.
  التقرير الجديد يُحفظ «مسودة» ما لم يُختر «منشور».
*/

const today = () => new Date().toISOString().slice(0, 10);
const now = new Date();
const BLANK = {
  title: '', category: 'monthly', period_year: now.getFullYear(), period_month: now.getMonth() || 12,
  issued_on: today(), summary: '', event: '', govs: [], visibility: 'internal', published: false, featured: false,
};
const YEARS = Array.from({ length: 8 }, (_, i) => now.getFullYear() + 1 - i);

function Editor({ initial, onDone, onCancel }) {
  const editing = !!initial?.id;
  const [m, setM] = useState(() => ({ ...BLANK, ...(initial || {}) }));
  const [file, setFile] = useState(null);
  const [info, setInfo] = useState(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef(null);
  const set = (k, v) => setM((x) => ({ ...x, [k]: v }));
  const cat = CAT[m.category];

  const pick = async (f) => {
    setErr(''); setInfo(null); setFile(null);
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setErr('اختر ملفاً بصيغة PDF'); return; }
    if (f.size > MAX_BYTES) { setErr('حجم الملف أكبر من 50 ميغابايت'); return; }
    const pdf = f.type === 'application/pdf' ? f : new File([f], f.name, { type: 'application/pdf' });
    setFile(pdf); setReading(true);
    try {
      setInfo(await inspectPdf(pdf));
      if (!m.title) set('title', f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim());
    } catch {
      setErr('تعذّرت قراءة الملف. تأكد أنه PDF سليم وغير محمي بكلمة مرور.');
      setFile(null);
    } finally { setReading(false); }
  };

  const save = async () => {
    setErr('');
    if (!m.title.trim()) { setErr('عنوان التقرير مطلوب'); return; }
    if (!editing && !file) { setErr('اختر ملف التقرير'); return; }
    if (m.category === 'monthly' && (!m.period_year || !m.period_month)) { setErr('حدّد شهر التقرير وسنته'); return; }
    if (m.category === 'annual' && !m.period_year) { setErr('حدّد سنة التقرير'); return; }
    const meta = {
      title: m.title.trim(), category: m.category, issued_on: m.issued_on || today(),
      period_year: ['monthly', 'annual'].includes(m.category) || m.period_year ? Number(m.period_year) || null : null,
      period_month: m.category === 'monthly' ? Number(m.period_month) : null,
      summary: m.summary?.trim() || null,
      event: m.category === 'emergency' ? (m.event?.trim() || null) : null,
      govs: m.category === 'emergency' ? m.govs : [],
      visibility: m.visibility, published: m.published, featured: m.featured,
    };
    if (meta.category === 'annual') meta.period_month = null;
    setBusy(true);
    try {
      const out = editing
        ? await updateReport(initial, { meta, file, thumb: info?.thumb, pages: info?.pages })
        : await createReport({ file, thumb: info?.thumb, pages: info?.pages, meta });
      onDone(out);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="ra-editor">
      <div className="ra-editor__file">
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className={`ra-drop${file ? ' has-file' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
          {info?.preview ? <img src={info.preview} alt="" /> : <Glyph name="pdf" />}
          <span>
            {reading ? 'جارٍ قراءة الملف…'
              : file ? <><strong>{file.name}</strong><small><bdi dir="ltr">{info?.pages}</bdi> صفحة · {fmtSize(file.size)} · اضغط للاستبدال</small></>
                : editing ? <><strong>استبدال الملف</strong><small>اختياري. الحالي: <bdi dir="ltr">{initial.pages || '—'}</bdi> صفحة · {fmtSize(initial.file_size)}</small></>
                  : <><strong>اختر ملف PDF أو اسحبه إلى هنا</strong><small>حتى 50 ميغابايت</small></>}
          </span>
        </button>
      </div>

      <div className="ra-editor__form">
        <label className="ra-field"><span>عنوان التقرير</span>
          <input className="q-input" value={m.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
        </label>

        <div className="ra-field"><span>النوع</span>
          <div className="ent-chips">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={m.category === c.id ? 'is-on' : ''} onClick={() => set('category', c.id)}>{c.name}</button>
            ))}
          </div>
          <small className="ra-hint">{cat.hint}</small>
        </div>

        <div className="ra-row">
          {(m.category === 'monthly') && (
            <label className="ra-field"><span>الشهر</span>
              <select className="q-input" value={m.period_month || ''} onChange={(e) => set('period_month', Number(e.target.value))}>
                {MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}
              </select>
            </label>
          )}
          <label className="ra-field"><span>{m.category === 'monthly' || m.category === 'annual' ? 'السنة' : 'السنة (اختياري)'}</span>
            <select className="q-input" value={m.period_year || ''} onChange={(e) => set('period_year', e.target.value ? Number(e.target.value) : null)}>
              {!['monthly', 'annual'].includes(m.category) && <option value="">—</option>}
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="ra-field"><span>تاريخ الإصدار</span>
            <input className="q-input" type="date" dir="ltr" value={m.issued_on || ''} onChange={(e) => set('issued_on', e.target.value)} />
          </label>
        </div>

        {m.category === 'emergency' && (
          <>
            <label className="ra-field"><span>الحدث</span>
              <input className="q-input" value={m.event || ''} maxLength={200} placeholder="مثال: فيضانات ريف اللاذقية" onChange={(e) => set('event', e.target.value)} />
            </label>
            <div className="ra-field"><span>المحافظات المتأثرة</span>
              <div className="ent-chips">
                {GOVS.map((g) => (
                  <button key={g} type="button" className={m.govs.includes(g) ? 'is-on' : ''}
                    onClick={() => set('govs', m.govs.includes(g) ? m.govs.filter((x) => x !== g) : [...m.govs, g])}>{g}</button>
                ))}
              </div>
            </div>
          </>
        )}

        <label className="ra-field"><span>ملخص قصير <small>يظهر على بطاقة التقرير (اختياري)</small></span>
          <textarea className="q-input" rows={3} maxLength={2000} value={m.summary || ''} onChange={(e) => set('summary', e.target.value)} />
        </label>

        <div className="ra-field"><span>من يراه</span>
          <div className="ra-vis">
            <button type="button" className={m.visibility === 'internal' ? 'is-on' : ''} onClick={() => set('visibility', 'internal')}>
              <Glyph name="lock" /><span><strong>داخلي</strong><small>الحسابات المسجّلة فقط</small></span>
            </button>
            <button type="button" className={m.visibility === 'public' ? 'is-on' : ''} onClick={() => set('visibility', 'public')}>
              <Glyph name="globe" /><span><strong>عام</strong><small>أي زائر دون تسجيل دخول</small></span>
            </button>
          </div>
        </div>

        <div className="ra-toggles">
          <label className="scr__switch"><input type="checkbox" checked={m.published} onChange={(e) => set('published', e.target.checked)} />
            <span><strong>منشور</strong><small>غير المنشور مسودة لا يراها إلا مدير المنصة</small></span></label>
          <label className="scr__switch"><input type="checkbox" checked={m.featured} onChange={(e) => set('featured', e.target.checked)} />
            <span><strong>مميّز</strong><small>يظهر بحجم كبير في أعلى صفحة التقارير</small></span></label>
        </div>

        {err && <p className="q-error">{err}</p>}
        <div className="ent-editor__actions">
          <button type="button" className="survey__navbtn survey__navbtn--primary" onClick={save} disabled={busy || reading}>
            {busy ? 'جارٍ الرفع…' : editing ? 'حفظ التعديل' : 'رفع التقرير'}
          </button>
          <button type="button" className="q-btn" onClick={onCancel} disabled={busy}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

export default function ReportsAdmin() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');

  const load = () => listReports().then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  /* فتح المحرر وإغلاقه يبدأ من أعلى الصفحة */
  useEffect(() => { window.scrollTo({ top: 0 }); }, [edit]);

  const quick = async (r, patch) => {
    try {
      const out = await updateReport(r, { meta: patch });
      setList((l) => l.map((x) => (x.id === r.id ? out : x)));
    } catch (e) { setErr(e.message); }
  };
  const remove = async (r) => {
    if (!window.confirm(`حذف «${r.title}» نهائياً؟ سيُحذف الملف أيضاً.`)) return;
    try { await deleteReport(r); setList((l) => l.filter((x) => x.id !== r.id)); } catch (e) { setErr(e.message); }
  };

  if (edit) {
    return (
      <div className="ra">
        <header className="ra__head"><h2>{edit.id ? 'تعديل تقرير' : 'رفع تقرير جديد'}</h2></header>
        <Editor initial={edit.id ? edit : null} onCancel={() => setEdit(null)}
          onDone={(r) => { setEdit(null); setList((l) => [r, ...(l || []).filter((x) => x.id !== r.id)]); }} />
      </div>
    );
  }

  const t = q.trim();
  const shown = (list || []).filter((r) => !t || r.title.includes(t));
  const drafts = (list || []).filter((r) => !r.published).length;

  return (
    <div className="ra">
      <header className="ra__head">
        <div>
          <h2>التقارير</h2>
          <p>ما يُرفع هنا يظهر في تبويب «التقارير». العام يراه الزائر، والداخلي للحسابات المسجّلة فقط.</p>
        </div>
        <div className="ra__actions">
          <a className="q-btn" href="#/reports" target="_blank" rel="noreferrer">عرض التبويب</a>
          <button type="button" className="survey__navbtn survey__navbtn--primary" onClick={() => setEdit({})}>
            <Glyph name="plus" /> رفع تقرير
          </button>
        </div>
      </header>

      {err && <p className="q-error">{err}</p>}
      {!list && !err && <div className="pending"><p>جارٍ التحميل…</p></div>}
      {list && list.length === 0 && (
        <div className="pending"><h3>لم يُرفع أي تقرير بعد</h3><p>ابدأ برفع أول تقرير PDF.</p></div>
      )}
      {list && list.length > 0 && (
        <>
          <div className="ra__bar">
            <input className="q-input" type="search" value={q} placeholder="بحث بالعنوان…" onChange={(e) => setQ(e.target.value)} />
            <span><bdi dir="ltr">{list.length}</bdi> تقريراً{drafts ? <> · <bdi dir="ltr">{drafts}</bdi> مسودة</> : ''}</span>
          </div>
          <ul className="ra-list">
            {shown.map((r) => (
              <li key={r.id} className={r.published ? '' : 'is-draft'}>
                <span className={`rp-chip rp-chip--${r.category}`}><Glyph name={CAT[r.category]?.icon} />{CAT[r.category]?.short}</span>
                <div className="ra-list__main">
                  <strong>{r.title}{r.featured && <Glyph name="star" className="ra-star" />}</strong>
                  <small>{[periodLabel(r), fmtDate(r.issued_on), r.pages && `${r.pages} صفحة`, fmtSize(r.file_size)].filter(Boolean).join(' · ')}</small>
                </div>
                <button type="button" className={`ra-pill ${r.visibility === 'public' ? 'is-public' : ''}`}
                  title="تبديل: عام / داخلي" onClick={() => quick(r, { visibility: r.visibility === 'public' ? 'internal' : 'public' })}>
                  <Glyph name={r.visibility === 'public' ? 'globe' : 'lock'} />{r.visibility === 'public' ? 'عام' : 'داخلي'}
                </button>
                <button type="button" className={`ra-pill ${r.published ? 'is-on' : 'is-off'}`}
                  title="تبديل: منشور / مسودة" onClick={() => quick(r, { published: !r.published })}>
                  {r.published ? 'منشور' : 'مسودة'}
                </button>
                <span className="ra-list__act">
                  <a className="q-btn q-btn--sm" href={`#/reports/${r.id}`} target="_blank" rel="noreferrer">فتح</a>
                  <button type="button" className="q-btn q-btn--sm" onClick={() => setEdit(r)}>تعديل</button>
                  <button type="button" className="q-btn q-btn--sm q-btn--danger" onClick={() => remove(r)}>حذف</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
