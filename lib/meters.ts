/**
 * عدادات العقار الرئيسية (schema-v68 — طلب مكتب، 2 أكتوبر 2026).
 *
 * العمارة فيها عدادات مشتركة غير عدادات الشقق: كهرباء المصعد، كهرباء
 * الخدمات (الدرج والإنارة)، وعداد ماء أو اثنان. المكتب يحتاج أرقام حساباتها
 * في مكان واحد، وتظهر للمالك في تقريره مع عددها.
 *
 * عدادا كل شقة ليسا هنا — هما في الوحدة نفسها (tenants.elec_account /
 * water_account) منذ schema-v15.
 */

export type MeterType = "elec" | "water";
export type PropertyMeter = { type: MeterType; label?: string | null; account: string };

export const METER_TYPE_AR: Record<MeterType, string> = { elec: "كهرباء", water: "ماء" };
export const MAX_METERS = 30;   /* يطابق قيد properties_meters_shape */

/** أرقام عربية/فارسية → إنجليزية: رقم الحساب يُنسخ ويُبحث عنه كما في الفاتورة */
function enDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
          .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

/**
 * ما يُحفظ فعلًا: صفوف لها رقم حساب، بنوع معروف، بلا تكرار، حتى 30.
 * الصف الذي أُضيف ولم يُكتب رقمه يسقط بصمت — حفظ «عداد بلا رقم» لا يفيد
 * أحدًا ويُطبع «—» في تقرير المالك. لا شيء = null لا [].
 */
export function cleanMeters(raw: unknown): PropertyMeter[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PropertyMeter[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const type: MeterType = (m as any).type === "water" ? "water" : "elec";
    const account = enDigits(String((m as any).account ?? "")).replace(/\s+/g, " ").trim().slice(0, 40);
    if (!account) continue;
    const key = type + "|" + account;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = String((m as any).label ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    out.push({ type, label: label || null, account });
    if (out.length >= MAX_METERS) break;
  }
  return out.length ? out : null;
}

/** «كهرباء: 3 عدادات · ماء: عداد واحد» — للعرض في الواجهة والمستندات */
export function metersCountLine(meters: PropertyMeter[] | null | undefined): string {
  const list = meters || [];
  const n = (t: MeterType) => list.filter((m) => m.type === t).length;
  const word = (c: number) => c === 1 ? "عداد واحد" : c === 2 ? "عدادان" : c <= 10 ? `${c} عدادات` : `${c} عدادًا`;
  return (["elec", "water"] as MeterType[]).filter((t) => n(t) > 0)
    .map((t) => `${METER_TYPE_AR[t]}: ${word(n(t))}`).join(" · ");
}
