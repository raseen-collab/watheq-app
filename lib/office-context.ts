/**
 * سياق المكتب على الخادم: من يعمل المستخدم لحسابه، وباقته، وهويته على المستندات.
 *
 * المالك يقرأ ملفه؛ والموظف يقرأ ملف مكتبه عبر watheq_my_entitlements
 * (schema-v67 — الموظف لا يقرأ صفّ مالكه في profiles مباشرة).
 *
 * قبل v67 (أو إن فشل الاستدعاء): القراءة القديمة — ملف المالك، وللموظف
 * watheq_my_office — مع enforced=false، فلا تُحجب الواجهة بحدود لم تُحسب
 * من مصدرها (القاعدة هي المانع الحقيقي).
 */
import type { EntProfile } from "./entitlements";
import { withClockSkewRetry, isTransient } from "./db-retry";

export type OfficeContext = EntProfile & {
  office_id?: string | null;
  isStaff: boolean;
  org_name?: string | null;
  full_name?: string | null;
  billing_name?: string | null;
  vat_number?: string | null;
  cr_number?: string | null;
  billing_phone?: string | null;
  due_soon_days?: number | null;
  due_imminent_days?: number | null;
  expiring_days?: number | null;
  /** الحالة محسوبة من القاعدة (v67) — تُطبَّق حدود الواجهة */
  enforced: boolean;
  /** فشل عابر بعد المحاولات (انحراف ساعة/شبكة) — الصفحة تعرض شاشة إعادة المحاولة */
  transientError?: string;
};

const OWN_COLS = "account_type, plan, trial_ends_at, subscribed_until, org_name, full_name, billing_name, vat_number, cr_number, billing_phone, due_soon_days, due_imminent_days, expiring_days";

export async function getOfficeContext(supabase: any, userId: string): Promise<OfficeContext> {
  let transient: string | undefined;
  try {
    const { data, error } = await withClockSkewRetry<any>(() => supabase.rpc("watheq_my_entitlements"));
    if (!error && data && typeof data === "object") {
      const d: any = data;
      return {
        office_id: d.office_id, isStaff: !!d.office_id && d.office_id !== userId,
        account_type: d.account_type, plan: d.plan, hoa_plan: d.hoa_plan,
        trial_ends_at: d.trial_ends_at, subscribed_until: d.subscribed_until,
        ...(d.issuer || {}), ...(d.windows || {}),
        enforced: true,
      };
    }
    if (error && isTransient(String(error.message))) transient = String(error.message);
  } catch { /* قبل v67 */ }

  const { data: own, error: ownErr } = await withClockSkewRetry<any>(() =>
    supabase.from("profiles").select(OWN_COLS).eq("id", userId).maybeSingle());
  if (ownErr && isTransient(String(ownErr.message))) transient = transient || String(ownErr.message);

  // موظف (ملفه بلا نوع): باقة مكتبه وهويته من watheq_my_office — لا ملفه الفارغ
  if (!own?.account_type) {
    try {
      const { data: office } = await supabase.rpc("watheq_my_office");
      const m = Array.isArray(office) ? office[0] : office;
      if (m?.owner_id) {
        return {
          office_id: m.owner_id, isStaff: true, account_type: m.account_type, org_name: m.org_name,
          plan: m.plan, trial_ends_at: m.trial_ends_at, subscribed_until: m.subscribed_until,
          enforced: false, transientError: transient,
        };
      }
    } catch { /* يبقى ملفه */ }
  }
  return { ...(own || {}), office_id: userId, isStaff: false, enforced: false, transientError: transient };
}
