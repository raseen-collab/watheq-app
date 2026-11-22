/* دليل الفنيين (22 نوفمبر 2026)
   تشغيل: npx esbuild lib/maintenance.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/maint.js
          node tests/maint-vendors.js */
const { vendorsFor, cleanVendor } = require("/tmp/b/maint.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const V = [
  { id: "1", name: "ياسر", phone: "0500000001", specialty: "electric", notes: null, active: true },
  { id: "2", name: "أحمد", phone: "0500000002", specialty: "plumbing", notes: null, active: true },
  { id: "3", name: "بدر", phone: null, specialty: "general", notes: null, active: true },
  { id: "4", name: "سالم", phone: null, specialty: "plumbing", notes: null, active: false },
  { id: "5", name: "تركي", phone: null, specialty: "ac", notes: null, active: true },
];
const ids = (c) => vendorsFor(c, V).map((v) => v.id).join(",");
t("plumbing first, then general, inactive hidden", ids("plumbing") === "2,3,5,1");
t("electric first", ids("electric").startsWith("1,3"));
t("other category: general first then by name", ids("other") === "3,2,5,1");
t("null category ok", ids(null) === "3,2,5,1");
t("inactive never listed", !ids("plumbing").includes("4"));
t("name required", !cleanVendor({ name: " " }).ok);
t("name trimmed/collapsed", cleanVendor({ name: "  أبو   محمد " }).row.name === "أبو محمد");
t("arabic digits phone", cleanVendor({ name: "فني", phone: "٠٥٥١٢٣٤٥٦٧" }).row.phone === "0551234567");
t("bad phone rejected", !cleanVendor({ name: "فني", phone: "12" }).ok);
t("empty phone → null", cleanVendor({ name: "فني", phone: "" }).row.phone === null);
t("unknown specialty → other", cleanVendor({ name: "فني", specialty: "x" }).row.specialty === "other");
t("notes cut 300", cleanVendor({ name: "فني", notes: "ن".repeat(500) }).row.notes.length === 300);
console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0);
