import { renderPortalPage, renderDeny, portalHeaders, denyHeaders, TOKEN_RE, FLASH_CODES, type PortalData } from "@/lib/hoaPortal";
import { portalDb, newNonce } from "@/lib/hoaPortalServer";

export const dynamic = "force-dynamic";

/**
 * 🏢 بوابة المالك في اتحاد الملاك — /r/o/{token}
 * رابط خاص لكل مالك يُرسل عبر واتساب، بلا حساب. يرى فيه: حالة اشتراكه،
 * دفعاته وسنداتها، ومستندات جمعيته وما ينتظر ردّه.
 * الرمز المجهول والمُبطَل يأخذان الرد نفسه (القاعدة ترجع null لكليهما).
 */
const deny = (msg?: string, status = 404) => new Response(renderDeny(msg), { status, headers: denyHeaders });

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!TOKEN_RE.test(token)) return deny();
  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_hoa_portal", { p_token: token });
    if (error) throw error;
    if (!data) return deny();
    const m = new URL(req.url).searchParams.get("m");
    const nonce = newNonce();
    const html = renderPortalPage(data as PortalData, { nonce, base: `/r/o/${token}`, flash: m && FLASH_CODES.has(m) ? m : null });
    return new Response(html, { headers: portalHeaders(nonce) });
  } catch (e: any) {
    console.error("hoa portal failed", e?.message);
    return deny("تعذّر تحميل الصفحة الآن — أعد فتح الرابط بعد قليل", 503);
  }
}
