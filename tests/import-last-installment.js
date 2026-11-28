/* (25 نوفمبر 2026) القسط الأخير في الرفع من إكسل — أمثلة محسوبة يدويًّا */
const P = require("/tmp/b/importParse.js");
const Pay = require("/tmp/b/importPayload.js");
let ok = 0, bad = 0;
const t = (n, c, x = "") => { if (c) ok++; else { bad++; console.log("✗", n, x); } };
const props = [{ id: "p1", name: "سلم الأماني", property_type: "building" }];
const H = ["اسم المستأجر", "رقم الوحدة", "الإيجار السنوي", "دورة السداد", "بداية العقد", "عدد الدفعات", "المبلغ المسدد"];
const parse = (rows, opts) => P.parseGrid([H, ...rows], props, "2026-11-25", opts).rows;
const o = { rentBasis: "annual", paidBasis: "amount" };
/* أ) 20,000 سنوي شهري 12: القسط 1,666.67 والأخير 20,000 − 11 × 1,666.67 = 1,666.63 */
let r = parse([["هيثم", "1", "20000", "شهري", "2026-01-01", "12", "0"]], o)[0];
t("rent 1666.67", r.rent_amount === 1666.67, r.rent_amount);
t("last 1666.63", r.last_installment === 1666.63, r.last_installment);
/* ب) 23,000 سنوي شهري: 1,916.67 × 11 = 21,083.37 ⇒ الأخير 1,916.63 */
r = parse([["عبدالمجيد", "2", "23000", "شهري", "2026-01-01", "12", "0"]], o)[0];
t("23000 → last 1916.63", r.rent_amount === 1916.67 && r.last_installment === 1916.63, `${r.rent_amount}/${r.last_installment}`);
/* ج) قسمة صحيحة: 24,000 شهري = 2,000 بلا قسط أخير */
r = parse([["س", "3", "24000", "شهري", "2026-01-01", "12", "0"]], o)[0];
t("exact → no last", r.rent_amount === 2000 && r.last_installment === undefined);
/* د) مسدَّد العقد كله 20,000 ⇒ 12 دفعة بلا جزئي (كان 11 + جزئي 1,666.63) */
r = parse([["هيثم", "1", "20000", "شهري", "2026-01-01", "12", "20000"]], o)[0];
t("full amount → 12 paid, 0 partial", r.paid_periods === 12 && !r.partial_amount, `${r.paid_periods}/${r.partial_amount}`);
/* هـ) مسدَّد 19,000 ⇒ 11 دفعة (18,333.37) + جزئي 666.63 */
r = parse([["هيثم", "1", "20000", "شهري", "2026-01-01", "12", "19000"]], o)[0];
t("19000 → 11 + 666.63", r.paid_periods === 11 && r.partial_amount === 666.63, `${r.paid_periods}/${r.partial_amount}`);
/* و) عمود صريح «القسط الأخير» (إيجار): 1,667 قسط + 1,663 أخير */
const H2 = ["اسم المستأجر", "رقم الوحدة", "قيمة الدفعة", "دورة السداد", "بداية العقد", "عدد الدفعات", "القسط الأخير"];
r = P.parseGrid([H2, ["ع", "4", "1667", "شهري", "2026-01-01", "12", "1663"]], props, "2026-11-25", { rentBasis: "payment" }).rows[0];
t("explicit column 1663", r.rent_amount === 1667 && r.last_installment === 1663, `${r.rent_amount}/${r.last_installment}`);
r = P.parseGrid([H2, ["ع", "4", "1667", "شهري", "2026-01-01", "12", "abc"]], props, "2026-11-25", { rentBasis: "payment" }).rows[0];
t("bad explicit → error", /دفعة الإيجار الأخيرة/.test(r._error || ""));
/* ز) الحمولة: المفتاح ثابت في كل الصفوف */
const rows = parse([["هيثم", "1", "20000", "شهري", "2026-01-01", "12", "0"], ["س", "3", "24000", "شهري", "2026-01-01", "12", "0"]], o);
const { main } = Pay.buildImportPayload(rows, "p1", { today: "2026-11-25" });
t("payload key on all rows", main.every((x) => "last_installment" in x) && main[0].last_installment === 1666.63 && main[1].last_installment === null);
console.log(`import-last-installment: ${ok} ✓  ${bad} ✗`);
process.exit(bad ? 1 : 0);
