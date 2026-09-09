export const sar = (n: number | null | undefined) => (Number(n) || 0).toLocaleString("en-US");

export function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  // المرجع يوم الرياض لا يوم الخادم
  const base = (() => { const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); const [y, m, d] = f.split("-").map(Number); return new Date(y, m - 1, d); })();
  return Math.ceil((new Date(iso).getTime() - base.getTime()) / 86400000);
}

/**
 * رقم واتساب دولي من أي صيغة يكتبها المكتب.
 * حالتان كانتا تُنتجان رابطًا ميتًا يفتح واتساب على «رقم غير صحيح»:
 *  • الأرقام العربية (٠٥٠…) — replace(/\D/) يحذفها كلها فيخرج فارغًا.
 *  • البادئة الدولية 00966 — تُترك كما هي فيصير الرقم 9660966…
 * كلاهما شائع في ملفات المكاتب المستوردة من إكسل.
 */
export function waNumber(phone?: string | null): string {
  const latin = String(phone || "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  let p = latin.replace(/\D/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = p.slice(2);          // 00966… → 966…
  if (p.startsWith("966")) return p;
  if (p.startsWith("0")) return "966" + p.slice(1);
  if (p.length === 9) return "966" + p;
  return p;
}

export function waLink(phone: string | undefined | null, text: string) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}

/**
 * «اليوم» بتوقيت الرياض دائمًا — لا بتوقيت الخادم ولا بتوقيت جهاز المستخدم.
 *
 * الخادم على Vercel يعمل بـUTC، والفارق ثلاث ساعات: بين منتصف الليل والثالثة
 * فجرًا بالرياض يكون الخادم ما زال في «أمس». فوحدة استحقّت الليلة تُحسب غدًا،
 * وملخّص التليجرام (يُرسل 3 فجرًا) يحمل تاريخ اليوم السابق. ومستخدم مسافر
 * خارج المملكة كان يرى حالات مختلفة عن زملائه في المكتب.
 * اليوم التجاري للمكتب هو يوم الرياض — فنثبّته لكل الحسابات.
 */
const RIYADH_FMT = typeof Intl !== "undefined"
  ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" })
  : null;

export const today = () => {
  if (RIYADH_FMT) return RIYADH_FMT.format(new Date());   // en-CA يعطي YYYY-MM-DD
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** بداية اليوم بتوقيت الرياض ككائن Date محلي — أساس كل مقارنات الاستحقاق */
export function riyadhToday(): Date {
  const [y, m, d] = today().split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const WATHEQ_WA = "966596300591";
