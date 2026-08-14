import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { normalizeAccountType, canSwitch } from "@/lib/roles";
import { subState } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_type, role, full_name, org_name, plan, trial_ends_at, subscribed_until, last_dashboard")
    .eq("id", user.id)
    .maybeSingle();

  const accountType = normalizeAccountType(profile || {});
  if (!accountType) redirect("/onboarding");

  const name = profile?.org_name || profile?.full_name || (user.user_metadata?.name as string) || user.email || "";

  return (
    <DashboardShell
      userName={name}
      accountType={accountType}
      showSwitcher={canSwitch(accountType)}
      trialEndsAt={profile?.trial_ends_at}
      sub={subState(profile || {})}
    >
      {children}
    </DashboardShell>
  );
}
