import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { normalizeAccountType, defaultDashboard, dashboardPath } from "@/lib/roles";
import { withClockSkewRetry, isClockSkew } from "@/lib/db-retry";
import RetryScreen from "@/components/RetryScreen";

export const dynamic = "force-dynamic";

/** التوجيه التلقائي حسب نوع الحساب */
export default async function Dashboard() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await withClockSkewRetry(() =>
    supabase.from("profiles").select("account_type, role, last_dashboard").eq("id", user.id).maybeSingle());

  /**
   * لا تبتلع خطأ الاستعلام. بدون هذا الفحص يتحوّل أي فشل قراءة
   * (سياسة RLS، انقطاع، تغيير عمود) إلى profile فارغة، فيُقرأ ذلك
   * كأن الحساب بلا نوع ويُطرد المستخدم إلى /onboarding بلا أي رسالة —
   * وهو ما يبدو للمستخدم حلقة لا نهاية لها.
   */
  /* انحراف الساعة بعد المحاولات: شاشة لطيفة تعيد التحميل تلقائيًّا بدل صفحة خطأ */
  if (error && isClockSkew(error.message)) return <RetryScreen detail={error.message} />;
  if (error) {
    throw new Error(`تعذّر قراءة ملف الحساب: ${error.message}`);
  }

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

  redirect(dashboardPath(defaultDashboard(type, profile?.last_dashboard)));
}
