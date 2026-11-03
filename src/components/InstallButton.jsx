import { useEffect, useState } from 'react';

/*
  زر «تثبيت التطبيق» داخل المنصة.
  كروم وإيدج (أندرويد والحاسوب): يلتقط طلب التثبيت فيظهر الزر، والضغط يفتح نافذة التثبيت.
  آيفون/آيباد: لا يدعم Safari التثبيت البرمجي، فيعرض الزر خطوات «إضافة إلى الشاشة الرئيسية».
  لا يظهر إن كانت المنصة مثبّتة ومفتوحة كتطبيق.
*/
let deferred = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; window.dispatchEvent(new Event('medsp-installable')); });
}
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function InstallButton() {
  const [can, setCan] = useState(() => !!deferred);
  const [help, setHelp] = useState(false);
  const [done, setDone] = useState(() => standalone());

  useEffect(() => {
    const on = () => setCan(true);
    const installed = () => { setDone(true); deferred = null; };
    window.addEventListener('medsp-installable', on);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('medsp-installable', on); window.removeEventListener('appinstalled', installed); };
  }, []);

  if (done || (!can && !isIOS())) return null;

  const install = async () => {
    if (!deferred) { setHelp((h) => !h); return; }
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null; setCan(false);
    if (outcome === 'accepted') setDone(true);
  };

  return (
    <div className="nbell">
      <button type="button" className="masthead__login" onClick={install}>تثبيت<span className="ib-long"> التطبيق</span></button>
      {help && (
        <div className="nbell__panel" role="dialog" aria-label="تثبيت التطبيق">
          <header className="nbell__head">تثبيت المنصة على آيفون</header>
          <p className="nbell__hint">1. افتح المنصة في متصفح Safari.<br />2. اضغط زر المشاركة (المربع والسهم).<br />3. اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة».<br />بعدها افتح المنصة من أيقونتها.</p>
        </div>
      )}
    </div>
  );
}
