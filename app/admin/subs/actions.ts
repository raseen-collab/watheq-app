"use server";

import { riyadhDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { noStoreFetch } from "@/lib/no-store-fetch";

/**
 * تسجيل دفعة اشتراك وتمديد الاشتراك.
 *
 * الحماية مكرّرة هنا عمدًا ولا تعتمد على حارس الصفحة:
 * أي إجراء خادم في Next هو نقطة نهاية HTTP مستقلة يمكن استدعاؤها مباشرةً.
 */
function serviceDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, global: { fetch: noStoreFetch } }
  );
}

async function requireAdmin(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مصرّح");
  const allowed = (process.env.ADMIN_USER_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length || !allowed.includes(user.id)) throw new Error("غير مصرّح");
  return user.id;
}

export type RecordResult =
  | { ok: true; extendedTo: string; invoiceNo: string }
  | { ok: false; error: string };

export async function recordSubPayment(input: {
  userId: string;
  months: number;
  amount: number;
  plan: string | null;   // "" أو null = بلا تغيير
  /** باقة الجمعيات في الحساب المزدوج (v67) — "" أو null = بلا تغيير */
  hoaPlan?: string | null;
  method: string;
  note: string;
}): Promise<RecordResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "غير مصرّح" };
  }

  const months = Math.floor(Number(input.months) || 0);
  if (months < 1 || months > 36) return { ok: false, error: "عدد الأشهر غير صالح" };

  const amount = Number(input.amount) || 0;
  if (amount < 0) return { ok: false, error: "المبلغ غير صالح" };

  const plan = input.plan && ["basic", "pro", "full"].includes(input.plan) ? input.plan : null;
  const hoaPlan = input.hoaPlan && ["basic", "pro", "full"].includes(input.hoaPlan) ? input.hoaPlan : null;

  const db = serviceDb();

  const { data: prof, error: pe } = await db
    .from("profiles")
    .select("*")   // «*»: hoa_plan وaccount_type (v67) دون كسر ما قبل الترحيل
    .eq("id", input.userId)
    .maybeSingle();
  if (pe) return { ok: false, error: pe.message };
  if (!prof) return { ok: false, error: "الحساب غير موجود" };
  /* 30 سبتمبر 2026: سُجّل شهر لحساب باقته ليست مدفوعة و«الباقة: بلا تغيير» —
     فامتدّ subscribed_until وظهر مشتركًا هنا، بينما لوحته تبقى «تجربة» لأن
     subState لا يعدّ الحساب مدفوعًا إلا بباقة مدفوعة. لا دفعة بلا باقة. */
  const paidPl = (v?: string | null) => ["basic", "pro", "full"].includes(String(v || "").toLowerCase());
  const isBoth = (prof as any).account_type === "both";
  const propOk = paidPl(plan || (prof as any).plan);
  const hoaOk = isBoth && paidPl(hoaPlan || (prof as any).hoa_plan);
  if (!propOk && !hoaOk) {
    return { ok: false, error: "هذا الحساب بلا باقة مدفوعة — اختر الباقة قبل التسجيل، وإلا يبقى في وضع التجربة عند صاحبه." };
  }
  if (hoaPlan && !isBoth) return { ok: false, error: "باقة الجمعيات المنفصلة للحساب المزدوج فقط." };

  // التمديد من تاريخ الانتهاء إن كان ساريًا (فلا يخسر أيامه من جدّد مبكرًا)،
  // ومن اليوم إن كان منتهيًا (فلا يُمدَّد إلى الماضي).
  const now = new Date();
  const current = prof.subscribed_until ? new Date(prof.subscribed_until) : null;
  const startFrom = current && current > now ? current : now;
  const extended = new Date(startFrom);
  extended.setMonth(extended.getMonth() + months);

  // رقم الفاتورة: WTQ-YYYY-NNNN بترتيب السنة (سنة الرياض).
  /* 30 سبتمبر 2026: كان «عدد صفوف السنة + 1» — حذف صفٍّ واحد يعيد رقمًا صدر،
     وضغطتان متزامنتان تُعطيان الرقم نفسه. الآن: التالي بعد أعلى رقم صدر فعلًا،
     ومع تصادم فرادة (23505) نعيد بالرقم التالي. ⚠️ إعادة المحاولة لا تعمل إلا مع
     فهرس فريد على invoice_no — تنشئه schema-v59 إن لم تكن فيه أرقام مكرَّرة. */
  const year = riyadhDate(now).slice(0, 4);
  const prefix = `WTQ-${year}-`;
  const { data: last } = await db
    .from("subscription_payments")
    .select("invoice_no")
    .like("invoice_no", `${prefix}%`)
    .order("invoice_no", { ascending: false })
    .limit(1);
  let seq = (Number(String(last?.[0]?.invoice_no || "").slice(prefix.length)) || 0) + 1;

  let invoiceNo = "";
  let paymentId: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    invoiceNo = `${prefix}${String(seq).padStart(4, "0")}`;
    const { data: ins, error: ie } = await db.from("subscription_payments").insert({
      user_id: input.userId,
      invoice_no: invoiceNo,
      months,
      amount,
      plan,
      method: input.method || null,
      note: [input.note || "", hoaPlan ? `باقة الجمعيات: ${hoaPlan}` : ""].filter(Boolean).join(" · ") || null,
      extended_to: extended.toISOString(),
    }).select("id").single();
    if (!ie) { paymentId = (ins as any)?.id ?? null; break; }
    if ((ie as any).code === "23505") { seq++; continue; }   // رقم أُخذ للتو — التالي
    return { ok: false, error: ie.message };
  }
  if (!paymentId) return { ok: false, error: "تعذّر حجز رقم فاتورة بعد عدة محاولات — أعد المحاولة." };

  /* تحديث الحساب بعد نجاح الدفعة فقط. فإن فشل نحذف الدفعة (تعويض) لئلا تُعاد
     المحاولة فتُسجَّل دفعتان لتجديد واحد. الذرّية الكاملة تحتاج دالة SQL واحدة. */
  const patch: Record<string, any> = { subscribed_until: extended.toISOString() };
  if (plan) patch.plan = plan;
  if (hoaPlan) patch.hoa_plan = hoaPlan;
  const { error: ue } = await db.from("profiles").update(patch).eq("id", input.userId);
  if (ue) {
    const { error: rb } = await db.from("subscription_payments").delete().eq("id", paymentId);
    return { ok: false, error: rb
      ? `سُجّلت الدفعة (${invoiceNo}) لكن تعذّر تحديث الحساب: ${ue.message} — ولم يُتراجع عنها، راجعها يدويًّا.`
      : `تعذّر تحديث الحساب: ${ue.message} — أُلغيت الدفعة، أعد المحاولة.` };
  }

  revalidatePath("/admin/subs");
  revalidatePath("/admin");
  return { ok: true, extendedTo: riyadhDate(extended), invoiceNo };
}

