/* هوية المستند: المكتب هو المُصدِر، ووثيق الأداة.
   يُبنى أولًا: npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/documents.js */
const D = require("/tmp/b/documents.js");

let fails = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fails++; console.log(`❌ ${name}${extra ? "\n   " + extra : ""}`); }
  else console.log(`✓ ${name}`);
};

/* ═══ المدخلات ═══ */
const OFFICE = {
  billing_name: "مكتب تميز التطوير للعقارات",
  billing_phone: "0501234567",
  cr_number: "1010101010",
  plan: "pro",
  subscribed_until: new Date(Date.now() + 30 * 864e5).toISOString(),
};
const NO_NAME = { plan: "pro", subscribed_until: new Date(Date.now() + 30 * 864e5).toISOString() };

const prop = {
  id: "p1", name: "برج الياسمين", user_id: "u1", property_type: "residential",
  mgmt_fee_pct: 5, tenants: [],
};
const tenant = {
  id: "t1", property_id: "p1", name: "سعد العتيبي", unit: "شقة 3",
  rent_amount: 3000, payment_frequency: "monthly", contract_periods: 12, paid_periods: 4,
  contract_start: "2026-01-01", contract_end: "2026-12-31",
};
const period = { label: "سبتمبر 2026", from: "2026-09-01", to: "2026-09-28" };

/* رأس المستند وذيله — المستندان اللذان يخرجان من يد المكتب إلى غيره */
const ownerDoc = D.ownerReportHTML({ ...prop, tenants: [tenant] }, period, [], OFFICE, {}, "full");
const tenantDoc = D.statementHTML(tenant, prop, OFFICE, [], "full");

/* ═══ 1) الترويسة صارت للمكتب ═══ */
ok("اسم المكتب في ترويسة تقرير المالك",
   /<div class="t">مكتب تميز التطوير للعقارات<\/div>/.test(ownerDoc));
ok("الختم أول حرف من الاسم بعد «مكتب» لا «م»",
   /<div class="seal">ت<\/div>/.test(ownerDoc),
   (ownerDoc.match(/<div class="seal">.<\/div>/) || [])[0]);
ok("لم تعد «وثيق» عنوان الترويسة",
   !/<div class="t">وثيق<\/div>/.test(ownerDoc));
ok("كشف المستأجر يحمل الترويسة نفسها",
   /<div class="t">مكتب تميز التطوير للعقارات<\/div>/.test(tenantDoc));

/* ═══ 2) التذييل صار بيانات المكتب لا بيانات وثيق ═══ */
ok("تواصل المكتب في التذييل", /0501234567/.test(ownerDoc) && /س\.ت 1010101010/.test(ownerDoc));
ok("بريد وثيق لم يعد أمام عميل المكتب", !/watheqdocs@gmail\.com/.test(ownerDoc));
ok("رقم وثيقة العمل الحر ليس في مستند المكتب", !/FL-763162251/.test(ownerDoc));
ok("سطر إخلاء المسؤولية باقٍ (يحمي الطرفين)",
   /لا تقدّم خدمات قانونية أو محاسبية/.test(ownerDoc) && /لا تستلم ولا تحوّل أي مبالغ/.test(ownerDoc));

/* ═══ 3) مكتب بلا اسم: لا يخرج مستند بلا هوية ═══ */
const anon = D.ownerReportHTML({ ...prop, tenants: [tenant] }, period, [], NO_NAME, {}, "full");
ok("بلا اسم مكتب تعود ترويسة وثيق", /<div class="t">وثيق<\/div>/.test(anon));
ok("وبلا اسم يعود التذييل الأصلي", /FL-763162251/.test(anon));

/* ═══ 4) فاتورة اشتراك وثيق مستثناة — مُصدِرها وثيق فعلًا ═══ */
const sub = D.subscriptionInvoiceHTML({
  invoice_no: "WTQ-2026-0001", to_name: "عبيد", to_org: "تميز التطوير",
  plan_label: "باقة المكتب", months: 12, amount: 1990,
  from_date: "2026-10-01", to_date: "2027-09-30",
});
ok("فاتورة الاشتراك تبقى باسم وثيق", /<div class="t">وثيق<\/div>/.test(sub));
ok("وفيها رقم وثيقة العمل الحر", /FL-763162251/.test(sub));

/* ═══ 5) منطق العلامة لم يتغيّر: التجربة سطر، والمنتهية علامة مائية ═══ */
const trial = D.ownerReportHTML({ ...prop, tenants: [tenant] }, period, [],
  { ...OFFICE, trial: true }, {}, "full");
const expired = D.ownerReportHTML({ ...prop, tenants: [tenant] }, period, [],
  { ...OFFICE, expired: true }, {}, "full");
ok("حساب تجربة: سطر «أُنشئ عبر وثيق» باقٍ", /أُنشئ عبر <b>وثيق<\/b>/.test(trial));
ok("حساب مشترك: بلا سطر ولا علامة",
   !/أُنشئ عبر <b>وثيق<\/b>/.test(ownerDoc) && !/class="wm"/.test(ownerDoc));
ok("تجربة منتهية: العلامة المائية باقية", /class="wm"/.test(expired));

/* ═══ 6) لا حقن HTML من اسم المكتب ═══ */
const evil = D.ownerReportHTML({ ...prop, tenants: [tenant] }, period, [],
  { ...OFFICE, billing_name: '<img src=x onerror=alert(1)>مكتب' }, {}, "full");
ok("اسم المكتب مهروب في الترويسة", !/<img src=x/.test(evil) && /&lt;img/.test(evil));

console.log(fails ? `\n❌ ${fails} فشل` : "\n✅ هوية المستند صارت للمكتب، ووثيق في موضعها");
process.exit(fails ? 1 : 0);
