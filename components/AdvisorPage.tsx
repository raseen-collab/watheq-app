import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AdvisorChat, { type AdvisorScope } from "@/components/AdvisorChat";
import { advisorLimit } from "@/lib/advisor";

/**
 * جسم صفحة المستشار — مشترك بين لوحتي الأملاك والجمعيات.
 * لكل لوحة مسارها الخاص حتى يبقى المستخدم داخل سياق لوحته
 * (لا يُنقل إلى اللوحة الأخرى عند فتح المستشار).
 */
export default async function AdvisorPage({ scope }: { scope: AdvisorScope }) {
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
  const home = scope === "property" ? "/dashboard/property" : "/dashboard/association";
  const homeLabel = scope === "property" ? "عقاراتي" : "جمعيتي";

  return (
    <div className="p-5">
      <div className="max-w-2xl mx-auto mb-4">
        <Link href={home} className="btn btn-ghost text-sm">← رجوع إلى {homeLabel}</Link>
      </div>
      <AdvisorChat
        acknowledged={!!profile?.advisor_ack_at}
        remaining={remaining}
        limit={limit}
        scope={scope}
      />
    </div>
  );
}
