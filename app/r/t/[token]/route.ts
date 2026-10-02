import { portalHeaders, denyHeaders, TOKEN_RE } from "@/lib/hoaPortal";
import { renderTenantPage, renderTenantDeny, TENANT_FLASH_CODES, type TenantPortalData } from "@/lib/tenantPortal";
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
    const html = renderTenantPage(data as TenantPortalData, { nonce, base: `/r/t/${token}`, flash: m && TENANT_FLASH_CODES.has(m) ? m : null });
    return new Response(html, { headers: portalHeaders(nonce) });
  } catch (e: any) {
    console.error("tenant portal failed", e?.message);
    return deny("تعذّر تحميل الصفحة الآن — أعد فتح الرابط بعد قليل", 503);
  }
}
