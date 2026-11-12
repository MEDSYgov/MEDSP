import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicSurvey, unlockSurvey, createResponse, cacheSurvey, cachedSurvey, signIn, signOut, getMyRole, responseStatuses } from './store';
import { hasStoredSession } from './supabase';
import * as outbox from './outbox';
import * as drafts from '../survey/drafts';
import SurveyPage from '../survey/SurveyPage';
import Icon from '../components/Icon';

/*
  صفحة التعبئة العامة — ما يفتحه الباحث عبر الرابط المشترك.

  العمل بلا إنترنت:
    - أول فتح وأنت متصل يحفظ الاستبيان على الجهاز
    - بعدها يُفتح ويُعبّأ بلا شبكة
    - الإرسال بلا شبكة يُحفظ في صندوق الصادر على الجهاز
    - يُرسل تلقائياً عند عودة الشبكة وهذه الصفحة مفتوحة
*/

function Shell({ children }) {
  return <section className="shell fillpage">{children}</section>;
}

function Message({ icon, title, body, children }) {
  return (
    <Shell>
      <div className="fillpage__msg">
        {icon && <Icon name={icon} className="fillpage__icon" />}
        <h1>{title}</h1>
        <p>{body}</p>
        {children}
      </div>
    </Shell>
  );
}

const send = (item) => createResponse(item.surveyId, item.answers, {
  password: item.password, source: 'link', meta: item.meta, clientId: item.clientId, token: item.token,
});

/*
  ما أرسله هذا الجهاز: تُحفظ معرّفات الاستمارات (لا محتواها) لعرض حالتها لاحقاً:
  بانتظار المراجعة، أُعيدت للتعديل (مع السبب)، معتمدة.
*/
const SENT = (sid) => `medsp-sent:${sid}`;
function rememberSent(sid, clientId) {
  try {
    const list = JSON.parse(localStorage.getItem(SENT(sid)) || '[]');
    list.unshift({ id: clientId, at: new Date().toISOString() });
    localStorage.setItem(SENT(sid), JSON.stringify(list.slice(0, 200)));
  } catch { /* */ }
}
const SENT_LABEL = { pending: 'بانتظار المراجعة', confirmed: 'بانتظار الاعتماد النهائي', approved: 'معتمدة ✓', returned: 'أُعيدت للتعديل', rejected: 'أُعيدت للتعديل', deleted: 'أُلغيت' };

