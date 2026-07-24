/** إرسال رسالة عبر بوت تليجرام */
export async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN غير مضبوط" };
  if (!chatId) return { ok: false, error: "لا يوجد معرّف محادثة" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await res.json();
    return data?.ok ? { ok: true } : { ok: false, error: data?.description || "فشل الإرسال" };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export const WATHEQ_TELEGRAM = "+966550165210";
export const WATHEQ_EMAIL = "watheqdocs@gmail.com";
