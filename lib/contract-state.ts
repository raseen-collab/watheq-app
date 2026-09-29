import { isVacant, withVat } from "./contracts";
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
