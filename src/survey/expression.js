/*
  محرّك التعابير الشرطية.

  يُستخدم في relevant (إظهار سؤال شرطياً) و constraint (قيد على الإجابة)
  و required الشرطي.

  مثال: "${age} >= 18 and ${status} = 'married'"
        "selected(${services}, 'water')"
        "count(${household}) > 3"

  ملاحظة أمنية مهمة: لا نستخدم eval أو new Function إطلاقاً.
  تعريف الاستبيان قد يأتي من قاعدة البيانات أو من مستخدم يبني استبياناً،
  فتمريره إلى eval يعني تنفيذ كود عشوائي في متصفح كل من يعبّي الاستبيان.
  بدلاً من ذلك: محلّل (tokenizer + parser) يبني شجرة، ثم نقيّمها.
*/

/* ---------------- التحليل اللفظي ---------------- */

const OPERATORS = [
  '!=', '>=', '<=', '=', '>', '<', '+', '-', '*', '/', '(', ')', ',',
];

/* div و mod تُترجم إلى رموزها، فتأخذ أسبقيتها تلقائياً من PRECEDENCE */
const KEYWORDS = { and: 'and', or: 'or', not: 'not', div: '/', mod: '%' };

function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) { i += 1; continue; }

    /* مرجع حقل: ${name} */
    if (ch === '$' && input[i + 1] === '{') {
      const end = input.indexOf('}', i + 2);
      if (end === -1) throw new Error('مرجع حقل غير مغلق: ينقص }');
      tokens.push({ kind: 'field', value: input.slice(i + 2, end).trim() });
      i = end + 1;
      continue;
    }

    /* نص بين علامتي اقتباس */
    if (ch === "'" || ch === '"') {
      const end = input.indexOf(ch, i + 1);
      if (end === -1) throw new Error('نص غير مغلق: ينقص علامة اقتباس');
      tokens.push({ kind: 'string', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    /* رقم */
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      tokens.push({ kind: 'number', value: Number(input.slice(i, j)) });
      i = j;
      continue;
    }

    /* اسم: كلمة مفتاحية أو دالة */
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j += 1;
      const word = input.slice(i, j);
      const lower = word.toLowerCase();
      if (lower in KEYWORDS) tokens.push({ kind: 'op', value: KEYWORDS[lower] });
      else tokens.push({ kind: 'name', value: word });
      i = j;
      continue;
    }

    /* معامل رمزي */
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ kind: 'op', value: op });
      i += op.length;
      continue;
    }

    throw new Error(`رمز غير مفهوم "${ch}" في الموضع ${i}`);
  }

  return tokens;
}

/* ---------------- التحليل النحوي ---------------- */
/* أسبقية المعاملات من الأضعف للأقوى */

const PRECEDENCE = {
  or: 1,
  and: 2,
  '=': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
};

function parse(tokens) {
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const tok = next();
    if (!tok) throw new Error('تعبير ناقص');

    if (tok.kind === 'number') return { node: 'literal', value: tok.value };
    if (tok.kind === 'string') return { node: 'literal', value: tok.value };
    if (tok.kind === 'field') return { node: 'field', name: tok.value };

    /* نفي — يشمل المقارنة كاملة مثل XPath: not ${a} > 5  ≡  not(${a} > 5) */
    if (tok.kind === 'op' && tok.value === 'not') {
      const arg = parseExpression(PRECEDENCE['=']);
      return { node: 'not', arg };
    }

    /* سالب أحادي — يربط بقوة أعلى من الضرب */
    if (tok.kind === 'op' && tok.value === '-') {
      const arg = parseExpression(6);
      return { node: 'neg', arg };
    }

    /* قوس */
    if (tok.kind === 'op' && tok.value === '(') {
      const inner = parseExpression(0);
      const close = next();
      if (!close || close.value !== ')') throw new Error('ينقص قوس إغلاق');
      return inner;
    }

    /* دالة أو ثابت منطقي */
    if (tok.kind === 'name') {
      const lower = tok.value.toLowerCase();
      if (lower === 'true') return { node: 'literal', value: true };
      if (lower === 'false') return { node: 'literal', value: false };
      if (lower === 'null') return { node: 'literal', value: null };

      if (peek() && peek().value === '(') {
        next();
        const args = [];
        if (peek() && peek().value !== ')') {
          for (;;) {
            args.push(parseExpression(0));
            if (peek() && peek().value === ',') { next(); continue; }
            break;
          }
        }
        const close = next();
        if (!close || close.value !== ')') throw new Error(`ينقص قوس إغلاق للدالة ${tok.value}`);
        return { node: 'call', name: lower, args };
      }
      throw new Error(`اسم غير معروف "${tok.value}" — المراجع تُكتب بصيغة \${name}`);
    }

    throw new Error(`رمز غير متوقع "${tok.value}"`);
  }

  function parseExpression(minPrec) {
    let left = parsePrimary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.kind !== 'op') break;
      const prec = PRECEDENCE[tok.value];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = parseExpression(prec + 1);
      left = { node: 'binary', op: tok.value, left, right };
    }
    return left;
  }

  const tree = parseExpression(0);
  if (pos < tokens.length) {
    throw new Error(`رموز زائدة بعد نهاية التعبير: "${tokens[pos].value}"`);
  }
  return tree;
}

