/* رسائل الخطأ للعميل (24 نوفمبر 2026 — تقييم التجربة: ٣٣ رسالة «شغّل schema» وأخطاء إنجليزية خام)
   تشغيل: npx esbuild lib/friendlyError.ts --bundle --format=cjs --platform=node --external:@sentry/nextjs --outfile=/tmp/b/friendlyError.js && node tests/friendly-error.js */
const Module = require("module"); const fs = require("fs"); const path = require("path");
let sentry = 0;
const orig = Module._load;
Module._load = function (r, ...a) { if (r === "@sentry/nextjs") return { captureMessage() { sentry++; } }; return orig.call(this, r, ...a); };
const { friendlyError, systemGap, SYSTEM_GAP_MSG } = require("/tmp/b/friendlyError.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const latin = (s) => /[A-Za-z]{4,}/.test(s.replace(/0550165210/g, ""));

t("arabic passes through", friendlyError("هذا الإجراء يحتاج صلاحية") === "هذا الإجراء يحتاج صلاحية");
t("rls → permission", /صلاحية/.test(friendlyError("new row violates row-level security policy for table payments")));
t("network → connection", /الاتصال/.test(friendlyError({ message: "Failed to fetch" })));
t("jwt → session", /الجلسة/.test(friendlyError("JWT expired")));
t("duplicate", /موجود/.test(friendlyError("duplicate key value violates unique constraint")));
const before = sentry;
const unk = friendlyError('relation "payments_x" does not exist');
t("unknown: no English shown", !latin(unk));
t("unknown: reported to Sentry", sentry === before + 1);
t("empty → generic arabic", !latin(friendlyError("")) && friendlyError("").length > 5);
t("systemGap message is customer language", systemGap("X:1", "function foo does not exist") === SYSTEM_GAP_MSG && !/schema|Supabase|شغّل/.test(SYSTEM_GAP_MSG));

/* حارس: لا نص ظاهر للعميل يطلب «تشغيل schema» أو يذكر Supabase (التعليقات وصفحات الإدارة مستثناة) */
const root = path.join(__dirname, "..");
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!/node_modules|admin|\.next/.test(p)) walk(p); } else if (/\.tsx$/.test(f)) files.push(p); } };
walk(path.join(root, "components")); walk(path.join(root, "app"));
const lit = /"(?:[^"\\\n]|\\.)*?(?:شغّل (?:ملف )?schema|schema-v\d+[^"]*في Supabase)(?:[^"\\\n]|\\.)*?"|`[^`]*?شغّل (?:ملف )?schema[^`]*?`/;
const offenders = [];
for (const f of files) fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
  const s = l.trim(); if (s.startsWith("//") || s.startsWith("/*") || s.startsWith("*")) return;
  if (lit.test(l)) offenders.push(`${path.relative(root, f)}:${i + 1}`);
});
t(`no "شغّل schema" text shown to customers (${offenders.slice(0, 5).join(", ")})`, offenders.length === 0);

console.log(`${ok} ✓ · ${bad} ✗`);
process.exit(bad ? 1 : 0);
