export type PropertyType = "residential" | "mixed" | "showroom" | "office" | "warehouse" | "villa" | "land";

export const PROPERTY_TYPES: { value: PropertyType; label: string; unitLabel: string; icon: string }[] = [
  { value: "residential", label: "عمارة سكنية",   unitLabel: "شقة",   icon: "🏢" },
  /* (16 نوفمبر 2026 — مكتب «الأولى») مجمّع فيه شقق ومعارض ومحلات: كان يُسجَّل «سكنية» فيُكتب «شقة»
     لمستأجر المعرض في كل مستند. هنا الكلمة العامة «وحدة»، ونوع كل وحدة يحدّد اسمها وضريبتها. */
  { value: "mixed",       label: "عمارة سكنية تجارية", unitLabel: "وحدة", icon: "🏘️" },
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
  /* (16 نوفمبر 2026) المعرض كان بلا نوع وحدة فيأخذ «شقة» من نوع العقار؛ و«أخرى» تُكتب «وحدة» لا «شقة» */
  showroom: "معرض", other: "وحدة",
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

/**
 * (24 نوفمبر 2026 — التقييم الثاني) «فيلا فيلا 2»: رقم الوحدة نفسه يبدأ أحيانًا بنوعها
 * (مكتوب «فيلا 2» أو «محل 3» في الإكسل). لا نكرر الكلمة.
 */
export function withUnitWord(word: string, unit?: string | null): string {
  const u = String(unit ?? "").trim();
  if (!u) return `${word} —`;
  const w = String(word || "").trim();
  return w && (u === w || u.startsWith(w + " ") || u.startsWith("ال" + w)) ? u : `${w} ${u}`.trim();
}
