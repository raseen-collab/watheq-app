import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tgSend, tgEdit, tgAnswer, navButtons, TgKeyboard } from "@/lib/telegram";
import {
  buildReport, getUnpaid, markPaid, buildReminder, sar,
  statusReport, contractsInState, contractCard, payTenantOldest, renewContract, buildNotice, stateLabel, searchTenants } from "@/lib/reports";

export const dynamic = "force-dynamic";

/** تهريب HTML — اسم مستأجر فيه < أو & كان يُسقط رسالة تليجرام كاملة */
const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  /* الموظف قد يكون ربط البوت قبل قصر الإعدادات على صاحب المكتب: نكشفه هنا
     فلا تخرج أرقام المكتب لمن لم يقرّر صاحبه مشاركتها معه. */
  if (data?.id) {
    const { data: tm } = await db.from("team_members").select("owner_id").eq("member_id", data.id).maybeSingle();
    if (tm?.owner_id) return { ...(data as any), _isStaff: true };
  }
  return data;
}

/** أزرار التقرير: أفعال (لليوم/المتأخرات) + تنقّل */
function reportButtons(scope: string): TgKeyboard {
  const nav: TgKeyboard = [
    [{ text: "📅 اليوم", callback_data: "cmd:today" }, { text: "⚠️ المتأخرات", callback_data: "cmd:late" }],
    [{ text: "📊 ملخّص شامل", callback_data: "cmd:summary" }, { text: "📋 حالة العقود", callback_data: "back:status" }],
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
  "/status — حالة العقود (منتظم/متأخر/تجديد…)",
  "/summary — ملخّص شامل",
  "/menu — القائمة الرئيسية",
  "/team — رسائل الفريق والمهام المفتوحة",
  "",
  "أو اكتب اسم مستأجر أو رقم جواله مباشرة للبحث.", "",
  "من «حالة العقود» تتحكّم بكل عقد حسب حالته: تذكير، مطالبة، تجديد، أو تسجيل دفعة.",
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
  /* تنبيهات البوت لصاحب المكتب وحده: المتأخرات والتحصيل أرقام مكتب يقرّر
     صاحبه مع من يشاركها — لا تُرسَل لمن ربط البوت. والموظف يعمل من اللوحة
     بصلاحياته الخمس عشرة كما هي. */
  if ((p as any)._isStaff) {
    return tgSend(chatId,
      "تنبيهات وثيق على تليجرام لصاحب المكتب وحده.\n\n"
      + "أنت مسجَّل كموظف — استعمل لوحة وثيق من المتصفح، وصلاحياتك فيها كما هي.\n"
      + "وإن احتجت تنبيهات على جوالك فاطلبها من صاحب المكتب.");
  }

  const cmd = text.replace(/^\//, "").split(/[\s@]/)[0].toLowerCase();
  switch (cmd) {
    case "today": case "late": case "summary": {
      const r = await buildReport(db, p, cmd);
      return tgSend(chatId, r, reportButtons(cmd));
    }
    case "status": {
      const r = await statusReport(db, p);
      return tgSend(chatId, r, statusButtons());
    }
    case "help": return tgSend(chatId, helpText(), navButtons());
    case "menu": return tgSend(chatId, "اختر من القائمة:", reportButtons("late"));
    case "team": case "فريق": return teamInbox(db, chatId, p);
    default: {
      /* أي نص غير أمر = بحث عن مستأجر. أكثر سؤال خارج المكتب: «فلان دفع؟» —
         كان يتطلب فتح اللوحة، والآن يكفي اسمه أو آخر أرقام جواله. */
      if (text.startsWith("/")) return tgSend(chatId, helpText(), navButtons());
      return searchAndShow(db, chatId, p, text);
    }
  }
}

// ======================= الأزرار (Callbacks) =======================

/** قائمة اختيار دفعة لتسجيلها مدفوعة */
async function showPayList(db: DB, chatId: number, messageId: number, p: any, scope: string) {
  const rows = await getUnpaid(db, p, scope);
  if (!rows.length) return tgEdit(chatId, messageId, "لا توجد دفعات غير مسدّدة في هذا القسم ✅", reportButtons(scope));
  const buttons: TgKeyboard = rows.slice(0, 15).map((r) => [
    { text: `${r.unit} — ${sar(r.amount)} ريال — ${r.due}`, callback_data: `pay:${scope}:${r.id}` },
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
  return tgEdit(chatId, messageId, `تأكيد تسجيل دفعة:\n\n<b>${row.unit}</b> — ${row.tenant}\nالمبلغ: <b>${sar(row.amount)}</b> ريال · الاستحقاق: ${row.due}`, buttons);
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
  if ((p as any)._isStaff) return tgEdit(chatId, messageId, "تنبيهات وثيق لصاحب المكتب وحده — استعمل اللوحة من المتصفح.");

  const [action, a1, a2] = data.split(":");
  switch (action) {
    case "cmd": {
      const rep = await buildReport(db, p, a1);
      return tgEdit(chatId, messageId, rep, reportButtons(a1));
    }
    case "back": {
      if (a1 === "status") return tgEdit(chatId, messageId, await statusReport(db, p), statusButtons());
      const rep = await buildReport(db, p, a1);
      return tgEdit(chatId, messageId, rep, reportButtons(a1));
    }
    case "paylist": return showPayList(db, chatId, messageId, p, a1);
    case "pay": return confirmPay(db, chatId, messageId, p, a1, a2);
    case "payok": return doPay(db, chatId, messageId, p, a1, a2);
    case "remindlist": return showRemindList(db, chatId, messageId, p, a1);
    case "remind": return doRemind(db, chatId, messageId, p, a1, a2);
    // آلة حالات العقد
    case "st": return showState(db, chatId, messageId, p, a1);
    case "card": return showCard(db, chatId, messageId, p, a2);
    case "payt": return doPayTenant(db, chatId, messageId, p, a1);
    case "renew": return confirmRenew(db, chatId, messageId, p, a1);
    case "renewok": return doRenew(db, chatId, messageId, p, a1);
    case "claim": return doNotice(db, chatId, messageId, p, a1, "claim");
    case "nonrenew": return doNotice(db, chatId, messageId, p, a1, "nonrenewal");
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

// ======================= آلة حالات العقد (أزرار) =======================

const escHtml = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** أزرار شاشة الحالة الرئيسية */
function statusButtons(): TgKeyboard {
  return [
    [{ text: "🔴 متأخر", callback_data: "st:arrears" }, { text: "🟡 يستحق قريبًا", callback_data: "st:due_soon" }],
    [{ text: "🟣 التجديد", callback_data: "st:expiring" }, { text: "⚖️ في التنفيذ", callback_data: "st:litigation" }],
    [{ text: "📅 اليوم", callback_data: "cmd:today" }, { text: "⚠️ المتأخرات", callback_data: "cmd:late" }],
  ];
}

/** نصّ بطاقة العقد */
function cardText(c: any): string {
  const s = c.state;
  const L = [`${s.dot} <b>${escHtml(c.label)}</b>`, `المستأجر: ${escHtml(c.tenant)}`, `الحالة: <b>${s.label}</b>`];
  if (s.key === "arrears") L.push(`المتأخر المتراكم: <b>${sar(s.owed)}</b> ريال`);
  if (s.key === "due_soon") L.push(s.nextDue ? `الدفعة القادمة: ${s.nextDue}` : "");
  if (s.key === "expiring" && s.daysToEnd != null) L.push(`ينتهي خلال ${s.daysToEnd} يوم (${s.endDate})`);
  if (s.key === "active") L.push(s.nextDue ? `الدفعة القادمة: ${s.nextDue}` : "الدفعات منتظمة ✅");
  if (s.key === "litigation") L.push("⚠️ الإشعارات الودية مجمّدة — تابع طلب التنفيذ في «ناجز».");
  return L.filter(Boolean).join("\n");
}

/** أزرار بطاقة العقد حسب الحالة */
function cardButtons(c: any): TgKeyboard {
  const id = c.tenantId, k = c.state.key;
  const rows: TgKeyboard = [];
  if (k === "arrears") {
    rows.push([{ text: "✅ سجّل دفعة", callback_data: `payt:${id}` }, { text: "🔴 مطالبة رسمية", callback_data: `claim:${id}` }]);
  } else if (k === "due_soon") {
    rows.push([{ text: "🔔 ذكّر ودّيًا", callback_data: `remind:status:${id}` }, { text: "✅ سجّل دفعة", callback_data: `payt:${id}` }]);
  } else if (k === "expiring") {
    rows.push([{ text: "🔄 جدّد سنة", callback_data: `renew:${id}` }, { text: "📄 إشعار عدم تجديد", callback_data: `nonrenew:${id}` }]);
  }
  // active / litigation: بلا أزرار فعل (منتظم = هدوء، التنفيذ = تجميد)
  rows.push([{ text: "⬅️ رجوع", callback_data: "back:status" }]);
  return rows;
}

/** قائمة عقود ضمن حالة */
async function showState(db: DB, chatId: number, messageId: number, p: any, key: string) {
  const cards = await contractsInState(db, p, key);
  if (!cards.length) {
    return tgEdit(chatId, messageId, `لا توجد عقود في حالة «${stateLabel(key as any)}» ✅`, [[{ text: "⬅️ رجوع", callback_data: "back:status" }]]);
  }
  const buttons: TgKeyboard = cards.slice(0, 15).map((c) => [
    { text: `${c.state.dot} ${c.label} — ${c.tenant}`, callback_data: `card:${key}:${c.tenantId}` },
  ]);
  buttons.push([{ text: "⬅️ رجوع", callback_data: "back:status" }]);
  return tgEdit(chatId, messageId, `عقود «${stateLabel(key as any)}»:`, buttons);
}

/** بطاقة عقد واحد */
/** نتائج البحث: بطاقة واحدة مباشرة، أو قائمة أزرار إن تعدّدت */
async function searchAndShow(db: DB, chatId: number, p: any, q: string) {
  if (q.length < 2) return tgSend(chatId, "اكتب حرفين على الأقل للبحث — أو /menu للقائمة.", navButtons());
  const { cards, total } = await searchTenants(db, p, q);
  if (!total) {
    return tgSend(chatId, `لا نتائج لـ «${esc(q)}».\n\nابحث بالاسم أو الجوال أو رقم الوحدة أو رقم العقد.`, navButtons());
  }
  if (cards.length === 1) return tgSend(chatId, cardText(cards[0]), cardButtons(cards[0]));
  const rows: TgKeyboard = cards.map((c: any) => [{
    text: `${c.state.dot} ${c.tenant} — ${c.label}`.slice(0, 60),
    callback_data: `card:search:${c.tenantId}`,
  }]);
  rows.push([{ text: "⬅︎ القائمة", callback_data: "cmd:menu" }]);
  const more = total > cards.length ? `\n\n<i>و${total - cards.length} نتيجة أخرى — ضيّق البحث.</i>` : "";
  return tgSend(chatId, `🔎 <b>${total} نتيجة</b> لـ «${esc(q)}»:${more}`, rows);
}

/** رسائل الفريق: آخر ما كُتب في المنصة + المهام المفتوحة على صاحب الحساب */
async function teamInbox(db: DB, chatId: number, p: any) {
  const { data, error } = await db.from("office_messages")
    .select("body, author_id, assigned_to, done_at, created_at")
    .eq("user_id", p.id).order("created_at", { ascending: false }).limit(10);
  if (error) {
    return tgSend(chatId, /does not exist|relation/.test(error.message)
      ? "ميزة رسائل الفريق غير مفعّلة بعد في قاعدة البيانات."
      : "تعذّر جلب رسائل الفريق.", navButtons());
  }
  const rows = (data || []) as any[];
  if (!rows.length) return tgSend(chatId, "💬 <b>رسائل الفريق</b>\n\nلا رسائل بعد.", navButtons());
  const names = await actorNames(db, p.id);
  const open = rows.filter((r) => r.assigned_to && !r.done_at);
  const lines = rows.slice(0, 6).map((r) => {
    const who = names[r.author_id] || "زميل";
    const when = String(r.created_at || "").slice(0, 10);
    const task = r.assigned_to ? (r.done_at ? " ✓" : " ⏳") : "";
    return `• <b>${esc(who)}</b>${task} — ${esc(String(r.body || "").slice(0, 90))}\n  <i>${when}</i>`;
  }).join("\n");
  const head = `💬 <b>رسائل الفريق</b>${open.length ? ` — <b>${open.length}</b> مهمة مفتوحة` : ""}\n\n`;
  return tgSend(chatId, head + lines + "\n\n<i>الردّ والتكليف من المنصة.</i>", navButtons());
}

/** أسماء أعضاء المكتب لعرضها بدل المعرّفات */
async function actorNames(db: DB, office: string): Promise<Record<string, string>> {
  try {
    const { data } = await db.rpc("watheq_actor_names", { office });
    const m: Record<string, string> = {};
    (data || []).forEach((a: any) => { m[a.actor_id] = a.actor_name; });
    return m;
  } catch { return {}; }
}

async function showCard(db: DB, chatId: number, messageId: number, p: any, tenantId: string) {
  const c = await contractCard(db, p, tenantId);
  if (!c) return tgEdit(chatId, messageId, "لم تُعثر على العقد.", statusButtons());
  return tgEdit(chatId, messageId, cardText(c), cardButtons(c));
}

/** تسجيل دفعة (أقدم فاتورة متأخرة للمستأجر) ثم تحديث البطاقة */
async function doPayTenant(db: DB, chatId: number, messageId: number, p: any, tenantId: string) {
  const res = await payTenantOldest(db, p, tenantId);
  const c = await contractCard(db, p, tenantId);
  const banner = res.ok ? `✅ ${res.msg}` : `⚠️ ${res.msg}`;
  if (!c) return tgEdit(chatId, messageId, banner, statusButtons());
  return tgEdit(chatId, messageId, `${banner}\n\n${cardText(c)}`, cardButtons(c));
}

/** تأكيد تجديد العقد */
async function confirmRenew(db: DB, chatId: number, messageId: number, p: any, tenantId: string) {
  const c = await contractCard(db, p, tenantId);
  if (!c) return tgEdit(chatId, messageId, "لم تُعثر على العقد.", statusButtons());
  const buttons: TgKeyboard = [
    [{ text: "✅ نعم، جدّد سنة", callback_data: `renewok:${tenantId}` }],
    [{ text: "⬅️ رجوع", callback_data: "back:status" }],
  ];
  return tgEdit(chatId, messageId, `تأكيد تجديد عقد:\n\n<b>${escHtml(c.label)}</b> — ${escHtml(c.tenant)}\nسيُمدّد لسنة إضافية.`, buttons);
}

/** تنفيذ التجديد ثم تحديث البطاقة */
async function doRenew(db: DB, chatId: number, messageId: number, p: any, tenantId: string) {
  const res = await renewContract(db, p, tenantId);
  const c = await contractCard(db, p, tenantId);
  const banner = res.ok ? `✅ ${res.msg}` : `⚠️ ${res.msg}`;
  if (!c) return tgEdit(chatId, messageId, banner, statusButtons());
  return tgEdit(chatId, messageId, `${banner}\n\n${cardText(c)}`, cardButtons(c));
}

/** إشعار رسمي (مطالبة / عدم تجديد) عبر واتساب */
async function doNotice(db: DB, chatId: number, messageId: number, p: any, tenantId: string, kind: "claim" | "nonrenewal") {
  const r = await buildNotice(db, p, tenantId, kind);
  if (!r.ok) return tgEdit(chatId, messageId, r.text, [[{ text: "⬅️ رجوع", callback_data: "back:status" }]]);
  const buttons: TgKeyboard = [
    [{ text: "📲 افتح واتساب", url: r.url! }],
    [{ text: "⬅️ رجوع", callback_data: "back:status" }],
  ];
  return tgEdit(chatId, messageId, r.text, buttons);
}
