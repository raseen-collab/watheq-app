import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** إرسال رسالة تجريبية لتأكيد ربط البوت */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body?.chatId || "");
  const text = String(body?.text || "✅ تم ربط تنبيهات وثيق بنجاح.\nستصلك هنا تنبيهات الاستحقاقات والعقود المنتهية.");

  if (!chatId) return NextResponse.json({ ok: false, error: "أدخل معرّف المحادثة" }, { status: 400 });

  const r = await sendTelegram(chatId, text);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
