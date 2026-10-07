export type PropertyType = "residential" | "showroom" | "office" | "warehouse" | "villa" | "land";

export const PROPERTY_TYPES: { value: PropertyType; label: string; unitLabel: string; icon: string }[] = [
  { value: "residential", label: "عمارة سكنية",   unitLabel: "شقة",   icon: "🏢" },
  { value: "showroom",    label: "معرض تجاري",    unitLabel: "معرض",  icon: "🏬" },
  { value: "office",      label: "مبنى مكاتب",    unitLabel: "مكتب",  icon: "🏛️" },
  { value: "warehouse",   label: "مستودع",        unitLabel: "مستودع", icon: "🏭" },
  { value: "villa",       label: "فيلا / فلل",    unitLabel: "فيلا",  icon: "🏡" },
  { value: "land",        label: "أرض",           unitLabel: "قطعة",  icon: "🗺️" },
];

export const typeLabel = (t?: string | null) =>
  PROPERTY_TYPES.find((x) => x.value === t)?.label ?? "عقار";

export const unitLabel = (t?: string | null) =>
  PROPERTY_TYPES.find((x) => x.value === t)?.unitLabel ?? "وحدة";

/**
 * اسم الوحدة لمستأجر بعينه (7 أكتوبر 2026).
 *
 * في العمارة المختلطة (شقق ومحلات) كان كل مستند ورسالة لمستأجر يأخذ اسم
 * الوحدة من نوع العقار، فوصل لمستأجر المحل «شاغل شقة رقم (م2)» في خطاب
 * المطالبة وكشف الحساب والفاتورة — بينما سطر «الوحدة» في المستند نفسه يقول
 * «محل رقم (م2)». نوع الوحدة إن حُدِّد أولى، وإلا فنوع العقار كما كان.
 */
const UNIT_TYPE_WORD: Record<string, string> = {
  apartment: "شقة", annex: "شقة ملحق", studio: "استديو", room: "غرفة", shop: "محل",
  office: "مكتب", warehouse: "مستودع", land: "أرض", villa: "فيلا",
};
export const unitWordFor = (unitType?: string | null, propertyType?: string | null) =>
  (unitType && UNIT_TYPE_WORD[unitType]) || unitLabel(propertyType);

export const typeIcon = (t?: string | null) =>
  PROPERTY_TYPES.find((x) => x.value === t)?.icon ?? "🏢";

export type Role = "association" | "property";

export const ROLE_LABEL: Record<Role, string> = {
  association: "إدارة جمعية ملاك",
  property: "إدارة أملاك وعقارات",
};

/** أيام متبقية في التجربة المجانية */
export function trialDaysLeft(endsAt?: string | null): number | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}
