import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { evaluateExpression, isTruthy } from './expression.js';
import { QUESTION_TYPES, MULTI_VALUE_TYPES, NON_ANSWER_TYPES, emptyValue, isBlank } from './schema.js';

/*
  محرّك تشغيل الاستبيان.

  مسؤولياته:
    - حفظ الإجابات
    - حساب أي الأسئلة ظاهرة الآن (relevant)
    - التحقق من القيود (constraint) والحقول المطلوبة
    - إدارة المجموعات المتكررة
    - التنقل بين الأقسام

  قرار تصميمي مهم — الإجابات المخفية:
  عندما يجيب المستخدم على سؤال ثم يغيّر إجابة سابقة فيختفي ذلك السؤال،
  نحتفظ بالإجابة في الحالة لكن نستبعدها من الناتج النهائي ومن التحقق.
  السبب: لو تراجع المستخدم وأعاد الشرط، تعود إجابته بدل أن يكتبها من جديد.
  لكن تصديرها للتقرير سيكون خاطئاً — لأنها إجابة على سؤال لا ينطبق عليه.
  لذلك: نحفظها للتجربة، ونحذفها عند التسليم.
*/

/* ---------------- بناء سياق التقييم ---------------- */

/*
  التعابير تشير إلى الحقول بالاسم فقط (${age})، فنحتاج خريطة مسطحة.
  داخل مجموعة متكررة، السؤال يرى إخوته في نفس التكرار أولاً ثم الجذر،
  تماماً كما في XLSForm.
*/
function buildContext(answers, scope) {
  if (!scope) return answers;
  return { ...answers, ...scope };
}

/* ---------------- الحقول المحسوبة ---------------- */

/*
  تُحسب بترتيب ظهورها، فيمكن لحقل محسوب أن يعتمد على آخر قبله.
  الحقول المحسوبة داخل مجموعة متكررة تُحسب لكل صف في سياقه.
  لا تُخزَّن في الحالة — تُشتق من الإجابات في كل مرة، فلا تتقادم أبداً.
*/
export function applyCalculations(nodes, answers, onError) {
  const out = { ...answers };
  const walk = (list, target, scope) => {
    for (const node of list || []) {
      if (node.type === 'group') { walk(node.children, target, scope); continue; }
      /* derive: قيمة تُشتق من غيرها لأي نوع سؤال (كالحالة من الكميات) */
      const formula = node.type === 'calculate' ? node.calculation : node.derive;
      if (formula) {
        const ctx = scope ? { ...out, ...target } : target;
        const v = evaluateExpression(formula, ctx, '', onError);
        target[node.name] = typeof v === 'number' && !Number.isFinite(v) ? '' : v;
      }
      if (node.type === 'repeat' && Array.isArray(target[node.name])
          && (node.children || []).some((c) => c.type === 'calculate')) {
        target[node.name] = target[node.name].map((row) => {
          const r = { ...row };
          walk(node.children, r, true);
          return r;
        });
      }
    }
  };
  walk(nodes, out, false);
  return out;
}

/* ---------------- القوائم المتتالية ---------------- */

/*
  سؤال اختيار مربوط بسؤال سابق (cascadeFrom): كل خيار فيه
  showWhen = قيمة السؤال الأب التي يظهر عندها. خيار بلا showWhen يظهر دائماً.
*/
export function filterChoices(node, context) {
  if (!node.cascadeFrom || !Array.isArray(node.choices)) return node.choices;
  const parent = context[node.cascadeFrom];
  if (parent === undefined || parent === '' || parent === null) return [];
  const pv = Array.isArray(parent) ? parent.map(String) : [String(parent)];
  return node.choices.filter((c) => !c.showWhen || pv.includes(String(c.showWhen)));
}

/* ---------------- المشي على الشجرة ---------------- */

