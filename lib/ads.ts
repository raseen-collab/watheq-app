// ============================================================
// وثيق — مولّد الإعلانات من سجل المعروضات
//
// المبدأ: بيانات المعروض مكتوبة مرة واحدة في السجل، فلا يُعاد
// كتابتها لكل منصة. الدوال هنا نقية: معروض + بيانات المكتب → نص،
// بلا شبكة ولا حالة — تصلح للوحة ولأي استخدام لاحق (بوت، جدولة).
//
// الالتزام النظامي أولًا: نظام الوساطة العقارية يوجب إبراز رقم
// ترخيص الإعلان ورقم رخصة فال في كل إعلان. لذلك ليسا «تحسينًا»
// هنا بل جزءًا من النص، ودالة adReady ترفض التوليد بدونهما —
// إعلان بلا ترخيص مخالفة تقع على المكتب لا علينا، لكنّ أداة
// تسهّلها شريكة فيها.
// ============================================================

import {
  KIND_META, OFFER_LABEL, pricePerMeter, type Listing,
} from "@/lib/listings";
import { waNumber } from "@/lib/utils";

export type AdOffice = {
  org_name?: string | null;
  billing_phone?: string | null;
  fal_license?: string | null;   // رقم رخصة فال
  ad_license?: string | null;    // رقم ترخيص هذا الإعلان تحديدًا
};

const sar = (n: number) => n.toLocaleString("en-US");

/** «شقة» «أرض»… + للبيع/للإيجار */
function headline(l: Listing): string {
  const k = KIND_META[l.kind] || KIND_META.other;
  const where = [l.district, l.city].filter(Boolean).join(" · ");
  return `${k.label} ${OFFER_LABEL[l.offer_type]}${where ? ` — ${where}` : ""}`;
}

/** سطور الوصف المشتركة بين المنصات، مرتّبة من الأهم */
function factLines(l: Listing): string[] {
  const out: string[] = [];
  const land = (KIND_META[l.kind] || KIND_META.other).land;

  if (l.area) out.push(`المساحة: ${sar(l.area)} م²`);
  if (land) {
    if (l.street_count) out.push(`الشوارع: ${l.street_count}`);
    if (l.plan_no) out.push(`المخطط: ${l.plan_no}`);
    if (l.parcel_no) out.push(`القطعة: ${l.parcel_no}`);
  } else {
    if (l.rooms) out.push(`الغرف: ${l.rooms}`);
    if (l.baths) out.push(`دورات المياه: ${l.baths}`);
    if (l.floor_no != null) out.push(`الدور: ${l.floor_no}`);
    if (l.building_age != null) out.push(`عمر البناء: ${l.building_age} سنة`);
    if (l.furnished) out.push("مؤثثة");
  }

  if (l.price) {
    const per = pricePerMeter(l);
    const rent = l.offer_type === "rent" ? " سنويًا" : "";
    out.push(`السعر: ${sar(l.price)} ريال${rent}${per && land ? ` (${sar(per)} ريال/م²)` : ""}`);
  } else {
    out.push("السعر: على السوم");
  }
  return out;
}

/** سطر الالتزام النظامي — يظهر في كل المنصات بلا استثناء */
function licenseLine(o: AdOffice): string {
  return `ترخيص الإعلان: ${o.ad_license} · رخصة فال: ${o.fal_license}`;
}

/** لا إعلان بلا ترخيصَيه — القرار هنا لا في الواجهة حتى لا يُلتفّ عليه */
export function adReady(o: AdOffice): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!o.ad_license?.trim()) missing.push("رقم ترخيص الإعلان (من منصة الهيئة)");
  if (!o.fal_license?.trim()) missing.push("رقم رخصة فال");
  return { ok: missing.length === 0, missing };
}

/**
 * حراج: عنوان ≤ 50 حرفًا تقريبًا يلتقطه البحث، ثم نص كامل.
 * الكود الداخلي يُذكر ليعرف المكتب أي معروض حين يتصل المشتري
 * «أتصل على إعلان أ-101» — فيُفتح من السجل مباشرة.
 */
export function harajAd(l: Listing, o: AdOffice): { title: string; body: string } {
  const title = `${headline(l)}${l.area ? ` ${sar(l.area)}م` : ""}`;
  const lines = [
    headline(l),
    "",
    ...factLines(l),
    "",
    `للتواصل: ${o.billing_phone || "—"}${o.org_name ? ` — ${o.org_name}` : ""}`,
    `الرقم المرجعي: ${l.code}`,
    licenseLine(o),
  ];
  return { title, body: lines.join("\n") };
}

/** X: سقف 280 حرفًا — نحسبه فعلًا ونحذف الأقل أهمية حتى يدخل */
export function xAd(l: Listing, o: AdOffice): string {
  const req = [
    `للتواصل: ${o.billing_phone || "—"}`,
    licenseLine(o),
  ];
  let facts = factLines(l);
  const build = (f: string[]) => [headline(l), "", ...f, "", ...req].join("\n");
  let text = build(facts);
  while (text.length > 280 && facts.length > 1) {
    facts = facts.slice(0, -1);
    // السعر لا يُحذف أبدًا — إعلان بلا سعر يجلب أسئلة لا مشترين
    if (!facts.some((x) => x.startsWith("السعر"))) {
      const priceLine = factLines(l).find((x) => x.startsWith("السعر"))!;
      facts = [...facts.slice(0, -1), priceLine];
    }
    text = build(facts);
  }
  return text;
}

/** واتساب: للنشر في القروبات أو الإرسال لطالب مطابق — أغنى نصًا */
export function whatsappAd(l: Listing, o: AdOffice): string {
  return [
    `*${headline(l)}*`,
    "",
    ...factLines(l).map((f) => `• ${f}`),
    ...(l.note ? ["", l.note] : []),
    "",
    `للتواصل: ${o.billing_phone || "—"}${o.org_name ? ` — ${o.org_name}` : ""}`,
    `الرقم المرجعي: ${l.code}`,
    licenseLine(o),
  ].join("\n");
}

/** روابط النشر المباشر */
export const xIntentUrl = (text: string) =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;

export const waShareUrl = (text: string, phone?: string | null) =>
  phone
    ? `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
