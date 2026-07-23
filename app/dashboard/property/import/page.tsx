import { createClient } from "@/lib/supabase-server";
import ImportView from "@/components/ImportView";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const supabase = createClient();
  const { data: properties } = await supabase
    .from("properties").select("id, name, property_type").order("created_at", { ascending: false });
  return <ImportView properties={properties || []} />;
}
