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
