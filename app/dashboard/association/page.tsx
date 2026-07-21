import { createClient } from "@/lib/supabase-server";
import AssociationView from "@/components/AssociationView";

export const dynamic = "force-dynamic";

export default async function AssociationPage() {
  const supabase = createClient();
  const { data: associations } = await supabase
    .from("associations")
    .select("*, owners(*), association_notes(*)")
    .order("created_at", { ascending: false });

  return <AssociationView initial={associations || []} />;
}
