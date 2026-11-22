// «إبلاغ المالك» (v98) — نص رسالة واتساب للمالك حين لا يتجاوب المستأجر
const M = require("/tmp/b/tenant-messages.js");
const fails = [];
const ck = (n, ok, d = "") => { console.log(ok ? "✅" : "❌", n, d && !ok ? "— " + d : ""); if (!ok) fails.push(n); };
const base = { ownerName: "عبدالله", tenantName: "محمد", unitText: "شقة (3)", propertyName: "برج الياسمين", signer: "مكتب الأولى" };

const a = M.ownerAlertText({ ...base, endDate: "2026-10-01", daysToEnd: -52, overdue: 12000, unpaid: 2 });
ck("منتهٍ + متأخرات: يذكر الانتهاء والتاريخ", /انتهى عقد الإيجار بتاريخ/.test(a) && /2026|أكتوبر/.test(a), a);
ck("المبلغ والدفعتان", /12,000 ريال \(دفعتان\)/.test(a), a);
ck("لم يتجاوب للسداد أو الإخلاء + خيارات الإخلاء", /للسداد أو الإخلاء/.test(a) && /إجراءات الإخلاء النظامية/.test(a));
ck("اسم المالك والتوقيع", a.startsWith("السلام عليكم ورحمة الله، عبدالله") && a.trim().endsWith("مكتب الأولى"));

const b = M.ownerAlertText({ ...base, ownerName: null, endDate: "2027-03-01", daysToEnd: 99, overdue: 5000, unpaid: 1 });
ck("عقد قائم: «ينتهي» لا «انتهى»، ولا يذكر الإخلاء", /ينتهي عقد الإيجار/.test(b) && !/أو الإخلاء/.test(b), b);
ck("دفعة واحدة", /\(دفعة واحدة\)/.test(b));
ck("بلا اسم مالك: تحية عامة", b.startsWith("السلام عليكم ورحمة الله\n"));

const c = M.ownerAlertText({ ...base, endDate: "2026-10-01", daysToEnd: -5, overdue: 0, unpaid: 0, carried: 3000 });
ck("لا متأخرات حالية لكن دين مرحَّل", /3,000 ريال مرحَّلة/.test(c) && !/متأخرات/.test(c), c);

const d = M.ownerAlertText({ ...base, endDate: "2026-10-01", daysToEnd: -5, overdue: 15000, unpaid: 5, carried: 3000, hijri: true, attempts: "3 تذكيرات واتساب" });
ck("5 دفعات + منها مرحَّلة + هجري + المحاولات", /\(5 دفعات\)/.test(d) && /منها 3,000 ريال مرحَّلة/.test(d) && /\(3 تذكيرات واتساب\)/.test(d) && /\(.*14\d\d.*\)/.test(d), d);
ck("11 دفعة (جمع العدد الكبير)", /\(11 دفعة\)/.test(M.ownerAlertText({ ...base, overdue: 1, unpaid: 11 })));

console.log(fails.length ? `\n❌ ${fails.length} فشل` : "\n✅ owner-alert: كل الاختبارات نجحت");
process.exit(fails.length ? 1 : 0);
