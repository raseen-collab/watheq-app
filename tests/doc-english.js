/* النسخة الإنجليزية من المستندات (18 نوفمبر 2026 — طلب مكتب «الأولى»)
   تشغيل: npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/documents.js
           npx esbuild lib/docEn.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/docEn.js
           npx esbuild lib/tenant-messages.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tenant-messages.js
           node tests/doc-english.js */
const D = require("/tmp/b/documents.js");
const E = require("/tmp/b/docEn.js");
const M = require("/tmp/b/tenant-messages.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const enPart = (h) => { const i = h.indexOf('<div id="wq-en"'); return i < 0 ? "" : h.slice(i); };
const arPart = (h) => { const a = h.indexOf('<div id="wq-ar">'), b = h.indexOf('<div id="wq-en"'); return a < 0 || b < 0 ? "" : h.slice(a, b); };
const arabic = /[؀-ۿ]/;

/* ── المساعدات ── */
t("enDate", E.enDate("2026-03-05") === "5 March 2026" && E.enDate(null) === "—" && E.enDate("2026-13-01") === "2026-13-01");
t("words 0", E.riyalsInWordsEn(0) === "Only zero Saudi riyals");
t("words 1", E.riyalsInWordsEn(1) === "Only one Saudi riyal");
t("words 4750", E.riyalsInWordsEn(4750) === "Only four thousand seven hundred and fifty Saudi riyals");
t("words halalas", E.riyalsInWordsEn(2608.7) === "Only two thousand six hundred and eight Saudi riyals and seventy halalas");
t("words 0.01", E.riyalsInWordsEn(0.01) === "Only one halala");
t("words big", E.riyalsInWordsEn(1250021) === "Only one million two hundred and fifty thousand twenty-one Saudi riyals");
t("words float noise", E.riyalsInWordsEn(0.1 + 0.2) === "Only thirty halalas");
t("words negative uses abs", E.riyalsInWordsEn(-15) === "Only fifteen Saudi riyals");
t("method", E.methodEn("ejar") === "Ejar platform" && E.methodEn("x") === "—" && E.methodEn(null) === "—");
t("freq default monthly", E.freqEn(null) === "Monthly" && E.freqEn("quarterly") === "Every 3 months");
t("unit word mirrors unitWordFor", E.unitWordEn("showroom", "residential") === "Showroom" && E.unitWordEn(null, "mixed") === "Unit"
  && E.unitWordEn(null, "residential") === "Apartment" && E.unitWordEn("other", "residential") === "Unit" && E.unitWordEn(null, null) === "Unit");
t("period label", E.periodLabelEn("الدفعة 3 من 12") === "Instalment 3 of 12" && E.periodLabelEn("نوفمبر") === "نوفمبر" && E.periodLabelEn(null) === "");
t("statement: carried / past / partial / n",
  E.receiptStatementEn({ applies_to: "carried" }, "Apartment", "1").includes("carried over")
  && E.receiptStatementEn({ applies_to: "past_debt" }, "Apartment", "1").includes("previous tenant")
  && E.receiptStatementEn({ periods_covered: 0 }, "Apartment", "107").endsWith("— partial payment")
  && E.receiptStatementEn({ periods_covered: 2 }, "Shop", "5", "annual") === "Rent for Shop no. (5) — 2 instalments (Annual)");

/* ── سند القبض ── */
const pay = { id: "11111111-1111-4111-8111-111111111111", receipt_no: "RC-00042", paid_on: "2026-11-14", amount: 4750, method: "ejar",
  reference: "FT2611", periods_covered: 1, applies_to: "rent", payer_name: "رهيب علي <b>x</b>", unit_label: "107",
  created_at: "2026-11-14T09:30:00Z", note: "حوالة إيجار — <script>alert(1)</script>" };
const ten = { name: "رهيب علي", unit: "107", unit_type: "showroom", contract_no: "10434414222", payment_frequency: "quarterly" };
const prop = { name: "مركز الزهراء", property_type: "mixed" };
const issuer = { billing_name: "مكتب الأولى لإدارة الأملاك", billing_phone: "0570376617", cr_number: "7018004502" };
const r = D.receiptHTML(pay, ten, prop, issuer);
const rEn = enPart(r), rAr = arPart(r);
t("receipt: both parts + lang button", rEn && rAr && r.includes('id="wq-lang"') && r.includes(">English</button>"));
t("receipt: Arabic part unchanged essentials", rAr.includes("RC-00042") && /أربعة آلاف وسبعمائة وخمسون/.test(rAr) && rAr.includes("منصة إيجار"));
t("receipt: en hidden by default, ltr", /<div id="wq-en" lang="en" dir="ltr" hidden>/.test(r));
t("receipt en: number, amount, words", rEn.includes("RC-00042") && rEn.includes("SAR 4,750") && rEn.includes("Only four thousand seven hundred and fifty Saudi riyals"));
t("receipt en: method, ref, contract", rEn.includes("Ejar platform") && rEn.includes("FT2611") && rEn.includes("10434414222"));
t("receipt en: showroom word + statement", rEn.includes("Rent for Showroom no. (107) — 1 instalment (Every 3 months)"));
t("receipt en: date english", rEn.includes("14 November 2026") && rEn.includes("Date: 14 November 2026"));
t("receipt en: note kept, escaped", rEn.includes("حوالة إيجار") && !r.includes("<script>alert") && rEn.includes("&lt;script&gt;"));
t("receipt en: payer escaped", !rEn.includes("<b>x</b>") && rEn.includes("&lt;b&gt;x&lt;/b&gt;"));
t("receipt en: issuer + CR in footer", rEn.includes("مكتب الأولى لإدارة الأملاك") && rEn.includes("CR 7018004502"));
t("receipt en: no Arabic template words", !/استلمنا|المبلغ بالحروف|سند قبض|التوقيع/.test(rEn));
const rRev = enPart(D.receiptHTML({ ...pay, reversed_on: "2026-11-15T10:00:00Z" }, ten, prop, issuer));
t("receipt en: reversed stamp", rRev.includes("REVERSED") && rRev.includes("15 November 2026") && rRev.includes("Reversed receipt"));
const rNo = enPart(D.receiptHTML({ ...pay, receipt_no: null, note: null, reference: null }, { name: "x" }, { name: "y" }, {}));
t("receipt en: minimal data no crash + defaults", rNo.includes("Receipt no.") && rNo.includes("Property management") && !rNo.includes("Reference") && !rNo.includes(">Note<"));
t("receipt: title attrs escaped", !/data-en-title="[^"]*<b>/.test(r));
t("receipt: one print script, nonce replaced", (r.match(/nonce="__WQ_NONCE__"/g) || []).length === 0);

