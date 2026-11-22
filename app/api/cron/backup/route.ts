import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createHash } from "crypto";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { sendTelegram } from "@/lib/telegram";
import { noStoreFetch } from "@/lib/no-store-fetch";
import { BUCKET, buildBackup, expiredDaily, riyadhToday } from "@/lib/backup";
import { encryptBackup, parseKey } from "@/lib/backup-crypto";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const MAX_BYTES = 45 * 1024 * 1024; // حد رفع Storage الافتراضي 50MB — نُنذر قبله

/**
 * النسخة الاحتياطية اليومية — Vercel Cron (vercel.json). محمي بـ CRON_SECRET.
 * القاعدة كاملة ← JSON ← gzip ← AES-256-GCM ← Storage «backups» (خاص).
 *   daily/YYYY-MM-DD.wqbk   تُحذف بعد 30 يومًا
 *   monthly/YYYY-MM.wqbk    نسخة أول كل شهر — تبقى
 * فك التشفير: scripts/decrypt-backup.mjs
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = process.env.ADMIN_TELEGRAM_CHAT_ID;
  const alert = async (text: string) => { if (admin) { try { await sendTelegram(admin, text); } catch { /* */ } } };

  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: "إعدادات ناقصة" }, { status: 500 });
  let key: Buffer;
  try { key = parseKey(process.env.BACKUP_ENCRYPTION_KEY); }
  catch (e: any) {
    await alert("⚠️ النسخة الاحتياطية لم تُنشأ: BACKUP_ENCRYPTION_KEY غير مضبوط في Vercel أو طوله خاطئ.");
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }

  const db = createAdmin(url, serviceKey, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
  const day = riyadhToday();
  try {
    const b = await buildBackup(db, url, serviceKey);
    const file = encryptBackup(b.json, key);
    if (file.length > MAX_BYTES) throw new Error(`حجم النسخة ${(file.length / 1048576).toFixed(1)}MB يقترب من حد الرفع 50MB`);
    const sha = createHash("sha256").update(file).digest("hex").slice(0, 16);

    const put = async (path: string) => {
      const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: "application/octet-stream", upsert: true });
      if (error) throw new Error(`رفع ${path}: ${error.message}`);
    };
    await put(`daily/${day}.wqbk`);
    if (day.endsWith("-01")) await put(`monthly/${day.slice(0, 7)}.wqbk`);

    /* التنظيف بعد نجاح الرفع فقط — لا نحذف القديم ثم نفشل في كتابة الجديد */
    let pruned = 0;
    const { data: list, error: lerr } = await db.storage.from(BUCKET).list("daily", { limit: 1000 });
    if (!lerr && list) {
      const old = expiredDaily(list.map((f) => f.name), day);
      if (old.length) {
        const { error: rerr } = await db.storage.from(BUCKET).remove(old.map((n) => `daily/${n}`));
        if (!rerr) pruned = old.length;
      }
    }

    const rows = Object.values(b.counts).reduce((s, n) => s + n, 0);
    if (b.failed.length) {
      Sentry.captureMessage(`backup partial: ${b.failed.join(" | ")}`, { level: "warning", tags: { job: "backup" } });
      await alert(`⚠️ النسخة الاحتياطية ${day} <b>ناقصة</b>: تعذّر ${b.failed.length} جدول.\n${b.failed.slice(0, 5).map((f) => "• " + f.replace(/[<>&]/g, "")).join("\n")}`);
    }
    return NextResponse.json({
      ok: true, complete: b.failed.length === 0, day, bytes: file.length, sha256_16: sha,
      tables: Object.keys(b.counts).length, rows, pruned, unordered: b.unordered, failed: b.failed,
    });
  } catch (e: any) {
    Sentry.captureException(e, { tags: { job: "backup" } });
    await alert(`🛑 النسخة الاحتياطية ${day} <b>فشلت</b>: ${String(e?.message || e).replace(/[<>&]/g, "").slice(0, 300)}`);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
