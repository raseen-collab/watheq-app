#!/usr/bin/env node
/**
 * وثيق — استرجاع الصور من حزم النسخ (.wqph): مرآة Storage أو حزم تليجرام الأسبوعية.
 *
 *   فك إلى مجلد محلي (لا يلمس أي شيء على الإنترنت):
 *     BACKUP_ENCRYPTION_KEY='...' node scripts/restore-photos.mjs out-dir file1.wqph [file2.wqph ...]
 *   ينتج: out-dir/<الدلو>/<المسار> لكل صورة، بعد التحقق من sha256 لكل ملف.
 *
 *   ثم الرفع إلى Storage (عند الحاجة فقط، بيدك): ارفع محتوى out-dir/maintenance-photos
 *   إلى دلو maintenance-photos بنفس المسارات (Dashboard ← Storage، أو supabase CLI).
 *
 * الصيغة: نفس decrypt-backup.mjs — "WQBK1" + iv(12) + tag(16) + AES-256-GCM(gzip(JSON)).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createDecipheriv, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) { console.error("الاستخدام: BACKUP_ENCRYPTION_KEY=... node scripts/restore-photos.mjs <out-dir> <file.wqph>..."); process.exit(2); }
const key = Buffer.from(String(process.env.BACKUP_ENCRYPTION_KEY || "").trim(), "base64");
if (key.length !== 32) { console.error("BACKUP_ENCRYPTION_KEY مفقود أو ليس 32 بايت base64"); process.exit(2); }
const root = resolve(out);
let n = 0;
for (const p of files) {
  const f = readFileSync(p);
  if (f.length < 33 || f.subarray(0, 5).toString("ascii") !== "WQBK1") { console.error(`${p}: ليس ملف وثيق`); process.exit(1); }
  const d = createDecipheriv("aes-256-gcm", key, f.subarray(5, 17));
  d.setAuthTag(f.subarray(17, 33));
  let plain;
  try { plain = Buffer.concat([d.update(f.subarray(33)), d.final()]); }
  catch { console.error(`${p}: فشل فك التشفير — المفتاح خاطئ أو الملف تغيّر`); process.exit(1); }
  const m = JSON.parse(gunzipSync(plain).toString("utf8"));
  if (m.format === "watheq-photos-manifest") { console.error(`${p}: سجل المرآة (${Object.keys(m.entries).length} صورة) — ليس صورًا، تخطّيته`); continue; }
  if (m.format !== "watheq-photos") { console.error(`${p}: ليست حزمة صور`); process.exit(1); }
  for (const x of m.files) {
    const data = Buffer.from(x.b64, "base64");
    if (createHash("sha256").update(data).digest("hex") !== x.sha256) { console.error(`تالفة: ${x.bucket}/${x.path}`); process.exit(1); }
    const dest = resolve(join(root, x.bucket, x.path));
    if (!dest.startsWith(root + sep)) { console.error(`مسار غير آمن، تخطّيته: ${x.path}`); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    n++;
  }
}
console.error(`استُرجعت ${n} صورة إلى ${root}`);
