import { useState } from 'react';
import Icon from '../components/Icon';

/*
  مشاركة رابط الاستبيان مع الباحثين.

  الرابط من شكل:  <الموقع>/#/s/<معرّف الاستبيان>
  يفتح صفحة تعبئة مستقلة، بلا وصول إلى أي شيء إداري.
*/

export default function SharePanel({ survey, onUpdate }) {
  const [copied, setCopied] = useState(false);
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = `${window.location.origin}${window.location.pathname}#/s/${survey.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* بعض المتصفحات تمنع الحافظة بلا تفاعل مباشر — نختار النص بدلاً منها */
      const el = document.getElementById('share-url');
      if (el) { el.select(); document.execCommand('copy'); }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const run = async (cfg) => {
    setBusy(true);
    try { await onUpdate(cfg); } finally { setBusy(false); }
  };

  const toggleOpen = () => run({ open: !survey.open, closesAt: survey.closesAt || '' });
  const setClose = (closesAt) => run({ open: survey.open, closesAt });
  /* كلمة المرور تُرسل للخادم ليخزّن بصمتها، ولا تُقرأ بعدها أبداً */
  const savePw = async () => {
    if (!pw) return;
    await run({ open: survey.open, closesAt: survey.closesAt || '', password: pw });
    setPw('');
  };
  const clearPw = () => run({ open: survey.open, closesAt: survey.closesAt || '', password: '' });

  const expired = survey.closesAt && new Date(survey.closesAt) < new Date();

  return (
    <div className="share">
      <div className={`share__state${survey.open ? ' is-open' : ''}`}>
        <div className="share__statetext">
          <strong>{survey.open ? 'الاستبيان مفتوح للتعبئة' : 'الاستبيان مغلق'}</strong>
          <span>
            {survey.open
              ? 'من يملك الرابط يستطيع التعبئة الآن.'
              : 'الرابط لا يعمل حتى تفتحه.'}
          </span>
        </div>
        <button
          type="button"
          className={`share__switch${survey.open ? ' is-on' : ''}`}
          onClick={toggleOpen}
          disabled={busy}
          role="switch"
          aria-checked={survey.open}
        >
          <span className="share__knob" />
        </button>
      </div>

      {expired && survey.open && (
        <p className="share__warn">
          انتهى تاريخ الإغلاق، فالرابط لا يقبل إجابات جديدة. غيّر التاريخ أو امسحه لإعادة فتحه.
        </p>
      )}

      <div className="share__link">
        <span className="bf__label">
          <Icon name="link" className="share__labelicon" />
          رابط التعبئة
        </span>
        <div className="share__row">
          <input id="share-url" className="q-input share__url" value={url} readOnly dir="ltr"
            onFocus={(e) => e.target.select()} />
          <button type="button" className={`share__copy${copied ? ' is-done' : ''}`} onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} />
            {copied ? 'نُسخ' : 'نسخ'}
          </button>
        </div>
        <span className="bf__hint">
          أرسل هذا الرابط للباحثين. يفتح صفحة التعبئة وحدها، بلا وصول لأي بيانات أخرى.
        </span>
      </div>

      <label className={`share__login${survey.requiresLogin ? ' is-on' : ''}`}>
        <input type="checkbox" checked={survey.requiresLogin} disabled={busy}
          onChange={(e) => run({ open: survey.open, closesAt: survey.closesAt || '', requiresLogin: e.target.checked })} />
        <span>
          <strong>يتطلب تسجيل الدخول</strong>
          <small>{survey.requiresLogin
            ? 'لا تُفتح الاستمارة إلا بحساب شخصي أُسندت إليه (جامع بيانات أو مراجع)، وكل إجابة تُسجَّل باسم مُرسلها. أسنِد الاستمارة للحسابات من «الحسابات».'
            : 'الرابط مفتوح لمن يملكه (مع كلمة مرور اختيارية). فعّل هذا ليُشترط الدخول بحساب شخصي.'}</small>
        </span>
      </label>

      <div className="share__grid">
        <div className="bf">
          <span className="bf__label">
            <Icon name="lock" className="share__labelicon" />
            كلمة مرور
            {survey.hasPassword && <span className="tag tag--approved">مفعّلة</span>}
          </span>
          <div className="share__row">
            <input
              className="q-input bf__input"
              type={showPw ? 'text' : 'password'}
              value={pw}
              autoComplete="new-password"
              placeholder={survey.hasPassword ? 'اكتب كلمة جديدة لتغييرها' : 'اكتب كلمة مرور لحماية الرابط'}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && savePw()}
            />
            <button type="button" className="q-btn q-btn--sm" onClick={() => setShowPw(!showPw)}>
              {showPw ? 'إخفاء' : 'إظهار'}
            </button>
            <button type="button" className="q-btn q-btn--sm" onClick={savePw} disabled={!pw || busy}>
              {survey.hasPassword ? 'تغيير' : 'تفعيل'}
            </button>
            {survey.hasPassword && (
              <button type="button" className="q-btn q-btn--sm q-btn--danger" onClick={clearPw} disabled={busy}>
                إزالة
              </button>
            )}
          </div>
          <span className="bf__hint">
            تُخزَّن مشفّرة ولا يمكن استرجاعها — احفظها قبل إرسالها للباحثين.
          </span>
        </div>

        <label className="bf">
          <span className="bf__label">إغلاق تلقائي</span>
          <input
            className="q-input bf__input"
            type="date"
            value={survey.closesAt || ''}
            onChange={(e) => setClose(e.target.value)}
          />
          <span className="bf__hint">اختياري — يتوقف الرابط عن قبول الإجابات بعد هذا اليوم.</span>
        </label>
      </div>
    </div>
  );
}