/* ---------------- الدوال المتاحة ---------------- */

const asArray = (v) => (Array.isArray(v) ? v : v === '' || v == null ? [] : [v]);
const asNumber = (v) => {
  if (Array.isArray(v)) return v.length;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const FUNCTIONS = {
  /* هل اختيار متعدد يحوي قيمة معينة */
  selected: (args) => asArray(args[0]).map(String).includes(String(args[1])),
  /* عدد عناصر (اختيار متعدد أو مجموعة متكررة) */
  count: (args) => asArray(args[0]).length,
  /* هل الحقل فارغ */
  empty: (args) => {
    const v = args[0];
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.values(v).every((x) => !x);
    return String(v).trim() === '';
  },
  /* عكس empty */
  answered: (args) => !FUNCTIONS.empty(args),
  /* طول النص */
  len: (args) => String(args[0] ?? '').length,
  /* رياضيات */
  round: (args) => Math.round(asNumber(args[0])),
  min: (args) => Math.min(...args.map(asNumber)),
  max: (args) => Math.max(...args.map(asNumber)),
  sum: (args) => asArray(args[0]).reduce((a, b) => a + asNumber(b), 0),
  /* اليوم بصيغة YYYY-MM-DD */
  today: () => new Date().toISOString().slice(0, 10),
  /* فرق بالأيام بين تاريخين */
  days_between: (args) => {
    const a = new Date(args[0]);
    const b = new Date(args[1]);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    return Math.round((b - a) / 86400000);
  },
  /* العمر بالسنوات من تاريخ ميلاد */
  age: (args) => {
    const d = new Date(args[0]);
    if (Number.isNaN(d.getTime())) return 0;
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years -= 1;
    return years;
  },
  /* مجموع حقل داخل مجموعة متكررة: repeat_sum(${household}, 'members') */
  repeat_sum: (args) => asArray(args[0]).reduce((a, row) => a + asNumber(row?.[args[1]]), 0),
  /* عدد صفوف مجموعة متكررة تحقق فيها حقل قيمة معينة */
  repeat_count: (args) => asArray(args[0])
    .filter((row) => args[1] === undefined || String(row?.[args[1]]) === String(args[2])).length,
  /*
    نسبة مئوية مقرّبة لخانة واحدة. المقام صفر ← غير معرّفة (فارغة) لا صفر:
    مشروع بلا كمية مخططة ليس «متعثراً بنسبة 0%».
  */
  percent: (args) => {
    const b = asNumber(args[1]);
    return b === 0 ? '' : Math.round((asNumber(args[0]) / b) * 1000) / 10;
  },
  /* ساعات بين وقتين «HH:MM» (قد تكون سالبة إن كان الإيقاف قبل البدء): hours_between(${start}, ${end}) */
  hours_between: (args) => {
    const m = (t) => { const x = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
    const a = m(args[0]); const b = m(args[1]);
    if (a === null || b === null) return 0;
    return Math.round(((b - a) / 60) * 100) / 100;
  },
  /* مجموع حقل في صفوف مجموعة متكررة تحقق شرطاً: repeat_sum_where(${units}, 'hours', 'type', 'مجنزر') */
  repeat_sum_where: (args) => asArray(args[0])
    .filter((row) => String(row?.[args[2]]) === String(args[3]))
    .reduce((a, row) => a + asNumber(row?.[args[1]]), 0),
  /* شرط ثلاثي */
  if: (args) => (truthy(args[0]) ? args[1] : args[2]),
  /* تطابق نصي جزئي */
  contains: (args) => String(args[0] ?? '').includes(String(args[1] ?? '')),
  /* قيمة ضمن مجموعة */
  one_of: (args) => args.slice(1).map(String).includes(String(args[0])),
};

function truthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v).some(Boolean);
  return String(v).trim() !== '' && String(v) !== '0' && String(v) !== 'false';
}

