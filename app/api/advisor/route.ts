import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  buildSystemPrompt, classify, DISCLAIMER,
  HIGH_RISK_REPLY, OUT_OF_SCOPE_REPLY,
} from "@/lib/advisor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** حصّة يومية حسب الباقة — تمنع تكلفة غير محسوبة */
const QUOTA: Record<string, number> = { basic: 5, pro: 40, full: 100, default: 5 };

function serviceDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  // ---------- 1) الهوية ----------
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) {
    return NextResponse.json({ ok: false, error: "سجّل الدخول أولًا." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const question = String(body?.question || "").trim();
  if (!question) {
    return NextResponse.json({ ok: false, error: "اكتب سؤالك." }, { status: 400 });
  }
  if (question.length > 600) {
    return NextResponse.json({ ok: false, error: "السؤال طويل — اختصره في 600 حرف." }, { status: 400 });
  }

  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  // ---------- 2) الإقرار بإخلاء المسؤولية (مرة واحدة) ----------
  const { data: profile } = await db
    .from("profiles").select("advisor_ack_at, account_type").eq("id", user.id).maybeSingle();
  if (!profile?.advisor_ack_at) {
    return NextResponse.json({
      ok: false, needsAck: true, disclaimer: DISCLAIMER,
      error: "يلزم الإقرار بحدود المستشار قبل الاستخدام.",
    }, { status: 403 });
  }

  // ---------- 3) الحصّة اليومية ----------
  const { count } = await db
    .from("advisor_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("asked_on", today);
  const limit = QUOTA[String(profile?.account_type || "")] ?? QUOTA.default;
  if ((count || 0) >= limit) {
    return NextResponse.json({
      ok: false, quota: true,
      error: `بلغت حدّك اليومي (${limit} أسئلة). يتجدّد غدًا.`,
    }, { status: 429 });
  }

  const log = async (answer: string, risk: string, answered: boolean) => {
    const { error } = await db.from("advisor_log").insert({
      user_id: user.id, asked_on: today, question, answer, risk, answered,
    });
    if (error) console.error("Watheq advisor log error:", error);
  };

  // ---------- 4) تصنيف المخاطر قبل أي استدعاء للنموذج ----------
  const risk = classify(question);
  if (risk === "out") {
    await log(OUT_OF_SCOPE_REPLY, "out", false);
    return NextResponse.json({ ok: true, answer: OUT_OF_SCOPE_REPLY, disclaimer: DISCLAIMER, risk });
  }
  if (risk === "high") {
    // لا يُستدعى النموذج إطلاقًا في الأسئلة القضائية
    await log(HIGH_RISK_REPLY, "high", false);
    return NextResponse.json({ ok: true, answer: HIGH_RISK_REPLY, disclaimer: DISCLAIMER, risk });
  }

  // ---------- 5) استدعاء النموذج ----------
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "المستشار غير مفعّل حاليًّا." }, { status: 503 });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ADVISOR_MODEL || "claude-sonnet-4-6",
        max_tokens: 700,
        temperature: 0.2,          // منخفضة عمدًا: نريد ثباتًا لا إبداعًا
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("Watheq advisor API error:", res.status, t.slice(0, 300));
      await log("", "error", false);
      return NextResponse.json({ ok: false, error: "تعذّر الوصول للمستشار الآن، حاول بعد قليل." }, { status: 502 });
    }

    const data = await res.json();
    const answer = (data?.content || [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("\n").trim();

    if (!answer) {
      await log("", "error", false);
      return NextResponse.json({ ok: false, error: "لم أستطع صياغة إجابة. أعد صياغة سؤالك." }, { status: 502 });
    }

    await log(answer, "normal", true);
    return NextResponse.json({
      ok: true, answer, disclaimer: DISCLAIMER, risk: "normal",
      remaining: Math.max(0, limit - (count || 0) - 1),
    });
  } catch (e: any) {
    console.error("Watheq advisor error:", e);
    await log("", "error", false);
    return NextResponse.json({ ok: false, error: "حدث خطأ غير متوقّع." }, { status: 500 });
  }
}
