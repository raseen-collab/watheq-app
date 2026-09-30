/**
 * وثيق — أرقام اتحاد الملاك في الواجهة: نسخة مطابقة لقواعد القاعدة (schema-v60/v63).
 *
 *  • الرسم الفعلي للمالك = fee_override ?? associations.fee (v63).
 *  • الرصيد = مقدَّم×الرسم + الجزئي − متأخر×الرسم (v60) — والتقسيم نفسه.
 *  • رسم الحصة للفترة = round(الموازنة السنوية × الحصة ÷ (100 × فترات السنة), 2)
 *    بحساب صحيح (BigInt) حتى تطابق المعاينة ما تحسبه القاعدة بالهللة.
 *  • الفترة: شهرية أو سنوية (تبدأ السنة المالية في fiscal_start_month).
 */

export type FeePeriod = "monthly" | "annual";
export type FeeBasis = "equal" | "share";

export const periodOf = (a?: { fee_period?: string | null } | null): FeePeriod =>
  a?.fee_period === "annual" ? "annual" : "monthly";
export const basisOf = (a?: { fee_basis?: string | null } | null): FeeBasis =>
  a?.fee_basis === "share" ? "share" : "equal";

/** الرسم الفعلي لمالك (للفترة) */
export function feeOf(o: { fee_override?: number | string | null } | null | undefined, a: { fee?: number | string | null } | null | undefined): number {
  const ov = Number(o?.fee_override);
  if (o?.fee_override != null && ov > 0) return ov;
  return Number(a?.fee) || 0;
}

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** المستحق الصافي على مالك بالريال */
export const ownerDueAt = (o: { months_late?: number | null; partial_amount?: number | string | null }, fee: number) =>
  Math.max(0, r2((Number(o.months_late) || 0) * fee - (Number(o.partial_amount) || 0)));

/** الرصيد بالريال (موجب = له، سالب = عليه) — مطابق لـ watheq_owner_balance */
export const ownerBalance = (o: { months_late?: number | null; partial_amount?: number | string | null; prepaid_months?: number | null }, fee: number) =>
  r2((Number(o.prepaid_months) || 0) * fee + (Number(o.partial_amount) || 0) - (Number(o.months_late) || 0) * fee);

/** تقسيم الرصيد على رسم — مطابق لـ watheq_owner_split (بالهللات لتفادي كسور الفاصلة العائمة) */
export function splitBalance(bal: number, fee: number): { late: number; partial: number; prepaid: number } {
  const b = Math.round(bal * 100), f = Math.round(fee * 100);
  if (!(f > 0)) return { late: 0, partial: r2(bal), prepaid: 0 };
  if (b >= 0) { const prepaid = Math.floor(b / f); return { late: 0, prepaid, partial: (b - prepaid * f) / 100 }; }
  const late = Math.ceil(-b / f);
  return { late, prepaid: 0, partial: (late * f + b) / 100 };
}

/** رسم الحصة للفترة — مطابق لـ watheq_share_fee: round(total×share / (100×ppy), 2)، تقريب نصف لأعلى */
export function shareFee(total: number, share: number, period: FeePeriod): number {
  const tc = BigInt(Math.round((Number(total) || 0) * 100));        // هللات
  const su = BigInt(Math.round((Number(share) || 0) * 10000));      // الحصة × 10⁴ (numeric(7,4))
  const den = BigInt(1000000 * (period === "annual" ? 1 : 12));   // 100 (نسبة) × 10⁴ × ppy
  const zero = BigInt(0), two = BigInt(2);
  if (tc <= zero || su <= zero) return 0;
  return Number((two * tc * su + den) / (two * den)) / 100;
}

/** مجموع الحصص بدقة 4 منازل */
export const sharesSum = (xs: (number | string | null | undefined)[]) =>
  xs.reduce<number>((s, x) => s + Math.round((Number(x) || 0) * 10000), 0) / 10000;
export const sharesValid = (sum: number) => Math.abs(sum - 100) <= 0.01;