/*
  يُرجع قائمة مسطحة بالعُقد الظاهرة حالياً، مع حساب relevant لكل عقدة.
  المجموعة غير الظاهرة تُخفي كل ما بداخلها.
*/
export function resolveVisible(nodes, answers, scope = null, onError) {
  const out = [];

  for (const node of nodes || []) {
    const ctx = buildContext(answers, scope);
    const relevant = node.relevant
      ? isTruthy(evaluateExpression(node.relevant, ctx, true, onError))
      : true;

    if (!relevant) continue;

    if (node.type === 'group') {
      out.push({ node, kind: 'group-start', scope });
      out.push(...resolveVisible(node.children, answers, scope, onError));
      out.push({ node, kind: 'group-end', scope });
    } else if (node.type === 'repeat') {
      out.push({ node, kind: 'repeat', scope });
    } else if (node.type === 'calculate' || node.derive) {
      out.push({ node, kind: 'calculate', scope });
    } else {
      out.push({ node, kind: 'question', scope });
    }
  }

  return out;
}

/* ---------------- التحقق ---------------- */

function checkRequired(node, value, ctx, onError) {
  const req = node.required;
  if (!req) return null;
  const isRequired = typeof req === 'string'
    ? isTruthy(evaluateExpression(req, ctx, false, onError))
    : Boolean(req);
  if (!isRequired) return null;
  return isBlank(value) ? 'هذا السؤال مطلوب' : null;
}

function checkConstraint(node, value, ctx, onError) {
  if (!node.constraint) return null;
  if (isBlank(value)) return null; /* القيد لا يُطبَّق على الفراغ — ذلك دور required */
  const ok = isTruthy(evaluateExpression(node.constraint, ctx, true, onError));
  return ok ? null : (node.constraintMessage || 'القيمة غير مقبولة');
}

/* تحققات خاصة بالنوع */
function checkType(node, value) {
  if (isBlank(value)) return null;

  if (node.type === 'integer') {
    if (!/^-?\d+$/.test(String(value))) return 'يجب إدخال عدد صحيح';
  }
  if (node.type === 'decimal') {
    if (!Number.isFinite(Number(value))) return 'يجب إدخال رقم';
  }
  if (node.type === 'integer' || node.type === 'decimal' || node.type === 'range') {
    const n = Number(value);
    if (node.min !== undefined && n < node.min) return `أقل قيمة مسموحة ${node.min}`;
    if (node.max !== undefined && n > node.max) return `أكبر قيمة مسموحة ${node.max}`;
  }
  if (node.type === 'text' || node.type === 'textarea') {
    if (node.maxLength && String(value).length > node.maxLength) {
      return `الحد الأقصى ${node.maxLength} حرفاً`;
    }
  }
  if (node.type === 'select_multiple') {
    const n = (value || []).length;
    if (node.minSelect && n < node.minSelect) return `اختر ${node.minSelect} على الأقل`;
    if (node.maxSelect && n > node.maxSelect) return `اختر ${node.maxSelect} كحد أقصى`;
  }
  if (node.type === 'admin_area' && node.level !== 'governorate') {
    if (value?.governorate && !value?.subdistrict) return 'اختر الناحية أيضاً';
  }
  return null;
}

export function validateNode(node, value, answers, scope, onError) {
  const ctx = buildContext(answers, scope);
  if (node.cascadeFrom && value !== '' && value != null) {
    const allowed = new Set((filterChoices(node, ctx) || []).map((c) => String(c.value)));
    const picked = Array.isArray(value) ? value : [value];
    if (picked.some((v) => !allowed.has(String(v)))) return 'الاختيار لم يعد متاحاً بعد تغيير إجابة سابقة — اختر من جديد';
  }
  return checkRequired(node, value, ctx, onError)
    || checkType(node, value)
    || checkConstraint(node, value, ctx, onError);
}

