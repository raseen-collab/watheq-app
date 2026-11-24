/* النسخة الشهرية الكاملة (24 نوفمبر 2026)
   تشغيل: npx esbuild lib/office-copy.ts --bundle --format=cjs --platform=node --external:@supabase/supabase-js --outfile=/tmp/b/officeCopy.js && node tests/office-copy.js */
const { OFFICE_TABLES, collectOffice, cellValue, copyDue, readmeText, stripSecrets } = require("/tmp/b/officeCopy.js");
let ok = 0, bad = 0; const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };

/* تغطية: كل جدول فيه بيانات مكتب موجود — والمستبعد داخلي بالاسم */
const ALL = ["ad_posts","advisor_log","association_budgets","association_expenses","association_notes","associations","audit_log","compliance_items","expense_template_skips","expense_templates","expense_voucher_counters","expenses","help_feedback","help_queries","hoa_audit","hoa_documents","hoa_member_links","hoa_payment_claims","hoa_request_log","hoa_requests","hoa_signatures","invoice_events","invoices","ledger_adjustments","listing_links","listing_shows","listings","maintenance_vendors","office_ledger","office_messages","owner_links","owners","past_tenancies","payment_edits","payments","platform_settings","problem_reports","profiles","properties","property_notes","seeker_requests","site_events","subscription_claims","subscription_payments","team_invites","team_members","tenant_payment_claims","tenant_portal_audit","tenant_portal_links","tenant_requests","tenants","trust_doc_counters","trust_ledger"];
const INTERNAL = ["ad_posts","advisor_log","expense_voucher_counters","help_feedback","help_queries","platform_settings","problem_reports","profiles","site_events","subscription_claims","team_invites","trust_doc_counters"];
const have = new Set(OFFICE_TABLES.map((s) => s.table));
const missing = ALL.filter((x) => !have.has(x) && !INTERNAL.includes(x));
t(`every office table covered (${missing.join(",")})`, missing.length === 0);
t("arabic sheet names ≤31", OFFICE_TABLES.every((s) => s.ar.length <= 31));
t("unique sheet names", new Set(OFFICE_TABLES.map((s) => s.ar.slice(0, 31))).size === OFFICE_TABLES.length);
t("strip secrets", JSON.stringify(stripSecrets({ a: 1, token: "x", token_hash: "y", ip: "1.1.1.1" })) === '{"a":1}');
t("cell object → json", cellValue({ a: 1 }) === '{"a":1}' && cellValue(null) === "" && cellValue(5) === 5);
t("cell long cut", cellValue("x".repeat(40000)).length < 32100);
t("due: never", copyDue(null) === true);
t("due: same month", copyDue("2026-11-02T00:00:00Z", new Date("2026-11-24T10:00:00Z")) === false);
t("due: last month", copyDue("2026-10-30T10:00:00Z", new Date("2026-11-01T05:00:00Z")) === true);
t("due: riyadh boundary (Oct 31 22:00Z = Nov 1 Riyadh)", copyDue("2026-10-31T22:00:00Z", new Date("2026-11-03T00:00:00Z")) === false);
t("readme mentions counts", /الدفعات: 3/.test(readmeText("مكتب", "2026-11", { payments: 3 }, [])));

/* قاعدة وهمية: التصفية بالمكتب في كل جدول — ولا يتسرب صف مكتب آخر */
const O = "office-1", X = "office-2";
const DB = {
  properties: [{ id: "p1", user_id: O }, { id: "p2", user_id: X }],
  tenants: [{ id: "t1", property_id: "p1", name: "أ" }, { id: "t2", property_id: "p2", name: "ب" }],
  payments: [{ id: "y1", user_id: O, amount: 100 }, { id: "y2", user_id: X, amount: 9 }],
  associations: [{ id: "a1", user_id: O }], owners: [{ id: "o1", association_id: "a1" }, { id: "o2", association_id: "zz" }],
  expense_templates: [{ id: "e1", user_id: O }], expense_template_skips: [{ template_id: "e1", month: "2026-11" }, { template_id: "e9", month: "x" }],
  team_members: [{ owner_id: O, member_id: "m1" }, { owner_id: X, member_id: "m2" }],
  tenant_portal_links: [{ id: "l1", user_id: O, token_hash: "SECRET", tenant_id: "t1" }],
};
const fake = { from(table) {
  let rows = (DB[table] || []).slice(); let noId = !rows.length || !("id" in rows[0]);
  const q = { select() { return q; }, eq(c, v) { rows = rows.filter((r) => r[c] === v); return q; }, in(c, vs) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
    order(c) { q._o = c; return q; },
    async range(a, b) { if (q._o === "id" && noId && rows.length) return { data: null, error: { code: "42703", message: "column x.id does not exist" } };
      if (!(table in DB)) return { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
      return { data: rows.slice(a, b + 1), error: null }; } };
  return q; } };
(async () => {
  const c = await collectOffice(fake, O);
  t("no failures", c.failed.length === 0);
  t("properties own only", c.counts.properties === 1);
  t("tenants via property", c.counts.tenants === 1 && c.tables.tenants[0].name === "أ");
  t("payments own only", c.counts.payments === 1);
  t("owners via association", c.counts.owners === 1);
  t("skips via template (no id col)", c.counts.expense_template_skips === 1);
  t("team via owner_id (no id col)", c.counts.team_members === 1);
  t("token stripped", !("token_hash" in c.tables.tenant_portal_links[0]));
  t("missing tables → empty, not failure", c.counts.audit_log === 0);
  console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0);
})();
