/**
 * وثيق — التاريخ الهجري (أم القرى)
 *
 * المكاتب السعودية تكتب عقودها بالهجري، والنظام يحسب بالميلادي. الحل:
 * التخزين ميلادي دائمًا (كل الحسابات تعتمد عليه)، والعرض والإدخال يقبلان
 * الهجري ويحوّلانه — فلا يتغيّر شيء في منطق العقود ويكسب المكتب لغته.
 *
 * التحويل عبر Intl بتقويم «islamic-umalqura» المعتمد رسميًّا في المملكة،
 * بلا أي مكتبة خارجية. والاتجاه العكسي (هجري → ميلادي) ببحث ثنائي على
 * التواريخ الميلادية باستخدام المحوّل نفسه — فالنتيجة متسقة في الاتجاهين.
 */

const HIJRI_MONTHS = [
  "محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
  "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة",
];

const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
  year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC",
});

/** ميلادي (YYYY-MM-DD) → {y,m,d} هجري */
export function toHijri(iso: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const dt = new Date(`${iso}T12:00:00Z`);
  if (isNaN(dt.getTime())) return null;
  const parts = fmt.formatToParts(dt);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get("year"), m = get("month"), d = get("day");
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/** «١٥ رمضان ١٤٤٧هـ» للعرض في المستندات */
export function hijriText(iso: string): string {
  const h = toHijri(iso);
  if (!h) return "";
  return `${h.d} ${HIJRI_MONTHS[h.m - 1]} ${h.y}هـ`;
}

/** «1447-03-15هـ» — صيغة مختصرة للجداول الضيقة */
export function hijriShort(iso: string): string {
  const h = toHijri(iso);
  if (!h) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h.y}-${p(h.m)}-${p(h.d)}هـ`;
}

const dayMs = 86400000;
const isoOf = (dt: Date) => dt.toISOString().slice(0, 10);

/**
 * هجري → ميلادي (YYYY-MM-DD). بحث ثنائي على مدى ±60 يومًا حول تقدير أوّلي
 * (السنة الهجرية ≈ 354.367 يومًا)، ثم مسح دقيق. يرجع "" إن كان التاريخ
 * غير موجود في التقويم (مثل 30 من شهر عدّته 29 يومًا).
 */
export function fromHijri(hy: number, hm: number, hd: number): string {
  if (!(hy >= 1300 && hy <= 1600) || hm < 1 || hm > 12 || hd < 1 || hd > 30) return "";
  // 1 محرم 1300 ≈ 1882-11-12 ميلادي — نقطة انطلاق التقدير
  const approx = Date.UTC(1882, 10, 12) + ((hy - 1300) * 354.367 + (hm - 1) * 29.53 + (hd - 1)) * dayMs;
  for (let off = -60; off <= 60; off++) {
    const dt = new Date(approx + off * dayMs);
    const h = toHijri(isoOf(dt));
    if (h && h.y === hy && h.m === hm && h.d === hd) return isoOf(dt);
  }
  return "";
}

/**
 * هل النص تاريخ هجري؟ السنة بين 1300 و1600 تحسمها — لا تلتبس بميلادي
 * (1900+) ولا برقم آخر. يقبل: 1447-03-15 · 15/03/1447 · 15-3-1447هـ
 */
export function parseHijriInput(v: string): string {
  const s = String(v || "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/هـ|هجري|h/gi, "").trim();
  if (!s) return "";
  let m = /^(\d{3,4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);          // سنة-شهر-يوم
  if (m && Number(m[1]) >= 1300 && Number(m[1]) <= 1600) {
    return fromHijri(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{3,4})$/.exec(s);              // يوم-شهر-سنة
  if (m && Number(m[3]) >= 1300 && Number(m[3]) <= 1600) {
    return fromHijri(Number(m[3]), Number(m[2]), Number(m[1]));
  }
  return "";
}
