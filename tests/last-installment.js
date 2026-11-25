/* القسط الأخير المختلف (24 نوفمبر 2026) — أمثلة محسوبة يدويًّا
   عقد إيجار: 20,000 سنويًّا شهريًّا = 1,667 × 11 + 1,663 = 18,337 + 1,663 = 20,000 */
const C = require("/tmp/b/contracts.js");
const S = require("/tmp/b/contract-state.js");
const D = require("/tmp/b/documents.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const base = { rent_amount: 1667, contract_periods: 12, last_installment: 1663, payment_frequency: "monthly", paid_periods: 0, partial_amount: 0 };

/* المساعدات */
t("lastInstallmentOf 1663", C.lastInstallmentOf(base) === 1663);
t("empty → null (old behaviour)", C.lastInstallmentOf({ ...base, last_installment: null }) === null);
t("equal to rent → null", C.lastInstallmentOf({ ...base, last_installment: 1667 }) === null);
t("needs known term", C.lastInstallmentOf({ ...base, contract_periods: null }) === null);
t("installment 11 (0-based) = 1663", C.installmentAt(base, 11) === 1663 && C.installmentAt(base, 10) === 1667);
t("sum of 11 = 18,337", C.installmentsSum(base, 11) === 18337);
t("sum of 12 = 20,000", C.installmentsSum(base, 12) === 20000);

/* الجدول: 11 قسطًا 1,667 والأخير 1,663، والمجموع 20,000 */
const sch = C.buildSchedule({ ...base, contract_start: "2026-01-01" });
t("schedule 12 rows", sch.length === 12);
t("schedule last = 1663", sch[11].amount === 1663 && sch[10].amount === 1667);
t("schedule total 20,000", sch.reduce((a, r) => a + r.amount, 0) === 20000);

/* تسجيل الدفعات: مسدَّد 10، يدفع 3,330 = 1,667 + 1,663 ← تكتمل 12 بلا جزئي */
let r = C.applyPayment({ ...base, paid_periods: 10 }, 3330);
t("10 + 3,330 → 12 paid, 0 partial", r.paid_periods === 12 && r.partial_amount === 0 && r.completed === 2);
/* مسدَّد 11، يدفع 1,663 ← الأخير مكتمل */
r = C.applyPayment({ ...base, paid_periods: 11 }, 1663);
t("11 + 1,663 → 12", r.paid_periods === 12 && r.partial_amount === 0);
/* مسدَّد 11، يدفع 1,000 ← جزئي 1,000 من 1,663 */
r = C.applyPayment({ ...base, paid_periods: 11 }, 1000);
t("11 + 1,000 → partial 1000", r.paid_periods === 11 && r.partial_amount === 1000);
/* مسدَّد 0، جزئي 500، يدفع 2,000 ← 2,500 = قسط 1,667 + جزئي 833 */
r = C.applyPayment({ ...base, partial_amount: 500 }, 2000);
t("0+500 + 2,000 → 1 paid, 833 partial", r.paid_periods === 1 && r.partial_amount === 833);
/* بلا قسط مختلف: السلوك القديم كما هو — 3,000 على 1,667 ← 1 + 1,333 */
r = C.applyPayment({ ...base, last_installment: null }, 3000);
t("old path unchanged", r.paid_periods === 1 && r.partial_amount === 1333);

/* المتبقي من العقد: مسدَّد 11 ← 20,000 − 18,337 = 1,663 */
const rem = S.contractRemaining({ ...base, paid_periods: 11 });
t("remaining total 20,000", rem.total === 20000);
t("remaining 1,663", rem.remaining === 1663);
t("paid all → 0", S.contractRemaining({ ...base, paid_periods: 12 }).remaining === 0);

/* الحالة: عقد بدأ قبل سنة وشهرين (كل الأقساط حلّت)، مسدَّد 10 ← متأخر 1,667 + 1,663 = 3,330 */
const d = new Date(); d.setMonth(d.getMonth() - 14);
const iso = d.toISOString().slice(0, 10);
let st = C.contractState({ ...base, contract_start: iso, paid_periods: 10 });
t("state due 12", st.due === 12);
t("amountDue 3,330", st.amountDue === 3330);
st = C.contractState({ ...base, contract_start: iso, paid_periods: 11, partial_amount: 663 });
t("last partial 663 → due 1,000", st.amountDue === 1000);
st = C.contractState({ ...base, contract_start: iso, paid_periods: 5 });
t("mid-contract 7 unpaid → 6×1,667 + 1,663 = 11,665", st.amountDue === 11665);
st = C.contractState({ ...base, last_installment: null, contract_start: iso, paid_periods: 10 });
t("old path amountDue 3,334", st.amountDue === 3334);

/* المسدَّد بالمال (paidValue) */
t("paidValue 12 paid = 20,000", C.paidValue({ ...base, paid_periods: 12 }) === 20000);
t("paidValue 11 + 500 = 18,837", C.paidValue({ ...base, paid_periods: 11, partial_amount: 500 }) === 18837);

/* كشف الحساب: إجمالي العقد 20,000 والمسدَّد 20,000 عند السداد الكامل */
const ten = { id: "T", unit: "1", name: "هيثم", ...base, contract_start: iso, paid_periods: 12 };
const P = { id: "p", name: "سلم الأماني", property_type: "residential", collected: 0, grace_days: 0, tenants: [ten], property_notes: [] };
const h = D.statementHTML(ten, P, {}, [], "full");
t("statement shows 1,663 row", /1,663/.test(h));
t("statement paid 20,000", /المسدَّد<\/span><span>20,000 ريال/.test(h));
console.log(`last-installment: ${ok} ✓  ${bad} ✗`);
process.exit(bad ? 1 : 0);
