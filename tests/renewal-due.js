/* «العقد المنتهي لا يظهر في نظرة عامة» (بلاغ مكتب التميز 10 أكتوبر 2026).
   يُبنى أولًا: npx esbuild lib/contract-state.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/contract-state.js
                npx esbuild lib/contracts.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/contracts.js */
const { renewalDue, unitStatus } = require("/tmp/b/contract-state.js");
const { contractState } = require("/tmp/b/contracts.js");
let fails = 0;
const eq = (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) { fails++; console.log(`❌ ${n}: ${JSON.stringify(g)} ≠ ${JSON.stringify(w)}`); } };
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const base = { rent_amount: 1000, payment_frequency: "monthly", contract_periods: 12 };
const mk = (o) => { const t = { ...base, ...o }; return { t, st: contractState(t, { expiringDays: 60 }) }; };

// انتهى قبل 10 أيام، مسدَّد كله، لا تجديد ولا إخلاء ← يظهر
let { t, st } = mk({ contract_start: daysAgo(375), paid_periods: 12 });
eq("منتهٍ مسدَّد يظهر", renewalDue(t, st), true);
eq("ومتّسق مع شريحة صفحة العقار", unitStatus(t, st), "expiring");
// انتهى وعليه متأخر ← يظهر أيضًا للتجديد (والمتأخر في قائمته)
({ t, st } = mk({ contract_start: daysAgo(375), paid_periods: 10 }));
eq("منتهٍ بمتأخرات يظهر للتجديد", renewalDue(t, st), true);
// شاغرة (أُخليت) ← لا
({ t, st } = mk({ contract_start: daysAgo(375), paid_periods: 12, move_out_date: daysAgo(5), status: "vacated" }));
eq("المُخلاة لا تظهر", renewalDue(t, st), false);
// ينتهي بعد ~20 يومًا ← يظهر
({ t, st } = mk({ contract_start: daysAgo(345), paid_periods: 11 }));
eq("يقترب يظهر", renewalDue(t, st), true);
// بدأ اليوم ← لا
({ t, st } = mk({ contract_start: daysAgo(0), paid_periods: 0 }));
eq("جديد لا يظهر", renewalDue(t, st), false);
console.log(fails ? `${fails} ❌` : "✅ العقود المنتهية والقريبة تظهر في كل الشاشات بقاعدة واحدة");
process.exit(fails ? 1 : 0);
