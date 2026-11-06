/* «جدول تحصيل الإيجارات» المجاني (watheqapp.com/downloads/watheq-rent-collection.xlsx)
   يُرفع في وثيق مباشرة بلا شاشة مطابقة.
   تشغيل: npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
           node tests/rent-collection-import.js */
const P = require("/tmp/b/importParse.js");
let ok = 0, bad = 0;
const t = (name, cond) => { if (cond) ok++; else { bad++; console.log("✗", name); } };
const H = ["رقم الوحدة","المستأجر","الجوال","الإيجار السنوي (ريال)","دورة السداد","بداية العقد","نهاية العقد","عدد الدفعات بالسنة","قيمة الدفعة","الدفعات المستحقة حتى اليوم","المستحق حتى اليوم","المدفوع","المتأخر","الحالة","الدفعة القادمة","أيام لنهاية العقد"];
const grid = [H,
  ["101","مستأجر تجريبي ١","05xxxxxxxx","36,000","شهري","2026-01-01","2026-12-31","12","3,000","10","30,000","7,500","22,500","متأخر","2026-11-01","83"],
  ["201","سعد","0551112222","48,000","ربع سنوي","2026-03-01","2027-02-28","4","12,000","3","36,000","36,000","0","منتظم","2026-12-01","142"],
  ["202","فهد","0553334444","30,000","نصف سنوي","2025-11-01","2026-10-31","2","15,000","2","30,000","","30,000","متأخر","",""],
  ["","","","","","","","","","","","","","","",""]];
t("signature", P.isRentCollectionSheet(grid));
t("not our sheet", !P.isRentCollectionSheet([["اسم المستأجر","رقم الوحدة","قيمة الدفعة"]]));
t("months 12 (jan–dec)", P.monthsBetween("2026-01-01","2026-12-31") === 12);
t("months 12 (mar–feb)", P.monthsBetween("2026-03-01","2027-02-28") === 12);
t("months 24", P.monthsBetween("2025-01-15","2027-01-14") === 24);
t("months bad date", P.monthsBetween("x","2026-01-01") === null);
const a = P.adaptRentCollectionSheet(grid);
t("adapted", a.adapted && a.dropped === 1 && a.grid.length === 3);
const an = P.analyzeColumns(a.grid);
t("no mapping questions", an.reasons.length === 0 && an.rentHint === "annual" && an.paidHint === "amount");
const cfg = P.initialConfig(an);
t("no problems", P.mappingProblems(cfg).length === 0);
const { rows } = P.parseGrid(a.grid, [], "2026-11-06", P.configToOptions(cfg));
const r1 = rows.find((r) => r.unit === "201"), r2 = rows.find((r) => r.unit === "202");
t("201 quarterly 12,000 ×4, 3 paid", r1 && r1.payment_frequency === "quarterly" && r1.rent_amount === 12000 && r1.contract_periods === 4 && r1.paid_periods === 3 && !r1._error);
t("202 empty paid = 0", r2 && r2.paid_periods === 0 && r2.rent_amount === 15000 && r2.contract_periods === 2 && !r2._error);
t("untouched grid passes through", P.adaptRentCollectionSheet([["a"]]).adapted === false);
console.log(bad ? `❌ ${bad} فشل، ${ok} نجح` : `✅ ${ok} اختبار — جدول التحصيل المجاني يُرفع مباشرة`);
process.exit(bad ? 1 : 0);
