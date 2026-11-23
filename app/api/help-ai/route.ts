import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as admin } from "@supabase/supabase-js";
import { HELP_AI_SYSTEM, kbCatalog, parseIds, riyadhDayStartISO } from "@/lib/help-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * (v100) مطابقة سؤال المساعد بالنموذج — يعيد أرقام مداخل من قاعدة المعرفة فقط.
 *
 * حدود التكلفة: معدّل لكل عنوان (8 أسئلة / 10 دقائق)، وسقف يومي للمنصة كلها
 * (HELP_AI_DAILY، افتراضيًّا 200). عند تجاوز أيٍّ منهما يعود المساعد للبحث بالكلمات
 * بصمت — لا خطأ أمام المستخدم. الفهرس مخزَّن مؤقتًا (prompt caching) فتكلفة السؤال صغيرة.
 * لا يُرسَل للنموذج إلا نص السؤال — لا بيانات حساب ولا وحدات ولا مستأجرين.
 */
const RATE = new Map<string, { n: number; t: number }>();
const WINDOW = 10 * 60_000, MAX = 8;
const CATALOG = kbCatalog();

export async function POST(req: Request) {
  const none = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ids: [], ...extra });
  try {
    const body = await req.json().catch(() => null);
    const question = String(body?.question || "").trim().slice(0, 300);
    if (question.length < 2) return NextResponse.json({ ok: false }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    const now = Date.now(), cur = RATE.get(ip);
    if (cur && now - cur.t < WINDOW) { if (cur.n >= MAX) return none({ limited: true }); cur.n++; }
    else RATE.set(ip, { n: 1, t: now });
    if (RATE.size > 5000) RATE.clear();

    const key = process.env.ANTHROPIC_API_KEY;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || !url || !sk) return none({ off: true });
    const db = admin(url, sk, { auth: { persistSession: false } });

    const cap = Math.max(0, Number(process.env.HELP_AI_DAILY ?? 200) || 0);
    const { count } = await db.from("help_queries").select("id", { count: "exact", head: true })
      .eq("via", "ai").gte("created_at", riyadhDayStartISO());
    if ((count ?? 0) >= cap) return none({ capped: true });

    let uid: string | null = null;
    try { uid = (await createClient().auth.getUser()).data?.user?.id ?? null; } catch { /* زائر */ }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      cache: "no-store", method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.HELP_MODEL || "claude-haiku-4-5",
        max_tokens: 40, temperature: 0,
        system: [{ type: "text", text: HELP_AI_SYSTEM + CATALOG, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `سؤال المستخدم: ${question}` }],
      }),
    });
    if (!res.ok) { console.error("help-ai", res.status, (await res.text()).slice(0, 200)); return none({ error: true }); }
    const data = await res.json();
    const text = (data?.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ");
    const hits = parseIds(text);

    await db.from("help_queries").insert({
      user_id: uid, question, answered: hits.length > 0, matched_id: hits[0]?.id || null, score: null, via: "ai",
      path: body?.path ? String(body.path).slice(0, 120) : null,
    });
    return NextResponse.json({ ok: true, ids: hits.map((e) => e.id) });
  } catch (e) {
    console.error("help-ai", e);
    return none({ error: true });
  }
}
