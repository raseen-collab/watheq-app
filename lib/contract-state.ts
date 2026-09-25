import { isVacant } from "./contracts";
/** ============================================================
 *  وثيق — تسميات وألوان حالات العقد (طبقة عرض فقط)
 *  الحساب الفعلي يتم في lib/contracts.ts (نفس مصدر لوحة التحكّم).
 *  هذا الملف يحوّل ناتج contractState + علم التنفيذ إلى «حالة» معروضة.
 *  ============================================================ */

export type StateKey = "active" | "due_soon" | "arrears" | "expiring" | "litigation" | "vacant";

const RENEW_DAYS = 60; // نافذة التجديد — مطابقة لـ needsRenewal في contracts.ts

const META: Record<StateKey, { label: string; dot: string }> = {
  active:     { label: "منتظم",        dot: "🟢" },
  due_soon:   { label: "يستحق قريبًا",  dot: "🟡" },
  arrears:    { label: "متأخر",         dot: "🔴" },
  expiring:   { label: "نافذة التجديد",  dot: "🟣" },
  litigation: { label: "في التنفيذ",     dot: "⚖️" },
  vacant:     { label: "شاغرة",          dot: "⚪" },
};

export const STATE_ORDER: StateKey[] = ["litigation", "arrears", "due_soon", "expiring", "vacant", "active"];
export const stateMeta = (key: StateKey) => META[key];
export const stateLabel = (key: StateKey) => META[key]?.label || key;

/**
 * يشتقّ الحالة من ناتج contractState + المستأجر.
 * st: ناتج contractState(t)  ·  tenant: صفّ المستأجر (فيه litigation)
 */
export function deriveState(
  st: { status: "late" | "soon" | "ok"; daysToEnd: number | null; vacant?: boolean },
  tenant: any
): StateKey {
  // الشغور يتقدّم على كل شيء — لا «متأخر» ولا «ينتهي قريبًا» لوحدة فارغة
  if (st.vacant || String(tenant?.status || "") === "vacated") return "vacant";
  if (tenant?.litigation === true) return "litigation";
  if (st.status === "late") return "arrears";
  if (st.status === "soon") return "due_soon";
  if (st.daysToEnd !== null && st.daysToEnd <= RENEW_DAYS) return "expiring";
  return "active";
}


/**
 * حالة الوحدة كما تعرضها اللوحة — منقولة حرفيًّا من rowKey في PropertyView، فيستعملها
 * الموقع والمستندات معًا. كان «سجل الوحدات» في رابط المالك يصنّف بمنطق مختصر لا
 * يعرف «مستحق» ولا «قريب»: دفعة تستحق اليوم ظهرت «مستحق» في اللوحة و«منتظم» في
 * التقرير (عمارة الزهراء، مكتب عمرو باعبدالله).
 */
export type UnitStatus = "vacant" | "litigation" | "incomplete" | "late" | "partial" | "due" | "soon" | "expiring" | "ok";
export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  vacant: "شاغرة", litigation: "في التنفيذ", late: "متأخر", partial: "سداد جزئي", incomplete: "بيانات ناقصة",
  due: "مستحق", soon: "قريب", expiring: "ينتهي قريبًا", ok: "منتظم",
};
export function unitStatus(t: any, st: { incomplete?: boolean; status: string; hasPartial?: boolean; soonTier?: string | null; expiringSoon?: boolean; daysToEnd?: number | null }): UnitStatus {
  if (isVacant(t)) return "vacant";
  if (st.incomplete) return "incomplete";
  if (t?.litigation) return "litigation";
  if (st.status === "late") return st.hasPartial ? "partial" : "late";
  if (st.status === "soon") return st.soonTier === "near" ? "soon" : "due";
  /* عقد انتهى ولم يُسجَّل إخلاء ولا تجديد: كان «منتظم» أخضر، وفلتر التجديد لا يعدّه */
  if (st.expiringSoon || (st.daysToEnd != null && st.daysToEnd < 0)) return "expiring";
  return "ok";
}
/** الاسم المعروض: «ينتهي قريبًا» لعقد انتهى فعلًا كذب — يُسمّى «انتهى العقد» */
export function unitStatusLabel(key: UnitStatus, st: { daysToEnd?: number | null }): string {
  return key === "expiring" && st.daysToEnd != null && st.daysToEnd < 0 ? "انتهى العقد" : UNIT_STATUS_LABEL[key];
}
