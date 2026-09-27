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

console.log(fails ? `\n❌ ${fails} فشل` : "✅ مصادر التسجيل سليمة");
process.exit(fails ? 1 : 0);
