import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { sendTelegram } from "@/lib/telegram";
import { contractState } from "@/lib/contracts";
import { unitLabel } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const APP = "https://watheq-app.vercel.app";

function db() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/* ============ نصوص ============ */
const WELCOME = `<b>أهلًا بك في وثيق</b> 🌿

أنا مساعدك لمتابعة عقاراتك وجمعيتك — أنبّهك قبل كل استحقاق، وأخبرك بالمتأخرات والعقود المنتهية.

<b>لنبدأ:</b> اربط حسابك برمز الربط.
افتح ${APP}/settings وانسخ الرمز، ثم أرسله لي هكذا:

<code>/link ABC123</code>

ما عندك حساب بعد؟ أنشئ واحدًا مجانًا ٣٠ يومًا: ${APP}`;

const HELP = `<b>أوامر وثيق</b>

/link — اربط حسابك برمز الربط
/today — ما يستحق خلال الأيام القادمة
/late — المتأخرات وقيمتها
/contracts — العقود التي تنتهي قريبًا
/summary — ملخّص شامل لمحفظتك
/status — حالة حسابك والربط
/help — هذه القائمة

<b>ملاحظة:</b> التنبيهات تصلك تلقائيًّا كل صباح — لا تحتاج طلبها يدويًّا.`;

const NOT_LINKED = `حسابك غير مربوط بعد.

افتح ${APP}/settings وانسخ رمز الربط، ثم أرسله هكذا:
<code>/link ABC123</code>`;

/* ============ جلب بيانات المستخدم ============ */
async function getProfile(chatId: string) {
  const { data } = await db()
    .from("profiles")
    .select("id, org_name, account_type, notify_days_before, notify_enabled, trial_ends_at")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  return data;
}

async function collectProperty(userId: string) {
  const { data: props } = await db().from("properties").select("*, tenants(*)").eq("user_id", userId);
  const soon: string[] = [], late: string[] = [], expiring: string[] = [];
  let totalDue = 0, units = 0;
  for (const p of (props || []) as any[]) {
    const ul = unitLabel(p.property_type);
    for (const t of p.tenants || []) {
      units++;
      const st = contractState(t);
      if (st.status === "late") {
        totalDue += st.amountDue;
        late.push(`• ${t.name} — ${ul} ${t.unit || "—"} (${p.name})\n  <b>${sar(st.amountDue)}</b> ريال · ${st.unpaid} دفعة`);
      } else if (st.daysToNextDue !== null && st.daysToNextDue >= 0) {
        soon.push(`• ${t.name} — ${ul} ${t.unit || "—"}\n  ${sar(t.rent_amount)} ريال · ${st.nextDueDate} (بعد ${st.daysToNextDue} يوم)`);
      }
      if (st.daysToEnd !== null && st.daysToEnd >= 0 && st.daysToEnd <= 60) {
        expiring.push(`• ${t.name} — ${ul} ${t.unit || "—"}\n  ينتهي ${st.endDate} (بعد ${st.daysToEnd} يومًا)`);
      }
    }
  }
  return { props: props || [], soon, late, expiring, totalDue, units };
}

async function collectAssociation(userId: string) {
  const { data: assocs } = await db().from("associations").select("*, owners(*)").eq("user_id", userId);
  const late: string[] = [];
  let totalDue = 0, owners = 0;
  const certs: string[] = [];
  for (const a of (assocs || []) as any[]) {
    for (const o of a.owners || []) {
      owners++;
      if ((o.months_late || 0) > 0) {
        const amt = (o.months_late || 0) * (Number(a.fee) || 0);
        totalDue += amt;
        late.push(`• ${o.name} — وحدة ${o.unit || "—"} (${a.name})\n  <b>${sar(amt)}</b> ريال · ${o.months_late} شهر`);
      }
    }
    if (a.cert_expiry) {
      const d = Math.ceil((new Date(a.cert_expiry).getTime() - Date.now()) / 86400000);
      if (d <= 90) certs.push(`• ${a.name} — الشهادة ${d < 0 ? "منتهية منذ " + Math.abs(d) + " يومًا" : "تنتهي بعد " + d + " يومًا"} (${a.cert_expiry})`);
    }
  }
  return { assocs: assocs || [], late, certs, totalDue, owners };
}

