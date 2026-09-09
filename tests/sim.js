// وثيق — محاكاة مالية بحجم مكتب حقيقي: 55 عقارًا و600 وحدة
// تولّد كل التوليفات (تقويم × دورة × حالة × ضريبة × سماح × جزئي) وتفحص
// كل هوية محاسبية يجب أن تصمد. الهدف اكتشاف خطأ مالي لا قياس أداء.
const C = require("/tmp/c.js");
const D = require("/tmp/docs.js");
const E = require("/tmp/exp.js");

const r2 = (n) => Math.round(n * 100) / 100;
const p2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = new Date();

// مولّد عشوائي ثابت البذرة — نفس الحالات في كل تشغيل
let seed = 20260909;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const FREQS = ["monthly", "quarterly", "semiannual", "annual"];
const PER_YEAR = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };
const UNIT_TYPES = ["apartment", "annex", "studio", "room", "shop", "office", "warehouse"];
const COMMERCIAL = ["shop", "office", "warehouse"];

const props = [];
let uid = 0;
for (let i = 0; i < 55; i++) {
  const commercial = i % 5 === 0;
  const mixed = i % 7 === 0;
  const p = {
    id: "p" + i, name: `عقار ${i + 1}`, city: "الرياض",
    property_type: commercial ? "commercial" : "residential",
    usage: mixed ? "mixed" : commercial ? "commercial" : "families",
    collected: 0,
    grace_days: pick([0, 0, 3, 5, 10]),
    soon_days: pick([null, 7, 10, 14]),
    imminent_days: pick([null, 3, 5]),
    expiring_days: pick([null, 30, 49, 60]),
    mgmt_fee_pct: pick([null, 5, 10, 12.5]),
    vat_enabled: commercial || mixed || i % 11 === 0,
    vat_rate: 15, vat_inclusive: pick([true, false]),
    owner_name: `مالك ${(i % 12) + 1}`,
    tenants: [], property_notes: [],
  };
  const n = i < 5 ? int(30, 60) : int(5, 14);          // بعض العقارات كبيرة
  for (let j = 0; j < n; j++) {
    uid++;
    const freq = pick(FREQS);
    const periods = PER_YEAR[freq];
    const vacated = rnd() < 0.12;
    const litig = !vacated && rnd() < 0.05;
    const startOffset = -int(30, 700);
    const paid = int(0, periods);
    const rent = pick([1500, 2500, 3000, 3333.33, 5000, 7000, 8000, 11500, 12000, 20000]);
    const ut = pick(UNIT_TYPES);
    p.tenants.push({
      id: "t" + uid, unit: String(j + 1), name: `مستأجر ${uid}`,
      rent_amount: rent, payment_frequency: freq,
      contract_start: addDays(TODAY, startOffset),
      first_due: rnd() < 0.15 ? addDays(TODAY, startOffset + int(1, 10)) : null,
      contract_periods: periods,
      paid_periods: paid,
      partial_amount: rnd() < 0.2 ? r2(rent * (0.1 + rnd() * 0.7)) : 0,
      calendar: rnd() < 0.35 ? "hijri" : "gregorian",
      unit_type: ut, vat_mode: rnd() < 0.1 ? pick(["on", "off"]) : "auto",
      status: vacated ? "vacated" : "active",
      move_out_date: vacated ? addDays(TODAY, -int(1, 200)) : null,
      litigation: litig, phone: "0500000000", national_id: "1000000000",
      rooms: int(1, 5), baths: int(1, 3), acs: int(0, 5),
    });
  }
  props.push(p);
}
const allTenants = props.flatMap((p) => p.tenants);
console.log(`عقارات: ${props.length} · وحدات: ${allTenants.length}`);

// ═══════════════ الهويات المحاسبية ═══════════════
const fails = [];
const check = (name, ok, detail = "") => { if (!ok) fails.push(`${name}${detail ? " — " + detail : ""}`); };

let vacantWithDue = 0, hijriCount = 0, partialCount = 0, graceCount = 0;

