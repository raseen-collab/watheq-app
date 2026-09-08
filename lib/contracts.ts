// ============================================================
// محرّك العقود — يستنتج كل شيء من: تاريخ البداية + الدورة + القيمة
// (v7) يدعم السداد الجزئي: partial_amount = مبلغ مدفوع على الدفعة الحالية
// ============================================================

export type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";

export const FREQUENCIES: { value: Frequency; label: string; short: string }[] = [
  { value: "daily",      label: "يومي",        short: "يوم" },
  { value: "weekly",     label: "أسبوعي",      short: "أسبوع" },
  { value: "monthly",    label: "شهري",        short: "شهر" },
  { value: "quarterly",  label: "كل 3 أشهر",   short: "3 أشهر" },
  { value: "semiannual", label: "كل 6 أشهر",   short: "6 أشهر" },
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

/**
 * 🕐 قراءة تاريخ مخزّن (YYYY-MM-DD) كتاريخ **محلي** لا عالمي.
 *
 * `new Date("2026-03-05")` يُفسَّر منتصف ليل UTC؛ وفي توقيت الرياض (+3)
 * يصير ذلك 03:00 صباح 5 مارس محليًّا، فإذا أعيد إلى نص بـtoISOString
 * عاد **4 مارس** — يوم كامل قبل الحقيقة. كان هذا يزيح كل تاريخ في
 * كل مستند بيوم واحد لكل مستخدم شرق غرينتش.
 */
export function parseDate(v: string | Date): Date {
  if (v instanceof Date) return startOfDay(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? startOfDay(new Date()) : startOfDay(d);
}

/** كتابة تاريخ بمكوّناته المحلية — البديل الآمن عن toISOString().slice(0,10) */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type ContractCalendar = "gregorian" | "hijri";

/**
 * الدورة الهجرية: عقد يُكتب «كل 6 أشهر» بالهجري تكون أقساطه 1447/03/15 ثم
 * 1447/09/15 — أي 177 يومًا لا 182. حسابها بالأشهر الميلادية يزحف 3–5 أيام
 * في كل قسط، فيرى المكتب استحقاقًا لا يطابق عقده. هنا نضيف الأشهر بالتقويم
 * الهجري (أم القرى) ونحوّل، مع قصّ اليوم 30 إلى 29 في الأشهر القصيرة.
 */
const H_FMT = typeof Intl !== "undefined"
  ? new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" })
  : null;
function toH(d: Date): { y: number; m: number; d: number } | null {
  if (!H_FMT) return null;
  const parts = H_FMT.formatToParts(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)));
  const g = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const y = g("year"), m = g("month"), dd = g("day");
  return y && m && dd ? { y, m, d: dd } : null;
}
function fromH(y: number, m: number, d: number): Date | null {
  if (!H_FMT) return null;
  // تقدير ثم مسح ±60 يومًا — دقيق ومتسق مع المحوّل نفسه
  const approx = Date.UTC(1882, 10, 12) + ((y - 1300) * 354.367 + (m - 1) * 29.53 + (d - 1)) * 86400000;
  for (let off = -60; off <= 60; off++) {
    const cand = new Date(approx + off * 86400000);
    const local = new Date(cand.getUTCFullYear(), cand.getUTCMonth(), cand.getUTCDate());
    const h = toH(local);
    if (h && h.y === y && h.m === m && h.d === d) return local;
  }
  return null;
}
function addHijriMonths(date: Date, months: number, anchorDay?: number | null): Date {
  const h = toH(date);
  if (!h) return date;
  const total = (h.y * 12 + (h.m - 1)) + months;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  const want = Math.min(30, Math.max(1, Number(anchorDay) || h.d));
  // اليوم المطلوب، وإن لم يوجد في الشهر (30 في شهر عدّته 29) فالأقرب قبله
  for (const d of [want, 29, 28].filter((x, i, a) => x <= want && a.indexOf(x) === i)) {
    const r = fromH(y, m, d);
    if (r) return r;
  }
  return date;
}

