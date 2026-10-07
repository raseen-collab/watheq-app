import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getOffice } from "@/lib/office";
import { productSub, productsOf, productPlan } from "@/lib/entitlements";
import { riyadhDate } from "@/lib/utils";
import SubscribeView, { type SubscribeBank, type SubscribeClaim } from "@/components/SubscribeView";

export const metadata = { title: "اشترك — وثيق" };
export const dynamic = "force-dynamic";

/**
 * صفحة «اشترك» (schema-v71): الباقة ← بيانات التحويل ← «أرسلت الحوالة».
 *
 * بيانات التحويل تُقرأ هنا على الخادم من متغيرات البيئة (WATHEQ_IBAN …)
 * وتُمرَّر لصاحب الحساب المسجَّل دخوله فقط — لا تدخل حزمة JavaScript العامة.
 */
export default async function SubscribePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/subscribe");

  const office = await getOffice(supabase);
  if (office && office.isOwner === false) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="bg-white border border-line rounded-2xl p-8">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="font-display font-bold text-deep text-lg mb-2">الاشتراك لصاحب المكتب</h1>
          <p className="text-sm text-muted leading-relaxed mb-5">
            اشتراك المكتب ودفعه يتمّان من حساب صاحب المكتب. أبلغه، وتعود كل المزايا لكم جميعًا فور التفعيل.
          </p>
          <Link href="/dashboard" className="btn btn-gold">← العودة إلى اللوحة</Link>
        </div>
      </main>
    );
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const p = (profile || {}) as any;
  const accountType = (p.account_type || "landlord") as "landlord" | "hoa_manager" | "both";

  let claims: SubscribeClaim[] = [];
  let ready = true;
  const { data: rows, error } = await supabase.from("subscription_claims")
    .select("id,prop_plan,hoa_plan,months,amount,payer_name,bank_ref,transfer_date,status,reject_reason,created_at")
    .order("created_at", { ascending: false }).limit(3);
  if (error) ready = !/does not exist|schema cache|Could not find/i.test(error.message || "");
  else claims = (rows || []) as SubscribeClaim[];

  const iban = (process.env.WATHEQ_IBAN || "").trim();
  const bank: SubscribeBank | null = iban
    ? { iban, bank: (process.env.WATHEQ_BANK || "").trim(), name: (process.env.WATHEQ_ACCOUNT_NAME || "").trim() }
    : null;

  const status = productsOf(accountType).map((pr) => {
    const s = productSub(p, pr);
    return { product: pr, plan: productPlan(p, pr), kind: s.kind, subDaysLeft: s.subDaysLeft, trialDaysLeft: s.trialDaysLeft };
  });

  return (
    <SubscribeView
      accountType={accountType}
      status={status}
      subscribedUntil={p.subscribed_until ? riyadhDate(p.subscribed_until) : null}
      claims={claims}
      bank={bank}
      ready={ready}
      today={riyadhDate(new Date())}
    />
  );
}