/* ============ معالج الأوامر ============ */
async function handle(chatId: string, text: string, from: any) {
  const cmd = text.trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");
  const arg = text.trim().split(/\s+/).slice(1).join(" ").trim();

  if (cmd === "/start") return WELCOME;
  if (cmd === "/help") return HELP;

  /* ---- الربط ---- */
  if (cmd === "/link") {
    if (!arg) return `أرسل الرمز بعد الأمر، هكذا:\n<code>/link ABC123</code>\n\nتجده في ${APP}/settings`;
    const code = arg.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const { data: prof } = await db()
      .from("profiles").select("id, org_name").eq("telegram_link_code", code).maybeSingle();
    if (!prof) return `❌ رمز غير صحيح.\n\nتأكّد من نسخه كما هو من ${APP}/settings`;

    await db().from("profiles").update({
      telegram_chat_id: chatId,
      telegram_username: from?.username || null,
      telegram_linked_at: new Date().toISOString(),
      notify_enabled: true,
    }).eq("id", prof.id);

    return `✅ <b>تم ربط حسابك بنجاح</b>${prof.org_name ? `\n${prof.org_name}` : ""}

ستصلك من الآن تنبيهات يومية بالمستحقات والمتأخرات والعقود المنتهية.

جرّب: /summary`;
  }

  /* ---- الأوامر التي تحتاج ربطًا ---- */
  const prof = await getProfile(chatId);
  if (!prof) return NOT_LINKED;

  const isProp = prof.account_type === "landlord" || prof.account_type === "both";
  const isHoa = prof.account_type === "hoa_manager" || prof.account_type === "both";

  if (cmd === "/status") {
    const days = prof.trial_ends_at
      ? Math.max(0, Math.ceil((new Date(prof.trial_ends_at).getTime() - Date.now()) / 86400000)) : null;
    return `<b>حالة حسابك</b>

الجهة: ${prof.org_name || "—"}
النوع: ${prof.account_type === "both" ? "أملاك + جمعية" : prof.account_type === "landlord" ? "إدارة أملاك" : "جمعية ملاك"}
الربط: ✅ مفعّل
التنبيهات: ${prof.notify_enabled ? "مفعّلة" : "موقوفة"}
التنبيه قبل: ${prof.notify_days_before ?? 5} أيام
${days !== null ? `التجربة المجانية: ${days > 0 ? `متبقٍ ${days} يومًا` : "منتهية"}` : ""}

لوحتك: ${APP}/dashboard`;
  }

  if (cmd === "/today") {
    const within = prof.notify_days_before ?? 5;
    const parts: string[] = [`🟡 <b>مستحقات خلال ${within} أيام</b>\n`];
    let any = false;
    if (isProp) {
      const { soon } = await collectProperty(prof.id);
      const f = soon.slice(0, 15);
      if (f.length) { any = true; parts.push(...f); }
    }
    if (!any) return `✅ لا مستحقات قريبة خلال ${within} أيام. كل شيء منتظم.`;
    parts.push(`\n${APP}/dashboard/property`);
    return parts.join("\n");
  }

  if (cmd === "/late") {
    const parts: string[] = [];
    let total = 0, any = false;
    if (isProp) {
      const r = await collectProperty(prof.id);
      if (r.late.length) { any = true; total += r.totalDue; parts.push(`🔴 <b>متأخرات الأملاك (${r.late.length})</b>\n`, ...r.late.slice(0, 15), ""); }
    }
    if (isHoa) {
      const r = await collectAssociation(prof.id);
      if (r.late.length) { any = true; total += r.totalDue; parts.push(`🔴 <b>متأخرات اشتراكات الجمعية (${r.late.length})</b>\n`, ...r.late.slice(0, 15), ""); }
    }
    if (!any) return "✅ لا متأخرات. كل المستحقات مسدّدة.";
    parts.unshift(`<b>إجمالي المتأخر: ${sar(total)} ريال</b>\n`);
    parts.push(`${APP}/dashboard`);
    return parts.join("\n");
  }

  if (cmd === "/contracts") {
    if (!isProp) return "هذا الأمر خاص بحسابات إدارة الأملاك.";
    const { expiring } = await collectProperty(prof.id);
    if (!expiring.length) return "✅ لا عقود تنتهي خلال ٦٠ يومًا.";
    return [`📄 <b>عقود تنتهي قريبًا (${expiring.length})</b>\n`, ...expiring.slice(0, 15), `\n${APP}/dashboard/property`].join("\n");
  }

  if (cmd === "/summary") {
    const parts: string[] = [`🗂️ <b>ملخّص وثيق</b>${prof.org_name ? ` — ${prof.org_name}` : ""}\n`];
    if (isProp) {
      const r = await collectProperty(prof.id);
      parts.push(`<b>الأملاك</b>`,
        `العقارات: ${r.props.length} · الوحدات: ${r.units}`,
        `متأخرة: ${r.late.length} (${sar(r.totalDue)} ريال)`,
        `عقود تنتهي قريبًا: ${r.expiring.length}`, "");
    }
    if (isHoa) {
      const r = await collectAssociation(prof.id);
      parts.push(`<b>الجمعية</b>`,
        `الجمعيات: ${r.assocs.length} · الملّاك: ${r.owners}`,
        `متأخرون: ${r.late.length} (${sar(r.totalDue)} ريال)`, "");
      if (r.certs.length) parts.push(`⚠️ <b>شهادات</b>`, ...r.certs, "");
    }
    parts.push(`التفاصيل: ${APP}/dashboard`);
    return parts.join("\n");
  }

  return `لم أفهم الأمر. أرسل /help لعرض القائمة.`;
}

/* ============ نقطة الاستقبال ============ */
export async function POST(req: Request) {
  // تحقّق أمني: تليجرام يرسل هذا الترويسة إن ضبطتها عند تسجيل الـ webhook
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: any;
  try { update = await req.json(); } catch { return NextResponse.json({ ok: true }); }

  const msg = update?.message || update?.edited_message;
  const chatId = msg?.chat?.id ? String(msg.chat.id) : null;
  const text = msg?.text ? String(msg.text) : "";
  if (!chatId || !text) return NextResponse.json({ ok: true });

  try {
    const reply = await handle(chatId, text, msg.from);
    await sendTelegram(chatId, reply);
  } catch (e) {
    await sendTelegram(chatId, "حدث خطأ مؤقّت. جرّب مرة أخرى بعد قليل.");
  }
  return NextResponse.json({ ok: true });
}

// للتأكد من عمل المسار في المتصفّح
export async function GET() {
  return NextResponse.json({ ok: true, service: "watheq-telegram-webhook" });
}
