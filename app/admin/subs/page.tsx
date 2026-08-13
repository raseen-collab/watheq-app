import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import SubsAdmin, { type SubRow, type PayRow } from "@/components/SubsAdmin";

export const dynamic = "force-dynamic";

function serviceDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export default async function AdminSubsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const allowed = (process.env.ADMIN_USER_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length || !allowed.includes(user.id)) notFound();

  const db = serviceDb();

  const [profRes, payRes] = await Promise.all([
    db.from("profiles")
      .select("id,full_name,org_name,account_type,billing_phone,plan,trial_ends_at,subscribed_until,created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    db.from("subscription_payments")
      .select("id,user_id,invoice_no,months,amount,plan,method,note,paid_at,extended_to")
      .order("paid_at", { ascending: false })
      .limit(500),
  ]);

  const error = profRes.error?.message || payRes.error?.message || null;
  const rows = (profRes.data || []) as SubRow[];
  const pays = (payRes.data || []) as PayRow[];

  return (
    <div className="max-w-6xl mx-auto p-5">
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl">الاشتراكات والتجديد</h1>
          <div className="text-sm text-muted">تسجيل السداد يدويًّا وإصدار فاتورة الاشتراك</div>
        </div>
        <Link href="/admin" className="btn btn-ghost text-sm">← لوحة الإدارة</Link>
      </div>

      {error && (
        <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 mb-4 text-sm">
          تعذّر جلب البيانات: {error}
          <div className="mt-1 text-xs">
            إن كانت الرسالة تذكر <code>subscribed_until</code> أو <code>subscription_payments</code>،
            فلم يُشغَّل <code>schema-v8-subs.sql</code> بعد.
          </div>
        </div>
      )}

      <SubsAdmin rows={rows} pays={pays} />
    </div>
  );
}
