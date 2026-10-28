import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../projects/supabase';
import { SLIDES, OPS, GOVS, normalizeConfig } from '../../server/screenCatalog.js';
import ScreenDeck from '../screen/ScreenDeck';
import '../screen/screen.css';

/*
  إدارة شاشات العرض (للمدير العام ومدير المنصة).
  - تفعيل الشرائح وإخفاؤها وترتيبها ومدة كل منها.
  - إخفاء تصنيفات أو محافظات من الأرقام المعروضة.
  - رسالة حرة، وإيقاف كل الشاشات مؤقتاً.
  المعاينة تعرض ما ستعرضه الشاشات بالضبط، قبل الحفظ.
  بعد الحفظ تلتقط الشاشات التغيير خلال دقيقتين تقريباً.
*/

const META = Object.fromEntries(SLIDES.map((s) => [s.id, s]));

function Chips({ all, off, onToggle }) {
  return (
    <div className="ent-chips">
      {all.map(([key, label]) => (
        <button type="button" key={key} className={off.includes(key) ? '' : 'is-on'} onClick={() => onToggle(key)}>{label}</button>
      ))}
    </div>
  );
}

export default function ScreenPanel() {
  const [saved, setSaved] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const timer = useRef();

  useEffect(() => {
    supabase.rpc('screen_config').then(({ data, error }) => {
      if (error) { setErr('تعذّر تحميل الإعدادات. تأكد من تطبيق تعديل قاعدة البيانات الخاص بالشاشات.'); return; }
      const c = normalizeConfig(data);
      setSaved(c); setCfg(c);
    });
  }, []);

  /* معاينة حية: تُطلب من الخادم بعد توقف التعديل بنصف ثانية */
  useEffect(() => {
    if (!cfg) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      const r = await fetch('api/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
        body: JSON.stringify(cfg),
      }).catch(() => null);
      if (r?.ok) setPreview(await r.json());
    }, 500);
    return () => clearTimeout(timer.current);
  }, [cfg]);

  const dirty = useMemo(() => cfg && saved && JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved]);
  if (err) return <div className="pending"><p>{err}</p></div>;
  if (!cfg) return <div className="pending"><p>جارٍ التحميل…</p></div>;

  const set = (patch) => { setNote(''); setCfg((c) => ({ ...c, ...patch })); };
  const toggleSlide = (id) => set({ slides: cfg.slides.map((s) => (s.id === id ? { ...s, on: !s.on } : s)) });
  const move = (i, d) => {
    const j = i + d; if (j < 0 || j >= cfg.slides.length) return;
    const list = [...cfg.slides]; [list[i], list[j]] = [list[j], list[i]]; set({ slides: list });
  };
  const flip = (key, val) => set({ [key]: cfg[key].includes(val) ? cfg[key].filter((x) => x !== val) : [...cfg[key], val] });

  const save = async () => {
    setBusy(true); setNote('');
    const { error } = await supabase.rpc('save_screen_config', { p_config: cfg });
    setBusy(false);
    if (error) { setNote(error.message || 'تعذّر الحفظ'); return; }
    setSaved(cfg); setNote('حُفظ. ستظهر التغييرات على الشاشات خلال دقيقتين تقريباً.');
  };

  const onCount = cfg.slides.filter((s) => s.on).length;
  const link = `${window.location.origin}${window.location.pathname}#/screen`;

  return (
    <div className="scr">
      <header className="scr__head">
        <div>
          <h2>شاشات العرض</h2>
          <p>ما يظهر على شاشات مبنى الوزارة. الصفحة عامة، ولا تعرض إلا ما تفعّله هنا، وأرقاماً مجمّعة فقط.</p>
        </div>
        <div className="scr__link">
          <span>رابط الشاشات</span>
          <bdi dir="ltr">{link}</bdi>
          <div className="scr__linkbtns">
            <button type="button" className="q-btn q-btn--sm" onClick={() => navigator.clipboard?.writeText(link)}>نسخ</button>
            <a className="q-btn q-btn--sm" href="#/screen" target="_blank" rel="noreferrer">فتح</a>
          </div>
        </div>
      </header>

      <div className="scr__grid">
        <div className="scr__controls">
          <section className="scr__box">
            <div className="scr__row">
              <h3>الحالة</h3>
              <label className="scr__switch">
                <input type="checkbox" checked={!cfg.paused} onChange={() => set({ paused: !cfg.paused })} />
                <span>{cfg.paused ? 'الشاشات متوقفة (يظهر الشعار فقط)' : 'الشاشات تعمل'}</span>
              </label>
            </div>
            <div className="scr__row">
              <h3>مدة كل شريحة</h3>
              <div className="scr__interval">
                {[10, 15, 20, 30].map((n) => (
                  <button key={n} type="button" className={cfg.interval === n ? 'is-on' : ''} onClick={() => set({ interval: n })}>
                    <bdi dir="ltr">{n}</bdi> ث
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="scr__box">
            <h3>الشرائح <small>{onCount} مفعّلة من {cfg.slides.length} · بالترتيب الذي تظهر به</small></h3>
            <ol className="scr__slides">
              {cfg.slides.map((s, i) => (
                <li key={s.id} className={s.on ? 'is-on' : ''}>
                  <label className="scr__switch">
                    <input type="checkbox" checked={s.on} onChange={() => toggleSlide(s.id)} />
                    <span>
                      <strong>{META[s.id].title}</strong>
                      <small>{META[s.id].group} · {META[s.id].hint}</small>
                    </span>
                  </label>
                  <span className="scr__order">
                    <button type="button" aria-label="أعلى" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                    <button type="button" aria-label="أسفل" disabled={i === cfg.slides.length - 1} onClick={() => move(i, 1)}>▼</button>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {cfg.slides.find((s) => s.id === 'message')?.on && (
            <section className="scr__box">
              <h3>نص الرسالة</h3>
              <label className="scr__field"><span>العنوان</span>
                <input className="q-input" maxLength={120} value={cfg.message.title} onChange={(e) => set({ message: { ...cfg.message, title: e.target.value } })} />
              </label>
              <label className="scr__field"><span>النص</span>
                <textarea className="q-input" rows={3} maxLength={600} value={cfg.message.text} onChange={(e) => set({ message: { ...cfg.message, text: e.target.value } })} />
              </label>
            </section>
          )}

          <section className="scr__box">
            <h3>تصنيفات العمليات الظاهرة <small>اضغط لإخفاء تصنيف من كل شرائح العمليات</small></h3>
            <Chips all={OPS.map((o) => [o.op, o.name])} off={cfg.hiddenOps} onToggle={(k) => flip('hiddenOps', k)} />
            <h3 className="scr__gap">المحافظات الظاهرة <small>تنطبق على شرائح المحافظات والأنقاض</small></h3>
            <Chips all={GOVS.map((g) => [g, g])} off={cfg.hiddenGovs} onToggle={(k) => flip('hiddenGovs', k)} />
          </section>
        </div>

        <aside className="scr__preview">
          <div className="scr__sticky">
            <h3>معاينة <small>{dirty ? 'تعديلات غير محفوظة' : 'مطابقة لما على الشاشات الآن'}</small></h3>
            <ScreenDeck data={preview} preview />
            <div className="scr__save">
              <button type="button" className="survey__navbtn survey__navbtn--primary" disabled={!dirty || busy} onClick={save}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ ونشر على الشاشات'}
              </button>
              {dirty && <button type="button" className="q-btn" onClick={() => { setCfg(saved); setNote(''); }}>تراجع</button>}
            </div>
            {note && <p className="scr__note">{note}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
