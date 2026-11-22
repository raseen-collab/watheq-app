// دورة «كل شهرين» (bimonthly) — 22 نوفمبر 2026، طلب مكتب الأولى
// التحقق: 6 دفعات في السنة، كل فترة شهران، الجدول والمستحق، والقراءة من الإكسل بصيغها.
const C = require("/tmp/c.js");
const P = require("/tmp/b/importParse.js");
const fails = [];
const ck = (n, ok, d = "") => { console.log(ok ? "✅" : "❌", n, d && !ok ? "— " + d : ""); if (!ok) fails.push(n); };
const iso = (d) => d.toISOString().slice(0, 10);

ck("FREQUENCIES تضم bimonthly بعنوان «كل شهرين»",
  C.FREQUENCIES.some((f) => f.value === "bimonthly" && f.label === "كل شهرين"));
ck("defaultTermPeriods(bimonthly) = 6", C.defaultTermPeriods("bimonthly") === 6);
ck("freqLabel/freqShort", C.freqLabel("bimonthly") === "كل شهرين" && C.freqShort("bimonthly") === "شهرين");

// addPeriods: 1 فترة = شهران
ck("addPeriods +1 من 2026-01-15 = 2026-03-15", iso(C.addPeriods(new Date("2026-01-15"), "bimonthly", 1)) === "2026-03-15");
ck("addPeriods +3 من 2026-01-15 = 2026-07-15", iso(C.addPeriods(new Date("2026-01-15"), "bimonthly", 3)) === "2026-07-15");
ck("addPeriods +6 من 2026-01-15 = 2027-01-15 (سنة كاملة)", iso(C.addPeriods(new Date("2026-01-15"), "bimonthly", 6)) === "2027-01-15");
ck("مرساة 31: من 2026-01-31 +1 = 2026-03-31، +2 = 2026-05-31، +1 من 2026-03-31 بمرساة 31 → 05-31",
  iso(C.addPeriods(new Date("2026-01-31"), "bimonthly", 1, 31)) === "2026-03-31" && iso(C.addPeriods(new Date("2026-01-31"), "bimonthly", 2, 31)) === "2026-05-31");
ck("31 يناير +4 فترات = 30 سبتمبر (شهر قصير يُقصّ)", iso(C.addPeriods(new Date("2026-01-31"), "bimonthly", 4, 31)) === "2026-09-30");
ck("هجري: +1 = شهران هجريان (±3 أيام من 59)", (() => {
  const a = new Date("2026-01-15"), b = C.addPeriods(a, "bimonthly", 1, null, "hijri");
  const days = Math.round((b - a) / 86400000); return days >= 57 && days <= 61;
})());

// جدول الدفعات: 6 دفعات بفواصل شهرين
const t = { contract_start: "2026-01-01", payment_frequency: "bimonthly", rent_amount: 6000, paid_periods: 0, contract_periods: 6, partial_amount: 0 };
const sch = C.buildSchedule(t);
ck("buildSchedule: 6 دفعات", sch.length === 6, String(sch.length));
ck("تواريخ الجدول: يناير، مارس، مايو، يوليو، سبتمبر، نوفمبر",
  JSON.stringify(sch.map((s) => String(s.due || s.date || s.dueDate).slice(0, 7))) === JSON.stringify(["2026-01", "2026-03", "2026-05", "2026-07", "2026-09", "2026-11"]),
  JSON.stringify(sch.map((s) => s.due || s.date || s.dueDate)));

