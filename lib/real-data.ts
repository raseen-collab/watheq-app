import { subState, type SubProfile } from "./subscription";

/**
 * فصل بيانات التجربة عن البيانات الحقيقية — تعريف واحد لكل لوحات الإدارة.
 *
 * السبب: بذرة التجربة (is_demo) كانت تُحسب استخدامًا حقيقيًّا في أربعة أماكن
 * مستقلة (لوحة الإدارة، الإحاطة اليومية، مولّد الإعلانات، نبض تليجرام)، فظهر
 * حسابان لم يُدخلا شيئًا بوصفهما «أضافا عقارًا وسجّلا دفعة» بـ5 عقارات و80 وحدة
 * و148 دفعة — وهي أرقام الديمو حرفيًّا. أربع نسخ من الفلترة تعني أن إصلاح
 * ثلاثة منها يترك الرابعة تكذب، فالتعريف هنا مرة واحدة.
 *
 * قاعدة التبعية: الوحدة تجريبية إذا كان عقارها تجريبيًّا (والوحدات تُحذف مع
 * عقارها بالفعل — `on delete cascade`).
 *
 * أما الدفعة فلا يكفي مرجع عقارها: `payments.property_id` مُعرَّف
 * `on delete set null`، فحذف عقار تجريبي واحد يترك دفعاته بلا مرجع فتُقرأ
 * حقيقيةً ويظهر حساب لم يُدخل شيئًا وكأنه يحصّل إيجارات. لذلك تُقرأ الدفعة
 * من وسمها `is_demo` (schema-v50) أولًا، ويبقى المرجع احتياطًا للصفوف
 * القديمة التي سبقت الترحيل. ودفعة بلا وسم وبلا عقار تُعدّ حقيقية، لأن
 * إخفاء دفعة حقيقية أسوأ من إظهار تجريبية.
 */

export type DemoProp = { id: string; is_demo?: boolean | null };
export type DemoChild = { property_id?: string | null };
/** الدفعة تحمل وسمها بنفسها منذ schema-v50 — لا تتأثر بحذف عقارها */
export type DemoPayment = DemoChild & { is_demo?: boolean | null };

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
  Y extends DemoPayment,
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
  const realPayments = (payments || []).filter(
    (p) => !p.is_demo && (!p.property_id || !demoPropIds.has(String(p.property_id))),
  );

  const demoOnly = (userId: string) =>
    (properties || []).some((p) => p.user_id === userId && p.is_demo) &&
    !realProperties.some((p) => p.user_id === userId) &&
    !(otherOwned || []).some((a) => a.user_id === userId);

  return { demoPropIds, realProperties, realTenants, realPayments, demoOnly };
}

/** معرّفات حسابات الإدارة — حساب صاحب المنصة مشترك إداريًّا لا بيعًا، فلا يُعدّ عميلًا دافعًا. */
export const adminIds = (): string[] =>
  (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * «عميل دافع» — تعريف واحد لكل الشاشات.
 *
 * كان محسوبًا بثلاث طرق: `subState()` في /admin، ومقارنة `subscribed_until`
 * مباشرةً في /admin/ads والإحاطة ومولّد الإعلانات. الفرق ليس نظريًّا — فترة
 * السماح (5 أيام) وحدها تجعل مشتركًا تأخّر يومين يظهر «1 دافع · MRR 199»
 * في لوحة الإدارة و«0 مشترك» في رسالة تليجرام في اليوم نفسه.
 *
 * ثلاثة شروط: حالة اشتراك مدفوعة حسب `lib/subscription`، وليس حساب إدارة،
 * وليس موظفًا في مكتب (للموظف صفّ profiles بتجربة 30 يومًا لا اشتراك).
 */
export function isPayingCustomer(
  p: SubProfile & { id?: string | null },
  opts: { admins?: string[]; memberIds?: Set<string> } = {},
): boolean {
  const id = String(p?.id || "");
  if (opts.admins && opts.admins.includes(id)) return false;
  if (opts.memberIds && opts.memberIds.has(id)) return false;
  return subState(p).paid;
}
