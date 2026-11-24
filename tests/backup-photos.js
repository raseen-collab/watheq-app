/* نسخ الصور احتياطيًّا (24 نوفمبر 2026)
   تشغيل: npx esbuild lib/backup-photos.ts --bundle --format=cjs --platform=node --alias:@=. --external:@supabase/supabase-js --outfile=/tmp/b/backupPhotos.js
          npx esbuild lib/backup-crypto.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/backupCryptoP.js
          node tests/backup-photos.js */
const P = require("/tmp/b/backupPhotos.js");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const key = crypto.randomBytes(32);

/* ١) planMirror */
{
  const m = P.emptyManifest();
  const src = [{ bucket: "maintenance-photos", path: "u1/r1/before/a.jpg", size: 10, updated: "t1" }];
  let p = P.planMirror(src, m, "2026-11-24");
  t("جديد يُنسخ", p.toCopy.length === 1 && !p.missing.length);
  m.entries["maintenance-photos/u1/r1/before/a.jpg"] = { size: 10, updated: "t1", sha256: "x", copied_at: "2026-11-24" };
  p = P.planMirror(src, m, "2026-11-25");
  t("بلا تغيير لا يُنسخ", p.toCopy.length === 0);
  p = P.planMirror([{ ...src[0], size: 11 }], m, "2026-11-25");
  t("تغيّر الحجم يُنسخ", p.toCopy.length === 1);
  p = P.planMirror([], m, "2026-11-25");
  t("غاب: يُعلَّم ولا يُحذف", p.missing.length === 1 && !p.toDelete.length);
  m.entries["maintenance-photos/u1/r1/before/a.jpg"].missing_since = "2026-11-25";
  p = P.planMirror([], m, "2026-12-20");
  t("غائب 25 يومًا: يبقى", !p.toDelete.length && !p.missing.length);
  p = P.planMirror([], m, "2026-12-26");
  t("غائب 31 يومًا: يُحذف", p.toDelete.length === 1);
  p = P.planMirror(src, m, "2026-12-01");
  t("عاد للمصدر: تُزال العلامة", p.restored.length === 1 && !p.toCopy.length);
}

/* ٢) chunkBySize */
{
  const c = P.chunkBySize([{ size: 10 }, { size: 15 }, { size: 10 }, { size: 50 }, { size: 1 }], 25);
  t("التقسيم", JSON.stringify(c.map((x) => x.map((y) => y.size))) === JSON.stringify([[10, 15], [10], [50], [1]]));
}

