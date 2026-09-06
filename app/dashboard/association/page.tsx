import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import AssociationView from "@/components/AssociationView";
import { normalizeAccountType, canAccess } from "@/lib/roles";
import { issuerMarks } from "@/lib/subscription";
import { withClockSkewRetry, isClockSkew } from "@/lib/db-retry";
import RetryScreen from "@/components/RetryScreen";

export const dynamic = "force-dynamic";

export default async function AssociationPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // حماية: هل يملك هذا الحساب صلاحية لوحة الجمعيات؟
  const { data: profile, error: profileErr } = await withClockSkewRetry(() =>
    supabase.from("profiles").select("account_type, role, plan, trial_ends_at, subscribed_until, billing_name, vat_number, cr_number, billing_phone").eq("id", user.id).maybeSingle());

  /**
   * لا تبتلع خطأ الاستعلام — نفس حماية /dashboard الرئيسية.
   * فشل القراءة العابر (شبكة، جلسة باردة، انحراف ساعة) بدون هذا
   * الفحص يُقرأ «حساب بلا نوع» فيُرمى صاحب الحساب المكتمل إلى
   * شاشة الترحيب. الخطأ الصريح أهون: تحديث الصفحة يحلّه، ويصلنا أثره.
   */
  /* انحراف الساعة بعد المحاولات: شاشة لطيفة تعيد التحميل تلقائيًّا بدل صفحة خطأ */
  if (profileErr && isClockSkew(profileErr.message)) return <RetryScreen detail={profileErr.message} />;
  if (profileErr) throw new Error(`تعذّر قراءة ملف الحساب: ${profileErr.message}`);
  let type = normalizeAccountType(profile || {});
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
