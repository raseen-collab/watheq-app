/* أتعاب إدارة بمبلغ ثابت ودورية (شهري/٦ أشهر/سنوي/مرة واحدة) v86 (15 نوفمبر 2026)
   تشغيل: npx esbuild lib/expenses.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/expenses.js
           npx esbuild lib/collection.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/collection.js
           node tests/fixed-mgmt-fee.js */
const E = require("/tmp/b/expenses.js");
const C = require("/tmp/b/collection.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };

// monthsInPeriod
t("same month", E.monthsInPeriod("2026-11-01", "2026-11-15") === 1);
t("two months", E.monthsInPeriod("2026-11-01", "2026-12-31") === 2);
t("year", E.monthsInPeriod("2026-01-01", "2026-12-31") === 12);
t("cross year", E.monthsInPeriod("2026-11-01", "2027-02-28") === 4);
t("bad input → 1", E.monthsInPeriod(null, "x") === 1 && E.monthsInPeriod("2026-12-01", "2026-11-01") === 1);

// feeSpecOf / feeLabel
t("pct spec", JSON.stringify(E.feeSpecOf({ mgmt_fee_pct: 5 }, 3)) === JSON.stringify({ pct: 5, fixed: null, times: 3 }));
t("fixed spec", JSON.stringify(E.feeSpecOf({ mgmt_fee_pct: 5, mgmt_fee_mode: "fixed", mgmt_fee_amount: 1500 }, 2)) === JSON.stringify({ pct: null, fixed: 1500, times: 2 }));
t("fixed mode without amount → no fee", E.feeSpecOf({ mgmt_fee_mode: "fixed", mgmt_fee_amount: 0 }).fixed === null);
t("labels", E.feeLabel({ mgmt_fee_pct: 7.5 }) === "7.5%" && E.feeLabel({ mgmt_fee_mode: "fixed", mgmt_fee_amount: 1500 }) === "1,500 ريال شهريًّا" && E.feeLabel({}) === null);

// ownerNet: backward compat (number) unchanged
const a = E.ownerNet(10000, [], 5);
t("pct number compat", a.fee === 500 && a.feePct === 5 && a.net === 9500 && !a.feeFixed);
// ownerNet: fixed one month
const b = E.ownerNet(10000, [{ amount: 200, spent_on: "2026-11-01", category: "cleaning" }], { fixed: 1500, times: 1 });
t("fixed 1 month", b.fee === 1500 && b.feePct === null && b.feeFixed === 1500 && b.feeTimes === 1 && b.net === 8300);
// fixed 12 months with VAT on fee
const c = E.ownerNet(120000, [], { fixed: 1500, times: 12 }, 0, 15);
t("fixed 12 months + VAT", c.feeBase === 18000 && c.feeVat === 2700 && c.fee === 20700 && c.net === 99300);
// fixed exceeds collected → flagged, not clipped
const d = E.ownerNet(1000, [], { fixed: 1500, times: 1 });
t("fixed > collected flagged", d.fee === 1500 && d.feeExceedsCollected === true && d.net === -500);
// fixed with zero collected still charges (contractual) — documented behaviour
const e = E.ownerNet(0, [], { fixed: 1500, times: 1 });
t("fixed on zero collected", e.fee === 1500 && e.net === -1500);
// spec with pct only behaves like number
t("spec pct", E.ownerNet(10000, [], { pct: 10 }).fee === 1000);
// fixed wins over pct if both given
t("fixed wins", E.ownerNet(10000, [], { pct: 10, fixed: 100, times: 1 }).fee === 100);

// feeTimes per period
const fx = (per, on) => ({ mgmt_fee_mode: "fixed", mgmt_fee_amount: 1000, mgmt_fee_period: per, mgmt_fee_on: on });
t("times: pct property → 1", E.feeTimes({ mgmt_fee_pct: 5 }, "2026-01-01", "2026-12-31") === 1);
t("times: month", E.feeTimes(fx("month"), "2026-11-01", "2026-12-31") === 2);
t("times: once inside", E.feeTimes(fx("once", "2026-11-10"), "2026-11-01", "2026-11-30") === 1);
t("times: once outside → 0", E.feeTimes(fx("once", "2026-10-10"), "2026-11-01", "2026-11-30") === 0);
t("times: once, year statement", E.feeTimes(fx("once", "2026-05-01"), "2026-01-01", "2026-12-31") === 1);
t("times: year, due inside", E.feeTimes(fx("year", "2026-03-01"), "2026-03-01", "2026-03-31") === 1);
t("times: year, other month → 0", E.feeTimes(fx("year", "2026-03-01"), "2026-04-01", "2026-04-30") === 0);
t("times: year, 3-year span", E.feeTimes(fx("year", "2025-03-01"), "2026-01-01", "2028-12-31") === 3);
t("times: half, year statement", E.feeTimes(fx("half", "2026-01-15"), "2026-01-01", "2026-12-31") === 2);
t("times: half, 31 Jan anchor → Jul 31", E.feeTimes(fx("half", "2026-01-31"), "2026-07-01", "2026-07-31") === 1);
t("times: half starting before period", E.feeTimes(fx("half", "2025-01-01"), "2026-01-01", "2026-12-31") === 2);
t("times: no anchor → 1 (safe default)", E.feeTimes(fx("year", null), "2026-01-01", "2026-12-31") === 1);
t("times: no period bounds → 1", E.feeTimes(fx("year", "2026-01-01"), null, null) === 1);
// ownerNet with 0 times → no fee
const z = E.ownerNet(5000, [], { fixed: 1000, times: 0 });
t("zero times → fee 0", z.fee === 0 && z.feeTimes === 0 && z.net === 5000);
// labels per period
t("label year", E.feeLabel(fx("year", "2026-01-01")) === "1,000 ريال سنويًّا" && E.feeLabel(fx("once")) === "1,000 ريال مرة واحدة" && E.feeLabel(fx("half")) === "1,000 ريال كل ٦ أشهر");

// buildCollection with to → months
const props = [{ id: "p1", name: "A", mgmt_fee_mode: "fixed", mgmt_fee_amount: 1000 }, { id: "p2", name: "B", mgmt_fee_pct: 5 }, { id: "p3", name: "C", mgmt_fee_mode: "fixed", mgmt_fee_amount: 6000, mgmt_fee_period: "year", mgmt_fee_on: "2026-12-01" }];
const tenants = [{ id: "t1", property_id: "p1", unit: "1", rent_amount: 5000, name: "x" }, { id: "t2", property_id: "p2", unit: "1", rent_amount: 5000, name: "y" }, { id: "t3", property_id: "p3", unit: "1", rent_amount: 5000, name: "z" }];
const pays = [{ id: "y1", property_id: "p1", tenant_id: "t1", amount: 5000, paid_on: "2026-11-05", applies_to: "rent" }, { id: "y2", property_id: "p2", tenant_id: "t2", amount: 5000, paid_on: "2026-12-05", applies_to: "rent" }, { id: "y3", property_id: "p3", tenant_id: "t3", amount: 5000, paid_on: "2026-11-05", applies_to: "rent" }];
const r2m = C.buildCollection({ periodPayments: pays, allTenantPayments: [], expenses: [], tenants, properties: props, from: "2026-11-01", to: "2026-12-31" });
t("collection: fixed×2 months + pct + yearly due in Dec", r2m.fin.fee === 2000 + 250 + 6000);
const r1m = C.buildCollection({ periodPayments: pays, allTenantPayments: [], expenses: [], tenants, properties: props, from: "2026-11-01" });
t("collection: no `to` → 1 time each", r1m.fin.fee === 1000 + 250 + 6000);
const rNov = C.buildCollection({ periodPayments: pays, allTenantPayments: [], expenses: [], tenants, properties: props, from: "2026-11-01", to: "2026-11-30" });
t("collection: Nov only → yearly not due", rNov.fin.fee === 1000 + 250);

console.log(`fixed-mgmt-fee: ${ok} ✅ ${bad ? bad + " ❌" : ""}`);
process.exit(bad ? 1 : 0);
