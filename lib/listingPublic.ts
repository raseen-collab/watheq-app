// ============================================================
// وثيق — صفحة المعروض العامة للزبون (/l/{token}) — المولّد النقي
//
// المسوّق يرسل للزبون رابطًا بدل خمس صور وفقرة في واتساب: الصفحة تعرض
// الصور والمواصفات والسعر وجوال المسوّق، ولا شيء عن المالك (اسمه، جواله،
// الصك، المصدر، السعي) — فالزبون لا يتجاوز المسوّق إلى المالك.
//
// حين تخرج حالة المعروض من «متاح/محجوز» ترجع الدالة open=false فتُعرض
// صفحة «لم يعد متاحًا» بلا تفاصيل: الرابط القديم في محادثة واتساب لا يبيع
// عقارًا بيع قبل شهر.
//
// دوال نقية بلا شبكة: بيانات → HTML. المسار في app/l/[token]/route.ts.
// ============================================================

import { KIND_META, OFFER_LABEL, type ListingKind, type OfferType } from "@/lib/listings";

export type PublicListing = {
  open: boolean;
  status: string;
  code: string;
  kind: ListingKind;
  offer_type: OfferType;
  title?: string | null;
  district?: string | null;
  city?: string | null;
  price?: number | null;
  area?: number | null;
  rooms?: number | null;
  baths?: number | null;
  floor_no?: number | null;
  building_age?: number | null;
  furnished?: boolean | null;
  street_count?: number | null;
  plan_no?: string | null;
  owner_id: string;
  listing_id: string;
  office: { name?: string | null; phone?: string | null };
};

export const esc = (v: unknown) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const sar = (n: number) => Number(n).toLocaleString("en-US");

/** 05xxxxxxxx أو 9665xxxxxxxx → 9665xxxxxxxx (نفس منطق lib/utils.waNumber بلا استيراد يجرّ المتصفح) */
export function waDigits(phone?: string | null): string {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "966" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) d = "966" + d;
  return d;
}

/** أسطر المواصفات بترتيب الأهمية — الأرض لها حقولها والمبنيّ حقوله */
export function specRows(l: PublicListing): { k: string; v: string }[] {
  const land = (KIND_META[l.kind] || KIND_META.other).land;
  const out: { k: string; v: string }[] = [];
  if (l.area) out.push({ k: "المساحة", v: `${sar(l.area)} م²` });
  if (land) {
    if (l.street_count) out.push({ k: "الشوارع", v: String(l.street_count) });
    if (l.plan_no) out.push({ k: "المخطط", v: String(l.plan_no) });
  } else {
    if (l.rooms) out.push({ k: "الغرف", v: String(l.rooms) });
    if (l.baths) out.push({ k: "دورات المياه", v: String(l.baths) });
    if (l.floor_no != null) out.push({ k: "الدور", v: String(l.floor_no) });
    if (l.building_age != null) out.push({ k: "عمر البناء", v: `${l.building_age} سنة` });
    if (l.furnished) out.push({ k: "التأثيث", v: "مؤثثة" });
  }
  return out;
}

export function headlineOf(l: PublicListing): string {
  const k = KIND_META[l.kind] || KIND_META.other;
  return l.title?.trim() || `${k.label} ${OFFER_LABEL[l.offer_type] || ""}`.trim();
}

