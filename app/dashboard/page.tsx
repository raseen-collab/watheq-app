import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { normalizeAccountType, defaultDashboard, dashboardPath } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** التوجيه التلقائي حسب نوع الحساب */
export default async function Dashboard() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles").select("account_type, role, last_dashboard").eq("id", user.id).maybeSingle();

  /**
   * لا تبتلع خطأ الاستعلام. بدون هذا الفحص يتحوّل أي فشل قراءة
   * (سياسة RLS، انقطاع، تغيير عمود) إلى profile فارغة، فيُقرأ ذلك
   * كأن الحساب بلا نوع ويُطرد المستخدم إلى /onboarding بلا أي رسالة —
   * وهو ما يبدو للمستخدم حلقة لا نهاية لها.
   */
  if (error) {
    throw new Error(`تعذّر قراءة ملف الحساب: ${error.message}`);
  }

  const type = normalizeAccountType(profile || {});
  if (!type) redirect("/onboarding");

  redirect(dashboardPath(defaultDashboard(type, profile?.last_dashboard)));
}
