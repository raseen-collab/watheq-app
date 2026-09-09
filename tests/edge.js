// حواف حقيقية: مدخلات يكتبها مكتب فعلًا وقد تُنتج أرقامًا خاطئة
const C = require("/tmp/c.js"), D = require("/tmp/docs.js"), E = require("/tmp/exp.js");
const r2 = (n) => Math.round(n * 100) / 100;
const fails = [];
const ck = (n, ok, d = "") => { console.log(ok ? "✅" : "❌", n, d && !ok ? "— " + d : ""); if (!ok) fails.push(n); };

const base = { id: "t", unit: "1", name: "م", payment_frequency: "monthly", contract_start: "2026-01-01",
  contract_periods: 12, paid_periods: 0, partial_amount: 0, rent_amount: 5000 };
const P = { id: "p", name: "ع", property_type: "residential", collected: 0, grace_days: 0, tenants: [], property_notes: [] };

// 1) إيجار صفر أو سالب
ck("إيجار صفر: بلا مستحق وبلا قسمة على صفر",
  (() => { const s = C.contractState({ ...base, rent_amount: 0 }, {}); return s.amountDue === 0 && Number.isFinite(s.amountDue); })());
ck("إيجار سالب: لا يقلب المستحق سالبًا",
  (() => { const s = C.contractState({ ...base, rent_amount: -1000 }, {}); return s.amountDue >= 0; })());

// 2) مسدَّد أكثر من مدة العقد (دفع مقدمًا سنتين)
ck("مسدَّد 24 من 12: لا مستحق ولا سالب",
  (() => { const s = C.contractState({ ...base, paid_periods: 24 }, {}); return s.amountDue === 0 && s.unpaid === 0; })());

// 3) جزئي أكبر من الإيجار (خطأ إدخال)
ck("جزئي 9000 على إيجار 5000: يُقصّ ولا يُنقص المستحق زورًا",
  (() => { const s = C.contractState({ ...base, partial_amount: 9000, paid_periods: 0 }, {}); return (s.partial || 0) <= 5000.01 && s.amountDue >= 0; })());

// 4) عدد دفعات صفر أو سالب
ck("عدد دفعات صفر: يعود للافتراضي بلا انهيار",
  (() => { const s = C.contractState({ ...base, contract_periods: 0 }, {}); return Number.isFinite(s.amountDue) && s.progress <= 100; })());

// 5) تاريخ بداية مستقبلي
ck("عقد يبدأ بعد شهرين: لا مستحق اليوم",
  (() => { const d = new Date(); d.setMonth(d.getMonth() + 2);
    const s = C.contractState({ ...base, contract_start: d.toISOString().slice(0, 10) }, {}); return s.amountDue === 0 && s.unpaid === 0; })());

// 6) عقد قديم جدًا (10 سنوات بلا سداد) — لا حلقة لا نهائية ولا رقم فلكي
ck("عقد عمره 10 سنين بلا سداد: يُحسب بلا تعليق",
  (() => { const t0 = Date.now(); const s = C.contractState({ ...base, contract_start: "2016-01-01" }, {});
    return Date.now() - t0 < 500 && s.unpaid <= 12; })());

// 7) الهجري: يوم 30 في شهر 29
ck("عقد هجري يبدأ 30 من شهر: الجدول بلا تواريخ فارغة",
  (() => { const sch = C.buildSchedule({ ...base, contract_start: "2025-07-25", calendar: "hijri", contract_periods: 12 });
    return sch.length === 12 && sch.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date)); })());

// 8) أول استحقاق قبل بداية العقد (إدخال معكوس)
ck("أول استحقاق قبل بداية العقد: لا ينهار ولا يعطي نهاية قبل البداية",
  (() => { const s = C.contractState({ ...base, first_due: "2025-06-01" }, {}); return s.endDate >= base.contract_start; })());

// 9) الضريبة على مبالغ صغيرة وكسور
ck("الضريبة على 0.01: بلا كسر عائم",
  (() => { const x = C.splitVat(0.01, { enabled: true, rate: 15, inclusive: true }); return r2(x.base + x.vat) === 0.01; })());
ck("الضريبة غير الشاملة على 3333.33",
  (() => { const x = C.splitVat(3333.33, { enabled: true, rate: 15, inclusive: false }); return Math.abs(x.total - 3833.33) < 0.01; })());

// 10) صافي المالك: مصروفات أكبر من المحصَّل
ck("مصروفات أكبر من المحصَّل: صافٍ سالب صحيح لا صفر مزيّف",
  (() => { const f = E.ownerNet(1000, [{ amount: 3000 }], 10, 0, 0); return f.net < 0 && Math.abs(f.net - (1000 - 3000 - 100)) < 0.02; })());

// 11) صافي المالك: كل المحصَّل ضريبة (خطأ إدخال)
ck("ضريبة = كامل المحصَّل: لا أتعاب على صفر ولا صافٍ موجب زورًا",
  (() => { const f = E.ownerNet(1000, [], 10, 1000, 15); return f.collected === 0 && f.fee === 0 && f.net === 0; })());

// 12) نسبة أتعاب خارج المدى
ck("أتعاب 150%: تُرفض ولا تبتلع الصافي",
  (() => { const f = E.ownerNet(1000, [], 150, 0, 0); return f.feePct === null && f.fee === 0; })());

// 13) دفعة تراجع (مبلغ سالب) في كشف الفترة
ck("تراجع سالب داخل الفترة: يُخصم من المحصَّل لا يُجمع",
  (() => { const p = { ...P, tenants: [{ ...base }] };
    const pays = [{ id: "1", paid_on: "2026-08-05", amount: 5000, method: "cash", tenant_name: "م", unit: "1" },
                  { id: "2", paid_on: "2026-08-06", amount: -5000, method: "other", tenant_name: "م", unit: "1" }];
    const h = D.propertyStatementHTML(p, {}, "full", { from: "2026-08-01", to: "2026-08-31", label: "أغسطس" }, pays, []);
    return /<div class="v g">0<\/div>/.test(h); })());

// 14) اسم فيه HTML (حقن)
ck("اسم فيه وسم HTML: يُهرَّب في المستند",
  (() => { const t = { ...base, name: '<img src=x onerror=alert(1)>' };
    const h = D.statementHTML(t, { ...P, tenants: [t] }, {}, [], "full");
    return !/<img src=x/.test(h) && /&lt;img/.test(h); })());

// 15) 600 وحدة في عقار واحد: كشف واحد بلا تعليق
ck("كشف عقار بـ600 وحدة يُبنى في أقل من 3 ثوانٍ",
  (() => { const ts = Array.from({ length: 600 }, (_, i) => ({ ...base, id: "t" + i, unit: String(i), name: "م" + i, paid_periods: i % 12 }));
    const t0 = Date.now(); const h = D.propertyStatementHTML({ ...P, tenants: ts }, {}, "full");
    const ms = Date.now() - t0; console.log(`   (زمن البناء: ${ms}ms · حجم: ${Math.round(h.length / 1024)}KB)`); return ms < 3000; })());

console.log(fails.length ? `\n❌ ${fails.length} إخفاق` : "\n✅ كل الحواف سليمة");
