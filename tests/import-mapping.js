/* «طابق أعمدتك» — مطابقة أعمدة ملف المكتب قبل المعاينة (9 أكتوبر 2026).
   يُبنى أولًا: npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
   وللمقارنة بالسلوك السابق (اختياري): نسخة ما قبل التعديل في /tmp/b/importParse-old.js */
const P = require("/tmp/b/importParse.js");
let OLD = null; try { OLD = require("/tmp/b/importParse-old.js"); } catch {}

let fails = 0, passes = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log(`❌ ${name}\n   نتج: ${g}\n   المتوقع: ${w}`); } else passes++;
};
const TODAY = "2026-10-09";
const props = [{ id: "p1", name: "عمارة الندى", property_type: "building" }];
const parse = (grid, opts) => P.parseGrid(grid, props, TODAY, opts);
const pick = (r) => ({ rent: r.rent_amount, freq: r.payment_frequency, paid: r.paid_periods, err: r._error || null });

/* ---------- 1) لا تغيير على الملفات القائمة بلا خيارات ---------- */
const H = P.HEADERS;
const grids = {
  template: [H, ["عبدالله", "101", "2500", "شهري", "2026-01-01", "12", "501234567", "1012345678", "8", ""],
                ["مؤسسة النور", "2", "18000", "كل 3 اشهر", "2026-02-15", "4", "0559876543", "", "2", ""]],
  oldNoHeader: [["خالد", "5", "60000", "سنوي", "2025-06-01", "3", "", "", "1"]],
  renamed: [["المستأجر", "الشقة", "الإيجار", "الدورة", "البداية", "عدد الدفعات", "الجوال", "المسدد"],
            ["سعد", "7", "30000", "سنوي", "1447/01/01", "2", "0500000000", "1"],
            ["فهد", "8", "3000", "شهري", "2026-03-01", "12", "", "5"]],
  errors: [H, ["", "1", "100", "شهري"], ["أ", "2", "abc", "شهري"], ["ب", "3", "100", "كل اسبوعين"],
              ["ج", "4", "100", ""], ["د", "5", "100", "شهري", "2026-13-45"], ["هـ", "6", "100", "شهري", "2026-01-01", "3", "", "", "5"]],
  withProp: [H, ["س", "1", "1000", "شهري", "2026-01-01", "12", "", "", "0", "عمارة الندى"], ["ص", "2", "1000", "شهري", "2026-01-01", "12", "", "", "0", "مجهول"]],
  annualHeader: [["اسم المستأجر", "رقم الوحدة", "الإيجار السنوي", "دورة السداد"], ["ع", "1", "30000", "كل 3 اشهر"]],
};
if (OLD) {
  for (const k of ["template", "oldNoHeader", "renamed", "errors", "withProp"]) {
    const a = OLD.parseGrid(grids[k], props, TODAY), b = P.parseGrid(grids[k], props, TODAY);
    eq(`بلا خيارات = السلوك السابق: ${k}`, b.rows.map(({ _note, ...r }) => r), a.rows);
    eq(`بلا خيارات = نفس معلومات الأعمدة: ${k}`, b.info, a.info);
  }
}
// «الإيجار السنوي» كان يُتجاهل فيفشل الملف كله؛ الآن يُقرأ ويُحوَّل بحسبة ظاهرة
{
  const r = parse(grids.annualHeader).rows[0];
  eq("الإيجار السنوي يُقسم على دفعات السنة", pick(r), { rent: 7500, freq: "quarterly", paid: 0, err: null });
  eq("الحسبة ظاهرة", r._note, "الدفعة = السنوي 30,000 ÷ 4 = 7,500");
}

