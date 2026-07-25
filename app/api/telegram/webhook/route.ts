import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tgSend, tgEdit, tgAnswer, navButtons, TgKeyboard } from "@/lib/telegram";
import { buildReport, getUnpaid, markPaid, buildReminder, sar } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** عميل Supabase بصلاحية الخدمة — لأن المُنادي هنا تليجرام وليس مستخدمًا مسجّلًا */
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
type DB = ReturnType<typeof admin>;

async function findProfileByChat(db: DB, chatId: number | string) {
  const { data } = await db.from("profiles").select("*").eq("telegram_chat_id", String(chatId)).maybeSingle();
  return data;
}

/** أزرار التقرير: أفعال (لليوم/المتأخرات) + تنقّل */
function reportButtons(scope: string): TgKeyboard {
  const nav: TgKeyboard = [
    [{ text: "📅 اليوم", callback_data: "cmd:today" }, { text: "⚠️ المتأخرات", callback_data: "cmd:late" }],
    [{ text: "📊 ملخّص شامل", callback_data: "cmd:summary" }],
  ];
  if (scope === "today" || scope === "late") {
    return [
      [{ text: "✅ سجّل دفعة", callback_data: `paylist:${scope}` }, { text: "🔔 ذكّر مستأجر", callback_data: `remindlist:${scope}` }],
      ...nav,
    ];
  }
  return nav;
}

const backBtn = (scope: string): TgKeyboard[number] => [{ text: "⬅️ رجوع", callback_data: `back:${scope}` }];

/** ربط حساب بالرمز */
async function linkAccount(db: DB, chatId: number, code: string, username: string | null) {
  const { data: p } = await db.from("profiles").select("id, telegram_chat_id").eq("telegram_link_code", code).maybeSingle();
  if (!p) return tgSend(chatId, "رمز الربط غير صحيح أو منتهٍ. افتح «الإعدادات» في المنصة واطلب رمزًا جديدًا.");
  await db.from("profiles").update({
    telegram_chat_id: String(chatId),
    telegram_username: username,
    telegram_linked_at: new Date().toISOString(),
    telegram_link_code: null,
  }).eq("id", p.id);
  return tgSend(chatId, "✅ <b>تم ربط حسابك بوثيق بنجاح.</b>\n\nيصلك هنا تنبيه قبل كل استحقاق، وتقدر تستعلم وتتحكّم من هنا:", navButtons());
}

const helpText = () => [
  "🤖 <b>أوامر وثيق</b>", "",
  "/today — استحقاقات اليوم والقريبة",
  "/late — المتأخرات",
  "/summary — ملخّص شامل",
  "/menu — القائمة الرئيسية", "",
  "من داخل «اليوم» و«المتأخرات» تقدر <b>تسجّل دفعة</b> أو <b>تذكّر المستأجر</b> بضغطة.",
].join("\n");

// ======================= الرسائل النصّية =======================

async function handleMessage(db: DB, msg: any) {
  const chatId = msg.chat?.id;
  const text = String(msg.text || "").trim();
  const username = msg.chat?.username || msg.from?.username || null;
  if (!chatId) return;

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (code) return linkAccount(db, chatId, code, username);
    const p = await findProfileByChat(db, chatId);
    if (p) return tgSend(chatId, "أهلًا بك من جديد 👋 اختر من القائمة:", navButtons());
    return tgSend(chatId, "أهلًا بك في <b>وثيق</b> 👋\n\nلربط حسابك: افتح <b>الإعدادات</b> في المنصة، اضغط «ربط تليجرام»، وأرسل الرمز الظاهر هنا.");
  }

  const p = await findProfileByChat(db, chatId);
  if (!p) {
    if (/^[A-Za-z0-9]{6,12}$/.test(text)) return linkAccount(db, chatId, text, username);
    return tgSend(chatId, "حسابك غير مربوط بعد. افتح «الإعدادات» في منصة وثيق واضغط «ربط تليجرام»، ثم أرسل الرمز هنا.");
  }

  const cmd = text.replace(/^\//, "").split(/[\s@]/)[0].toLowerCase();
  switch (cmd) {
    case "today": case "late": case "summary": {
      const r = await buildReport(db, p, cmd);
      return tgSend(chatId, r, reportButtons(cmd));
    }
    case "help": return tgSend(chatId, helpText(), navButtons());
    case "menu": default: return tgSend(chatId, "اختر من القائمة:", reportButtons("late"));
  }
}

// ======================= الأزرار (Callbacks) =======================

