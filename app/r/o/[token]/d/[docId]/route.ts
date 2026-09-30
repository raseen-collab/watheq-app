import { renderDocPage, renderDeny, portalHeaders, denyHeaders, TOKEN_RE, UUID_RE, FLASH_CODES, type PortalDocData } from "@/lib/hoaPortal";
import { portalDb, newNonce, clientIp, userAgent } from "@/lib/hoaPortalServer";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * مستند الجمعية كما يراه المالك — /r/o/{token}/d/{docId}
 * الفتح يسجّل «اطّلع» مرة واحدة. لا يظهر هنا إلا سجلّ هذا المالك مع المستند
 * — قرارات بقية الملاك لا تُعرض إطلاقًا (خصوصية/نظام حماية البيانات).
 * نص المستند يُنظَّف مرة ثانية عند العرض (sanitizeHoaHtml داخل renderDocPage).
 */
const deny = (msg?: string, status = 404) => new Response(renderDeny(msg), { status, headers: denyHeaders });

export async function GET(req: Request, { params }: { params: { token: string; docId: string } }) {
  const token = String(params?.token || "");
  const docId = String(params?.docId || "");
  if (!TOKEN_RE.test(token) || !UUID_RE.test(docId)) return deny();
  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_hoa_portal_doc", {
      p_token: token, p_doc: docId, p_ip: clientIp(req), p_ua: userAgent(req),
    });
    if (error) throw error;
    if (!data) return deny();
    if ((data as any).status !== "ok") return deny("هذا المستند غير متاح — ربما أُلغي");
    const m = new URL(req.url).searchParams.get("m");
    const nonce = newNonce();
    const html = renderDocPage(data as PortalDocData, { nonce, base: `/r/o/${token}`, flash: m && FLASH_CODES.has(m) ? m : null });
    return new Response(html, { headers: portalHeaders(nonce) });
  } catch (e: any) {
    console.error("hoa portal doc failed", e?.message);
    return deny("تعذّر تحميل المستند الآن — أعد المحاولة بعد قليل", 503);
  }
}
