/* سند قبض دفعة إيجار (schema-v80، 14 نوفمبر 2026)
   تشغيل: npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/documents.js
           npx esbuild lib/tenantPortal.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tenantPortal.js
           node tests/rent-receipt.js */
const D = require("/tmp/b/documents.js");
const T = require("/tmp/b/tenantPortal.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const pay = { id: "11111111-1111-4111-8111-111111111111", receipt_no: "RC-00042", paid_on: "2026-11-14", amount: 4750, method: "transfer",
  reference: "FT2611", periods_covered: 1, applies_to: "rent", payer_name: "رهيب علي <b>x</b>", unit_label: "107", created_at: "2026-11-14T09:30:00Z" };
const ten = { name: "رهيب علي", unit: "107", unit_type: "apartment", contract_no: "10434414222", payment_frequency: "quarterly" };
const prop = { name: "عمارة الوقف", property_type: "residential" };
const issuer = { billing_name: "مكتب الأولى لإدارة الأملاك", billing_phone: "0570376617", cr_number: "7018004502" };
const h = D.receiptHTML(pay, ten, prop, issuer);
t("has receipt no", h.includes("RC-00042"));
t("has amount & words", h.includes("4,750") && /أربعة آلاف وسبعمائة وخمسون/.test(h));
t("has method & reference", h.includes("تحويل") && h.includes("FT2611"));
t("statement: rent, 1 period, quarterly", /أجرة شقة رقم \(107\) — دفعة واحدة \(كل 3 أشهر\)/.test(h));
t("contract no printed", h.includes("10434414222"));
t("issuer header", h.includes("مكتب الأولى لإدارة الأملاك") && h.includes("س.ت 7018004502"));
t("escapes payer name", !h.includes("<b>x</b>") && h.includes("&lt;b&gt;x&lt;/b&gt;"));
t("not reversed", !h.includes("معكوس"));
const h2 = D.receiptHTML({ ...pay, reversed_on: "2026-11-15T10:00:00Z" }, ten, prop, issuer);
t("reversed stamp", h2.includes("معكوس — أُلغيت هذه الدفعة") && h2.includes("سند معكوس"));
const h3 = D.receiptHTML({ ...pay, applies_to: "carried", periods_covered: 0 }, ten, prop, {});
t("carried statement + default issuer", h3.includes("سداد دين مرحَّل") && h3.includes("إدارة الأملاك"));
const h4 = D.receiptHTML({ ...pay, periods_covered: 0, applies_to: "rent" }, ten, prop, issuer);
t("partial statement", h4.includes("دفعة جزئية"));
t("no receipt no → dash, no crash", D.receiptHTML({ ...pay, receipt_no: null }, ten, prop, issuer).includes("—"));
// صفحة المستأجر
const page = T.renderTenantReceiptPage({ payment: { ...pay, reversed_on: null }, tenant: ten, property: { ...prop, city: "جدة" }, office: issuer }, { nonce: "n0nce", base: "/r/t/abc" });
t("portal: number, amount words, back link", page.includes("RC-00042") && /أربعة آلاف/.test(page) && page.includes('href="/r/t/abc"'));
t("portal: escaped payer", !page.includes("<b>x</b>"));
t("portal: nonce script print", page.includes('nonce="n0nce"') && page.includes("window.print"));
const pageR = T.renderTenantReceiptPage({ payment: { ...pay, reversed_on: "2026-11-15T10:00:00Z" }, tenant: ten, property: prop, office: null }, { nonce: "n", base: "/r/t/abc" });
t("portal: reversed stamp + default org", pageR.includes("سند معكوس") && pageR.includes("إدارة الأملاك"));
// قائمة الدفعات في صفحة المستأجر فيها رابط السند
const list = T.renderTenantPage({ tenant: { ...ten, rent_amount: 4750, contract_start: "2026-02-01", paid_periods: 3, status: "active" }, property: prop, office: issuer, show_balance: true, active: true, today: "2026-11-14",
  payments: [{ id: pay.id, paid_on: "2026-11-01", amount: 4750, method: "transfer", reference: null, periods_covered: 1, reverses: null, applies_to: "rent", created_at: "2026-11-01T00:00:00Z" }], claims: [], requests: [] }, { nonce: "n", base: "/r/t/abc" });
t("portal list: receipt link per payment", list.includes(`/r/t/abc/p/${pay.id}`) && list.includes("سند القبض"));
console.log(bad ? `❌ ${bad} فشل` : `✅ ${ok} اختبار — سند قبض الإيجار`);
process.exit(bad ? 1 : 0);
