import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, org_name, trial_ends_at")
    .eq("id", user.id)
    .maybeSingle();

  // لم يختر دوره بعد → صفحة التهيئة
  if (!profile?.role) redirect("/onboarding");

  const name = profile.org_name || profile.full_name || (user.user_metadata?.name as string) || user.email || "";

  return (
    <DashboardShell
      userName={name}
      role={profile.role as "association" | "property"}
      trialEndsAt={profile.trial_ends_at}
    >
      {children}
    </DashboardShell>
  );
}
