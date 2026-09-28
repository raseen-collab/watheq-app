/* كل المستندات السبعة عشر — لا عيّنة منها.
   الترويسة والتذييل مشتركان، لكن «مشترك» ادّعاء حتى يُختبر كل مُصدِر على حدة.
   npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/documents.js */
const D = require("/tmp/b/documents.js");

let fails = 0;
const OFFICE = {
  billing_name: "مكتب تميز التطوير للعقارات", billing_phone: "0501234567", cr_number: "1010101010",
  plan: "pro", subscribed_until: new Date(Date.now() + 30 * 864e5).toISOString(),
};

const t1 = { id: "t1", property_id: "p1", name: "سعد العتيبي", unit: "شقة 3", rent_amount: 3000,
  payment_frequency: "monthly", contract_periods: 12, paid_periods: 4,
  contract_start: "2026-01-01", contract_end: "2026-12-31" };
const prop = { id: "p1", name: "برج الياسمين", user_id: "u1", property_type: "residential",
  mgmt_fee_pct: 5, owner_name: "عبدالله المالكي", tenants: [t1] };
const assoc = { id: "a1", name: "جمعية ملاك برج الياسمين", units: 20, fee: 1200, owners: [] };
const owner = { name: "عبدالله المالكي", units: 3, paid: 1, due: 2 };
const period = { label: "سبتمبر 2026", from: "2026-09-01", to: "2026-09-28" };
const inv = { invoice_no: "INV-2026-0001", amount: 3000, due_date: "2026-09-05", period_label: "الدفعة 1 من 12" };

/* كل مُصدِر: [الاسم، الاستدعاء] */
const DOCS = [
  ["statementHTML",                () => D.statementHTML(t1, prop, OFFICE, [], "full")],
  ["invoiceHTML",                  () => D.invoiceHTML(t1, prop, inv, OFFICE)],
  ["quotationHTML",                () => D.quotationHTML(prop, { quote_no: "Q-2026-1", tenant_name: "سعد العتيبي",
      unit: "شقة 3", rent_amount: 3000, payment_frequency: "monthly", contract_periods: 12,
      start_date: "2026-10-01", deposit: 3000, valid_until: "2026-10-15", charges: [] }, OFFICE)],
  ["propertyStatementHTML",        () => D.propertyStatementHTML(prop, OFFICE, "full", period, [], [])],
  ["ownerStatementHTML",           () => D.ownerStatementHTML(owner, assoc, OFFICE, [])],
  ["associationStatementHTML",     () => D.associationStatementHTML(assoc, OFFICE)],
  ["budgetHTML",                   () => D.budgetHTML(assoc, { year: 2027, items: [{ label: "صيانة", amount: 10000 }] }, OFFICE)],
  ["foundingMinutesHTML",          () => D.foundingMinutesHTML(assoc, { meeting_date: "2026-09-01", attendees: 13 }, OFFICE)],
  ["moveOutSettlementHTML",        () => D.moveOutSettlementHTML({ ...t1, move_out_date: "2026-09-20" }, prop, OFFICE)],
  ["renewalMinutesHTML",           () => D.renewalMinutesHTML(assoc, { meeting_date: "2026-09-01", attendees: 13 }, OFFICE)],
  ["ownerReportHTML",              () => D.ownerReportHTML(prop, period, [], OFFICE, {}, "full")],
  ["ownerConsolidatedStatementHTML", () => D.ownerConsolidatedStatementHTML("عبدالله المالكي",
      [{ property: prop, payments: [], expenses: [] }], period, OFFICE)],
  ["complianceRegisterHTML",       () => D.complianceRegisterHTML([], "تميز التطوير", OFFICE)],
  ["listingsRegisterHTML",         () => D.listingsRegisterHTML([], "تميز التطوير", OFFICE)],
  ["expensesRegisterHTML",         () => D.expensesRegisterHTML([], period, OFFICE, {})],
  ["collectionStatementHTML",      () => D.collectionStatementHTML([], [], period, OFFICE)],
];

console.log(`فحص ${DOCS.length} مستندًا + فاتورة الاشتراك\n`);

for (const [name, run] of DOCS) {
  let html;
  try { html = run(); }
  catch (e) { fails++; console.log(`❌ ${name} — رمى خطأً: ${e.message}`); continue; }

  const problems = [];
  if (!/<div class="t">مكتب تميز التطوير للعقارات<\/div>/.test(html)) problems.push("اسم المكتب غائب عن الترويسة");
  if (/<div class="t">وثيق<\/div>/.test(html))                        problems.push("«وثيق» ما زالت في الترويسة");
  if (!/<div class="seal">ت<\/div>/.test(html))                       problems.push("الختم ليس «ت»");
  if (/watheqdocs@gmail\.com/.test(html))                             problems.push("بريد وثيق في المستند");
  if (/FL-763162251/.test(html))                                      problems.push("رقم وثيقة العمل الحر في المستند");
  if (!/0501234567/.test(html))                                       problems.push("رقم المكتب غائب عن التذييل");
  if (/إدارة الأملاك العقارية<\/div>/.test(html))                      problems.push("السطر الفرعي المحذوف ما زال موجودًا");

  if (problems.length) { fails++; console.log(`❌ ${name}\n   ${problems.join("\n   ")}`); }
  else console.log(`✓ ${name}`);
}

/* الاستثناء الوحيد: فاتورة اشتراك وثيق — مُصدِرها وثيق فعلًا */
const sub = D.subscriptionInvoiceHTML({ invoice_no: "WTQ-2026-0001", to_name: "عبيد", to_org: "تميز التطوير",
  plan_label: "باقة المكتب", months: 12, amount: 1990, from_date: "2026-10-01", to_date: "2027-09-30" });
const subOk = /<div class="t">وثيق<\/div>/.test(sub) && /FL-763162251/.test(sub) && !/0501234567/.test(sub);
if (!subOk) { fails++; console.log("❌ subscriptionInvoiceHTML — يجب أن تبقى باسم وثيق"); }
else console.log("✓ subscriptionInvoiceHTML (مستثناة عمدًا: باسم وثيق)");

console.log(fails ? `\n❌ ${fails} فشل` : `\n✅ ${DOCS.length + 1} مستندًا — كلها تحمل هوية المكتب، والاشتراك وحدها باسم وثيق`);
process.exit(fails ? 1 : 0);
