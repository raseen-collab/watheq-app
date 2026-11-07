/* ملفات المكاتب الحقيقية كما تأتي — لا قالب وثيق (7 نوفمبر 2026)
   تشغيل: npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
           TZ=Asia/Riyadh node tests/import-office-files.js */
const P = require("/tmp/b/importParse.js");
let ok = 0, bad = 0;
const t = (name, cond, extra) => { if (cond) ok++; else { bad++; console.log("✗", name, extra === undefined ? "" : JSON.stringify(extra)); } };
const TODAY = "2026-11-07";
function pipeline(grid, props = []) {
  const p = P.prepareGrid(grid);
  const a = P.analyzeColumns(p.grid);
  const c = P.initialConfig(a);
  const probs = P.mappingProblems(c);
  const sure = !probs.length && !a.reasons.length;
  const res = sure ? P.parseGrid(p.grid, props, TODAY, { rentBasis: c.rentBasis || undefined, paidBasis: c.paidBasis || undefined }) : { rows: [] };
  return { p, a, c, probs, sure, rows: res.rows };
}

/* ١) ملف مكتب نموذجي: عنوان + سطر فارغ + «م» + سنوي + «طريقة الدفع» + هجري + نهاية العقد + مسدد مبلغ + ملاحظات + مجموع */
{
  const g = [["كشف مستأجري عمارة الياسمين — 1448هـ"], [], ["م", "اسم المستأجر", "رقم الشقة", "الإيجار السنوي", "طريقة الدفع", "تاريخ بداية العقد", "تاريخ نهاية العقد", "المسدد", "الجوال", "ملاحظات"],
    ["1", "محمد", "1", "24,000", "شهري", "1447/01/01", "1448/01/01", "0", "0550000000", ""],
    ["2", "سعد", "2", "25000", "ربع سنوي", "1447/02/01", "1448/02/01", "6000", "+966 55 000 0007", "متأخر"],
    ["3", "فهد", "3", "26000", "دفعتين", "1447/03/01", "1448/03/01", "13,000", "00966550000014", ""],
    ["4", "نورة", "4", "27000", "سنويا", "1447/04/01", "1448/04/01", "0", "966550000021", ""],
    [], ["", "الإجمالي", "", "102,000", "", "", "", "19,000", "", ""]];
  const r = pipeline(g);
  t("office: goes straight to preview", r.sure, { reasons: r.a.reasons, probs: r.probs });
  t("office: prep notes", r.p.notes.length === 4, r.p.notes);
  t("office: 4 rows, totals dropped", r.rows.length === 4, r.rows.length);
  const [a, b, c, d] = r.rows;
  t("office: annual→monthly 2000", a && a.rent_amount === 2000 && a.payment_frequency === "monthly" && a.contract_periods === 12, a);
  t("office: hijri start", a && a.contract_start === "2025-06-26" && a.calendar === "hijri", a && a.contract_start);
  t("office: quarterly 6250 + partial 6000", b && b.rent_amount === 6250 && b.contract_periods === 4 && b.paid_periods === 0 && b.partial_amount === 6000, b);
  t("office: دفعتين = semiannual, paid 1 full", c && c.payment_frequency === "semiannual" && c.rent_amount === 13000 && c.paid_periods === 1, c);
  t("office: سنويا = annual", d && d.payment_frequency === "annual" && d.contract_periods === 1, d);
  t("office: phones normalized", b && b.phone === "0550000007" && c.phone === "0550000014" && d.phone === "0550000021", [b && b.phone, c && c.phone, d && d.phone]);
  t("office: no errors", r.rows.every((x) => !x._error), r.rows.map((x) => x._error).filter(Boolean));
}

