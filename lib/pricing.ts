/**
 * أسعار وثيق — مرآة watheq_sub_price في schema-v71 (القاعدة هي الحَكَم:
 * المبلغ المسجَّل في الطلب يُحسب هناك، وهذا للعرض فقط).
 * أسعار المؤسسين المنشورة في watheqapp.com بتاريخ 3 أكتوبر 2026.
 */
export type PropPlan = "basic" | "full";
export type HoaPlan = "basic" | "pro" | "full";

export const PROP_PLANS: { id: PropPlan; name: string; monthly: number; note: string }[] = [
  { id: "basic", name: "باقة المالك", monthly: 99, note: "عقار واحد · وحدات غير محدودة" },
  { id: "full", name: "باقة المكتب", monthly: 199, note: "عقارات غير محدودة · كل المزايا" },
];
export const HOA_PLANS: { id: HoaPlan; name: string; monthly: number; note: string }[] = [
  { id: "basic", name: "الأساسية", monthly: 59, note: "جمعية واحدة حتى 20 وحدة" },
  { id: "pro", name: "الاحترافية", monthly: 99, note: "جمعية واحدة بلا حد للوحدات" },
  { id: "full", name: "الشاملة", monthly: 149, note: "جمعيات غير محدودة" },
];
export const OFFICE_YEARLY = 1990;

/** null = تركيبة غير متاحة (نفس قواعد القاعدة حرفيًّا) */
export function subPrice(prop: PropPlan | null, hoa: HoaPlan | null, months: number): number | null {
  if (months !== 1 && months !== 12) return null;
  if (!prop && !hoa) return null;
  if (months === 12) return prop === "full" && !hoa ? OFFICE_YEARLY : null;
  let t = 0;
  if (prop) { const p = PROP_PLANS.find((x) => x.id === prop); if (!p) return null; t += p.monthly; }
  if (hoa) { const h = HOA_PLANS.find((x) => x.id === hoa); if (!h) return null; t += h.monthly; }
  return t;
}

export const SUB_CLAIM_ERRORS: Record<string, string> = {
  not_signed_in: "انتهت الجلسة — سجّل الدخول من جديد.",
  not_owner: "الاشتراك لصاحب المكتب — اطلب منه إتمامه من حسابه.",
  bad_plan: "اختر باقة صالحة لنوع حسابك.",
  bad_name: "اكتب اسم المحوِّل كما يظهر في البنك (حرفان على الأقل).",
  bad_ref: "رقم المرجع طويل — 60 حرفًا كحد أقصى.",
  bad_date: "تاريخ التحويل يجب أن يكون اليوم أو خلال آخر 30 يومًا.",
  already_pending: "عندك طلب اشتراك قيد المراجعة — ننتظر تأكيده أولًا.",
};
