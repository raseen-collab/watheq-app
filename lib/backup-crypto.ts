import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { gzipSync, gunzipSync } from "zlib";

/**
 * وثيق — تشفير النسخة الاحتياطية اليومية (22 نوفمبر 2026).
 *
 * الصيغة: "WQBK1" (5 بايت) + iv (12) + tag (16) + نص مشفّر.
 * المحتوى: JSON مضغوط gzip ثم AES-256-GCM. GCM يكشف أي تعديل على الملف
 * أو مفتاحًا خاطئًا (يرمي خطأ بدل أن يُرجع بيانات فاسدة بصمت).
 *
 * المفتاح: BACKUP_ENCRYPTION_KEY في Vercel — 32 بايت بترميز base64
 * (يولّده المالك: openssl rand -base64 32). بدون المفتاح الملف لا يُقرأ،
 * فيُحفظ المفتاح أيضًا خارج Vercel (مدير كلمات المرور).
 */
const MAGIC = Buffer.from("WQBK1", "ascii");

export function parseKey(b64: string | undefined): Buffer {
  const k = Buffer.from(String(b64 || "").trim(), "base64");
  if (k.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY يجب أن يكون 32 بايت بترميز base64 (openssl rand -base64 32)");
  return k;
}

export function encryptBackup(json: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(gzipSync(Buffer.from(json, "utf8"))), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function decryptBackup(file: Buffer, key: Buffer): string {
  if (file.length < 33 || !file.subarray(0, 5).equals(MAGIC)) throw new Error("ليس ملف نسخة وثيق (WQBK1)");
  const iv = file.subarray(5, 17), tag = file.subarray(17, 33);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(file.subarray(33)), d.final()]); // يرمي إن تغيّر الملف أو المفتاح خاطئ
  return gunzipSync(plain).toString("utf8");
}
