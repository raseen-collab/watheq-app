import { createClient } from "@/lib/supabase-server";
import PropertyView from "@/components/PropertyView";
import { redirect } from "next/navigation";
import { normalizeAccountType, canAccess } from "@/lib/roles";
import { issuerMarks } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export default async function PropertyPage() {
  const supabase = createClient();
  const { data: { user: u } } = await supabase.auth.getUser();
  if (!u) redirect("/login");

  // حماية: هل يملك هذا الحساب صلاحية لوحة الأملاك؟
  const { data: prof } = await supabase
    .from("profiles").select("account_type, role").eq("id", u.id).maybeSingle();
  const type = normalizeAccountType(prof || {});
  if (!type) redirect("/onboarding");
  if (!canAccess(type, "property")) redirect("/dashboard/association");
  if (type === "both") {
    await supabase.from("profiles").update({ last_dashboard: "property" }).eq("id", u.id);
  }

  const { data: properties } = await supabase
    .from("properties")
    .select("*, tenants(*), property_notes(*)")
    .order("created_at", { ascending: false });

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles").select("org_name, billing_name, vat_number, cr_number, billing_phone, plan, trial_ends_at, subscribed_until").eq("id", user!.id).maybeSingle();

  // ثلاث حالات: مشترك = مستند نظيف · تجربة نشطة = سطر «أُنشئ عبر وثيق» · انتهت بلا اشتراك = علامة مائية
  const { trial, expired } = issuerMarks(profile);

  // ⚖️ التزامات المكتب (عقود الوساطة/الإعلانات/فال).
  // إن لم يُشغَّل schema-v6.sql بعد يعود خطأ — نمرّر [] فلا تنكسر اللوحة.
  const { data: compliance } = await supabase
    .from("compliance_items").select("*")
    .order("end_date", { ascending: true, nullsFirst: false });

  return <PropertyView initial={properties || []} orgName={profile?.org_name || ""}
    issuer={{ ...(profile || {}), trial, expired }} compliance={compliance || []} />;
}
