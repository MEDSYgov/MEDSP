/*
  اختبارات محرك التعابير الشرطية.
  التشغيل: node src/survey/__tests__/expression.test.mjs
*/
import { evaluateExpression as ev, checkExpression, dependencies } from '../expression.js';

const ctx = {
  age: 25, status: 'married', services: ['water', 'power'],
  household: [1, 2, 3, 4], name: '', dob: '2000-05-10', a: 5, b: 10, nums: [],
  t1: '08:00', t2: '10:30', units: [{ type: 'w', h: 2 }, { type: 't', h: 3.5 }, { type: 't', h: 1 }],
};

const cases = [
  ['${age} >= 18', true],
  ['hours_between(${t1}, ${t2}) = 2.5', true],
  ['hours_between(${t2}, ${t1}) < 0', true],
  ["repeat_sum_where(${units}, 'h', 'type', 't') = 4.5", true],
  ["${age} >= 18 and ${status} = 'married'", true],
  ["${age} < 18 or ${status} = 'single'", false],
  ["selected(${services}, 'water')", true],
  ["selected(${services}, 'gas')", false],
  ['count(${household}) > 3', true],
  ['empty(${name})', true],
  ['answered(${name})', false],
  ['not(${age} > 30)', true],
  ['not ${age} > 30', true],
  ['not ${age} = 25', false],
  ['(${age} + 5) * 2 = 60', true],
  ['${age} != 25', false],
  ["one_of(${status}, 'single', 'married')", true],
  ["if(${age} > 20, 'كبير', 'صغير') = 'كبير'", true],
  ['age(${dob}) >= 25', true],
  ["contains(${status}, 'marr')", true],
  ["${missing_field} = ''", true],
  ['${a} * -2 = -10', true],
  ['${b} div ${a} = 2', true],
  ['sum(${nums}) = 0', true],
];

let pass = 0;
const failures = [];
for (const [src, want] of cases) {
  const got = ev(src, ctx, '__ERROR__');
  if (got === want) pass += 1;
  else failures.push(`${src}  →  ${JSON.stringify(got)} (المتوقع ${want})`);
}

/* لا يجوز أن ينفّذ المحرك كوداً عشوائياً */
const malicious = checkExpression("constructor.constructor('return 1')()");
if (malicious.valid) failures.push('ثغرة أمنية: قُبل تعبير خبيث');
else pass += 1;

if (dependencies("${age} > 18 and selected(${svc},'w')").join() !== 'age,svc') {
  failures.push('استخراج التبعيات غير صحيح');
} else pass += 1;

console.log(`نجح ${pass} / ${cases.length + 2}`);
if (failures.length) {
  console.error('\nإخفاقات:');
  failures.forEach((f) => console.error('  ' + f));
  process.exit(1);
}