for (const p of props) {
  const w = { graceDays: p.grace_days || 0, soonDays: p.soon_days || 10, imminentDays: p.imminent_days || 5, expiringDays: p.expiring_days || 60 };
  for (const t of p.tenants) {
    const st = C.contractState(t, w);
    const rent = Number(t.rent_amount) || 0;
    if (t.calendar === "hijri") hijriCount++;
    if (st.hasPartial) partialCount++;
    if (st.inGrace) graceCount++;

    // 1) المبلغ المستحق = عدد الدفعات غير المسددة × الإيجار − الجزئي
    const expected = r2(Math.max(0, st.unpaid * rent - (st.partial || 0)));
    check("amountDue يطابق (غير المسدَّد × الإيجار − الجزئي)", Math.abs(st.amountDue - expected) < 0.02,
      `${t.id}: ${st.amountDue} ≠ ${expected}`);

    // 2) لا مستحق سالب ولا دفعات سالبة
    check("لا مبلغ سالب", st.amountDue >= 0, `${t.id}: ${st.amountDue}`);
    check("لا دفعات غير مسدَّدة سالبة", st.unpaid >= 0, `${t.id}: ${st.unpaid}`);

    // 3) الجزئي لا يتجاوز إيجار دفعة
    check("الجزئي ≤ إيجار دفعة", (st.partial || 0) <= rent + 0.01, `${t.id}: ${st.partial} > ${rent}`);

    // 4) الشغور: لا استحقاق قادم ولا تجديد ولا «مسدَّد كاملًا»
    if (C.isVacant(t)) {
      check("شاغرة: بلا استحقاق قادم", st.nextDueDate === null, t.id);
      check("شاغرة: بلا ينتهي قريبًا", st.expiringSoon === false, t.id);
      check("شاغرة: بلا مسدَّد كاملًا", st.fullyPaid === false, t.id);
      check("شاغرة: legacy = amountDue", r2(st.legacyArrears) === r2(st.amountDue), t.id);
      if (st.amountDue > 0) vacantWithDue++;
    } else {
      // 5) غير الشاغرة: الاستحقاق القادم بعد البداية ومتسق مع الجدول
      const sch = C.buildSchedule(t);
      if (sch.length && st.nextDueDate) {
        const unpaidDates = sch.filter((x) => x.status !== "paid").map((x) => x.date);
        check("الاستحقاق القادم موجود في جدول الدفعات", !unpaidDates.length || unpaidDates.includes(st.nextDueDate),
          `${t.id}: ${st.nextDueDate}`);
      }
      // 6) جدول الدفعات: عدده = عدد فترات العقد، ومجموعه = الإيجار السنوي للعقد
      check("عدد صفوف الجدول = عدد الدفعات", sch.length === t.contract_periods, `${t.id}: ${sch.length} ≠ ${t.contract_periods}`);
      const schSum = r2(sch.reduce((a, x) => a + (Number(x.amount) || 0), 0));
      check("مجموع الجدول = الإيجار × عدد الدفعات", Math.abs(schSum - r2(rent * t.contract_periods)) < 0.02,
        `${t.id}: ${schSum} ≠ ${r2(rent * t.contract_periods)}`);
      // 7) التواريخ تصاعدية ولا تكرار
      const ds = sch.map((x) => x.date);
      check("تواريخ الجدول تصاعدية بلا تكرار", ds.every((d, i) => i === 0 || d > ds[i - 1]), t.id);
    }

    // 8) الضريبة: الأساس + الضريبة = الإجمالي دائمًا، والسكني معفى
    const applies = C.unitVatApplies(t, p);
    const v = { enabled: applies, rate: 15, inclusive: p.vat_inclusive };
    const sp = C.splitVat(rent, v);
    check("الضريبة: أساس + ضريبة = الإجمالي", Math.abs(r2(sp.base + sp.vat) - r2(sp.total)) < 0.011,
      `${t.id}: ${sp.base}+${sp.vat}≠${sp.total}`);
    if (applies) {
      const ratio = sp.base > 0 ? sp.vat / sp.base : 0;
      check("نسبة الضريبة 15%", Math.abs(ratio - 0.15) < 0.001, `${t.id}: ${(ratio * 100).toFixed(3)}%`);
    } else {
      check("المعفى بلا ضريبة", sp.vat === 0, t.id);
    }
    if (p.vat_enabled && t.vat_mode === "auto" && !COMMERCIAL.includes(t.unit_type)) {
      check("السكني معفى رغم تفعيل الضريبة على العقار", applies === false, `${t.id} (${t.unit_type})`);
    }
  }
}

