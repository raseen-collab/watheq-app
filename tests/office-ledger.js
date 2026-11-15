/* دفتر حسابات المكتب (15 نوفمبر 2026)
   تشغيل: npx esbuild lib/office-ledger.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/office-ledger.js
           node tests/office-ledger.js */
const L = require("/tmp/b/office-ledger.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };

// الفترات
t("month bounds Nov", JSON.stringify(L.periodBounds("2026-11")) === JSON.stringify({ from: "2026-11-01", to: "2026-11-30", label: "نوفمبر 2026" }));
t("month bounds Feb leap", L.periodBounds("2028-02").to === "2028-02-29");
t("year bounds", L.periodBounds("2026").from === "2026-01-01" && L.periodBounds("2026").to === "2026-12-31");
t("bad period", L.periodBounds("2026-13") === null && L.periodBounds("x") === null);

// التحقق
t("validate ok income", L.validateEntry({ kind: "income", category: "brokerage", amount: 2500, entry_on: "2026-11-15" }) === null);
t("validate rejects income cat on expense", L.validateEntry({ kind: "expense", category: "brokerage", amount: 10, entry_on: "2026-11-15" }) !== null);
t("validate rejects zero", L.validateEntry({ kind: "expense", category: "office_rent", amount: 0, entry_on: "2026-11-15" }) !== null);
t("validate rejects bad date", L.validateEntry({ kind: "income", category: "other_income", amount: 5, entry_on: "15/11/2026" }) !== null);

// الملخص
const pn = { p1: "مركز الزهراء", p2: "الزهراء بلازا" };
const s = L.ledgerSummary({
  fees: { fee: 4000, feeVat: 600 },
  entries: [
    { id: "a", kind: "income", category: "brokerage", amount: 2500, entry_on: "2026-11-10", property_id: "p1", unit: "ش3", party: "فهد" },
    { id: "b", kind: "income", category: "documentation", amount: 150.5, entry_on: "2026-11-12" },
    { id: "c", kind: "expense", category: "office_rent", amount: 3000, entry_on: "2026-11-01" },
    { id: "d", kind: "expense", category: "subscriptions", amount: 199, entry_on: "2026-11-05" },
    { id: "e", kind: "income", category: "brokerage", amount: 0, entry_on: "2026-11-05" },     // يُتجاهل
  ],
  propertyExpenses: [
    { id: "x1", amount: 500, spent_on: "2026-11-03", category: "marketing", billable: false, paid_by: "office", property_id: "p2", note: "لوحة إعلان" }, // على المكتب
    { id: "x2", amount: 1200, spent_on: "2026-11-04", category: "maintenance", billable: true, paid_by: "office", property_id: "p1" },               // سلفة تُستردّ
    { id: "x3", amount: 800, spent_on: "2026-11-06", category: "cleaning", billable: true, paid_by: "collections", property_id: "p1" },               // على المالك — لا شأن للمكتب
    { id: "x4", amount: 300, spent_on: "2026-11-07", category: "salaries", billable: true, paid_by: "owner", property_id: "p1" },                      // دفعها المالك
  ],
  propertyNames: pn, propCatLabel: (c) => ({ marketing: "تسويق", maintenance: "صيانة" })[c] || c,
});
t("income fees", s.income.fees === 4000 && s.income.feeVat === 600);
t("income manual", s.income.manual === 2650.5);
t("income total = fees + manual (VAT excluded)", s.income.total === 6650.5);
t("expense manual", s.expense.manual === 3199);
t("expense property (office-borne only)", s.expense.property === 500);
t("expense total", s.expense.total === 3699);
t("net", s.net === 2951.5);
t("advances = billable paid by office", s.advances === 1200);
t("owner-paid and collections expenses never enter", !s.lines.some((l) => l.id === "x3" || l.id === "x4"));
t("fee line present and first-in-period (no date)", s.lines.some((l) => l.source === "fee" && l.amount === 4000 && l.date === ""));
t("zero entry skipped", !s.lines.some((l) => l.id === "e"));
t("property name resolved", s.lines.find((l) => l.id === "a").property === "مركز الزهراء" && s.lines.find((l) => l.id === "a").unit === "ش3");
t("property expense label", /تسويق — مصروف عقار على المكتب/.test(s.lines.find((l) => l.id === "x1").label));
t("income byCat sorted desc & includes fee", s.income.byCat[0].category === "management_fee_auto" && s.income.byCat[1].category === "brokerage" && s.income.byCat[1].total === 2500);
t("expense byCat includes prop bucket", s.expense.byCat.some((c) => c.category === "prop:marketing" && c.total === 500 && /تسويق \(عقارات\)/.test(c.label)));
t("lines sorted newest first (dated)", (() => { const d = s.lines.filter((l) => l.date).map((l) => l.date); return d.every((x, i) => i === 0 || d[i - 1] >= x); })());

// لا أتعاب ولا قيود
const e = L.ledgerSummary({ fees: { fee: 0 }, entries: [], propertyExpenses: [] });
t("empty summary", e.income.total === 0 && e.expense.total === 0 && e.net === 0 && e.lines.length === 0 && e.income.byCat.length === 0);

// التسميات
t("labels", L.ledgerCatLabel("income", "brokerage") === "سعي" && L.ledgerCatLabel("expense", "office_rent") === "إيجار المكتب" && L.ledgerCatLabel("expense", "zzz") === "أخرى");

// أتعاب يدوية + تنبيه التكرار
const m1 = L.ledgerSummary({ fees: { fee: 1000 }, entries: [{ id: "f", kind: "income", category: "management_fee", amount: 700, entry_on: "2026-11-02" }], propertyExpenses: [] });
t("manual fee counted & flagged when auto fee exists", m1.income.manualFees === 700 && m1.income.total === 1700 && m1.feeDoubleRisk === true);
const m2 = L.ledgerSummary({ fees: { fee: 0 }, entries: [{ id: "f", kind: "income", category: "management_fee", amount: 700, entry_on: "2026-11-02" }], propertyExpenses: [] });
t("manual fee alone → no flag, labeled", m2.feeDoubleRisk === false && m2.income.byCat[0].label === "أتعاب إدارة (مسجَّلة يدويًّا)");
t("no manual fee → no flag", s.feeDoubleRisk === false && s.income.manualFees === 0);
t("validate accepts management_fee income", L.validateEntry({ kind: "income", category: "management_fee", amount: 5, entry_on: "2026-11-01" }) === null);

// CSV
const csv = L.ledgerCSV(s.lines, "نوفمبر 2026");
t("csv has BOM + header + one row per line", csv.charCodeAt(0) === 0xFEFF && csv.split("\n").length === s.lines.length + 1 && /^\uFEFFالفترة,التاريخ/.test(csv));
t("csv negative for expense, escapes quotes", /,-3000,/.test(csv) && L.ledgerCSV([{ source: "ledger", kind: "income", category: "x", label: 'a"b', amount: 1, date: "2026-01-01" }], "p").includes('"a""b"'));

// تعبئة من الرابط
const q = new URLSearchParams("add=income&cat=brokerage&amount=6250.5&note=سعي شقة 3&ref=معروض L-12&property=p1&unit=ش3");
const pre = L.prefillFromQuery(q);
t("prefill parsed", pre.kind === "income" && pre.category === "brokerage" && pre.amount === 6250.5 && pre.note === "سعي شقة 3" && pre.reference === "معروض L-12" && pre.property_id === "p1" && pre.unit === "ش3");
t("prefill bad cat → first cat; bad amount → undefined", L.prefillFromQuery(new URLSearchParams("add=expense&cat=brokerage&amount=-5")).category === "office_rent" && L.prefillFromQuery(new URLSearchParams("add=expense&amount=x")).amount === undefined);
t("prefill none", L.prefillFromQuery(new URLSearchParams("x=1")) === null && L.prefillFromQuery({}) === null);

console.log(`office-ledger: ${ok} ✅ ${bad ? bad + " ❌" : ""}`);
process.exit(bad ? 1 : 0);
