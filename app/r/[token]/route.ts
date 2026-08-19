import { createClient as createAdmin } from "@supabase/supabase-js";
import { ownerReportHTML } from "@/lib/documents";
import { issuerMarks } from "@/lib/subscription";

export const dynamic = "force-dynamic";

/**
 * 🔗 صفحة المالك العامة — /r/{token}
 * تقرير الشهر الحالي حيًّا للقراءة فقط، بلا حساب.
 *
 * الأمان بطبقات:
 *  1) الرمز 48 خانة hex عشوائية — لا يُخمَّن عمليًّا.
 *  2) يُرفض المُبطَل والمنتهي، ويُرفض أي رمز بغير الشكل المتوقع قبل أي استعلام.
 *  3) نقرأ بمفتاح الخدمة لكن فقط الصفوف المرتبطة بهذا الرمز تحديدًا،
 *     ولا نُخرج شيئًا سوى HTML التقرير (لا JSON ولا معرّفات).
 */
const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

const deny = (msg: string, status = 404) =>
  new Response(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>وثيق</title></head>
<body style="font-family:Tahoma,sans-serif;display:grid;place-items:center;min-height:90vh;background:#F6F8F7;color:#0B211F">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:2rem">🔒</div>
<h1 style="font-size:1.1rem">${msg}</h1>
<p style="font-size:.85rem;color:#5C6B67">اطلب من مكتب إدارة الأملاك رابطًا محدّثًا.</p></div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } },
  );

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  // شكل الرمز ثابت من مولّدنا — أي شيء آخر يُرفض قبل لمس القاعدة
  if (!/^[0-9a-f]{48}$/.test(token)) return deny("هذا الرابط غير صالح");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return deny("الخدمة غير مهيأة", 500);
  const db = createAdmin(url, key, { auth: { persistSession: false } });

  const { data: link } = await db.from("owner_links")
    .select("id, user_id, property_id, revoked, expires_at")
    .eq("token", token).maybeSingle();
  if (!link || link.revoked) return deny("هذا الرابط لم يعد فعّالًا");
  if (link.expires_at && String(link.expires_at) < new Date().toISOString().slice(0, 10)) {
    return deny("انتهت صلاحية هذا الرابط");
  }

  const { data: property } = await db.from("properties")
    .select("*, tenants(*)").eq("id", link.property_id).maybeSingle();
  if (!property) return deny("العقار لم يعد موجودًا");

  // فترة التقرير: الشهر الحالي حتى اليوم — «حي» يعني أرقام لحظة الفتح
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ym = `${now.getFullYear()}-${p2(now.getMonth() + 1)}`;
  const from = `${ym}-01`;
  const to = `${ym}-${p2(now.getDate())}`;
  const label = `${AR_MONTHS[now.getMonth()]} ${now.getFullYear()} (حتى اليوم)`;

  const [{ data: pays }, { data: exps }, { data: profile }] = await Promise.all([
    db.from("payments").select("id,paid_on,amount,method,periods_covered,note,tenant_id")
      .eq("property_id", link.property_id).gte("paid_on", from).lte("paid_on", to)
      .order("paid_on", { ascending: true }).limit(1000),
    db.from("expenses").select("*").eq("property_id", link.property_id)
      .gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: true }).limit(500),
    db.from("profiles").select("org_name, billing_name, vat_number, cr_number, billing_phone, plan, trial_ends_at, subscribed_until")
      .eq("id", link.user_id).maybeSingle(),
  ]);

  const byId: Record<string, any> = {};
  for (const t of (property as any).tenants || []) byId[t.id] = t;
  const payments = (pays || []).map((x: any) => ({
    ...x, tenant_name: byId[x.tenant_id]?.name || null, unit: byId[x.tenant_id]?.unit || null,
  }));

  const { trial, expired } = issuerMarks(profile || {});
  const html = ownerReportHTML(
    property as any,
    { label, from, to },
    payments,
    { ...(profile || {}), trial, expired },
    { expenses: (exps || []) as any, fee_pct: (property as any).mgmt_fee_pct },
  );

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // صفحة سرّية بالرمز: لا فهرسة ولا تخزين وسيط
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
    },
  });
}
