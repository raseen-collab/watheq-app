/* مصادر التسجيل — التعريف الواحد المشترك بين صفحة الدخول ولوحة الإدارة.
   يُبنى أولًا: npx esbuild lib/signup-sources.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/signup-sources.js */
const S = require("/tmp/b/signup-sources.js");

let fails = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log(`❌ ${name}\n   نتج: ${g}\n   المتوقع: ${w}`); }
};

// العطل الأصلي: رابط الديمو يرسل ?src=demo فتُرمى القيمة لأنها ليست في القائمة
eq("demo قيمة صحيحة", S.isSignupSource("demo"), true);
eq("demo لها تسمية في اللوحة", S.sourceAdminLabel("demo"), "النسخة التجريبية");
eq("demo لا تُعرض كخيار يدوي", S.CHOSEN_SOURCES.some((s) => s.v === "demo"), false);

// القيم القديمة كلها باقية — لا يفقد حساب مسجَّل تسميته
for (const [v, l] of [["haraj", "حراج"], ["group", "قروب"], ["twitter", "تويتر"],
                      ["search", "بحث جوجل"], ["referral", "توصية"],
                      ["direct", "تواصل مباشر"], ["other", "أخرى"], ["skip", "لم يذكر"]]) {
  eq(`تسمية ${v}`, S.sourceAdminLabel(v), l);
  eq(`قبول ${v}`, S.isSignupSource(v), true);
}

// «أفضّل عدم الذكر» مرة واحدة لا مرتين في القائمة المنسدلة
eq("skip ليس خيارًا مكرَّرًا", S.CHOSEN_SOURCES.filter((s) => s.v === "skip").length, 0);

// رفض ما ليس مصدرًا — الحقل يُكتب من رابط عام فلا يُقبل نص حر
for (const bad of [null, undefined, "", "   ", "DEMO", "demo ", "haraj;drop", "<script>", "twitter2"]) {
  eq(`رفض ${JSON.stringify(bad)}`, S.isSignupSource(bad), false);
}

// لا قيمة مكرَّرة ولا تسمية فارغة
const vals = S.ALL_SOURCES.map((s) => s.v);
eq("لا تكرار في القيم", vals.length, new Set(vals).size);
eq("كل مصدر له تسميتان", S.ALL_SOURCES.every((s) => s.l && s.adminLabel), true);

// المجهول يبقى مجهولًا — لا يُنسب حساب بلا مصدر إلى قناة
eq("مصدر فارغ", S.sourceAdminLabel(null), "غير معروف");
eq("مصدر غير معروف", S.sourceAdminLabel("tiktok"), "غير معروف");

/* ═══ الاستنتاج من الصفحة السابقة ═══
   نفس الحالات مُختبَرة في المتصفح على سكربت الموقع التسويقي. إن اختلف
   الملفّان اختلفت أرقام القنوات بين المصدرين — وهذا ما يحرسه هذان البلوكان. */
const ref = S.sourceFromReferrer;
eq("بحث جوجل", ref("https://www.google.com/"), "search");
eq("جوجل السعودية", ref("https://www.google.com.sa/search?q=برنامج+ادارة+املاك"), "search");
eq("بنج", ref("https://www.bing.com/"), "search");
eq("ياهو", ref("https://search.yahoo.com/"), "search");
eq("x.com", ref("https://x.com/watheqapp"), "twitter");
eq("t.co", ref("https://t.co/abc"), "twitter");
eq("تويتر القديم", ref("https://mobile.twitter.com/x"), "twitter");
eq("حراج", ref("https://haraj.com.sa/1/x"), "haraj");
eq("واتساب", ref("https://web.whatsapp.com/"), "group");
eq("wa.me", ref("https://wa.me/9665"), "group");
eq("تليجرام", ref("https://t.me/xyz"), "group");

/* الحواف التي تُنتج بيانات خاطئة لو أُهملت */
eq("من موقعنا نفسه: لا جديد", ref("https://watheqapp.com/about.html"), "");
eq("من نطاق فرعي لنا", ref("https://app.watheqapp.com/login"), "");
eq("بلا مُحيل", ref(""), "");
eq("مُحيل غير صالح", ref("ليس رابطًا"), "");
eq("نطاق يتضمّن google خداعًا", ref("https://notgoogle.example.com/"), "");
eq("نطاق مجهول يبقى فارغًا لا «أخرى»", ref("https://some-blog.net/post"), "");
eq("كل ما يخرج منها قيمة معروفة أو فراغ",
   ["https://www.google.com/", "https://x.com/a", "https://zzz.io/"]
     .map(ref).filter((v) => v !== "" && !S.isSignupSource(v)), []);


console.log(fails ? `\n❌ ${fails} فشل` : "✅ مصادر التسجيل سليمة");
process.exit(fails ? 1 : 0);
