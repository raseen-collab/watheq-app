import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "@/lib/telegram";
import { noStoreFetch } from "@/lib/no-store-fetch";
import { supportWeeklyText, type HQ, type FB, type PR } from "@/lib/support-weekly";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 30;

const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * تقرير الدعم الأسبوعي — كل أحد 9 صباحًا بتوقيت الرياض (vercel.json) إلى ADMIN_TELEGRAM_CHAT_ID.
 * محمي بـ CRON_SECRET (ترويسة فقط). يقرأ فقط — لا يكتب شيئًا.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, chat = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!url || !key || !chat) return NextResponse.json({ ok: false, error: "إعدادات ناقصة" }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });

  try {
    const now = new Date(), since = new Date(now.getTime() - 7 * 86400000).toISOString();
    const [hq, fb, rep, open, adv] = await Promise.all([
      db.from("help_queries").select("question, answered, via, matched_id, created_at").gte("created_at", since).limit(2000),
      db.from("help_feedback").select("question, helpful, matched_id, created_at").gte("created_at", since).limit(2000),
      db.from("problem_reports").select("message, status, path, created_at").gte("created_at", since).limit(500),
      db.from("problem_reports").select("message, status, path, created_at").neq("status", "done").order("created_at", { ascending: false }).limit(50),
      db.from("advisor_log").select("id", { count: "exact", head: true }).gte("created_at", since),
    ]);
    const err = hq.error || fb.error || rep.error || open.error;
    if (err) throw new Error(err.message);
    const text = supportWeeklyText({
      hq: (hq.data || []) as HQ[], fb: (fb.data || []) as FB[], reports: (rep.data || []) as PR[], openReports: (open.data || []) as PR[],
      advisorCount: adv.count || 0, from: day(new Date(since)), to: day(now),
    });
    await sendTelegram(chat, text);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    Sentry.captureException(e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
