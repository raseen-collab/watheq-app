/* «بلّغ عن مشكلة» — تنظيف البلاغ (22 نوفمبر 2026)
   تشغيل: npx esbuild lib/problem-report.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/problemReport.js
          node tests/problem-report.js */
const { cleanReport } = require("/tmp/b/problemReport.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const r = (b, ua) => cleanReport(b, ua);
t("empty rejected", !r({}).ok);
t("2 chars rejected", !r({ message: " ab " }).ok);
t("null body rejected", !r(null).ok);
t("non-string message rejected", !r({ message: 12345 }).ok);
const g = r({ message: "  ضغطت تسجيل دفعة وطلع خطأ  ", path: "/dashboard/property?tab=1#x", viewport: "390x844", sentry_event: "a".repeat(32) }, "Mozilla/5.0 (iPhone)");
t("ok", g.ok);
t("message trimmed", g.row.message === "ضغطت تسجيل دفعة وطلع خطأ");
t("query + hash stripped from path (tokens)", g.row.path === "/dashboard/property");
t("viewport kept", g.row.viewport === "390x844");
t("sentry id kept", g.row.sentry_event === "a".repeat(32));
t("ua from header", g.row.user_agent === "Mozilla/5.0 (iPhone)");
t("long message cut to 2000", r({ message: "x".repeat(5000) }).row.message.length === 2000);
t("external path dropped", r({ message: "abc", path: "https://evil.com/x" }).row.path === null);
t("token link path keeps only path", r({ message: "abc", path: "/l/SECRETTOKEN?k=1" }).row.path === "/l/SECRETTOKEN");
t("bad viewport dropped", r({ message: "abc", viewport: "<script>" }).row.viewport === null);
t("bad sentry id dropped", r({ message: "abc", sentry_event: "drop table" }).row.sentry_event === null);
t("control chars removed", r({ message: "ab\u0000c\u0007d" }).row.message === "abcd");
t("newlines kept", r({ message: "سطر1\nسطر2" }).row.message === "سطر1\nسطر2");
t("ua cut to 400", r({ message: "abc" }, "u".repeat(900)).row.user_agent.length === 400);
t("no ua → null", r({ message: "abc" }).row.user_agent === null);
console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0);