/** قائمة اختيار دفعة لتسجيلها مدفوعة */
async function showPayList(db: DB, chatId: number, messageId: number, p: any, scope: string) {
  const rows = await getUnpaid(db, p, scope);
  if (!rows.length) return tgEdit(chatId, messageId, "لا توجد دفعات غير مسدّدة في هذا القسم ✅", reportButtons(scope));
  const buttons: TgKeyboard = rows.slice(0, 15).map((r) => [
    { text: `${r.unit} — ${sar(r.amount)}﷼ — ${r.due}`, callback_data: `pay:${scope}:${r.id}` },
  ]);
  buttons.push(backBtn(scope));
  return tgEdit(chatId, messageId, "اختر الدفعة لتسجيلها <b>كمدفوعة</b>:", buttons);
}

/** شاشة تأكيد قبل التسجيل */
async function confirmPay(db: DB, chatId: number, messageId: number, p: any, scope: string, id: string) {
  const row = (await getUnpaid(db, p, scope)).find((r) => r.id === id);
  if (!row) return tgEdit(chatId, messageId, "لم تُعثر على الدفعة (ربما سُجّلت).", reportButtons(scope));
  const buttons: TgKeyboard = [
    [{ text: "✅ نعم، سجّلها مدفوعة", callback_data: `payok:${scope}:${id}` }],
    backBtn(scope),
  ];
  return tgEdit(chatId, messageId, `تأكيد تسجيل دفعة:\n\n<b>${row.unit}</b> — ${row.tenant}\nالمبلغ: <b>${sar(row.amount)}</b> ﷼ · الاستحقاق: ${row.due}`, buttons);
}

/** تنفيذ التسجيل ثم تحديث التقرير */
async function doPay(db: DB, chatId: number, messageId: number, p: any, scope: string, id: string) {
  const res = await markPaid(db, p, id);
  const rep = await buildReport(db, p, scope);
  const banner = res.ok ? `✅ ${res.msg}` : `⚠️ ${res.msg}`;
  return tgEdit(chatId, messageId, `${banner}\n\n${rep}`, reportButtons(scope));
}

/** قائمة اختيار مستأجر لتذكيره */
async function showRemindList(db: DB, chatId: number, messageId: number, p: any, scope: string) {
  const rows = await getUnpaid(db, p, scope);
  if (!rows.length) return tgEdit(chatId, messageId, "لا يوجد مستأجرون عليهم مستحقات في هذا القسم ✅", reportButtons(scope));
  const seen = new Set<string>();
  const buttons: TgKeyboard = [];
  for (const r of rows) {
    if (seen.has(r.contractId)) continue;
    seen.add(r.contractId);
    buttons.push([{ text: `${r.unit} — ${r.tenant}`, callback_data: `remind:${scope}:${r.contractId}` }]);
    if (buttons.length >= 15) break;
  }
  buttons.push(backBtn(scope));
  return tgEdit(chatId, messageId, "اختر المستأجر لإرسال تذكير له:", buttons);
}

/** تجهيز رابط واتساب التذكير */
async function doRemind(db: DB, chatId: number, messageId: number, p: any, scope: string, contractId: string) {
  const r = await buildReminder(db, p, contractId);
  if (!r.ok) return tgEdit(chatId, messageId, r.text, [backBtn(scope)]);
  const buttons: TgKeyboard = [[{ text: "📲 افتح واتساب المستأجر", url: r.url! }], backBtn(scope)];
  return tgEdit(chatId, messageId, r.text, buttons);
}

async function handleCallback(db: DB, cq: any) {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const data = String(cq.data || "");
  await tgAnswer(cq.id);
  if (!chatId) return;

  const p = await findProfileByChat(db, chatId);
  if (!p) return tgEdit(chatId, messageId, "حسابك غير مربوط. افتح «الإعدادات» في المنصة.");

  const [action, a1, a2] = data.split(":");
  switch (action) {
    case "cmd":
    case "back": {
      const rep = await buildReport(db, p, a1);
      return tgEdit(chatId, messageId, rep, reportButtons(a1));
    }
    case "paylist": return showPayList(db, chatId, messageId, p, a1);
    case "pay": return confirmPay(db, chatId, messageId, p, a1, a2);
    case "payok": return doPay(db, chatId, messageId, p, a1, a2);
    case "remindlist": return showRemindList(db, chatId, messageId, p, a1);
    case "remind": return doRemind(db, chatId, messageId, p, a1, a2);
    default: return;
  }
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });

  const db = admin();
  try {
    if (update.message) await handleMessage(db, update.message);
    else if (update.callback_query) await handleCallback(db, update.callback_query);
  } catch (e) {
    console.error("telegram webhook error:", e);
  }
  return NextResponse.json({ ok: true });
}