/** حصص من المساحات: كل مساحة ÷ المجموع × 100 (4 منازل)، والفرق يُضاف لأكبر وحدة حتى يكون المجموع 100 تمامًا */
export function sharesFromAreas(areas: number[]): number[] {
  const tot = areas.reduce((s, x) => s + (Number(x) > 0 ? Number(x) : 0), 0);
  if (!(tot > 0)) return areas.map(() => 0);
  const units = areas.map((x) => (Number(x) > 0 ? Math.round((Number(x) / tot) * 1000000) : 0)); // ×10⁴ من 100
  const diff = 1000000 - units.reduce((s, x) => s + x, 0);
  if (diff !== 0) { let k = 0; units.forEach((u, i) => { if (u > units[k]) k = i; }); units[k] += diff; }
  return units.map((u) => u / 10000);
}

// ─── الفترة (أسماء وتواريخ) ──────────────────────────────────────
export const PERIOD_WORDS: Record<FeePeriod, { one: string; adj: string; label: string; every: string; per: string }> = {
  monthly: { one: "شهر", adj: "الشهري", label: "الاشتراك الشهري", every: "شهريًّا", per: "/شهر" },
  annual: { one: "سنة", adj: "السنوي", label: "الاشتراك السنوي", every: "سنويًّا", per: "/سنة" },
};

/** «شهر واحد / شهران / 3 أشهر / 11 شهرًا» أو «سنة واحدة / سنتان / 3 سنوات / 11 سنة» */
export function periodsAr(n: number | null | undefined, period: FeePeriod): string {
  const x = Math.abs(Math.round(Number(n) || 0));
  const r = x % 100;
  if (period === "annual") {
    if (x === 1) return "سنة واحدة";
    if (x === 2) return "سنتان";
    if (r >= 3 && r <= 10) return `${x} سنوات`;
    return `${x} سنة`;
  }
  if (x === 1) return "شهر واحد";
  if (x === 2) return "شهران";
  if (r >= 3 && r <= 10) return `${x} أشهر`;
  if (r >= 11) return `${x} شهرًا`;
  return `${x} شهر`;
}

