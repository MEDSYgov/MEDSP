import { useEffect, useState } from 'react';
import * as store from '../projects/store';
import Icon from '../components/Icon';

/*
  بوابة الدخول لمساحة العمل.

  لا تسجيل ذاتي: الحسابات يُنشئها السوبر أدمن فقط.
  الحماية الحقيقية في قاعدة البيانات (RLS) — تجاوز هذه الشاشة
  لا يمنح قراءة أو كتابة أي صف.
*/

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (!username || !password) { setError('أدخل اسم المستخدم وكلمة المرور'); return; }
    setBusy(true);
    try {
      await store.signIn(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__card">
        <Icon name="lock" className="auth__icon" />
        <h1>الدخول إلى المنصة</h1>
        <p className="auth__lede">المنصة متاحة للحسابات المعتمدة فقط. ما تراه بعد الدخول يتبع صلاحيات حسابك.</p>

        <label className="bf">
          <span className="bf__label">اسم المستخدم</span>
          <input className="q-input bf__input" dir="ltr" value={username}
            autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
            onChange={(e) => setUsername(e.target.value)} />
        </label>

        <label className="bf">
          <span className="bf__label">كلمة المرور</span>
          <input className="q-input bf__input" type="password" dir="ltr" value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>

        {error && <p className="auth__err">{error}</p>}

        <button type="button" className="survey__navbtn survey__navbtn--primary auth__submit"
          onClick={submit} disabled={busy}>
          {busy ? 'لحظة…' : 'دخول'}
        </button>

        <p className="auth__note">لا تملك حساباً؟ يُنشئه لك مدير المنصة.</p>
      </div>
    </div>
  );
}

/*
  guest: صفحة تُعرض للزائر بلا تسجيل دخول (النظرة العامة فقط، بطلب من المدير).
  إن لم تُمرَّر، يظهر نموذج الدخول كالمعتاد.
*/
export default function AuthGate({ children, wrap = (n) => n, guest }) {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(undefined);

  useEffect(() => {
    store.getSession().then(setSession);
    return store.onAuthChange(setSession);
  }, []);

  /*
    نعيد جلب الدور فقط عند تغيّر المستخدم نفسه — لا عند كل حدث جلسة.
    Supabase يجدّد الجلسة تلقائياً كل ساعة ويطلق حدثاً عند تغيير كلمة
    المرور؛ لو أعدنا الجلب عندها لهُدمت مساحة العمل وضاع أي عمل غير
    محفوظ في الباني.
  */
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) { setMe(undefined); return; }
    let alive = true;
    store.getMyRole().then((r) => { if (alive) setMe(r); });
    return () => { alive = false; };
  }, [userId]);

  if (session === undefined || (session && me === undefined)) {
    return wrap(<div className="auth"><p className="auth__lede">جارٍ التحقق…</p></div>);
  }

  if (!session) return guest ? guest() : wrap(<LoginForm />);

  /* حساب موجود في المصادقة لكن بلا دور — لا يصل لشيء */
  if (!me) {
    return wrap(
      <div className="auth">
        <div className="auth__card">
          <Icon name="lock" className="auth__icon" />
          <h1>لا صلاحية لهذا الحساب</h1>
          <p className="auth__lede">هذا الحساب لا يملك دوراً في المنصة. تواصل مع مدير المنصة.</p>
          <button type="button" className="q-btn" onClick={store.signOut}>تسجيل الخروج</button>
        </div>
      </div>
    );
  }

  return children({ me, signOut: store.signOut });
}
