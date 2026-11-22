// فاتورة أتعاب الإدارة (v99) — أمثلة يدوية من دراسة 23 نوفمبر 2026
const F = require("/tmp/b/fee-invoice.js");
const fails = [];
const ck = (n, ok, d = "") => { console.log(ok ? "✅" : "❌", n, d && !ok ? "— " + d : ""); if (!ok) fails.push(n); };
const eq = (a, b) => Math.abs(a - b) < 0.005;

let c = F.feeInvoiceCalc({ basis: 50000, pct: 5, officeVatValid: true });
ck("سكني 5% غير شامل: 2,500 + 375 = 2,875 → للمالك 47,125", eq(c.amount, 2500) && eq(c.vat, 375) && eq(c.total, 2875) && eq(c.ownerAfter, 47125) && !c.inclusive, JSON.stringify(c));
c = F.feeInvoiceCalc({ basis: 50000, pct: 10, officeVatValid: true, inclusive: true });
ck("سكني 10% شامل: 5,000 = 4,347.83 + 652.17 → للمالك 45,000", eq(c.amount, 5000) && eq(c.base, 4347.83) && eq(c.vat, 652.17) && eq(c.total, 5000) && eq(c.ownerAfter, 45000), JSON.stringify(c));
c = F.feeInvoiceCalc({ basis: 50000, fixed: 1500, times: 2, officeVatValid: true });
ck("ثابت 1,500 × شهرين: 3,000 + 450 = 3,450", eq(c.amount, 3000) && eq(c.vat, 450) && eq(c.total, 3450) && c.mode === "fixed" && c.times === 2);
c = F.feeInvoiceCalc({ basis: 50000, pct: 5, officeVatValid: false, inclusive: true });
ck("مكتب غير مسجَّل: 2,500 بلا ضريبة حتى لو «شامل» مفعّل", eq(c.amount, 2500) && eq(c.vat, 0) && eq(c.total, 2500) && !c.vatEnabled && !c.inclusive);
c = F.feeInvoiceCalc({ basis: 0, pct: 5, officeVatValid: true });
ck("محصَّل صفر → أتعاب صفر (يُمنع الإصدار)", eq(c.amount, 0) && F.feeInvoiceGaps(c, { owner_name: "x" }, { vat_number: "300000000000003", billing_address: "a", org_name: "o" }).some((g) => /لا أتعاب/.test(g)));
c = F.feeInvoiceCalc({ basis: 50000, fixed: 1500, times: 0, officeVatValid: true });
ck("ثابت بلا استحقاق في الفترة (times=0) → صفر", eq(c.amount, 0));
c = F.feeInvoiceCalc({ basis: 50000, pct: 150, officeVatValid: true });
ck("نسبة فوق 100 تُرفض (أتعاب صفر لا 75,000)", eq(c.amount, 0));
c = F.feeInvoiceCalc({ basis: 12345.67, pct: 7.5, officeVatValid: true, vatRate: 15 });
ck("كسور: 12,345.67 × 7.5% = 925.93 + 138.89 = 1,064.82", eq(c.amount, 925.93) && eq(c.vat, 138.89) && eq(c.total, 1064.82), JSON.stringify(c));

// الفجوات
c = F.feeInvoiceCalc({ basis: 50000, pct: 5, officeVatValid: true });
let g = F.feeInvoiceGaps(c, { owner_name: "", owner_vat_number: "300000000000003", owner_address: "" }, { vat_number: "300000000000003", billing_address: "", org_name: "" });
ck("فجوات: اسم المالك، عنوان المكتب، اسم المكتب، عنوان المالك (قياسية)", g.length === 4, JSON.stringify(g));
g = F.feeInvoiceGaps(c, { owner_name: "عبدالله" }, { vat_number: "300000000000003", billing_address: "الرياض", org_name: "مكتب" });
ck("مكتمل: لا فجوات", g.length === 0, JSON.stringify(g));
c = F.feeInvoiceCalc({ basis: 50000, pct: 5, officeVatValid: false });
g = F.feeInvoiceGaps(c, { owner_name: "عبدالله" }, { vat_number: "123", billing_address: "", org_name: "مكتب" });
ck("رقم ضريبي غير صحيح → تنبيه صريح", g.length === 1 && /غير صحيح/.test(g[0]), JSON.stringify(g));

// الشرح
const ex = F.feeInvoiceExplain(F.feeInvoiceCalc({ basis: 50000, pct: 5, officeVatValid: true }));
ck("الشرح يذكر النسبة والضريبة والسكني", /5%/.test(ex[0]) && /375\.00/.test(ex[1]) && /سكنيًّا/.test(ex[2]), JSON.stringify(ex));
const ex2 = F.feeInvoiceExplain(F.feeInvoiceCalc({ basis: 50000, pct: 5, officeVatValid: false }));
ck("شرح غير المسجَّل: بلا ضريبة", /بلا ضريبة/.test(ex2[1]));

// الفترة
ck("نوفمبر 2026", F.feePeriodLabel("2026-11-01", "2026-11-30") === "نوفمبر 2026", F.feePeriodLabel("2026-11-01", "2026-11-30"));
ck("فبراير 2028 (كبيسة)", F.feePeriodLabel("2028-02-01", "2028-02-29") === "فبراير 2028");
ck("أكتوبر – ديسمبر 2026", F.feePeriodLabel("2026-10-01", "2026-12-31") === "أكتوبر – ديسمبر 2026");
ck("فترة جزئية", F.feePeriodLabel("2026-11-05", "2026-11-20") === "5 نوفمبر 2026 – 20 نوفمبر 2026", F.feePeriodLabel("2026-11-05", "2026-11-20"));

console.log(fails.length ? `\n❌ ${fails.length} فشل` : "\n✅ fee-invoice: 18 اختبارًا — كل الأمثلة اليدوية مطابقة");
process.exit(fails.length ? 1 : 0);
