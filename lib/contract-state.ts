import { isVacant, withVat, expiringWindowDays, addPeriods, parseDate, isoDate, defaultTermPeriods, splitVat, type Frequency, type ContractCalendar, type VatSettings } from "./contracts";
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
export { expiringWindowDays };
export function deriveState(
  st: { status: "late" | "soon" | "ok"; daysToEnd: number | null; vacant?: boolean; endDate?: string | null },
  tenant: any
): StateKey {
  // الشغور يتقدّم على كل شيء — لا «متأخر» ولا «ينتهي قريبًا» لوحدة فارغة
  if (st.vacant || String(tenant?.status || "") === "vacated") return "vacant";
  if (tenant?.litigation === true) return "litigation";
  if (st.status === "late") return "arrears";
  if (st.status === "soon") return "due_soon";
  /* النافذة لا تتجاوز نصف مدة العقد (expiringWindowDays) — كما في contractState و needsRenewal */
  if (st.daysToEnd !== null && st.daysToEnd <= expiringWindowDays(RENEW_DAYS, tenant?.contract_start, st.endDate ?? tenant?.contract_end)) return "expiring";
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
/**
 * (30 سبتمبر 2026) «سداد جزئي» فقط حين يكون المتأخر الوحيد هو القسط المسدَّد جزئيًّا.
 * كان أي جزئي يحوّل الوحدة من «متأخر» إلى «سداد جزئي»: مستأجر عليه ثلاثة أقساط
 * دفع 500 من أولها خرج من فلتر «متأخر» بينما إجمالي المتأخر في الرأس يعدّه.
 * بلا `unpaid` (مستدعٍ قديم) يبقى السلوك السابق.
 */
export function isPartialOnly(st: { status?: string; hasPartial?: boolean; unpaid?: number | null }): boolean {
  if (st.status !== "late" || !st.hasPartial) return false;
  return st.unpaid == null ? true : Number(st.unpaid) <= 1;
}
export function unitStatus(t: any, st: { incomplete?: boolean; status: string; hasPartial?: boolean; unpaid?: number | null; soonTier?: string | null; expiringSoon?: boolean; daysToEnd?: number | null }): UnitStatus {
  if (isVacant(t)) return "vacant";
  if (st.incomplete) return "incomplete";
  if (t?.litigation) return "litigation";
  if (st.status === "late") return isPartialOnly(st) ? "partial" : "late";
  if (st.status === "soon") return st.soonTier === "near" ? "soon" : "due";
  /* عقد انتهى ولم يُسجَّل إخلاء ولا تجديد: كان «منتظم» أخضر، وفلتر التجديد لا يعدّه */
  if (st.expiringSoon || (st.daysToEnd != null && st.daysToEnd < 0)) return "expiring";
  return "ok";
}
/**
 * يحتاج تجديدًا أو إخلاءً: يقترب من نهايته، أو انتهى ولم يُسجَّل تجديد ولا إخلاء.
 * (10 أكتوبر 2026 — بلاغ مكتب التميز) «نظرة عامة» والملخص اليومي وكشف العقار كانت
 * تعدّ expiringSoon وحده (0 ≤ الأيام ≤ النافذة)، فالعقد الذي انتهى أمس يختفي منها
 * ولا يظهر إلا داخل صفحة العقار. مصدر واحد لكل الشاشات.
 */
export function renewalDue(t: any, st: { expiringSoon?: boolean; daysToEnd?: number | null }): boolean {
  if (isVacant(t)) return false;
  return !!st.expiringSoon || (st.daysToEnd != null && st.daysToEnd < 0);
}
/** الاسم المعروض: «ينتهي قريبًا» لعقد انتهى فعلًا كذب — يُسمّى «انتهى العقد» */
export function unitStatusLabel(key: UnitStatus, st: { daysToEnd?: number | null }): string {
  return key === "expiring" && st.daysToEnd != null && st.daysToEnd < 0 ? "انتهى العقد" : UNIT_STATUS_LABEL[key];
}

/** ============================================================
 *  مصدر واحد لتعريف «المتأخر» — 27 سبتمبر 2026
 *
 *  كانت خمس شاشات تحسبه بخمس طرق: بطاقة العقار وملخّص تليجرام
 *  وإجماليات المحفظة تستبعد وحدات التنفيذ، بينما شريط المحفظة
 *  وجدول العقارات وتقرير المالك تُدخلها — فيرى المكتب 33,000 في
 *  موضع و36,200 في موضع آخر على الصفحة نفسها، ولا يعرف أيهما الصحيح.
 *
 *  القاعدة المعتمدة (وهي قاعدة الملخّص اليومي أصلًا): «المتأخر» هو ما
 *  يمكن مطالبة ساكنٍ حاليٍّ به اليوم. ووحدة تحت التنفيذ القضائي مالها
 *  مستحق لكنه بمسار آخر، فيُعرض مستقلًّا لا مطويًّا داخل الرقم.
 *  ودين المستأجر السابق على وحدة شاغرة يبقى مستقلًّا كما كان.
 *
 *  كل شاشة تعرض المتأخر تستدعي هذه الدالة — فلا يعود أي رقمين يختلفان.
 *  ============================================================ */
export type ArrearsRow = {
  t: { litigation?: boolean | null } | any;
  st: { vacant?: boolean; status?: string; amountDue?: number; legacyArrears?: number };
  /** العقار — إن مُرِّر تُحسب المبالغ شاملة الضريبة (وضع «مضافة فوق الإيجار») */
  p?: any;
};

export type Arrears = {
  /** ما يُطالَب به ساكن حالي اليوم */
  current: number; currentCount: number;
  /** مستحق على وحدات تحت التنفيذ القضائي — لا تُرسل لها تذكيرات */
  litigation: number; litigationCount: number;
  /** دين مستأجر سابق على وحدة شاغرة */
  legacy: number; legacyCount: number;
  /** دين مُرحَّل من مدة سابقة، محمول على الوحدة نفسها (carried_debt) */
  carried: number; carriedCount: number;
  /** current + litigation — كل ما على السّاكنين ضمن مددهم الحالية */
  total: number; totalCount: number;
  /** كل ريال مستحق على العقار: total + carried + legacy.
   *  يساوي مجموع totalOwed لكل الوحدات — وهو ما يعرضه كشف العقار. */
  grand: number;
};

export function arrearsOf(rows: ArrearsRow[]): Arrears {
  const a: Arrears = { current: 0, currentCount: 0, litigation: 0, litigationCount: 0,
    legacy: 0, legacyCount: 0, carried: 0, carriedCount: 0, total: 0, totalCount: 0, grand: 0 };
  for (const { t, st, p } of rows) {
    const owed = withVat(Number(st?.amountDue) || 0, t, p);
    /* الدين المرحَّل محمول على الوحدة لا على المدة، فيُجمع لكل الوحدات
       (مشغولة أو شاغرة أو تحت تنفيذ) — وإلا اختفى من كل مؤشر وبقي
       ظاهرًا في كشف العقار وحده، فيختلف رقمان في مستندين للمالك نفسه. */
    const carried = Number((st as any)?.carriedDebt) || 0;
    if (carried > 0) { a.carried += carried; a.carriedCount++; }
    if (st?.vacant || isVacant(t)) {
      const leg = withVat(Number(st?.legacyArrears) || 0, t, p);
      if (leg > 0) { a.legacy += leg; a.legacyCount++; }
      continue;
    }
    if (t?.litigation) {
      if (owed > 0) { a.litigation += owed; a.litigationCount++; }
      continue;
    }
    if (st?.status === "late") { a.current += owed; a.currentCount++; }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  a.current = r2(a.current); a.litigation = r2(a.litigation);
  a.legacy = r2(a.legacy); a.carried = r2(a.carried);
  a.total = r2(a.current + a.litigation);
  a.totalCount = a.currentCount + a.litigationCount;
  a.grand = r2(a.total + a.carried + a.legacy);
  return a;
}

/** ============================================================
 *  نوافذ الحالة — مصدر واحد لعتبات كل مكتب
 *
 *  كل مكتب يضبط في الإعدادات: «يستحق قريبًا» و«مستحق» و«ينتهي قريبًا»
 *  ومهلة السماح، ويستطيع تجاوزها لعقار بعينه. لكن الحل كان محليًّا داخل
 *  PropertyView وحده، بينما المستندات المولَّدة تُمرّر `graceDays` فقط —
 *  فتُحسب حالاتها بالعتبات الافتراضية لا بعتبات المكتب.
 *
 *  الأثر: مكتب يضبط «ينتهي قريبًا = 90 يومًا» يرى الوحدة حمراء على الشاشة،
 *  ثم يطبع تقرير المالك فيقرأ «منتظم» للوحدة نفسها. ودليل الحالات يشرح
 *  عتبةً لا تُطبَّق في نصف المخرجات.
 *
 *  الأولوية: إعداد العقار ← إعداد المكتب ← الافتراضي.
 *  ============================================================ */

export type StatusWindows = {
  graceDays: number; soonDays: number; imminentDays: number; expiringDays: number;
};

/** إعدادات المكتب (profiles) — أسماء الأعمدة كما هي في القاعدة */
export type OfficeDefaults = {
  due_soon_days?: number | null;
  due_imminent_days?: number | null;
  expiring_days?: number | null;
} | null | undefined;

/** إعدادات العقار (properties) — تتجاوز إعداد المكتب حين تُضبط */
export type PropertyWindows = {
  grace_days?: number | null;
  soon_days?: number | null;
  imminent_days?: number | null;
  expiring_days?: number | null;
} | null | undefined;

const clamp = (v: any, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/**
 * يحلّ عتبات الحالة لعقارٍ ما. مرّر إعدادات المكتب حين تتوفّر — وبدونها
 * تُستعمل الافتراضات، وهي نفسها التي يفترضها `contractState`.
 */
export function statusWindows(p?: PropertyWindows, office?: OfficeDefaults): StatusWindows {
  const officeSoon = clamp(office?.due_soon_days, 1, 60, 10);
  const officeImm = clamp(office?.due_imminent_days, 1, 60, 5);
  const officeExp = clamp(office?.expiring_days, 1, 180, 60);
  return {
    graceDays: clamp(p?.grace_days, 0, 30, 0),
    soonDays: clamp(p?.soon_days, 1, 60, officeSoon),
    imminentDays: clamp(p?.imminent_days, 1, 60, officeImm),
    expiringDays: clamp(p?.expiring_days, 1, 180, officeExp),
  };
}

// ============================================================
// حرّاس الإدخال (جولة 4 — 30 سبتمبر 2026)
// حادثة مكتب «التميز»: أول استحقاق هجري بشهر وسنة خاطئين، ودفعة ثانية
// 8,299 بدل 1,700 على عقد 10,000 (فسُجّل 16,599)، وتجديد بعد ستة أسابيع
// من عقد ستة أشهر صفّر عدّاد الدفعات. كل حارس هنا يسأل ولا يمنع.
// ============================================================

const G_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const isoOk = (v?: string | null) => /^\d{4}-\d{2}-\d{2}/.test(String(v || ""));

/** «25 يونيو 2027» — ميلادي بأسماء الأشهر العربية */
export function gregorianAr(iso?: string | null): string {
  if (!isoOk(iso)) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return `${d} ${G_MONTHS[m - 1] || ""} ${y}`;
}

const monthsWord = (x: number) => x === 1 ? "شهر واحد" : x === 2 ? "شهرين" : x % 100 >= 3 && x % 100 <= 10 ? `${x} أشهر` : x % 100 >= 11 ? `${x} شهرًا` : `${x} شهر`;
const daysWord = (x: number) => x === 1 ? "يوم واحد" : x === 2 ? "يومين" : x % 100 >= 3 && x % 100 <= 10 ? `${x} أيام` : x % 100 >= 11 ? `${x} يومًا` : `${x} يوم`;

/**
 * المسافة بين تاريخين بالعربية: «بعد 11 شهرًا من بداية العقد» · «قبل بداية العقد بـ5 أيام»
 * · «يوم بداية العقد». الأشهر تُقرَّب لأقرب شهر (15 يومًا فأكثر = شهر)، وأقل من شهر بالأيام.
 */
export function dateDistanceAr(fromISO?: string | null, toISO?: string | null, what = "بداية العقد"): string {
  if (!isoOk(fromISO) || !isoOk(toISO)) return "";
  const a = parseDate(String(fromISO).slice(0, 10)), b = parseDate(String(toISO).slice(0, 10));
  const days = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (days === 0) return `يوم ${what}`;
  const [lo, hi] = days > 0 ? [a, b] : [b, a];
  let months = (hi.getFullYear() - lo.getFullYear()) * 12 + (hi.getMonth() - lo.getMonth());
  if (hi.getDate() < lo.getDate()) months--;
  const anchor = new Date(lo.getFullYear(), lo.getMonth() + months, Math.min(lo.getDate(), new Date(lo.getFullYear(), lo.getMonth() + months + 1, 0).getDate()));
  const rest = Math.round((hi.getTime() - anchor.getTime()) / 86400000);
  const rounded = months + (rest >= 15 ? 1 : 0);
  const span = rounded >= 1 ? monthsWord(rounded) : daysWord(Math.abs(days));
  return days > 0 ? `بعد ${span} من ${what}` : `قبل ${what} بـ${span}`;
}

/**
 * أول استحقاق خارج المعقول: قبل بداية العقد، أو بعدها بأكثر من فترة سداد واحدة
 * (بتقويم العقد). حادثة: بداية 2026-08-03 نصف سنوي وأول استحقاق 2027-06-25.
 */
export function firstDueOutOfRange(start?: string | null, firstDue?: string | null, freq?: string | null, cal?: string | null): boolean {
  if (!isoOk(start) || !isoOk(firstDue)) return false;
  const s = String(start).slice(0, 10), f = String(firstDue).slice(0, 10);
  if (f < s) return true;
  const onePeriod = isoDate(addPeriods(parseDate(s), (freq || "monthly") as Frequency, 1, null, (cal === "hijri" ? "hijri" : "gregorian") as ContractCalendar));
  return f > onePeriod;
}

/**
 * المتبقي من قيمة المدة الجارية بوحدة تسجيل الدفعات (الإيجار كما يُسجَّل — قبل الضريبة
 * في «مضافة فوق الإيجار»، وهي الوحدة التي يدخل بها المبلغ في نافذة الاستلام).
 *   total = عدد فترات المدة × الإيجار · paid = المسدَّد كاملًا × الإيجار + الجزئي
 * ومعه المتبقي شاملًا الضريبة للعرض حين تكون مضافة.
 */
export function contractRemaining(t: { rent_amount?: number | null; contract_periods?: number | null; payment_frequency?: string | null;
  paid_periods?: number | null; partial_amount?: number | null }, vat?: VatSettings | null) {
  const rent = Math.max(0, Number(t.rent_amount) || 0);
  const periods = Number(t.contract_periods) > 0 ? Number(t.contract_periods) : defaultTermPeriods((t.payment_frequency || "monthly") as Frequency) || 12;
  const total = r2(periods * rent);
  const paid = r2(Math.max(0, Number(t.paid_periods) || 0) * rent + Math.max(0, Number(t.partial_amount) || 0));
  const remaining = r2(total - paid);
  const exclusive = !!vat?.enabled && vat?.inclusive === false;
  return { periods, total, paid, remaining, overpaid: remaining < 0 ? -remaining : 0,
    remainingWithVat: exclusive ? r2(splitVat(Math.max(0, remaining), vat!).total) : Math.max(0, remaining) };
}

/** هل المبلغ يزيد على المتبقي من المدة؟ يُرجع الزيادة أو 0 */
export const excessOverRemaining = (amount: number, remaining: number) => r2(Math.max(0, (Number(amount) || 0) - Math.max(0, Number(remaining) || 0)));

/**
 * دفعة تشبه المُدخلة: خلال ±3 أيام، والمبلغ بفرق ≤ 1٪ أو ≤ 5 ريالات. تُستبعد
 * أسطر العكس والدفعات المعكوسة والمبالغ غير الموجبة.
 */
export function nearDuplicatePayment<P extends { id?: string; amount?: number | string | null; paid_on?: string | null; reverses?: string | null }>(
  amount: number, paidOn: string, payments: P[] | null | undefined): P | null {
  const a = Number(amount) || 0;
  if (!(a > 0) || !isoOk(paidOn)) return null;
  const list = payments || [];
  const reversed = new Set(list.filter((p) => p.reverses).map((p) => String(p.reverses)));
  const day = parseDate(paidOn.slice(0, 10)).getTime();
  for (const p of list) {
    const v = Number(p.amount) || 0;
    if (!(v > 0) || p.reverses || (p.id && reversed.has(String(p.id))) || !isoOk(p.paid_on)) continue;
    const dd = Math.abs(Math.round((parseDate(String(p.paid_on).slice(0, 10)).getTime() - day) / 86400000));
    if (dd > 3) continue;
    const diff = Math.abs(v - a);
    if (diff <= 5 || diff <= 0.01 * Math.max(v, a)) return p;
  }
  return null;
}

/** التجديد مبكر: اليوم قبل (نهاية العقد − 30 يومًا) */
export function renewalTooEarly(endISO?: string | null, todayISO?: string | null, days = 30): boolean {
  if (!isoOk(endISO) || !isoOk(todayISO)) return false;
  const e = parseDate(String(endISO).slice(0, 10)); e.setDate(e.getDate() - days);
  return String(todayISO).slice(0, 10) < isoDate(e);
}

/**
 * (F2) هل قائمة الدفعات القريبة المقروءة تغطي تاريخ هذا السداد؟ null = لم تُقرأ (خطأ) ⇒ لا.
 * القراءة بسقف `cap` صفًّا مرتبة تنازليًّا: إن بلغت السقف فما قبل أقدم صفّ فيها غير معروف.
 */
export function recentCovers(recent: { paid_on?: string | null }[] | null | undefined, paidOn: string, cap = 60): boolean {
  if (!recent) return false;
  if (recent.length < cap) return true;
  const oldest = recent.reduce((m, x) => (String(x.paid_on || "") < m ? String(x.paid_on || "") : m), "9999-12-31");
  return String(paidOn || "") >= oldest;
}

/**
 * (F3) «مضافة فوق الإيجار»: المبلغ المُدخل يساوي المتبقي شاملًا الضريبة (±1 ريال) ⇒ غالبًا
 * أُدخل شاملًا والتسجيل بوحدة الإيجار. يُرجع المتبقي بدون الضريبة، أو null.
 */
export function vatInclusiveSlip(amount: number, remaining: number, vat?: VatSettings | null): number | null {
  if (!vat?.enabled || vat.inclusive !== false || !(remaining > 0)) return null;
  const withVat = splitVat(remaining, vat).total;
  return Math.abs((Number(amount) || 0) - withVat) <= 1 ? r2(remaining) : null;
}