export function priceLine(l: PublicListing): string {
  if (!l.price) return "السعر على السوم";
  return `${sar(l.price)} ريال${l.offer_type === "rent" ? " سنويًا" : ""}`;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#F4F1EA;color:#0B211F;font-family:Tahoma,"Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.7;-webkit-text-size-adjust:100%}
.wrap{max-width:640px;margin:0 auto;padding:0 16px 96px}
.top{background:#0E3A37;color:#F6F1E4;padding:14px 16px}
.top .in{max-width:640px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px}
.brand{font-weight:700;font-size:14px;opacity:.9}
.code{font-size:12px;opacity:.7;font-family:monospace}
.gal{margin:14px -16px 0;position:relative}
.gal .track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:6px;padding:0 16px;scrollbar-width:none}
.gal .track::-webkit-scrollbar{display:none}
.gal img{flex:0 0 100%;scroll-snap-align:center;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:14px;background:#E4DDCD}
.gal .n{direction:ltr;position:absolute;bottom:10px;inset-inline-start:26px;background:rgba(11,33,31,.7);color:#fff;font-size:12px;padding:2px 9px;border-radius:99px}
.hint{font-size:12px;color:#5C6B67;text-align:center;margin-top:6px}
.noimg{margin-top:14px;aspect-ratio:4/3;border-radius:14px;background:#E9E3D6;display:grid;place-items:center;font-size:48px}
h1{font-size:20px;margin:16px 0 2px}
.where{color:#5C6B67;font-size:14px}
.price{font-size:26px;font-weight:700;color:#0E3A37;margin:10px 0 2px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;background:#EEF1EF;color:#35514C}
.c-ok{background:#E6F4EC;color:#137A50}.c-warn{background:#FDF0DC;color:#9A5B00}
.card{background:#fff;border:1px solid #E4DDCD;border-radius:14px;padding:14px 16px;margin-top:14px}
.card h2{font-size:14px;margin:0 0 6px;color:#0E3A37}
.row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid #F0EBDF;font-size:14px}
.row:first-of-type{border-top:0}
.row b{font-weight:600}
.muted{color:#5C6B67;font-size:12.5px}
.cta{position:fixed;bottom:0;inset-inline:0;background:rgba(244,241,234,.96);border-top:1px solid #E4DDCD;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
.cta .in{max-width:640px;margin:0 auto;display:flex;gap:8px}
.btn{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none;border:0}
.b-wa{background:#1FA855;color:#fff}.b-call{background:#0E3A37;color:#F6F1E4}
.closed{text-align:center;padding:40px 16px}
.closed .ic{font-size:44px}
.closed h1{font-size:18px}
.foot{margin-top:18px;text-align:center;font-size:11.5px;color:#5C6B67}
.foot a{color:#9A5B00;text-decoration:none;font-weight:700}
`;

function frame(title: string, body: string, nonce: string, script = ""): string {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}
${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

/** صفحة المعروض المتاح: صور، سعر، مواصفات، وزرّا واتساب واتصال بالمسوّق */
export function renderListingPage(l: PublicListing, photos: string[], opts: { nonce: string }): string {
  const k = KIND_META[l.kind] || KIND_META.other;
  const where = [l.district, l.city].filter(Boolean).map(esc).join(" · ");
  const office = l.office?.name ? esc(l.office.name) : "المسوّق";
  const digits = waDigits(l.office?.phone);
  const waText = encodeURIComponent(`السلام عليكم، أسأل عن ${headlineOf(l)}${l.district ? ` في ${l.district}` : ""} (${l.code})`);
  const rows = specRows(l);

  const gallery = photos.length
    ? `<div class="gal"><div class="track" id="trk">${photos.map((u, i) => `<img src="${esc(u)}" alt="صورة ${i + 1}" loading="${i ? "lazy" : "eager"}">`).join("")}</div>
       ${photos.length > 1 ? `<span class="n" id="cnt">1 / ${photos.length}</span>` : ""}</div>
       ${photos.length > 1 ? `<div class="hint">اسحب لرؤية بقية الصور</div>` : ""}`
    : `<div class="noimg" aria-hidden="true">${k.icon}</div>`;

  const body = `
<header class="top"><div class="in"><span class="brand">${office}</span><span class="code">${esc(l.code)}</span></div></header>
<main class="wrap">
  ${gallery}
  <h1>${esc(headlineOf(l))}</h1>
  ${where ? `<div class="where">📍 ${where}</div>` : ""}
  <div class="price">${esc(priceLine(l))}</div>
  <div class="chips">
    <span class="chip">${esc(k.label)} ${esc(OFFER_LABEL[l.offer_type] || "")}</span>
    <span class="chip ${l.status === "reserved" ? "c-warn" : "c-ok"}">${l.status === "reserved" ? "محجوز بعربون" : "متاح"}</span>
  </div>
  ${rows.length ? `<section class="card"><h2>المواصفات</h2>${rows.map((r) => `<div class="row"><span>${esc(r.k)}</span><b>${esc(r.v)}</b></div>`).join("")}</section>` : ""}
  <section class="card"><h2>للمعاينة والاستفسار</h2>
    <div class="muted">${office}${l.office?.phone ? ` · <bdi dir="ltr">${esc(l.office.phone)}</bdi>` : ""}</div>
    <div class="muted" style="margin-top:4px">تواصل مع المسوّق مباشرة — الصفحة تُحدَّث بحالة العقار تلقائيًّا.</div>
  </section>
  <div class="foot">صفحة أُنشئت عبر <a href="https://watheqapp.com/marketer" rel="noreferrer">وثيق</a> · لا تُجمع أي بيانات من زائر الصفحة</div>
</main>
${digits ? `<div class="cta"><div class="in">
  <a class="btn b-wa" href="https://wa.me/${digits}?text=${waText}" rel="noreferrer">واتساب</a>
  <a class="btn b-call" href="tel:+${digits}">اتصال</a>
</div></div>` : ""}`;

  const script = photos.length > 1 ? `
(function(){var t=document.getElementById('trk'),c=document.getElementById('cnt');if(!t||!c)return;
t.addEventListener('scroll',function(){var w=t.clientWidth||1;var i=Math.round(t.scrollLeft<0?-t.scrollLeft/w:t.scrollLeft/w);c.textContent=(i+1)+' / ${photos.length}';},{passive:true});})();` : "";

  return frame(`${headlineOf(l)} — ${l.office?.name || "وثيق"}`, body, opts.nonce, script);
}

/** المعروض خرج من العرض (متعاقد/مسحوب): لا تفاصيل، وزرّ واتساب للمسوّق إن أراد الزبون بديلًا */
export function renderClosedPage(l: PublicListing, opts: { nonce: string }): string {
  const office = l.office?.name ? esc(l.office.name) : "المسوّق";
  const digits = waDigits(l.office?.phone);
  const body = `
<header class="top"><div class="in"><span class="brand">${office}</span><span class="code">${esc(l.code)}</span></div></header>
<main class="wrap"><div class="closed"><div class="ic">🏷️</div>
  <h1>هذا العقار لم يعد متاحًا</h1>
  <p class="muted">${l.status === "contracted" ? "تمّ التعاقد عليه." : "سُحب من العرض."} تواصل مع المسوّق لمعروضات مشابهة.</p>
</div></main>
${digits ? `<div class="cta"><div class="in"><a class="btn b-wa" href="https://wa.me/${digits}?text=${encodeURIComponent(`السلام عليكم، العقار (${l.code}) لم يعد متاحًا — هل عندكم بديل مشابه؟`)}" rel="noreferrer">اسأل عن بديل — واتساب</a></div></div>` : ""}`;
  return frame("العقار لم يعد متاحًا — وثيق", body, opts.nonce);
}

export function renderListingDeny(msg = "هذا الرابط غير متاح"): string {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>وثيق</title></head>
<body style="margin:0;font-family:Tahoma,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;background:#F4F1EA;color:#0B211F">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:2rem">🔒</div>
<h1 style="font-size:1.1rem">${esc(msg)}</h1>
<p style="font-size:.9rem;color:#5C6B67">قد يكون الرابط قديمًا أو أُلغي. اطلب من المسوّق رابطًا جديدًا.</p></div></body></html>`;
}

export const LISTING_TOKEN_RE = /^[0-9a-f]{48}$/;
