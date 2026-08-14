// ============================================================
// حالة الاشتراك — مصدر الحقيقة الوحيد
// ============================================================
// قبل هذا الملف كان القرار يُتخذ في أربعة أماكن من `plan` وحده،
// فمن ضُبطت باقته مرة واحدة يبقى «مشتركًا» إلى الأبد ولو انتهى دفعه.
// كل موضع يقرّر «مشترك أم لا» يجب أن يمرّ من هنا.

export type SubKind = "paid" | "paid_soon" | "trial" | "expired";

export type SubProfile = {
  plan?: string | null;
  trial_ends_at?: string | null;
  subscribed_until?: string | null;
};

export const PAID_PLANS = ["basic", "pro", "full"] as const;

const ts = (v?: string | null): number | null => {
  if (!v) return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};

const daysFrom = (t: number | null): number | null =>
  t === null ? null : Math.ceil((t - Date.now()) / 86400000);

export type SubState = {
  /** اشتراك مدفوع ساري — مستندات نظيفة وحصة الباقة كاملة */
  paid: boolean;
  /** تجربة سارية — لا علامة مائية، فقط سطر «أُنشئ عبر وثيق» */
  trial: boolean;
  /** لا تجربة ولا اشتراك ساريين — تعود العلامة المائية وتُقلَّص الحصة */
  expired: boolean;
  kind: SubKind;
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
  const paid = planPaid && subActive;

  const trial = !paid && trialT !== null && trialT >= Date.now();
  const expired = !paid && !trial;

  const kind: SubKind = paid
    ? (subDaysLeft !== null && subDaysLeft <= 7 ? "paid_soon" : "paid")
    : trial ? "trial" : "expired";

  return { paid, trial, expired, kind, subDaysLeft, trialDaysLeft, planPaid };
}

/** ما يمرَّر إلى مولّدات المستندات: trial = سطر المصدر · expired = علامة مائية */
export function issuerMarks(p?: SubProfile | null): { trial: boolean; expired: boolean } {
  const s = subState(p);
  return { trial: !s.paid, expired: s.expired };
}
