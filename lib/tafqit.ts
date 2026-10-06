/**
 * التفقيط: المبلغ بالحروف لسند الصرف (6 أكتوبر 2026).
 *
 * «فقط خمسة آلاف وثلاثمائة وخمسون ريال سعودي لا غير» — السطر الذي
 * يمنع تعديل الرقم يدويًا في السند الورقي بعد توقيعه، وهو ما يُطلب عادةً
 * في سندات الصرف. يغطي حتى 999,999,999.99.
 */

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

/** 0..999 بالحروف */
function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 10) parts.push(ONES[r]);
    else if (r < 20) parts.push(TEENS[r - 10]);
    else {
      const o = r % 10, t = Math.floor(r / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(" و");
}

/** مجموعة الآلاف أو الملايين: «ألف · ألفان · ثلاثة آلاف · أحد عشر ألفًا» */
function group(n: number, one: string, two: string, plural: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${below1000(n)} ${plural}`;
  return `${below1000(n)} ${one}`;
}

/** عدد صحيح موجب بالحروف */
export function intToArabicWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "صفر";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(group(millions, "مليون", "مليونان", "ملايين"));
  if (thousands) parts.push(group(thousands, "ألف", "ألفان", "آلاف"));
  if (rest) parts.push(below1000(rest));
  return parts.join(" و");
}

/** «فقط ألف ومائتان وخمسون ريال سعودي وخمسون هللة لا غير» */
export function riyalsInWords(amount: number): string {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100);
  const riyals = Math.floor(v / 100), halalas = v % 100;
  const r = riyals ? `${intToArabicWords(riyals)} ريال سعودي` : "";
  const h = halalas ? `${intToArabicWords(halalas)} هللة` : "";
  const body = [r, h].filter(Boolean).join(" و") || "صفر ريال";
  return `فقط ${body} لا غير`;
}