// contractState (اليوم 2026-11-22): حلّت 6 دفعات (يناير…نوفمبر)، مسدَّد 2 → متأخر 4 = 24,000
const s = C.contractState({ ...t, paid_periods: 2 }, {});
ck("contractState: نهاية العقد 2027-01-01 (6 × شهرين من 2026-01-01)", String(s.endDate || "").slice(0, 10) === "2027-01-01", String(s.endDate));
ck("الاستحقاق التالي غير المسدَّد = 2026-05-01", String(s.nextDueDate || "").slice(0, 10) === "2026-05-01", String(s.nextDueDate));
ck("4 دفعات متأخرة = 24,000", s.unpaid === 4 && s.amountDue === 24000, JSON.stringify({ u: s.unpaid, a: s.amountDue }));
const s2 = C.contractState({ ...t, paid_periods: 6 }, {});
ck("مسدَّد 6/6: لا مستحق، والعقد مكتمل", s2.amountDue === 0 && s2.unpaid === 0, JSON.stringify({ u: s2.unpaid, a: s2.amountDue }));

// قراءة الإكسل: كل صيغ «كل شهرين» تُقرأ bimonthly
const H = P.HEADERS;
const grid = [H].concat([
  ["أحمد", "1", "6000", "كل شهرين", "2026-01-01", "6"],
  ["سعد", "2", "6000", "6 دفعات", "2026-01-01", "6"],
  ["خالد", "3", "6000", "كل شهران", "2026-01-01", "6"],
  ["فهد", "4", "6000", "كل ٢ أشهر", "2026-01-01", "6"],
  ["بدر", "5", "6000", "bimonthly", "2026-01-01", "6"],
  ["علي", "6", "6000", "ست دفعات", "2026-01-01", "6"],
].map((r) => r.concat(Array(H.length - r.length).fill(""))));
const { rows } = P.parseGrid(grid, [], "2026-11-22", {});
ck("6 صفوف مقروءة", rows.length === 6, String(rows.length));
ck("كل الصيغ → bimonthly", rows.every((r) => r.payment_frequency === "bimonthly"), JSON.stringify(rows.map((r) => [r.name, r.payment_frequency])));
ck("بلا خطأ «دورة غير معروفة»", rows.every((r) => !(r.errors || []).some((e) => /دورة/.test(e)) && !(r.problems || []).some((e) => /دورة/.test(e))),
  JSON.stringify(rows.map((r) => r.errors || r.problems)));
ck("6 دفعات تعني سنة: contract_periods 6", rows.every((r) => Number(r.contract_periods) === 6));

console.log(fails.length ? `\n❌ ${fails.length} فشل` : "\n✅ bimonthly: كل الاختبارات نجحت");
if (fails.length) process.exit(1);

