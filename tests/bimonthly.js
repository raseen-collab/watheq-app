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
process.exit(fails.length ? 1 : 0);
