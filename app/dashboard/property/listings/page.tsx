import { createClient } from "@/lib/supabase-server";
import ListingsView from "@/components/ListingsView";
import { redirect } from "next/navigation";
import { normalizeAccountType, canAccess } from "@/lib/roles";
import { issuerMarks } from "@/lib/subscription";
import { withClockSkewRetry, isClockSkew } from "@/lib/db-retry";
import RetryScreen from "@/components/RetryScreen";

export const dynamic = "force-dynamic";

export default async function ListingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // نفس حماية لوحة الأملاك — السجل جزء منها لا صفحة مستقلة
  const { data: profile, error: profileErr } = await withClockSkewRetry(() =>
    supabase.from("profiles").select("account_type, role, org_name, billing_name, vat_number, cr_number, billing_phone, plan, trial_ends_at, subscribed_until").eq("id", user.id).maybeSingle());

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
  if (!canAccess(type, "property")) redirect("/dashboard/association");

  // إن لم يُشغَّل schema-v7 بعد يعود خطأ — نمرّر [] فلا تنكسر الصفحة
  const { data: listings } = await supabase
    .from("listings").select("*").order("created_at", { ascending: false });

  // عقود الوساطة وحدها للربط (schema-v6) — تحذّر من معروض مفتوح بعقد منتهٍ
  const { data: brokerages } = await supabase
    .from("compliance_items").select("*").eq("kind", "brokerage")
    .order("end_date", { ascending: true, nullsFirst: false });

  // طلبات الباحثين (schema-v8) — غيابها يعطّل تبويب الطلبات لا الصفحة
  const { data: requests } = await supabase
    .from("seeker_requests").select("*").order("created_at", { ascending: false });

  const { trial, expired } = issuerMarks(profile);

  return (
    <ListingsView
      initial={listings || []}
      brokerages={brokerages || []}
      requests={(requests || []) as any}
      orgName={profile?.org_name || ""}
      issuer={{ ...(profile || {}), trial, expired }}
    />
  );
}
