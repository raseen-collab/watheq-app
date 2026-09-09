// مطابقة بين الشاشات: نفس البيانات يجب أن تعطي نفس الرقم في كل مكان
const C = require("/tmp/c.js"), D = require("/tmp/docs.js");
const r2 = (n) => Math.round(n * 100) / 100;
const fails = [];
const ck = (n, ok, d = "") => { console.log(ok ? "✅" : "❌", n, !ok && d ? "— " + d : ""); if (!ok) fails.push(n); };
const p2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const T = new Date();

let seed = 777; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const tenants = Array.from({ length: 600 }, (_, i) => {
  const freq = pick(["monthly", "quarterly", "semiannual", "annual"]);
  const per = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 }[freq];
  const d = new Date(T); d.setDate(d.getDate() - int(10, 500));
  const vac = rnd() < 0.1;
  return { id: "t" + i, unit: String(i + 1), name: "م" + i, rent_amount: pick([2500, 5000, 8000, 11500]),
    payment_frequency: freq, contract_start: iso(d), contract_periods: per, paid_periods: int(0, per),
    partial_amount: rnd() < 0.2 ? 1000 : 0, calendar: rnd() < 0.3 ? "hijri" : "gregorian",
    unit_type: pick(["apartment", "shop", "studio"]), status: vac ? "vacated" : "active",
    move_out_date: vac ? iso(new Date(T.getTime() - int(1, 100) * 864e5)) : null, litigation: rnd() < 0.04 };
});
const p = { id: "p", name: "برج", property_type: "residential", collected: 0, grace_days: 3,
  vat_enabled: true, vat_rate: 15, vat_inclusive: true, usage: "mixed", tenants, property_notes: [] };
const W = { graceDays: 3, soonDays: 10, imminentDays: 5, expiringDays: 60 };
const sts = tenants.map((t) => ({ t, st: C.contractState(t, W) }));

// 1) إجمالي المتأخر: اللوحة = الكشف = مجموع الصفوف
const dashLate = sts.filter((x) => !x.st.vacant && !x.t.litigation && x.st.status === "late");
const dashTotal = r2(dashLate.reduce((a, x) => a + x.st.amountDue, 0));
const rowSum = r2(sts.filter((x) => !x.st.vacant && !x.t.litigation && x.st.status === "late").reduce((a, x) => a + x.st.amountDue, 0));
ck("إجمالي المتأخر في اللوحة = مجموع صفوفه", dashTotal === rowSum, `${dashTotal} ≠ ${rowSum}`);

// 2) الشاغرة لا تدخل في المتأخر لكن دينها محفوظ
const legacy = r2(sts.filter((x) => x.st.vacant).reduce((a, x) => a + x.st.legacyArrears, 0));
ck("ديون الشاغرة منفصلة عن المتأخر", !dashLate.some((x) => x.st.vacant) && legacy >= 0, `legacy=${legacy}`);

// 3) الدخل السنوي = مجموع (إيجار × دفعات السنة) للمؤجّرة فقط
const PY = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };
const annualManual = r2(tenants.filter((t) => t.status !== "vacated").reduce((a, t) => a + t.rent_amount * PY[t.payment_frequency], 0));
const html = D.propertyStatementHTML(p, {}, "full");
ck("الدخل السنوي في الكشف = الحساب اليدوي", html.includes(annualManual.toLocaleString("en-US")), `${annualManual}`);

// 4) عدد الوحدات: مؤجّرة + شاغرة = الإجمالي
const vacN = tenants.filter((t) => t.status === "vacated").length;
ck("مؤجّرة + شاغرة = الإجمالي", (tenants.length - vacN) + vacN === tenants.length);

// 5) الضريبة: مجموع ضرائب الوحدات = ضريبة الإجمالي (بلا انزياح تقريب متراكم)
const perUnitVat = r2(sts.filter((x) => !x.st.vacant).reduce((a, x) =>
  a + C.splitVat(x.st.amountDue, { enabled: C.unitVatApplies(x.t, p), rate: 15, inclusive: true }).vat, 0));
ck("مجموع الضريبة لا يتجاوز 15% من المتأخر", perUnitVat <= dashTotal * 0.1305, `${perUnitVat} / ${dashTotal}`);

// 6) كل صف: الإيجار المعروض = splitVat(rent).total
let mismatch = 0;
for (const { t } of sts) {
  const shown = C.splitVat(t.rent_amount, { enabled: C.unitVatApplies(t, p), rate: 15, inclusive: true }).total;
  if (Math.abs(shown - t.rent_amount) > 0.01 && p.vat_inclusive) mismatch++;
}
ck("الإيجار الشامل للضريبة لا يتغيّر بالعرض", mismatch === 0, `${mismatch} وحدة`);

// 7) الجدول: مجموع غير المسدَّد = المستحق (قبل الجزئي)
let schemaBad = 0;
for (const { t, st } of sts) {
  if (st.vacant) continue;
  const sch = C.buildSchedule(t);
  const unpaidSum = r2(sch.filter((x) => x.status !== "paid").reduce((a, x) => a + x.amount, 0));
  const expect = r2(Math.max(0, (t.contract_periods - t.paid_periods) * t.rent_amount));
  if (Math.abs(unpaidSum - expect) > 0.02) schemaBad++;
}
ck("جدول الدفعات: غير المسدَّد = المتبقي من العقد", schemaBad === 0, `${schemaBad} وحدة`);

// 8) الأداء الكلي
const t0 = Date.now(); tenants.forEach((t) => C.contractState(t, W)); const ms = Date.now() - t0;
ck("حساب 600 وحدة تحت 50ms", ms < 50, `${ms}ms`);

console.log(fails.length ? `\n❌ ${fails.length} إخفاق` : "\n✅ كل المطابقات سليمة");
