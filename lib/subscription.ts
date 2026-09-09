// ============================================================
// حالة الاشتراك — مصدر الحقيقة الوحيد
// ============================================================
// قبل هذا الملف كان القرار يُتخذ في أربعة أماكن من `plan` وحده،
// فمن ضُبطت باقته مرة واحدة يبقى «مشتركًا» إلى الأبد ولو انتهى دفعه.
// كل موضع يقرّر «مشترك أم لا» يجب أن يمرّ من هنا.

/**
 * دورة الاشتراك:
 *   paid → paid_soon (آخر 7 أيام) → grace (5 أيام بعد الانتهاء بكامل المزايا)
 *   → expired (علامة مائية وحصة مقلَّصة)
 *
 * لماذا فترة سماح: المكتب لا يجدّد يوم الانتهاء نفسه — يجدّد حين يُذكَّر
 * ويجد وقتًا. قطع المزايا صباح الانتهاء يُشعره بالمعاقبة لا بالتذكير،
 * وخمسة أيام كافية لتواصل ودفع بلا أن تصير الفترة اشتراكًا مجانيًّا.
 */
export type SubKind = "paid" | "paid_soon" | "grace" | "trial" | "expired";

/** أيام السماح بعد انتهاء الاشتراك المدفوع — بكامل المزايا */
export const GRACE_DAYS = 5;
/** قبل كم يوم يبدأ التذكير بالتجديد */
export const SOON_DAYS = 7;

export type SubProfile = {
  plan?: string | null;
  trial_ends_at?: string | null;
  subscribed_until?: string | null;
};

export const PAID_PLANS = ["basic", "pro", "full"] as const;

/**
 * تحويل تاريخ الانتهاء إلى لحظة.
 *
 * القيمة المخزَّنة تاريخ بلا وقت («2026-09-10»)، وDate.parse يجعلها منتصف
 * الليل — أي أن الاشتراك «المنتهي اليوم» يُحسب منتهيًا منذ فجره، فيرى
 * المشترك شارة الانتهاء في يوم دفع فيه. الصحيح أن اليوم الأخير كامل له:
 * نجعل التاريخ المجرّد نهاية يومه بتوقيت الرياض (+03).
 */
const ts = (v?: string | null): number | null => {
  if (!v) return null;
  const raw = String(v).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const t = Date.parse(dateOnly ? `${raw}T23:59:59+03:00` : raw);
  return Number.isNaN(t) ? null : t;
};

const daysFrom = (t: number | null): number | null =>
  t === null ? null : Math.ceil((t - Date.now()) / 86400000);

export type SubState = {
  /** اشتراك مدفوع ساري — مستندات نظيفة وحصة الباقة كاملة */
  paid: boolean;
  /** تجربة سارية — لا علامة مائية، فقط سطر «أُنشئ عبر وثيق» */
  trial: boolean;
  /** انتهى الاشتراك لكن ضمن أيام السماح — كامل المزايا مع تنبيه */
  grace: boolean;
  /** لا تجربة ولا اشتراك ساريين ولا سماح — تعود العلامة المائية وتُقلَّص الحصة */
  expired: boolean;
  kind: SubKind;
  /** أيام السماح المتبقية (null خارج فترة السماح) */
  graceDaysLeft: number | null;
  /** أيام متبقية للاشتراك المدفوع (null إن لم يكن مشتركًا أو بلا تاريخ) */
  subDaysLeft: number | null;
  /** أيام متبقية للتجربة */
  trialDaysLeft: number | null;
  planPaid: boolean;
};

export function subState(p?: SubProfile | null): SubState {
  const plan = String(p?.plan || "").toLowerCase();
  const planPaid = (PAID_PLANS as readonly string[]).includes(plan);

  const subT = ts(p?.subscribed_until);
  const trialT = ts(p?.trial_ends_at);
  const subDaysLeft = daysFrom(subT);
  const trialDaysLeft = daysFrom(trialT);

  // بلا تاريخ اشتراك = لا عقاب: حسابات ضُبطت باقتها يدويًا قبل وجود
  // subscribed_until تبقى سارية حتى يُسجَّل لها تجديد بتاريخ.
  const subActive = planPaid && (subT === null || subT >= Date.now());
  const paidStrict = planPaid && subActive;

  // فترة السماح: انتهى الاشتراك المدفوع منذ أقل من GRACE_DAYS
  const daysSinceEnd = subT !== null ? Math.floor((Date.now() - subT) / 86400000) : null;
  const grace = planPaid && !paidStrict && daysSinceEnd !== null && daysSinceEnd >= 0 && daysSinceEnd < GRACE_DAYS;
  const graceDaysLeft = grace ? GRACE_DAYS - (daysSinceEnd as number) : null;

  // ضمن السماح يُعامَل كمدفوع: مستندات نظيفة وحصة كاملة
  const paid = paidStrict || grace;

  const trial = !paid && trialT !== null && trialT >= Date.now();
  const expired = !paid && !trial;

  const kind: SubKind = grace ? "grace"
    : paidStrict ? (subDaysLeft !== null && subDaysLeft <= SOON_DAYS ? "paid_soon" : "paid")
    : trial ? "trial" : "expired";

  return { paid, trial, grace, expired, kind, subDaysLeft, trialDaysLeft, graceDaysLeft, planPaid };
}

/** ما يمرَّر إلى مولّدات المستندات: trial = سطر المصدر · expired = علامة مائية */
export function issuerMarks(p?: SubProfile | null): { trial: boolean; expired: boolean } {
  const s = subState(p);
  return { trial: !s.paid, expired: s.expired };
}
