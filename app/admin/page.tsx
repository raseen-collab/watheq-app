import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * لوحة الإدارة — للقراءة فقط.
 *
 * الحماية: قائمة معرّفات في متغيّر البيئة ADMIN_USER_IDS (مفصولة بفاصلة).
 * لا تعتمد على حقل في قاعدة البيانات عمدًا — الحقل قد يرفعه المستخدم لنفسه
 * إن كانت سياسة التحديث على profiles سخيّة، أما متغيّر البيئة فلا يُمسّ.
 */
function serviceDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const dayISO = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const fmt = (v?: string | null) => (v ? String(v).slice(0, 10) : "—");

export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const allowed = (process.env.ADMIN_USER_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  // لا نكشف وجود الصفحة لغير المصرّح لهم
  if (!allowed.length || !allowed.includes(user.id)) notFound();

  const db = serviceDb();

  const [profilesRes, propsRes, tenantsRes, assocRes, ownersRes, paysRes, invRes, budgetsRes] =
    await Promise.all([
      db.from("profiles").select("id,full_name,org_name,account_type,created_at,trial_ends_at,telegram_chat_id,last_digest_at").order("created_at", { ascending: false }).limit(500),
      db.from("properties").select("id,user_id,created_at"),
      db.from("tenants").select("id,status,rent_amount,property_id"),
      db.from("associations").select("id,user_id,created_at,fee"),
      db.from("owners").select("id,association_id,months_late"),
      db.from("payments").select("id,user_id,amount,paid_on"),
      db.from("invoices").select("id,user_id,status"),
      db.from("association_budgets").select("id,user_id,year"),
    ]);

  const profiles = profilesRes.data || [];
  const properties = propsRes.data || [];
  const tenants = tenantsRes.data || [];
  const associations = assocRes.data || [];
  const owners = ownersRes.data || [];
  const payments = paysRes.data || [];
  const invoices = invRes.data || [];
  const budgets = budgetsRes.data || [];

  const errors = [profilesRes, propsRes, tenantsRes, assocRes, ownersRes, paysRes, invRes, budgetsRes]
    .map((r) => r.error?.message).filter(Boolean) as string[];

  // ---------- مقاييس ----------
  const now = Date.now();
  const week = daysAgo(7).getTime();
  const month = daysAgo(30).getTime();

  const newWeek = profiles.filter((p) => p.created_at && Date.parse(p.created_at) >= week).length;
  const newMonth = profiles.filter((p) => p.created_at && Date.parse(p.created_at) >= month).length;
  const linked = profiles.filter((p) => p.telegram_chat_id).length;
  const trialLive = profiles.filter((p) => p.trial_ends_at && Date.parse(p.trial_ends_at) >= now).length;
  const trialOver = profiles.filter((p) => p.trial_ends_at && Date.parse(p.trial_ends_at) < now).length;

  // التفعيل: من أضاف عقارًا أو جمعية فعلًا
  const withProp = new Set(properties.map((p) => p.user_id));
  const withAssoc = new Set(associations.map((a) => a.user_id));
  const activated = profiles.filter((p) => withProp.has(p.id) || withAssoc.has(p.id));
  const dormant = profiles.filter((p) => !withProp.has(p.id) && !withAssoc.has(p.id));
  const activationPct = profiles.length ? Math.round((activated.length / profiles.length) * 100) : 0;

  const paidTotal = payments.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const vacant = tenants.filter((t) => String(t.status) === "vacated").length;
  const propById: Record<string, string> = {};
  properties.forEach((p) => (propById[p.id] = p.user_id));

  const perUser = (uid: string) => ({
    props: properties.filter((p) => p.user_id === uid).length,
    units: tenants.filter((t) => propById[t.property_id!] === uid).length,
    assoc: associations.filter((a) => a.user_id === uid).length,
    pays: payments.filter((p) => p.user_id === uid).length,
  });

  const K = ({ v, l, tone }: { v: string; l: string; tone?: "ok" | "warn" | "gold" }) => (
    <div className="bg-white border border-line rounded-xl p-4 shadow-sm">
      <div className={`font-display font-bold text-2xl leading-none ${
        tone === "ok" ? "text-paid" : tone === "warn" ? "text-late" : tone === "gold" ? "text-gold" : "text-deep"}`}>{v}</div>
      <div className="mt-1.5 text-sm text-muted">{l}</div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-5">
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl">لوحة الإدارة</h1>
          <div className="text-sm text-muted">قراءة فقط · محدَّثة {dayISO(new Date())}</div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 mb-4 text-sm">
          تعذّر جلب بعض البيانات: {errors.join(" · ")}
        </div>
      )}

      {/* الحسابات */}
      <h2 className="font-semibold text-deep mb-2">الحسابات</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <K v={String(profiles.length)} l="إجمالي الحسابات" />
        <K v={String(newWeek)} l="جديدة هذا الأسبوع" tone={newWeek ? "ok" : undefined} />
        <K v={`${activationPct}%`} l={`فعّلوا فعلًا (${activated.length})`} tone={activationPct >= 50 ? "ok" : "warn"} />
        <K v={String(dormant.length)} l="سجّلوا ولم يضيفوا شيئًا" tone={dormant.length ? "warn" : undefined} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <K v={String(newMonth)} l="جديدة خلال 30 يومًا" />
        <K v={String(trialLive)} l="تجربة سارية" tone="gold" />
        <K v={String(trialOver)} l="تجربة منتهية" tone={trialOver ? "warn" : undefined} />
        <K v={String(linked)} l="ربطوا تليجرام" />
      </div>

      {/* النشاط */}
      <h2 className="font-semibold text-deep mb-2">النشاط على المنصة</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <K v={String(properties.length)} l="عقارات" />
        <K v={String(tenants.length)} l={`وحدات (${vacant} شاغرة)`} />
        <K v={String(associations.length)} l="جمعيات" />
        <K v={String(owners.length)} l="ملّاك" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <K v={String(payments.length)} l="دفعات مسجّلة" tone={payments.length ? "ok" : undefined} />
        <K v={sar(paidTotal)} l="إجمالي المسجّل (ريال)" />
        <K v={String(invoices.length)} l="فواتير صادرة" />
        <K v={String(budgets.length)} l="موازنات جمعيات" />
      </div>

      {/* الحسابات الأخيرة */}
      <h2 className="font-semibold text-deep mb-2">آخر الحسابات</h2>
      <div className="bg-white border border-line rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper2"><tr>
              <th className="p-2.5 text-right font-semibold">الاسم</th>
              <th className="p-2.5 text-right font-semibold">الجهة</th>
              <th className="p-2.5 text-right font-semibold">النوع</th>
              <th className="p-2.5 text-right font-semibold">التسجيل</th>
              <th className="p-2.5 text-right font-semibold">التجربة</th>
              <th className="p-2.5 text-right font-semibold">تليجرام</th>
              <th className="p-2.5 text-right font-semibold">ما أضافه</th>
            </tr></thead>
            <tbody>
              {profiles.slice(0, 25).map((p) => {
                const u = perUser(p.id);
                const active = u.props + u.assoc > 0;
                return (
                  <tr key={p.id} className={`border-t border-line ${active ? "" : "bg-[#FBF8F1]"}`}>
                    <td className="p-2.5 font-semibold">{p.full_name || "—"}</td>
                    <td className="p-2.5 text-muted">{p.org_name || "—"}</td>
                    <td className="p-2.5 text-muted">{p.account_type || "—"}</td>
                    <td className="p-2.5 tabular-nums text-muted">{fmt(p.created_at)}</td>
                    <td className="p-2.5 tabular-nums text-muted">
                      {p.trial_ends_at
                        ? (Date.parse(p.trial_ends_at) >= now
                            ? <span className="text-paid font-semibold">حتى {fmt(p.trial_ends_at)}</span>
                            : <span className="text-late">انتهت {fmt(p.trial_ends_at)}</span>)
                        : "—"}
                    </td>
                    <td className="p-2.5">{p.telegram_chat_id ? "✅" : "—"}</td>
                    <td className="p-2.5 text-xs">
                      {active
                        ? <span className="text-deep">{u.props ? `${u.props} عقار · ${u.units} وحدة` : ""}{u.props && u.assoc ? " · " : ""}{u.assoc ? `${u.assoc} جمعية` : ""}{u.pays ? ` · ${u.pays} دفعة` : ""}</span>
                        : <span className="text-late font-semibold">لم يبدأ</span>}
                    </td>
                  </tr>
                );
              })}
              {!profiles.length && (
                <tr><td colSpan={7} className="p-8 text-center text-muted">لا حسابات بعد.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted leading-relaxed">
        هذه الصفحة للقراءة فقط ولا تسمح بتعديل بيانات أي مستخدم.
        الوصول محكوم بمتغيّر البيئة <code>ADMIN_USER_IDS</code>، ومن ليس فيه ترجع له الصفحة كأنها غير موجودة.
      </p>
    </div>
  );
}
