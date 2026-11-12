import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';

/*
  التقاط إحداثيات عبر GPS الجهاز.

  ملاحظة سيادة البيانات: لا نستخدم أي خدمة تحديد مواقع خارجية ولا
  خرائط طرف ثالث — نقرأ من مستشعر الجهاز مباشرة عبر واجهة المتصفح
  القياسية، ونعرض النتيجة رقمياً. هذا يتسق مع قرار المنصة بعدم
  الاعتماد على خدمات خرائط خارجية.
*/

const fmt = (n) => Number(n).toFixed(5);
const GeoMapPicker = lazy(() => import('./GeoMapPicker'));

/* نص الإحداثيات: «33.51, 36.29» أو بفاصلة عربية أو مسافة. يُصحَّح تبديل الخطين تلقائياً. */
const IN_SYRIA = (lat, lng) => lat >= 32.2 && lat <= 37.4 && lng >= 35.5 && lng <= 42.5;
function parseCoords(lat, lng) {
  const a = Number(String(lat).replace(/[٫،,]/g, '.').trim());
  const b = Number(String(lng).replace(/[٫،,]/g, '.').trim());
  if (!Number.isFinite(a) || !Number.isFinite(b) || !String(lat).trim() || !String(lng).trim()) return { error: 'اكتب خطّي العرض والطول بالأرقام' };
  if (IN_SYRIA(a, b)) return { lat: a, lng: b };
  if (IN_SYRIA(b, a)) return { lat: b, lng: a };
  return { error: 'الإحداثيات خارج سوريا — تأكد من الأرقام (مثال: خط العرض 35.93، خط الطول 36.63)' };
}

