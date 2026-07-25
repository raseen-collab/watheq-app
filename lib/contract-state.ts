/** ============================================================
 *  وثيق — آلة حالات العقد (Contract State Machine)
 *  تصنّف كل عقد (مستأجر) في حالة واحدة واضحة، بلون وإجراء مقترح.
 *  دالة نقيّة بلا وصول لقاعدة البيانات — سهلة الاختبار.
 *  ============================================================ */

export type StateKey = "active" | "due_soon" | "arrears" | "expiring" | "litigation";

export interface ContractState {
  key: StateKey;
  label: string;   // الاسم العربي
  dot: string;     // نقطة اللون (إيموجي)
  owed: number;    // المتأخر المتراكم (للحالة الحمراء)
  nextDue: string | null;  // تاريخ الدفعة القادمة غير المسدّدة
  endDate: string | null;  // نهاية العقد
  daysToEnd: number | null;
}

// عتبات المواصفة
const DUE_SOON_DAYS = 7;   // «يستحق قريبًا»: خلال 7 أيام أو أقل
const RENEW_DAYS = 60;     // «نافذة التجديد»: خلال 60 يومًا أو أقل
const MS_DAY = 86400000;

const daysBetween = (fromISO: string, toISO: string) =>
  Math.round((Date.parse(toISO) - Date.parse(fromISO)) / MS_DAY);

const META: Record<StateKey, { label: string; dot: string }> = {
  active:     { label: "منتظم",           dot: "🟢" },
  due_soon:   { label: "يستحق قريبًا",     dot: "🟡" },
  arrears:    { label: "متأخر",            dot: "🔴" },
  expiring:   { label: "نافذة التجديد",     dot: "🟣" },
  litigation: { label: "في التنفيذ",        dot: "⚖️" },
};

/** ترتيب الأولوية للعرض (الأكثر إلحاحًا أولًا) */
export const STATE_ORDER: StateKey[] = ["litigation", "arrears", "due_soon", "expiring", "active"];

export const stateMeta = (key: StateKey) => META[key];
export const stateLabel = (key: StateKey) => META[key]?.label || key;

/**
 * تصنيف عقد واحد.
 * @param tenant     صفّ المستأجر (contract_end, months_late, rent_amount, litigation)
 * @param invoices   فواتير هذا المستأجر فقط
 * @param todayISO   تاريخ اليوم YYYY-MM-DD
 */
export function classifyContract(tenant: any, invoices: any[], todayISO: string): ContractState {
  const unpaid = (invoices || []).filter(
    (i) => String(i.status ?? "issued").toLowerCase() === "issued" && i.due_date
  );
  const overdue = unpaid.filter((i) => String(i.due_date) < todayISO);
  const soon = unpaid.filter(
    (i) => String(i.due_date) >= todayISO && daysBetween(todayISO, String(i.due_date)) <= DUE_SOON_DAYS
  );
  const nextDue = unpaid.map((i) => String(i.due_date)).sort()[0] || null;

  const end = tenant?.contract_end ? String(tenant.contract_end) : null;
  const daysToEnd = end ? daysBetween(todayISO, end) : null;

  const overdueSum = overdue.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const monthsLate = Number(tenant?.months_late) || 0;
  const owedFallback = monthsLate * (Number(tenant?.rent_amount) || 0);
  const owed = overdueSum > 0 ? overdueSum : owedFallback;

  let key: StateKey;
  if (tenant?.litigation === true) key = "litigation";
  else if (overdue.length > 0 || monthsLate > 0) key = "arrears";
  else if (soon.length > 0) key = "due_soon";
  else if (daysToEnd !== null && daysToEnd <= RENEW_DAYS) key = "expiring";
  else key = "active";

  return { key, label: META[key].label, dot: META[key].dot, owed, nextDue, endDate: end, daysToEnd };
}
