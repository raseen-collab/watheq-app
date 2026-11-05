import { createClient } from "@/lib/supabase-server";
import MaintenanceView from "@/components/MaintenanceView";
import { redirect } from "next/navigation";
import { normalizeAccountType, canAccess } from "@/lib/roles";
import { getOfficeContext } from "@/lib/office-context";
import { withClockSkewRetry, isTransient } from "@/lib/db-retry";
import RetryScreen from "@/components/RetryScreen";

export const metadata = { title: "الصيانة — وثيق" };

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // نفس حماية لوحة الأملاك — قسم الصيانة جزء منها (schema-v70 + v79)
  const { data: profile, error: profileErr } = await withClockSkewRetry(() =>
    supabase.from("profiles").select("account_type, role, org_name, billing_name, vat_number, cr_number, billing_phone, plan, trial_ends_at, subscribed_until").eq("id", user.id).maybeSingle());

  /**
   * لا تبتلع خطأ الاستعلام — نفس حماية /dashboard الرئيسية.
   * فشل القراءة العابر (شبكة، جلسة باردة، انحراف ساعة) بدون هذا
   * الفحص يُقرأ «حساب بلا نوع» فيُرمى صاحب الحساب المكتمل إلى
   * شاشة الترحيب. الخطأ الصريح أهون: تحديث الصفحة يحلّه، ويصلنا أثره.
   */
  /* انحراف الساعة بعد المحاولات: شاشة لطيفة تعيد التحميل تلقائيًّا بدل صفحة خطأ */
  if (profileErr && isTransient(profileErr.message)) return <RetryScreen detail={profileErr.message} />;
  if (profileErr) throw new Error(`تعذّر قراءة ملف الحساب: ${profileErr.message}`);

  let type = normalizeAccountType(profile || {});
  /**
   * لا نوع في ملفه ≠ حساب جديد بالضرورة: قد يكون موظفًا في مكتب (v9).
   * نسأل «أين أعمل؟» قبل رميه لشاشة الترحيب — فيدخل لوحة مكتبه
   * بنوع حساب المكتب، وسياسات القاعدة تحدّ ما يفعله هناك.
   */
  if (!type) {
    const { data: office } = await supabase.rpc("watheq_my_office");
    const m = Array.isArray(office) ? office[0] : office;
    type = normalizeAccountType({ account_type: m?.account_type } as any);
  }
  if (!type) redirect("/onboarding");
  if (!canAccess(type, "property")) redirect("/dashboard/association");

  /* البيانات تُحمَّل في المتصفح (الطلبات والعقارات والمستأجرين) — سياسات القاعدة تحدّ ما يراه الموظف */
  const office = await getOfficeContext(supabase, user.id);
  return <MaintenanceView orgName={office?.org_name || ""} />;
}