/* ٢) قالب وثيق لا يتغيّر بالتجهيز (صف العناوين الأول، بلا ملاحظات) */
{
  const g = [P.HEADERS, ["علي", "101", "2500", "شهري", "2026-01-01", "12", "0501234567", "", "8"]];
  const p = P.prepareGrid(g);
  t("template: untouched", p.notes.length === 0 && p.grid.length === 2 && p.grid[0][0] === P.HEADERS[0], p.notes);
  const r = pipeline(g);
  t("template: parses", r.sure && r.rows.length === 1 && r.rows[0].paid_periods === 8, r.rows[0]);
}

/* ٣) سطر عنوان فيه كلمة تشبه عنوانًا لا يُختار صفَّ عناوين */
{
  const g = [["كشف المستأجر — الجوال للتواصل"], ["اسم المستأجر", "رقم الوحدة", "قيمة الدفعة", "دورة السداد", "بداية العقد", "عدد الدفعات", "الدفعات المسددة"], ["خالد", "5", "3000", "كل شهر", "2026-03-01", "12", "2"]];
  const r = pipeline(g);
  t("title with header words: picks real header", r.sure && r.rows.length === 1 && r.rows[0].payment_frequency === "monthly", { sure: r.sure, reasons: r.a.reasons, rows: r.rows.length });
}

/* ٤) تاريخ إكسل رقمًا + «4 دفعات» + «كل 6 شهور» */
{
  const g = [["اسم المستأجر", "رقم الوحدة", "قيمة الدفعة", "طريقة الدفع", "تاريخ البداية", "عدد الدفعات", "الدفعات المسددة"],
    ["أ", "1", "9000", "4 دفعات", "45658", "4", "1"], ["ب", "2", "18000", "كل 6 شهور", "46023", "2", "0"]];
  const r = pipeline(g);
  t("serial dates", r.rows[0] && r.rows[0].contract_start === "2025-01-01" && r.rows[1].contract_start === "2026-01-01", r.rows.map((x) => x.contract_start));
  t("freq synonyms", r.rows[0] && r.rows[0].payment_frequency === "quarterly" && r.rows[1].payment_frequency === "semiannual", r.rows.map((x) => x.payment_frequency));
}

/* ٥) مبلغ ورقم دفعات مسدّدة صغير يبقى سؤالًا (لبس حقيقي) */
{
  const g = [["اسم المستأجر", "رقم الوحدة", "قيمة الدفعة", "دورة السداد", "بداية العقد", "عدد الدفعات", "المسدد"], ["أ", "1", "3000", "شهري", "2026-01-01", "12", "3"], ["ب", "2", "3000", "شهري", "2026-01-01", "12", "1500"]];
  const r = pipeline(g);
  t("ambiguous paid still asks", !r.sure && r.probs.some((x) => /المسدَّد/.test(x)), r.probs);
}

/* ٦) وحدة مكررة في الملف + أرقام عربية متطابقة */
{
  const g = [P.HEADERS, ["أ", "101", "2500", "شهري", "2026-01-01", "12", "", "", "0"], ["ب", "١٠١", "2500", "شهري", "2026-01-01", "12", "", "", "0"]];
  const r = pipeline(g);
  t("dup in file flagged (arabic digits)", r.rows.filter((x) => /مكرّر/.test(x._error || "")).length === 2, r.rows.map((x) => x._error));
}

/* ٧) دورة سداد غير معروفة = خطأ صريح، لا «شهري» صامت */
{
  const g = [P.HEADERS, ["أ", "1", "2500", "كل شهرين", "2026-01-01", "6", "", "", "0"]];
  const r = pipeline(g);
  t("unknown freq is an error", /دورة سداد غير معروفة/.test(r.rows[0] && r.rows[0]._error || ""), r.rows[0] && r.rows[0]._error);
}

/* ٨) جدول التحصيل المجاني ما زال يُكيَّف */
{
  const H = ["رقم الوحدة","المستأجر","الجوال","الإيجار السنوي (ريال)","دورة السداد","بداية العقد","نهاية العقد","عدد الدفعات بالسنة","قيمة الدفعة","الدفعات المستحقة حتى اليوم","المستحق حتى اليوم","المدفوع","المتأخر","الحالة","الدفعة القادمة","أيام لنهاية العقد"];
  const p = P.prepareGrid([H, ["201", "سعد", "0551112222", "48,000", "ربع سنوي", "2026-03-01", "2027-02-28", "4", "12,000", "3", "36,000", "36,000", "0", "منتظم", "", ""]]);
  t("rent collection still adapted", p.rentCollection && p.grid.length === 2, p);
}

