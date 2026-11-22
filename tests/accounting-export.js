/* تصدير الفواتير للمحاسب (22 نوفمبر 2026) — أمثلة محسوبة يدويًّا
   تشغيل: npx esbuild lib/accounting-export.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/acctExport.js
          node tests/accounting-export.js */
const { exportLines, monthlySummary, exportCSV, invoiceVat } = require("/tmp/b/acctExport.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const props = [
  { id: "P1", name: "معارض الملك فهد", owner_name: "سعد", property_type: "showroom", vat_enabled: true, vat_rate: 15, vat_inclusive: true },
  { id: "P2", name: "عمارة الياسمين", owner_name: "خالد", property_type: "residential", vat_enabled: false },
];
const tenants = [{ id: "T1", name: "مؤسسة النور", unit: "2", unit_type: "showroom" }, { id: "T2", name: "نايف", unit: "103", unit_type: "apartment" }];
const issuer = { billing_name: "مكتب التجربة", vat_number: "300000000000003" };
const inv = (o) => ({ id: o.no, invoice_no: o.no, issue_date: o.d, due_date: o.d, period_label: o.per || null, amount: o.a, status: o.s || "issued",
  tenant_id: o.t, property_id: o.p, vat_enabled: o.ve, vat_rate: o.vr ?? 15, vat_inclusive: o.vi, legacy_dup: o.dup || false });

/* 1) شاملة: 11,500 ← قبل الضريبة 10,000 + ضريبة 1,500 */
let L = exportLines({ invoices: [inv({ no: "INV-1", d: "2026-11-05", a: 11500, t: "T1", p: "P1", ve: true, vi: true, per: "نوفمبر" })], tenants, props, issuer });
t("inclusive base 10000", L[0].base === 10000);
t("inclusive vat 1500", L[0].vat === 1500);
t("inclusive total 11500", L[0].total === 11500);
t("tax invoice (seller has VAT no.)", L[0].kind === "ضريبية");
t("description", L[0].description === "إيجار وحدة 2 — معارض الملك فهد عن نوفمبر");
t("owner carried", L[0].owner === "سعد");

/* 2) مضافة: 30,000 ← ضريبة 4,500 والإجمالي 34,500 */
L = exportLines({ invoices: [inv({ no: "INV-2", d: "2026-11-06", a: 30000, t: "T1", p: "P1", ve: true, vi: false })], tenants, props, issuer });
t("exclusive base 30000", L[0].base === 30000 && L[0].vat === 4500 && L[0].total === 34500);

/* 3) كسور: 1,000 شاملة ← 869.57 + 130.43 = 1,000 بالضبط */
L = exportLines({ invoices: [inv({ no: "INV-3", d: "2026-11-07", a: 1000, t: "T1", p: "P1", ve: true, vi: true })], tenants, props, issuer });
t("rounding base 869.57", L[0].base === 869.57);
t("rounding vat 130.43", L[0].vat === 130.43);
t("base + vat == total", Math.round((L[0].base + L[0].vat) * 100) === 100000);

/* 4) سكني بلا ضريبة */
L = exportLines({ invoices: [inv({ no: "INV-4", d: "2026-11-08", a: 3000, t: "T2", p: "P2", ve: false })], tenants, props, issuer });
t("residential no vat", L[0].vat === 0 && L[0].base === 3000 && L[0].total === 3000 && L[0].vat_rate === 0);
t("residential not tax invoice", L[0].kind === "غير ضريبية");

/* 5) لقطة الإصدار تغلب الإعداد الحالي: صدرت بلا ضريبة ثم فُعّلت على العقار لاحقًا */
L = exportLines({ invoices: [inv({ no: "INV-5", d: "2026-10-01", a: 5000, t: "T1", p: "P1", ve: false })], tenants, props, issuer });
t("snapshot off wins over property on", L[0].vat === 0 && L[0].total === 5000);

/* 6) فاتورة قديمة بلا لقطة: إعدادات الوحدة والعقار الحالية */
L = exportLines({ invoices: [inv({ no: "INV-6", d: "2026-09-01", a: 11500, t: "T1", p: "P1", ve: null, vi: null })], tenants, props, issuer });
t("legacy falls back to unit/property", L[0].vat === 1500 && L[0].base === 10000);

/* 7) بائع بلا رقم ضريبي: ليست «ضريبية» حتى لو فيها ضريبة (مثل الفاتورة المطبوعة) */
L = exportLines({ invoices: [inv({ no: "INV-7", d: "2026-11-09", a: 11500, t: "T1", p: "P1", ve: true, vi: true })], tenants, props, issuer: { org_name: "مكتب" } });
t("no seller VAT → not tax invoice", L[0].kind === "غير ضريبية" && L[0].vat === 1500);

/* 8) الفترة + الملغاة + المكرّرة القديمة + الترتيب */
const all = [
  inv({ no: "INV-10", d: "2026-11-20", a: 11500, t: "T1", p: "P1", ve: true, vi: true }),
  inv({ no: "INV-09", d: "2026-11-02", a: 3000, t: "T2", p: "P2", ve: false }),
  inv({ no: "INV-11", d: "2026-11-21", a: 11500, t: "T1", p: "P1", ve: true, vi: true, s: "void" }),
  inv({ no: "INV-12", d: "2026-11-22", a: 9999, t: "T1", p: "P1", ve: true, vi: true, dup: true }),
  inv({ no: "INV-08", d: "2026-10-31", a: 2000, t: "T2", p: "P2", ve: false }),
  inv({ no: "INV-13", d: "2026-12-01", a: 2000, t: "T2", p: "P2", ve: false }),
];
L = exportLines({ invoices: all, tenants, props, issuer, from: "2026-11-01", to: "2026-11-30" });
t("period filter (Nov only) + legacy dup dropped", L.map((x) => x.invoice_no).join(",") === "INV-09,INV-10,INV-11");
t("void kept but flagged", L.find((x) => x.invoice_no === "INV-11").voided && L.find((x) => x.invoice_no === "INV-11").status === "ملغاة");
const S = monthlySummary(L);
t("summary excludes void: count 2", S.length === 1 && S[0].count === 2);
t("summary base 13000", S[0].base === 13000);
t("summary vat 1500", S[0].vat === 1500);
t("summary total 14500", S[0].total === 14500);
t("summary taxable base 10000 (vat rows only)", S[0].taxableBase === 10000);

/* 9) المستأجر وقت الفاتورة (holderOf) يغلب ساكن الوحدة الحالي */
L = exportLines({ invoices: [inv({ no: "INV-14", d: "2026-11-03", a: 3000, t: "T2", p: "P2", ve: false })], tenants, props, issuer,
  holderOf: () => ({ name: "مستأجر سابق", unit: "103" }) });
t("historical holder name", L[0].customer === "مستأجر سابق");

/* 10) CSV: BOM، فاصلة داخل الاسم محمية، 16 عمودًا */
const csv = exportCSV([{ ...L[0], customer: 'شركة "أ"، ب, ج' }]);
t("csv BOM", csv.charCodeAt(0) === 0xFEFF);
t("csv quoted comma/quotes", csv.includes('"شركة ""أ""، ب, ج"'));
t("csv header 16 cols", csv.slice(1).split("\r\n")[0].split(",").length === 16);
t("invoiceVat snapshot rate", invoiceVat({ vat_enabled: true, vat_rate: 5, vat_inclusive: false }).rate === 5);
console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0);
