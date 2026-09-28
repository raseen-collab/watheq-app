import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import SubsBoard from "@/components/SubsBoard";
import SubsAdmin, { type SubRow, type PayRow } from "@/components/SubsAdmin";
import { fetchAllRows } from "@/lib/fetch-all";
import { splitDemo } from "@/lib/real-data";
import { withClockSkewRetry } from "@/lib/db-retry";
import { bankBlock } from "@/lib/subs-ops";

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

  /* انحراف الساعة يضرب هذه الصفحة كما يضرب /admin — ورُصد عليها فعلًا في
     28 سبتمبر: سقط جدول subscription_payments وحده بـ«JWT issued at future»
     فظهر «إجمالي المحصَّل 0» و«آخر دفعة —» لكل حساب، بينما الأسماء تُعرض
     سليمة. وهذا أسوأ من صفحة فارغة: من يسجّل دفعة ثم يرى صفرًا يظنّها لم
     تُسجَّل فيسجّلها ثانية — تمديد مضاعف وفاتورتا اشتراك لدفعة واحدة.
     الصفحة تقرأ بمفتاح الخدمة ولا حلقة إعادة تحميل فيها، فإعادة المحاولة
     هنا هي الفرق بين رقم صحيح ورقم كاذب على صفحة تمسّ المال. */
  const [profRes, payRes, propRes, tenRes, teamRes] = await Promise.all([
    withClockSkewRetry(() => db.from("profiles")
      .select("id,full_name,org_name,account_type,billing_phone,plan,trial_ends_at,subscribed_until,created_at")
      .order("created_at", { ascending: false })
      .limit(1000)),
    withClockSkewRetry(() => db.from("subscription_payments")
      .select("id,user_id,invoice_no,months,amount,plan,method,note,paid_at,extended_to")
      .order("paid_at", { ascending: false })
      .limit(500)),
    /* على دفعات: وحدات المنصة كلها وعقاراتها تتجاوز 1000 (كل حساب جرّب التجربة
       يضيف ~80 وحدة)، وSupabase يقصّ عندها بصمت — فكان «حجم الحساب» الذي تُبنى
       عليه قرارات المتابعة والتسعير ناقصًا */
    fetchAllRows(db, "properties", "id,user_id,is_demo").then((data) => ({ data, error: null as any }), (e) => ({ data: [] as any[], error: e })),
    fetchAllRows(db, "tenants", "id,property_id").then((data) => ({ data, error: null as any }), (e) => ({ data: [] as any[], error: e })),
    /* سقوط هذه وحدها يُظهر الموظفين كمكاتب مستقلّة في «من أتواصل معه اليوم» */
    withClockSkewRetry(() => db.from("team_members").select("member_id")),
  ]);

  /* حجم كل حساب: الوحدات والعقارات — يُظهر ما يخسره المكتب إن انقطع،
     وهو أهم رقم في قرار المتابعة (حساب بـ140 وحدة يستحق مكالمة لا رسالة). */
  /* بذرة التجربة تُستثنى (lib/real-data): بلا ذلك يظهر حساب لم يُدخل شيئًا
     بحجم «5 عقار · 80 وحدة» فتُبنى عليه مكالمة متابعة لا محلّ لها. */
  const { realProperties, realTenants } = splitDemo(
    (propRes.data || []) as any[], (tenRes.data || []) as any[], [],
  );
  const propsOf: Record<string, string[]> = {};
  realProperties.forEach((x: any) => { (propsOf[x.user_id] ||= []).push(x.id); });
  const unitsPerProp: Record<string, number> = {};
  realTenants.forEach((t: any) => { unitsPerProp[t.property_id] = (unitsPerProp[t.property_id] || 0) + 1; });
  const sizeOf = (uid: string) => {
    const ids = propsOf[uid] || [];
    return { properties: ids.length, units: ids.reduce((a, id) => a + (unitsPerProp[id] || 0), 0) };
  };

  const error = profRes.error?.message || payRes.error?.message || null;
  /* الموظف له صفّ profiles بتجربة 30 يومًا ولا اشتراك له، فبعد انقضائها كان
     يظهر «انتهى» في قائمة «من أتواصل معه اليوم» مع زر واتساب لتجديد اشتراك
     لا وجود له — بمكتبين لكل أربعين مكتبًا: 80 اسمًا وهميًّا. وحسابك أنت
     مشترك إداريًّا حتى 2028 فكان يظهر «اشتراك ساري 1» بينما /admin يقول صفر. */
  const memberIds = new Set(((teamRes.data || []) as any[]).map((t) => t.member_id));
  const rows = ((profRes.data || []) as SubRow[])
    .filter((r: any) => !memberIds.has(r.id) && !allowed.includes(r.id));
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
      <SubsBoard accounts={rows.map((r: any) => ({ ...r, ...sizeOf(r.id) }))} bankText={bankBlock()} />

      <h2 className="font-display font-bold text-deep text-lg mt-8 mb-3">كل الحسابات وسجل التجديدات</h2>
      <SubsAdmin rows={rows} pays={pays} paysFailed={!!payRes.error} />
    </div>
  );
}
