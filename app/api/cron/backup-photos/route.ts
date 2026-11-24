import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { sendTelegram, tgSendDocument } from "@/lib/telegram";
import { noStoreFetch } from "@/lib/no-store-fetch";
import { BUCKET, isOffsiteDay, riyadhToday } from "@/lib/backup";
import { encryptBackup, parseKey } from "@/lib/backup-crypto";
import { bundleJson, chunkBySize, runPhotoMirror } from "@/lib/backup-photos";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * نسخ صور الصيانة والمعروضات احتياطيًّا — Vercel Cron يوميًّا بعد نسخة الجداول.
 * محمي بـ CRON_SECRET، ومشفّر بنفس BACKUP_ENCRYPTION_KEY.
 *   يوميًّا: مرآة مشفّرة في «backups/photos/» (الجديد والمتغيّر فقط)
 *   الجمعة: صور الأسبوع حزمًا مشفّرة إلى تليجرام المالك (خارج Supabase)
 * ‎?offsite=1 يفرض الإرسال يدويًّا.
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
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }

  const db = createAdmin(url, serviceKey, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
  const day = riyadhToday();
  const started = Date.now();
  try {
    const r = await runPhotoMirror(db, BUCKET, key, day, { budgetMs: 35_000 });

    /* الجمعة: صور الأسبوع إلى تليجرام — من المصدر، حزمًا ≤30MB */
    let offsite: { parts: number; sent: number; files: number } | null = null;
    const force = new URL(req.url).searchParams.get("offsite") === "1";
    if (admin && (force || isOffsiteDay(day)) && r.newThisWeek.length) {
      const parts = chunkBySize(r.newThisWeek);
      let sent = 0;
      for (let i = 0; i < parts.length; i++) {
        if (Date.now() - started > 52_000) break; // الباقي يُرسل يدويًّا بـ ?offsite=1
        const files: { bucket: string; path: string; data: Buffer }[] = [];
        for (const f of parts[i]) {
          const { data } = await db.storage.from(f.bucket).download(f.path);
          if (data) files.push({ bucket: f.bucket, path: f.path, data: Buffer.from(await data.arrayBuffer()) });
        }
        const enc = encryptBackup(bundleJson(files, { day, part: i + 1, of: parts.length }), key);
        const res = await tgSendDocument(admin, enc, `watheq-photos-${day}-${i + 1}of${parts.length}.wqph`,
          `🖼 <b>صور وثيق — الأسبوع</b> ${day} · حزمة ${i + 1}/${parts.length} · ${files.length} صورة\nمشفّرة بنفس مفتاح النسخة. احتفظ بها هنا.`);
        if (res.ok) sent++;
      }
      offsite = { parts: parts.length, sent, files: r.newThisWeek.length };
      if (sent < parts.length) await alert(`⚠️ صور ${day}: أُرسلت ${sent} من ${parts.length} حزم إلى تليجرام. الباقي: افتح /api/cron/backup-photos?offsite=1`);
    }

    if (r.failed.length) {
      Sentry.captureMessage(`photo backup partial: ${r.failed.slice(0, 5).join(" | ")}`, { level: "warning", tags: { job: "backup-photos" } });
      await alert(`⚠️ نسخ الصور ${day}: تعذّر ${r.failed.length} ملف.\n${r.failed.slice(0, 5).map((f) => "• " + f.replace(/[<>&]/g, "")).join("\n")}`);
    }
    return NextResponse.json({ ok: true, day, ...r, newThisWeek: r.newThisWeek.length, offsite });
  } catch (e: any) {
    Sentry.captureException(e, { tags: { job: "backup-photos" } });
    await alert(`🛑 نسخ الصور ${day} <b>فشل</b>: ${String(e?.message || e).replace(/[<>&]/g, "").slice(0, 300)}`);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
