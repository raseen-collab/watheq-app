/** ============================================================
 *  وثيق — طبقة تليجرام (نسخة تفاعلية)
 *  متوافقة مع الكود القديم: sendTelegram لا تزال موجودة.
 *  ============================================================ */

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const api = (method: string) => `https://api.telegram.org/bot${BOT_TOKEN()}/${method}`;

export type TgButton = { text: string; callback_data?: string; url?: string };
export type TgKeyboard = TgButton[][];

/** استدعاء عام لأي دالة في واجهة تليجرام */
async function call(method: string, payload: Record<string, any>) {
  const token = BOT_TOKEN();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN غير مضبوط" };
  try {
    const res = await fetch(api(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data?.ok
      ? { ok: true, result: data.result }
      : { ok: false, error: data?.description || "فشل الطلب" };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** إرسال رسالة جديدة (مع أزرار اختيارية) */
/**
 * تليجرام يرفض أي رسالة فوق 4096 حرفًا — ويُرجع خطأً فتسقط الرسالة كلها.
 * مكتب بـ160 وحدة يتجاوز الحد في يوم مزدحم بسهولة. نقسّم على حدود
 * الأسطر (لا في منتصف وسم HTML) ونرسل القطع بالترتيب، والأزرار على
 * الأخيرة فقط. الرسائل القصيرة تمرّ كما كانت تمامًا.
 */
const TG_MAX = 3900;
function splitTelegram(text: string): string[] {
  if (text.length <= TG_MAX) return [text];
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const piece = line.length > TG_MAX ? line.slice(0, TG_MAX) : line;
    if ((cur + "\n" + piece).length > TG_MAX && cur) { out.push(cur); cur = piece; }
    else cur = cur ? cur + "\n" + piece : piece;
  }
  if (cur) out.push(cur);
  return out;
}

export async function tgSend(chatId: string | number, text: string, buttons?: TgKeyboard) {
  const parts = splitTelegram(text);
  let last: any = null;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    last = await call("sendMessage", {
      chat_id: chatId,
      text: parts.length > 1 ? `${parts[i]}${isLast ? "" : "\n…"}` : parts[i],
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(buttons && isLast ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
    if (!last?.ok) return last;
  }
  return last;
}

/** تعديل رسالة قائمة (بعد ضغط زر) بدل إرسال رسالة جديدة */
export async function tgEdit(
  chatId: string | number,
  messageId: number,
  text: string,
  buttons?: TgKeyboard
) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** إنهاء مؤشّر التحميل الدائري على الزر (وإظهار تنبيه اختياري) */
export async function tgAnswer(callbackQueryId: string, text?: string, alert = false) {
  return call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: alert } : {}),
  });
}

/** قائمة الأوامر التي تظهر في زر (/) داخل تليجرام */
export async function tgSetCommands() {
  return call("setMyCommands", {
    commands: [
      { command: "today", description: "استحقاقات اليوم والقريبة" },
      { command: "late", description: "المتأخرات" },
      { command: "status", description: "حالة العقود" },
      { command: "summary", description: "ملخّص شامل" },
      { command: "menu", description: "القائمة الرئيسية" },
      { command: "help", description: "المساعدة" },
    ],
  });
}

/** ربط الـ webhook بالسيرفر (يُستدعى مرة واحدة من /api/telegram/setup) */
export async function tgSetWebhook(url: string, secret: string) {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

/** ===== توافق مع الكود القديم ===== */
export async function sendTelegram(chatId: string, text: string) {
  return tgSend(chatId, text);
}

export const WATHEQ_TELEGRAM = "+966550165210";
export const WATHEQ_EMAIL = "watheqdocs@gmail.com";

/** أزرار التنقّل المشتركة (تظهر أسفل كل تقرير) */
export const navButtons = (): TgKeyboard => [
  [
    { text: "📅 اليوم", callback_data: "cmd:today" },
    { text: "⚠️ المتأخرات", callback_data: "cmd:late" },
  ],
  [{ text: "📊 ملخّص شامل", callback_data: "cmd:summary" }],
];
