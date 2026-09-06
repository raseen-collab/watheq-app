import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { normalizeAccountType, canSwitch } from "@/lib/roles";
import { subState } from "@/lib/subscription";
import { withClockSkewRetry, isClockSkew } from "@/lib/db-retry";
import RetryScreen from "@/components/RetryScreen";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileErr } = await withClockSkewRetry(() =>
    supabase.from("profiles").select("account_type, role, full_name, org_name, plan, trial_ends_at, subscribed_until, last_dashboard").eq("id", user.id).maybeSingle());

  /**
   * لا تبتلع خطأ الاستعلام — نفس حماية /dashboard الرئيسية.
   * فشل القراءة العابر (شبكة، جلسة باردة، انحراف ساعة) بدون هذا
   * الفحص يُقرأ «حساب بلا نوع» فيُرمى صاحب الحساب المكتمل إلى
   * شاشة الترحيب. الخطأ الصريح أهون: تحديث الصفحة يحلّه، ويصلنا أثره.
   */
  /* انحراف الساعة بعد المحاولات: شاشة لطيفة تعيد التحميل تلقائيًّا بدل صفحة خطأ */
  if (profileErr && isClockSkew(profileErr.message)) return <RetryScreen detail={profileErr.message} />;
  if (profileErr) throw new Error(`تعذّر قراءة ملف الحساب: ${profileErr.message}`);

  let accountType = normalizeAccountType(profile || {});
  /**
   * لا نوع في ملفه ≠ حساب جديد بالضرورة: قد يكون موظفًا في مكتب (v9).
   * نسأل «أين أعمل؟» قبل رميه لشاشة الترحيب — فيدخل لوحة مكتبه
   * بنوع حساب المكتب، وسياسات القاعدة تحدّ ما يفعله هناك.
   */
  let subProfile: any = profile || {};
  let name = profile?.org_name || profile?.full_name || (user.user_metadata?.name as string) || user.email || "";
  if (!accountType) {
    const { data: office } = await supabase.rpc("watheq_my_office");
    const m = Array.isArray(office) ? office[0] : office;
    accountType = normalizeAccountType({ account_type: m?.account_type } as any);
    if (m?.owner_id) {
      // موظف: اللوحة تُفتح وتُغلق باشتراك مكتبه لا بملفه الشخصي الفارغ،
      // ويظهر اسم المكتب في الترويسة ليعرف أين هو
      subProfile = m;
      name = m.org_name || name;
    }
  }
  if (!accountType) redirect("/onboarding");

  return (
    <DashboardShell
      userName={name}
      accountType={accountType}
      showSwitcher={canSwitch(accountType)}
      trialEndsAt={subProfile?.trial_ends_at}
      sub={subState(subProfile)}
    >
      {children}
    </DashboardShell>
  );
}
