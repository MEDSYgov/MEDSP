import Field from './Field';
import { validateNode, resolveVisible, filterChoices } from './runtime';
import { NON_ANSWER_TYPES } from './schema';

/* ---------------- غلاف السؤال ---------------- */

function Question({ node, value, error, showError, onChange, onBlur, index }) {
  const invalid = Boolean(error) && showError;

  return (
    <div className={`q${invalid ? ' q--invalid' : ''}`} data-type={node.type}>
      <div className="q__head">
        {index != null && <span className="q__num">{index}</span>}
        <label className="q__label">
          {node.label}
          {node.required && <span className="q__req" aria-label="مطلوب">*</span>}
        </label>
      </div>
      {node.hint && <p className="q__hint">{node.hint}</p>}
      {node.cascadeFrom && node.choices?.length === 0 ? (
        <p className="q__hint q__hint--wait">تظهر الخيارات بعد الإجابة على السؤال السابق المرتبط به.</p>
      ) : (
      <Field
        node={node}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        invalid={invalid}
      />
      )}
      {invalid && <p className="q__error">{error}</p>}
    </div>
  );
}

/* ---------------- قيمة محسوبة (للعرض فقط) ---------------- */

function Computed({ node, value }) {
  if (!node.showResult) return null;
  const blank = value === '' || value === null || value === undefined;
  const shown = blank ? '—'
    : node.choices ? (node.choices.find((c) => String(c.value) === String(value))?.label ?? String(value))
      : Number(value).toLocaleString('en-US');
  return (
    <div className="q-calc">
      <span className="q-calc__label">{node.label}</span>
      <strong className="q-calc__value" dir="ltr">{shown}</strong>
      {node.unit && <span className="q-calc__unit">{node.unit}</span>}
    </div>
  );
}

/* ---------------- ملاحظة ---------------- */

/* appearance: danger (تنبيه أحمر) · warning (تنبيه أصفر) · ok — للتنبيهات الرقابية الشرطية */
function Note({ node }) {
  const tone = ['danger', 'warning', 'ok'].includes(node.appearance) ? ` q-note--${node.appearance}` : '';
  return (
    <div className={`q-note${tone}`} role={tone ? 'alert' : undefined}>
      <p>{node.label}</p>
      {node.hint && <p className="q-note__hint">{node.hint}</p>}
    </div>
  );
}

/* ---------------- مجموعة متكررة ---------------- */

function Repeat({ node, rows, errors, showError, survey }) {
  const canAdd = !node.maxCount || rows.length < node.maxCount;
  const canRemove = rows.length > (node.minCount || 0);

  return (
    <div className="q-repeat">
      <div className="q-repeat__head">
        <h4 className="q-repeat__title">{node.label}</h4>
        <span className="q-repeat__count">{rows.length}</span>
      </div>
      {node.hint && <p className="q__hint">{node.hint}</p>}

      {rows.length === 0 && (
        <p className="q-repeat__empty">لم تتم إضافة أي مدخل بعد.</p>
      )}

      {rows.map((row, i) => {
        /* الشروط داخل التكرار تُقيَّم في سياق صفّه */
        const visible = resolveVisible(node.children, survey.answers, row);
        return (
          <div className="q-repeat__row" key={i}>
            <div className="q-repeat__rowhead">
              <span className="q-repeat__badge">
                {node.itemLabel || 'مدخل'} {i + 1}
              </span>
              {canRemove && (
                <button
                  type="button"
                  className="q-btn q-btn--danger q-btn--sm"
                  onClick={() => survey.removeRow(node.name, i)}
                >
                  حذف
                </button>
              )}
            </div>

            {visible.map((item) => {
              if (item.kind === 'calculate') {
                return <Computed key={item.node.name} node={item.node} value={row[item.node.name]} />;
              }
              if (item.kind !== 'question') return null;
              const child = { ...item.node, choices: filterChoices(item.node, { ...survey.answers, ...row }) };
              if (NON_ANSWER_TYPES.has(child.type)) return <Note key={child.name} node={child} />;
              const key = `${node.name}.${i}.${child.name}`;
              return (
                <Question
                  key={key}
                  node={child}
                  value={row[child.name]}
                  error={errors[key]}
                  showError={showError}
                  onChange={(v) => survey.setRowAnswer(node.name, i, child.name, v)}
                  onBlur={() => {}}
                />
              );
            })}
          </div>
        );
      })}

      {canAdd && (
        <button
          type="button"
          className="q-btn q-btn--add"
          onClick={() => survey.addRow(node.name, node.children)}
        >
          + إضافة {node.itemLabel || 'مدخل'}
        </button>
      )}
      {showError && errors[node.name] && <p className="q__error">{errors[node.name]}</p>}
    </div>
  );
}

