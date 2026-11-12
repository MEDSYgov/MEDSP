import { useRef, useState } from 'react';
import Icon from '../components/Icon';
import AdminAreaPicker from './AdminAreaPicker';
import GeoPointField from './GeoPointField';

/* ---------------- نصوص ---------------- */

function TextField({ node, value, onChange, onBlur, invalid }) {
  const multiline = node.type === 'textarea';
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      className={`q-input${multiline ? ' q-input--area' : ''}`}
      type={multiline ? undefined : 'text'}
      rows={multiline ? 4 : undefined}
      value={value || ''}
      placeholder={node.placeholder || ''}
      maxLength={node.maxLength}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

/* ---------------- أرقام ---------------- */

function NumberField({ node, value, onChange, onBlur, invalid }) {
  return (
    <div className="q-number">
      <input
        className="q-input"
        type="text"
        inputMode={node.type === 'integer' ? 'numeric' : 'decimal'}
        value={value ?? ''}
        placeholder={node.placeholder || ''}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const raw = e.target.value;
          /* نسمح بالفراغ وبالسالب وبالعشري أثناء الكتابة، والتحقق عند الخروج */
          if (raw === '' || /^-?\d*\.?\d*$/.test(raw)) onChange(raw);
        }}
        onBlur={onBlur}
      />
      {node.unit && <span className="q-number__unit">{node.unit}</span>}
    </div>
  );
}

function RangeField({ node, value, onChange }) {
  const min = node.min ?? 1;
  const max = node.max ?? 5;
  const current = value === '' || value == null ? null : Number(value);

  /* أزرار بدل شريط انزلاقي — أدق بالإصبع في الميدان */
  const steps = [];
  for (let i = min; i <= max; i += 1) steps.push(i);

  return (
    <div className="q-range">
      {node.minLabel && <span className="q-range__end">{node.minLabel}</span>}
      <div className="q-range__steps">
        {steps.map((n) => (
          <button
            key={n}
            type="button"
            className={`q-range__step${current === n ? ' is-on' : ''}`}
            onClick={() => onChange(n)}
            aria-pressed={current === n}
          >
            {n}
          </button>
        ))}
      </div>
      {node.maxLabel && <span className="q-range__end">{node.maxLabel}</span>}
    </div>
  );
}

/* ---------------- اختيارات ---------------- */