/* ---------- 2) التحليل: متى نسأل ومتى لا ---------- */
{
  const a = P.analyzeColumns(grids.template);
  eq("قالبنا: لا أسباب", a.reasons, []);
  eq("قالبنا: لا مشاكل", P.mappingProblems(P.initialConfig(a)), []);
  eq("قالبنا: الأساس محسوم من العنوان", [a.rentHint, a.paidHint], ["payment", "count"]);
}
{
  const a = P.analyzeColumns(grids.renamed);
  eq("«الإيجار» العام لا يُحسم", a.rentHint, null);
  eq("«المسدد» العام لا يُحسم", a.paidHint, null);
  eq("القيم الصغيرة توحي بعدد دفعات", a.paidSuggest, "count");
  const pr = P.mappingProblems(P.initialConfig(a));
  eq("يُسأل عن أساس الإيجار والمسدد", pr.length, 2);
}
{
  // كل العقود سنوية: الدفعة = الإيجار السنوي، فلا داعي للسؤال
  const g = [["المستأجر", "الإيجار", "الدورة"], ["أ", "40000", "سنوي"], ["ب", "50000", "سنويا"]];
  const a = P.analyzeColumns(g);
  eq("كلها سنوية: الأساس لا يهم", a.rentMatters, false);
  eq("كلها سنوية: لا مشاكل", P.mappingProblems(P.initialConfig(a)), []);
}
{
  const a = P.analyzeColumns(grids.oldNoHeader);
  eq("بلا عناوين: وضع الموضع", a.mode, "position");
  eq("بلا عناوين: نسأل", a.reasons.length, 1);
  eq("بلا عناوين: الاقتراح بترتيب القالب", a.fields.slice(0, 4), ["name", "unit", "rent", "freq"]);
}
{
  // عمود مجهول فيه بيانات = سؤال؛ عمود الملاحظة وعمود فارغ = لا
  const g = [["اسم المستأجر", "قيمة الدفعة", "دورة السداد", "الحي", "", P.NOTE_HEADER, "فارغ"],
             ["أ", "1000", "شهري", "العزيزية", "x", "", ""]];
  const a = P.analyzeColumns(g);
  eq("عمود مجهول وعمود بلا عنوان فيهما بيانات", a.reasons, ["أعمدة فيها بيانات لم نتعرّف عليها: الحي، العمود E"]);
}
{
  const g = [["الاسم", "قيمة الدفعة", "دورة السداد", "المسدد"], ["أ", "1000", "شهري", "15000"], ["ب", "1000", "شهري", "0"]];
  eq("مبلغ كبير في «المسدد» يوحي بأنه مبلغ", P.analyzeColumns(g).paidSuggest, "amount");
}

/* ---------- 3) mappingProblems ---------- */
{
  const base = { fields: ["name", "rent", "freq"], headerRow: true, rentBasis: "payment", paidBasis: null, defFreq: null, defCal: null };
  eq("الحد الأدنى يكفي", P.mappingProblems(base), []);
  eq("بلا اسم", P.mappingProblems({ ...base, fields: [null, "rent", "freq"] }), ["حدّد عمود «اسم المستأجر»"]);
  eq("بلا دورة ولا قيمة ثابتة", P.mappingProblems({ ...base, fields: ["name", "rent", null] }).length, 1);
  eq("بلا عمود دورة مع قيمة ثابتة", P.mappingProblems({ ...base, fields: ["name", "rent", null], defFreq: "monthly" }), []);
  eq("حقل لعمودين", P.mappingProblems({ ...base, fields: ["name", "rent", "freq", "name"] }).length, 1);
  eq("المسدد بلا أساس", P.mappingProblems({ ...base, fields: ["name", "rent", "freq", "paid"] }).length, 1);
  eq("الإيجار بلا أساس", P.mappingProblems({ ...base, rentBasis: null }).length, 1);
}

