import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * إرسال رسالة تجريبية لتأكيد ربط البوت.
 *
 * 🔒 لا يقبل أي مُدخل من العميل — لا معرّف محادثة ولا نص.
 * النسخة السابقة كانت ترسل أي نص إلى أي chatId يرسله المتصفح،
 * فيصير بوت وثيق أداة إرسال باسمه إلى أي محادثة يعرف رقمها
 * أي مستخدم مسجَّل. الآن: المعرّف يُقرأ من صفّ المستخدم في القاعدة،
 * والنص ثابت.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("telegram_chat_id")
    .eq("id", user.id)
    .maybeSingle();

  const chatId = String(profile?.telegram_chat_id || "");
  if (!chatId) {
    return NextResponse.json(
      { ok: false, error: "لم يُربط حسابك بتليجرام بعد. افتح البوت وأرسل رمز الربط أولًا." },
      { status: 400 }
    );
  }

  const r = await sendTelegram(
    chatId,
    "✅ تم ربط تنبيهات وثيق بنجاح.\nستصلك هنا تنبيهات الاستحقاقات والعقود المنتهية."
  );
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
