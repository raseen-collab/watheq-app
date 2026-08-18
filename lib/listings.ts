// ============================================================
// وثيق — سجل المعروضات (ترتيب داخلي للمكتب)
//
// المبدأ: المعروضات لا تضيع، بل تتعفّن. أسوأ ما يقع للمكتب أن يعرض
// عقارًا بيع قبل شهر أو بسعر قديم — لذلك «تاريخ آخر تأكيد للتوفر»
// حقل أول لا حقل ثانوي، والكود الموحّد هو ما يربط الصور والصك
// والإعلان ومحادثة واتساب بمعروض واحد.
//
// كل ما هنا دوال نقية بلا شبكة ولا حالة — تصلح للوحة والمستند والبوت.
// ============================================================

export type ListingKind = "land" | "apartment" | "villa" | "building" | "shop" | "other";
export type OfferType = "sale" | "rent";
export type ListingStatus = "available" | "reserved" | "contracted" | "withdrawn";

export type Listing = {
  id: string;
  code: string;
  kind: ListingKind;
  offer_type: OfferType;
  title?: string | null;
  district?: string | null;
  city?: string | null;
  price?: number | null;
  area?: number | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  source?: "owner" | "broker" | null;
  deed_no?: string | null;
  plan_no?: string | null;
  parcel_no?: string | null;
  street_count?: number | null;
  unit_no?: string | null;
  floor_no?: number | null;
  rooms?: number | null;
  baths?: number | null;
  building_age?: number | null;
  furnished?: boolean | null;
  status?: ListingStatus | null;
  last_confirmed_at?: string | null;
  brokerage_id?: string | null;
  note?: string | null;
};

/** الأرض حقولها صك ومخطط وقطعة؛ والمبني حقوله دور وغرف — لا يخلطان */
export const KIND_META: Record<ListingKind, { label: string; prefix: string; land: boolean; icon: string }> = {
  land:      { label: "أرض",   prefix: "أ", land: true,  icon: "🗺️" },
  apartment: { label: "شقة",   prefix: "ش", land: false, icon: "🏢" },
  villa:     { label: "فيلا",  prefix: "ف", land: false, icon: "🏡" },
  building:  { label: "عمارة", prefix: "ع", land: false, icon: "🏬" },
  shop:      { label: "محل",   prefix: "م", land: false, icon: "🏪" },
  other:     { label: "أخرى",  prefix: "خ", land: false, icon: "📦" },
};

export const OFFER_LABEL: Record<OfferType, string> = { sale: "للبيع", rent: "للإيجار" };

export const STATUS_META: Record<ListingStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  available:  { label: "متاح",           tone: "ok" },
  reserved:   { label: "محجوز بعربون",   tone: "warn" },
  contracted: { label: "متعاقد",          tone: "muted" },
  withdrawn:  { label: "مسحوب",           tone: "muted" },
};

/** المعروض المسحوب أو المتعاقد لا يُحذف: تاريخ من عُرض عندك رأس مال */
export const isOpen = (l: Listing) => (l.status || "available") === "available" || l.status === "reserved";