/* ── الدورة المخصصة «كل N أشهر» (m<N>) — طلب الأولى: كل 5 أو 7 أشهر ─────── */
{
  const f2 = [];
  const c2 = (n, ok, d = "") => { console.log(ok ? "✅" : "❌", n, d && !ok ? "— " + d : ""); if (!ok) f2.push(n); };
  c2("customMonths: m5=5, m24=24, m0/m25/x = null", C.customMonths("m5") === 5 && C.customMonths("m24") === 24 && C.customMonths("m0") === null && C.customMonths("m25") === null && C.customMonths("monthly") === null);
  c2("freqMonths: quarterly=3, m7=7, daily=null", C.freqMonths("quarterly") === 3 && C.freqMonths("m7") === 7 && C.freqMonths("daily") === null);
  c2("normalizeFreq: m3→quarterly, m2→bimonthly, m12→annual, m5→m5, خطأ→monthly", C.normalizeFreq("m3") === "quarterly" && C.normalizeFreq("m2") === "bimonthly" && C.normalizeFreq("m12") === "annual" && C.normalizeFreq("m5") === "m5" && C.normalizeFreq("xx") === "monthly");
  c2("isValidFreq", C.isValidFreq("m7") && C.isValidFreq("weekly") && !C.isValidFreq("m99") && !C.isValidFreq("foo"));
  c2("freqLabel m5 = «كل 5 أشهر»، m7، m11 = «كل 11 شهرًا»", C.freqLabel("m5") === "كل 5 أشهر" && C.freqLabel("m7") === "كل 7 أشهر" && C.freqLabel("m11") === "كل 11 شهرًا", C.freqLabel("m11"));
  c2("periodsPerYear: m5→2، m7→2، m4→3، m8→2 (أقرب عدد صحيح، لا صفر)", C.periodsPerYear("m5") === 2 && C.periodsPerYear("m7") === 2 && C.periodsPerYear("m4") === 3 && C.periodsPerYear("m8") === 2 && C.periodsPerYear("m24") === 1);
  c2("addPeriods m5: 2026-01-15 +1 = 2026-06-15، +2 = 2026-11-15", iso(C.addPeriods(new Date("2026-01-15"), "m5", 1)) === "2026-06-15" && iso(C.addPeriods(new Date("2026-01-15"), "m5", 2)) === "2026-11-15");
  c2("addPeriods m7 بمرساة 31: 2026-01-31 +1 = 2026-08-31", iso(C.addPeriods(new Date("2026-01-31"), "m7", 1, 31)) === "2026-08-31");
  const t5 = { contract_start: "2026-01-01", payment_frequency: "m5", rent_amount: 10000, paid_periods: 0, contract_periods: 3, partial_amount: 0 };
  const s5 = C.buildSchedule(t5);
  c2("جدول m5 × 3: يناير، يونيو، نوفمبر", JSON.stringify(s5.map((x) => String(x.due || x.date || x.dueDate).slice(0, 7))) === JSON.stringify(["2026-01", "2026-06", "2026-11"]), JSON.stringify(s5.map((x) => x.due)));
  const st5 = C.contractState({ ...t5, paid_periods: 1 }, {});
  c2("contractState m5 (اليوم 2026-11-22): حلّت 3، مسدَّد 1 → متأخر 2 = 20,000، النهاية 2027-04-01", st5.unpaid === 2 && st5.amountDue === 20000 && String(st5.endDate).slice(0, 10) === "2027-04-01", JSON.stringify({ u: st5.unpaid, a: st5.amountDue, e: st5.endDate }));
  // الإكسل: «كل 5 اشهر»، «كل ٧ شهور»، «كل 3 اشهر» (ثابتة)، «كل 2 اشهر» → bimonthly
  const grid2 = [H].concat([
    ["أ", "1", "6000", "كل 5 اشهر", "2026-01-01", "2"],
    ["ب", "2", "6000", "كل ٧ شهور", "2026-01-01", "2"],
    ["ج", "3", "6000", "كل 3 اشهر", "2026-01-01", "4"],
    ["د", "4", "6000", "كل 2 اشهر", "2026-01-01", "6"],
    ["هـ", "5", "6000", "every 5 months", "2026-01-01", "2"],
    ["و", "6", "6000", "حسب الاتفاق", "2026-01-01", "2"],
  ].map((r) => r.concat(Array(H.length - r.length).fill(""))));
  const r2 = P.parseGrid(grid2, [], "2026-11-22", {}).rows;
  c2("الإكسل: m5، m7، quarterly، bimonthly، m5", JSON.stringify(r2.slice(0, 5).map((r) => r.payment_frequency)) === JSON.stringify(["m5", "m7", "quarterly", "bimonthly", "m5"]), JSON.stringify(r2.map((r) => [r.name, r.payment_frequency])));
  c2("«حسب الاتفاق» ما زالت دورة غير معروفة (خطأ صريح)", /دورة سداد غير معروفة/.test(r2[5]._error || ""), r2[5]._error);
  c2("customFreqFromText: «كل 30 شهر» مرفوض (فوق 24)", P.customFreqFromText("كل 30 شهر") === null && P.customFreqFromText("كل 5 اشهر") === "m5" && P.customFreqFromText("كل 3 اشهر") === "quarterly");
  console.log(f2.length ? `\n❌ custom: ${f2.length} فشل` : "\n✅ custom «كل N أشهر»: كل الاختبارات نجحت");
  if (f2.length) process.exit(1);
}