/* ---------------- العارض ---------------- */

export default function SurveyForm({ survey, definition }) {
  const page = survey.pages[survey.page];
  const showError = survey.showErrors;

  /* الترقيم يتخطى العناوين والملاحظات، ويعيد الحساب مع الشروط */
  let counter = 0;

  return (
    <div className="survey">
      {survey.pages.length > 1 && (
        <div className="survey__progress">
          <div className="survey__steps">
            {survey.pages.map((p, i) => (
              <button
                key={p.name}
                type="button"
                className={`survey__step${i === survey.page ? ' is-on' : ''}${i < survey.page ? ' is-done' : ''}`}
                onClick={() => i < survey.page && survey.goTo(i)}
                disabled={i > survey.page}
              >
                <span className="survey__stepnum">{i + 1}</span>
                <span className="survey__steplabel">{p.title}</span>
              </button>
            ))}
          </div>
          <div className="survey__bar">
            <span className="survey__fill" style={{ width: `${survey.progress}%` }} />
          </div>
          <span className="survey__pct">اكتمل {survey.progress}%</span>
        </div>
      )}

      <div className="survey__page">
        {page?.title && survey.pages.length > 1 && (
          <h3 className="survey__pagetitle">{page.title}</h3>
        )}
        {page?.intro && <p className="survey__intro">{page.intro}</p>}

        {survey.visible.map((item, idx) => {
          const { node, kind } = item;

          if (kind === 'group-start') {
            return (
              <div className="q-group__head" key={`gs-${node.name}-${idx}`}>
                <h4 className="q-group__title">{node.label}</h4>
                {node.hint && <p className="q__hint">{node.hint}</p>}
              </div>
            );
          }
          if (kind === 'group-end') return null;

          if (kind === 'repeat') {
            return (
              <Repeat
                key={node.name}
                node={node}
                rows={survey.answers[node.name] || []}
                errors={survey.errors}
                showError={showError}
                survey={survey}
              />
            );
          }

          if (node.type === 'note') return <Note key={node.name} node={node} />;
          if (kind === 'calculate') {
            return <Computed key={node.name} node={node} value={survey.answers[node.name]} />;
          }

          counter += 1;
          const shownNode = node.cascadeFrom
            ? { ...node, choices: filterChoices(node, survey.answers) }
            : node;
          return (
            <Question
              key={node.name}
              index={counter}
              node={shownNode}
              value={survey.answers[node.name]}
              error={survey.errors[node.name]}
              showError={showError}
              onChange={(v) => survey.setAnswer(node.name, v)}
              onBlur={() => survey.touch(node.name)}
            />
          );
        })}

        {survey.visible.length === 0 && (
          <p className="survey__empty">
            لا توجد أسئلة في هذا القسم بناءً على إجاباتك السابقة.
          </p>
        )}
      </div>

      {showError && !survey.pageValid && (
        <p className="survey__alert">
          يرجى إكمال الحقول المطلوبة قبل المتابعة.
        </p>
      )}
    </div>
  );
}
