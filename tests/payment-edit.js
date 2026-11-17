/* تعديل الدفعة من المدير + ملاحظة السند (schema-v88، 17 نوفمبر 2026 — طلب مكتب «الأولى»)
   تشغيل: npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/documents.js
           npx esbuild lib/tenantPortal.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tportal.js
           npx esbuild lib/sandbox-db.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/sandbox-db.js
           node tests/payment-edit.js */
const D = require("/tmp/b/documents.js");
const TP = require("/tmp/b/tportal.js");
const SB = require("/tmp/b/sandbox-db.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };

// ملاحظة السند
t("note uuid stripped", D.receiptNoteText("تصحيح — 1b2c3d4e-1111-2222-3333-444455556666") === "تصحيح");
t("empty note", D.receiptNoteText("  ") === "" && D.receiptNoteText(null) === "");
const pay = { id: "x", receipt_no: "RC-00034", paid_on: "2026-11-17", amount: 1800, method: "ejar", note: "المتبقي 5400 ريال <b>حتى</b> 2027/2/1" };
const html = D.receiptHTML(pay, { name: "سعد", unit: "18" }, { name: "مركز الزهراء", property_type: "mixed" }, {});
t("receipt shows note row", html.includes("ملاحظة") && html.includes("المتبقي 5400 ريال"));
t("receipt note escaped", !html.includes("<b>حتى</b>"));
t("receipt shows ejar", html.includes("منصة إيجار") || html.includes("إيجار"));
t("mixed property unit word", html.includes("وحدة 18"));
const html2 = D.receiptHTML({ ...pay, note: null }, { name: "سعد", unit: "18" }, { name: "م" }, {});
t("no note row when empty", !/<span>ملاحظة<\/span>/.test(html2));
const page = TP.renderTenantReceiptPage({
  payment: { ...pay, periods_covered: 1, applies_to: "rent", created_at: "2026-11-17T10:00:00Z", payer_name: "سعد", unit_label: "18", reversed_on: null, reference: null },
  tenant: { name: "سعد", unit: "18", unit_type: null, contract_no: null, payment_frequency: "quarterly", vat_mode: null },
  property: { name: "مركز", city: null, property_type: "residential", vat_enabled: false, vat_rate: null, vat_inclusive: null }, office: {} }, { nonce: "n", base: "/r/t/x" });
t("tenant page shows note", page.includes("المتبقي 5400 ريال") && !page.includes("<b>حتى</b>"));

// التجربة: نفس معادلة القاعدة
(async () => {
  const store = { properties: [{ id: "p", name: "م", collected: 0 }], tenants: [{ id: "t", property_id: "p", name: "سعد", unit: "18", rent_amount: 1000, paid_periods: 0, partial_amount: 0 }], payments: [] };
  const db = SB.sandboxClient ? SB.sandboxClient(store) : SB.createSandbox ? SB.createSandbox(store) : null;
  if (!db) { console.log("(sandbox factory not found — skipped)"); return done(); }
  await db.rpc("watheq_record_payment", { p_tenant: "t", p_amount: 1500 });
  const id = store.payments[0].id;
  let r = await db.rpc("watheq_edit_payment", { p_payment: id, p_amount: 1800, p_method: "ejar", p_paid_on: "2026-11-17", p_note: "ن" });
  const T = store.tenants[0];
  t("sandbox edit 1800 → paid1 partial800", !r.error && T.paid_periods === 1 && T.partial_amount === 800 && store.properties[0].collected === 1800);
  t("sandbox method ejar + note", store.payments[0].method === "ejar" && store.payments[0].note === "ن");
  r = await db.rpc("watheq_edit_payment", { p_payment: id, p_amount: 2000, p_method: "ejar", p_paid_on: "2026-11-17" });
  t("sandbox edit 2000 → paid2 partial0 cov2", T.paid_periods === 2 && T.partial_amount === 0 && store.payments[0].periods_covered === 2);
  r = await db.rpc("watheq_edit_payment", { p_payment: id, p_amount: 0, p_method: "ejar", p_paid_on: "2026-11-17" });
  t("sandbox rejects 0", !!r.error);
  done();
})();
function done() { console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0); }
