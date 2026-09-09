// وثيق — تحقّق شامل: كل التوليفات لا عيّنة عشوائية.
// يشمل «شاهدًا مستقلًا» يحسب النتيجة بطريقة مختلفة تمامًا، فالخطأ المشترك
// بين المنطق والاختبار لا يمرّ.
const C = require("/tmp/c.js");
const D = require("/tmp/docs.js");
const E = require("/tmp/exp.js");

const r2 = (n) => Math.round(n * 100) / 100;
const p2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return iso(d); };

const fails = [];
let cases = 0, asserts = 0;
const ck = (label, ok, detail) => { asserts++; if (!ok) fails.push(`${label}${detail ? " | " + detail : ""}`); };

// ═══════ الشاهد المستقل: يعدّ الدفعات المستحقة بحلقة تواريخ بسيطة ═══════
// لا يستدعي أي دالة من النظام — لو اتفق الاثنان فالنتيجة صحيحة بحقّ.
function oracleDueGregorian(startISO, freq, periods, graceDays) {
  const MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
  const [y, m, d] = startISO.split("-").map(Number);
  const ref = new Date(); ref.setHours(0, 0, 0, 0);
  ref.setDate(ref.getDate() - graceDays);
  let n = 0;
  for (let i = 0; i < periods; i++) {
    const dt = new Date(y, m - 1 + MONTHS[freq] * i, 1);
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    dt.setDate(Math.min(d, last));                    // قصّ اليوم كما يفعل التقويم
    if (dt < ref) n++;                                 // متأخرة من اليوم التالي
  }
  return n;
}

// ═══════ التعداد الكارتيزي ═══════
const CAL = ["gregorian", "hijri"];
const FREQ = ["monthly", "quarterly", "semiannual", "annual"];
const PER = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };
const GRACE = [0, 3, 10];
const START = [-800, -400, -95, -20, +40];             // قديم جدًا … مستقبلي
const PAID_MODE = ["none", "some", "all", "over"];
const PARTIAL = ["none", "half", "over"];
const STATE = ["active", "vacated", "litigation"];
const UNIT = ["apartment", "shop"];
const VAT = [
  { on: false, inclusive: true },
  { on: true, inclusive: true },
  { on: true, inclusive: false },
];

