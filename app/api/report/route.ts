import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase-server";
import { createClient as admin } from "@supabase/supabase-js";
import { sendTelegram } from "@/lib/telegram";
import { cleanReport } from "@/lib/problem-report";

export const dynamic = "force-dynamic";

/**
 * «بلّغ عن مشكلة» (22 نوفمبر 2026).
 * المستخدم يكتب سطرًا، والصفحة والجهاز ونسخة التطبيق تُرفق تلقائيًّا.
 * الجلسة شرط (لا بلاغات مجهولة)، والمعدّل مقيَّد، والكتابة بمفتاح الخادم
 * في جدول لا يقرؤه أي مستخدم (schema-v93). وتنبيه تليجرام لمالك وثيق.
 */
const RATE = new Map<string, { n: number; t: number }>();
const WINDOW = 10 * 60_000, MAX = 5;

export async function POST(req: Request) {
  let uid: string | null = null;
  let email = "";
  try {
    const { data } = await createClient().auth.getUser();
    uid = data?.user?.id ?? null;
    email = data?.user?.email ?? "";
  } catch { /* */ }
  if (!uid) return NextResponse.json({ ok: false, error: "سجّل الدخول أولًا." }, { status: 401 });

  const now = Date.now();
  const cur = RATE.get(uid);
  if (cur && now - cur.t < WINDOW) {
    if (cur.n >= MAX) return NextResponse.json({ ok: false, error: "أرسلت بلاغات كثيرة للتو — جرّب بعد دقائق، أو راسلنا على واتساب." }, { status: 429 });
    cur.n++;
  } else RATE.set(uid, { n: 1, t: now });
  if (RATE.size > 5000) RATE.clear();

  const body = await req.json().catch(() => null);
  const r = cleanReport(body, req.headers.get("user-agent"));
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "تعذّر الإرسال الآن — راسلنا على واتساب." }, { status: 500 });
  const db = admin(url, key, { auth: { persistSession: false } });
  const version = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null;

  const { error } = await db.from("problem_reports").insert({ user_id: uid, ...r.row, app_version: version });
  if (error) {
    Sentry.captureMessage("problem_reports insert: " + error.message, { level: "error" });
    return NextResponse.json({ ok: false, error: "تعذّر حفظ البلاغ — راسلنا على واتساب 0550165210." }, { status: 500 });
  }

  const chat = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (chat) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    try {
      await sendTelegram(chat, [
        "🐞 <b>بلاغ مشكلة جديد</b>",
        esc(r.row.message.slice(0, 600)),
        "",
        `👤 ${esc(email || uid)}`,
        `📍 ${esc(r.row.path || "—")} · ${esc(r.row.viewport || "")}`,
        r.row.sentry_event ? `🧾 Sentry: ${esc(r.row.sentry_event)}` : "",
        `🔖 ${version || "—"}`,
      ].filter(Boolean).join("\n"));
    } catch { /* التنبيه ثانوي — البلاغ محفوظ */ }
  }
  return NextResponse.json({ ok: true });
}
