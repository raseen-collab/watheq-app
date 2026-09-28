/* تلخيص قياسات انحراف الساعة.
   npx esbuild lib/clock-diag.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/clock-diag.js */
const { parseHttpDate, summarize } = require("/tmp/b/clock-diag.js");

let fails = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log(`❌ ${name}\n   نتج: ${g}\n   المتوقع: ${w}`); }
  else console.log(`✓ ${name}`);
};

/* ═══ 1) قراءة ترويسة Date ═══ */
eq("صيغة RFC تُقرأ", parseHttpDate("Mon, 28 Sep 2026 14:30:48 GMT"), 1790605848);
eq("الفارغ يُرجع null", parseHttpDate(""), null);
eq("null يُرجع null", parseHttpDate(null), null);
eq("نص غير تاريخ يُرجع null", parseHttpDate("لا تاريخ"), null);

/* ═══ 2) الحكم: الحاسم أن السبق الموجب لا يُطمَس ═══ */

/* قياس واحد موجب بين تسعة أصفار: النافذة موجودة فعلًا، والوسيط يخفيها.
   لهذا التصنيف بالأقصى — وهذا هو جوهر الملف. */
const one = summarize([0, 0, 0, 0, +2, 0, 0, 0, 0]);
eq("سبق موجب واحد لا يُطمَس بالوسيط", [one.verdict, one.max, one.median], ["positive-skew", 2, 0]);

const all = summarize([3, 3, 4, 3, 3]);
eq("سبق ثابت يُصنَّف موجبًا بأقصاه", [all.verdict, all.max, all.mode], ["positive-skew", 4, 3]);

const none = summarize([0, -1, 0, 0, -1]);
eq("لا سبق موجب", none.verdict, "sub-second");

const clean = summarize([0, 0, 0, 0]);
eq("أصفار خالصة: لا سبق", [clean.verdict, clean.min, clean.max], ["no-positive-skew", 0, 0]);

const behind = summarize([-2, -3, -2]);
eq("المصادقة متأخرة: لا سبق", behind.verdict, "no-positive-skew");

const empty = summarize([]);
eq("بلا قياسات", [empty.verdict, empty.n, empty.min], ["no-data", 0, null]);

/* ═══ 3) الإحصاء ═══ */
eq("الوسيط لعدد فردي", summarize([1, 5, 3]).median, 3);
eq("الوسيط لعدد زوجي", summarize([1, 3, 5, 7]).median, 4);
eq("الأقصى والأدنى", [summarize([-4, 0, 7, 2]).min, summarize([-4, 0, 7, 2]).max], [-4, 7]);
eq("الأكثر تكرارًا", summarize([1, 1, 1, 9]).mode, 1);
eq("غير الرقمي يُستبعد", summarize([1, NaN, 2, Infinity]).n, 2);

/* ═══ 4) السطر المعروض يذكر الرقم الذي يُلصق في التذكرة ═══ */
const lbl = summarize([0, 0, +3]).label;
eq("السطر يذكر الأقصى", /3 ثانية/.test(lbl), true);
eq("السطر يذكر سبب العطل", /JWT issued at future/.test(lbl), true);

console.log(fails ? `\n❌ ${fails} فشل` : "\n✅ التلخيص لا يطمس سبقًا موجبًا ولو وقع مرة واحدة");
process.exit(fails ? 1 : 0);