// ═══════════════ تقرير المالك: صافي وأتعاب وضريبة ═══════════════
for (const p of props.slice(0, 20)) {
  const pays = [];
  for (const t of p.tenants) {
    const n = int(0, 3);
    for (let k = 0; k < n; k++) pays.push({ id: `x${t.id}${k}`, paid_on: addDays(TODAY, -int(1, 60)), amount: Number(t.rent_amount) || 0, method: "cash", tenant_name: t.name, unit: t.unit });
  }
  const exps = [{ id: "e1", spent_on: addDays(TODAY, -10), amount: 1200, category: "maintenance", unit: null, note: "" }];
  const collected = r2(pays.reduce((a, x) => a + x.amount, 0));
  const byUnit = {}; p.tenants.forEach((t) => { if (t.unit) byUnit[String(t.unit)] = t; });
  const vat = r2(pays.reduce((a, x) => { const t = byUnit[String(x.unit)]; return a + (t && C.unitVatApplies(t, p) ? C.splitVat(x.amount, { enabled: true, rate: 15, inclusive: p.vat_inclusive }).vat : 0); }, 0));
  const fin = E.ownerNet(collected, exps, p.mgmt_fee_pct, vat, 15);

  check("صافي المالك = صافي الإيجار − مصروفات − أتعاب",
    Math.abs(fin.net - r2(fin.collected - fin.expenses - fin.fee)) < 0.02, `${p.id}`);
  check("الضريبة مستبعدة من إيراد المالك", Math.abs(fin.collected - r2(collected - vat)) < 0.02, `${p.id}`);
  check("الأتعاب تُحسب على صافي الإيجار لا على الإجمالي",
    !fin.feePct || Math.abs(fin.feeBase - r2((fin.collected * fin.feePct) / 100)) < 0.02, `${p.id}`);
  check("ضريبة الأتعاب = 15% من الأتعاب", !fin.feeBase || Math.abs(fin.feeVat - r2(fin.feeBase * 0.15)) < 0.02, `${p.id}`);
  check("لا صافي سالب بلا سبب", fin.net >= -fin.expenses - fin.fee - 0.01, `${p.id}: ${fin.net}`);

  // كشف العقار بفترة: المحصَّل داخل النافذة فقط
  const from = addDays(TODAY, -30), to = iso(TODAY);
  const inWin = pays.filter((x) => x.paid_on >= from && x.paid_on <= to);
  const html = D.propertyStatementHTML(p, { billing_name: "مكتب" }, "full", { from, to, label: "آخر 30 يومًا" }, pays, exps);
  const shown = r2(inWin.reduce((a, x) => a + x.amount, 0));
  check("كشف الفترة يعرض محصَّل النافذة فقط",
    html.includes(shown.toLocaleString("en-US")) || shown === 0, `${p.id}: ${shown}`);
  check("كشف العقار لا يتضمن NaN", !/NaN/.test(html), p.id);
  check("كشف العقار لا يتضمن undefined", !/undefined/.test(html), p.id);
}

// ═══════════════ مستندات كل وحدة: بلا NaN/undefined ═══════════════
let docChecked = 0;
for (const p of props) {
  for (const t of p.tenants.slice(0, 3)) {
    const s1 = D.statementHTML(t, p, { billing_name: "مكتب" }, [], "full");
    check("كشف الوحدة بلا NaN", !/NaN/.test(s1), t.id);
    check("كشف الوحدة بلا undefined", !/undefined/.test(s1), t.id);
    docChecked++;
  }
}

console.log(`
هجرية: ${hijriCount} · جزئي: ${partialCount} · فترة سماح: ${graceCount} · شاغرة بدين: ${vacantWithDue} · مستندات مفحوصة: ${docChecked}`);
if (!fails.length) console.log("\n✅ لا خطأ مالي في أي توليفة");
else {
  const uniq = [...new Set(fails.map((f) => f.split(" — ")[0]))];
  console.log(`\n❌ ${fails.length} إخفاق في ${uniq.length} فحصًا:`);
  uniq.forEach((u) => {
    const ex = fails.filter((f) => f.startsWith(u));
    console.log(`  • ${u} (${ex.length}) مثال: ${ex[0].split(" — ")[1] || ""}`);
  });
}
