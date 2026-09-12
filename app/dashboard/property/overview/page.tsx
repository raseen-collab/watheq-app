import { createClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/fetch-all";
import { redirect } from "next/navigation";
import Link from "next/link";
import PortfolioView from "@/components/PortfolioView";
import { withClockSkewRetry, isTransient } from "@/lib/db-retry";
import RetryScreen from "@/components/RetryScreen";

export const dynamic = "force-dynamic";

/** نظرة عامة على المحفظة كلها — لمكتب بعشرات العقارات */
export default async function OverviewPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await withClockSkewRetry(() =>
    supabase.from("profiles").select("due_soon_days, due_imminent_days, expiring_days").eq("id", user.id).maybeSingle());
  if (error && isTransient(error.message)) return <RetryScreen detail={error.message} />;

  // الوحدات على دفعات — لا قصّ صامت عند 1000 صف (انظر lib/fetch-all.ts)
  const { data: propsRaw } = await supabase
    .from("properties").select("*").order("created_at", { ascending: false });
  const allTenants = await fetchAllRows(supabase, "tenants", "*");
  const byProp: Record<string, any[]> = {};
  allTenants.forEach((t: any) => { (byProp[t.property_id] ||= []).push(t); });
  const properties = (propsRaw || []).map((p: any) => ({ ...p, tenants: byProp[p.id] || [] }));

  const windows = {
    soon: Number((profile as any)?.due_soon_days) || 10,
    imminent: Number((profile as any)?.due_imminent_days) || 5,
    expiring: Number((profile as any)?.expiring_days) || 60,
  };

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-deep text-xl">نظرة عامة على المحفظة</h1>
          <p className="text-xs text-muted">كل العقارات في صفحة واحدة — ما يحتاج إجراءً، وبحث في كل المستأجرين.</p>
        </div>
        <Link href="/dashboard/property" className="btn btn-ghost text-sm">← لوحة العقارات</Link>
      </div>
      <PortfolioView properties={properties as any[]} windows={windows} />
    </main>
  );
}