for (const cal of CAL)
for (const freq of FREQ)
for (const grace of GRACE)
for (const off of START)
for (const paidMode of PAID_MODE)
for (const partMode of PARTIAL)
for (const stateKind of STATE)
for (const unit of UNIT)
for (const vat of VAT) {
  cases++;
  const periods = PER[freq];
  const rent = 3333.33;                                 // كسر متعمّد لكشف التقريب
  const paid = paidMode === "none" ? 0 : paidMode === "some" ? Math.max(1, Math.floor(periods / 2))
    : paidMode === "all" ? periods : periods + 3;
  const partial = partMode === "none" ? 0 : partMode === "half" ? r2(rent / 2) : r2(rent * 1.7);
  const t = {
    id: "t", unit: "1", name: "م", rent_amount: rent, payment_frequency: freq,
    contract_start: shift(off), contract_periods: periods, paid_periods: paid,
    partial_amount: partial, calendar: cal, unit_type: unit,
    status: stateKind === "vacated" ? "vacated" : "active",
    move_out_date: stateKind === "vacated" ? shift(Math.min(-1, off + 30)) : null,
    litigation: stateKind === "litigation",
  };
  const p = {
    id: "p", name: "ع", property_type: "residential", collected: 0, grace_days: grace,
    vat_enabled: vat.on, vat_rate: 15, vat_inclusive: vat.inclusive, tenants: [t], property_notes: [],
  };
  const st = C.contractState(t, { graceDays: grace, soonDays: 10, imminentDays: 5, expiringDays: 60 });
  const tag = `${cal}/${freq}/g${grace}/s${off}/${paidMode}/${partMode}/${stateKind}/${unit}/v${vat.on ? (vat.inclusive ? "i" : "e") : "0"}`;

  // 1) أرقام محدودة دائمًا
  ck("رقم غير محدود", Number.isFinite(st.amountDue) && Number.isFinite(st.unpaid) && Number.isFinite(st.progress), tag);
  // 2) لا سالب
  ck("مبلغ سالب", st.amountDue >= 0 && st.unpaid >= 0 && (st.partial || 0) >= 0, `${tag} due=${st.amountDue}`);
  // 3) سقف المتأخرات بمدة العقد
  ck("المتأخر يتجاوز مدة العقد", st.unpaid <= periods, `${tag} unpaid=${st.unpaid} > ${periods}`);
  // 4) الجزئي لا يتجاوز دفعة
  ck("جزئي أكبر من دفعة", (st.partial || 0) <= rent + 0.01, `${tag} partial=${st.partial}`);
  // 5) الهوية الحسابية
  ck("المستحق ≠ (غير المسدَّد × الإيجار − الجزئي)",
    Math.abs(st.amountDue - r2(Math.max(0, st.unpaid * rent - (st.partial || 0)))) < 0.02, tag);
  // 6) التقدّم بين 0 و100
  ck("التقدّم خارج المدى", st.progress >= 0 && st.progress <= 100, `${tag} ${st.progress}`);
  // 7) الشغور
  if (stateKind === "vacated") {
    ck("شاغرة لها استحقاق قادم", st.nextDueDate === null, tag);
    ck("شاغرة تظهر «ينتهي قريبًا»", st.expiringSoon === false, tag);
    ck("شاغرة تظهر «مسدَّد كاملًا»", st.fullyPaid === false, tag);
    ck("دين الشاغرة ≠ مستحقها", r2(st.legacyArrears) === r2(st.amountDue), tag);
  } else {
    ck("عقد نشط بلا نهاية", !!st.endDate, tag);
    ck("النهاية قبل البداية", st.endDate >= t.contract_start, `${tag} end=${st.endDate}`);
  }
  // 8) عقد مستقبلي: لا مستحق
  if (off > 0 && stateKind !== "vacated") ck("عقد مستقبلي عليه مستحق", st.unpaid === 0 || paid > 0, `${tag} unpaid=${st.unpaid}`);
  // 9) الشاهد المستقل (الميلادي فقط — الشاهد لا يعرف أم القرى)
  if (cal === "gregorian" && stateKind !== "vacated") {
    const oracle = Math.min(oracleDueGregorian(t.contract_start, freq, periods, grace), periods);
    ck("يخالف الشاهد المستقل في عدد المستحق", st.due === oracle, `${tag} نظام=${st.due} شاهد=${oracle}`);
  }
  // 10) الضريبة
  const applies = C.unitVatApplies(t, p);
  const sp = C.splitVat(rent, { enabled: applies, rate: 15, inclusive: vat.inclusive });
  ck("الضريبة: الأساس + الضريبة ≠ الإجمالي", Math.abs(r2(sp.base + sp.vat) - r2(sp.total)) < 0.011, tag);
  ck("ضريبة على سكني", !(applies && unit === "apartment" && p.vat_enabled) || false === true ? true : !(unit === "apartment" && applies), tag);
  if (applies) ck("نسبة الضريبة ليست 15%", Math.abs(sp.vat / sp.base - 0.15) < 0.0011, `${tag} ${sp.vat}/${sp.base}`);
  // 11) الجدول
  if (stateKind !== "vacated") {
    const sch = C.buildSchedule(t);
    ck("عدد صفوف الجدول ≠ المدة", sch.length === periods, `${tag} ${sch.length}`);
    ck("تاريخ فارغ في الجدول", sch.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date)), tag);
    ck("تواريخ الجدول غير تصاعدية", sch.every((x, i) => i === 0 || x.date > sch[i - 1].date), tag);
    ck("مجموع الجدول ≠ الإيجار × المدة",
      Math.abs(r2(sch.reduce((a, x) => a + x.amount, 0)) - r2(rent * periods)) < 0.02, tag);
  }
}

