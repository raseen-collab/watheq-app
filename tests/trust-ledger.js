/* حساب الأمانات (schema-v87، 16 نوفمبر 2026 — طلب مكتب «الأولى»)
   تشغيل: npx esbuild lib/trust.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/trust.js
           npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/documents.js
           npx esbuild lib/domain.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/domain.js
           npx esbuild lib/contracts.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/contracts.js
           node tests/trust-ledger.js */
const T = require("/tmp/b/trust.js");
const D = require("/tmp/b/documents.js");
const M = require("/tmp/b/domain.js");
const C = require("/tmp/b/contracts.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const P = "p1";
const rows = [
  { id: "1", property_id: P, tenant_id: "a", unit: "101", kind: "deposit_in", amount: "3000", entry_on: "2026-01-01" },
  { id: "2", property_id: P, tenant_id: "b", unit: "102", kind: "deposit_in", amount: 2000, entry_on: "2026-01-02" },
  { id: "3", property_id: P, tenant_id: "a", unit: "101", kind: "deposit_out", amount: 2500, entry_on: "2026-10-01" },
  { id: "4", property_id: P, tenant_id: "a", kind: "utility_in", amount: 120.5, meter: "100123", entry_on: "2026-10-03" },
  { id: "5", property_id: P, tenant_id: "b", kind: "utility_in", amount: 79.5, meter: "100123", entry_on: "2026-10-04" },
  { id: "6", property_id: P, kind: "utility_out", amount: 200, meter: "100123", entry_on: "2026-10-05" },
  { id: "7", property_id: P, kind: "utility_in", amount: 50, meter: " 200999 ", entry_on: "2026-10-05" },
];
const tot = T.trustTotals(rows);
t("deposit held = 3000+2000-2500", tot.depositHeld === 2500);
t("utility balance = 120.5+79.5-200+50", tot.utilityBalance === 50);
t("total", tot.total === 2550);
const deps = T.depositBalances(rows);
t("two deposit units", deps.length === 2);
const a = deps.find((d) => d.tenant_id === "a");
t("unit a held 500, refunded 2500", a.held === 500 && a.refunded === 2500 && a.received === 3000);
const mb = T.meterBalances(rows);
t("meter 100123 zero", mb.find((m) => m.meter === "100123").balance === 0);
t("meter trimmed", mb.find((m) => m.meter === "200999").balance === 50);
t("signed", T.trustSigned({ kind: "deposit_out", amount: 10 }) === -10 && T.trustSigned({ kind: "utility_in", amount: "-7" }) === 7);
t("labels", T.trustKindLabel("utility_out") === "سداد فاتورة مشتركة" && T.trustKindLabel("x") === "أمانة");
t("in/out", T.isTrustIn("deposit_in") && !T.isTrustIn("utility_out"));
t("float sum exact", T.trustTotals([0.1, 0.2].map((x, i) => ({ id: String(i), property_id: P, kind: "utility_in", amount: x, meter: "m", entry_on: "2026-01-01" }))).utilityBalance === 0.3);

const today = "2026-11-16";
let c = T.checkTrustDraft({ kind: "deposit_in", amount: "0", entry_on: today, tenant_id: "a" }, { today });
t("amount 0 rejected", c.errors.length === 1);
c = T.checkTrustDraft({ kind: "deposit_in", amount: 100, entry_on: today }, { today });
t("deposit needs unit", c.errors.some((e) => /الوحدة/.test(e)));
c = T.checkTrustDraft({ kind: "deposit_in", amount: 100, entry_on: "2026-11-17", tenant_id: "a" }, { today });
t("future date rejected", c.errors.some((e) => /بعد اليوم/.test(e)));
c = T.checkTrustDraft({ kind: "deposit_out", amount: 600, entry_on: today, tenant_id: "a" }, { today, heldForTenant: 500 });
t("refund > held warns, no error", !c.errors.length && c.warnings.length === 1);
c = T.checkTrustDraft({ kind: "deposit_out", amount: 500, entry_on: today, tenant_id: "a" }, { today, heldForTenant: 500 });
t("refund = held clean", !c.errors.length && !c.warnings.length);
c = T.checkTrustDraft({ kind: "utility_out", amount: 300, entry_on: today, meter: "100123" }, { today, meterBalance: 200 });
t("bill > collected warns", !c.errors.length && c.warnings.length === 1);
c = T.checkTrustDraft({ kind: "utility_in", amount: 30, entry_on: today, meter: "" }, { today });
t("no meter warns", c.warnings.some((w) => /عداد/.test(w)));
c = T.checkTrustDraft({ kind: "bogus", amount: 30, entry_on: today }, { today });
t("bad kind error", c.errors.length >= 1);

// السندات
const issuer = { billing_name: "مكتب الأولى لإدارة الأملاك" };
const prop = { name: "مركز الزهراء", property_type: "residential" };
const hin = D.trustDocHTML({ ...rows[0], doc_no: "TR-00007", party: "سعد <b>x</b>", method: "cash" }, prop, issuer, { unit: "101", unit_type: "showroom", name: "سعد" });
t("TR doc title", hin.includes("سند قبض مبلغ ضمان") && hin.includes("TR-00007"));
t("showroom word in doc", hin.includes("معرض 101") && !hin.includes("شقة 101"));
t("amount words", /ثلاثة آلاف/.test(hin));
t("not rent note", hin.includes("ليس إيجارًا"));
t("scrubbed html", !hin.includes("<b>x</b>"));
t("method cash", hin.includes("نقدًا"));
const hout = D.trustDocHTML({ ...rows[5], doc_no: "TV-00002", party: "الشركة السعودية للكهرباء", bill_period: "أكتوبر 2026" }, prop, issuer, null);
t("TV doc title", hout.includes("سند صرف — سداد فاتورة") && hout.includes("TV-00002"));
t("TV statement meter+period", hout.includes("سداد فاتورة عداد مشترك رقم 100123 عن أكتوبر 2026"));
t("TV has payee signature", hout.includes("المستلم: الشركة السعودية للكهرباء"));

// اسم الوحدة: معرض / أخرى / عمارة سكنية تجارية
t("unitWordFor showroom", M.unitWordFor("showroom", "residential") === "معرض");
t("unitWordFor other → وحدة", M.unitWordFor("other", "residential") === "وحدة");
t("unitWordFor none in residential still شقة", M.unitWordFor(null, "residential") === "شقة");
t("mixed property → وحدة", M.unitLabel("mixed") === "وحدة" && M.typeLabel("mixed") === "عمارة سكنية تجارية");
t("showroom unit is VAT-able", C.unitVatApplies({ unit_type: "showroom" }, { property_type: "residential", vat_enabled: true }) === true);
t("apartment not VAT-able", C.unitVatApplies({ unit_type: "apartment" }, { property_type: "mixed", vat_enabled: true }) === false);

console.log(`${ok} ✓ · ${bad} ✗`);
process.exit(bad ? 1 : 0);