/* ---------- 4) التحويل بعد المطابقة ---------- */
const office = [
  ["الساكن", "رقم الشقة", "الإيجار", "طريقة الدفع", "تاريخ العقد", "المدة", "المسدد", "ملاحظات"],
  ["أ", "1", "30000", "كل 3 اشهر", "2026-01-01", "4", "15000", "-"],
  ["ب", "2", "24000", "شهري", "2026-01-01", "12", "18000", ""],
  ["ج", "3", "36000", "نصف سنوي", "2026-01-01", "2", "40000", ""],
  ["د", "4", "10000", "كل 3 اشهر", "2026-01-01", "4", "0", ""],
  ["هـ", "5", "1000", "اسبوعي", "2026-01-01", "", "", ""],
];
const fields = ["name", "unit", "rent", "freq", "start", "periods", "paid", null];
const cfg = (o) => P.configToOptions({ fields, headerRow: true, rentBasis: "annual", paidBasis: "amount", defFreq: null, defCal: null, ...o });
{
  const rows = parse(office, cfg()).rows;
  eq("سنوي ربعي ومسدَّد نصفه", pick(rows[0]), { rent: 7500, freq: "quarterly", paid: 2, err: null });
  eq("سنوي شهري ومسدَّد 9 أشهر", pick(rows[1]), { rent: 2000, freq: "monthly", paid: 9, err: null });
  eq("مسدَّد أكثر من العقد = خطأ لا رقم صامت", rows[2]._error.startsWith("المبلغ المسدَّد 40,000 أكثر من قيمة العقد"), true);
  eq("مسدَّد صفر", pick(rows[3]), { rent: 2500, freq: "quarterly", paid: 0, err: null });
  eq("سنوي أسبوعي يُقرَّب للهللة", rows[4].rent_amount, 19.23);
  eq("التقريب ظاهر", /مقرَّبة/.test(rows[4]._note), true);
  eq("ملاحظة التحويل والمسدَّد", rows[0]._note, "الدفعة = السنوي 30,000 ÷ 4 = 7,500 · المسدَّد 15,000 = 2 دفعات كاملة");
  eq("معلومات المطابقة اليدوية", parse(office, cfg()).info.mode, "manual");
  eq("الأعمدة غير المختارة تُذكر", parse(office, cfg()).info.ignored, ["ملاحظات"]);
}
{
  // مبلغ جزئي: لا يُقرَّب لدفعة كاملة — يُعدّ الكامل ويُنبَّه على الباقي
  const g = [["الاسم", "الدفعة", "الدورة", "المسدد", "عدد الدفعات"], ["أ", "2500", "شهري", "10000", "12"], ["ب", "2500", "شهري", "31000", "12"]];
  const o = P.configToOptions({ fields: ["name", "rent", "freq", "paid", "periods"], headerRow: true, rentBasis: "payment", paidBasis: "amount", defFreq: null, defCal: null });
  const rows = parse(g, o).rows;
  eq("مسدَّد 10,000 من 2,500 = 4", rows[0].paid_periods, 4);
  eq("مسدَّد 31,000 = 12 + 1,000 جزئي", rows[1].paid_periods, 12);
  eq("الجزئي فوق آخر دفعة = أكثر من العقد", !!rows[1]._error, true);
  const g2 = [["الاسم", "الدفعة", "الدورة", "المسدد"], ["أ", "2500", "شهري", "11000"]];
  const r2 = parse(g2, P.configToOptions({ fields: ["name", "rent", "freq", "paid"], headerRow: true, rentBasis: "payment", paidBasis: "amount", defFreq: null, defCal: null })).rows[0];
  eq("11,000 = 4 + 1,000 جزئي", [r2.paid_periods, r2._error || null], [4, null]);
  eq("الجزئي مذكور", /1,000 جزئي/.test(r2._note), true);
}
{
  // شهري → ربعي، وشهري → شهري بلا ملاحظة
  const g = [["الاسم", "الإيجار الشهري", "الدورة"], ["أ", "3000", "كل 3 اشهر"], ["ب", "3000", "شهري"]];
  const rows = parse(g).rows;
  eq("الإيجار الشهري بعنوانه: ربعي = ×3", rows[0].rent_amount, 9000);
  eq("الإيجار الشهري لعقد شهري = نفسه", [rows[1].rent_amount, rows[1]._note || null], [3000, null]);
}
{
  // ملف بلا عمود دورة: قيمة ثابتة لكل الصفوف، والخانة المكتوبة تتقدّم عليها
  const g = [["الاسم", "قيمة الدفعة", "البداية"], ["أ", "2000", "1447/03/01"], ["ب", "2000", "2026-01-01"]];
  const bad = parse(g, P.configToOptions({ fields: ["name", "rent", "start"], headerRow: true, rentBasis: "payment", paidBasis: null, defFreq: null, defCal: null })).rows;
  eq("بلا دورة ولا قيمة = خطأ لكل صف", bad.every((r) => r._error === "دورة السداد مفقودة"), true);
  const ok = parse(g, P.configToOptions({ fields: ["name", "rent", "start"], headerRow: true, rentBasis: "payment", paidBasis: null, defFreq: "monthly", defCal: "gregorian" })).rows;
  eq("القيمة الثابتة تُطبَّق", ok.map((r) => [r.payment_frequency, r._error || null]), [["monthly", null], ["monthly", null]]);
  eq("التقويم الثابت يُطبَّق حتى على تاريخ هجري", ok[0].calendar, "gregorian");
  const auto = parse(g, P.configToOptions({ fields: ["name", "rent", "start"], headerRow: true, rentBasis: "payment", paidBasis: null, defFreq: "monthly", defCal: null })).rows;
  eq("بلا تقويم ثابت: يُكتشف من التاريخ", auto.map((r) => r.calendar), ["hijri", "gregorian"]);
  const g2 = [["الاسم", "قيمة الدفعة", "الدورة"], ["أ", "2000", "سنوي"], ["ب", "2000", ""]];
  const mix = parse(g2, P.configToOptions({ fields: ["name", "rent", "freq"], headerRow: true, rentBasis: "payment", paidBasis: null, defFreq: "monthly", defCal: null })).rows;
  eq("الخانة المكتوبة تتقدّم، والفارغة تأخذ الثابتة", mix.map((r) => r.payment_frequency), ["annual", "monthly"]);
}
{
  // ملف بلا عناوين + مطابقة يدوية بأعمدة مبعثرة: الصف الأول بيانات لا يضيع
  const g = [["0501112222", "أحمد", "سنوي", "45000", "A1"], ["0503334444", "سالم", "شهري", "2000", "A2"]];
  const o = P.configToOptions({ fields: ["phone", "name", "freq", "rent", "unit"], headerRow: false, rentBasis: "payment", paidBasis: null, defFreq: null, defCal: null });
  const rows = parse(g, o).rows;
  eq("بلا عناوين: كل الصفوف بيانات", rows.map((r) => [r.name, r.unit, r.rent_amount, r.payment_frequency, r.phone]),
    [["أحمد", "A1", 45000, "annual", "0501112222"], ["سالم", "A2", 2000, "monthly", "0503334444"]]);
  eq("بلا عناوين: الأسماء بأحرف الأعمدة", parse(g, o).info.recognized[0], "العمود A ← الجوال");
}
{
  // ترتيب أعمدة مختلف تمامًا عن القالب: لا قراءة بالموضع
  const g = [["الجوال", "قيمة الدفعة", "اسم المستأجر", "دورة السداد"], ["0500000000", "1500", "نورة", "شهري"]];
  const r = parse(g).rows[0];
  eq("عناوين بترتيب آخر تُقرأ بالاسم", [r.name, r.rent_amount, r.phone], ["نورة", 1500, "0500000000"]);
}