/* ── الفاتورة ── */
const tn = { id: "t1", name: "شركة النور", unit: "M3", phone: null, national_id: "7001234567", rent_amount: 10000, contract_start: "2026-01-01",
  contract_end: null, payment_frequency: "quarterly", paid_periods: 2, contract_periods: 4, unit_type: "showroom" };
const pv = { name: "مركز الزهراء", address: null, city: "جدة", manager: null, property_type: "mixed", vat_enabled: true, vat_rate: 15, vat_inclusive: false };
const iss = { billing_name: "مكتب الأولى", vat_number: "310000000000003", cr_number: "7018004502" };
const inv = D.invoiceHTML(tn, pv, { invoice_no: "INV-2026-0007", amount: 10000, due_date: "2026-07-01", period_label: "الدفعة 3 من 4" }, iss);
const iEn = enPart(inv), iAr = arPart(inv);
t("invoice: both parts", iEn && iAr && iAr.includes("فاتورة ضريبية مبسطة"));
t("invoice en: tax title + period + freq", iEn.includes("Simplified tax invoice") && iEn.includes("Instalment 3 of 4") && iEn.includes("Every 3 months"));
t("invoice en: VAT split 10000 + 1500 = 11500", iEn.includes("SAR 11,500") && iEn.includes(">1,500<") && iEn.includes(">10,000<"));
t("invoice: same totals in both", iAr.includes("11,500") && iAr.includes("1,500"));
t("invoice en: QR with distinct ids", iEn.includes('id="zatca-qr-en"') && iAr.includes('id="zatca-qr"') && (inv.match(/qrcode\.min\.js/g) || []).length === 1);
t("invoice: QR payloads identical", (() => { const a = /id="zatca-tlv"[^>]*>([^<]+)</.exec(inv), b = /id="zatca-tlv-en"[^>]*>([^<]+)</.exec(inv); return a && b && a[1] === b[1]; })());
t("invoice en: Arabic-is-binding note", iEn.includes("must be issued in Arabic"));
t("invoice en: VAT no + CR", iEn.includes("310000000000003") && iEn.includes("7018004502"));
const invV = enPart(D.invoiceHTML(tn, pv, { invoice_no: "INV-1", amount: 10000, due_date: "2026-07-01", period_label: "الدفعة 3 من 4", status: "void", issue_date: "2026-06-01" }, iss));
t("invoice en: void → no QR, void banner", invV.includes("VOID") && !invV.includes("zatca-qr-en") && invV.includes("Void invoice"));
const invN = enPart(D.invoiceHTML({ ...tn, unit_type: "apartment" }, { ...pv, property_type: "residential" }, { invoice_no: "INV-2", amount: 3000, due_date: "2026-07-01", period_label: "الدفعة 1 من 12" }, { billing_name: "مكتب" }));
t("invoice en: residential apartment no VAT → plain invoice", invN.includes("Rent invoice") && !invN.includes("VAT (") && invN.includes("Apartment") && invN.includes("SAR 3,000"));
const invX = enPart(D.invoiceHTML(tn, pv, { invoice_no: "INV-3", amount: 10000, due_date: "2026-07-01", period_label: "الدفعة 3 من 4" }, { billing_name: "مكتب" }));
t("invoice en: VAT on but no VAT no → warning, no QR", invX.includes("VAT number is not registered") && !invX.includes("zatca-qr-en"));