function SelectOne({ node, value, onChange }) {
  /* قائمة منسدلة للقوائم الطويلة (مثل سجل الجهات) */
  if (node.appearance === 'dropdown') {
    return (
      <select className="q-input q-input--select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">اختر من القائمة</option>
        {node.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    );
  }
  const columns = node.appearance === 'columns' && node.choices.length > 4;
  return (
    <div className={`q-choices${columns ? ' q-choices--cols' : ''}`} role="radiogroup">
      {node.choices.map((c) => {
        const on = String(value) === String(c.value);
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`q-choice${on ? ' is-on' : ''}`}
            onClick={() => onChange(on && node.allowDeselect ? '' : c.value)}
          >
            <span className="q-choice__mark q-choice__mark--radio" aria-hidden="true" />
            <span className="q-choice__label">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SelectMultiple({ node, value, onChange }) {
  const list = Array.isArray(value) ? value : [];
  const columns = node.appearance === 'columns' && node.choices.length > 4;

  const toggle = (v) => {
    const has = list.map(String).includes(String(v));
    if (has) onChange(list.filter((x) => String(x) !== String(v)));
    else if (!node.maxSelect || list.length < node.maxSelect) onChange([...list, v]);
  };

  return (
    <div className={`q-choices${columns ? ' q-choices--cols' : ''}`}>
      {node.choices.map((c) => {
        const on = list.map(String).includes(String(c.value));
        const blocked = !on && node.maxSelect && list.length >= node.maxSelect;
        return (
          <button
            key={c.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={blocked || undefined}
            className={`q-choice${on ? ' is-on' : ''}${blocked ? ' is-blocked' : ''}`}
            onClick={() => toggle(c.value)}
          >
            <span className="q-choice__mark" aria-hidden="true" />
            <span className="q-choice__label">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ترتيب أفضليات — الضغط يضيف بالترتيب، وإعادة الضغط تلغي */
function RankField({ node, value, onChange }) {
  const list = Array.isArray(value) ? value : [];

  const toggle = (v) => {
    const i = list.map(String).indexOf(String(v));
    if (i === -1) onChange([...list, v]);
    else onChange(list.filter((x) => String(x) !== String(v)));
  };

  return (
    <div className="q-choices">
      {node.choices.map((c) => {
        const rank = list.map(String).indexOf(String(c.value));
        const on = rank !== -1;
        return (
          <button
            key={c.value}
            type="button"
            className={`q-choice q-choice--rank${on ? ' is-on' : ''}`}
            onClick={() => toggle(c.value)}
          >
            <span className={`q-choice__rank${on ? ' is-on' : ''}`}>
              {on ? rank + 1 : ''}
            </span>
            <span className="q-choice__label">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- زمن ---------------- */

function DateField({ node, value, onChange, onBlur, invalid }) {
  const map = { date: 'date', time: 'time', datetime: 'datetime-local' };
  return (
    <input
      className="q-input q-input--date"
      type={map[node.type]}
      value={value || ''}
      min={node.min}
      max={node.max}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

/* ---------------- مرفقات ---------------- */

/*
  الصور تُخزَّن محلياً كـ dataURL حتى المزامنة، وتُرسل داخل الإجابة.
  استمارة واحدة قد تحمل أكثر من 20 صورة، فنصغّر كل صورة على الهاتف قبل حفظها:
  الضلع الأطول 1280 بكسل، وJPEG بجودة تُخفَّض تدريجياً حتى ~250 كيلوبايت.
  تُقبل أي صيغة وأي حجم: HEIC/HEIF (آيفون وبعض هواتف أندرويد) تُحوَّل إلى JPEG
  بمكتبة لا تُحمَّل إلا عند الحاجة، وما يفتحه المتصفح يُصغَّر مباشرة.
*/
const MAX_DIM = 1280;
const TARGET_BYTES = 250 * 1024;
const isHeic = (f) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '');

async function decode(file) {
  /* createImageBitmap أخف على ذاكرة الهواتف القديمة ويحترم اتجاه الصورة */
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* نجرّب الطريقة الأخرى */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('decode'));
      im.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

async function toDecodable(file) {
  try { return await decode(file); } catch (e) {
    if (!isHeic(file) && file.type && !/octet-stream/.test(file.type)) throw e;
    /* صيغة لا يفتحها المتصفح (غالباً HEIC): نحوّلها إلى JPEG أولاً */
    const { default: heic2any } = await import('heic2any');
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    return decode(Array.isArray(out) ? out[0] : out);
  }
}

async function compressImage(file) {
  let img;
  try { img = await toDecodable(file); } catch {
    throw new Error('تعذّر فتح هذه الصورة. التقطها بكاميرا الهاتف مباشرة، أو اخترها بصيغة JPG أو PNG.');
  }
  const iw = img.width; const ih = img.height;
  const scale = Math.min(1, MAX_DIM / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  img.close?.();

  let quality = 0.72;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length * 0.75 > TARGET_BYTES && quality > 0.42) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  canvas.width = 0; canvas.height = 0;
  return {
    dataUrl,
    width: w,
    height: h,
    originalSize: file.size,
    name: (file.name || 'photo').replace(/\.(heic|heif|png|webp|gif|bmp|tiff?)$/i, '.jpg'),
  };
}

function ImageField({ node, value, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      onChange(await compressImage(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="q-image">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        capture={node.capture ? 'environment' : undefined}
        className="q-image__input"
        onChange={pick}
      />
      {value?.dataUrl ? (
        <div className="q-image__preview">
          <img src={value.dataUrl} alt="الصورة المرفقة" />
          <div className="q-image__actions">
            <button type="button" className="q-btn q-btn--ghost" onClick={() => inputRef.current?.click()}>
              استبدال
            </button>
            <button type="button" className="q-btn q-btn--danger" onClick={() => onChange(null)}>
              حذف
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="q-image__drop"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="camera" className="q-image__icon" />
          <span>{busy ? 'جارٍ المعالجة…' : node.capture ? 'التقاط صورة' : 'إرفاق صورة'}</span>
        </button>
      )}
      {error && <p className="q-error">{error}</p>}
    </div>
  );
}

/* ---------------- الموزّع ---------------- */

const FIELDS = {
  text: TextField,
  textarea: TextField,
  integer: NumberField,
  decimal: NumberField,
  range: RangeField,
  select_one: SelectOne,
  select_multiple: SelectMultiple,
  rank: RankField,
  date: DateField,
  time: DateField,
  datetime: DateField,
  admin_area: AdminAreaPicker,
  geopoint: GeoPointField,
  image: ImageField,
};

export default function Field(props) {
  const Component = FIELDS[props.node.type];
  if (!Component) {
    return <p className="q-error">نوع سؤال غير مدعوم: {props.node.type}</p>;
  }
  return <Component {...props} />;
}
