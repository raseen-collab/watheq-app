import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import AssociationView from "@/components/AssociationView";
import { normalizeAccountType, canAccess } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AssociationPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // حماية: هل يملك هذا الحساب صلاحية لوحة الجمعيات؟
  const { data: profile } = await supabase
    .from("profiles").select("account_type, role").eq("id", user.id).maybeSingle();
  const type = normalizeAccountType(profile || {});
  if (!type) redirect("/onboarding");
  if (!canAccess(type, "association")) redirect("/dashboard/property");

  // تذكّر آخر لوحة (للحساب المزدوج)
  if (type === "both") {
    await supabase.from("profiles").update({ last_dashboard: "association" }).eq("id", user.id);
  }

  const { data: associations } = await supabase
    .from("associations")
    .select("*, owners(*), association_notes(*)")
    .order("created_at", { ascending: false });

  return <AssociationView initial={associations || []} />;
}
