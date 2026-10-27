import { useEffect, useState } from 'react';
import ScreenDeck from './ScreenDeck';
import './screen.css';

/*
  صفحة الشاشات العامة: #/screen
  تُفتح على شاشات مبنى الوزارة دون تسجيل دخول.
  تُحدّث بياناتها وإعداداتها كل دقيقتين، فأي تغيير من لوحة الإدارة
  يصل إلى كل الشاشات تلقائياً دون لمسها.
*/
const REFRESH = 2 * 60 * 1000;

export default function ScreenPage() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = 'شاشات العرض — وزارة الطوارئ وإدارة الكوارث';
    document.documentElement.classList.add('sx-root');
    let alive = true;
    const load = () => fetch('api/screen', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (alive) { setData(d); setFailed(false); } })
      /* عند انقطاع الشبكة تبقى آخر شرائح معروضة */
      .catch(() => { if (alive) setFailed(true); });
    load();
    const t = setInterval(load, REFRESH);
    /* إعادة تحميل كاملة كل ست ساعات: تلتقط أي نسخة جديدة من الموقع */
    const r = setTimeout(() => window.location.reload(), 6 * 60 * 60 * 1000);
    return () => { alive = false; clearInterval(t); clearTimeout(r); document.documentElement.classList.remove('sx-root'); };
  }, []);

  /* إبقاء الشاشة مضاءة حيث يدعم المتصفح ذلك */
  useEffect(() => {
    let lock;
    const ask = () => navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    ask();
    const onVis = () => { if (document.visibilityState === 'visible') ask(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.(); };
  }, []);

  const full = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="sx-page" onDoubleClick={full}>
      <ScreenDeck data={data} />
      {failed && !data && <p className="sx-offline">تعذّر الاتصال بالمنصة. ستُعاد المحاولة تلقائياً.</p>}
    </div>
  );
}