/** بعد هذه المدة يُطلب تأكيد التوفر من المالك قبل أي عرض */
export const STALE_DAYS = 30;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function parseISO(v: string): Date {
  // مكوّنات صريحة لا new Date(نص): الأخيرة تنزاح يومًا كاملًا بحسب المنطقة
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** كم يومًا مضى على آخر تأكيد للتوفر؟ null إن لم يُؤكَّد قط */
export function daysSinceConfirm(l: Listing, asOf?: Date): number | null {
  if (!l.last_confirmed_at) return null;
  const d = parseISO(l.last_confirmed_at);
  if (isNaN(d.getTime())) return null;
  return Math.floor((startOfDay(asOf || new Date()).getTime() - startOfDay(d).getTime()) / 86400000);
}

export type Freshness = {
  stale: boolean;                       // يستحق مراجعة قبل العرض
  days: number | null;
  label: string;
  tone: "ok" | "warn" | "muted";
};

/** حالة طزاجة المعروض — تُحتسب للمعروضات المفتوحة فقط */
export function freshness(l: Listing, asOf?: Date): Freshness {
  if (!isOpen(l)) return { stale: false, days: daysSinceConfirm(l, asOf), label: "—", tone: "muted" };
  const d = daysSinceConfirm(l, asOf);
  if (d === null) return { stale: true, days: null, label: "لم يُؤكَّد بعد", tone: "warn" };
  if (d >= STALE_DAYS) return { stale: true, days: d, label: `آخر تأكيد قبل ${d} يومًا — راجعه`, tone: "warn" };
  if (d === 0) return { stale: false, days: 0, label: "أُكِّد اليوم", tone: "ok" };
  return { stale: false, days: d, label: `أُكِّد قبل ${d} يومًا`, tone: "ok" };
}

/** سعر المتر — يُحسب ولا يُكتب، فهو ما يُفاوَض ويُقارَن به */
export function pricePerMeter(l: Pick<Listing, "price" | "area">): number | null {
  const p = Number(l.price) || 0, a = Number(l.area) || 0;
  if (p <= 0 || a <= 0) return null;
  return Math.round((p / a) * 100) / 100;
}

/**
 * الكود التالي لنوع معيّن: أ-101، أ-102…
 * يقرأ الأكواد الموجودة فيبدأ بعدها — ولو حُذف معروض لا يُعاد استخدام كوده.
 */
export function nextCode(existing: Listing[], kind: ListingKind): string {
  const prefix = KIND_META[kind].prefix;
  let max = 100;
  for (const l of existing || []) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(l.code || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

/** الوصف المختصر الذي يميّز المعروض في السطر الواحد */
export function shortDesc(l: Listing): string {
  const meta = KIND_META[l.kind] || KIND_META.other;
  const bits: (string | null)[] = [
    `${meta.label} ${OFFER_LABEL[l.offer_type] || ""}`.trim(),
    l.district || null,
    l.city || null,
    Number(l.area) > 0 ? `${Number(l.area).toLocaleString("en-US")} م²` : null,
  ];
  if (meta.land) {
    bits.push(l.plan_no ? `مخطط ${l.plan_no}` : null, l.parcel_no ? `قطعة ${l.parcel_no}` : null);
  } else {
    bits.push(
      Number(l.rooms) > 0 ? `${l.rooms} غرف` : null,
      l.floor_no != null ? `الدور ${l.floor_no}` : null,
      l.furnished ? "مفروشة" : null,
    );
  }
  return bits.filter(Boolean).join(" · ");
}

/** فرز ثابت: المفتوح أولًا، ثم الأقدم تأكيدًا (ما يحتاج مراجعة يطفو) */
export function sortListings(items: Listing[]): Listing[] {
  const rank = (l: Listing) => (l.status === "available" ? 0 : l.status === "reserved" ? 1 : l.status === "contracted" ? 2 : 3);
  return [...(items || [])].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const da = a.last_confirmed_at || "", db = b.last_confirmed_at || "";
    if (da !== db) return da < db ? -1 : 1; // الأقدم أولًا، وغير المؤكَّد قبل الجميع
    return String(a.code).localeCompare(String(b.code), "ar");
  });
}

/** عدد المعروضات المفتوحة التي تحتاج تأكيد توفر */
export function staleCount(items: Listing[], asOf?: Date): number {
  return (items || []).reduce((n, l) => n + (freshness(l, asOf).stale ? 1 : 0), 0);
}

export type ListingsSummary = {
  total: number; open: number; available: number; reserved: number;
  contracted: number; withdrawn: number; stale: number;
};

export function summarize(items: Listing[], asOf?: Date): ListingsSummary {
  const s: ListingsSummary = { total: 0, open: 0, available: 0, reserved: 0, contracted: 0, withdrawn: 0, stale: 0 };
  for (const l of items || []) {
    s.total++;
    const st = (l.status || "available") as ListingStatus;
    if (st === "available") s.available++;
    else if (st === "reserved") s.reserved++;
    else if (st === "contracted") s.contracted++;
    else s.withdrawn++;
    if (isOpen(l)) s.open++;
    if (freshness(l, asOf).stale) s.stale++;
  }
  return s;
}

/**
 * أسطر الملخّص اليومي: تنبيهان فقط حتى لا تُغرق الرسالة —
 * معروضات تحتاج تأكيد توفر، ومعروضات مفتوحة بعقد وساطة منتهٍ.
 */
export function listingsDigestLines(
  items: Listing[],
  expiredBrokerageIds: Set<string> = new Set(),
  asOf?: Date,
): string[] {
  const lines: string[] = [];
  const stale = (items || []).filter((l) => freshness(l, asOf).stale);
  if (stale.length) {
    const codes = stale.slice(0, 6).map((l) => l.code).join("، ");
    lines.push(`📋 ${stale.length} معروض يحتاج تأكيد توفر (${codes}${stale.length > 6 ? "…" : ""})`);
  }
  const orphan = (items || []).filter((l) => isOpen(l) && l.brokerage_id && expiredBrokerageIds.has(l.brokerage_id));
  if (orphan.length) {
    const codes = orphan.slice(0, 6).map((l) => l.code).join("، ");
    lines.push(`⚠️ ${orphan.length} معروض ما زال مفتوحًا وعقد وساطته انتهى (${codes}${orphan.length > 6 ? "…" : ""})`);
  }
  return lines;
}
