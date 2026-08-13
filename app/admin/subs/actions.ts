"use server";

import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

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
    { auth: { persistSession: false } }
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

  const db = serviceDb();

  const { data: prof, error: pe } = await db
    .from("profiles")
    .select("id, subscribed_until, plan")
    .eq("id", input.userId)
    .maybeSingle();
  if (pe) return { ok: false, error: pe.message };
  if (!prof) return { ok: false, error: "الحساب غير موجود" };

  // التمديد من تاريخ الانتهاء إن كان ساريًا (فلا يخسر أيامه من جدّد مبكرًا)،
  // ومن اليوم إن كان منتهيًا (فلا يُمدَّد إلى الماضي).
  const now = new Date();
  const current = prof.subscribed_until ? new Date(prof.subscribed_until) : null;
  const startFrom = current && current > now ? current : now;
  const extended = new Date(startFrom);
  extended.setMonth(extended.getMonth() + months);

  // رقم الفاتورة: WTQ-YYYY-NNNN بترتيب السنة الحالية.
  // بلا تسلسل قاعدة بيانات — لا يوجد سوى مُصدِر واحد، والتصادم يتطلب ضغطتين
  // في اللحظة نفسها من الشخص نفسه.
  const year = now.getFullYear();
  const { count } = await db
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .gte("paid_at", `${year}-01-01`);
  const invoiceNo = `WTQ-${year}-${String((count || 0) + 1).padStart(4, "0")}`;

  const { error: ie } = await db.from("subscription_payments").insert({
    user_id: input.userId,
    invoice_no: invoiceNo,
    months,
    amount,
    plan,
    method: input.method || null,
    note: input.note || null,
    extended_to: extended.toISOString(),
  });
  if (ie) return { ok: false, error: ie.message };

  const patch: Record<string, any> = { subscribed_until: extended.toISOString() };
  if (plan) patch.plan = plan;
  const { error: ue } = await db.from("profiles").update(patch).eq("id", input.userId);
  if (ue) return { ok: false, error: `سُجّلت الدفعة لكن تعذّر تحديث الحساب: ${ue.message}` };

  revalidatePath("/admin/subs");
  revalidatePath("/admin");
  return { ok: true, extendedTo: extended.toISOString().slice(0, 10), invoiceNo };
}
