/* ============================================================
 * وثيق — الفاتورة الإلكترونية، المرحلة الأولى (الإصدار) — 22 نوفمبر 2026
 *
 * المراجع (هيئة الزكاة والضريبة والجمارك):
 *  • الدليل التفصيلي للفوترة الإلكترونية: §5.1 رمز QR للمبسطة، §5.6 الوظائف المحظورة،
 *    §4.3 الإشعارات الدائنة والمدينة (مرجع الفاتورة + السبب)، §5.7 العربية.
 *  • ملحق قرار الضوابط: حقول الفاتورة الضريبية المبسطة — العنوان، رقم الفاتورة،
 *    تاريخ ووقت الإصدار، اسم البائع وعنوانه ورقمه الضريبي، البيان والكمية والسعر،
 *    الإجمالي قبل الضريبة وشاملها ومبلغ الضريبة. ورمز QR بخمس خانات (TLV):
 *    اسم البائع، الرقم الضريبي، الطابع الزمني، الإجمالي شامل الضريبة، مبلغ الضريبة.
 *  • دليل الوكلاء §5.1 وس١: الوكيل المعلَن (يؤجّر باسم المالك) — الفاتورة باسم
 *    المالك ورقمه الضريبي. §11.1.1: إصدارها من طرف ثالث يتطلب موافقة الهيئة،
 *    وأن تذكر أنها «صادرة نيابة عن المورّد» دون بيانات الطرف الثالث.
 * ============================================================ */

/** الرقم الضريبي السعودي: ١٥ رقمًا يبدأ بـ3 وينتهي بـ3 */
export function cleanVatNo(v?: string | null): string {
  return String(v || "").replace(/[\s-]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
export function isValidVatNo(v?: string | null): boolean {
  return /^3\d{13}3$/.test(cleanVatNo(v));
}

export type SellerMode = "office" | "owner";
export type Seller = { mode: SellerMode; name: string; vat: string | null; cr: string | null; address: string | null };

type IssuerLike = { billing_name?: string | null; org_name?: string | null; vat_number?: string | null; cr_number?: string | null; billing_address?: string | null };
type PropLike = { manager?: string | null; rent_seller?: string | null; owner_name?: string | null; owner_vat_number?: string | null; owner_address?: string | null; address?: string | null; city?: string | null };
export type InvoiceSnap = { seller_mode?: string | null; seller_name?: string | null; seller_vat?: string | null; seller_cr?: string | null; seller_address?: string | null };

const t = (v?: string | null) => String(v || "").trim() || null;

/**
 * البائع كما يُطبع: لقطة الفاتورة إن وُجدت (كل فاتورة بعد schema-v95)،
 * وإلا للفواتير الأقدم: بيانات المكتب الحالية كما كانت تُطبع دائمًا.
 */
export function sellerOf(snap: InvoiceSnap | null | undefined, issuer: IssuerLike | null | undefined, p?: PropLike | null): Seller {
  if (snap && (snap.seller_mode === "office" || snap.seller_mode === "owner")) {
    return { mode: snap.seller_mode, name: t(snap.seller_name) || (snap.seller_mode === "owner" ? "المالك" : "إدارة الأملاك"),
             vat: t(snap.seller_vat), cr: t(snap.seller_cr), address: t(snap.seller_address) };
  }
  return { mode: "office", name: t(issuer?.billing_name) || t(issuer?.org_name) || t(p?.manager) || "إدارة الأملاك",
           vat: t(issuer?.vat_number), cr: t(issuer?.cr_number), address: t(issuer?.billing_address) };
}

/** البائع المتوقَّع لفاتورة ستصدر الآن (معاينة قبل الإصدار — نفس منطق القاعدة) */
export function sellerForNew(issuer: IssuerLike | null | undefined, p: PropLike | null | undefined): Seller {
  if (p?.rent_seller === "owner") {
    return { mode: "owner", name: t(p.owner_name) || "المالك", vat: t(p.owner_vat_number), cr: null,
             address: t(p.owner_address) || t([p.address, p.city].filter((x) => t(x)).join("، ")) };
  }
  return sellerOf(null, issuer, p);
}

/**
 * ما ينقص لتكون الفاتورة ضريبية مبسطة صحيحة. فارغ = مكتملة.
 * لا يُطلب شيء حين تكون الضريبة غير مفعّلة (إيجار سكني معفى).
 */
export function taxInvoiceGaps(s: Seller, vatEnabled: boolean): string[] {
  if (!vatEnabled) return [];
  const g: string[] = [];
  const who = s.mode === "owner" ? "للمالك" : "للمكتب";
  if (!t(s.vat)) g.push(`الرقم الضريبي ${who}`);
  else if (!isValidVatNo(s.vat)) g.push(`الرقم الضريبي ${who} غير صحيح (١٥ رقمًا يبدأ وينتهي بـ3)`);
  if (!t(s.address)) g.push(`العنوان ${who}`);
  if (s.mode === "owner" && (!t(s.name) || s.name === "المالك")) g.push("اسم المالك في بيانات العقار");
  return g;
}

/** فاتورة ضريبية؟ — ضريبة مفعّلة ورقم ضريبي صحيح للبائع */
export const isTaxInvoice = (s: Seller, vatEnabled: boolean) => vatEnabled && isValidVatNo(s.vat);

/* ── رمز QR: TLV بخمس خانات ثم Base64 ───────────────────── */

/** يُقصّ الاسم على 255 بايت عند حدّ حرف كامل (طول الحقل بايت واحد) */
export function qrName(name: string): string {
  const enc = new TextEncoder();
  let n = name;
  while (enc.encode(n).length > 255) n = Array.from(n).slice(0, -1).join("");
  return n;
}

export function zatcaTlvBase64(sellerName: string, vatNo: string, isoDateTime: string, total: number, vat: number): string {
  const enc = new TextEncoder();
  const fields = [qrName(sellerName), vatNo, isoDateTime, total.toFixed(2), vat.toFixed(2)];
  const parts: number[] = [];
  fields.forEach((val, i) => {
    const b = Array.from(enc.encode(val));
    parts.push(i + 1, b.length, ...b);
  });
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < parts.length; i += 3) {
    const a = parts[i], b = parts[i + 1], c = parts[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
        + (b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)])
        + (c === undefined ? "=" : B64[c & 63]);
  }
  return out;
}

/** فكّ TLV — للاختبارات وللتحقق: يعيد الخانات الخمس بالترتيب */
export function decodeZatcaTlv(b64: string): string[] {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("base64");
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 255); }
  }
  const out: string[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < bytes.length;) {
    const tag = bytes[i], len = bytes[i + 1];
    out[tag - 1] = dec.decode(new Uint8Array(bytes.slice(i + 2, i + 2 + len)));
    i += 2 + len;
  }
  return out;
}

/** الطابع الزمني كما في أمثلة الهيئة: ISO بالتوقيت العالمي بلا أجزاء الثانية */
export const qrTimestamp = (at?: string | null): string => {
  const d = at && !isNaN(Date.parse(at)) ? new Date(at) : new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
};