export default function GeoPointField({ node, value, onChange }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [mode, setMode] = useState(null); /* null | 'manual' | 'map' */
  const [mLat, setMLat] = useState('');
  const [mLng, setMLng] = useState('');
  const saveManual = () => {
    const r = parseCoords(mLat, mLng);
    if (r.error) { setError(r.error); return; }
    setError('');
    onChange({ lat: Number(r.lat.toFixed(6)), lng: Number(r.lng.toFixed(6)), accuracy: null, source: 'manual', at: new Date().toISOString() });
    setMode(null);
  };

  /*
    تحديد الموقع بلا أي مهلة: يبقى الجهاز يبحث عن الإشارة حتى يجدها، ويحسّن الدقة
    باستمرار (تُحدَّث النقطة مع كل قراءة أدق)، ويتوقف تلقائياً عند دقة جيدة
    أو حين يضغط المستخدم «إيقاف». لا تظهر رسالة «انتهت المهلة» أبداً.
  */
  const watch = useRef(null);
  const best = useRef(null);
  const stopWatch = () => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  };
  useEffect(() => stopWatch, []);

  const capture = () => {
    if (!navigator.geolocation) {
      setError('هذا الجهاز لا يدعم تحديد الموقع');
      setStatus('error');
      return;
    }
    stopWatch();
    best.current = null;
    setStatus('busy');
    setError('');
    setMode(null);
    const target = node.minAccuracy || 20;
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, altitude } = pos.coords;
        const acc = accuracy ? Math.round(accuracy) : null;
        if (best.current && acc != null && best.current.accuracy != null && acc > best.current.accuracy) return;
        best.current = {
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
          accuracy: acc,
          source: 'gps',
          altitude: altitude != null ? Math.round(altitude) : null,
          at: new Date().toISOString(),
        };
        onChange(best.current);
        setError('');
        if (acc != null && acc <= target) { stopWatch(); setStatus('ready'); }
      },
      (err) => {
        /*
          لا مهلة ولا توقف: «لا إشارة الآن» (2) أو انتهاء مهلة داخلية (3) مؤقتان في الميدان،
          فيستمر البحث بصمت. يتوقف فقط إن رُفض إذن الموقع (1).
        */
        if (err.code !== 1) {
          if (!best.current) setError('لا توجد إشارة بعد — يستمر البحث تلقائياً. اقترب من مكان مكشوف، أو اكتب الإحداثيات.');
          return;
        }
        stopWatch();
        const messages = {
          1: 'رُفض إذن الوصول للموقع. فعّله من إعدادات المتصفح، أو اكتب الإحداثيات أو اخترها من الخريطة.',
          2: 'خدمة الموقع غير متاحة. تأكد من تفعيل GPS في الهاتف، أو اكتب الإحداثيات أو اخترها من الخريطة.',
        };
        setError(messages[err.code] || 'تعذّر تحديد الموقع');
        setStatus(best.current ? 'ready' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: Infinity },
    );
  };
  const stopCapture = () => { stopWatch(); setStatus(best.current ? 'ready' : 'idle'); };

  /* دقة أسوأ من الحد المطلوب تُعرض كتحذير، لا كخطأ يمنع المتابعة */
  const poor = value?.accuracy && node.minAccuracy && value.accuracy > node.minAccuracy;

  return (
    <div className="q-geo">
      {value ? (
        <div className="q-geo__result">
          <div className="q-geo__coords">
            <div>
              <span className="q-geo__key">خط العرض</span>
              <span className="q-geo__val">{fmt(value.lat)}</span>
            </div>
            <div>
              <span className="q-geo__key">خط الطول</span>
              <span className="q-geo__val">{fmt(value.lng)}</span>
            </div>
            {value.source && value.source !== 'gps' && (
              <div>
                <span className="q-geo__key">المصدر</span>
                <span className="q-geo__val">{value.source === 'map' ? 'من الخريطة' : 'كتابة يدوية'}</span>
              </div>
            )}
            {value.accuracy != null && (
              <div>
                <span className="q-geo__key">الدقة</span>
                <span className={`q-geo__val${poor ? ' is-poor' : ''}`}>±{value.accuracy} م</span>
              </div>
            )}
          </div>
          {status === 'busy' && (
            <p className="q-hint">يستمر تحسين الدقة تلقائياً دون حد زمني، ويتوقف وحده عند دقة جيدة. يمكنك المتابعة الآن أو الإيقاف.</p>
          )}
          {poor && status !== 'busy' && (
            <p className="q-warn">
              الدقة أقل من المطلوب (±{node.minAccuracy} م). حاول في مكان مكشوف لنتيجة أدق.
            </p>
          )}
          <div className="q-geo__actions">
            <button type="button" className="q-btn q-btn--ghost" onClick={status === 'busy' ? stopCapture : capture}>
              {status === 'busy' ? 'إيقاف تحسين الدقة' : 'إعادة التحديد بالـ GPS'}
            </button>
            <button type="button" className="q-btn q-btn--ghost" onClick={() => setMode(mode === 'map' ? null : 'map')}>تعديل على الخريطة</button>
            <button type="button" className="q-btn q-btn--danger" onClick={() => { onChange(null); setStatus('idle'); setMode(null); }}>
              مسح
            </button>
          </div>
        </div>
      ) : (
        <div className="q-geo__modes">
          <button type="button" className="q-geo__capture" onClick={status === 'busy' ? stopCapture : capture}>
            <Icon name="pin" className="q-geo__icon" />
            <span>{status === 'busy' ? 'جارٍ البحث عن إشارة GPS… (اضغط للإيقاف)' : 'تحديد موقعي الحالي'}</span>
          </button>
          <div className="q-geo__alt">
            <button type="button" className={`q-btn q-btn--ghost${mode === 'manual' ? ' is-on' : ''}`} onClick={() => { setMode(mode === 'manual' ? null : 'manual'); setError(''); }}>كتابة الإحداثيات</button>
            <button type="button" className={`q-btn q-btn--ghost${mode === 'map' ? ' is-on' : ''}`} onClick={() => { setMode(mode === 'map' ? null : 'map'); setError(''); }}>اختيار من الخريطة</button>
          </div>
        </div>
      )}
      {mode === 'manual' && (
        <div className="q-geo__manual">
          <label><span>خط العرض (N)</span>
            <input className="q-input" dir="ltr" inputMode="decimal" placeholder="35.93" value={mLat} onChange={(e) => setMLat(e.target.value)} /></label>
          <label><span>خط الطول (E)</span>
            <input className="q-input" dir="ltr" inputMode="decimal" placeholder="36.63" value={mLng} onChange={(e) => setMLng(e.target.value)} /></label>
          <button type="button" className="q-btn" onClick={saveManual}>اعتماد</button>
        </div>
      )}
      {mode === 'map' && (
        <div className="q-geo__mapwrap">
          <p className="q-hint">انقر على مكان الموقع في الخريطة. يمكنك التكبير بإصبعين.</p>
          <Suspense fallback={<p className="q-hint">جارٍ تحميل الخريطة…</p>}>
            <GeoMapPicker value={value} onPick={(p) => onChange({ ...p, accuracy: null, source: 'map', at: new Date().toISOString() })} />
          </Suspense>
          {value && <button type="button" className="q-btn" onClick={() => setMode(null)}>تم</button>}
        </div>
      )}
      {error && <p className="q-error">{error}</p>}
    </div>
  );
}
