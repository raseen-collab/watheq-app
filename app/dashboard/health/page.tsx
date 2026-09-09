import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import DataHealth from "@/components/DataHealth";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

/** فحص سلامة البيانات — يجد الخلل قبل أن يكتشفه المكتب في تقرير مالك */
export default async function HealthPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: propsRaw } = await supabase.from("properties").select("*").order("created_at", { ascending: false });
  const allTenants = await fetchAllRows(supabase, "tenants", "*");
  const byProp: Record<string, any[]> = {};
  allTenants.forEach((t: any) => { (byProp[t.property_id] ||= []).push(t); });
  const properties = (propsRaw || []).map((p: any) => ({ ...p, tenants: byProp[p.id] || [] }));

  return <DataHealth initial={properties} />;
}
