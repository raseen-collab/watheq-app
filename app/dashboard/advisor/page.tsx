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

  const { data: profile } = await supabase
    .from("profiles").select("account_type, role, last_dashboard").eq("id", user.id).maybeSingle();

  const type = normalizeAccountType(profile || {});
  if (!type) redirect("/onboarding");

  const dash = defaultDashboard(type, profile?.last_dashboard);
  redirect(dash === "property" ? "/dashboard/property/advisor" : "/dashboard/association/advisor");
}
