/* لغة المراسلة للمستأجر (24 نوفمبر 2026 — v105)
   تشغيل: npx esbuild lib/msg-lang.ts --bundle --format=cjs --platform=node --outfile=/tmp/b/msgLang.js
          npx esbuild lib/tenant-messages.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tenantMessages.js
          npx esbuild lib/tenantPortal.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tenantPortal.js
          node tests/msg-lang.js */
const L = require("/tmp/b/msgLang.js");
const M = require("/tmp/b/tenantMessages.js");
const P = require("/tmp/b/tenantPortal.js");
let ok = 0, bad = 0; const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const arabic = (s) => /[؀-ۿ]/.test(s);

t("norm default ar", L.normLang(null) === "ar" && L.normLang("x") === "ar" && L.normLang("en") === "en" && L.normLang("both") === "both");
t("pick ar", L.pickMsg("ar", () => "ع", () => "E") === "ع");
t("pick en", L.pickMsg("en", () => "ع", () => "E") === "E");
t("pick both = ar then en", L.pickMsg("both", () => "ع", () => "E") === "ع\n\n— English —\n\nE");
t("suggest latin name", L.suggestLang("John Smith") === "en" && L.suggestLang("Rahul K") === "en");
t("no suggest arabic", L.suggestLang("محمد العتيبي") === null && L.suggestLang("محمد John") === null && L.suggestLang("") === null);
t("parse cells", L.parseLangCell("English") === "en" && L.parseLangCell("انجليزي") === "en" && L.parseLangCell("عربي") === "ar"
  && L.parseLangCell("الاثنين") === "both" && L.parseLangCell("عربي + انجليزي") === "both" && L.parseLangCell("") === null && L.parseLangCell("??") === null);

const base = { tenantName: "John", unitText: "الشقة (12)", unitTextEn: "Apartment (12)", propertyName: "Al Yasmin Tower", signer: "Al Oula PM",
  unpaid: 2, nextDueDate: "2026-10-01", daysToNextDue: -54, upcomingDate: "2026-12-01", instalment: 3000, instalmentVat: 0, partial: 500,
  owed: 5500, owedVat: false, carried: 1000, endDate: "2026-12-15", daysToEnd: 21, expiringSoon: true };
const en = M.reminderTextEn(base), ar = M.reminderText(base);
t("reminder EN has no Arabic", !arabic(en));
t("reminder EN figures", /SAR 5,500/.test(en) && /SAR 1,000/.test(en) && /Total due: SAR 6,500/.test(en) && /Overdue instalments: 2/.test(en) && /Paid partially: SAR 500/.test(en));
t("reminder EN dates", /1 October 2026/.test(en) && /1 December 2026/.test(en) && /15 December 2026/.test(en));
t("reminder AR same figures", /5,500/.test(ar) && /6,500/.test(ar) && /عدد الدفعات المتأخرة: 2/.test(ar));
const up = M.reminderTextEn({ ...base, unpaid: 0, owed: 0, carried: 0, partial: 0, daysToNextDue: 7, nextDueDate: "2026-12-01", instalmentVat: 391.3, expiringSoon: false });
t("upcoming EN", /due on 1 December 2026 — in 7 days/.test(up) && /incl\. SAR 391\.3 VAT/.test(up) && !arabic(up));
const mi = { tenantName: "John", unitText: "الشقة (12)", unitTextEn: "Apartment (12)", propertyName: "Tower", account: "3001234", days: 7, signer: "Office" };
t("meter EN", !arabic(M.meterNoticeTextEn(mi)) && /3001234/.test(M.meterNoticeTextEn(mi)) && /within 7 days/.test(M.meterNoticeTextEn(mi)));
t("ac EN", !arabic(M.acDripNoticeTextEn(mi)));
const ri = { tenantName: "John", amount: 1200, paidOn: "2026-11-20", receiptNo: "RC-00012", url: "https://x/r", signer: "Office" };
t("receipt EN", M.receiptMsgEn(ri) === "Dear John,\nWe have received SAR 1,200 on 20 November 2026 — receipt no. RC-00012.\nPayment receipt: https://x/r\n\nThank you, Office");
t("portal EN", !arabic(M.portalLinkMsgEn({ tenantName: "John", unitText: "الشقة (1)", unitTextEn: "Apartment (1)", propertyName: "Tower", url: "u" })));
t("past debt EN", !arabic(M.pastDebtMsgEn({ name: "John", propertyName: "Tower", unit: "5", amount: 800, signer: "Office" })));

/* صفحة المستأجر بالإنجليزية */
const d = { tenant: { name: "John", unit: "12", unit_type: "apartment", rent_amount: 3000, contract_start: "2026-01-01", payment_frequency: "monthly",
  contract_periods: 12, paid_periods: 9, status: "active", calendar: "gregorian", msg_lang: "en" },
  property: { name: "Tower", property_type: "residential" }, office: { org_name: "مكتب الأولى", billing_phone: "0500000000" },
  show_balance: true, active: true, today: "2026-11-24", payments: [], claims: [], requests: [{ id: "r1", category: "plumbing", location: "unit", description: "leak", status: "in_progress", manager_note: null, created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-21T10:00:00Z", closed_at: null, log: [] }] };
const html = P.renderTenantPage(d, { nonce: "n", base: "/r/t/x" });
const body = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<script[\s\S]*?<\/script>/g, "");
t("portal en: ltr", /<html lang="en" dir="ltr">/.test(html));
t("portal en: headings", /Your account/.test(body) && /Your lease/.test(body) && /Maintenance requests/.test(body) && /Plumbing &amp; leaks|Plumbing & leaks/.test(body));
t("portal en: switch to Arabic", /\?lang=ar/.test(body));
const leftover = (body.match(/[؀-ۿ][؀-ۿ\s]{3,}/g) || []).filter((x) => !/مكتب الأولى|العربية/.test(x));
t(`portal en: no Arabic UI text left (${leftover.slice(0, 3).join(" | ")})`, leftover.length === 0);
const htmlAr = P.renderTenantPage({ ...d, tenant: { ...d.tenant, msg_lang: "both" } }, { nonce: "n", base: "/r/t/x" });
t("portal both → Arabic with English switch", /<html lang="ar" dir="rtl">/.test(htmlAr) && /\?lang=en/.test(htmlAr) && /حالة حسابك/.test(htmlAr));
t("override", P.portalLang("ar", "en") === "en" && P.portalLang("en", null) === "en" && P.portalLang("both", null) === "ar" && P.portalLang("en", "zz") === "en");
console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0);