/* ── كشف الحساب ── */
const st = D.statementHTML({ ...tn, phone: "0555555555", carried_debt: 450 }, pv, iss, [
  { id: "p1", paid_on: "2026-01-02", amount: 10000, method: "transfer", periods_covered: 1, receipt_no: "RC-1" },
  { id: "p2", paid_on: "2026-04-03", amount: 10000, method: "ejar", periods_covered: 1, note: "ملاحظة" },
], "full");
const sEn = enPart(st), sAr = arPart(st);
t("statement: both parts", sEn && sAr);
t("statement en: title + unit", sEn.includes("Full account statement") && sEn.includes("Account statement — Showroom no."));
t("statement en: carried line + payments", sEn.includes("Balance carried from a previous term") && sEn.includes("SAR 450") && sEn.includes("Receipt RC-1") && sEn.includes("Ejar platform"));
t("statement en: received total incl VAT (2×11,500)", sEn.includes(">23,000<"));
t("statement: Arabic total same", sAr.includes(">23,000<"));
t("statement en: schedule rows 4", (sEn.match(/<td>[1-4]<\/td><td>/g) || []).length === 4);
t("statement en: mobile ltr", sEn.includes('<span dir="ltr">0555555555</span>'));
t("statement en: no Arabic template labels", !/المسدَّد|الدفعة القادمة|بيانات العقد|إجمالي المستلم/.test(sEn));
const sB = enPart(D.statementHTML(tn, pv, iss, [], "brief"));
t("statement en brief: no schedule, no-payments note", sB.includes("Brief account statement") && !sB.includes("Instalment schedule") && sB.includes("No payments are recorded"));

/* ── إشعار الانتهاء ── */
const base = { mode: "end", tenantName: "Ahmed", unitText: "معرض (M3)", unitTextEn: "Showroom (M3)", propertyName: "مركز الزهراء",
  endDate: "2026-12-31", daysToEnd: 43, overdue: 0, unpaid: 0, carried: 0, signer: "مكتب الأولى" };
const n1 = M.endNoticeTextEn(base);
t("notice en: greeting, date, days", n1.startsWith("Dear Ahmed,") && n1.includes("ends on 31 December 2026 — in 43 days") && n1.includes("Showroom (M3), مركز الزهراء"));
t("notice en: no arrears line + options", n1.includes("no overdue amounts") && n1.includes("• Renewing the lease, or") && n1.endsWith("Kind regards,\nمكتب الأولى"));
t("notice en: no Arabic template", !arabic.test(n1.replace(/مركز الزهراء|مكتب الأولى/g, "")));
const n2 = M.endNoticeTextEn({ ...base, daysToEnd: -3, overdue: 11500, overdueVat: true, unpaid: 1, carried: 450,
  terms: { adminFee: 500, dailyRent: 200, dailyArticle: "12", noRenewWithArrears: true, showRent: true }, annualRent: 40000 });
t("notice en: ended + amounts + total", n2.includes("ended on 31 December 2026") && n2.includes("Overdue instalment: SAR 11,500 (incl. VAT)") && n2.includes("Total due: SAR 11,950"));
t("notice en: terms", n2.includes("If you wish to renew, the annual rent will be SAR 40,000 plus an administrative fee of SAR 500.")
  && n2.includes("cannot be renewed while arrears remain") && n2.includes("SAR 200 per day of delay applies under Article (12)"));
const n3 = M.endNoticeTextEn({ ...base, mode: "nonrenewal", terms: { adminFee: 500 } });
t("notice en: nonrenewal, no renew fee line", n3.includes("do not wish to renew") && !n3.includes("administrative fee") && n3.includes("before that date"));
const n4 = M.endNoticeTextEn({ ...base, terms: { adminFee: 300 } });
t("notice en: fee only phrasing", n4.includes("If you wish to renew, an administrative fee of SAR 300 applies."));
const n5 = M.endNoticeTextEn({ ...base, unitTextEn: undefined, daysToEnd: 0, upcomingDate: "2026-12-01", upcomingAmount: 3000 });
t("notice en: today + fallback unit text + upcoming", n5.includes("ends today, 31 December 2026") && n5.includes("معرض (M3)") && n5.includes("SAR 3,000 is due on 1 December 2026"));
const n6 = M.endNoticeTextEn({ ...base, unpaid: 3, overdue: 9000 });
t("notice en: plural overdue", n6.includes("Overdue instalments (3): SAR 9,000") && n6.includes("must be settled before renewal"));
/* العربي لم يتغيّر */
const a1 = M.endNoticeText(base);
t("arabic notice unchanged", a1.startsWith("السلام عليكم ورحمة الله، Ahmed") && a1.includes("بعد 43 يومًا"));

console.log(`doc-english: ${ok} ✓ / ${bad} ✗`);
process.exit(bad ? 1 : 0);
