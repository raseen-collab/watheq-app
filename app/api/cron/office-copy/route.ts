import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import * as XLSX from "xlsx";
import { zipSync, strToU8 } from "fflate";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { tgSendDocument, sendTelegram } from "@/lib/telegram";
import { noStoreFetch } from "@/lib/no-store-fetch";
import { OFFICE_TABLES, collectOffice, cellValue, copyDue, readmeText, riyadhMonth } from "@/lib/office-copy";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const TG_LIMIT = 45 * 1024 * 1024;

/**
 * (24 نوفمبر 2026) النسخة الشهرية الكاملة لكل صاحب مكتب ربط تليجرام — lib/office-copy.
 *
 * يعمل يوميًّا (vercel.json) ويرسل لمن لم يستلم نسخة هذا الشهر بعد (profiles.office_copy_at — v104):
 * فالأول من الشهر يرسل للجميع، وما تعذّر (مهلة/خطأ/تليجرام) يُعاد في اليوم التالي تلقائيًّا.
 * محمي بـ CRON_SECRET. ‎?office=<id> لمكتب واحد (تجربة يدوية، بالسر نفسه).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "إعدادات ناقصة" }, { status: 500 });
  const db = createAdmin(url, key, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
  const started = Date.now(), month = riyadhMonth();
  const only = new URL(req.url).searchParams.get("office");

  let q = db.from("profiles").select("id, org_name, full_name, telegram_chat_id, office_copy_at").not("telegram_chat_id", "is", null);
  if (only) q = q.eq("id", only);
  const { data: profs, error } = await q.limit(1000);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const due = (profs || []).filter((p: any) => only || copyDue(p.office_copy_at));
  const out: any[] = [];
  for (const p of due as any[]) {
    if (Date.now() - started > 45_000) { out.push({ id: p.id, skipped: "time" }); continue; }   // البقية غدًا
    try {
      const c = await collectOffice(db, p.id);
      const rows = Object.values(c.counts).reduce((s, n) => s + n, 0);
      /* حساب موظف أو حساب فارغ: لا شيء يُرسل — لكن يُعلَّم حتى لا يُعاد كل يوم */
      if ((c.counts.properties || 0) + (c.counts.associations || 0) + (c.counts.listings || 0) === 0) {
        await db.from("profiles").update({ office_copy_at: new Date().toISOString() }).eq("id", p.id);
        out.push({ id: p.id, empty: true }); continue;
      }
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      for (const spec of OFFICE_TABLES) {
        const list = c.tables[spec.table] || [];
        if (!list.length) continue;
        const cols = Array.from(new Set(list.flatMap((r) => Object.keys(r))));
        const aoa = [cols, ...list.map((r) => cols.map((k) => cellValue(r[k])))];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), spec.ar.slice(0, 31));
      }
      const org = p.org_name || p.full_name || "مكتبك";
      const readme = readmeText(org, month, c.counts, c.failed);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme.split("\n").map((l) => [l])), "اقرأني");
      const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const json = JSON.stringify({ format: "watheq-office-copy", version: 1, office: p.id, month, generated_at: new Date().toISOString(),
        counts: c.counts, failed: c.failed, tables: c.tables });
      const zip = Buffer.from(zipSync({
        "اقرأني.txt": strToU8(readme), "watheq-copy.xlsx": new Uint8Array(xlsx), "watheq-copy.json": strToU8(json),
      }, { level: 6 }));
      if (zip.length > TG_LIMIT) {
        await sendTelegram(p.telegram_chat_id, `📦 نسختك الشهرية من وثيق (${month}) أكبر من حد تليجرام. صدّرها من الإعدادات ← تصدير بياناتي، أو راسلنا على واتساب 0550165210 ونرسلها لك.`);
        out.push({ id: p.id, tooBig: zip.length }); continue;
      }
      const r = await tgSendDocument(p.telegram_chat_id, zip, `watheq-${month}.zip`,
        `📦 <b>نسختك الشهرية من وثيق</b> — ${month}\nكل ما أُدخل في حسابك من كل الموظفين: ${rows.toLocaleString("en-US")} سطر.\nاحفظ الملف في مكان آمن — فيه بيانات مستأجريك.`);
      if (!r.ok) { out.push({ id: p.id, telegram: false }); continue; }   // لا نعلّم: يُعاد غدًا
      if (!c.failed.length) await db.from("profiles").update({ office_copy_at: new Date().toISOString() }).eq("id", p.id);
      out.push({ id: p.id, sent: true, rows, bytes: zip.length, partial: c.failed.length > 0 });
    } catch (e: any) {
      Sentry.captureException(e, { tags: { job: "office-copy" } });
      out.push({ id: p.id, error: String(e?.message || e).slice(0, 160) });
    }
  }
  return NextResponse.json({ ok: true, month, due: due.length, results: out });
}
