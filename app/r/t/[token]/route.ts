import { portalHeaders, denyHeaders, TOKEN_RE } from "@/lib/hoaPortal";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET } from "@/lib/maintenance";
import { renderTenantPage, renderTenantDeny, TENANT_FLASH_CODES, type TenantPortalData, type TenantReqPhotos } from "@/lib/tenantPortal";
import { portalDb, newNonce } from "@/lib/hoaPortalServer";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * 🔑 صفحة المستأجر الخاصة — /r/t/{token} (schema-v70)
 * رابط لكل وحدة يُرسل واتساب، بلا حساب. يرى فيه المستأجر عقده ودفعاته
 * والمستحق عليه (إن لم يخفه المكتب)، ويبلّغ عن حوالته أو عطل.
 * الرمز المجهول والمُبطَل وما بعد الإخلاء أو تغيّر المستأجر: الرد نفسه.
 */
const deny = (msg?: string, status = 404) => new Response(renderTenantDeny(msg), { status, headers: denyHeaders });

/* v79: صور الصيانة من مضيف Supabase — يُسمح به وحده في img-src (كصفحة المعروض /l) */
function pageHeaders(nonce: string): Record<string, string> {
  const h = portalHeaders(nonce);
  let host = "";
  try { host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").origin; } catch { /* بلا صور */ }
  if (host) h["content-security-policy"] = h["content-security-policy"].replace("img-src data:", `img-src data: ${host}`);
  return h;
}

/**
 * صور قبل/بعد لطلبات هذا المستأجر (حتى 10 طلبات · 6 صور لكل جهة).
 * الطلبات جاءت من دالة الرابط بعد التحقق من الرمز، فلا يرى إلا طلباته.
 * أي فشل (قبل v79 أو تخزين) = صفحة بلا صور، لا صفحة مكسورة.
 */
async function loadPhotos(db: SupabaseClient, reqIds: string[]): Promise<TenantReqPhotos> {
  const out: TenantReqPhotos = {};
  if (!reqIds.length) return out;
  try {
    const { data: rows } = await db.from("tenant_requests").select("id,user_id").in("id", reqIds.slice(0, 10));
    const bucket = db.storage.from(PHOTO_BUCKET);
    await Promise.all((rows || []).map(async (r: any) => {
      const dir = `${r.user_id}/${r.id}`;
      const { data: files } = await bucket.list(dir, { limit: 30, sortBy: { column: "created_at", order: "asc" } });
      const names = (files || []).map((f) => f.name).filter((n) => /^(before|after)-/.test(n));
      const pick = (side: string) => names.filter((n) => n.startsWith(side + "-")).slice(0, 6);
      const want = [...pick("before"), ...pick("after")];
      if (!want.length) return;
      const { data: signed } = await bucket.createSignedUrls(want.map((n) => `${dir}/${n}`), 3600);
      const urls = (signed || []).map((x) => x.signedUrl || "");
      const p = { before: [] as string[], after: [] as string[] };
      want.forEach((n, i) => { if (urls[i]) (n.startsWith("after-") ? p.after : p.before).push(urls[i]); });
      out[r.id] = p;
    }));
  } catch { /* بلا صور */ }
  return out;
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!TOKEN_RE.test(token)) return deny();
  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_tenant_portal", { p_token: token });
    if (error) throw error;
    if (!data) return deny();
    const m = new URL(req.url).searchParams.get("m");
    const nonce = newNonce();
    const d = data as TenantPortalData;
    const photos = await loadPhotos(db, (d.requests || []).map((x) => x.id));
    const html = renderTenantPage(d, { nonce, base: `/r/t/${token}`, flash: m && TENANT_FLASH_CODES.has(m) ? m : null, photos });
    return new Response(html, { headers: pageHeaders(nonce) });
  } catch (e: any) {
    console.error("tenant portal failed", e?.message);
    return deny("تعذّر تحميل الصفحة الآن — أعد فتح الرابط بعد قليل", 503);
  }
}
