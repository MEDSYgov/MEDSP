import { lazy, Suspense, useState } from 'react';
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

  const capture = () => {
    if (!navigator.geolocation) {
      setError('هذا الجهاز لا يدعم تحديد الموقع');
      setStatus('error');
      return;
    }
    setStatus('busy');
    setError('');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy, altitude } = pos.coords;
        onChange({
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
          accuracy: accuracy ? Math.round(accuracy) : null,
          source: 'gps',
          altitude: altitude != null ? Math.round(altitude) : null,
          at: new Date().toISOString(),
        });
        setStatus('ready');
      },
      (err) => {
        const messages = {
          1: 'رُفض إذن الوصول للموقع. فعّله من إعدادات المتصفح.',
          2: 'تعذّر تحديد الموقع. تأكد من تفعيل GPS.',
          3: 'انتهت المهلة قبل تحديد الموقع. حاول في مكان مكشوف.',
        };
        setError(messages[err.code] || 'تعذّر تحديد الموقع');
        setStatus('error');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

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
          {poor && (
            <p className="q-warn">
              الدقة أقل من المطلوب (±{node.minAccuracy} م). حاول في مكان مكشوف لنتيجة أدق.
            </p>
          )}
          <div className="q-geo__actions">
            <button type="button" className="q-btn q-btn--ghost" onClick={capture} disabled={status === 'busy'}>
              {status === 'busy' ? 'جارٍ التحديد…' : 'إعادة التحديد بالـ GPS'}
            </button>
            <button type="button" className="q-btn q-btn--ghost" onClick={() => setMode(mode === 'map' ? null : 'map')}>تعديل على الخريطة</button>
            <button type="button" className="q-btn q-btn--danger" onClick={() => { onChange(null); setStatus('idle'); setMode(null); }}>
              مسح
            </button>
          </div>
        </div>
      ) : (
        <div className="q-geo__modes">
          <button type="button" className="q-geo__capture" onClick={capture} disabled={status === 'busy'}>
            <Icon name="pin" className="q-geo__icon" />
            <span>{status === 'busy' ? 'جارٍ تحديد الموقع…' : 'تحديد موقعي الحالي'}</span>
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
