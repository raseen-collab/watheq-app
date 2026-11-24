/* نوافذ التأكيد بتصميم وثيق (24 نوفمبر 2026)
   تشغيل: npx esbuild lib/confirm.ts --bundle --format=cjs --platform=node --outfile=/tmp/b/confirm.js && node tests/confirm.js */
const { splitMessage, okLabel, wqConfirm, registerConfirmHost } = require("/tmp/b/confirm.js");
const fs = require("fs"), path = require("path");
let ok = 0, bad = 0; const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const a = splitMessage("حذف هذه الملاحظة نهائيًّا؟\n\n«نص»", "confirm");
t("title = first line", a.title === "حذف هذه الملاحظة نهائيًّا؟" && a.body === "«نص»");
t("long first line → generic title", splitMessage("x".repeat(200), "confirm").title === "تأكيد");
t("delete → red «نعم، احذف»", JSON.stringify(okLabel("حذف المصروف؟", {})) === JSON.stringify({ ok: "نعم، احذف", danger: true }));
t("undo → red", okLabel("التراجع عن آخر دفعة مسجّلة؟", {}).danger === true);
t("record → green", okLabel("تسجيل استلام 500 ريال؟", {}).danger === false);
t("emoji prefix ignored", okLabel("⚠️ حذف الوحدة؟", {}).ok === "نعم، احذف");
t("unsaved → discard label", okLabel("لديك إدخال لم يُحفظ في هذه النافذة.", {}).ok === "نعم، تجاهل ما أدخلته");
t("fallback", okLabel("متابعة الإضافة على أي حال؟", {}).ok === "نعم، تابع");
(async () => {
  let got = null; const off = registerConfirmHost((r) => { got = r; r.resolve(false); });
  const v = await wqConfirm("حذف؟"); t("host receives and resolves", got && got.kind === "confirm" && v === false); off();
  /* حارس: لا confirm()/alert() للمتصفح في واجهة المكاتب */
  const root = path.join(__dirname, ".."); const offenders = [];
  for (const d of ["components", "app"]) (function walk(dir) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (!/admin|node_modules/.test(p)) walk(p); continue; } if (!/\.tsx$/.test(f)) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => { const s = l.trim(); if (/^(\/\/|\*|\/\*)/.test(s)) return;
      if (/(?<![\w.])(window\.)?(confirm|alert)\(/.test(l)) offenders.push(`${path.relative(root, p)}:${i + 1}`); }); } })(path.join(root, d));
  t(`no native confirm()/alert() (${offenders.slice(0, 4).join(", ")})`, offenders.length === 0);
  console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0);
})();
