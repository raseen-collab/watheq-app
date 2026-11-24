/* مساعدات التصدير (24 نوفمبر 2026)
   تشغيل: npx esbuild lib/export-extras.ts --bundle --format=cjs --platform=node --outfile=/tmp/b/exportExtras.js && node tests/export-extras.js */
const { atRiyadh, diffEdit, zipPath, auditSubject, AUDIT_TABLE_AR } = require("/tmp/b/exportExtras.js");
const { zipSync, unzipSync, strFromU8 } = require("fflate");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };

t("UTC 15:40 → Riyadh 18:40", atRiyadh("2026-11-23T15:40:00Z") === "2026-11-23 18:40");
t("crosses midnight", atRiyadh("2026-11-23T22:30:00+00:00") === "2026-11-24 01:30");
t("midnight is 00 not 24", atRiyadh("2026-11-23T21:05:00Z") === "2026-11-24 00:05");
t("empty", atRiyadh(null) === "" && atRiyadh("") === "");
t("garbage", atRiyadh("not a date") === "");

const M = { cash: "نقدًا", transfer: "تحويل بنكي" };
t("diff amount+method", diffEdit({ amount: 1000, method: "cash", note: "x" }, { amount: 1200, method: "transfer", note: "x" }, M)
  === "المبلغ: 1000 ← 1200 · الطريقة: نقدًا ← تحويل بنكي");
t("diff added reference", diffEdit({ reference: null }, { reference: "TRX9" }, M) === "مرجع الحوالة: — ← TRX9");
t("diff no change", diffEdit({ amount: 5 }, { amount: 5 }) === "بلا تغيير ظاهر");
t("diff unknown key kept raw", /foo: 1 ← 2/.test(diffEdit({ foo: 1 }, { foo: 2 })));
t("diff null inputs", diffEdit(null, null) === "بلا تغيير ظاهر");

const p = zipPath("برج النخيل / جدة", "12", "2026-11-20", "1a2b3c4d-9999", "before-1.jpg");
t("zip path shape", p === "برج النخيل - جدة/وحدة 12 — 2026-11-20 — 1a2b3c4d/قبل-before-1.jpg");
t("after side", zipPath("ع", null, "2026-01-01", "abcdefgh", "after-2.jpg").endsWith("/بعد-after-2.jpg"));
t("no unit", zipPath("ع", null, "2026-01-01", "abcdefgh", "after-2.jpg").split("/")[1] === "2026-01-01 — abcdefgh");
t("illegal chars stripped", !/[:*?"<>|]/.test(zipPath('a:b*c?', 'u"1', "d", "id", "before-x.jpg")));
t("exactly 3 segments", zipPath("a/b/c", "x/y", "d", "id", "before-1.jpg").split("/").length === 3);

/* أسماء عربية تبقى سليمة داخل ZIP (علَم UTF-8) */
const z = zipSync({ [p]: new Uint8Array([1, 2, 3]) }, { level: 0 });
const back = unzipSync(z);
t("arabic name round-trips in zip", Object.keys(back)[0] === p && back[p].length === 3);
const flags = z[6] | (z[7] << 8);
t("zip UTF-8 flag set (bit 11)", (flags & 0x800) !== 0);

t("audit subject payment", auditSubject({ new_row: { property_id: "p1", receipt_no: "RC-00012", amount: 1200 } }, { p1: "برج النخيل" }) === "برج النخيل — RC-00012 — 1,200 ريال");
t("audit subject tenant update merges old", auditSubject({ old_row: { property_id: "p1", unit: "12", name: "محمد", phone: "05" }, new_row: { phone: "06" } }, { p1: "ع" }) === "ع — وحدة 12 — محمد");
t("audit tables arabic", AUDIT_TABLE_AR.payments === "الدفعات" && Object.keys(AUDIT_TABLE_AR).length === 26);
console.log(`${ok} ✓ · ${bad} ✗`);
process.exit(bad ? 1 : 0);