export const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** بداية الفترة التي يقع فيها اليوم (YYYY-MM-DD) — مطابق لـ watheq_hoa_period_start */
export function periodStart(period: FeePeriod, fiscal: number, isoDay: string): string {
  const [y, m] = isoDay.split("-").map(Number);
  if (period === "annual") {
    const f = Math.min(12, Math.max(1, Number(fiscal) || 1));
    return `${m < f ? y - 1 : y}-${String(f).padStart(2, "0")}-01`;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

// ─── بنود المصروفات ─────────────────────────────────────────────
export const EXPENSE_CATEGORIES: { v: string; l: string }[] = [
  { v: "maintenance", l: "صيانة وإصلاحات" },
  { v: "cleaning", l: "نظافة" },
  { v: "security", l: "حراسة وأمن" },
  { v: "elevators", l: "المصاعد" },
  { v: "utilities", l: "كهرباء ومياه مشتركة" },
  { v: "management", l: "أتعاب الإدارة" },
  { v: "insurance", l: "تأمين" },
  { v: "admin", l: "مصروفات إدارية وبنكية" },
  { v: "other", l: "أخرى" },
];
export const expenseCatAr = (v?: string | null) => EXPENSE_CATEGORIES.find((c) => c.v === v)?.l || "أخرى";

/** أرقام العمارة المجمَّعة (watheq_hoa_building_data) — لا أسماء ملاك فيها */
export type BuildingData = {
  name: string; units: number; fee: number | null; fee_period?: string; fee_basis?: string;
  fund_balance: number; today: string; month_start: string; year_start: string;
  month_collected: number; year_collected: number; month_expenses: number; year_expenses: number;
  by_category: { category: string; total: number }[];
  recent: { spent_on: string; category: string; description: string; amount: number }[];
  owners_total: number; owners_paid: number; collection_pct: number | null;
  office?: { org_name: string | null } | null;
};

// ─── العدد والمعدود ─────────────────────────────────────────────
/** «ريال واحد · ريالان · 3 ريالات · 11 ريالًا · 100 ريال» — الكسر: «250.50 ريال» */
export function riyalsAr(n: number | null | undefined, fmt: (x: number) => string = (x) => x.toLocaleString("en-US", { maximumFractionDigits: 2 })): string {
  const v = Math.abs(Number(n) || 0);
  if (!Number.isInteger(v)) return `${fmt(v)} ريال`;
  const r = v % 100;
  if (v === 1) return "ريال واحد";
  if (v === 2) return "ريالان";
  if (r >= 3 && r <= 10) return `${fmt(v)} ريالات`;
  if (r >= 11) return `${fmt(v)} ريالًا`;
  return `${fmt(v)} ريال`;
}
/** «مالك واحد · مالكان · 3 ملّاك · 12 مالكًا · 100 مالك» */
export function ownersAr(n: number | null | undefined): string {
  const x = Math.abs(Math.round(Number(n) || 0)), r = x % 100;
  if (x === 1) return "مالك واحد";
  if (x === 2) return "مالكان";
  if (r >= 3 && r <= 10) return `${x} ملّاك`;
  if (r >= 11) return `${x} مالكًا`;
  return `${x} مالك`;
}

// ─── التفقيط (المبلغ كتابةً) ─────────────────────────────────────
const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
/* المعدود المؤنّث (هللة): 3–10 بعكس التذكير، و1–2 و11–19 بصيغة المؤنث */
const ONES_F = ["", "واحدة", "اثنتان", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثماني", "تسع"];
const TEENS_F = ["عشر", "إحدى عشرة", "اثنتا عشرة", "ثلاث عشرة", "أربع عشرة", "خمس عشرة", "ست عشرة", "سبع عشرة", "ثماني عشرة", "تسع عشرة"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

/** 0–999 كتابةً: «ثلاثمائة وخمسة وأربعون» */
function below1000(n: number, fem = false): string {
  const h = Math.floor(n / 100), rest = n % 100, parts: string[] = [];
  const ones = fem ? ONES_F : ONES, teens = fem ? TEENS_F : TEENS;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 10) parts.push(ones[rest]);
    else if (rest < 20) parts.push(teens[rest - 10]);
    else { const u = rest % 10, t = Math.floor(rest / 10); parts.push(u ? `${ones[u]} و${TENS[t]}` : TENS[t]); }
  }
  return parts.join(" و");
}
/** مقدار مرتبة (ألف/مليون/مليار) بعددها: ألف · ألفان · 3 آلاف · 11 ألفًا · 100 ألف */
function scaleWords(c: number, one: string, two: string, plural: string, acc: string): string {
  if (c === 1) return one;
  if (c === 2) return two;
  const r = c % 100, w = below1000(c);
  if (r >= 3 && r <= 10) return `${w} ${plural}`;
  if (r >= 11) return `${w} ${acc}`;
  return `${w} ${one}`;
}
/** عدد صحيح كتابةً (حتى 999,999,999,999) */
export function intToArabicWords(n: number): string {
  let x = Math.floor(Math.abs(Number(n) || 0));
  if (x === 0) return "صفر";
  const bil = Math.floor(x / 1e9); x %= 1e9;
  const mil = Math.floor(x / 1e6); x %= 1e6;
  const th = Math.floor(x / 1e3); const rest = x % 1e3;
  const parts: string[] = [];
  if (bil) parts.push(scaleWords(bil, "مليار", "ملياران", "مليارات", "مليارًا"));
  if (mil) parts.push(scaleWords(mil, "مليون", "مليونان", "ملايين", "مليونًا"));
  if (th) parts.push(scaleWords(th, "ألف", "ألفان", "آلاف", "ألفًا"));
  if (rest) parts.push(below1000(rest));
  return parts.join(" و");
}
/**
 * التفقيط للسندات بالصيغة المتعارفة في السعودية:
 * 1250.75 ⇒ «فقط ألف ومائتان وخمسون ريال سعودي وخمس وسبعون هللة لا غير»
 * (نستعمل «ريال سعودي» بصيغة التمييز الثابتة المتعارفة: «فقط … ريال سعودي … لا غير»)
 */
export function amountInWordsAr(amount: number | null | undefined): string {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const riyals = Math.floor(cents / 100), halalas = cents % 100;
  const parts = [riyals === 1 ? "فقط ريال سعودي واحد" : riyals === 2 ? "فقط ريالان سعوديان" : `فقط ${intToArabicWords(riyals)} ريال سعودي`];
  if (halalas) parts.push(halalas === 1 ? "وهللة واحدة" : halalas === 2 ? "وهللتان" : `و${below1000(halalas, true)} هللة`);
  return parts.join(" ") + " لا غير";
}
