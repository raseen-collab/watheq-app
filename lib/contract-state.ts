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
