import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import SettingsView from "@/components/SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return <SettingsView profile={profile || { id: user.id }} />;
}
