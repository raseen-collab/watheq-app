import { createClient } from "@/lib/supabase-server";
import PropertyView from "@/components/PropertyView";

export const dynamic = "force-dynamic";

export default async function PropertyPage() {
  const supabase = createClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("*, tenants(*), property_notes(*)")
    .order("created_at", { ascending: false });

  return <PropertyView initial={properties || []} />;
}
