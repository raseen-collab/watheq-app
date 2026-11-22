// وثيق — فحص دخان على مقاس الجوال (390px) — 22 نوفمبر 2026
// يشغَّل بعد `next build` و`next start -p 3000`. يفتح صفحات لا تحتاج قاعدة بيانات
// ويتأكد: الصفحة تُحمَّل (2xx/3xx)، بلا أخطاء JavaScript، وبلا تمرير أفقي.
// تشغيل: node tests/smoke.cjs   (BASE افتراضيًّا http://localhost:3000)
const { chromium } = require("playwright");
(async () => {
const BASE = process.env.BASE || "http://localhost:3000";
const PAGES = ["/login", "/login?mode=signup", "/reset-password", "/this-page-does-not-exist"];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
let bad = 0;
for (const path of PAGES) {
  const errs = [];
  const onErr = (e) => errs.push(e.message);
  p.on("pageerror", onErr);
  const res = await p.goto(BASE + path, { waitUntil: "networkidle" }).catch((e) => ({ status: () => 0, err: e }));
  await p.waitForTimeout(300);
  const status = res?.status?.() ?? 0;
  const sw = await p.evaluate(() => document.documentElement.scrollWidth).catch(() => -1);
  const okStatus = path.includes("does-not-exist") ? status === 404 : status >= 200 && status < 400;
  const ok = okStatus && errs.length === 0 && sw <= 390;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${path} — HTTP ${status} · عرض ${sw}px · أخطاء ${errs.length}${errs.length ? ": " + errs[0] : ""}`);
  p.off("pageerror", onErr);
}
await b.close();
console.log(bad ? `✗ ${bad} صفحة فشلت` : "✓ فحص الدخان ناجح");
process.exit(bad ? 1 : 0);
})();
