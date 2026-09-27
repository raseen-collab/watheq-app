import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tgSend } from "@/lib/telegram";
import { subsDigest, type SubAccount } from "@/lib/subs-ops";
import { splitDemo } from "@/lib/real-data";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

/**
 * نبض المنصة — ملخّص يومي يصلك على تليجرام.
 *
 * الاستدعاء:  GET /api/admin/pulse?key=CRON_SECRET
 * اربطه بـ Vercel Cron ليصلك تلقائيًّا، أو افتحه يدويًّا وقت ما تشاء.
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

/**
 * يقبل طريقتين للتحقّق:
 *  1) ترويسة Authorization: Bearer <CRON_SECRET> — وهي ما يرسله Vercel Cron تلقائيًّا
 *  2) ?key=<CRON_SECRET> — للتشغيل اليدوي من المتصفّح
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("key") === secret;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!chatId) {
    return NextResponse.json({ ok: false, error: "اضبط ADMIN_TELEGRAM_CHAT_ID أولًا" }, { status: 400 });
  }

  const db = serviceDb();
  const since = new Date(); since.setDate(since.getDate() - 1);
  const sinceISO = since.toISOString();

  const [profiles, newProfiles, props, assoc, tenants, owners, pays, newPays] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("profiles").select("id,full_name,org_name,account_type,created_at").gte("created_at", sinceISO),
    /* id مع user_id: حجم الحساب في تنبيه الاشتراكات يعدّ الوحدات بمعرّف العقار —
       كان يُجلب user_id وحده فيظهر «0 وحدة» لكل حساب. وعلى دفعات. */
    fetchAllRows(db, "properties", "id,user_id,is_demo").then((data) => ({ data, error: null as any }), (e) => ({ data: [] as any[], error: e })),
    db.from("associations").select("user_id"),
    /* بمعرّف العقار لا بالعدد المجرّد: العدد المجرّد يضمّ وحدات البذرة التجريبية
       فيظهر «العقارات 55 · الوحدات 543» — عقارات حقيقية ووحدات نصفها ديمو. */
    fetchAllRows(db, "tenants", "id,property_id").then((data) => ({ data, error: null as any }), (e) => ({ data: [] as any[], error: e })),
    db.from("owners").select("id", { count: "exact", head: true }),
    fetchAllRows(db, "payments", "id,property_id").then((data) => ({ data, error: null as any }), (e) => ({ data: [] as any[], error: e })),
    db.from("payments").select("amount,paid_on,property_id").gte("paid_on", sinceISO.slice(0, 10)),
  ]);

  /* التعريف الواحد للبيانات الحقيقية — lib/real-data */
  const { realProperties, realTenants, realPayments } = splitDemo(
    (props.data || []) as any[], (tenants.data || []) as any[], (pays.data || []) as any[],
  );

  const total = profiles.count || 0;
  const fresh = newProfiles.data || [];
  const withData = new Set([
    ...realProperties.map((r: any) => r.user_id),
    ...(assoc.data || []).map((r: any) => r.user_id),
  ]);
  const dormant = Math.max(0, total - withData.size);
  const demoPropIds = new Set((props.data || []).filter((p: any) => p.is_demo).map((p: any) => p.id));
  const unitCount = realTenants.length;
  const payCount = realPayments.length;
  const dayPays = (newPays.data || []).filter((p: any) => !p.property_id || !demoPropIds.has(p.property_id));
  const dayTotal = dayPays.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

  const L: string[] = ["📈 <b>نبض وثيق — آخر 24 ساعة</b>", ""];

  if (fresh.length) {
    L.push(`🎉 <b>${fresh.length} حساب جديد</b>`);
    fresh.slice(0, 5).forEach((p: any) =>
      L.push(`• ${esc(p.full_name || "بلا اسم")}${p.org_name ? ` — ${esc(p.org_name)}` : ""}${p.account_type ? ` (${esc(p.account_type)})` : ""}`)
    );
    L.push("");
  } else {
    L.push("لا تسجيلات جديدة اليوم.", "");
  }

  if (dayPays.length) L.push(`💰 دفعات اليوم: <b>${dayPays.length}</b> بمبلغ <b>${sar(dayTotal)}</b> ﷼`, "");

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
    const accounts: SubAccount[] = (profs2 || []).map((p: any) => {
      const ids = byUser[p.id] || [];
      return { ...p, properties: ids.length, units: ids.reduce((a: number, id: string) => a + (perProp[id] || 0), 0) };
    });
    const sd = subsDigest(accounts);
    if (sd) { L.push("", sd); }
  } catch { /* ثانوي — لا يعطّل النبض */ }

  const res = await tgSend(chatId, L.join("\n"));
  return NextResponse.json({ ok: !!res.ok, sent: res.ok, newSignups: fresh.length });
}

export const GET = handle;
export const POST = handle;
