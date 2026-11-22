/* الفاتورة الإلكترونية — المرحلة الأولى (22 نوفمبر 2026)
   تشغيل: npx esbuild lib/einvoice.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/einvoice.js
          npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/documents.js
          node tests/einvoice.js */
const E = require("/tmp/b/einvoice.js");
const D = require("/tmp/b/documents.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };

/* 1) الرقم الضريبي: 15 رقمًا يبدأ وينتهي بـ3 — الرقمان الموجودان في الإنتاج («0» و10 أرقام) مرفوضان */
t("valid vat", E.isValidVatNo("300000000000003"));
t("spaces + arabic digits", E.isValidVatNo("٣٠٠ ٠٠٠ ٠٠٠ ٠٠٠ ٠٠٣"));
t("reject '0'", !E.isValidVatNo("0"));
t("reject 10 digits", !E.isValidVatNo("3100000032"));
t("reject not ending 3", !E.isValidVatNo("300000000000001"));
t("reject 16 digits", !E.isValidVatNo("3000000000000003"));

/* 2) TLV: يُفكّ إلى الخانات الخمس بالضبط — مثال الهيئة: إجمالي 1,150 وضريبة 150 */
const b64 = E.zatcaTlvBase64("مؤسسة أ & ب", "300000000000003", "2026-11-22T09:30:00Z", 1150, 150);
const f = E.decodeZatcaTlv(b64);
t("tag1 seller", f[0] === "مؤسسة أ & ب");
t("tag2 vat", f[1] === "300000000000003");
t("tag3 time", f[2] === "2026-11-22T09:30:00Z");
t("tag4 total 2dp", f[3] === "1150.00");
t("tag5 vat 2dp", f[4] === "150.00");
/* بايتات الترويسة: الوسم 1 ثم طول الاسم بالبايت (UTF-8: 11 حرفًا → 19 بايت) */
const raw = Buffer.from(b64, "base64");
t("first tag byte = 1", raw[0] === 1);
t("name length in bytes", raw[1] === Buffer.byteLength("مؤسسة أ & ب"));
t("matches Buffer base64", b64 === Buffer.from(raw).toString("base64"));
/* اسم طويل يُقصّ على 255 بايت عند حدّ حرف — لا رمز فاسد */
const long = "م".repeat(200);
const fl = E.decodeZatcaTlv(E.zatcaTlvBase64(long, "300000000000003", "2026-11-22T09:30:00Z", 1, 0));
t("long name trimmed <=255 bytes", Buffer.byteLength(fl[0]) <= 255 && fl[0].length === 127);
t("other tags intact after long name", fl[1] === "300000000000003" && fl[3] === "1.00");
t("qrTimestamp no ms", E.qrTimestamp("2026-11-22T09:30:00.123Z") === "2026-11-22T09:30:00Z");

/* 3) البائع */
const issuer = { billing_name: "مكتب س", vat_number: "300000000000003", cr_number: "1010", billing_address: "الرياض" };
let s = E.sellerOf(null, issuer, null);
t("legacy = office", s.mode === "office" && s.name === "مكتب س" && s.vat === "300000000000003" && s.address === "الرياض");
s = E.sellerOf({ seller_mode: "owner", seller_name: "فهد", seller_vat: "311111111111113", seller_address: "جدة" }, issuer, null);
t("snapshot owner wins over current office", s.mode === "owner" && s.name === "فهد" && s.vat === "311111111111113" && s.cr === null);
s = E.sellerForNew(issuer, { rent_seller: "owner", owner_name: "فهد", address: "شارع ١", city: "جدة" });
t("new owner: address falls back to property", s.address === "شارع ١، جدة" && s.vat === null);
t("gaps owner no vat", E.taxInvoiceGaps(s, true).join("|") === "الرقم الضريبي للمالك");
t("no gaps when VAT off (residential)", E.taxInvoiceGaps(s, false).length === 0);
t("gaps office bad vat + no address", E.taxInvoiceGaps(E.sellerOf(null, { billing_name: "م", vat_number: "0" }), true).length === 2);
t("isTax needs valid vat", !E.isTaxInvoice(E.sellerOf(null, { vat_number: "0" }), true) && E.isTaxInvoice(E.sellerOf(null, issuer), true));

/* 4) المستند المطبوع */
const P = { id: "P", name: "معارض", property_type: "showroom", vat_enabled: true, vat_rate: 15, vat_inclusive: true, manager: null };
const T = { id: "T", name: "مؤسسة النور", unit: "2", unit_type: "showroom", payment_frequency: "monthly", national_id: "7001" };
const base = { invoice_no: "INV-2026-0007", amount: 11500, due_date: "2026-11-01", period_label: "الدفعة 3 من 12",
  issue_date: "2026-11-22", created_at: "2026-11-22T06:30:00Z", status: "issued", vat_snapshot: true };
const qrOf = (html) => { const m = /id="zatca-tlv"[^>]*>([A-Za-z0-9+/=]+)</.exec(html); return m ? E.decodeZatcaTlv(m[1]) : null; };

let h = D.invoiceHTML(T, P, { ...base, seller_mode: "office", seller_name: "مكتب س", seller_vat: "300000000000003", seller_cr: "1010", seller_address: "الرياض، العليا" }, { billing_phone: "0500000000" });
t("title simplified tax invoice", h.includes("فاتورة ضريبية مبسطة"));
t("seller address printed", h.includes("الرياض، العليا"));
t("quantity column", h.includes("<th>الكمية</th>") && h.includes("<td>1</td>"));
t("issue time printed", /الساعة <span dir="ltr">/.test(h));
let q = qrOf(h);
t("QR seller/vat/total/vat", q && q[0] === "مكتب س" && q[1] === "300000000000003" && q[3] === "11500.00" && q[4] === "1500.00");
t("QR timestamp = created_at", q && q[2] === "2026-11-22T06:30:00Z");

/* المالك مؤجّرًا: اسمه ورقمه، «نيابةً عن المورّد»، ولا رقم المكتب ولا جواله */
h = D.invoiceHTML(T, P, { ...base, seller_mode: "owner", seller_name: "فهد العتيبي", seller_vat: "311111111111113", seller_address: "جدة" },
  { billing_name: "مكتب س", vat_number: "300000000000003", billing_phone: "0500000000" });
q = qrOf(h);
t("owner: QR owner name+vat", q && q[0] === "فهد العتيبي" && q[1] === "311111111111113");
t("owner: on behalf line", h.includes("نيابةً عن المورّد"));
t("owner: office VAT absent", !h.includes("300000000000003"));
t("owner: office phone absent", !h.includes("0500000000"));
t("owner: office name absent", !h.includes("مكتب س"));

/* رقم ضريبي غير صحيح → «فاتورة» بلا QR وتنبيه */
h = D.invoiceHTML(T, P, { ...base, vat_snapshot: null, issue_date: null, seller_mode: "office", seller_name: "مكتب ص", seller_vat: "3100000032", seller_address: "x" }, {});
t("invalid vat: no QR", !h.includes("zatca-tlv"));
t("invalid vat: warning", h.includes("غير صحيح"));
t("invalid vat: not titled tax", !h.includes("<h1>فاتورة ضريبية مبسطة"));

/* فاتورة جديدة (لحظة الإصدار، بلا issue_date) والمكتب بلا رقم ضريبي: «فاتورة أجرة» + تنبيه، لا «نسخة» */
h = D.invoiceHTML(T, P, { ...base, issue_date: null, vat_snapshot: true, seller_mode: "office", seller_name: "مكتب ع", seller_vat: null, seller_address: null }, {});
t("new w/o vat: plain h1", h.includes("<h1>فاتورة أجرة</h1>"));
t("new w/o vat: not 'copy' note", !h.includes("نسخة من فاتورة صدرت ضريبية"));
t("new w/o vat: warning", h.includes("غير مسجَّل"));
/* فاتورة قديمة (قبل v95) صدرت ضريبية ثم حُذف الرقم: تبقى «نسخة» بعنوانها */
h = D.invoiceHTML(T, P, { ...base, vat_snapshot: true }, { billing_name: "مكتب ع" });
t("legacy reprint keeps tax title + copy note", h.includes("<h1>فاتورة ضريبية مبسطة — أجرة</h1>") && h.includes("نسخة من فاتورة صدرت ضريبية"));

/* الإشعار الدائن: العنوان، المرجع، السبب، QR بنفس المبالغ */
h = D.invoiceHTML(T, P, { ...base, invoice_no: "CN-2026-0008", doc_type: "credit_note", ref_invoice_no: "INV-2026-0007", ref_issue_date: "2026-11-20",
  reason: "خطأ في المبلغ", seller_mode: "office", seller_name: "مكتب س", seller_vat: "300000000000003", seller_address: "الرياض" }, {});
t("CN title", h.includes("إشعار دائن لفاتورة ضريبية مبسطة"));
t("CN ref", h.includes("INV-2026-0007"));
t("CN reason", h.includes("خطأ في المبلغ"));
q = qrOf(h);
t("CN QR present (simplified notes need QR)", q && q[3] === "11500.00" && q[4] === "1500.00");
t("CN no due-date column", !h.includes("<th>تاريخ الاستحقاق</th>"));

/* فاتورة ملغاة بإشعار: تذكر رقم الإشعار ولا QR */
h = D.invoiceHTML(T, P, { ...base, status: "void", credit_note_no: "CN-2026-0008", seller_mode: "office", seller_name: "مكتب س", seller_vat: "300000000000003", seller_address: "الرياض" }, {});
t("void shows CN number", h.includes("أُلغيت بالإشعار الدائن رقم CN-2026-0008"));
t("void no QR", !h.includes("zatca-tlv"));

/* إيجار سكني: لا ضريبة، لا QR، لا «ضريبية» */
h = D.invoiceHTML({ ...T, unit_type: "apartment" }, { ...P, property_type: "residential", vat_enabled: false },
  { ...base, vat_snapshot: false, seller_mode: "office", seller_name: "مكتب س", seller_vat: "300000000000003", seller_address: "الرياض" }, {});
t("residential: no QR", !h.includes("zatca-tlv"));
t("residential: plain title", h.includes("<h1>فاتورة أجرة</h1>"));

/* (v96) الفاتورة القياسية: العنوان، رقم المشتري وعنوانه، نسبة الضريبة ومبلغها في البند، وسيلة الدفع */
const stdSnap = { seller_mode: "office", seller_name: "مكتب س", seller_vat: "300000000000003", seller_address: "الرياض",
  invoice_kind: "standard", buyer_vat: "311111111111113", buyer_address: "جدة، التحلية", payment_means: "transfer" };
h = D.invoiceHTML(T, P, { ...base, ...stdSnap }, {});
t("std title 'فاتورة ضريبية' (not مبسطة)", h.includes("<h1>فاتورة ضريبية — أجرة</h1>") && !h.includes("فاتورة ضريبية مبسطة"));
t("std buyer vat", h.includes("311111111111113"));
t("std buyer address", h.includes("جدة، التحلية"));
t("std per-line VAT rate + amount", h.includes("<th>نسبة الضريبة</th>") && h.includes("<td>15%</td>") && h.includes("<td>1,500</td>"));
t("std line total incl VAT", h.includes("<td>11,500</td>"));
t("std payment means", h.includes("وسيلة الدفع: <b>تحويل بنكي</b>"));
t("std English title", h.includes("Tax invoice — rent") && h.includes("Bank transfer"));
/* العنوان الفارغ يُكمَل بعنوان الوحدة والعقار */
h = D.invoiceHTML(T, { ...P, address: "طريق الملك فهد", city: "الرياض" }, { ...base, ...stdSnap, buyer_address: null }, {});
t("std buyer address fallback to unit", h.includes("معرض 2، معارض، طريق الملك فهد، الرياض"));
/* إشعار دائن لقياسية */
h = D.invoiceHTML(T, P, { ...base, ...stdSnap, invoice_no: "CN-2026-0010", doc_type: "credit_note", ref_invoice_no: "INV-2026-0009", reason: "خطأ" }, {});
t("std CN title", h.includes("إشعار دائن لفاتورة ضريبية") && !h.includes("مبسطة"));
/* قياسية لكن الضريبة غير مفعّلة (سكني): ليست ضريبية أصلًا */
h = D.invoiceHTML({ ...T, unit_type: "apartment" }, { ...P, property_type: "residential", vat_enabled: false }, { ...base, ...stdSnap, vat_snapshot: false }, {});
t("std kind but VAT off → plain", h.includes("<h1>فاتورة أجرة</h1>") && !h.includes("311111111111113"));
/* الفجوات */
t("standardGaps complete", E.standardGaps({ ...stdSnap, buyer_name: "س" }).length === 0 && E.standardGaps(stdSnap).join() === "اسم المستأجر");
t("standardGaps missing pm + vat", E.standardGaps({ buyer_name: "س", buyer_address: "x" }).length === 2);

console.log(`──────── einvoice: ${ok} ناجح · ${bad} فاشل`);
process.exit(bad ? 1 : 0);