/* ---------------- التقييم ---------------- */

function compare(op, a, b) {
  /* مقارنة رقمية إن أمكن، وإلا نصية */
  const na = Number(a);
  const nb = Number(b);
  const numeric = a !== '' && b !== '' && a != null && b != null
    && Number.isFinite(na) && Number.isFinite(nb);
  const [x, y] = numeric ? [na, nb] : [String(a ?? ''), String(b ?? '')];

  switch (op) {
    case '=': return x === y;
    case '!=': return x !== y;
    case '<': return x < y;
    case '>': return x > y;
    case '<=': return x <= y;
    case '>=': return x >= y;
    default: throw new Error(`معامل مقارنة غير معروف ${op}`);
  }
}

function evaluate(tree, context) {
  switch (tree.node) {
    case 'literal':
      return tree.value;

    case 'field': {
      const v = context[tree.name];
      return v === undefined ? '' : v;
    }

    case 'not':
      return !truthy(evaluate(tree.arg, context));

    case 'neg':
      return -asNumber(evaluate(tree.arg, context));

    case 'call': {
      const fn = FUNCTIONS[tree.name];
      if (!fn) throw new Error(`دالة غير معروفة "${tree.name}"`);
      /* if تحتاج تقييماً كسولاً لتجنب أخطاء الفرع غير المستخدم */
      const args = tree.args.map((a) => evaluate(a, context));
      return fn(args);
    }

    case 'binary': {
      const { op } = tree;
      if (op === 'and') {
        return truthy(evaluate(tree.left, context)) && truthy(evaluate(tree.right, context));
      }
      if (op === 'or') {
        return truthy(evaluate(tree.left, context)) || truthy(evaluate(tree.right, context));
      }
      const a = evaluate(tree.left, context);
      const b = evaluate(tree.right, context);
      if (['=', '!=', '<', '>', '<=', '>='].includes(op)) return compare(op, a, b);
      const na = asNumber(a);
      const nb = asNumber(b);
      switch (op) {
        case '+': return na + nb;
        case '-': return na - nb;
        case '*': return na * nb;
        case '/': return nb === 0 ? 0 : na / nb;
        case '%': return nb === 0 ? 0 : na % nb;
        default: throw new Error(`معامل غير معروف ${op}`);
      }
    }

    default:
      throw new Error('عقدة غير معروفة في شجرة التعبير');
  }
}

/* ---------------- الواجهة العامة ---------------- */

const cache = new Map();

export function compileExpression(source) {
  if (cache.has(source)) return cache.get(source);
  const compiled = parse(tokenize(source));
  cache.set(source, compiled);
  return compiled;
}

/* استخراج أسماء الحقول التي يعتمد عليها تعبير — لمعرفة متى نعيد الحساب */
export function dependencies(source) {
  const found = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.node === 'field') found.add(n.name);
    ['arg', 'left', 'right'].forEach((k) => walk(n[k]));
    (n.args || []).forEach(walk);
  };
  try {
    walk(compileExpression(source));
  } catch {
    /* تعبير معطوب — لا تبعيات */
  }
  return [...found];
}

/*
  تقييم تعبير. عند وجود خطأ في التعبير نُرجع القيمة الاحتياطية
  بدل رمي استثناء، حتى لا يتعطّل الاستبيان كله بسبب سؤال واحد معطوب.
  onError يسمح للواجهة بعرض التحذير للمشرف.
*/
export function evaluateExpression(source, context, fallback = false, onError) {
  if (source === undefined || source === null || source === '') return fallback;
  if (typeof source === 'boolean') return source;
  try {
    return evaluate(compileExpression(source), context);
  } catch (err) {
    if (onError) onError(err, source);
    return fallback;
  }
}

export function isTruthy(value) {
  return truthy(value);
}

/* فحص صلاحية تعبير — يُستخدم في باني الاستبيانات */
export function checkExpression(source) {
  try {
    compileExpression(source);
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
