// اختبار عدائي: مدخلات لا يفترضها المطوّر لكن الواقع ينتجها
const C = require("/tmp/c.js"), D = require("/tmp/docs.js"), E = require("/tmp/exp.js");
const fails = []; let n = 0;
const ck = (name, fn) => { n++; try { const ok = fn(); if (!ok) fails.push(name); console.log(ok ? "✅" : "❌", name); }
  catch (e) { fails.push(name + " (انهيار)"); console.log("💥", name, "—", String(e.message).slice(0, 70)); } };

const P = { id: "p", name: "ع", property_type: "residential", collected: 0, grace_days: 0, tenants: [], property_notes: [] };
const base = { id: "t", unit: "1", name: "م", rent_amount: 5000, payment_frequency: "monthly",
  contract_start: "2026-01-01", contract_periods: 12, paid_periods: 2, partial_amount: 0 };

ck("بيانات فارغة تمامًا", () => Number.isFinite(C.contractState({}, {}).amountDue));
ck("تاريخ غير صالح 'abcd'", () => Number.isFinite(C.contractState({ ...base, contract_start: "abcd" }, {}).amountDue));
ck("تاريخ 2026-02-31 (غير موجود)", () => { const s = C.contractState({ ...base, contract_start: "2026-02-31" }, {}); return Number.isFinite(s.amountDue); });
ck("دورة سداد غير معروفة", () => Number.isFinite(C.contractState({ ...base, payment_frequency: "كل قمر" }, {}).amountDue));
ck("إيجار نصّي '5,000'", () => Number.isFinite(C.contractState({ ...base, rent_amount: "5,000" }, {}).amountDue));
ck("إيجار Infinity", () => { const s = C.contractState({ ...base, rent_amount: Infinity }, {}); return Number.isFinite(s.amountDue) || s.amountDue === Infinity ? Number.isFinite(s.unpaid) : false; });
ck("إيجار NaN", () => Number.isFinite(C.contractState({ ...base, rent_amount: NaN }, {}).amountDue));
ck("عدد دفعات 100000", () => { const t0 = Date.now(); const s = C.contractState({ ...base, contract_periods: 100000 }, {}); return Date.now() - t0 < 1500 && Number.isFinite(s.amountDue); });
ck("مسدَّد سالب (-5)", () => C.contractState({ ...base, paid_periods: -5 }, {}).unpaid >= 0);
ck("جزئي سالب", () => (C.contractState({ ...base, partial_amount: -900 }, {}).partial || 0) >= 0);
ck("فترة سماح 999 يومًا", () => Number.isFinite(C.contractState(base, { graceDays: 999 }).amountDue));
ck("نافذة «قريب» سالبة", () => Number.isFinite(C.contractState(base, { soonDays: -5 }).amountDue));
ck("تقويم غير معروف", () => Number.isFinite(C.contractState({ ...base, calendar: "قبطي" }, {}).amountDue));
ck("عقد هجري بسنة 1200 (خارج المدى)", () => { const s = C.buildSchedule({ ...base, calendar: "hijri", contract_start: "1782-01-01" }); return Array.isArray(s); });
ck("نهاية عقد قبل بدايته", () => { const s = C.contractState({ ...base, contract_end: "2020-01-01" }, {}); return Number.isFinite(s.daysToEnd); });
ck("أول استحقاق غير صالح", () => Number.isFinite(C.contractState({ ...base, first_due: "xx" }, {}).amountDue));
ck("وحدة بلا مستأجر (name فارغ)", () => { const t = { ...base, name: "" }; const h = D.statementHTML(t, { ...P, tenants: [t] }, {}, [], "full"); return !/undefined|NaN/.test(h); });
ck("عقار بلا وحدات", () => { const h = D.propertyStatementHTML({ ...P, tenants: [] }, {}, "full"); return !/NaN|undefined/.test(h); });
ck("عقار بوحدة واحدة شاغرة فقط", () => { const t = { ...base, status: "vacated", move_out_date: "2026-08-01" };
  const h = D.propertyStatementHTML({ ...P, tenants: [t] }, {}, "full"); return !/NaN/.test(h) && /شاغرة/.test(h); });
ck("فترة معكوسة (من > إلى)", () => { const h = D.propertyStatementHTML({ ...P, tenants: [base] }, {}, "full",
  { from: "2026-12-01", to: "2026-01-01", label: "معكوسة" }, [], []); return !/NaN/.test(h); });
ck("دفعة بمبلغ نصّي في الفترة", () => { const h = D.propertyStatementHTML({ ...P, tenants: [base] }, {}, "full",
  { from: "2026-01-01", to: "2026-12-31", label: "س" }, [{ id: "1", paid_on: "2026-05-01", amount: "3,000", method: "cash", unit: "1" }], []);
  return !/NaN/.test(h); });
ck("مصروف بلا تاريخ", () => { const f = E.ownerNet(1000, [{ amount: 100 }, { amount: null }], 10, 0, 0); return Number.isFinite(f.net); });
ck("قائمة مصروفات فارغة/غير مصفوفة", () => Number.isFinite(E.ownerNet(1000, [], 10, 0, 0).net));
ck("أتعاب نصّية '10%'", () => { const f = E.ownerNet(1000, [], "10%", 0, 0); return Number.isFinite(f.net); });
ck("محصَّل بكسور طويلة", () => { const f = E.ownerNet(1000.005, [{ amount: 0.001 }], 33.333, 0, 0);
  return Number.isFinite(f.net) && String(f.net).split(".")[1]?.length <= 2; });
ck("اسم مستأجر 500 حرف", () => { const t = { ...base, name: "أ".repeat(500) };
  return !/NaN/.test(D.statementHTML(t, { ...P, tenants: [t] }, {}, [], "brief")); });
ck("رقم عقد فيه اقتباس ومحارف", () => { const t = { ...base, contract_no: `"><script>x</script>` };
  const h = D.statementHTML(t, { ...P, tenants: [t] }, {}, [], "full"); return !/<script>/.test(h); });

console.log(fails.length ? `\n❌ ${fails.length} من ${n}` : `\n✅ ${n}/${n} — صمد أمام كل مدخل عدائي`);