/**
 * اسم ومنشأة «إلى» لفاتورة دفعة واحدة (schema-v72).
 * يُحفظ على الدفعة لا على الحساب — فإعادة الطباعة تخرج بالاسم نفسه.
 * فارغ = يعود لاسم الحساب ومنشأته.
 */
export async function setSubInvoiceBillTo(
  paymentId: string, name: string, org: string,
): Promise<{ ok: true; name: string | null; org: string | null } | { ok: false; error: string }> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرّح" }; }
  const clean = (v: string) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
  const n = clean(name), o = clean(org);
  const { data, error } = await serviceDb().from("subscription_payments")
    .update({ bill_to_name: n, bill_to_org: o }).eq("id", paymentId).select("id");
  if (error) {
    const missing = /bill_to_(name|org)|schema cache|does not exist/i.test(error.message || "");
    return { ok: false, error: missing ? "شغّل schema-v72-sub-invoice-billto.sql في Supabase أولًا." : error.message };
  }
  if (!data?.length) return { ok: false, error: "الدفعة غير موجودة — حدّث الصفحة." };
  revalidatePath("/admin/subs");
  return { ok: true, name: n, org: o };
}

/**
 * توقيع صاحب المنصة على فواتير الاشتراك (schema-v72 · platform_settings).
 * صورة PNG/JPEG واحدة؛ null = حذف التوقيع والعودة لخط التوقيع الفارغ.
 */
export async function saveInvoiceSignature(
  dataUrl: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرّح" }; }
  const v = dataUrl ? String(dataUrl) : null;
  if (v && !(v.length <= 400000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v))) {
    return { ok: false, error: "الصورة غير صالحة أو كبيرة — استعمل PNG أو JPG أصغر." };
  }
  const db = serviceDb();
  const { error } = v
    ? await db.from("platform_settings").upsert({ key: "invoice_signature", value: v, updated_at: new Date().toISOString() })
    : await db.from("platform_settings").delete().eq("key", "invoice_signature");
  if (error) {
    const missing = /platform_settings|schema cache|does not exist/i.test(error.message || "");
    return { ok: false, error: missing ? "شغّل schema-v72-sub-invoice-billto.sql في Supabase أولًا." : error.message };
  }
  revalidatePath("/admin/subs");
  return { ok: true };
}
