import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { normalizeAccountType, defaultDashboard } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * مسار قديم — صار لكل لوحة مستشارها الخاص.
 * يُحوّل هنا إلى مستشار اللوحة المناسبة حتى لا تنكسر أي روابط محفوظة.
 */
export default async function AdvisorRedirect() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileErr } = await supabase
    .from("profiles").select("account_type, role, last_dashboard").eq("id", user.id).maybeSingle();

  /**
   * لا تبتلع خطأ الاستعلام — نفس حماية /dashboard الرئيسية.
   * فشل القراءة العابر (شبكة، جلسة باردة، انحراف ساعة) بدون هذا
   * الفحص يُقرأ «حساب بلا نوع» فيُرمى صاحب الحساب المكتمل إلى
   * شاشة الترحيب. الخطأ الصريح أهون: تحديث الصفحة يحلّه، ويصلنا أثره.
   */
  if (profileErr) throw new Error(`تعذّر قراءة ملف الحساب: ${profileErr.message}`);

  const type = normalizeAccountType(profile || {});
  if (!type) redirect("/onboarding");

  const dash = defaultDashboard(type, profile?.last_dashboard);
  redirect(dash === "property" ? "/dashboard/property/advisor" : "/dashboard/association/advisor");
}
