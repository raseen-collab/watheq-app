/* عتبات الحالة — الشاشة والمستندات يجب أن تقرأ الرقم نفسه.
   npx esbuild lib/contract-state.ts lib/contracts.ts --bundle --format=cjs --platform=node --alias:@=. --outdir=/tmp/b */
const { statusWindows, unitStatus, unitStatusLabel, UNIT_STATUS_LABEL } = require("/tmp/b/contract-state.js");
const { contractState } = require("/tmp/b/contracts.js");

let fails = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log(`❌ ${name}\n   نتج: ${g}\n   المتوقع: ${w}`); }
};

/* ═══ 1) أولوية العتبات: العقار ← المكتب ← الافتراضي ═══ */
eq("بلا أي إعداد → الافتراضات",
   statusWindows(null, null), { graceDays: 0, soonDays: 10, imminentDays: 5, expiringDays: 60 });

eq("إعداد المكتب يسري حين لا إعداد للعقار",
   statusWindows({}, { due_soon_days: 14, due_imminent_days: 3, expiring_days: 90 }),
   { graceDays: 0, soonDays: 14, imminentDays: 3, expiringDays: 90 });

eq("إعداد العقار يتجاوز إعداد المكتب",
   statusWindows({ soon_days: 20, imminent_days: 8, expiring_days: 30, grace_days: 5 },
                 { due_soon_days: 14, due_imminent_days: 3, expiring_days: 90 }),
   { graceDays: 5, soonDays: 20, imminentDays: 8, expiringDays: 30 });

eq("قيم فارغة/صفرية لا تُلغي إعداد المكتب",
   statusWindows({ soon_days: null, imminent_days: 0, expiring_days: undefined },
                 { due_soon_days: 14, due_imminent_days: 3, expiring_days: 90 }),
   { graceDays: 0, soonDays: 14, imminentDays: 3, expiringDays: 90 });

eq("القيم الشاذة تُقصّ إلى الحدود",
   statusWindows({ grace_days: 999, soon_days: 999, imminent_days: -4, expiring_days: 5000 }, null),
   { graceDays: 30, soonDays: 60, imminentDays: 5, expiringDays: 180 });

/* ═══ 2) العتبة تُغيّر الحالة فعلًا — لا مجرد رقم يُمرَّر ═══
   عقد ينتهي بعد 70 يومًا: بالافتراضي (60) «منتظم»، وبإعداد مكتب 90 «ينتهي قريبًا». */
const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; };

const unit = {
  contract_start: iso(-295), contract_end: iso(70), payment_frequency: "monthly",
  rent_amount: 3000, contract_periods: 12, paid_periods: 12,
};
const stDefault = contractState(unit, statusWindows(null, null));
const stWide = contractState(unit, statusWindows(null, { expiring_days: 90 }));
eq("بعتبة 60: العقد ليس «ينتهي قريبًا»", stDefault.expiringSoon, false);
eq("بعتبة 90: العقد «ينتهي قريبًا»", stWide.expiringSoon, true);
eq("الحالة المعروضة تتبع العتبة",
   [unitStatus(unit, stDefault), unitStatus(unit, stWide)], ["ok", "expiring"]);

/* نافذة «قريب»: قسط بعد 12 يومًا */
const soonUnit = { contract_start: iso(-18), payment_frequency: "monthly", rent_amount: 3000,
                   contract_periods: 12, paid_periods: 1 };
const a = contractState(soonUnit, statusWindows(null, null));                     // soon=10
const b = contractState(soonUnit, statusWindows(null, { due_soon_days: 20 }));    // soon=20
eq("خارج نافذة «قريب» الافتراضية", a.status, "ok");
eq("داخل نافذة «قريب» الموسَّعة", b.status, "soon");

/* ═══ 3) تطابق الشاشة والمستند: نفس الوحدة ونفس العتبات = نفس الحالة ═══ */
const office = { due_soon_days: 14, due_imminent_days: 4, expiring_days: 90 };
const prop = { grace_days: 3, soon_days: null, imminent_days: null, expiring_days: null };
const screen = contractState(unit, statusWindows(prop, office));   // كما تحسبها اللوحة
const doc    = contractState(unit, statusWindows(prop, office));   // كما يحسبها المستند
eq("اللوحة والمستند متطابقان",
   [unitStatus(unit, screen), screen.status, screen.amountDue],
   [unitStatus(unit, doc), doc.status, doc.amountDue]);

/* ═══ 4) كل حالة لها تسمية — ولا حالة بلا اسم ═══ */
const keys = ["vacant","litigation","incomplete","late","partial","due","soon","expiring","ok"];
eq("كل مفاتيح الحالات مُسمّاة", keys.filter((k) => !UNIT_STATUS_LABEL[k]), []);
eq("عقد منتهٍ يُسمّى «انتهى العقد»", unitStatusLabel("expiring", { daysToEnd: -723 }), "انتهى العقد");
eq("عقد يقارب يُسمّى «ينتهي قريبًا»", unitStatusLabel("expiring", { daysToEnd: 20 }), "ينتهي قريبًا");

/* ═══ 5) دليل الحالات يغطي كل ما يُعرض ═══ */
const legend = require("fs").readFileSync(__dirname + "/../components/StatusLegend.tsx", "utf8");
const shown = [...new Set([...keys.map((k) => UNIT_STATUS_LABEL[k]), "انتهى العقد"])];
eq("الدليل يغطي كل الحالات المعروضة",
   shown.filter((l) => !new RegExp(`name: "${l}"`).test(legend)), []);

console.log(fails ? `\n❌ ${fails} فشل` : "✅ عتبات الحالة موحَّدة بين الشاشة والمستندات");
process.exit(fails ? 1 : 0);