/*
  أخطاء مجموعة متكررة: الحد الأدنى، وقيد المجموعة كلها (constraint على العقدة نفسها،
  مثل «عدد البطاقات = عدد الآليات»)، ثم أسئلة كل صف في سياقه.
*/
function repeatErrors(node, answers, map, onError) {
  const rows = answers[node.name] || [];
  if (node.minCount && rows.length < node.minCount) map[node.name] = `أضف ${node.minCount} على الأقل`;
  if (!map[node.name] && node.required && rows.length === 0) map[node.name] = 'أضف مدخلاً واحداً على الأقل';
  if (!map[node.name] && node.constraint) {
    const ok = isTruthy(evaluateExpression(node.constraint, buildContext(answers, null), true, onError));
    if (!ok) map[node.name] = node.constraintMessage || 'القيمة غير مقبولة';
  }
  rows.forEach((row, i) => {
    for (const child of node.children) {
      if (NON_ANSWER_TYPES.has(child.type)) continue;
      if (child.relevant && !isTruthy(evaluateExpression(child.relevant, buildContext(answers, row), true, onError))) continue;
      const err = validateNode(child, row[child.name], answers, row, onError);
      if (err) map[`${node.name}.${i}.${child.name}`] = err;
    }
  });
}

/* ---------------- المُختزِل ---------------- */

function initialAnswers(nodes, seed = {}) {
  const answers = { ...seed };
  const walk = (list) => {
    for (const node of list || []) {
      if (NON_ANSWER_TYPES.has(node.type)) {
        if (node.type === 'group') walk(node.children);
        continue;
      }
      if (node.type === 'repeat') {
        if (answers[node.name] === undefined) answers[node.name] = [];
        continue;
      }
      if (answers[node.name] === undefined) {
        answers[node.name] = node.default ?? emptyValue(node.type);
      }
    }
  };
  walk(nodes);
  return answers;
}

function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return {
        ...state,
        answers: { ...state.answers, [action.name]: action.value },
        touched: { ...state.touched, [action.name]: true },
      };

    case 'touch':
      return { ...state, touched: { ...state.touched, [action.name]: true } };

    case 'repeat:add': {
      const list = state.answers[action.name] || [];
      return {
        ...state,
        answers: {
          ...state.answers,
          [action.name]: [...list, initialAnswers(action.children)],
        },
      };
    }

    case 'repeat:remove': {
      const list = state.answers[action.name] || [];
      return {
        ...state,
        answers: {
          ...state.answers,
          [action.name]: list.filter((_, i) => i !== action.index),
        },
      };
    }

    case 'repeat:set': {
      const list = [...(state.answers[action.name] || [])];
      list[action.index] = { ...list[action.index], [action.field]: action.value };
      return {
        ...state,
        answers: { ...state.answers, [action.name]: list },
        touched: { ...state.touched, [`${action.name}.${action.index}.${action.field}`]: true },
      };
    }

    case 'page':
      return { ...state, page: action.page, showErrors: false };

    case 'showErrors':
      return { ...state, showErrors: true };

    case 'reset':
      return action.state;

    default:
      return state;
  }
}

/* ---------------- الواجهة العامة ---------------- */

