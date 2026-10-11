import { useCallback, useEffect, useMemo, useState } from 'react';
import { flattenQuestions } from '../survey/schema';
import { RESPONSE_STATUS } from '../projects/store';
import Icon from '../components/Icon';
import { durationInfo } from './durations';

/*
  النتائج والمراجعة.

  المراجعة عمل متكرر على عشرات أو مئات الاستمارات، فالشاشة مبنية
  حول سرعة المراجعة: لوحة جانبية تعرض استمارة واحدة، وبعد الاعتماد
  أو الرفض تنتقل تلقائياً إلى الاستمارة التالية المنتظرة.
  اختصارات: A اعتماد، R رفض، ← → تنقل، Esc إغلاق.
*/

const fmt = (n) => Number(n).toLocaleString('en-US');

/* ---------------- عرض القيم ---------------- */

function display(value, node, areas) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value) && value.length === 0) return '';

  if (node?.choices) {
    const list = Array.isArray(value) ? value : [value];
    return list
      .map((v) => node.choices.find((c) => String(c.value) === String(v))?.label ?? v)
      .join('، ');
  }
  if (node?.type === 'admin_area') {
    const gov = areas?.gov?.get(value.governorate)?.name || value.governorate || '';
    const sub = areas?.sub?.get(value.subdistrict)?.name || value.names?.subdistrict || '';
    return [gov, value.names?.district, sub, value.names?.community].filter(Boolean).join('، ');
  }
  if (node?.type === 'geopoint') {
    return value?.lat != null ? `${Number(value.lat).toFixed(5)}, ${Number(value.lng).toFixed(5)}` : '';
  }
  if (node?.type === 'image') return value?.dataUrl ? 'صورة مرفقة' : '';
  if (node?.type === 'repeat') return `${value.length} ${node.itemLabel || 'مدخل'}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* ---------------- تصدير CSV ---------------- */

/*
  CSV بترميز UTF-8 مع BOM حتى يفتحه Excel بالعربية صحيحاً.
  المجموعات المتكررة تُلخَّص بعددها — تفاصيلها في الواجهة.
*/
function exportCsv(rows, questions, areas, filename) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['المعرّف', 'الحالة', 'تاريخ الإرسال', 'عُدّلت', ...questions.map((q) => q.label || q.name)];
  const lines = [head.map(esc).join(',')];
  for (const r of rows) {
    lines.push([
      r.id,
      RESPONSE_STATUS[r.status],
      new Date(r.submittedAt).toISOString().slice(0, 16).replace('T', ' '),
      r.edited ? 'نعم' : '',
      ...questions.map((q) => display(r.answers[q.name], q, areas)),
    ].map(esc).join(','));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- لوحة المراجعة ---------------- */

const EDITABLE = new Set(['text', 'textarea', 'integer', 'decimal', 'range', 'date', 'time', 'datetime']);

function ReviewDrawer({
  response, questions, areas, position, total, onPrev, onNext, onClose, onReview, onEdit, onDelete, ok = 'approved', okLabel = 'اعتماد',
}) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setEditing(null); }, [response.id]);

  const act = useCallback(async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }, [busy]);

  /* اختصارات لوحة المفاتيح — معطّلة أثناء الكتابة في حقل */
  useEffect(() => {
    const onKey = (e) => {
      if (editing || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onNext();
      else if (e.key === 'ArrowRight') onPrev();
      else if (e.key.toLowerCase() === 'a' && response.status !== ok) act(() => onReview(response.id, ok));
      else if (e.key.toLowerCase() === 'r' && response.status !== 'rejected') act(() => onReview(response.id, 'rejected'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, response, onClose, onNext, onPrev, onReview, act]);

  const save = (node) => act(async () => {
    const numeric = ['integer', 'decimal', 'range'].includes(node.type);
    await onEdit(response.id, node.name, numeric && draft !== '' ? Number(draft) : draft);
    setEditing(null);
  });

  const answered = questions.filter((q) => display(response.answers[q.name], q, areas) !== '').length;

  return (
    <div className="drawer" role="dialog" aria-label="مراجعة استمارة">
      <button type="button" className="drawer__scrim" onClick={onClose} aria-label="إغلاق" />
      <aside className="drawer__panel">
        <header className="drawer__head">
          <div className="drawer__nav">
            <button type="button" className="bq__tool" onClick={onPrev} disabled={position <= 1} aria-label="السابقة">→</button>
            <span className="drawer__pos"><strong>{fmt(position)}</strong> من {fmt(total)}</span>
            <button type="button" className="bq__tool" onClick={onNext} disabled={position >= total} aria-label="التالية">←</button>
          </div>
          <span className={`status status--${response.status}`}>{RESPONSE_STATUS[response.status]}</span>
          <button type="button" className="tpick__close" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>

        {(() => {
          const d = durationInfo(response);
          const m = response.meta || {};
          const t = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          return (d.sec !== null || m.device || m.offline) ? (
            <div className={`drawer__timing${d.suspicious ? ' is-fast' : ''}`}>
              {d.sec !== null && (
                <span>
                  <b>{d.label}</b> للتعبئة
                  {m.startedAt && m.endedAt && <> ، من <bdi dir="ltr">{t(m.startedAt)}</bdi> إلى <bdi dir="ltr">{t(m.endedAt)}</bdi></>}
                </span>
              )}
              {d.suspicious && <span className="drawer__warn">أسرع من المتوقع لعدد الأسئلة المُجابة — تحقق منها قبل الاعتماد</span>}
              {m.device && <span>{m.device}</span>}
              {m.offline && <span>حُفظت على الجهاز بلا اتصال وأُرسلت لاحقاً</span>}
            </div>
          ) : null;
        })()}

        <div className="drawer__meta">
          <span>أُرسلت {new Date(response.submittedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span>{answered} من {questions.length} سؤالاً مُجاب</span>
          {response.edited && <span className="drawer__edited">عُدّلت بعد الإرسال</span>}
        </div>

        <div className="drawer__body">
          {questions.map((node, i) => {
            const value = response.answers[node.name];
            const shown = display(value, node, areas);
            const isEditing = editing === node.name;
            return (
              <div className={`ans${shown ? '' : ' ans--empty'}`} key={node.name}>
                <span className="ans__q">
                  <span className="ans__n">{i + 1}</span>
                  {node.label || node.name}
                </span>
                {isEditing ? (
                  <span className="ans__edit">
                    <input className="q-input" value={draft} autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') save(node); if (e.key === 'Escape') setEditing(null); }} />
                    <button type="button" className="q-btn q-btn--sm" onClick={() => save(node)}>حفظ</button>
                    <button type="button" className="q-btn q-btn--sm" onClick={() => setEditing(null)}>إلغاء</button>
                  </span>
                ) : (
                  <span className="ans__a">
                    {node.type === 'image' && value?.dataUrl
                      ? <img className="ans__img" src={value.dataUrl} alt={node.label} />
                      : node.type === 'repeat' && Array.isArray(value) && value.length
                        ? (
                          <span className="ans__rep">
                            {value.map((row, j) => (
                              <span className="ans__row" key={j}>
                                <b>{node.itemLabel || 'مدخل'} {j + 1}</b>
                                {(node.children || []).map((c) => {
                                  const v = display(row[c.name], c, areas);
                                  return v ? <span key={c.name}>{c.label}: {v}</span> : null;
                                })}
                              </span>
                            ))}
                          </span>
                        )
                        : (shown || 'لم يُجب')}
                    {EDITABLE.has(node.type) && (
                      <button type="button" className="ans__editbtn"
                        onClick={() => { setEditing(node.name); setDraft(value ?? ''); }}>
                        تعديل
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}

          {response.history?.length > 1 && (
            <details className="drawer__history">
              <summary>سجل التغييرات ({response.history.length})</summary>
              <ol>
                {response.history.map((h, i) => (
                  <li key={i}>
                    <span>{new Date(h.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    {' '}{({ submitted: 'أُرسلت', confirmed: 'أكّدتها الجهة', approved: 'اعتُمدت', rejected: 'رُفضت', edited: 'عُدّلت' })[h.action] || h.action}
                    {h.by ? ` بواسطة ${h.by}` : ''}
                    {h.field ? `: ${questions.find((q) => q.name === h.field)?.label || h.field}` : ''}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>

        <footer className="drawer__foot">
          <button type="button" className="rv rv--ok" disabled={busy || response.status === ok || response.status === 'approved'}
            onClick={() => act(() => onReview(response.id, ok))}>
            <Icon name="check" />{okLabel}<kbd>A</kbd>
          </button>
          <button type="button" className="rv rv--no" disabled={busy || response.status === 'rejected'}
            onClick={() => act(() => onReview(response.id, 'rejected'))}>
            رفض<kbd>R</kbd>
          </button>
          <button type="button" className="q-btn q-btn--sm q-btn--danger drawer__del" disabled={busy}
            onClick={() => act(async () => {
              if (window.confirm('حذف هذه الاستمارة نهائياً؟ لا يمكن التراجع.')) await onDelete(response.id);
            })}>
            حذف
          </button>
        </footer>
      </aside>
    </div>
  );
}

/* ---------------- الشاشة ---------------- */

const FILTERS = [
  { key: 'pending', label: 'بانتظار المراجعة' },
  { key: 'confirmed', label: 'مؤكدة من الجهة' },
  { key: 'approved', label: 'معتمدة' },
  { key: 'rejected', label: 'مرفوضة' },
  { key: 'all', label: 'الكل' },
];

export default function ResponsesTable({
  responses, survey, areas, onReview, onEdit, onDelete, onBulk, entityReviewer = false,
}) {
  /* مشرف الجهة «يؤكد»، والوزارة «تعتمد» */
  const ok = entityReviewer ? 'confirmed' : 'approved';
  const okLabel = entityReviewer ? 'تأكيد الجهة' : 'اعتماد';
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [openId, setOpenId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const questions = useMemo(
    () => flattenQuestions(survey.pages.flatMap((p) => p.children)).filter((q) => q.type !== 'note'),
    [survey],
  );
  const columns = questions.filter((q) => q.type !== 'image' && q.type !== 'repeat').slice(0, 4);

  const counts = useMemo(() => ({
    fast: responses.filter((r) => durationInfo(r).suspicious).length,
    all: responses.length,
    pending: responses.filter((r) => r.status === 'pending').length,
    approved: responses.filter((r) => r.status === 'approved').length,
    confirmed: responses.filter((r) => r.status === 'confirmed').length,
    rejected: responses.filter((r) => r.status === 'rejected').length,
  }), [responses]);

  /* إن لم يبق شيء منتظر، افتح على «الكل» بدل شاشة فارغة */
  useEffect(() => {
    if (filter === 'pending' && counts.pending === 0 && counts.all > 0) setFilter('all');
  }, [counts.pending, counts.all, filter]);

  const rows = useMemo(() => {
    let list = filter === 'all' ? responses
      : filter === 'fast' ? responses.filter((r) => durationInfo(r).suspicious)
        : responses.filter((r) => r.status === filter);
    const q = query.trim();
    if (q) {
      list = list.filter((r) => questions.some((node) => display(r.answers[node.name], node, areas).includes(q)));
    }
    return list;
  }, [responses, filter, query, questions, areas]);

  const index = rows.findIndex((r) => r.id === openId);
  const current = responses.find((r) => r.id === openId);

  const go = (d) => {
    const next = rows[index + d];
    if (next) setOpenId(next.id);
  };

  /* بعد الحكم على استمارة: انتقل إلى التالية المنتظرة، وإلا أغلق */
  const review = async (id, status) => {
    const pendingAfter = responses.filter((r) => r.status === 'pending' && r.id !== id);
    const pos = responses.findIndex((r) => r.id === id);
    const nextPending = pendingAfter.find((r) => responses.indexOf(r) > pos) || pendingAfter[0];
    await onReview(id, status);
    if (filter === 'pending') setOpenId(nextPending ? nextPending.id : null);
  };

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const runBulk = async (status) => {
    await onBulk([...selected], status);
    setSelected(new Set());
  };

  if (responses.length === 0) {
    return (
      <div className="rempty">
        <Icon name="t_textarea" className="rempty__icon" />
        <h3>لم تصل أي استمارة بعد</h3>
        <p>افتح الاستبيان من تبويب «المشاركة» وأرسل الرابط للباحثين. تظهر الاستمارات هنا فور إرسالها.</p>
      </div>
    );
  }

  return (
    <div className="results">
      <div className={`rsum${counts.fast ? ' rsum--5' : ''}`}>
        {[...FILTERS, ...(counts.fast ? [{ key: 'fast', label: 'سريعة بشكل مريب' }] : [])].map((f) => (
          <button key={f.key} type="button"
            className={`rsum__card rsum__card--${f.key}${filter === f.key ? ' is-on' : ''}`}
            onClick={() => { setFilter(f.key); setSelected(new Set()); }}>
            <span className="rsum__n">{fmt(counts[f.key])}</span>
            <span className="rsum__l">{f.label}</span>
          </button>
        ))}
      </div>

      <div className="rbar">
        <input className="q-input rbar__search" type="search" value={query}
          placeholder="ابحث في الإجابات…" onChange={(e) => setQuery(e.target.value)} />
        {selected.size > 0 ? (
          <div className="rbar__bulk">
            <span>{fmt(selected.size)} محدّدة</span>
            <button type="button" className="rv rv--ok rv--sm" onClick={() => runBulk(ok)}>{okLabel}</button>
            <button type="button" className="rv rv--no rv--sm" onClick={() => runBulk('rejected')}>رفض</button>
            <button type="button" className="q-btn q-btn--sm" onClick={() => setSelected(new Set())}>إلغاء</button>
          </div>
        ) : (
          <div className="rbar__tools">
            {counts.pending > 0 && (
              <button type="button" className="survey__navbtn survey__navbtn--primary"
                onClick={() => {
                  setFilter('pending');
                  setOpenId(responses.find((r) => r.status === 'pending')?.id ?? null);
                }}>
                ابدأ المراجعة
              </button>
            )}
            <button type="button" className="q-btn" disabled={exporting}
              title="ورقة للاستمارات، وورقة لكل مجموعة متكررة، وقاموس للأسئلة — للظاهر في الجدول"
              onClick={async () => {
                setExporting(true);
                try {
                  const { exportXlsx } = await import('./exportXlsx');
                  await exportXlsx({ survey, responses: rows, areas, filename: `${survey.title || 'استبيان'}.xlsx` });
                } finally { setExporting(false); }
              }}>
              {exporting ? 'جارٍ التجهيز…' : 'تصدير Excel'}
            </button>
            <button type="button" className="q-btn q-btn--sm" title="ملف CSV مسطّح — بلا تفاصيل المجموعات المتكررة"
              onClick={() => exportCsv(rows, questions, areas, `${survey.title || 'استبيان'}-${filter}.csv`)}>
              CSV
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="results__empty">لا توجد استمارات تطابق البحث.</p>
      ) : (
        <div className="results__scroll">
          <table className="results__table rtable">
            <thead>
              <tr>
                <th className="results__check">
                  <input type="checkbox" aria-label="تحديد الكل"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
                <th>الحالة</th>
                <th>الإرسال</th>
                <th>المدة</th>
                {columns.map((q) => <th key={q.name}>{q.label || q.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}
                  className={`${selected.has(r.id) ? 'is-selected' : ''}${openId === r.id ? ' is-open' : ''}`}
                  onClick={() => setOpenId(r.id)}>
                  <td className="results__check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label="تحديد" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td><span className={`status status--${r.status}`}>{RESPONSE_STATUS[r.status]}</span></td>
                  <td className="results__date">
                    {new Date(r.submittedAt).toLocaleDateString('en-GB')}
                    {r.edited && <span className="rtable__edited" title="عُدّلت بعد الإرسال">●</span>}
                  </td>
                  <td className="results__date">
                    {(() => {
                      const d = durationInfo(r);
                      if (d.sec === null) return <span className="rtable__nil">—</span>;
                      return (
                        <span className={d.suspicious ? 'dur dur--fast' : 'dur'}
                          title={d.suspicious ? `أسرع من ${d.floor} ثانية المتوقعة لعدد الأسئلة المُجابة` : undefined}>
                          {d.label}{d.suspicious && ' ⚠'}
                        </span>
                      );
                    })()}
                  </td>
                  {columns.map((q) => (
                    <td key={q.name} className="rtable__cell">{display(r.answers[q.name], q, areas) || <span className="rtable__nil">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {current && index !== -1 && (
        <ReviewDrawer
          response={current}
          questions={questions}
          areas={areas}
          position={index + 1}
          total={rows.length}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onClose={() => setOpenId(null)}
          onReview={review}
          ok={ok}
          okLabel={okLabel}
          onEdit={onEdit}
          onDelete={async (id) => { await onDelete(id); setOpenId(null); }}
        />
      )}
    </div>
  );
}
