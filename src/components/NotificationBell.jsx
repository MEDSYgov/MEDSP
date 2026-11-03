import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { supabase } from '../projects/supabase';
import { VAPID_PUBLIC_KEY } from '../config';

/*
  جرس الإشعارات — لحسابات المدير العام ومدير المنصة فقط (الجدول محمي بـ RLS).
  «غير المقروء» يُحسب من آخر فتح للجرس على هذا الجهاز.
  ومن القائمة يُفعَّل إشعار الدفع على الجهاز (يصل والمنصة مغلقة).
*/
const SEEN = 'medsp-notif-seen';
const fmtDate = (d) => new Date(d).toLocaleString('ar-SY-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const keyBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;

export default function NotificationBell() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => { try { return Number(localStorage.getItem(SEEN)) || 0; } catch { return 0; } });
  const [push, setPush] = useState('checking');
  const box = useRef(null);

  const load = () => supabase.from('notifications').select('id,title,body,link,created_at')
    .order('created_at', { ascending: false }).limit(20)
    .then(({ data }) => setList(data || []));

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || !pushSupported()) { setPush('unsupported'); return; }
    if (Notification.permission === 'denied') { setPush('denied'); return; }
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setPush(sub ? 'on' : 'off')).catch(() => setPush('off'));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const unread = list.filter((n) => new Date(n.created_at).getTime() > seen).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && list[0]) {
      const t = new Date(list[0].created_at).getTime();
      setSeen((s) => { const v = Math.max(s, t); try { localStorage.setItem(SEEN, String(v)); } catch { /* */ } return v; });
    }
  };

  const enablePush = async () => {
    setPush('working');
    try {
      if (await Notification.requestPermission() !== 'granted') { setPush('denied'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error } = await supabase.from('push_subscriptions')
        .upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
      if (error) throw error;
      setPush('on');
    } catch (e) {
      console.error('[MEDSP push]', e);
      setPush('error');
    }
  };

  const disablePush = async () => {
    setPush('working');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setPush('off');
    } catch { setPush('error'); }
  };

  const pushRow = () => {
    if (push === 'checking') return null;
    if (push === 'unsupported') {
      if (VAPID_PUBLIC_KEY && isIOS() && !standalone()) {
        return <p className="nbell__hint">لتصلك الإشعارات على آيفون: افتح المنصة من Safari ← زر المشاركة ← «إضافة إلى الشاشة الرئيسية»، ثم افتحها من الأيقونة وفعّل الإشعارات.</p>;
      }
      return VAPID_PUBLIC_KEY ? <p className="nbell__hint">هذا المتصفح لا يدعم إشعارات الدفع.</p> : null;
    }
    if (push === 'denied') return <p className="nbell__hint">الإشعارات محظورة لهذا الموقع في إعدادات المتصفح. اسمح بها من إعدادات الموقع ثم أعد المحاولة.</p>;
    return (
      <div className="nbell__push">
        <span>{push === 'on' ? 'إشعارات الجهاز مفعّلة' : 'تلقَّ الإشعارات على هذا الجهاز حتى والمنصة مغلقة'}</span>
        <button type="button" disabled={push === 'working'} onClick={push === 'on' ? disablePush : enablePush}>
          {push === 'working' ? '…' : push === 'on' ? 'إيقاف' : 'تفعيل'}
        </button>
        {push === 'error' && <small>تعذّر التفعيل، حاول مجدداً.</small>}
      </div>
    );
  };

  return (
    <div className="nbell" ref={box}>
      <button type="button" className="theme-toggle nbell__btn" onClick={toggle} aria-expanded={open}
        aria-label={unread ? `الإشعارات، ${unread} جديد` : 'الإشعارات'} title="الإشعارات">
        <Icon name="bell" className="theme-toggle__icon" />
        {unread > 0 && <b className="nbell__count">{unread > 9 ? '9+' : unread}</b>}
      </button>
      {open && (
        <div className="nbell__panel" role="dialog" aria-label="الإشعارات">
          <header className="nbell__head">الإشعارات</header>
          {pushRow()}
          <ul className="nbell__list">
            {list.map((n) => (
              <li key={n.id} className={new Date(n.created_at).getTime() > seen ? 'is-new' : ''}>
                <a href={n.link || '#/'} onClick={() => setOpen(false)}>
                  <b>{n.title}</b>
                  {n.body && <span>{n.body}</span>}
                  <time dateTime={n.created_at}>{fmtDate(n.created_at)}</time>
                </a>
              </li>
            ))}
            {list.length === 0 && <li className="nbell__empty">لا إشعارات بعد. سيصلك إشعار هنا عند كل تحديث للبيانات.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