export default function useSurvey(definition, options = {}) {
  const pages = useMemo(() => {
    if (definition.pages?.length) return definition.pages;
    return [{ name: 'main', title: definition.title, children: definition.children || [] }];
  }, [definition]);

  const allNodes = useMemo(() => pages.flatMap((p) => p.children), [pages]);

  const fresh = useCallback(() => ({
    answers: initialAnswers(allNodes, options.initialAnswers),
    touched: {},
    page: 0,
    showErrors: false,
  }), [allNodes, options.initialAnswers]);

  const [state, dispatch] = useReducer(reducer, null, fresh);

  /* تصفير كامل عند بدء جولة تعبئة جديدة */
  const round = options.round ?? 0;
  const lastRound = useRef(round);
  useEffect(() => {
    if (lastRound.current !== round) {
      lastRound.current = round;
      dispatch({ type: 'reset', state: fresh() });
    }
  }, [round, fresh]);

  const exprErrors = useMemo(() => [], []);
  const onExprError = useCallback((err, src) => {
    /* تعابير معطوبة تُجمَع للمشرف بدل أن تُعطّل الاستبيان */
    const msg = `${src} — ${err.message}`;
    if (!exprErrors.includes(msg)) exprErrors.push(msg);
  }, [exprErrors]);

  /* الإجابات مع الحقول المحسوبة — هي ما تراه الشروط والتحقق والناتج */
  const answers = useMemo(
    () => applyCalculations(allNodes, state.answers, onExprError),
    [allNodes, state.answers, onExprError],
  );

  /* العقد الظاهرة في الصفحة الحالية */
  const visible = useMemo(
    () => resolveVisible(pages[state.page]?.children, answers, null, onExprError),
    [pages, state.page, answers, onExprError],
  );

  /* كل العقد الظاهرة في الاستبيان كله — للتحقق النهائي وللتقدّم */
  const visibleAll = useMemo(
    () => pages.flatMap((p) => resolveVisible(p.children, answers, null, onExprError)),
    [pages, answers, onExprError],
  );

  /* أخطاء الصفحة الحالية */
  const errors = useMemo(() => {
    const map = {};
    for (const item of visible) {
      if (item.kind === 'question') {
        const err = validateNode(item.node, answers[item.node.name], answers, null, onExprError);
        if (err) map[item.node.name] = err;
      }
      if (item.kind === 'repeat') repeatErrors(item.node, answers, map, onExprError);
    }
    return map;
  }, [visible, answers, onExprError]);

  const pageValid = Object.keys(errors).length === 0;

  /* نسبة الإنجاز — تُحسب على الأسئلة الظاهرة فقط، فتتغير مع الشروط */
  const progress = useMemo(() => {
    const questions = visibleAll.filter((i) => i.kind === 'question');
    if (questions.length === 0) return 0;
    const done = questions.filter((i) => !isBlank(answers[i.node.name])).length;
    return Math.round((done / questions.length) * 100);
  }, [visibleAll, answers]);

  /*
    الناتج النهائي: الإجابات الظاهرة فقط.
    إجابات الأسئلة التي اختفت بسبب الشروط تُستبعَد — لأنها إجابات
    على أسئلة لا تنطبق على هذا المستجيب.
  */
  const collect = useCallback(() => {
    const visibleNames = new Set(
      visibleAll.filter((i) => i.kind === 'question' || i.kind === 'repeat' || i.kind === 'calculate')
        .map((i) => i.node.name),
    );
    const out = {};
    for (const [key, value] of Object.entries(answers)) {
      if (!visibleNames.has(key)) continue;
      if (isBlank(value)) continue;
      out[key] = value;
    }
    return out;
  }, [answers, visibleAll]);

  /* التحقق من الاستبيان كله قبل الإرسال */
  const validateAll = useCallback(() => {
    const map = {};
    for (const item of visibleAll) {
      if (item.kind === 'question') {
        const err = validateNode(item.node, answers[item.node.name], answers, null, onExprError);
        if (err) map[item.node.name] = err;
      }
      if (item.kind === 'repeat') repeatErrors(item.node, answers, map, onExprError);
    }
    return map;
  }, [visibleAll, answers, onExprError]);

  return {
    /* الحالة */
    answers: answers,
    page: state.page,
    pages,
    visible,
    errors,
    showErrors: state.showErrors,
    touched: state.touched,
    progress,
    pageValid,
    expressionErrors: exprErrors,

    /* الأفعال */
    setAnswer: (name, value) => dispatch({ type: 'set', name, value }),
    touch: (name) => dispatch({ type: 'touch', name }),
    addRow: (name, children) => dispatch({ type: 'repeat:add', name, children }),
    removeRow: (name, index) => dispatch({ type: 'repeat:remove', name, index }),
    setRowAnswer: (name, index, field, value) =>
      dispatch({ type: 'repeat:set', name, index, field, value }),
    goTo: (page) => dispatch({ type: 'page', page }),
    next: () => {
      if (!pageValid) { dispatch({ type: 'showErrors' }); return false; }
      if (state.page < pages.length - 1) dispatch({ type: 'page', page: state.page + 1 });
      return true;
    },
    back: () => {
      if (state.page > 0) dispatch({ type: 'page', page: state.page - 1 });
    },
    showAllErrors: () => dispatch({ type: 'showErrors' }),

    /* الناتج */
    collect,
    validateAll,
  };
}

export { QUESTION_TYPES, MULTI_VALUE_TYPES, emptyValue, isBlank };
