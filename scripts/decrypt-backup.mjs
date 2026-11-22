#!/usr/bin/env node
/**
 * وثيق — فك نسخة احتياطية يومية (.wqbk) إلى JSON مقروء.
 *
 *   BACKUP_ENCRYPTION_KEY='...' node scripts/decrypt-backup.mjs 2026-11-22.wqbk > backup.json
 *
 * الصيغة: "WQBK1" + iv(12) + tag(16) + AES-256-GCM(gzip(JSON)) — نفس lib/backup-crypto.ts.
 * مفتاح خاطئ أو ملف معدَّل = خطأ صريح، لا بيانات فاسدة.
 */
import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";

const path = process.argv[2];
if (!path) { console.error("الاستخدام: BACKUP_ENCRYPTION_KEY=... node scripts/decrypt-backup.mjs <file.wqbk>"); process.exit(2); }
const key = Buffer.from(String(process.env.BACKUP_ENCRYPTION_KEY || "").trim(), "base64");
if (key.length !== 32) { console.error("BACKUP_ENCRYPTION_KEY مفقود أو ليس 32 بايت base64"); process.exit(2); }
const f = readFileSync(path);
if (f.length < 33 || f.subarray(0, 5).toString("ascii") !== "WQBK1") { console.error("ليس ملف نسخة وثيق"); process.exit(1); }
const d = createDecipheriv("aes-256-gcm", key, f.subarray(5, 17));
d.setAuthTag(f.subarray(17, 33));
let plain;
try { plain = Buffer.concat([d.update(f.subarray(33)), d.final()]); }
catch { console.error("فشل فك التشفير: المفتاح خاطئ أو الملف تغيّر"); process.exit(1); }
const json = gunzipSync(plain).toString("utf8");
const meta = JSON.parse(json);
console.error(`نسخة ${meta.day} · ${Object.keys(meta.counts).length} جدول · ${Object.values(meta.counts).reduce((s, n) => s + n, 0)} صف · ${meta.complete ? "كاملة" : "ناقصة: " + meta.failed.join(" | ")}`);
process.stdout.write(json);
