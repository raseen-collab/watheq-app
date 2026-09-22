import { today } from "@/lib/utils";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/fetch-all";
import { ownerReportHTML, termRentPaidOf, pastVatOf, type PastVat, ownerConsolidatedStatementHTML, type OwnerStatementSection } from "@/lib/documents";
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
    .select("id, user_id, property_id, property_ids, owner_name, revoked, expires_at")
    .eq("token", token).maybeSingle();
  if (!link || link.revoked) return deny("هذا الرابط لم يعد فعّالًا");
  /* تاريخ الرياض: كان الرابط المنتهي يعمل 3 ساعات بعد منتصف ليل الرياض */
  if (link.expires_at && String(link.expires_at).slice(0, 10) < today()) {
    return deny("انتهت صلاحية هذا الرابط");
  }

  // فترة التقرير: الشهر الحالي حتى اليوم — «حي» يعني أرقام لحظة الفتح.
  // الرابط المجمّع يقبل ?from=YYYY-MM&to=YYYY-MM ليرى المالك أي فترة يشاء.
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");

  /**
   * منتقي فترة للمالك داخل الصفحة.
   *
   * الرابط يقبل ?from&to منذ البداية، لكن لا أحد يعدّل رابطًا بيده — فكان
   * المالك يرى الشهر الحالي فقط ويتصل بالمكتب لطلب تقرير الربع أو السنة.
   * شريط صغير لا يظهر عند الطباعة.
   */
  const periodPicker = (fromYm: string, toYm: string) => `
<div class="noprint" style="max-width:900px;margin:10px auto 0;padding:10px 14px;background:#F6F2E8;border:1px solid #E3DCCB;border-radius:12px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;direction:rtl">
  <form method="get" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
    <label style="font-size:12px;color:#5C6B67">من شهر<br><input type="month" name="from" value="${fromYm}" style="padding:6px 8px;border:1px solid #E3DCCB;border-radius:8px;font-size:13px"></label>
    <label style="font-size:12px;color:#5C6B67">إلى شهر<br><input type="month" name="to" value="${toYm}" style="padding:6px 8px;border:1px solid #E3DCCB;border-radius:8px;font-size:13px"></label>
    <button type="submit" style="padding:7px 16px;background:#14594A;color:#F6F1E4;border:0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">عرض الفترة</button>
    <span style="font-size:11px;color:#8A8477">الأرقام محدَّثة لحظة الفتح</span>
  </form>
</div>`;
  const ymNow = `${now.getFullYear()}-${p2(now.getMonth() + 1)}`;

  // ---------- الرابط المجمّع: كل عقارات المالك (schema-v13) ----------
  /* نطاقان مجمَّعان يشتركان في العرض: كل عقارات المالك، أو قائمة مختارة */
  const idList: string[] | null = Array.isArray((link as any).property_ids) && (link as any).property_ids.length
    ? (link as any).property_ids : null;
  if (!link.property_id && (link.owner_name || idList)) {
    const q = new URL(_req.url).searchParams;
    const ymOk = (v: string | null) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
    const fromYm = ymOk(q.get("from")) || ymNow;
    const toYm = ymOk(q.get("to")) || ymNow;
    if (fromYm > toYm) return deny("الفترة غير صحيحة");
    const from = `${fromYm}-01`;
    const [ty, tm] = [Number(toYm.slice(0, 4)), Number(toYm.slice(5, 7))];
    const toFull = `${toYm}-${p2(new Date(ty, tm, 0).getDate())}`;
    const to = toYm === ymNow ? `${ymNow}-${p2(now.getDate())}` : toFull;
    const lab = (ym: string) => `${AR_MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
    const label = (fromYm === toYm ? lab(fromYm) : `${lab(fromYm)} — ${lab(toYm)}`) + (toYm === ymNow ? " (حتى اليوم)" : "");

    /* الحصر بـ user_id في كل فرع: المسار يعمل بمفتاح الخدمة المتجاوز
       للصلاحيات، فالقيد هنا هو الحاجز الوحيد بين المكاتب عند القراءة. */
    let pq = db.from("properties").select("*, tenants(*)").limit(2000, { referencedTable: "tenants" })
      .eq("user_id", link.user_id);
    pq = idList ? pq.in("id", idList) : pq.eq("owner_name", link.owner_name as string);
    const { data: props } = await pq;
    if (!props?.length) return deny("لا عقارات مسجّلة لهذا المالك");
    const ids = props.map((p: any) => p.id);

    const fetchAll = async (table: string, select: string, dateCol: string) => {
      const out: any[] = [];
      for (let i = 0; ; i += 1000) {
        const { data } = await db.from(table).select(select).in("property_id", ids)
          .gte(dateCol, from).lte(dateCol, to).order(dateCol, { ascending: true }).order("id", { ascending: true }).range(i, i + 999);
        out.push(...(data || []));
        if (!data || data.length < 1000 || out.length > 50000) break;
      }
      return out;
    };
    const [pays, exps, { data: profile }] = await Promise.all([
      fetchAll("payments", "*", "paid_on"),
      fetchAll("expenses", "*", "spent_on"),
      db.from("profiles").select("org_name, billing_name, vat_number, cr_number, billing_phone, plan, trial_ends_at, subscribed_until")
        .eq("id", link.user_id).maybeSingle(),
    ]);
    /* إعدادات الضريبة للمستأجرين السابقين — لضريبة دفعاتهم */
    let pastVat: PastVat | undefined;
    try {
      const { data: pastRows } = await db.from("past_tenancies").select("id, snapshot").in("property_id", props.map((p: any) => p.id)).limit(5000);
      pastVat = pastVatOf(pastRows as any);
    } catch { pastVat = undefined; }
    const sections: OwnerStatementSection[] = props.map((p: any) => {
      const byId: Record<string, any> = {};
      (p.tenants || []).forEach((t: any) => { byId[t.id] = t; });
      return {
        property: p,
        payments: pays.filter((x) => x.property_id === p.id).map((x) => ({
          ...x, tenant_name: (x.tenant_id && byId[x.tenant_id]?.name) || x.payer_name || null, unit: (x.tenant_id && byId[x.tenant_id]?.unit) || x.unit_label || null,
        })),
        expenses: exps.filter((x) => x.property_id === p.id),
        fee_pct: p.mgmt_fee_pct,
        pastVat,
      };
    });
    const marks = issuerMarks(profile || {});
    /* القائمة المختارة قد لا يحمل رابطها اسم مالك — نأخذه من عقاراتها */
    const ownerTitle = (link.owner_name as string | null)
      || [...new Set(props.map((p: any) => (p.owner_name || "").trim()).filter(Boolean))].join(" · ")
      || "عقارات مختارة";
    const html = ownerConsolidatedStatementHTML(ownerTitle, sections, { label, from, to },
      { ...(profile || {}), trial: marks.trial, expired: marks.expired });
    const withPicker = html.replace("<body>", `<body>${periodPicker(fromYm, toYm)}`);
  return new Response(withPicker, { headers: {
      "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store",
    } });
  }

  /* كان يقرأ العقار بمعرّفه وحده — فرابطٌ أُنشئ لعقار مكتب آخر يكشفه.
     الحصر بـ user_id يغلقها عند القراءة حتى لو تسرّب رابط كهذا. */
  const { data: property } = await db.from("properties")
    .select("*, tenants(*)").limit(2000, { referencedTable: "tenants" })
    .eq("id", link.property_id).eq("user_id", link.user_id).maybeSingle();
  if (!property) return deny("العقار لم يعد موجودًا");

  /* الفترة يختارها المالك كما في الرابط المجمّع: ?from=2026-01&to=2026-06
     كان رابط العقار الواحد مثبّتًا على الشهر الحالي، فيضطر المالك لطلب
     تقرير الربع أو السنة من المكتب هاتفيًّا. */
  const q = new URL(_req.url).searchParams;
  const ymOk = (v: string | null) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
  const fromYm = ymOk(q.get("from")) || ymNow;
  const toYm = ymOk(q.get("to")) || ymNow;
  if (fromYm > toYm) return deny("الفترة غير صحيحة");
  const from = `${fromYm}-01`;
  const [ty2, tm2] = [Number(toYm.slice(0, 4)), Number(toYm.slice(5, 7))];
  const to = toYm === ymNow ? `${ymNow}-${p2(now.getDate())}` : `${toYm}-${p2(new Date(ty2, tm2, 0).getDate())}`;
  const label = fromYm === toYm
    ? `${AR_MONTHS[Number(fromYm.slice(5, 7)) - 1]} ${fromYm.slice(0, 4)}${toYm === ymNow ? " (حتى اليوم)" : ""}`
    : `${AR_MONTHS[Number(fromYm.slice(5, 7)) - 1]} ${fromYm.slice(0, 4)} — ${AR_MONTHS[Number(toYm.slice(5, 7)) - 1]} ${toYm.slice(0, 4)}`;

  /**
   * بلا قصّ صامت.
   *
   * الحدّان السابقان (1000 دفعة و500 مصروف) يكفيان سنةً ويسقطان عند «منذ
   * البداية» لعقار كبير بعد سنوات: يفتح المالك رابطه فيرى صافيًا ناقصًا،
   * ولا أحد يعلم — لا هو ولا المكتب. وهذا أخطر مسار في المنصة لأنه يخرج
   * من يد المكتب تمامًا. الجلب على دفعات حتى ينتهي الجدول فعلًا.
   */
  const [pays, exps, { data: profile }] = await Promise.all([
    fetchAllRows(db as any, "payments", "*",
      (q) => q.eq("property_id", link.property_id).gte("paid_on", from).lte("paid_on", to).order("paid_on", { ascending: true })),
    fetchAllRows(db as any, "expenses", "*",
      (q) => q.eq("property_id", link.property_id).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: true })),
    db.from("profiles").select("org_name, billing_name, vat_number, cr_number, billing_phone, plan, trial_ends_at, subscribed_until")
      .eq("id", link.user_id).maybeSingle(),
  ]);

  const byId: Record<string, any> = {};
  for (const t of (property as any).tenants || []) byId[t.id] = t;
  const payments = (pays || []).map((x: any) => ({
    ...x, tenant_name: (x.tenant_id && byId[x.tenant_id]?.name) || x.payer_name || null, unit: (x.tenant_id && byId[x.tenant_id]?.unit) || x.unit_label || null,
  }));

  /* أقساط كل ساكن في مدته (كل الأوقات) — لملاحظة الرصيد الافتتاحي. إن تعذّر
     الجلب يُصدَر التقرير بلا الملاحظة، لا برقم خاطئ. */
  let termRentPaid: Record<string, number> | undefined;
  try {
    const allPays = await fetchAllRows(db as any, "payments", "*",
      (q) => q.eq("property_id", link.property_id).not("tenant_id", "is", null));
    termRentPaid = termRentPaidOf((property as any).tenants || [], (allPays || []) as any);
  } catch { termRentPaid = undefined; }

  let pastVat: PastVat | undefined;
  try {
    const { data: pastRows } = await db.from("past_tenancies").select("id, snapshot").eq("property_id", link.property_id).limit(2000);
    pastVat = pastVatOf(pastRows as any);
  } catch { pastVat = undefined; }

  const { trial, expired } = issuerMarks(profile || {});
  const html = ownerReportHTML(
    property as any,
    { label, from, to },
    payments,
    { ...(profile || {}), trial, expired },
    { expenses: (exps || []) as any, fee_pct: (property as any).mgmt_fee_pct, termRentPaid, pastVat },
    "full",   // المالك يفتح رابطه ليرى كل شيء — لا ملخصًا
  );

  const withPicker = html.replace("<body>", `<body>${periodPicker(fromYm, toYm)}`);
  return new Response(withPicker, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // صفحة سرّية بالرمز: لا فهرسة ولا تخزين وسيط
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
    },
  });
}
