import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";
import { tgSend } from "@/lib/telegram";
import { subsDigest, type SubAccount } from "@/lib/subs-ops";
import { splitDemo } from "@/lib/real-data";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

/**
 * نبض المنصة — ملخّص يومي يصلك على تليجرام.
 *
 * الاستدعاء:  Vercel Cron يرسل الترويسة تلقائيًّا. ويدويًّا:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://app.watheqapp.com/api/admin/pulse
 *
 * 30 سبتمبر 2026: أُلغي ?key= — السر في الرابط يُحفظ في سجل المتصفح وسجلات
 * الخوادم والوكلاء وترويسة Referer. الترويسة وحدها.
 *
 * الغرض: أن تعرف أن أحدًا سجّل أو أضاف شيئًا — دون فتح أي لوحة.
 */
function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** ترويسة Authorization: Bearer <CRON_SECRET> فقط — ما يرسله Vercel Cron، وcurl يدويًّا */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** تاريخ الرياض لليوم مُزاحًا بعدد أيام (YYYY-MM-DD) */
const riyadhDay = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + offsetDays * 86400000));

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!chatId) {
    return NextResponse.json({ ok: false, error: "اضبط ADMIN_TELEGRAM_CHAT_ID أولًا" }, { status: 400 });
  }

  const db = serviceDb();
  /* 30 سبتمبر 2026: كانت النافذة «منذ 24 ساعة بتوقيت غرينتش» وتُسمّى «اليوم».
     المهمة تعمل 5 فجرًا بالرياض، فالنافذة الآن: من بداية أمس بتوقيت الرياض حتى
     لحظة التشغيل — يوم أمس كاملًا + ساعات اليوم، وبعنوان يقول ذلك صراحة. */
  const fromDay = riyadhDay(-1);
  const sinceISO = new Date(`${fromDay}T00:00:00+03:00`).toISOString();

  const [profiles, newProfiles, props, assoc, tenants, owners, team, pays, newPays] = await Promise.all([
    db.from("profiles").select("id"),
    db.from("profiles").select("id,full_name,org_name,account_type,created_at").gte("created_at", sinceISO),
    /* id مع user_id: حجم الحساب في تنبيه الاشتراكات يعدّ الوحدات بمعرّف العقار —
       كان يُجلب user_id وحده فيظهر «0 وحدة» لكل حساب. وعلى دفعات. */
    fetchAllRows(db, "properties", "id,user_id,is_demo").then((data) => ({ data, error: null as any }), (e) => ({ data: [] as any[], error: e })),
    db.from("associations").select("user_id"),
    /* بمعرّف العقار لا بالعدد المجرّد: العدد المجرّد يضمّ وحدات البذرة التجريبية
       فيظهر «العقارات 55 · الوحدات 543» — عقارات حقيقية ووحدات نصفها ديمو. */
    fetchAllRows(db, "tenants", "id,property_id").then((data) => ({ data, error: null as any }), (e) => ({ data: [] as any[], error: e })),
    db.from("owners").select("id", { count: "exact", head: true }),
    db.from("team_members").select("member_id"),
    fetchAllRows(db, "payments", "id,property_id,is_demo").then((data) => ({ data, error: null as any }), (e) => ({ data: [] as any[], error: e })),
    /* بوقت التسجيل لا بتاريخ الدفعة: دفعة تُسجَّل اليوم بتاريخ الشهر الماضي نشاطٌ اليوم */
    db.from("payments").select("amount,paid_on,property_id,is_demo").gte("created_at", sinceISO),
  ]);

  /* التعريف الواحد للبيانات الحقيقية — lib/real-data */
  const { realProperties, realTenants, realPayments } = splitDemo(
    (props.data || []) as any[], (tenants.data || []) as any[], (pays.data || []) as any[],
  );

  /* الموظفون وحسابك ليسوا حسابات عملاء: كان «الحسابات 120 (لم يبدؤوا 80)»
     بينما /admin يقول «40 حساب · 80 موظف» — رقمان لشيء واحد في شاشتين. */
  const memberIds = new Set(((team.data || []) as any[]).map((t: any) => t.member_id));
  const own = (process.env.ADMIN_USER_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const accountIds = ((profiles.data || []) as any[])
    .map((p: any) => p.id as string)
    .filter((id) => !memberIds.has(id) && !own.includes(id));
  const total = accountIds.length;
  const fresh = newProfiles.data || [];
  const withDataAll = new Set([
    ...realProperties.map((r: any) => r.user_id),
    ...(assoc.data || []).map((r: any) => r.user_id),
  ]);
  const withData = new Set(accountIds.filter((id) => withDataAll.has(id)));
  const dormant = Math.max(0, total - withData.size);
  const demoPropIds = new Set((props.data || []).filter((p: any) => p.is_demo).map((p: any) => p.id));
  const unitCount = realTenants.length;
  const payCount = realPayments.length;
  const dayPays = (newPays.data || []).filter((p: any) => !p.is_demo && (!p.property_id || !demoPropIds.has(p.property_id)));
  const dayTotal = dayPays.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

  const L: string[] = [`📈 <b>نبض وثيق — منذ بداية أمس (${fromDay}) بتوقيت الرياض</b>`, ""];

  if (fresh.length) {
    L.push(`🎉 <b>${fresh.length} حساب جديد</b>`);
    fresh.slice(0, 5).forEach((p: any) =>
      L.push(`• ${esc(p.full_name || "بلا اسم")}${p.org_name ? ` — ${esc(p.org_name)}` : ""}${p.account_type ? ` (${esc(p.account_type)})` : ""}`)
    );
    L.push("");
  } else {
    L.push("لا تسجيلات جديدة منذ أمس.", "");
  }

  if (dayPays.length) L.push(`💰 دفعات سُجّلت منذ أمس: <b>${dayPays.length}</b> بمبلغ <b>${sar(dayTotal)}</b> ﷼`, "");

  /* إن فشل جلب العقارات فلا يُعرف التجريبي من الحقيقي، وتصبح «الوحدات» كلها
     بلا مالك معروف — فكانت الرسالة تُرسل «العقارات 0 · الوحدات 543». رسالة
     تصل جواله بأرقام كاذبة أسوأ من رسالة تقول إن الجلب فشل. */
  const dataOk = !props.error && !tenants.error && !pays.error;

  L.push("— الإجمالي —");
  L.push(`• الحسابات: <b>${total}</b> (فعّلوا: ${withData.size} · لم يبدؤوا: ${dormant})`);
  if (dataOk) {
    L.push(`• العقارات: <b>${realProperties.length}</b> · الوحدات: <b>${unitCount}</b>`);
    L.push(`• الجمعيات: <b>${(assoc.data || []).length}</b> · الملّاك: <b>${owners.count || 0}</b>`);
    L.push(`• الدفعات المسجّلة: <b>${payCount}</b>`);
  } else {
    L.push("• ⚠️ تعذّر تحميل العقارات أو الوحدات أو الدفعات — الأرقام محجوبة هذه المرة لا مُقدَّرة.");
    L.push(`• الجمعيات: <b>${(assoc.data || []).length}</b> · الملّاك: <b>${owners.count || 0}</b>`);
  }

  /* تنبيه الاشتراكات: من انتهى أو يقترب — بلا هذا يعتمد التجديد على أن
     أتذكّر أنا، والمكتب لا يجدّد ما لم يُذكَّر في وقته. */
  try {
    const { data: profs2 } = await db.from("profiles")
      .select("id,org_name,full_name,billing_phone,plan,trial_ends_at,subscribed_until").limit(1000);
    const byUser: Record<string, string[]> = {};
    realProperties.forEach((x: any) => { (byUser[x.user_id] ||= []).push(x.id); });
    /* على دفعات — وحدات المنصة تتجاوز 1000 */
    const perProp: Record<string, number> = {};
    realTenants.forEach((t: any) => { perProp[t.property_id] = (perProp[t.property_id] || 0) + 1; });
    /* 30 سبتمبر 2026: الموظفون وحسابات الإدارة ليسوا مشتركين — كانوا يظهرون هنا
       «تجارب منتهية» بينما /admin/subs يستبعدهم (نفس المرشّح أعلاه). */
    const accounts: SubAccount[] = (profs2 || [])
      .filter((p: any) => !memberIds.has(p.id) && !own.includes(p.id))
      .map((p: any) => {
      const ids = byUser[p.id] || [];
      return { ...p, properties: ids.length, units: ids.reduce((a: number, id: string) => a + (perProp[id] || 0), 0) };
    });
    const sd = subsDigest(accounts);
    if (sd) { L.push("", sd); }
  } catch (e) {
    /* ثانوي — لا يعطّل النبض، لكن لا يُبتلع صامتًا */
    L.push("", "⚠️ تعذّر بناء تنبيه الاشتراكات هذه المرة.");
    Sentry.captureException(e, { tags: { job: "pulse-subs" } });
  }

  /* 30 سبتمبر 2026: فشل الإرسال كان يُبتلع — يُرسَل لـSentry (داخل tgSend) ويظهر في JSON */
  const res = await tgSend(chatId, L.join("\n"));
  const failed = res.ok ? 0 : 1;
  return NextResponse.json({ ok: !!res.ok, sent: !!res.ok, failed, ...(res.ok ? {} : { error: (res as any).error }), newSignups: fresh.length });
}

export const GET = handle;
export const POST = handle;
