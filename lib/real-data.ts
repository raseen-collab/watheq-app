/**
 * فصل بيانات التجربة عن البيانات الحقيقية — تعريف واحد لكل لوحات الإدارة.
 *
 * السبب: بذرة التجربة (is_demo) كانت تُحسب استخدامًا حقيقيًّا في أربعة أماكن
 * مستقلة (لوحة الإدارة، الإحاطة اليومية، مولّد الإعلانات، نبض تليجرام)، فظهر
 * حسابان لم يُدخلا شيئًا بوصفهما «أضافا عقارًا وسجّلا دفعة» بـ5 عقارات و80 وحدة
 * و148 دفعة — وهي أرقام الديمو حرفيًّا. أربع نسخ من الفلترة تعني أن إصلاح
 * ثلاثة منها يترك الرابعة تكذب، فالتعريف هنا مرة واحدة.
 *
 * قاعدة التبعية: الوحدة تجريبية إذا كان عقارها تجريبيًّا. والدفعة تجريبية إذا
 * كانت مربوطة بعقار تجريبي؛ ودفعة بلا عقار (property_id فارغ) تُعدّ حقيقية،
 * لأن إخفاء دفعة حقيقية أسوأ من إظهار دفعة تجريبية واحدة.
 */

export type DemoProp = { id: string; is_demo?: boolean | null };
export type DemoChild = { property_id?: string | null };

export type RealSplit<P, T, Y> = {
  demoPropIds: Set<string>;
  realProperties: P[];
  realTenants: T[];
  realPayments: Y[];
  /** هل هذا الحساب لم يُدخل إلا بذرة التجربة؟ */
  demoOnly: (userId: string) => boolean;
};

export function splitDemo<
  P extends DemoProp & { user_id?: string | null },
  T extends DemoChild,
  Y extends DemoChild,
>(
  properties: P[],
  tenants: T[],
  payments: Y[],
  /** كيانات أخرى تُثبت استخدامًا حقيقيًّا للحساب (جمعيات الملاك) */
  otherOwned: { user_id?: string | null }[] = [],
): RealSplit<P, T, Y> {
  const demoPropIds = new Set((properties || []).filter((p) => p.is_demo).map((p) => p.id));
  const realProperties = (properties || []).filter((p) => !p.is_demo);
  const realTenants = (tenants || []).filter((t) => !demoPropIds.has(String(t.property_id)));
  const realPayments = (payments || []).filter((p) => !p.property_id || !demoPropIds.has(String(p.property_id)));

  const demoOnly = (userId: string) =>
    (properties || []).some((p) => p.user_id === userId && p.is_demo) &&
    !realProperties.some((p) => p.user_id === userId) &&
    !(otherOwned || []).some((a) => a.user_id === userId);

  return { demoPropIds, realProperties, realTenants, realPayments, demoOnly };
}

/** معرّفات حسابات الإدارة — حساب صاحب المنصة مشترك إداريًّا لا بيعًا، فلا يُعدّ عميلًا دافعًا. */
export const adminIds = (): string[] =>
  (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