/* ---------- 5) أدوات مساعدة ---------- */
eq("أحرف الأعمدة", [0, 25, 26, 27, 51, 52].map(P.columnLetter), ["A", "Z", "AA", "AB", "AZ", "BA"]);
{
  const g = [P.HEADERS.concat([P.NOTE_HEADER]), ["مثال", "1", "1", "شهري", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", P.EXAMPLE_MARK], ["فعلي", "2", "100", "شهري"]];
  eq("العينات تتخطى صفوف «مثال»", P.columnSamples(g, true, 3, 3), [["فعلي"], ["2"], ["100"]]);
}
{
  const a = P.analyzeColumns(grids.renamed);
  const good = { ...P.initialConfig(a), rentBasis: "annual", paidBasis: "count" };
  eq("المطابقة المحفوظة الصالحة تُقبل", !!P.validSavedConfig(a, JSON.parse(JSON.stringify(good))), true);
  eq("محفوظة بعرض آخر تُرفض", P.validSavedConfig(a, { ...good, fields: good.fields.slice(1) }), null);
  eq("محفوظة بحقل مجهول تُرفض", P.validSavedConfig(a, { ...good, fields: good.fields.map((f, i) => i ? f : "hack") }), null);
  eq("محفوظة بأساس مجهول تُرفض", P.validSavedConfig(a, { ...good, rentBasis: "weird" }), null);
  eq("محفوظة تالفة تُرفض", P.validSavedConfig(a, "x"), null);
  eq("البصمة تتبع العناوين", P.headerSignature(a) === P.headerSignature(P.analyzeColumns(grids.renamed.slice(0, 1))), true);
}
eq("أساس الإيجار من العناوين", ["قيمة الدفعة", "الإيجار السنوي", "الايجار الشهري", "القسط", "الإيجار", "rent", "Annual Rent"].map(P.rentBasisFromHeader),
  ["payment", "annual", "monthly", "payment", null, null, "annual"]);
eq("الأساس بين قوسين يُقرأ", [P.rentBasisFromHeader("الإيجار (سنوي)"), P.paidBasisFromHeader("المسدد (ريال)"), P.paidBasisFromHeader("المسدد (عدد الدفعات)")],
  ["annual", "amount", "count"]);
eq("أساس المسدَّد من العناوين", ["الدفعات المسدّدة", "المبلغ المسدد", "المدفوع", "المسدد", "paid", "paid periods"].map(P.paidBasisFromHeader),
  ["count", "amount", "amount", null, null, "count"]);

/* ---------- تاريخ إكسل في توقيت الرياض (شغّله أيضًا بـ TZ=Asia/Riyadh) ---------- */
{
  // ما يخرجه SheetJS 0.18.5 لخلية 2026-01-01 في الرياض: 2025-12-31 23:59:08 بالتوقيت المحلي
  const skew = new Date(2025, 11, 31, 23, 59, 8);
  const exact = new Date(2026, 0, 1, 0, 0, 0);
  const noon = new Date(2026, 6, 15, 12, 0, 0);
  eq("تاريخ إكسل المنزاح ثواني يعود ليومه", P.gridFromSheetRows([[skew, exact, noon]])[0], ["2026-01-01", "2026-01-01", "2026-07-15"]);
}

/* ---------- 6) ملف كبير: لا تباطؤ ---------- */
{
  const big = [office[0]];
  for (let i = 0; i < 5000; i++) big.push([`م${i}`, String(i), "36000", "كل 3 اشهر", "2026-01-01", "4", String((i % 4) * 9000), ""]);
  const t = Date.now();
  const a = P.analyzeColumns(big);
  const rows = parse(big, cfg()).rows;
  const ms = Date.now() - t;
  eq("5000 صف كلها صالحة", rows.filter((r) => r._error).length, 0);
  eq("5000 صف المسدَّد صحيح", rows.slice(0, 4).map((r) => r.paid_periods), [0, 1, 2, 3]);
  if (ms > 3000) { fails++; console.log(`❌ بطيء: ${ms}ms`); }
  void a;
}

console.log(fails ? `\n${fails} ❌ · ${passes} ✅` : `✅ مطابقة الأعمدة: ${passes} فحصًا ناجحًا${OLD ? " (مع مقارنة السلوك السابق)" : ""}`);
process.exit(fails ? 1 : 0);
