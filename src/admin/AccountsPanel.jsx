import { useCallback, useEffect, useState } from 'react';
import * as store from '../projects/store';
import Dropdown from '../components/Dropdown';
import { getData } from '../data/api';

/*
  إدارة الحسابات — تظهر للسوبر أدمن فقط.
  وحتى لو ظهرت لغيره، الدوال على الخادم ترفض أي طلب من غير السوبر أدمن.
*/

const ROLE = { super_admin: 'المدير العام', admin: 'مدير المنصة', viewer: 'مشاهد', reviewer: 'مراجع استبيان', collector: 'جامع بيانات' };
const ROLE_HINT = {
  admin: 'يدير المشاريع والاستبيانات والبيانات والتقارير، دون إدارة الحسابات.',
  viewer: 'يشاهد الأرقام فقط. اترك الأقسام كلها لمشاهدة كاملة، أو اختر أقساماً محددة.',
  reviewer: 'يشاهد الأقسام المحددة، ويراجع الاستبيانات المسندة إليه ويعتمد إجاباتها.',
  collector: 'لا يرى الأرقام؛ يعبّئ الاستبيانات المسندة إليه فقط.',
};
const SECTIONS = [['ops', 'النظرة العامة والعمليات والخرائط'], ['monthly', 'التقرير الشهري'], ['rubble', 'إدارة الأنقاض'], ['projects', 'المشاريع']];

