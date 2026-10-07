/* قمع الزوار (v76) — التحقق من جسم الطلب العام والعدّ.
   يُبنى أولًا: npx esbuild lib/funnel.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/funnel.js */
const F = require("/tmp/b/funnel.js");
let fails = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log(`❌ ${name}\n   نتج: ${g}\n   المتوقع: ${w}`); }
};
const P = (o) => F.parseFunnelBody(typeof o === "string" ? o : JSON.stringify(o));
const SID = "AbCdEf1234567890xyzQ";

eq("زيارة كاملة", P({ e: "visit", v: SID, s: "haraj", p: "/index.html" }), { event: "visit", src: "haraj", path: "/index.html", sid: SID });
eq("بلا مصدر", P({ e: "demo_open", v: SID, p: "/demo" }), { event: "demo_open", src: null, path: "/demo", sid: SID });
eq("skip ليس قناة", P({ e: "signup_view", v: SID, s: "skip", p: "/login" }).src, null);
eq("demo مصدر مقبول", P({ e: "signup_view", v: SID, s: "demo", p: "/login" }).src, "demo");
eq("المسار بلا استعلام", P({ e: "visit", v: SID, p: "/?src=haraj&x=1#top" }).path, "/");
eq("المسار يُقص 80", P({ e: "visit", v: SID, p: "/" + "a".repeat(200) }).path.length, 80);
eq("مسار خارجي يُرفض", P({ e: "visit", v: SID, p: "//evil.com/x" }).path, null);
eq("مسار نسبي يُرفض", P({ e: "visit", v: SID, p: "http://evil.com" }).path, null);
eq("رموز في المسار تُحذف", P({ e: "visit", v: SID, p: "/a<script>b" }).path, "/ascriptb");

for (const [name, body] of [
  ["حدث غير معروف", { e: "purchase", v: SID }],
  ["حدث فارغ", { v: SID }],
  ["جلسة قصيرة", { e: "visit", v: "abc" }],
  ["جلسة برموز", { e: "visit", v: "AbCdEf1234'; drop--" }],
  ["جلسة طويلة", { e: "visit", v: "a".repeat(41) }],
  ["جلسة رقم", { e: "visit", v: 12345678901 }],
  ["JSON معطوب", "{e:visit"],
  ["نص فارغ", ""],
  ["مصفوفة", "[1,2]"],
  ["null", "null"],
  ["كبير جدًا", JSON.stringify({ e: "visit", v: SID, x: "a".repeat(2000) })],
]) eq(`رفض: ${name}`, P(body), null);

eq("مصدر نص حر يُهمل ولا يُرفض الحدث", P({ e: "visit", v: SID, s: "<b>haraj</b>" }).src, null);
eq("مصدر بحروف كبيرة يُهمل", P({ e: "visit", v: SID, s: "HARAJ" }).src, null);

// الزواحف
for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
                  "Mozilla/5.0 HeadlessChrome/120", "curl/8.0", "python-requests/2.31", "", null])
  eq(`زاحف: ${ua}`, F.isBotAgent(ua), true);
for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
                  "Mozilla/5.0 (Linux; Android 13; CUBOT X30) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
                  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Telegram-Android/10.5.0",
                  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148 [FBAN/FBIOS]",
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"])
  eq(`زائر حقيقي: ${ua.slice(0, 40)}`, F.isBotAgent(ua), false);

// العدّ
const now = Date.parse("2026-10-07T12:00:00Z"), D = 86400000;
const at = (d) => new Date(now - d * D).toISOString();
const rows = [
  { event: "visit", src: "haraj", at: at(1) }, { event: "visit", src: "haraj", at: at(2) },
  { event: "demo_open", src: "haraj", at: at(1) }, { event: "signup_view", src: "haraj", at: at(1) },
  { event: "visit", src: null, at: at(3) }, { event: "visit", src: "twitter", at: at(20) },
  { event: "signup_submit", src: "twitter", at: at(20) }, { event: "bogus", src: "haraj", at: at(1) },
];
const w7 = F.summarizeFunnel(rows, now - 7 * D);
eq("7 أيام: حراج", w7.by.haraj, { visit: 2, demo_open: 1, signup_view: 1, signup_submit: 0 });
eq("7 أيام: مباشر", w7.by[""], { visit: 1, demo_open: 0, signup_view: 0, signup_submit: 0 });
eq("7 أيام: تويتر خارج الفترة", w7.by.twitter, undefined);
eq("7 أيام: المجموع", w7.total, { visit: 3, demo_open: 1, signup_view: 1, signup_submit: 0 });
const w30 = F.summarizeFunnel(rows, now - 30 * D);
eq("30 يومًا: المجموع", w30.total, { visit: 4, demo_open: 1, signup_view: 1, signup_submit: 1 });

console.log(fails ? `\n${fails} فشل` : "✅ قمع الزوار: كل الحالات سليمة");
process.exit(fails ? 1 : 0);
