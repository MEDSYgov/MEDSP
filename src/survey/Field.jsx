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
  الصور تُخزَّن محلياً كـ dataURL حتى المزامنة.
  نضغط الصورة قبل الحفظ — صورة هاتف حديث قد تتجاوز 5 ميغابايت،
  وهذا يملأ تخزين المتصفح ويستحيل رفعه عبر شبكة ميدانية ضعيفة.
*/
async function compressImage(file, maxDim = 1600, quality = 0.72) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('تعذّرت قراءة الملف'));
    r.readAsDataURL(file);
  });

  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('تعذّر فتح الصورة'));
    im.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', quality),
    width: w,
    height: h,
    originalSize: file.size,
    name: file.name,
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
        accept="image/*"
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
