/**
 * 🇬🇧 النسخة الإنجليزية من المستندات (18 نوفمبر 2026 — طلب مكتب «الأولى»: مستأجرون
 * لا يقرؤون العربية يطلبون سند القبض والفاتورة وكشف الحساب وإشعار الانتهاء بالإنجليزية).
 *
 * هذا الملف نقيّ (بلا React ولا Supabase) ليُختبر وحده. لا يترجم ما كتبه المكتب
 * (أسماء المستأجرين والعقارات والملاحظات تبقى كما كُتبت) — يترجم قوالب المستند فقط.
 */

const MONTHS_EN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** 5 March 2026 — ميلادي دائمًا (لا Intl: لا يتأثر بلغة الجهاز) */
export function enDate(v?: string | null): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return String(v);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return String(v);
  return `${Number(m[3])} ${MONTHS_EN[mo]} ${m[1]}`;
}

const METHOD_EN: Record<string, string> = {
  transfer: "Bank transfer", ejar: "Ejar platform", cash: "Cash", pos: "Card terminal (POS)",
  card: "Card", cheque: "Cheque", other: "Other",
};
export const methodEn = (m?: string | null) => METHOD_EN[String(m || "")] || "—";

const FREQ_EN: Record<string, string> = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly", bimonthly: "Every 2 months", quarterly: "Every 3 months",
  trimester: "Every 4 months", semiannual: "Every 6 months", annual: "Annual",
};
/** نفس الافتراضي العربي (freqLabel ⇒ «شهري») */
export const freqEn = (f?: string | null) => FREQ_EN[String(f || "")] || "Monthly";

const UNIT_TYPE_EN: Record<string, string> = {
  apartment: "Apartment", annex: "Annex apartment", studio: "Studio", room: "Room", shop: "Shop",
  office: "Office", warehouse: "Warehouse", land: "Plot", villa: "Villa", showroom: "Showroom", other: "Unit",
};
const PROPERTY_UNIT_EN: Record<string, string> = {
  residential: "Apartment", mixed: "Unit", showroom: "Showroom", office: "Office",
  warehouse: "Warehouse", villa: "Villa", land: "Plot",
};
const PROPERTY_TYPE_EN: Record<string, string> = {
  residential: "Residential building", mixed: "Mixed-use building", showroom: "Commercial showroom",
  office: "Office building", warehouse: "Warehouse", villa: "Villa(s)", land: "Land",
};
/** مطابق لـunitWordFor: نوع الوحدة أولًا ثم كلمة نوع العقار */
export const unitWordEn = (unitType?: string | null, propertyType?: string | null) =>
  (unitType && UNIT_TYPE_EN[unitType]) || PROPERTY_UNIT_EN[String(propertyType || "")] || "Unit";
export const propertyTypeEn = (t?: string | null) => PROPERTY_TYPE_EN[String(t || "")] || "Property";

const USAGE_EN: Record<string, string> = {
  families: "Residential — families", singles: "Residential — singles", mixed: "Residential & commercial", commercial: "Commercial",
};
export const usageEn = (u?: string | null) => (u ? USAGE_EN[String(u)] || String(u) : "");

/** «الدفعة 3 من 12» (كما تُخزَّن في invoices.period_label) ⇒ «Instalment 3 of 12». غير ذلك يبقى كما هو. */
export function periodLabelEn(label?: string | null): string {
  const s = String(label || "").trim();
  const m = /^الدفعة\s+(\d+)\s+من\s+(\d+)$/.exec(s);
  return m ? `Instalment ${m[1]} of ${m[2]}` : s;
}

/* ── المبلغ بالحروف (إنجليزي) — حتى 999,999,999.99 ── */
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ""));
  return parts.join(" and ");
}
export function intToEnglishWords(n: number): string {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return "zero";
  const parts: string[] = [];
  const scales: [number, string][] = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
  for (const [v, w] of scales) {
    const q = Math.floor(n / v);
    if (q) { parts.push(`${below1000(q % 1000)} ${w}`); n %= v; }
  }
  if (n) parts.push(below1000(n));
  return parts.join(" ");
}
/** «Only five thousand three hundred and fifty Saudi riyals» (+ halalas) */
export function riyalsInWordsEn(amount: number): string {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100);
  const riyals = Math.floor(v / 100), halalas = v % 100;
  const r = riyals ? `${intToEnglishWords(riyals)} Saudi ${riyals === 1 ? "riyal" : "riyals"}` : "";
  const h = halalas ? `${intToEnglishWords(halalas)} ${halalas === 1 ? "halala" : "halalas"}` : "";
  const body = [r, h].filter(Boolean).join(" and ") || "zero Saudi riyals";
  return `Only ${body}`;
}

/** «1 instalment» / «3 instalments» */
export const instalmentsEn = (n: number) => `${n} ${n === 1 ? "instalment" : "instalments"}`;

/** بيان سند القبض بالإنجليزية — مرآة receiptStatement العربية */
export function receiptStatementEn(
  pay: { applies_to?: string | null; periods_covered?: number | null },
  unitWord: string, unit: string, freq?: string | null,
): string {
  if (pay.applies_to === "carried") return "Payment of a balance carried over from a previous term";
  if (pay.applies_to === "past_debt") return "Payment of a previous tenant's arrears";
  const n = Number(pay.periods_covered) || 0;
  const cov = n > 0 ? ` — ${instalmentsEn(n)}${freq ? ` (${freqEn(freq)})` : ""}` : " — partial payment";
  return `Rent for ${unitWord} no. (${unit})${cov}`;
}
