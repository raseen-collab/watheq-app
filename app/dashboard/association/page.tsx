import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import AssociationView from "@/components/AssociationView";
import { normalizeAccountType, canAccess } from "@/lib/roles";
import { issuerMarks } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export default async function AssociationPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // حماية: هل يملك هذا الحساب صلاحية لوحة الجمعيات؟
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("account_type, role, plan, trial_ends_at, subscribed_until, billing_name, vat_number, cr_number, billing_phone")
    .eq("id", user.id).maybeSingle();

  /**
   * لا تبتلع خطأ الاستعلام — نفس حماية /dashboard الرئيسية.
   * فشل القراءة العابر (شبكة، جلسة باردة، انحراف ساعة) بدون هذا
   * الفحص يُقرأ «حساب بلا نوع» فيُرمى صاحب الحساب المكتمل إلى
   * شاشة الترحيب. الخطأ الصريح أهون: تحديث الصفحة يحلّه، ويصلنا أثره.
   */
  if (profileErr) throw new Error(`تعذّر قراءة ملف الحساب: ${profileErr.message}`);
  const type = normalizeAccountType(profile || {});
  if (!type) redirect("/onboarding");
  if (!canAccess(type, "association")) redirect("/dashboard/property");

  // تذكّر آخر لوحة (للحساب المزدوج)
  if (type === "both") {
    await supabase.from("profiles").update({ last_dashboard: "association" }).eq("id", user.id);
  }

  const { data: associations } = await supabase
    .from("associations")
    .select("*, owners(*), association_notes(*)")
    .order("created_at", { ascending: false });

  // ثلاث حالات: مشترك = مستند نظيف · تجربة نشطة = سطر «أُنشئ عبر وثيق» · انتهت بلا اشتراك = علامة مائية
  const { trial, expired } = issuerMarks(profile);

  return (
    <AssociationView
      initial={associations || []}
      issuer={{
        billing_name: profile?.billing_name ?? null,
        vat_number: profile?.vat_number ?? null,
        cr_number: profile?.cr_number ?? null,
        billing_phone: profile?.billing_phone ?? null,
        trial,
        expired,
      }}
    />
  );
}