/** إضافة (n) فترة إلى تاريخ — يراعي اختلاف أطوال الأشهر، وبالهجري إن كان العقد هجريًّا */
export function addPeriods(date: Date, freq: Frequency, n: number, anchorDay?: number | null, cal?: ContractCalendar | null): Date {
  const d = new Date(date.getTime());
  if (cal === "hijri" && freq !== "daily" && freq !== "weekly") {
    const months = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : freq === "semiannual" ? 6 : 12;
    /* يوم المرساة الميلادي (7 في 2025-09-07) لا معنى له في الهجري — اليوم الهجري
       للتاريخ نفسه (15 في 1447/03/15) هو المرساة. كان هذا يزحف الاستحقاق 8 أيام. */
    return n === 0 ? d : addHijriMonths(d, months * n, null);
  }
  switch (freq) {
    case "daily":  d.setDate(d.getDate() + n); break;
    case "weekly": d.setDate(d.getDate() + n * 7); break;
    default: {
      const months = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : freq === "semiannual" ? 6 : 12;
      // المرساة تمنع «زحف التواريخ»: عقد يبدأ 31 يناير يُقصّ إلى 28 فبراير،
      // فلولا المرساة لبقي يوم السداد 28 في كل الفترات التالية وعند كل تجديد.
      const anchor = Number(anchorDay) || 0;
      const targetDay = anchor >= 1 && anchor <= 31 ? anchor : d.getDate();
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
export function periodsElapsed(
  startISO: string | null | undefined, freq: Frequency, asOf?: Date, anchorDay?: number | null, cal?: ContractCalendar | null
): number {
  if (!startISO) return 0;
  const start = parseDate(startISO);
  const today = startOfDay(asOf || new Date());
  if (today < start) return 0;
  let n = 0;
  /* الدفعة تُعدّ متأخرة من اليوم التالي لاستحقاقها، لا في يوم الاستحقاق
     نفسه — للمستأجر يومه كاملًا ليسدّد. (كانت تُعدّ متأخرة صباح يوم الاستحقاق،
     فيرى المكتب «متأخر» قبل أن يتأخر أحد.) فترة السماح تُضاف فوق ذلك. */
  while (addPeriods(start, freq, n, anchorDay, cal) < today && n < 5000) n++;
  return n;
}

/** المدة الافتراضية للعقد: سنة واحدة بعدد فترات الدورة */
export const defaultTermPeriods = (freq: Frequency) => PERIODS_PER_YEAR[freq];

/** تاريخ نهاية العقد المستنتج (إن لم يُدخل يدويًّا) */
export function derivedEndDate(
  startISO: string, freq: Frequency, periods?: number | null, anchorDay?: number | null, cal?: ContractCalendar | null
): string {
  const n = periods && periods > 0 ? periods : defaultTermPeriods(freq);
  return isoDate(addPeriods(parseDate(startISO), freq, n, anchorDay, cal));
}

/** يوم المرساة: المحفوظ، وإلا يوم بداية العقد */
export const anchorOf = (t: { billing_anchor_day?: number | null; contract_start?: string | null; first_due?: string | null }) =>
  Number(t?.billing_anchor_day) || (t?.first_due ? parseDate(t.first_due).getDate() : t?.contract_start ? parseDate(t.contract_start).getDate() : null);

/**
 * بداية جدول الدفعات: أول استحقاق إن حُدّد (العقد يبدأ 1/1 والدفعة الأولى
 * 5/1)، وإلا بداية العقد. كل الدفعات التالية تُعدّ منها.
 */
export const scheduleStart = (t: { contract_start?: string | null; first_due?: string | null }) =>
  t?.first_due || t?.contract_start || null;

/** هل الوحدة شاغرة (أُخليت)؟ */
export const isVacant = (t: { status?: string | null }) => String(t?.status || "active") === "vacated";

export type ContractState = {
  due: number;            // فترات حان استحقاقها
  paid: number;           // فترات مسدّدة بالكامل
  unpaid: number;         // فترات غير مسدّدة (متأخرة)
  amountDue: number;      // المبلغ المتأخر بعد خصم السداد الجزئي
  grossDue: number;       // المبلغ المتأخر قبل خصم الجزئي
  partial: number;        // المبلغ المدفوع جزئيًّا على الدفعة الحالية
  hasPartial: boolean;    // هل يوجد سداد جزئي فعلي؟
  partialPct: number;     // نسبة اكتمال الدفعة الحالية (٪)
  nextDueDate: string | null;  // تاريخ الدفعة القادمة
  daysToNextDue: number | null;
  endDate: string | null;
  daysToEnd: number | null;
  status: "late" | "soon" | "ok";  // أحمر / أصفر / أخضر — لم يتغيّر (يعتمد عليه البوت)
  statusLabel: string;
  /** داخل نافذة «قريب»: near = قريب، due = مستحق (النافذة الأقرب)، today = يستحق اليوم */
  soonTier: "near" | "due" | "today" | null;
  /** العقد ينتهي خلال نافذة «تنتهي قريبًا» التي يحددها المكتب */
  expiringSoon: boolean;
  /** سدّد كل دفعات العقد — لا استحقاق قادم قبل انتهائه، والقادم يكون مع التجديد */
  fullyPaid: boolean;
  inGrace: boolean;        // مرّ الاستحقاق لكن ضمن فترة السماح — لا يُعدّ متأخرًا
  graceDaysLeft: number;   // كم يومًا تبقّى من السماح
  progress: number;       // نسبة إنجاز العقد (٪)
};

const daysBetween = (a: Date, b: Date) =>
  Math.ceil((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);

/**
 * الحالة الكاملة للعقد — مستنتجة بالكامل.
 * كل ما يحتاجه: تاريخ البداية + الدورة + القيمة + عدد الفترات المسدّدة + السداد الجزئي.
 */
export function contractState(t: {
  contract_start?: string | null;
  contract_end?: string | null;
  payment_frequency?: string | null;
  rent_amount?: number | null;
  paid_periods?: number | null;
  contract_periods?: number | null;
  partial_amount?: number | null;
  billing_anchor_day?: number | null;
  status?: string | null;
  move_out_date?: string | null;
  calendar?: string | null; first_due?: string | null;
}, opts: { graceDays?: number | null; soonDays?: number | null; imminentDays?: number | null; expiringDays?: number | null } = {}): ContractState {
  const anchor = anchorOf(t);
  // الوحدة المُخلاة تتوقّف عن تراكم المتأخرات من تاريخ الإخلاء — لا تبقى "متأخرة" للأبد
  const vacated = isVacant(t) && !!t.move_out_date;
  const grace = Math.max(0, Math.min(30, Number(opts.graceDays) || 0));
  // نافذة «يستحق قريبًا» — يختارها كل مكتب (افتراضيًّا 7 أيام)
  const soon = Math.max(1, Math.min(60, Number(opts.soonDays) || 10));
  // «مستحق»: نافذة أقرب داخل «قريب» — إن ضُبطت أكبر من «قريب» تُقصّ إليها
  const imminent = Math.min(soon, Math.max(1, Number(opts.imminentDays) || 5));
  const cal = (t.calendar === "hijri" ? "hijri" : "gregorian") as ContractCalendar;
  const freq = (t.payment_frequency || "monthly") as Frequency;
  const rent = Number(t.rent_amount) || 0;
  const paid = Math.max(0, Number(t.paid_periods) || 0);
  // السداد الجزئي لا يتجاوز قيمة دفعة واحدة
  const partial = Math.min(Math.max(0, Number(t.partial_amount) || 0), rent || Infinity);
  const today = new Date();

  if (!t.contract_start) {
    return {
      due: 0, paid, unpaid: 0, amountDue: 0, grossDue: 0, partial, hasPartial: partial > 0, fullyPaid: false, soonTier: null, expiringSoon: false,
      partialPct: rent ? Math.round((partial / rent) * 100) : 0,
      nextDueDate: null, daysToNextDue: null,
      endDate: t.contract_end || null,
      daysToEnd: t.contract_end ? daysBetween(new Date(t.contract_end), today) : null,
      status: "ok", statusLabel: "بانتظار بيانات العقد", progress: 0,
      inGrace: false, graceDaysLeft: 0,
    };
  }

  const schedStart = scheduleStart(t) as string;
  const start = parseDate(schedStart);
  // مرجع الاحتساب: اليوم، أو تاريخ الإخلاء إن كانت الوحدة مُخلاة (أيّهما أسبق)
  const now = new Date();
  const cutoff = vacated ? new Date(Math.min(Date.parse(String(t.move_out_date)), now.getTime())) : now;
  // فترة السماح: تُحتسب الدفعة مستحقّة رسميًّا بعد مرور أيام السماح
  const graceRef = new Date(cutoff); graceRef.setDate(graceRef.getDate() - grace);
  const due = periodsElapsed(schedStart, freq, graceRef, anchor, cal);
  const dueStrict = grace > 0 ? periodsElapsed(schedStart, freq, cutoff, anchor, cal) : due;
  const unpaid = Math.max(0, due - paid);
  const grossDue = unpaid * rent;
  const amountDue = Math.max(0, grossDue - partial);
  const hasPartial = partial > 0;
  const partialPct = rent ? Math.round((partial / rent) * 100) : 0;

  // تاريخ الدفعة القادمة = بداية العقد + عدد الفترات المسدّدة
  const nextDue = addPeriods(start, freq, paid, anchor, cal);
  const nextDueDate = isoDate(nextDue);
  const daysToNextDue = daysBetween(nextDue, today);

  // نهاية العقد: يدوية أو مستنتجة
  // نهاية العقد تُعدّ من بداية العقد بيومها هي — لا من يوم أول استحقاق
  const endAnchor = Number(t.billing_anchor_day) || parseDate(t.contract_start).getDate();
  const endDate = t.contract_end || derivedEndDate(t.contract_start, freq, t.contract_periods, endAnchor, cal);
  const daysToEnd = daysBetween(new Date(endDate), today);

  // استُحقّت دفعة فعليًّا لكنها لم تُحتسب متأخرة بعد بفضل السماح
  const inGrace = grace > 0 && dueStrict > due && dueStrict > paid;
  const graceDaysLeft = inGrace
    ? Math.max(0, grace + daysBetween(addPeriods(start, freq, dueStrict - 1, anchor, cal), today))
    : 0;

  const totalPeriods = t.contract_periods && t.contract_periods > 0 ? t.contract_periods : defaultTermPeriods(freq);
  const progress = Math.min(100, Math.round((due / totalPeriods) * 100));

  let status: ContractState["status"] = "ok";
  let statusLabel = "منتظم";
  if (unpaid > 0) {
    status = "late";
    statusLabel = hasPartial
      ? `سداد جزئي — متبقٍ ${Math.round(amountDue).toLocaleString("en-US")}`
      : unpaid === 1 ? "متأخر دفعة واحدة" : `متأخر ${unpaid} دفعات`;
  } else if (inGrace) {
    status = "soon";
    statusLabel = graceDaysLeft > 0 ? `فترة سماح — ${graceDaysLeft} يوم` : "فترة سماح";
  }
  let soonTier: ContractState["soonTier"] = null;
  if (status === "ok" && daysToNextDue !== null && daysToNextDue <= soon) {
    status = "soon";
    soonTier = daysToNextDue <= 0 ? "today" : daysToNextDue <= imminent ? "due" : "near";
    statusLabel = soonTier === "today" ? "يستحق اليوم"
      : soonTier === "due" ? `مستحق — خلال ${daysToNextDue} يوم`
      : `قريب — خلال ${daysToNextDue} يوم`;
  }
  /* سدّد العقد كله مقدّمًا (سنة كاملة مثلًا): لا «القادمة» بعد اليوم — ما يهم
     المكتب أن يرى «مسدَّد كامل العقد» ومتى ينتهي ليجدّده، لا صفًا صامتًا */
  const fullyPaid = unpaid === 0 && paid >= totalPeriods;
  const expWin = Math.max(1, Math.min(180, Number(opts.expiringDays) || 60));
  const expiringSoon = daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= expWin;
  if (fullyPaid && status === "ok") statusLabel = "مسدَّد كامل العقد";

  return {
    due, paid, unpaid, amountDue, grossDue, partial, hasPartial, partialPct, fullyPaid, soonTier, expiringSoon,
    nextDueDate, daysToNextDue, endDate, daysToEnd, status, statusLabel, progress,
    inGrace, graceDaysLeft,
  };
}

/** جدول الدفعات الكامل — للعرض والكشوف */
export function buildSchedule(t: {
  contract_start?: string | null;
  payment_frequency?: string | null;
  rent_amount?: number | null;
  paid_periods?: number | null;
  contract_periods?: number | null;
  partial_amount?: number | null;
  billing_anchor_day?: number | null; calendar?: string | null;
}) {
  if (!t.contract_start) return [];
  const anchor = anchorOf(t);
  const freq = (t.payment_frequency || "monthly") as Frequency;
  const start = parseDate(t.contract_start);
  const total = t.contract_periods && t.contract_periods > 0 ? t.contract_periods : defaultTermPeriods(freq);
  const paid = Math.max(0, Number(t.paid_periods) || 0);
  const rent = Number(t.rent_amount) || 0;
  const partial = Math.min(Math.max(0, Number(t.partial_amount) || 0), rent || Infinity);
  const today = startOfDay(new Date());

  return Array.from({ length: Math.min(total, 400) }, (_, i) => {
    const date = addPeriods(start, freq, i, anchor, (t.calendar === "hijri" ? "hijri" : "gregorian"));
    const isPaid = i < paid;
    const isDue = date <= today;
    // أول دفعة غير مسدّدة هي التي يقع عليها السداد الجزئي
    const isPartialRow = !isPaid && i === paid && partial > 0;
    return {
      n: i + 1,
      date: isoDate(date),
      amount: rent,
      paidAmount: isPaid ? rent : isPartialRow ? partial : 0,
      status: isPaid ? ("paid" as const)
        : isPartialRow ? ("partial" as const)
        : isDue ? ("late" as const)
        : ("upcoming" as const),
    };
  });
}

/**
 * تجديد العقد — يبدأ مدة جديدة تلقائيًّا من تاريخ انتهاء المدة الحالية.
 * يعيد الحقول الجاهزة للحفظ.
 */
export function renewContract(t: {
  contract_start?: string | null;
  contract_end?: string | null;
  payment_frequency?: string | null;
  contract_periods?: number | null;
  rent_amount?: number | null;
  billing_anchor_day?: number | null;
}, opts: { periods?: number | null; newAmount?: number | null; newFrequency?: Frequency | null } = {}) {
  const anchor = anchorOf(t);
  const oldFreq = (t.payment_frequency || "monthly") as Frequency;
  const freq = (opts.newFrequency || oldFreq) as Frequency;
  const st = contractState(t);
  // المدة الجديدة تبدأ من نهاية الحالية (أو من اليوم إن كانت منتهية منذ زمن)
  const startISO = st.endDate || isoDate(new Date());
  const periods = opts.periods && opts.periods > 0 ? opts.periods : (t.contract_periods || defaultTermPeriods(freq));
  const amount = opts.newAmount && opts.newAmount > 0 ? opts.newAmount : (Number(t.rent_amount) || 0);
  return {
    contract_start: startISO,
    contract_end: derivedEndDate(startISO, freq, periods, anchor, (t as any).calendar === "hijri" ? "hijri" : "gregorian"),
    payment_frequency: freq,
    contract_periods: periods,
    rent_amount: amount,
    paid_periods: 0,   // مدة جديدة تبدأ بصفر دفعات مسدّدة
    partial_amount: 0, // ولا سداد جزئي معلّق
    billing_anchor_day: anchor, // ← تثبيت يوم السداد عبر كل التجديدات
  };
}

/** هل العقد يستحق التجديد؟ (منتهٍ أو يقترب) */
export function needsRenewal(t: Parameters<typeof contractState>[0], withinDays = 60): boolean {
  const st = contractState(t);
  return st.daysToEnd !== null && st.daysToEnd <= withinDays;
}

/**
 * تسجيل مبلغ مستلم — يحوّل الجزئي إلى دفعات كاملة تلقائيًّا.
 * مثال: إيجار 3000، مدفوع جزئيًّا 1000، واستلمت 2500
 *        → تكتمل دفعة (3000) ويتبقّى 500 جزئيًّا.
 * يعيد الحقول الجاهزة للحفظ في جدول tenants.
 */
export function applyPayment(t: {
  rent_amount?: number | null;
  paid_periods?: number | null;
  partial_amount?: number | null;
}, received: number): { paid_periods: number; partial_amount: number; completed: number } {
  const rent = Number(t.rent_amount) || 0;
  const paid = Math.max(0, Number(t.paid_periods) || 0);
  const partial = Math.max(0, Number(t.partial_amount) || 0);
  const amount = Math.max(0, Number(received) || 0);

  if (rent <= 0) return { paid_periods: paid, partial_amount: 0, completed: 0 };

  const pool = partial + amount;
  const completed = Math.floor(pool / rent);
  const remainder = +(pool - completed * rent).toFixed(2);

  return { paid_periods: paid + completed, partial_amount: remainder, completed };
}

// ============================================================
// ضريبة القيمة المضافة — لفصل الإيجار الأساسي عن الضريبة
// في كشوف الحساب والفواتير (مطلب أساسي للعقارات التجارية)
// ============================================================

export type VatSettings = {
  enabled?: boolean | null;
  rate?: number | null;        // النسبة المئوية (15 في السعودية)
  inclusive?: boolean | null;  // هل المبلغ المُدخل شامل الضريبة؟
};

export type VatSplit = {
  base: number;    // الإيجار الأساسي قبل الضريبة
  vat: number;     // مبلغ الضريبة
  total: number;   // الإجمالي المستحق على المستأجر
  rate: number;    // النسبة المطبّقة
  enabled: boolean;
};

/**
 * يفصل مبلغًا إلى (أساس + ضريبة + إجمالي).
 * inclusive=true  → المبلغ المُدخل هو الإجمالي، فيُستخرج الأساس منه.
 * inclusive=false → المبلغ المُدخل هو الأساس، وتُضاف الضريبة فوقه.
 */
export function splitVat(amount: number, v?: VatSettings | null): VatSplit {
  const gross = Number(amount) || 0;
  const enabled = !!v?.enabled;
  const rate = Number(v?.rate ?? 15) || 0;
  if (!enabled || rate <= 0) {
    return { base: gross, vat: 0, total: gross, rate: 0, enabled: false };
  }
  const inclusive = v?.inclusive !== false; // الافتراضي: شامل
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (inclusive) {
    const base = r2(gross / (1 + rate / 100));
    return { base, vat: r2(gross - base), total: r2(gross), rate, enabled: true };
  }
  const vat = r2(gross * (rate / 100));
  return { base: r2(gross), vat, total: r2(gross + vat), rate, enabled: true };
}

/** أنواع العقارات التي تُفعَّل لها الضريبة عادةً */
export const COMMERCIAL_TYPES = ["commercial", "office", "warehouse", "shop", "showroom"];
export const isCommercial = (propertyType?: string | null) =>
  COMMERCIAL_TYPES.includes(String(propertyType || "").toLowerCase());

// ============================================================
// دورة الإخلاء: مخالصة مبلغ التأمين
// ============================================================

export type Settlement = {
  deposit: number;       // مبلغ التأمين المستلم
  deductions: number;    // خصومات التلفيات
  outstanding: number;   // إيجار متأخر عند الإخلاء
  refund: number;        // المستحق للمستأجر (لا يقلّ عن صفر)
  dueFromTenant: number; // ما يبقى على المستأجر بعد استنفاد التأمين
};

/**
 * تسوية مبلغ التأمين عند الإخلاء.
 * التأمين يغطّي أولًا الإيجار المتأخر ثم التلفيات، والباقي يُردّ للمستأجر.
 */
export function settleDeposit(t: {
  deposit_amount?: number | null;
  deposit_deductions?: number | null;
}, outstanding = 0): Settlement {
  const deposit = Math.max(0, Number(t?.deposit_amount) || 0);
  const deductions = Math.max(0, Number(t?.deposit_deductions) || 0);
  const owed = Math.max(0, Number(outstanding) || 0);
  const claims = owed + deductions;
  const refund = Math.max(0, +(deposit - claims).toFixed(2));
  const dueFromTenant = Math.max(0, +(claims - deposit).toFixed(2));
  return { deposit, deductions, outstanding: owed, refund, dueFromTenant };
}

/** بنود قائمة تحقق الإخلاء — نقطة بداية يعدّلها المستخدم */
export const TURNOVER_CHECKLIST: { label: string; done: boolean }[] = [
  { label: "استلام المفاتيح وأجهزة التحكّم", done: false },
  { label: "قراءة عدّاد الكهرباء وتوثيقها", done: false },
  { label: "قراءة عدّاد المياه وتوثيقها", done: false },
  { label: "نقل/فصل خدمات الكهرباء والمياه", done: false },
  { label: "فحص السباكة والتمديدات", done: false },
  { label: "فحص التكييف والأجهزة المثبّتة", done: false },
  { label: "معاينة الدهانات والأرضيات", done: false },
  { label: "تنظيف الوحدة وتجهيزها للعرض", done: false },
  { label: "تصوير الوحدة بعد التجهيز", done: false },
  { label: "إخلاء طرف من إدارة العقار", done: false },
];

/** عدد أيام الشغور حتى اليوم */
export function vacancyDays(moveOutISO?: string | null): number | null {
  if (!moveOutISO) return null;
  const out = new Date(moveOutISO);
  if (isNaN(out.getTime())) return null;
  const ms = new Date().setHours(0, 0, 0, 0) - out.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round(ms / 86400000));
}
