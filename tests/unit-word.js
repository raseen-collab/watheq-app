/* اسم الوحدة لمستأجر بعينه (v77): محل داخل عمارة سكنية يُسمّى «محل» في مستنداته.
   يُبنى أولًا: npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/docs.js */
const D = require("/tmp/docs.js");
let fails = 0;
const has = (name, html, s, want = true) => { if (html.includes(s) !== want) { fails++; console.log(`❌ ${name}: ${want ? "لا يحوي" : "يحوي"} «${s}»`); } };
const P = { name: "مجمع الروضة", property_type: "residential", usage: "mixed", vat_enabled: true, vat_rate: 15, vat_inclusive: true };
const base = { name: "مكتب البناء", rent_amount: 13800, payment_frequency: "semiannual", contract_start: "2026-02-09", contract_periods: 2, paid_periods: 0, partial_amount: 0, calendar: "gregorian", status: "active" };
const shop = { ...base, unit: "م2", unit_type: "shop" };
const flat = { ...base, unit: "205", unit_type: "apartment" };
const none = { ...base, unit: "7", unit_type: null };

has("كشف المحل", D.statementHTML(shop, P, {}), "كشف حساب محل رقم (م2)");
has("كشف المحل لا يقول شقة", D.statementHTML(shop, P, {}), "كشف حساب شقة رقم (م2)", false);
has("كشف الشقة", D.statementHTML(flat, P, {}), "كشف حساب شقة رقم (205)");
has("بلا نوع = نوع العقار", D.statementHTML(none, P, {}), "كشف حساب شقة رقم (7)");
const inv = D.invoiceHTML(shop, P, { invoice_no: "INV-1", amount: 13800, due_date: "2026-02-09", period_label: "الدفعة 1 من 2" }, {});
has("فاتورة المحل", inv, "أجرة محل رقم (م2)");
const mo = D.moveOutSettlementHTML({ ...shop, status: "vacated", move_out_date: "2026-09-01" }, P, {}, {});
has("مخالصة المحل", mo, "مخالصة إخلاء محل رقم (م2)");
console.log(fails ? `\n${fails} فشل` : "✅ اسم الوحدة في المستندات يتبع نوعها");
process.exit(fails ? 1 : 0);
