// ============================================================
// محرّك العقود — يستنتج كل شيء من: تاريخ البداية + الدورة + القيمة
// ============================================================

export type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";

export const FREQUENCIES: { value: Frequency; label: string; short: string }[] = [
  { value: "daily",      label: "يومي",        short: "يوم" },
  { value: "weekly",     label: "أسبوعي",      short: "أسبوع" },
  { value: "monthly",    label: "شهري",        short: "شهر" },
  { value: "quarterly",  label: "كل ٣ أشهر",   short: "٣ أشهر" },
  { value: "semiannual", label: "كل ٦ أشهر",   short: "٦ أشهر" },
  { value: "annual",     label: "سنوي",        short: "سنة" },
];

export const freqLabel = (f?: string | null) =>
  FREQUENCIES.find((x) => x.value === f)?.label ?? "شهري";
export const freqShort = (f?: string | null) =>
  FREQUENCIES.find((x) => x.value === f)?.short ?? "شهر";

/** عدد الفترات في السنة — لحساب المدة الافتراضية للعقد */
const PERIODS_PER_YEAR: Record<Frequency, number> = {
  daily: 365, weekly: 52, monthly: 12, quarterly: 4, semiannual: 2, annual: 1,
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** إضافة (n) فترة إلى تاريخ — يراعي اختلاف أطوال الأشهر */
export function addPeriods(date: Date, freq: Frequency, n: number): Date {
  const d = new Date(date.getTime());
  switch (freq) {
    case "daily":  d.setDate(d.getDate() + n); break;
    case "weekly": d.setDate(d.getDate() + n * 7); break;
    default: {
      const months = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : freq === "semiannual" ? 6 : 12;
      const targetDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + months * n);
      // تثبيت اليوم مع مراعاة الأشهر القصيرة (31 → 30/28)
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(targetDay, lastDay));
    }
  }
  return d;
}

/** كم فترة حان استحقاقها منذ بداية العقد حتى اليوم */
export function periodsElapsed(startISO: string | null | undefined, freq: Frequency): number {
  if (!startISO) return 0;
  const start = startOfDay(new Date(startISO));
  const today = startOfDay(new Date());
  if (today < start) return 0;
  let n = 0;
  // الدفعة الأولى مستحقة عند البداية
  while (addPeriods(start, freq, n) <= today && n < 5000) n++;
  return n;
}

/** المدة الافتراضية للعقد: سنة واحدة بعدد فترات الدورة */
export const defaultTermPeriods = (freq: Frequency) => PERIODS_PER_YEAR[freq];

/** تاريخ نهاية العقد المستنتج (إن لم يُدخل يدويًّا) */
export function derivedEndDate(startISO: string, freq: Frequency, periods?: number | null): string {
  const n = periods && periods > 0 ? periods : defaultTermPeriods(freq);
  return addPeriods(startOfDay(new Date(startISO)), freq, n).toISOString().slice(0, 10);
}

export type ContractState = {
  due: number;            // فترات حان استحقاقها
  paid: number;           // فترات مسدّدة
  unpaid: number;         // فترات غير مسدّدة (متأخرة)
  amountDue: number;      // المبلغ المتأخر
  nextDueDate: string | null;  // تاريخ الدفعة القادمة
  daysToNextDue: number | null;
  endDate: string | null;
  daysToEnd: number | null;
  status: "late" | "soon" | "ok";  // أحمر / أصفر / أخضر
  statusLabel: string;
  progress: number;       // نسبة إنجاز العقد (٪)
};

const daysBetween = (a: Date, b: Date) =>
  Math.ceil((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);

/**
 * الحالة الكاملة للعقد — مستنتجة بالكامل.
 * كل ما يحتاجه: تاريخ البداية + الدورة + القيمة + عدد الفترات المسدّدة.
 */
export function contractState(t: {
  contract_start?: string | null;
  contract_end?: string | null;
  payment_frequency?: string | null;
  rent_amount?: number | null;
  paid_periods?: number | null;
  contract_periods?: number | null;
}): ContractState {
  const freq = (t.payment_frequency || "monthly") as Frequency;
  const rent = Number(t.rent_amount) || 0;
  const paid = Math.max(0, Number(t.paid_periods) || 0);
  const today = new Date();

  if (!t.contract_start) {
    return {
      due: 0, paid, unpaid: 0, amountDue: 0, nextDueDate: null, daysToNextDue: null,
      endDate: t.contract_end || null, daysToEnd: t.contract_end ? daysBetween(new Date(t.contract_end), today) : null,
      status: "ok", statusLabel: "بانتظار بيانات العقد", progress: 0,
    };
  }

  const start = startOfDay(new Date(t.contract_start));
  const due = periodsElapsed(t.contract_start, freq);
  const unpaid = Math.max(0, due - paid);
  const amountDue = unpaid * rent;

  // تاريخ الدفعة القادمة = بداية العقد + عدد الفترات المسدّدة
  const nextDue = addPeriods(start, freq, paid);
  const nextDueDate = nextDue.toISOString().slice(0, 10);
  const daysToNextDue = daysBetween(nextDue, today);

  // نهاية العقد: يدوية أو مستنتجة
  const endDate = t.contract_end || derivedEndDate(t.contract_start, freq, t.contract_periods);
  const daysToEnd = daysBetween(new Date(endDate), today);

  const totalPeriods = t.contract_periods && t.contract_periods > 0 ? t.contract_periods : defaultTermPeriods(freq);
  const progress = Math.min(100, Math.round((due / totalPeriods) * 100));

  let status: ContractState["status"] = "ok";
  let statusLabel = "منتظم";
  if (unpaid > 0) {
    status = "late";
    statusLabel = unpaid === 1 ? "متأخر دفعة واحدة" : `متأخر ${unpaid} دفعات`;
  } else if (daysToNextDue !== null && daysToNextDue <= 7) {
    status = "soon";
    statusLabel = daysToNextDue <= 0 ? "يستحق اليوم" : `يستحق خلال ${daysToNextDue} يوم`;
  }

  return { due, paid, unpaid, amountDue, nextDueDate, daysToNextDue, endDate, daysToEnd, status, statusLabel, progress };
}

/** جدول الدفعات الكامل — للعرض والكشوف */
export function buildSchedule(t: {
  contract_start?: string | null;
  payment_frequency?: string | null;
  rent_amount?: number | null;
  paid_periods?: number | null;
  contract_periods?: number | null;
}) {
  if (!t.contract_start) return [];
  const freq = (t.payment_frequency || "monthly") as Frequency;
  const start = startOfDay(new Date(t.contract_start));
  const total = t.contract_periods && t.contract_periods > 0 ? t.contract_periods : defaultTermPeriods(freq);
  const paid = Math.max(0, Number(t.paid_periods) || 0);
  const rent = Number(t.rent_amount) || 0;
  const today = startOfDay(new Date());

  return Array.from({ length: Math.min(total, 400) }, (_, i) => {
    const date = addPeriods(start, freq, i);
    const isPaid = i < paid;
    const isDue = date <= today;
    return {
      n: i + 1,
      date: date.toISOString().slice(0, 10),
      amount: rent,
      status: isPaid ? ("paid" as const) : isDue ? ("late" as const) : ("upcoming" as const),
    };
  });
}
