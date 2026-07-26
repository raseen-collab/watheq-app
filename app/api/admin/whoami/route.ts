import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * تشخيص مؤقّت لصفحة الإدارة.
 *
 * الاستخدام:  /api/admin/whoami?key=CRON_SECRET
 * محميّ بـ CRON_SECRET فلا يصل إليه غيرك.
 *
 * ⚠️ احذف هذا الملف بعد حلّ المشكلة — لا داعي لبقائه.
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  const raw = process.env.ADMIN_USER_IDS || "";
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);

  let userId: string | null = null;
  let email: string | null = null;
  let sessionError: string | null = null;
  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) sessionError = error.message;
    userId = data?.user?.id ?? null;
    email = data?.user?.email ?? null;
  } catch (e: any) {
    sessionError = String(e?.message || e);
  }

  const matches = !!userId && allowed.includes(userId);

  // التشخيص: أين يقف الخلل بالضبط؟
  let verdict = "";
  if (!allowed.length) verdict = "المتغيّر ADMIN_USER_IDS غير مضبوط أو فارغ — أضِفه في Vercel ثم Redeploy.";
  else if (!userId) verdict = "لا توجد جلسة مسجّلة — سجّل الدخول في المنصة أولًا من نفس المتصفّح.";
  else if (!matches) verdict = "أنت مسجّل دخول، لكن معرّفك غير موجود في ADMIN_USER_IDS — انسخ المعرّف أدناه وضعه في المتغيّر ثم Redeploy.";
  else verdict = "كل شيء سليم ✅ — يفترض أن /admin تفتح معك. إن بقيت 404 فالملف ليس في المسار app/admin/page.tsx.";

  return NextResponse.json({
    ok: true,
    verdict,
    yourUserId: userId,          // ← انسخ هذا وضعه في ADMIN_USER_IDS
    yourEmail: email,
    adminListCount: allowed.length,
    adminListPreview: allowed.map((v) => (v.length > 8 ? v.slice(0, 8) + "…" : v)),
    matches,
    sessionError,
  });
}
