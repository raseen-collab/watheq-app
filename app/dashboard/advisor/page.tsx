import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AdvisorChat from "@/components/AdvisorChat";
import { advisorLimit } from "@/lib/advisor";

export const dynamic = "force-dynamic";

export default async function AdvisorPage() {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("advisor_ack_at, plan, trial_ends_at").eq("id", user.id).maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase
    .from("advisor_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("asked_on", today);

  const limit = advisorLimit(profile);
  const remaining = Math.max(0, limit - (count || 0));

  return (
    <div className="p-5">
      <div className="max-w-2xl mx-auto mb-4">
        <Link href="/dashboard" className="btn btn-ghost text-sm">← رجوع للوحة</Link>
      </div>
      <AdvisorChat
        acknowledged={!!profile?.advisor_ack_at}
        remaining={remaining}
        limit={limit}
      />
    </div>
  );
}
