// Vercel Analytics: لا يخرج من المتصفح رمز رابط مالك ولا رقم سجل ولا استعلام
const { scrubUrl } = require("/tmp/b/analytics-scrub.js");
const fails = [];
const ck = (n, got, want) => { const ok = got === want; console.log(ok ? "✅" : "❌", n, ok ? "" : `— ${got}`); if (!ok) fails.push(n); };
const B = "https://app.watheqapp.com";
ck("رمز رابط المالك", scrubUrl(`${B}/o/AbCdEf1234567890xyz?x=1`), `${B}/o/:id`);
ck("UUID وhash", scrubUrl(`${B}/property/3f2a1b4c-1111-2222-3333-444455556666#t`), `${B}/property/:id`);
ck("صفحة عادية كما هي", scrubUrl(`${B}/dashboard`), `${B}/dashboard`);
ck("الاستعلام يُحذف", scrubUrl(`${B}/demo?ref=tiktok&phone=0500000000`), `${B}/demo`);
ck("رقم طويل", scrubUrl(`${B}/inv/20261234`), `${B}/inv/:id`);
ck("كلمة قصيرة لا تُمسّ", scrubUrl(`${B}/admin/reports`), `${B}/admin/reports`);
ck("نص غير رابط يعود كما هو", scrubUrl("not a url"), "not a url");
console.log(fails.length ? `❌ ${fails.length}` : "✅ analytics-scrub: 7 ✓");
process.exit(fails.length ? 1 : 0);