/* الدور والنطاق: الأقسام، المحافظات، الاستبيانات المسندة */
function AccessFields({ value, onChange, govs, surveys }) {
  const v = value;
  const set = (k, x) => onChange({ ...v, [k]: x });
  const showSections = v.role === 'viewer' || v.role === 'reviewer';
  const showSurveys = v.role === 'reviewer' || v.role === 'collector';
  return (
    <div className="acc">
      <label className="bf">
        <span className="bf__label">المستوى</span>
        <select className="q-input bf__input" value={v.role} onChange={(e) => set('role', e.target.value)}>
          {['viewer', 'reviewer', 'collector', 'admin'].map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
        </select>
        <span className="bf__hint">{ROLE_HINT[v.role]}</span>
      </label>
      {showSections && (
        <fieldset className="acc__secs">
          <legend className="bf__label">الأقسام التي يراها <small>(بلا اختيار = كل الأقسام)</small></legend>
          {SECTIONS.map(([k, l]) => (
            <label key={k} className="acc__chk">
              <input type="checkbox" checked={v.sections.includes(k)}
                onChange={(e) => set('sections', e.target.checked ? [...v.sections, k] : v.sections.filter((x) => x !== k))} />
              {l}
            </label>
          ))}
        </fieldset>
      )}
      {v.role !== 'admin' && (
        <div className="bf">
          <span className="bf__label">المحافظات <small>(بلا اختيار = كل المحافظات)</small></span>
          <Dropdown multi label="المحافظات" placeholder="كل المحافظات" value={v.govs} onChange={(x) => set('govs', x)}
            options={govs.map((g) => ({ value: g.code, label: g.name }))} />
        </div>
      )}
      {showSurveys && (
        <div className="bf">
          <span className="bf__label">الاستبيانات المسندة</span>
          <Dropdown multi label="الاستبيانات" placeholder="اختر استبياناً أو أكثر" value={v.surveys} onChange={(x) => set('surveys', x)}
            options={surveys.map((x) => ({ value: x.id, label: `${x.title} — ${x.project}` }))} />
        </div>
      )}
    </div>
  );
}

const scopeText = (acc, govs, surveys) => {
  if (acc.role === 'super_admin' || acc.role === 'admin') return 'كل شيء';
  const parts = [];
  if (acc.role !== 'collector') parts.push(acc.sections.length ? acc.sections.map((k) => SECTIONS.find((x) => x[0] === k)?.[1] || k).join('، ') : 'كل الأقسام');
  parts.push(acc.govs.length ? acc.govs.map((c) => govs.find((g) => g.code === c)?.name || c).join('، ') : 'كل المحافظات');
  if (acc.surveys.length) parts.push(`${acc.surveys.length} استبيان`);
  return parts.join(' · ');
};

/* كلمة مرور مؤقتة مقروءة: بلا أحرف متشابهة (0/O، 1/l/I) */
function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (b) => chars[b % chars.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

function Credential({ username, password, onDone }) {
  const [copied, setCopied] = useState(false);
  const text = `اسم المستخدم: ${username}\nكلمة المرور: ${password}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* يُنسخ يدوياً */ }
  };
  return (
    <div className="cred">
      <strong className="cred__title">احفظ بيانات الدخول الآن</strong>
      <p className="cred__lede">
        كلمة المرور تُخزَّن مشفّرة ولن تظهر مرة أخرى. أرسلها للمشرف بطريقة آمنة.
      </p>
      <dl className="cred__pair">
        <dt>اسم المستخدم</dt><dd dir="ltr">{username}</dd>
        <dt>كلمة المرور</dt><dd dir="ltr">{password}</dd>
      </dl>
      <div className="cred__actions">
        <button type="button" className="q-btn" onClick={copy}>{copied ? 'نُسخت' : 'نسخ البيانات'}</button>
        <button type="button" className="survey__navbtn survey__navbtn--primary" onClick={onDone}>
          حفظتها
        </button>
      </div>
    </div>
  );
}

export default function AccountsPanel({ me }) {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [access, setAccess] = useState({ role: 'viewer', sections: [], govs: [], surveys: [] });
  const [editing, setEditing] = useState(null);
  const [govs, setGovs] = useState([]);
  const [surveys, setSurveys] = useState([]);
  useEffect(() => {
    getData('basemap').then((b) => setGovs([...b.governorates].sort((a, c) => a.name.localeCompare(c.name, 'ar')))).catch(() => {});
    store.listSurveyTitles().then(setSurveys).catch(() => {});
  }, []);
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setAccounts(await store.listAccounts()); setError(''); }
    catch (err) { setError(err.message); setAccounts([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openForm = () => {
    setForm({ username: '', displayName: '', password: generatePassword() });
    setAccess({ role: 'viewer', sections: [], govs: [], surveys: [] });
    setAdding(true);
    setError('');
  };

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await store.createAccount({ ...form, ...access });
      setIssued({ username: form.username.trim().toLowerCase(), password: form.password });
      setAdding(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (acc) => {
    const pw = generatePassword();
    if (!window.confirm(`إعادة تعيين كلمة مرور ${acc.displayName}؟ ستتوقف كلمته الحالية فوراً.`)) return;
    try {
      await store.resetAccountPassword(acc.id, pw);
      setIssued({ username: acc.username, password: pw });
    } catch (err) { setError(err.message); }
  };

  const remove = async (acc) => {
    if (!window.confirm(`حذف حساب ${acc.displayName} نهائياً؟ لن يستطيع الدخول بعدها. البيانات التي أنشأها تبقى.`)) return;
    try { await store.deleteAccount(acc.id); await load(); } catch (err) { setError(err.message); }
  };

  return (
    <div className="accounts">
      <div className="plist__head">
        <div>
          <h2>الحسابات</h2>
          <p className="accounts__lede">لا يرى أحد المنصة إلا بحساب. لكل حساب مستوى ونطاق: الأقسام، والمحافظات، والاستبيانات المسندة.</p>
        </div>
        {!adding && !issued && (
          <button type="button" className="survey__navbtn survey__navbtn--primary" onClick={openForm}>
            + حساب جديد
          </button>
        )}
      </div>

      {error && <p className="share__warn">{error}</p>}

      {issued && <Credential {...issued} onDone={() => setIssued(null)} />}

      {adding && (
        <div className="accounts__form">
          <div className="bf__row">
            <label className="bf">
              <span className="bf__label">الاسم الظاهر</span>
              <input className="q-input bf__input" value={form.displayName} autoFocus
                placeholder="مثال: أحمد العلي"
                onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </label>
            <label className="bf">
              <span className="bf__label">اسم المستخدم</span>
              <input className="q-input bf__input" dir="ltr" value={form.username}
                placeholder="ahmad.ali" autoCapitalize="none" spellCheck={false}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })} />
              <span className="bf__hint">أحرف إنجليزية صغيرة وأرقام و . _ -</span>
            </label>
          </div>
          <label className="bf">
            <span className="bf__label">كلمة المرور</span>
            <div className="share__row">
              <input className="q-input bf__input" dir="ltr" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" className="q-btn q-btn--sm"
                onClick={() => setForm({ ...form, password: generatePassword() })}>توليد</button>
            </div>
            <span className="bf__hint">مولّدة عشوائياً. يستطيع المشرف تغييرها بعد دخوله.</span>
          </label>
          <AccessFields value={access} onChange={setAccess} govs={govs} surveys={surveys} />
          <div className="pedit__save">
            <button type="button" className="survey__navbtn survey__navbtn--primary"
              onClick={create} disabled={busy || !form.username || form.password.length < 8}>
              {busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}
            </button>
            <button type="button" className="q-btn" onClick={() => setAdding(false)}>إلغاء</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="accounts__form">
          <h3 className="acc__title">صلاحيات {editing.name}</h3>
          <AccessFields value={editing} onChange={setEditing} govs={govs} surveys={surveys} />
          <div className="pedit__save">
            <button type="button" className="survey__navbtn survey__navbtn--primary" disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await store.updateAccountAccess(editing.id, editing); setEditing(null); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
              }}>حفظ الصلاحيات</button>
            <button type="button" className="q-btn" onClick={() => setEditing(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {accounts === null ? (
        <p className="results__empty">جارٍ التحميل…</p>
      ) : (
        <div className="results__scroll">
          <table className="results__table">
            <thead>
              <tr>
                <th>الاسم</th><th>اسم المستخدم</th><th>المستوى</th><th>النطاق</th>
                <th>أُنشئ</th><th>آخر دخول</th><th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => {
                const self = acc.username === me.username;
                const isSuper = acc.role === 'super_admin';
                return (
                  <tr key={acc.id}>
                    <td>{acc.displayName}{self && <span className="accounts__you">أنت</span>}</td>
                    <td dir="ltr" className="results__date">{acc.username}</td>
                    <td><span className={`tag${isSuper ? ' tag--pending' : ''}`}>{ROLE[acc.role]}</span></td>
                    <td className="accounts__scope">{scopeText(acc, govs, surveys)}</td>
                    <td className="results__date">{fmtDate(acc.createdAt)}</td>
                    <td className="results__date">{acc.lastSignIn ? fmtDate(acc.lastSignIn) : 'لم يدخل بعد'}</td>
                    <td>
                      {!isSuper && (
                        <span className="accounts__acts">
                          <button type="button" className="q-btn q-btn--sm"
                            onClick={() => setEditing({ id: acc.id, name: acc.displayName, role: acc.role, sections: acc.sections, govs: acc.govs, surveys: acc.surveys })}>
                            الصلاحيات
                          </button>
                          <button type="button" className="q-btn q-btn--sm" onClick={() => reset(acc)}>
                            كلمة مرور جديدة
                          </button>
                          <button type="button" className="q-btn q-btn--sm q-btn--danger" onClick={() => remove(acc)}>
                            حذف
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
