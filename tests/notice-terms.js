/* بنود إشعار الانتهاء + تنبيه المكيفات (14 نوفمبر 2026)
   تشغيل: npx esbuild lib/tenant-messages.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tenant-messages.js
           node tests/notice-terms.js */
const M = require("/tmp/b/tenant-messages.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const base = { mode: "end", tenantName: "فهد", unitText: "الشقة (3)", propertyName: "مركز الزهراء", endDate: "2026-12-31", daysToEnd: 47,
  hijri: false, overdue: 0, unpaid: 0, carried: 0, signer: "الأولى لإدارة الأملاك" };
const plain = M.endNoticeText(base);
t("no terms → unchanged text (no fees/daily)", !/رسوم إدارية|كل يوم تأخير|لا يتم مع وجود متأخرات|الإيجار السنوي/.test(plain));
t("noticeTermsOf empty profile → all off", JSON.stringify(M.noticeTermsOf({})) === JSON.stringify({ adminFee: null, dailyRent: null, dailyArticle: null, noRenewWithArrears: false, showRent: false }));
const terms = M.noticeTermsOf({ notice_admin_fee: "500", notice_daily_rent: 200, notice_daily_article: "12/3", notice_no_renew_arrears: true, notice_show_rent: true });
const full = M.endNoticeText({ ...base, terms, annualRent: 47500 * 4 });
t("rent + admin fee line", /وفي حال الرغبة في التجديد يكون الإيجار السنوي 190,000 ريال إضافةً إلى رسوم إدارية قدرها 500 ريال\./.test(full));
t("daily rent with article, before end", /وفي حال عدم التجديد والإخلاء قبل نهاية العقد، تُحتسب أجرة قدرها 200 ريال عن كل يوم تأخير بموجب المادة \(12\/3\) من العقد/.test(full));
t("no-arrears clause hidden when no arrears", !/لا يتم مع وجود متأخرات/.test(full));
const arrears = M.endNoticeText({ ...base, overdue: 47500, unpaid: 1, terms, annualRent: 190000 });
t("no-arrears clause shown with arrears", /علمًا بأن التجديد لا يتم مع وجود متأخرات\./.test(arrears));
const feeOnly = M.endNoticeText({ ...base, terms: { adminFee: 300 } });
t("fee only wording", /وفي حال الرغبة في التجديد تُستحق رسوم إدارية قدرها 300 ريال\./.test(feeOnly) && !/الإيجار السنوي/.test(feeOnly));
const endedNonRenew = M.endNoticeText({ ...base, mode: "nonrenewal", daysToEnd: -10, terms: { dailyRent: 150 } });
t("nonrenewal + ended: daily rent 'فورًا', no admin fee, 'حسب العقد'", /وفي حال عدم الإخلاء فورًا، تُحتسب أجرة قدرها 150 ريال عن كل يوم تأخير حسب العقد/.test(endedNonRenew) && !/رسوم إدارية/.test(endedNonRenew));
t("showRent without annualRent → no rent line", !/الإيجار السنوي/.test(M.endNoticeText({ ...base, terms: { showRent: true } })));
// المكيفات
const ac = M.acDripNoticeText({ tenantName: "سعد", unitText: "الشقة (13)", propertyName: "مركز الزهراء", days: 7, signer: "الأولى" });
t("ac: name/unit/7 days/signer", ac.includes("سعد") && ac.includes("الشقة (13) بعقار مركز الزهراء") && ac.includes("خلال 7 أيام") && ac.trim().endsWith("الأولى"));
t("ac: no days → أقرب وقت", M.acDripNoticeText({ tenantName: "س", unitText: "x", propertyName: "y", signer: "z" }).includes("في أقرب وقت"));
console.log(bad ? `❌ ${bad} فشل` : `✅ ${ok} اختبار — بنود الإشعار وتنبيه المكيفات`);
process.exit(bad ? 1 : 0);
