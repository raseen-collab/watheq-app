import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import SubsBoard from "@/components/SubsBoard";
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

  const [profRes, payRes, propRes, tenRes] = await Promise.all([
    db.from("profiles")
      .select("id,full_name,org_name,account_type,billing_phone,plan,trial_ends_at,subscribed_until,created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    db.from("subscription_payments")
      .select("id,user_id,invoice_no,months,amount,plan,method,note,paid_at,extended_to")
      .order("paid_at", { ascending: false })
      .limit(500),
    db.from("properties").select("id,user_id").limit(5000),
    db.from("tenants").select("id,property_id").limit(20000),
  ]);

  /* حجم كل حساب: الوحدات والعقارات — يُظهر ما يخسره المكتب إن انقطع،
     وهو أهم رقم في قرار المتابعة (حساب بـ140 وحدة يستحق مكالمة لا رسالة). */
  const propsOf: Record<string, string[]> = {};
  (propRes.data || []).forEach((x: any) => { (propsOf[x.user_id] ||= []).push(x.id); });
  const unitsPerProp: Record<string, number> = {};
  (tenRes.data || []).forEach((t: any) => { unitsPerProp[t.property_id] = (unitsPerProp[t.property_id] || 0) + 1; });
  const sizeOf = (uid: string) => {
    const ids = propsOf[uid] || [];
    return { properties: ids.length, units: ids.reduce((a, id) => a + (unitsPerProp[id] || 0), 0) };
  };

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

      {/* لوحة التشغيل أولًا: من أتواصل معه اليوم — ثم الجدول الكامل للمراجعة */}
      <SubsBoard accounts={rows.map((r: any) => ({ ...r, ...sizeOf(r.id) }))} />

      <h2 className="font-display font-bold text-deep text-lg mt-8 mb-3">كل الحسابات وسجل التجديدات</h2>
      <SubsAdmin rows={rows} pays={pays} />
    </div>
  );
}