// ═══════ صافي المالك: تعداد كارتيزي مستقل ═══════
let netCases = 0;
for (const collected of [0, 1000, 13750, 100000.55])
for (const vatIn of [0, 1500, 13750])
for (const feePct of [null, 0, 5, 10, 100, 150])
for (const expList of [[], [{ amount: 500 }], [{ amount: 999999 }]]) {
  netCases++; cases++;
  const f = E.ownerNet(collected, expList, feePct, vatIn, 15);
  const expAmt = expList.reduce((a, x) => a + x.amount, 0);
  const netRent = r2(Math.max(0, collected - vatIn));
  ck("إيراد المالك ≠ المحصَّل − الضريبة", Math.abs(f.collected - netRent) < 0.02, `c=${collected} v=${vatIn}`);
  ck("أتعاب على نسبة غير صالحة", !(feePct === null || feePct === 0 || feePct > 100) || f.fee === 0, `fee=${feePct}`);
  if (f.feePct) {
    ck("الأتعاب ليست نسبة من صافي الإيجار", Math.abs(f.feeBase - r2(netRent * f.feePct / 100)) < 0.02, `c=${collected}`);
    ck("ضريبة الأتعاب ليست 15%", Math.abs(f.feeVat - r2(f.feeBase * 0.15)) < 0.02, `c=${collected}`);
  }
  ck("الصافي ≠ الإيراد − المصروفات − الأتعاب",
    Math.abs(f.net - r2(f.collected - f.expenses - f.fee)) < 0.02, `c=${collected} v=${vatIn} f=${feePct}`);
  ck("قيمة غير محدودة في الصافي", Number.isFinite(f.net) && Number.isFinite(f.fee), `c=${collected}`);
}

// ═══════ المستندات: عيّنة من كل نوع عقد ═══════
let docs = 0;
for (const cal of CAL) for (const freq of FREQ) for (const vac of [false, true]) {
  const t = { id: "t", unit: "1", name: "م<>&", rent_amount: 3333.33, payment_frequency: freq,
    contract_start: shift(-200), contract_periods: PER[freq], paid_periods: 1, partial_amount: 100,
    calendar: cal, unit_type: "shop", status: vac ? "vacated" : "active", move_out_date: vac ? shift(-30) : null,
    phone: "0500000000", national_id: "1000000000", contract_no: "EJ-1", rooms: 2, baths: 1, acs: 1 };
  const p = { id: "p", name: "ع", property_type: "residential", collected: 0, grace_days: 3,
    vat_enabled: true, vat_rate: 15, vat_inclusive: true, usage: "mixed", tenants: [t], property_notes: [] };
  for (const mode of ["brief", "full"]) {
    for (const per of [null, { from: shift(-30), to: shift(0), label: "آخر 30 يومًا" }]) {
      const h1 = D.propertyStatementHTML(p, { billing_name: "مكتب" }, mode, per,
        [{ id: "1", paid_on: shift(-10), amount: 3333.33, method: "cash", tenant_name: "م", unit: "1" }], []);
      const h2 = D.statementHTML(t, p, { billing_name: "مكتب" }, [], mode);
      docs += 2; cases += 2;
      for (const [nm, h] of [["كشف العقار", h1], ["كشف الوحدة", h2]]) {
        ck(`${nm}: NaN`, !/NaN/.test(h), `${cal}/${freq}/${mode}`);
        ck(`${nm}: undefined`, !/undefined/.test(h), `${cal}/${freq}/${mode}`);
        ck(`${nm}: null معروض`, !/>null</.test(h), `${cal}/${freq}/${mode}`);
        ck(`${nm}: حقن HTML`, !/<script|onerror=/.test(h), `${cal}/${freq}`);
      }
    }
  }
}

console.log(`الحالات المفحوصة: ${cases}  ·  التأكيدات: ${asserts}  ·  المستندات: ${docs}  ·  صافي المالك: ${netCases}`);
if (!fails.length) console.log("\n✅ لا خطأ في أي احتمال");
else {
  const groups = {};
  fails.forEach((f) => { const k = f.split(" | ")[0]; (groups[k] ||= []).push(f); });
  console.log(`\n❌ ${fails.length} إخفاق في ${Object.keys(groups).length} صنفًا:`);
  Object.entries(groups).forEach(([k, v]) => console.log(`  • ${k} (${v.length})\n      مثال: ${v[0].split(" | ")[1] || ""}`));
}