/* ٣) runPhotoMirror بدلو وهمي + الاسترجاع بالسكربت */
async function main() {
  const store = { "maintenance-photos": {}, "listing-photos": null, backups: {} }; // listing-photos غير موجود
  const img = (s) => crypto.createHash("sha256").update(s).digest().subarray(0, 20 + s.length);
  store["maintenance-photos"]["u1/r1/before/1.jpg"] = { data: img("a"), updated: "2026-11-05T10:00:00Z" };
  store["maintenance-photos"]["u1/r1/after/2.jpg"] = { data: img("bb"), updated: "2026-11-05T11:00:00Z" };
  store["maintenance-photos"]["u2/r9/before/3.jpg"] = { data: img("ccc"), updated: "2026-11-06T09:00:00Z" };
  const blob = (b) => ({ arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) });
  const db = { storage: { from(bucket) { return {
    async list(dir, { offset }) {
      const s = store[bucket];
      if (s === null) return { data: null, error: { message: "Bucket not found" } };
      if (offset) return { data: [], error: null };
      const pre = dir ? dir + "/" : "";
      const names = new Map();
      for (const k of Object.keys(s)) if (k.startsWith(pre)) {
        const rest = k.slice(pre.length), i = rest.indexOf("/");
        if (i < 0) names.set(rest, { name: rest, id: "f", updated_at: s[k].updated, metadata: { size: s[k].data.length, mimetype: "image/jpeg" } });
        else names.set(rest.slice(0, i), { name: rest.slice(0, i), id: null });
      }
      return { data: [...names.values()], error: null };
    },
    async download(p) { const s = store[bucket]; return s && s[p] ? { data: blob(s[p].data), error: null } : { data: null, error: { message: "Object not found" } }; },
    async upload(p, buf) { store[bucket][p] = { data: Buffer.from(buf), updated: "now" }; return { error: null }; },
    async remove(ps) { for (const p of ps) delete store[bucket][p]; return { error: null }; },
  }; } } };

  let r = await P.runPhotoMirror(db, "backups", key, "2026-11-24");
  t("أول تشغيل: 3 صور", r.sources === 3 && r.copied === 3 && !r.failed.length && r.pending === 0);
  t("السجل والمرايا محفوظة", !!store.backups["photos/manifest.wqph"] && Object.keys(store.backups).length === 4);
  t("الجديد هذا الأسبوع 3", r.newThisWeek.length === 3);
  const enc = store.backups["photos/maintenance-photos/u1/r1/after/2.jpg.wqph"].data;
  t("المرآة مشفّرة (لا نص الصورة)", !enc.includes(img("bb")));
  const back = P.readBundle(enc, key);
  t("فك المرآة يطابق الأصل", back.length === 1 && back[0].data.equals(img("bb")));

  r = await P.runPhotoMirror(db, "backups", key, "2026-11-25");
  t("تشغيل ثانٍ بلا تغيير: لا نسخ", r.copied === 0);

  delete store["maintenance-photos"]["u2/r9/before/3.jpg"]; // حُذف الحساب u2
  r = await P.runPhotoMirror(db, "backups", key, "2026-11-26");
  t("الغائب يُعلَّم ومرآته باقية", r.marked_missing === 1 && !!store.backups["photos/maintenance-photos/u2/r9/before/3.jpg.wqph"]);
  r = await P.runPhotoMirror(db, "backups", key, "2026-12-27");
  t("بعد 30 يومًا تُحذف المرآة", r.deleted === 1 && !store.backups["photos/maintenance-photos/u2/r9/before/3.jpg.wqph"]);

  /* حدّ الوقت: لا يُنسخ شيء إن انتهت الميزانية، ويبقى معلّقًا للغد */
  store["maintenance-photos"]["u1/r2/before/4.jpg"] = { data: img("dddd"), updated: "2026-12-28T00:00:00Z" };
  let clock = 0;
  r = await P.runPhotoMirror(db, "backups", key, "2026-12-28", { budgetMs: 10, now: () => (clock += 100) });
  t("ميزانية الوقت: معلّق للغد", r.copied === 0 && r.pending === 1);
  r = await P.runPhotoMirror(db, "backups", key, "2026-12-29");
  t("الغد يكمل", r.copied === 1 && r.pending === 0);

  /* الاسترجاع بالسكربت الحقيقي (حزمة أسبوعية + مرآة + السجل) */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wqph-"));
  const weekly = require("/tmp/b/backupCryptoP.js").encryptBackup(P.bundleJson([
    { bucket: "maintenance-photos", path: "u1/r1/before/1.jpg", data: img("a") },
    { bucket: "maintenance-photos", path: "../../etc/evil", data: Buffer.from("x") },
  ]), key);
  fs.writeFileSync(path.join(dir, "w.wqph"), weekly);
  fs.writeFileSync(path.join(dir, "m.wqph"), store.backups["photos/maintenance-photos/u1/r1/after/2.jpg.wqph"].data);
  fs.writeFileSync(path.join(dir, "manifest.wqph"), store.backups["photos/manifest.wqph"].data);
  const out = path.join(dir, "out");
  execFileSync("node", [path.join(__dirname, "../scripts/restore-photos.mjs"), out, path.join(dir, "w.wqph"), path.join(dir, "m.wqph"), path.join(dir, "manifest.wqph")],
    { env: { ...process.env, BACKUP_ENCRYPTION_KEY: key.toString("base64") }, stdio: "pipe" });
  t("السكربت استرجع الصورتين", fs.readFileSync(path.join(out, "maintenance-photos/u1/r1/before/1.jpg")).equals(img("a"))
    && fs.readFileSync(path.join(out, "maintenance-photos/u1/r1/after/2.jpg")).equals(img("bb")));
  t("مسار خبيث لا يُكتب خارج المجلد", !fs.existsSync(path.join(dir, "etc/evil")) && !fs.existsSync(path.resolve(out, "../../etc/evil")));
  let threw = false;
  try { execFileSync("node", [path.join(__dirname, "../scripts/restore-photos.mjs"), out, path.join(dir, "w.wqph")], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64") }, stdio: "pipe" }); }
  catch { threw = true; }
  t("مفتاح خاطئ = خطأ صريح", threw);

  console.log(`backup-photos: ${ok} ✓ · ${bad} ✗`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