function SentList({ surveyId, online, tick }) {
  const [list] = useState(() => { try { return JSON.parse(localStorage.getItem(SENT(surveyId)) || '[]'); } catch { return []; } });
  const [st, setSt] = useState({});
  const [open, setOpen] = useState(true);
  const [queued, setQueued] = useState(new Set());
  useEffect(() => {
    const r = () => outbox.list(surveyId).then((l) => setQueued(new Set(l.map((i) => i.clientId)))).catch(() => {});
    r(); return outbox.subscribe(r);
  }, [surveyId]);
  const items = (() => { try { return JSON.parse(localStorage.getItem(SENT(surveyId)) || '[]'); } catch { return list; } })()
    .filter((x) => !queued.has(x.id));
  useEffect(() => {
    if (!online || !items.length) return;
    responseStatuses(items.map((x) => x.id)).then((rows) => setSt(Object.fromEntries(rows.map((r) => [r.clientId, r])))).catch(() => {});
  }, [online, surveyId, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  const c = (k) => items.filter((x) => (st[x.id]?.status || 'queued') === k || (k === 'returned' && st[x.id]?.status === 'rejected')).length;
  return (
    <div className="sent">
      <button type="button" className="sent__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>أُرسلت من هذا الجهاز ({items.length})</b>
        <span>
          {c('approved') > 0 && <i className="is-ok">{c('approved')} معتمدة</i>}
          {c('returned') > 0 && <i className="is-bad">{c('returned')} أُعيدت للتعديل</i>}
        </span>
      </button>
      {open && (
        <ul className="sent__list">
          {items.map((x) => {
            const r = st[x.id];
            return (
              <li key={x.id} className={`sent__row is-${r?.status || 'queued'}`}>
                <time>{new Date(x.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</time>
                <span>{r ? `✓ وصلت — ${SENT_LABEL[r.status] || r.status}` : online ? 'وصلت ✓' : '✓ أُرسلت — تظهر حالة المراجعة عند الاتصال'}</span>
                {r?.note && <small>السبب: {r.note}</small>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------- المسودات (حفظ والمتابعة لاحقاً) ---------------- */

function DraftList({ list, onOpen, onRemove }) {
  if (!list.length) return null;
  return (
    <div className="drafts">
      <b className="drafts__head">مسودات محفوظة على هذا الجهاز ({list.length})</b>
      <ul>
        {list.map((d) => (
          <li key={d.id}>
            <span className="drafts__text">
              <strong>{d.label}</strong>
              <small>
                <span>آخر تعديل <bdi dir="ltr">{new Date(d.updatedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</bdi></span>
                <span>الصفحة {(d.page || 0) + 1}</span>
                <span>{d.count} إجابة</span>
              </small>
            </span>
            <button type="button" className="survey__navbtn survey__navbtn--primary drafts__go" onClick={() => onOpen(d)}>متابعة</button>
            <button type="button" className="q-btn q-btn--sm q-btn--danger"
              onClick={() => { if (window.confirm('حذف هذه المسودة نهائياً؟')) onRemove(d.id); }}>حذف</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* رمز الرابط العام من عنوان الصفحة: #/s/<id>?k=<token> */
const linkToken = () => new URLSearchParams((window.location.hash.split('?')[1]) || '').get('k') || null;

/* اسم المستبين يُحفظ على الجهاز فلا يُكتب في كل مرة */
const NAME_KEY = 'medsp-respondent';
const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };

function NameGate({ title, initial = '', onDone }) {
  const [first, setFirst] = useState(() => initial.split(' ')[0] || '');
  const [last, setLast] = useState(() => initial.split(' ').slice(1).join(' '));
  const [error, setError] = useState('');
  const submit = () => {
    const f = first.trim(); const l = last.trim();
    if (f.length < 2 || l.length < 2) { setError('اكتب الاسم والكنية'); return; }
    const full = `${f} ${l}`;
    try { localStorage.setItem(NAME_KEY, full); } catch { /* */ }
    onDone(full);
  };
  return (
    <Shell>
      <form className="gate gate--login" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Icon name="staff" className="gate__icon" />
        <h1>{title}</h1>
        <p className="gate__lede">اكتب اسمك وكنيتك. يُرفق مع كل استمارة ترسلها، ويُحفظ على هذا الجهاز.</p>
        <label className="bf">
          <span className="bf__label">الاسم</span>
          <input className="q-input bf__input" value={first} autoComplete="given-name" autoFocus onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="bf">
          <span className="bf__label">الكنية</span>
          <input className="q-input bf__input" value={last} autoComplete="family-name" onChange={(e) => setLast(e.target.value)} />
        </label>
        {error && <p className="gate__err">{error}</p>}
        <button type="submit" className="survey__navbtn survey__navbtn--primary gate__submit">متابعة</button>
      </form>
    </Shell>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/* ---------------- صندوق الصادر ---------------- */

function Outbox({ surveyId, online }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);

  const refresh = useCallback(() => outbox.list(surveyId).then(setItems).catch(() => setItems([])), [surveyId]);

  const flushNow = useCallback(async () => {
    setBusy(true);
    try { setLast(await outbox.flush(send)); } finally { setBusy(false); refresh(); }
  }, [refresh]);

  useEffect(() => { refresh(); return outbox.subscribe(refresh); }, [refresh]);

  /* إرسال تلقائي: عند فتح الصفحة، وعند عودة الشبكة، وكل نصف دقيقة ما دام هناك انتظار */
  useEffect(() => { if (online) flushNow(); }, [online, flushNow]);
  /* إعادة محاولة دورية ما دام الجهاز متصلاً (لعطل مؤقت في السيرفر) */
  useEffect(() => {
    if (!online) return undefined;
    const t = setInterval(() => { flushNow(); }, 60000);
    return () => clearInterval(t);
  }, [online, flushNow]);
  const pending = items.filter((i) => !i.rejected);
  useEffect(() => {
    if (!online || pending.length === 0) return undefined;
    const t = setInterval(flushNow, 30000);
    return () => clearInterval(t);
  }, [online, pending.length, flushNow]);

  const [one, setOne] = useState(null);
  const sendOne = async (id) => {
    setOne(id);
    try { await outbox.retry(id); setLast(await outbox.flush(send, id)); } finally { setOne(null); refresh(); }
  };
  const fmt = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

  if (items.length === 0) {
    return last?.sent ? (
      <div className="outbox outbox--ok" role="status">
        <Icon name="check" className="outbox__icon" />
        <span>أُرسلت {last.sent} {last.sent === 1 ? 'استمارة' : 'استمارات'} بنجاح.</span>
      </div>
    ) : null;
  }

  return (
    <div className={`outbox${online ? '' : ' outbox--offline'}`} role="status">
      <div className="outbox__head">
        <b>لم تُرسل بعد ({items.length})</b>
        <span>{online ? 'تُرسل تلقائياً، أو اضغط «إرسال»' : 'لا يوجد اتصال — تُرسل عند عودة الشبكة'}</span>
      </div>
      <ul className="outbox__list">
        {items.map((i) => {
          const sending = one === i.clientId || (busy && !i.rejected);
          return (
            <li key={i.clientId} className={`outbox__item${i.rejected ? ' is-bad' : ''}`}>
              <span className="outbox__text">
                <strong>{drafts.draftLabel(i.answers)}</strong>
                <small>
                  <bdi dir="ltr">{fmt(i.queuedAt)}</bdi>
                  <em>{sending ? 'جارٍ الإرسال…' : i.rejected ? 'لم تُقبل' : 'لم تُرسل'}</em>
                </small>
                {i.rejected && i.lastError && <small className="outbox__why">السبب: {i.lastError}</small>}
              </span>
              <button type="button" className="survey__navbtn survey__navbtn--primary outbox__send"
                disabled={!online || sending} onClick={() => sendOne(i.clientId)}>
                {sending ? '…' : 'إرسال'}
              </button>
              {i.rejected && (
                <button type="button" className="q-btn q-btn--sm q-btn--danger"
                  onClick={() => { if (window.confirm('حذف هذه الاستمارة من الجهاز نهائياً؟')) outbox.remove(i.clientId); }}>
                  حذف
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------- الدخول (للاستمارات التي تتطلبه) ---------------- */

function SurveyLogin({ title, onDone }) {
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError('');
    if (!username || !pw) { setError('أدخل اسم المستخدم وكلمة المرور'); return; }
    setBusy(true);
    try { await signIn(username.trim(), pw, { remember: true }); onDone(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <form className="gate gate--login" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Icon name="lock" className="gate__icon" />
        <h1>{title}</h1>
        <p className="gate__lede">هذه الاستمارة للحسابات المعتمدة فقط. ادخل باسم المستخدم وكلمة المرور الخاصين بك.</p>
        <label className="bf">
          <span className="bf__label">اسم المستخدم</span>
          <input className="q-input bf__input" dir="ltr" value={username} autoComplete="username"
            autoCapitalize="none" spellCheck={false} autoFocus onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="bf">
          <span className="bf__label">كلمة المرور</span>
          <input className="q-input bf__input" type="password" dir="ltr" value={pw} autoComplete="current-password"
            onChange={(e) => setPw(e.target.value)} />
        </label>
        <p className="gate__hint">يبقى الدخول محفوظاً على هذا الجهاز حتى تضغط «خروج»، لتعمل الاستمارة في الميدان بلا إنترنت.</p>
        {error && <p className="gate__err">{error}</p>}
        <button type="submit" className="survey__navbtn survey__navbtn--primary gate__submit" disabled={busy}>
          {busy ? 'جارٍ التحقق…' : 'دخول'}
        </button>
        <p className="auth__note">لا تملك حساباً؟ يُنشئه لك مدير المنصة.</p>
      </form>
    </Shell>
  );
}

/* ---------------- الصفحة ---------------- */

export default function FillPage({ surveyId }) {
  const online = useOnline();
  const [state, setState] = useState({ status: 'loading' });
  const [definition, setDefinition] = useState(null);
  const [attempt, setAttempt] = useState('');
  const [password, setPassword] = useState(null);
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState(null);
  const [sendError, setSendError] = useState('');
  const [reload, setReload] = useState(0);
  const [who, setWho] = useState('');
  const [token] = useState(linkToken);
  /* المسودة الجارية: معرّفها يُنشأ عند أول إدخال؛ وتغيير «fillKey» يفتح استمارة جديدة أو مسودة */
  const [draftList, setDraftList] = useState([]);
  const [openDraft, setOpenDraft] = useState(null);
  const [fillKey, setFillKey] = useState('new-0');
  const [savedNote, setSavedNote] = useState('');
  const draftId = useRef(null);
  const draftStart = useRef(null);
  const refreshDrafts = useCallback(() => drafts.listDrafts(surveyId).then(setDraftList).catch(() => setDraftList([])), [surveyId]);
  useEffect(() => { refreshDrafts(); }, [refreshDrafts]);
  const startFill = (d = null) => {
    draftId.current = d?.id || null;
    draftStart.current = d?.startedAt || null;
    setOpenDraft(d);
    setFillKey(d ? `d-${d.id}-${Date.now()}` : `new-${Date.now()}`);
    window.scrollTo(0, 0);
  };
  const storeDraft = async (snap) => {
    if (!draftId.current) { draftId.current = drafts.newDraftId(); draftStart.current = new Date().toISOString(); }
    const count = drafts.answeredCount(snap.answers);
    if (!count) return;
    await drafts.saveDraft({ id: draftId.current, surveyId, answers: snap.answers, page: snap.page,
      startedAt: draftStart.current, label: drafts.draftLabel(snap.answers), count });
    refreshDrafts();
  };
  const dropCurrentDraft = async () => {
    if (draftId.current) { await drafts.removeDraft(draftId.current).catch(() => {}); draftId.current = null; }
    refreshDrafts();
  };
  const [respondent, setRespondent] = useState(savedName);

  useEffect(() => {
    let alive = true;
    getPublicSurvey(surveyId, token).then(async (res) => {
      if (!alive) return;
      /* بلا شبكة واستمارة تتطلب الدخول: لا تُفتح النسخة المحفوظة إلا بجلسة على الجهاز */
      if (res.fromCache && res.requiresLogin && !res.publicLink && !hasStoredSession()) { setState({ status: 'login-offline' }); return; }
      if (res.requiresLogin) getMyRole().then((m) => alive && setWho(m?.displayName || m?.username || '')).catch(() => {});
      setState(res);
      if (res.fromCache && res.cached?.definition) {
        /* بلا شبكة: من النسخة المحفوظة على الجهاز */
        setDefinition(res.cached.definition);
        setPassword(res.cached.password ?? null);
      } else if (res.status === 'ok' && !res.needsPassword) {
        setDefinition(res.survey);
      }
    });
    return () => { alive = false; };
  }, [surveyId, reload, token]);

  const logout = async () => { await signOut(); setDefinition(null); setWho(''); setState({ status: 'loading' }); setReload((n) => n + 1); };

  if (state.status === 'loading') return <Message title="جارٍ التحميل" body="لحظة من فضلك." />;

  if (state.status === 'offline') {
    return (
      <Message icon="lock" title="لا يوجد اتصال بالإنترنت"
        body="هذا الاستبيان لم يُفتح على هذا الجهاز من قبل، فلا توجد نسخة محفوظة منه. افتح الرابط مرة واحدة وأنت متصل، وبعدها يعمل بلا إنترنت." />
    );
  }

  if (state.status === 'login') {
    return <SurveyLogin title={state.survey?.title || 'استمارة'} onDone={() => { setState({ status: 'loading' }); setReload((n) => n + 1); }} />;
  }

  if (state.status === 'login-offline') {
    return (
      <Message icon="lock" title="يلزم تسجيل الدخول"
        body="هذه الاستمارة تتطلب الدخول بحسابك، ولا يوجد اتصال الآن. اتصل بالإنترنت وادخل مرة واحدة (مع «تذكّرني»)، وبعدها تعمل بلا إنترنت." />
    );
  }

  if (state.status === 'forbidden') {
    return (
      <Message icon="lock" title="هذا الحساب غير مخوّل"
        body="حسابك لا يملك صلاحية تعبئة هذه الاستمارة. اطلب من مدير المنصة إسنادها إليك، أو ادخل بحساب آخر.">
        <button type="button" className="survey__navbtn" onClick={logout}>الدخول بحساب آخر</button>
      </Message>
    );
  }

  if (state.status === 'link-revoked') {
    return (
      <Message icon="lock" title="هذا الرابط لم يعد صالحاً"
        body="أُلغي هذا الرابط العام. اطلب الرابط الجديد من مدير المنصة. ما حفظته على هذا الجهاز ولم يُرسل يبقى محفوظاً." />
    );
  }

  if (state.status === 'missing') {
    return (
      <Message title="الرابط غير صحيح"
        body="لا يوجد استبيان بهذا الرابط. تأكد من نسخه كاملاً، أو اطلب رابطاً جديداً ممن أرسله لك." />
    );
  }

  if (state.status === 'closed') {
    return (
      <Message icon="lock" title="الاستبيان مغلق"
        body="هذا الاستبيان لا يستقبل إجابات حالياً. تواصل مع مديرية التخطيط والإحصاء إن كنت تظن أن هذا خطأ.">
        <Outbox surveyId={surveyId} online={online} />
      </Message>
    );
  }

  if (state.status === 'expired') {
    return (
      <Message title="انتهت مدة التعبئة"
        body="أُغلق هذا الاستبيان في موعده المحدد ولم يعد يستقبل إجابات." />
    );
  }

  if (state.needsPassword && !definition) {
    const submit = async () => {
      if (!attempt) return;
      setChecking(true);
      const def = await unlockSurvey(surveyId, attempt);
      setChecking(false);
      if (def) {
        setDefinition(def);
        setPassword(attempt);
        setWrong(false);
        /* يُحفظ مع كلمة المرور ليعمل بلا شبكة لاحقاً — على هذا الجهاز وحده */
        cacheSurvey(surveyId, { state, definition: def, password: attempt });
      } else {
        setWrong(true);
      }
    };

    return (
      <Shell>
        <div className="gate">
          <Icon name="lock" className="gate__icon" />
          <h1>{state.survey.title}</h1>
          <p className="gate__lede">هذا الاستبيان محمي. أدخل كلمة المرور التي وصلتك للمتابعة.</p>
          <div className="gate__row">
            <input className={`q-input gate__input${wrong ? ' is-bad' : ''}`} type="password"
              value={attempt} autoFocus placeholder="كلمة المرور"
              onChange={(e) => { setAttempt(e.target.value); setWrong(false); }}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <button type="button" className="survey__navbtn survey__navbtn--primary"
              onClick={submit} disabled={checking}>
              {checking ? 'جارٍ التحقق…' : 'دخول'}
            </button>
          </div>
          {wrong && <p className="gate__err">كلمة المرور غير صحيحة. تحقق منها وحاول مجدداً.</p>}
        </div>
      </Shell>
    );
  }

  if (!definition) return <Message title="جارٍ التحميل" body="لحظة من فضلك." />;

  if (done) {
    const queued = done === 'queued';
    return (
      <Shell>
        <div className="fillpage__msg">
          <Icon name={queued ? 'lock' : 'check'} className={`fillpage__icon${queued ? '' : ' fillpage__icon--ok'}`} />
          <h1>{queued ? 'حُفظت على هذا الجهاز' : 'وصلت إجابتك'}</h1>
          <p>
            {queued
              ? (online ? 'تعذّر الوصول إلى السيرفر الآن، فحُفظت الاستمارة على الهاتف. ستُعاد المحاولة تلقائياً كل دقيقة — أبقِ الصفحة مفتوحة أو افتح الرابط لاحقاً.' : 'لا يوجد اتصال الآن، فحُفظت الاستمارة على الهاتف. ستُرسل تلقائياً عند عودة الشبكة — افتح هذا الرابط حينها إن أغلقته.')
              : 'شكراً لك. ستُراجع البيانات قبل اعتمادها.'}
          </p>
          <Outbox surveyId={surveyId} online={online} />
          <button type="button" className="survey__navbtn survey__navbtn--primary"
            onClick={() => { setDone(null); startFill(null); }}>
            تعبئة استمارة أخرى
          </button>
        </div>
      </Shell>
    );
  }

  if (state.publicLink && !respondent) {
    return <NameGate title={state.survey?.title || definition?.title || 'استمارة'} onDone={setRespondent} />;
  }

  const ready = Boolean(cachedSurvey(surveyId)) && typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller);

  return (
    <div className="fillpage">
      <div className="shell fillpage__top">
        {state.projectName && <span className="fillpage__crumb">{state.projectName}</span>}
        {state.publicLink && respondent && (
          <span className="fillpage__who">
            <Icon name="staff" className="fillpage__whoicon" />{respondent}
            <button type="button" onClick={() => setRespondent('')}>تغيير</button>
          </span>
        )}
        {ready && online && <span className="fillpage__ready">✓ جاهزة للعمل بلا إنترنت</span>}
        {who && (
          <span className="fillpage__who">
            <Icon name="staff" className="fillpage__whoicon" />{who}
            <button type="button" onClick={logout}>خروج</button>
          </span>
        )}
        <span className={`fillpage__net${online ? '' : ' is-off'}`}>
          {online ? 'متصل' : 'بلا اتصال — تُحفظ الاستمارة على الجهاز'}
        </span>
      </div>
      <div className="shell"><Outbox surveyId={surveyId} online={online} /><SentList surveyId={surveyId} online={online} /></div>
      {sendError && <div className="shell"><p className="share__warn">{sendError}</p></div>}
      {savedNote && <div className="shell"><p className="drafts__saved">{savedNote}</p></div>}
      <div className="shell">
        <DraftList list={draftList.filter((d) => d.id !== draftId.current)} onOpen={(d) => { setSavedNote(''); startFill(d); }}
          onRemove={async (id) => { await drafts.removeDraft(id); refreshDrafts(); }} />
      </div>
      <SurveyPage
        key={fillKey}
        definition={definition}
        submitLabel="إرسال الإجابة"
        hideReview
        draft={openDraft}
        onDraftChange={storeDraft}
        onSaveLater={async (snap) => {
          await storeDraft(snap);
          setSavedNote(draftId.current ? 'حُفظت المسودة على هذا الجهاز. تجدها في «المسودات المحفوظة» لتتابعها متى شئت.' : 'لا شيء لحفظه بعد.');
          startFill(null);
        }}
        onSubmit={async (answers, timing) => {
          setSendError('');
          const clientId = outbox.newClientId();
          rememberSent(surveyId, clientId);
          const meta = { ...timing, device: outbox.deviceLabel(), ...(state.publicLink ? { respondent } : {}) };
          try {
            await createResponse(surveyId, answers, { source: 'link', password, meta, clientId, token });
            await dropCurrentDraft();
            setDone('sent');
          } catch (err) {
            if (outbox.isNetworkError(err) || err.auth || err.retry) {
              /* بلا شبكة: نحفظ على الجهاز بنفس المعرّف، فإعادة الإرسال لا تكرر */
              await outbox.enqueue({
                clientId, surveyId, answers, password, token,
                meta: { ...meta, offline: true, queuedAt: new Date().toISOString() },
              });
              if (err.auth) { setState({ status: 'login', survey: { title: definition.title } }); return; }
              await dropCurrentDraft();
              setDone('queued');
            } else {
              setSendError(`${err.message}. إجاباتك ما زالت هنا — حاول الإرسال مجدداً.`);
              throw err;
            }
          }
          window.scrollTo(0, 0);
        }}
      />
    </div>
  );
}
