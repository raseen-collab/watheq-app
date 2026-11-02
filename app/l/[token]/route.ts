import { portalDb, newNonce } from "@/lib/hoaPortalServer";
import {
  renderListingPage, renderClosedPage, renderListingDeny, LISTING_TOKEN_RE, type PublicListing,
} from "@/lib/listingPublic";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * 🏷️ صفحة المعروض للزبون — /l/{token} (2 نوفمبر 2026)
 * رابط عام يرسله المسوّق للزبون: صور ومواصفات وسعر وجوال المسوّق — بلا أي
 * بيان عن المالك. الرمز 48 خانة hex من listing_links (schema-v78)، يُبطَل
 * بضغطة، وحين تخرج الحالة من «متاح/محجوز» تُعرض صفحة «لم يعد متاحًا».
 *
 * الأمان كبوابة المالك (/r/o): مفتاح الخدمة لا يستدعي إلا دالة تتحقق من
 * الرمز داخل القاعدة وترجع الحقول العامة وحدها؛ الصور روابط موقّتة ساعة.
 * الرمز المجهول والمُبطَل يأخذان الرد نفسه.
 */
const BUCKET = "listing-photos";
const MAX_PHOTOS = 12;

const denyHeaders: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store",
};
const deny = (msg?: string, status = 404) => new Response(renderListingDeny(msg), { status, headers: denyHeaders });

/* الصور تأتي من مضيف Supabase فيُسمح به وحده في img-src */
function pageHeaders(nonce: string): Record<string, string> {
  let imgHost = "";
  try { imgHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").origin; } catch { /* بلا صور */ }
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:${imgHost ? ` ${imgHost}` : ""}; base-uri 'none'; frame-ancestors 'none'`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
    "cache-control": "no-store",
  };
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!LISTING_TOKEN_RE.test(token)) return deny();
  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_listing_public", { p_token: token });
    if (error) throw error;
    if (!data) return deny();
    const l = data as PublicListing;
    const nonce = newNonce();

    // المشاهدة تُعدّ قبل الرسم ولا تمنعه إن فشلت
    db.rpc("watheq_listing_link_seen", { p_token: token }).then(() => {}, () => {});

    if (!l.open) return new Response(renderClosedPage(l, { nonce }), { headers: pageHeaders(nonce) });

    // الصور: نفس مسار ListingPhotos ({user_id}/{listing_id}/…) بروابط موقّتة ساعة
    let photos: string[] = [];
    try {
      const dir = `${l.owner_id}/${l.listing_id}`;
      const { data: files } = await db.storage.from(BUCKET).list(dir, { limit: MAX_PHOTOS, sortBy: { column: "created_at", order: "asc" } });
      const paths = (files || []).filter((f) => f.name).map((f) => `${dir}/${f.name}`);
      if (paths.length) {
        const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
        photos = (signed || []).map((s) => s.signedUrl).filter(Boolean) as string[];
      }
    } catch (e: any) { console.error("listing photos failed", e?.message); }

    return new Response(renderListingPage(l, photos, { nonce }), { headers: pageHeaders(nonce) });
  } catch (e: any) {
    console.error("listing public page failed", e?.message);
    return deny("تعذّر تحميل الصفحة الآن — أعد فتح الرابط بعد قليل", 503);
  }
}
