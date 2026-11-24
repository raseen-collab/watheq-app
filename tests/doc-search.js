/* البحث برقم السند ونص الحوالة (24 نوفمبر 2026 — طلب مكتب الأولى)
   تشغيل: npx esbuild lib/doc-search.ts --bundle --format=cjs --platform=node --outfile=/tmp/b/docSearch.js && node tests/doc-search.js */
const S = require("/tmp/b/docSearch.js");
const D = require("/tmp/b/documents.js");
let ok = 0, bad = 0; const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const q = S.parseDocQuery;

t("RC-00034", q("RC-00034").n === 34 && q("RC-00034").kind === "rc");
t("rc34 lower", q("rc34").n === 34 && q("rc34").kind === "rc");
t("bare 34", q("34").n === 34 && q("34").kind === null);
t("Arabic digits ٣٤", q("٣٤").n === 34);
t("سند 34", q("سند 34").n === 34 && q("سند 34").kind === null);
t("سند قبض 34", q("سند قبض 34").kind === "rc");
t("سند صرف 12", q("سند صرف 12").n === 12 && q("سند صرف 12").kind === "pv");
t("PV-00012", q("PV-00012").n === 12 && q("PV-00012").kind === "pv");
t("#7", q("#7").n === 7);
t("R-00005 (old)", q("R-00005").n === 5 && q("R-00005").kind === "rc");
t("zero not a number", q("0").n === null && q("00000").n === null);
t("8 digits not receipt", q("12345678").n === null && q("12345678").text === "12345678");
t("name is text only", q("محمد").n === null && q("محمد").text === "محمد");
t("short text ignored", q("ab").text === "" && q("5").text === "");
t("suffix padding", S.numSuffix(34) === "00034" && S.numSuffix(123456) === "123456" && S.numSuffix(99999) === "99999");

const f34 = S.paymentsFilter(q("RC-00034"));
t("payments filter number", f34.includes("receipt_no.ilike.*-00034") && f34.includes("reference.ilike.*RC-00034*"));
t("bare 34 → both tables", S.paymentsFilter(q("34")).includes("receipt_no.ilike.*-00034") && S.expensesFilter(q("34")).includes("voucher_no.ilike.*-00034"));
t("pv not in payments receipt", !S.paymentsFilter(q("PV-00012")).includes("receipt_no"));
t("rc not in expenses voucher", !S.expensesFilter(q("RC-00034")).includes("voucher_no"));
t("2-digit bare: number only, no text", S.paymentsFilter(q("34")) === "receipt_no.ilike.*-00034");
t("nothing → null", S.paymentsFilter(q("a")) === null && S.expensesFilter(q("")) === null);

/* حقن PostgREST: الفاصلة والأقواس تكسر or() أو تضيف شروطًا */
const inj = q("x,user_id.eq.1)or(id.gt.0");
t("injection stripped", !/[,()]/.test(inj.text));
t("injection filter has exactly 3 parts", S.paymentsFilter(inj).split(",").length === 3);
t("percent/star stripped", !/[%*]/.test(q("50%*off").text));
t("text capped 60", q("أ".repeat(200)).text.length === 60);

/* رسالة بنك نموذجية: آخر أرقام المرجع */
const sms = "حوالة واردة مبلغ 1,500.00 ر.س من علاوي السلمي إلى حسابكم ****4417 مرجع FT2611013388 في 2026-11-01";
t("bank sms search text", q("3388").n === 3388 && q("FT2611").text === "FT2611");
t("snippet centers match", S.snippet(sms, "FT2611013388", 40).includes("FT2611013388"));
t("snippet ellipsis", S.snippet(sms, "FT2611013388", 40).startsWith("…"));
t("snippet short kept", S.snippet("قصير", "x") === "قصير" && S.snippet(null, "x") === "");
t("snippet no match → head", S.snippet(sms, "zzz", 20).endsWith("…") && S.snippet(sms, "zzz", 20).length === 20);

/* السند يحمل رسالة طويلة كاملة (حتى 1000 حرف) */
const long = sms + " " + "ملاحظة ".repeat(100);
t("receipt keeps up to 1000", D.receiptNoteText(long).length === Math.min(1000, long.trim().replace(/[ \t]+/g, " ").length));
t("receipt cap 1000", D.receiptNoteText("ب".repeat(1500)).length === 1000);

console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0);