/* ٩) 2000 صف في أقل من ثانيتين */
{
  const g = [["كشف"], ["م", "اسم المستأجر", "رقم الشقة", "الإيجار السنوي", "طريقة الدفع", "تاريخ بداية العقد", "تاريخ نهاية العقد", "المسدد", "الجوال"]];
  for (let i = 0; i < 2000; i++) g.push([String(i + 1), "م" + i, String(1000 + i), "36000", "شهري", "2026-01-01", "2026-12-31", "6000", "05" + String(10000000 + i)]);
  const t0 = Date.now(); const r = pipeline(g); const ms = Date.now() - t0;
  t("2000 rows parsed", r.sure && r.rows.length === 2000 && r.rows.every((x) => !x._error), { sure: r.sure, n: r.rows.length });
  t("2000 rows fast", ms < 2000, ms);
}

/* ١٠) (اختبار 600 ملف) «الدفعات المدفوعة» عدد لا مبلغ · عناوين جديدة · أعمدة تُتجاهل بلا سؤال · جوال بمسافات */
{
  t("paid basis: الدفعات المدفوعة = count", P.paidBasisFromHeader("الدفعات المدفوعة") === "count");
  t("paid basis: المبلغ المدفوع = amount", P.paidBasisFromHeader("المبلغ المدفوع") === "amount");
  t("paid basis: عدد الأقساط المسددة = count", P.paidBasisFromHeader("عدد الأقساط المسددة") === "count");
  const g = [["م", "المستأجر/ة", "شقة رقم", "قيمة العقد السنوية", "طريقة الدفع", "من تاريخ", "إلى تاريخ", "الدفعات المدفوعة", "الجوال", "الجنسية", "العمولة", "المتبقي"],
    ["1", "أ", "5", "36000", "ربع سنوي", "2026-01-01", "2026-12-31", "2", "055 123 4567", "سعودي", "1000", "18000"]];
  const r = pipeline(g);
  t("new headers + ignored columns: straight to preview", r.sure, { reasons: r.a.reasons, probs: r.probs });
  const x = r.rows[0] || {};
  t("new headers parsed right", x.rent_amount === 9000 && x.payment_frequency === "quarterly" && x.contract_periods === 4 && x.paid_periods === 2 && x.contract_start === "2026-01-01", x);
  t("spaced phone normalized", x.phone === "0551234567", x.phone);
}

/* ١١) المكتب كتب مستأجريه فوق صفوف الأمثلة ونسي عمود «مثال — احذف هذا الصف» — لا يضيع أحد */
{
  const ex = (name, unit) => { const r = Array(P.HEADERS.length).fill(""); r[0] = name; r[1] = unit; r[2] = "2500"; r[3] = "شهري"; r[4] = "2026-01-01"; r[8] = "1"; return [...r, P.EXAMPLE_MARK]; };
  const g = [P.HEADERS.concat([P.NOTE_HEADER]), ex("عبدالله الحربي", "101"), ex("سعد العتيبي", "301"), ex("مؤسسة النور التجارية", "معرض 2"), ex("فهد", "302")];
  const r = pipeline(g);
  t("overwritten example rows are kept, untouched examples skipped", r.rows.length === 2 && r.rows.map((x) => x.name).join() === "سعد العتيبي,فهد", r.rows.map((x) => x.name));
}

console.log(bad ? `❌ ${bad} فشل، ${ok} نجح` : `✅ ${ok} اختبار — ملفات المكاتب الحقيقية تُرفع مباشرة`);
process.exit(bad ? 1 : 0);
