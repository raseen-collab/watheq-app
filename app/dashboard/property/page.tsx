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
  const { data: prof, error: profErr } = await supabase
    .from("profiles").select("account_type, role").eq("id", u.id).maybeSingle();

  /**
   * لا تبتلع خطأ الاستعلام — نفس حماية /dashboard الرئيسية.
   * فشل القراءة العابر (شبكة، جلسة باردة، انحراف ساعة) بدون هذا
   * الفحص يُقرأ «حساب بلا نوع» فيُرمى صاحب الحساب المكتمل إلى
   * شاشة الترحيب. الخطأ الصريح أهون: تحديث الصفحة يحلّه، ويصلنا أثره.
   */
  if (profErr) throw new Error(`تعذّر قراءة ملف الحساب: ${profErr.message}`);
  let type = normalizeAccountType(prof || {});
  /**
   * لا نوع في ملفه ≠ حساب جديد بالضرورة: قد يكون موظفًا في مكتب (v9).
   * نسأل «أين أعمل؟» قبل رميه لشاشة الترحيب — فيدخل لوحة مكتبه
   * بنوع حساب المكتب، وسياسات القاعدة تحدّ ما يفعله هناك.
   */
  if (!type) {
    const { data: office } = await supabase.rpc("watheq_my_office");
    const m = Array.isArray(office) ? office[0] : office;
    type = normalizeAccountType({ account_type: m?.account_type } as any);
  }
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
