// ============================================================
// وثيق — طلبات الباحثين والمطابقة الحتمية مع المعروضات
//
// لا ذكاء اصطناعي هنا عمدًا: المطابقة شروط صريحة يفهمها صاحب
// المكتب ويستطيع تفسيرها لعميله — نفس النوع ونفس العرض، السعر
// داخل الميزانية، المساحة داخل المدى، وتقاطع الأحياء إن ذُكرت.
// الحقل الفارغ في الطلب = «لا يهم» فلا يُقصي شيئًا.
// ============================================================

import { isOpen, type Listing, type ListingKind, type OfferType } from "./listings";

export type SeekerRequest = {
  id: string;
  kind: ListingKind;
  offer_type: OfferType;
  seeker_name?: string | null;
  seeker_phone?: string | null;
  districts?: string | null;   // «النرجس، الياسمين» — فواصل عربية أو لاتينية
  city?: string | null;
  price_max?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  status?: string | null;      // active | closed
  note?: string | null;
};

export const isActiveRequest = (r: SeekerRequest) => String(r.status || "active") === "active";

/** تطبيع نص عربي للمقارنة: إزالة ال التعريف والهمزات وتوحيد التاء */
function norm(s: string): string {
  return String(s || "")
    .trim().toLowerCase()
    .replace(/^ال/, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

export function splitDistricts(v?: string | null): string[] {
  return String(v || "")
    .split(/[،,؛;]+/)
    .map((x) => norm(x))
    .filter(Boolean);
}

/** هل يطابق هذا المعروضُ هذا الطلبَ؟ (قرار ثنائي قابل للتفسير) */
export function matches(l: Listing, r: SeekerRequest): boolean {
  if (!isOpen(l) || !isActiveRequest(r)) return false;
  if (l.kind !== r.kind || l.offer_type !== r.offer_type) return false;

  const price = Number(l.price) || 0;
  const maxP = Number(r.price_max) || 0;
  if (maxP > 0 && price > 0 && price > maxP) return false;

  const area = Number(l.area) || 0;
  const minA = Number(r.area_min) || 0;
  const maxA = Number(r.area_max) || 0;
  if (area > 0) {
    if (minA > 0 && area < minA) return false;
    if (maxA > 0 && area > maxA) return false;
  }

  const wanted = splitDistricts(r.districts);
  if (wanted.length) {
    const have = norm(l.district || "");
    if (!have) return false; // الطلب حدّد أحياء والمعروض بلا حي — لا نجزم بالمطابقة
    if (!wanted.some((w) => have.includes(w) || w.includes(have))) return false;
  }

  const rCity = norm(r.city || "");
  if (rCity) {
    const lCity = norm(l.city || "");
    if (lCity && lCity !== rCity) return false; // مدينة المعروض مجهولة؟ لا نُقصيه
  }
  return true;
}

export function matchesForListing(l: Listing, requests: SeekerRequest[]): SeekerRequest[] {
  return (requests || []).filter((r) => matches(l, r));
}

export function matchesForRequest(r: SeekerRequest, listings: Listing[]): Listing[] {
  return (listings || []).filter((l) => matches(l, r));
}

/** وصف الطلب في سطر: «شقة للإيجار · النرجس · حتى 45,000 · 120–160 م²» */
export function requestDesc(r: SeekerRequest, kindLabel: string, offerLabel: string): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const bits: (string | null)[] = [`${kindLabel} ${offerLabel}`];
  if (r.districts) bits.push(String(r.districts));
  if (r.city) bits.push(String(r.city));
  if (Number(r.price_max) > 0) bits.push(`حتى ${fmt(Number(r.price_max))}`);
  const a1 = Number(r.area_min) || 0, a2 = Number(r.area_max) || 0;
  if (a1 && a2) bits.push(`${fmt(a1)}–${fmt(a2)} م²`);
  else if (a1) bits.push(`من ${fmt(a1)} م²`);
  else if (a2) bits.push(`حتى ${fmt(a2)} م²`);
  return bits.filter(Boolean).join(" · ");
}

/**
 * سطر الملخّص اليومي: كم طلبًا نشطًا له معروض مطابق ينتظر مكالمة.
 * سطر واحد مُجمَّع عمدًا — التفاصيل مكانها اللوحة لا رسالة تليجرام.
 */
export function requestsDigestLines(requests: SeekerRequest[], listings: Listing[]): string[] {
  const withMatch = (requests || []).filter(
    (r) => isActiveRequest(r) && matchesForRequest(r, listings).length > 0,
  );
  if (!withMatch.length) return [];
  const sample = withMatch.slice(0, 3)
    // تليجرام يقرأ HTML: اسم طالب فيه < يُسقط ملخّص المكتب كله
    .map((r) => `${String(r.seeker_name || "طلب").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}: ${matchesForRequest(r, listings).map((l) => l.code).slice(0, 3).join("، ")}`)
    .join(" · ");
  return [`🔎 ${withMatch.length} ${withMatch.length === 1 ? "طلب له معروض مطابق" : "طلبات لها معروضات مطابقة"} (${sample}${withMatch.length > 3 ? "…" : ""})`];
}
