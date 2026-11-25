/* (25 نوفمبر 2026 — v104) لون المكتب وشعاره على كل مستند */
const D = require("/tmp/b/documents.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const office = { billing_name: "الأولى لإدارة الأملاك", brand_color: "#081b3c", brand_logo: LOGO };
const pay = { id: "x", amount: 2550, paid_on: "2026-11-25", method: "transfer", receipt_no: "RC-00041", periods_covered: 0 };
const ten = { name: "ليه دبليو اكونار", unit: "16ش", rent_amount: 5500, payment_frequency: "monthly" };
const prop = { name: "الزهراء بلازا", property_type: "residential" };
const h = D.receiptHTML(pay, ten, prop, office);
t("logo in header", h.includes(`<img class="logo" src="${LOGO}"`));
t("no letter seal when logo", !/<div class="seal">ا<\/div>/.test(h));
t("navy header colour", /\.hd,\.due,\.noprint \.a\{background:#081B3C\}/.test(h));
t("white header text on navy", /\.hd,\.due\{color:#FFFFFF\}/.test(h));
t("disclaimer once (footer only)", (h.match(/لا تستلم ولا تحوّل أي مبالغ/g) || []).length === 1);
t("english disclaimer once", (h.match(/does not receive or transfer any funds/g) || []).length === 1);
/* بلا شعار: أول حرف من الاسم بعد «مكتب» */
const h2 = D.receiptHTML(pay, ten, prop, { billing_name: "مكتب تميز التطوير", brand_color: "#7A1F2B" });
t("seal = first letter (ت)", /<div class="seal">ت<\/div>/.test(h2));
t("custom colour", h2.includes("background:#7A1F2B"));
/* بلا لون: لا تجاوز — لون وثيق */
const h3 = D.receiptHTML(pay, ten, prop, { billing_name: "مكتب سمو" });
t("no brand style without colour/logo", !/\.hd,\.due,\.noprint \.a\{background/.test(h3));
/* لون فاتح: نص الترويسة داكن، والعناوين مغمّقة */
const h4 = D.receiptHTML(pay, ten, prop, { billing_name: "مكتب ضوء", brand_color: "#F4D35E" });
t("light colour → dark header text", /\.hd,\.due\{color:#0B211F\}/.test(h4));
t("light colour → darkened headings", !/h1,h2,\.tot \.v,\.noprint \.b\{color:#F4D35E\}/.test(h4));
/* حقن: لون أو شعار غير صالح يُتجاهل */
const h5 = D.receiptHTML(pay, ten, prop, { billing_name: "مكتب س", brand_color: "red;}body{display:none", brand_logo: "javascript:alert(1)" });
t("bad colour ignored", !h5.includes("body{display:none") && !h5.includes("red;"));
t("bad logo ignored", !h5.includes("javascript:"));
t("svg logo rejected", D.brandLogoOf({ brand_logo: "data:image/svg+xml;base64,PHN2Zz4=" }) === null);
/* فاتورة اشتراك وثيق (بلا مُصدِر): هوية وثيق كما هي */
t("brandInkOf light darkened", D.brandInkOf({ brand_color: "#F4D35E" }) !== "#F4D35E" && D.brandInkOf({ brand_color: "#081B3C" }) === "#081B3C");
console.log(`doc-brand-color: ${ok} ✓  ${bad} ✗`);
process.exit(bad ? 1 : 0);
