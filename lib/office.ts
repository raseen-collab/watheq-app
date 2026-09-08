// ============================================================
// وثيق — «المكتب النشط»: حسابي أنا أم مكتبٌ أعمل فيه؟
//
// المبدأ الذي يحمي البيانات: كل قراءة وكتابة بيانات عمل تمرّ عبر
// officeId لا عبر معرّف المستخدم مباشرة. للمالك الاثنان متطابقان
// فلا يتغير شيء؛ وللموظف يكون officeId هو معرّف مالك مكتبه — فتُحفظ
// الدفعة تحت المكتب لا تحت حساب الموظف الشخصي، وسياسات v9 هي التي
// تقرر هل يحق له ذلك. حساب الموظف الشخصي (ملفه، أسئلته للمستشار)
// يبقى على معرّفه هو.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type Office = {
  /** المعرّف الذي تُكتب به بيانات العمل — المالك نفسه أو صاحب المكتب */
  officeId: string;
  /** null = مالك؛ وإلا دور الموظف */
  role: "manager" | "collector" | "viewer" | null;
  isOwner: boolean;
  accountType: string | null;
  orgName: string | null;
  /** حالة اشتراك المكتب — بها تُغلق اللوحة للموظف حين ينتهي اشتراك مكتبه */
  plan: string | null;
  trialEndsAt: string | null;
  subscribedUntil: string | null;
  /** الصلاحيات الفعّالة للموظف (الدور + استثناءاته) — للإخفاء في الواجهة فقط */
  perms: Record<string, boolean>;
};

/** المالك يملك كل شيء؛ والموظف بحسب ما ترجعه القاعدة */
export const PERM_KEYS = ["record_payments", "issue_invoices", "send_reminders", "add_notes",
  "edit_tenants", "renew_contracts", "move_out", "manage_expenses", "manage_listings",
  "manage_compliance", "view_financials", "owner_links", "export_data", "view_activity", "undo_actions"] as const;
export const OWNER_PERMS: Record<string, boolean> = Object.fromEntries(PERM_KEYS.map((k) => [k, true]));
export const can = (o: Office | null, k: string) => (o ? !!o.perms[k] : true);

/** ذاكرة للجلسة الواحدة: سؤال «أين أعمل؟» لا يتغير أثناء التصفح */
let cache: { uid: string; office: Office } | null = null;

export async function getOffice(supabase: SupabaseClient): Promise<Office | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (cache && cache.uid === user.id) return cache.office;

  let office: Office = {
    officeId: user.id, role: null, isOwner: true,
    accountType: null, orgName: null, plan: null, trialEndsAt: null, subscribedUntil: null,
    perms: OWNER_PERMS,
  };

  // فشل الاستدعاء (قبل تشغيل v9b مثلًا) لا يكسر شيئًا: يُعامل الجميع مالكين
  try {
    const { data } = await supabase.rpc("watheq_my_office");
    const m = Array.isArray(data) ? data[0] : data;
    if (m?.owner_id) {
      office = {
        officeId: m.owner_id, role: m.role, isOwner: false,
        accountType: m.account_type, orgName: m.org_name,
        plan: m.plan, trialEndsAt: m.trial_ends_at, subscribedUntil: m.subscribed_until,
        perms: (m.perms as Record<string, boolean>) || {},
      };
    }
  } catch { /* يبقى مالكًا */ }

  cache = { uid: user.id, office };
  return office;
}

/** المعرّف الذي تُسجَّل به بيانات العمل. بديل مباشر لكل currentUserId قديم */
export async function officeId(supabase: SupabaseClient): Promise<string | null> {
  const o = await getOffice(supabase);
  return o?.officeId ?? null;
}

export function clearOfficeCache() { cache = null; }

export const ROLE_LABEL: Record<string, string> = {
  manager: "مدير", collector: "محصّل", viewer: "مشاهد",
};

/** رمز دعوة مقروء: بلا 0/O/1/I/l المتشابهة */
export function makeInviteCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 8; i++) s += chars[buf[i] % chars.length];
  return s;
}
