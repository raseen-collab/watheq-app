import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as admin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * تسجيل سؤال المساعد.
 *
 * يُستدعى من المتصفح بعد كل سؤال — بلا انتظار من المستخدم (fire and forget).
 * والهدف الأول: الأسئلة التي لم يجد لها جوابًا، فهي فجوات في المنتج أو شرحه.
 *
 * حدود مقصودة: السؤال وحده يُسجَّل، بلا أي بيانات تشغيلية. وطوله محدود،
 * والمعدّل مقيَّد بالجلسة حتى لا يُغرق الجدول بضغطة زر متكررة.
 */
const RATE = new Map<string, { n: number; t: number }>();
const WINDOW = 60_000, MAX = 12;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const question = String(body?.question || "").trim().slice(0, 300);
    if (!question) return NextResponse.json({ ok: false }, { status: 400 });

    /* تقييد بسيط بالمعدّل: عنوان الطلب مفتاحًا. يمنع الإغراق بلا تعقيد. */
    const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    const now = Date.now();
    const cur = RATE.get(key);
    if (cur && now - cur.t < WINDOW) {
      if (cur.n >= MAX) return NextResponse.json({ ok: true, skipped: true });
      cur.n++;
    } else RATE.set(key, { n: 1, t: now });
    if (RATE.size > 5000) RATE.clear();

    let uid: string | null = null;
    try { uid = (await createClient().auth.getUser()).data?.user?.id ?? null; } catch { /* زائر */ }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key2 = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key2) return NextResponse.json({ ok: false }, { status: 500 });
    const db = admin(url, key2, { auth: { persistSession: false } });

    await db.from("help_queries").insert({
      user_id: uid,
      question,
      answered: !!body?.answered,
      matched_id: body?.matched_id ? String(body.matched_id).slice(0, 40) : null,
      score: Number.isFinite(Number(body?.score)) ? Number(body.score) : null,
      path: body?.path ? String(body.path).slice(0, 120) : null,
    });
    return NextResponse.json({ ok: true });
  } catch {
    /* التسجيل لا يجوز أن يُفشل تجربة المستخدم */
    return NextResponse.json({ ok: true });
  }
}
