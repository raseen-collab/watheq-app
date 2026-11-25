import { createClient } from "@/lib/supabase-server";
import OfficeLedgerView from "@/components/OfficeLedgerView";
import { redirect } from "next/navigation";
import Link from "next/link";
import { normalizeAccountType, canAccess } from "@/lib/roles";
import { getOfficeContext } from "@/lib/office-context";
import { withClockSkewRetry, isTransient } from "@/lib/db-retry";
import RetryScreen from "@/components/RetryScreen";

export const metadata = { title: "حسابات المكتب — وثيق" };

export const dynamic = "force-dynamic";

/** 📒 دفتر حسابات المكتب (schema-v84): دخل المكتب ومصروفاته وصافيه — منفصلًا عن حساب المالك */
export default async function OfficeLedgerPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // نفس حماية لوحة الأملاك (انظر صفحة الصيانة)
  const { data: profile, error: profileErr } = await withClockSkewRetry(() =>
    supabase.from("profiles").select("account_type, role").eq("id", user.id).maybeSingle());
  if (profileErr && isTransient(profileErr.message)) return <RetryScreen detail={profileErr.message} />;
  if (profileErr) throw new Error(`تعذّر قراءة ملف الحساب: ${profileErr.message}`);

  let type = normalizeAccountType(profile || {});
  if (!type) {
    const { data: office } = await supabase.rpc("watheq_my_office");
    const m = Array.isArray(office) ? office[0] : office;
    type = normalizeAccountType({ account_type: m?.account_type } as any);
  }
  if (!type) redirect("/onboarding");
  if (!canAccess(type, "property")) redirect("/dashboard/association");

  /* ملف المكتب: اسمه والرقم الضريبي (ضريبة الأتعاب تُحتسب فقط لمكتب مسجَّل ضريبيًّا — كتقرير المالك) */
  const office = await getOfficeContext(supabase, user.id);
  if ((office as any)?.transientError) return <RetryScreen detail={(office as any).transientError} />;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap print:hidden">
        <div>
          <h1 className="font-display font-bold text-deep text-xl">📒 حسابات المكتب</h1>
          <p className="text-xs text-muted">دخل مكتبك (أتعاب، سعي، رسوم توثيق) ومصروفاته وصافيه — منفصل عن حسابات الملّاك.</p>
        </div>
        <Link href="/dashboard/property" className="btn btn-ghost text-sm">→ لوحة العقارات</Link>
      </div>
      <OfficeLedgerView orgName={(office as any)?.org_name || ""} issuer={{ vat_number: (office as any)?.vat_number || null }} />
    </main>
  );
}
