/* مطابقة التحصيل والرصيد الافتتاحي (24 نوفمبر 2026) — أمثلة محسوبة يدويًّا
   يحتاج /tmp/b/documents.js (scripts/test-all.sh يبنيه) */
const D = require("/tmp/b/documents.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };

/* أ) عقد رُفع بـ 4 دفعات مسدَّدة × 2,000 + جزئي 500 = 8,500؛ في المنصة سندان إيجار 2,000 + 2,000 = 4,000
      وسند دين مرحَّل 1,500 (لا يُحسب قسطًا) ← رصيد افتتاحي 8,500 − 4,000 = 4,500 */
const A = { id: "A", rent_amount: 2000, paid_periods: 4, partial_amount: 500, term_started_at: "2026-01-01T00:00:00Z" };
/* ب) السندات أكثر: مسدَّد 1 × 8,000 + 6,000 = 14,000؛ سندات 20,500 (منها 500 قبل بدء المدة لا تُحسب)
      ← المحسوب 20,000 ← يزيد 6,000 */
const B = { id: "B", rent_amount: 8000, paid_periods: 1, partial_amount: 6000, term_started_at: "2026-03-01T00:00:00Z" };
/* ج) مطابق تمامًا: 3 × 1,000 وسندات 3,000 */
const C = { id: "C", rent_amount: 1000, paid_periods: 3, partial_amount: 0, term_started_at: "-infinity" };
const pays = [
  { tenant_id: "A", amount: 2000, applies_to: "rent", created_at: "2026-02-01T10:00:00Z" },
  { tenant_id: "A", amount: 2000, applies_to: null, created_at: "2026-03-01T10:00:00Z" },
  { tenant_id: "A", amount: 1500, applies_to: "carried", created_at: "2026-03-02T10:00:00Z" },
  { tenant_id: "B", amount: 500, applies_to: "rent", created_at: "2026-02-15T10:00:00Z" },
  { tenant_id: "B", amount: 12000, applies_to: "rent", created_at: "2026-03-05T10:00:00Z" },
  { tenant_id: "B", amount: 8000, applies_to: "rent", created_at: "2026-06-05T10:00:00Z" },
  { tenant_id: "C", amount: 1000, created_at: "2025-01-01T00:00:00Z" },
  { tenant_id: "C", amount: 2500, created_at: "2025-02-01T00:00:00Z" },
  { tenant_id: "C", amount: -500, created_at: "2025-02-02T00:00:00Z" }, // عكس جزئي
];
const R = D.collectionRecon([A, B, C], pays);
t("A counted 8500", R.A.counted === 8500);
t("A received 4000 (carried excluded)", R.A.received === 4000);
t("A opening 4500", R.A.opening === 4500 && R.A.excess === 0);
t("B received 20000 (pre-term excluded)", R.B.received === 20000);
t("B excess 6000", R.B.excess === 6000 && R.B.opening === 0);
t("C matches (reversal nets)", R.C.received === 3000 && R.C.opening === 0 && R.C.excess === 0);

/* د) كشف المستأجر: 4 دفعات × 2,000 + 500 = 8,500 مسدَّد؛ سندان 4,000 ← سطر «مسدَّد قبل بدء التسجيل» 4,500 */
const ten = { id: "A", unit: "5", name: "سالم", rent_amount: 2000, payment_frequency: "monthly",
  contract_start: "2026-01-01", contract_periods: 12, paid_periods: 4, partial_amount: 500, term_started_at: "2026-01-01T00:00:00Z" };
const P = { id: "p", name: "عمارة", property_type: "residential", collected: 0, grace_days: 0, tenants: [ten], property_notes: [] };
const sp = pays.filter((x) => x.tenant_id === "A").map((x, i) => ({ ...x, id: "x" + i, paid_on: x.created_at.slice(0, 10), method: "cash" }));
const h = D.statementHTML(ten, P, {}, sp, "full");
t("statement has opening line", /مسدَّد قبل بدء التسجيل في المنصة/.test(h));
t("statement opening amount 4,500", /4,500/.test(h.slice(h.indexOf("مسدَّد قبل بدء التسجيل"), h.indexOf("مسدَّد قبل بدء التسجيل") + 200)));
t("statement total paid 8,500", /إجمالي المسدَّد من العقد<\/td><td>8,500/.test(h));
/* هـ) مطابق ← لا سطر */
const ten2 = { ...ten, paid_periods: 2, partial_amount: 0 };
const h2 = D.statementHTML(ten2, { ...P, tenants: [ten2] }, {}, sp, "full");
t("no opening line when receipts cover", !/مسدَّد قبل بدء التسجيل/.test(h2));
t("carried payment labelled in statement", /سداد دين مرحَّل/.test(h));
console.log(`collection-recon: ${ok} ✓  ${bad} ✗`);
process.exit(bad ? 1 : 0);
