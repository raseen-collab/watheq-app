import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AdvisorChat from "@/components/AdvisorChat";

export const dynamic = "force-dynamic";

/** حصّة يومية حسب الباقة — مطابقة لما في app/api/advisor/route.ts */
const QUOTA: Record<string, number> = { basic: 5, pro: 40, full: 100, default: 5 };

export default async function AdvisorPage() {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("advisor_ack_at, account_type").eq("id", user.id).maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase
    .from("advisor_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("asked_on", today);

  const limit = QUOTA[String(profile?.account_type || "")] ?? QUOTA.default;
  const remaining = Math.max(0, limit - (count || 0));

  return (
    <div className="p-5">
      <div className="max-w-2xl mx-auto mb-4">
        <Link href="/dashboard/property" className="btn btn-ghost text-sm">← رجوع للوحة</Link>
      </div>
      <AdvisorChat
        acknowledged={!!profile?.advisor_ack_at}
        remaining={remaining}
        limit={limit}
      />
    </div>
  );
}
