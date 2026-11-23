// تقرير الدعم الأسبوعي — أرقام وأسئلة فريدة وتهريب HTML
const W = require("/tmp/b/support-weekly.js");
const fails = [];
const ck = (n, ok, d = "") => { console.log(ok ? "✅" : "❌", n, d && !ok ? "— " + d : ""); if (!ok) fails.push(n); };
const t0 = "2026-11-20T10:00:00Z";
const hq = [
  { question: "كيف أسجّل دفعة؟", answered: true, via: "kw", created_at: t0 },
  { question: "ابي اربط مع ايجار", answered: false, via: "ai", created_at: t0 },
  { question: "ابي اربط مع ايجار؟ ", answered: false, via: "ai", created_at: t0 },
  { question: "وش الفرق <b>", answered: false, via: "kw", created_at: t0 },
  { question: "الفاتورة الضريبية", answered: true, via: "ai", created_at: t0 },
];
const fb = [{ question: "كيف أسجّل دفعة؟", helpful: false, matched_id: "p-1", created_at: t0 }, { question: "x", helpful: true, created_at: t0 }];
const open = [{ message: "الصفحة ما تفتح & تعلق", status: "new", path: "/dashboard", created_at: t0 }];
const s = W.supportWeeklyText({ hq, fb, reports: open, openReports: open, advisorCount: 3, from: "2026-11-16", to: "2026-11-23" });
ck("العدد الكلي والإجابات", s.includes("<b>5</b>") && s.includes("وجد جوابًا 2") && s.includes("بلا جواب 3"), s);
ck("المطابقة الذكية 3 (وجد 1)", s.includes("بالمطابقة الذكية: 3 (وجد 1)"));
ck("سؤال مكرر يُدمج ×2", s.includes("ابي اربط مع ايجار (×2)"));
ck("تهريب HTML في السؤال", s.includes("وش الفرق &lt;b&gt;") && !s.includes("وش الفرق <b>"));
ck("تهريب & في البلاغ", s.includes("&amp; تعلق"));
ck("👎 مع رقم المدخل", s.includes("كيف أسجّل دفعة ← p-1"));
ck("المستشار 3", s.includes("المستشار: 3"));
ck("رابط حل البلاغات", s.includes("/admin/reports"));
const quiet = W.supportWeeklyText({ hq: [], fb: [], reports: [], openReports: [], advisorCount: 0, from: "a", to: "b" });
ck("أسبوع هادئ", quiet.includes("أسبوع هادئ"));
ck("uniqueQuestions يرتّب بالأكثر", W.uniqueQuestions([{ question: "أ" }, { question: "ب" }, { question: "ب؟" }])[0].q === "ب");
console.log(fails.length ? `❌ ${fails.length} فشل` : "✅ support-weekly: 10 ✓");
process.exit(fails.length ? 1 : 0);
