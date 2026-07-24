import { createClient } from "@/lib/supabase-server";
import PropertyView from "@/components/PropertyView";

export const dynamic = "force-dynamic";

export default async function PropertyPage() {
  const supabase = createClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("*, tenants(*), property_notes(*)")
    .order("created_at", { ascending: false });

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles").select("org_name, billing_name, vat_number, cr_number, billing_phone").eq("id", user!.id).maybeSingle();

  return <PropertyView initial={properties || []} orgName={profile?.org_name || ""} issuer={profile || {}} />;
}
