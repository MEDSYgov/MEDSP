import { useEffect, useRef, useState } from 'react';
import useSurvey from './runtime';
import SurveyForm from './SurveyForm';

/*
  صفحة تعبئة استبيان.

  حالياً تعرض الناتج بدل إرساله — طبقة التخزين (Supabase / الخادم الداخلي)
  تُوصَل لاحقاً عند نقطة submit فقط، فبقية النظام لا يتأثر بمكان التخزين.
*/

function ReviewPanel({ data, onBack, onAgain }) {
  return (
    <div className="survey__page">
      <h3 className="survey__pagetitle">تمت التعبئة</h3>
      <p className="survey__intro">
        هذه الإجابات المجمّعة. الأسئلة التي لم تظهر بسبب الشروط مستبعدة تلقائياً.
      </p>
      <pre className="survey__json">{JSON.stringify(data, null, 2)}</pre>
      <div className="survey__nav">
        <button type="button" className="survey__navbtn" onClick={onBack}>
          رجوع للتعديل
        </button>
        {onAgain && (
          <button type="button" className="survey__navbtn survey__navbtn--primary" onClick={onAgain}>
            تعبئة استمارة جديدة
          </button>
        )}
      </div>
    </div>
  );
}

export default function SurveyPage({ definition, onSubmit, submitLabel, hideReview, draft = null, onDraftChange, onSaveLater }) {
  /* إعادة التصفير تُنجَز بتغيير المفتاح، فتعود الحالة نظيفة تماماً */
  const [round, setRound] = useState(0);
  const survey = useSurvey(definition, { round, initialAnswers: draft?.answers, initialPage: draft?.page });

  /*
    الحفظ التلقائي للمسودة: بعد كل تغيير (بمهلة قصيرة)، ما دام المستخدم أدخل شيئاً.
    يحمي الإجابات من إغلاق المتصفح أو انطفاء الهاتف.
  */
  const touchedOnce = useRef(Boolean(draft));
  const firstRender = useRef(true);
  const snap = useRef(null);
  snap.current = { answers: survey.rawAnswers, page: survey.page };
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return undefined; }
    touchedOnce.current = true;
    if (!onDraftChange) return undefined;
    const t = setTimeout(() => onDraftChange(snap.current), 700);
    return () => clearTimeout(t);
  }, [survey.rawAnswers, survey.page]); // eslint-disable-line react-hooks/exhaustive-deps
  /* عند مغادرة الصفحة أو إخفائها (الانتقال لتطبيق آخر) يُحفظ فوراً */
  useEffect(() => {
    if (!onDraftChange) return undefined;
    const flush = () => { if (touchedOnce.current) onDraftChange(snap.current); };
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', flush); };
  }, [onDraftChange]);
  const [submitted, setSubmitted] = useState(null);

  /*
    البيانات الوصفية: لحظة فتح الاستمارة ولحظة إرسالها والمدة.
    تكشف للمشرف الاستمارات المعبّأة بسرعة غير معقولة.
    تبدأ من جديد مع كل استمارة جديدة.
  */
  const startedAt = useRef(draft?.startedAt ? new Date(draft.startedAt) : new Date());
  useEffect(() => { if (round) startedAt.current = new Date(); }, [round]);

  const isLast = survey.page === survey.pages.length - 1;

  const submit = () => {
    const errors = survey.validateAll();
    if (Object.keys(errors).length > 0) {
      survey.showAllErrors();
      /* انتقل لأول صفحة فيها خطأ */
      const firstBad = survey.pages.findIndex((p) =>
        p.children.some((c) => errors[c.name]));
      if (firstBad !== -1 && firstBad !== survey.page) survey.goTo(firstBad);
      return;
    }
    const data = survey.collect();
    const ended = new Date();
    const meta = {
      startedAt: startedAt.current.toISOString(),
      endedAt: ended.toISOString(),
      durationSec: Math.max(0, Math.round((ended - startedAt.current) / 1000)),
    };
    if (onSubmit) {
      Promise.resolve(onSubmit(data, meta))
        .then(() => { if (!hideReview) setSubmitted(data); })
        /* الإجابات تبقى في الحالة عند الفشل فلا تضيع؛ الصفحة الأم تعرض الخطأ */
        .catch((err) => { if (!hideReview) window.alert(err.message); });
      return;
    }
    setSubmitted(data);
  };

  if (submitted) {
    return (
      <section className="shell report">
        <header className="report__head">
          <h1>{definition.title}</h1>
        </header>
        <ReviewPanel
          data={submitted}
          onBack={() => setSubmitted(null)}
          onAgain={onSubmit ? () => { setSubmitted(null); setRound((r) => r + 1); } : null}
        />
      </section>
    );
  }

  return (
    <section className="shell report">
      <header className="report__head">
        <h1>{definition.title}</h1>
        {definition.description && <p className="report__lede">{definition.description}</p>}
      </header>

      <SurveyForm survey={survey} definition={definition} />

      <div className="survey__nav">
        <button
          type="button"
          className="survey__navbtn"
          onClick={survey.back}
          disabled={survey.page === 0}
        >
          السابق
        </button>

        {onSaveLater && (
          <button type="button" className="survey__navbtn survey__navbtn--save"
            onClick={() => onSaveLater({ ...snap.current, startedAt: startedAt.current.toISOString() })}>
            حفظ والمتابعة لاحقاً
          </button>
        )}

        {isLast ? (
          <button type="button" className="survey__navbtn survey__navbtn--primary" onClick={submit}>
            {submitLabel || 'إنهاء ومراجعة'}
          </button>
        ) : (
          <button
            type="button"
            className="survey__navbtn survey__navbtn--primary"
            onClick={survey.next}
          >
            التالي
          </button>
        )}
      </div>

      {survey.expressionErrors.length > 0 && (
        <div className="survey__alert">
          <strong>تحذير للمشرف:</strong> تعابير معطوبة في تعريف الاستبيان:
          <ul>
            {survey.expressionErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
