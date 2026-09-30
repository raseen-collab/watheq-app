import { renderReceiptPage, renderDeny, portalHeaders, denyHeaders, TOKEN_RE, UUID_RE, type PortalData } from "@/lib/hoaPortal";
import { portalDb, newNonce } from "@/lib/hoaPortalServer";

export const dynamic = "force-dynamic";

/**
 * سند قبض قابل للطباعة — /r/o/{token}/p/{paymentId}
 * الدفعة تُؤخذ من قائمة دفعات هذا المالك نفسها (watheq_hoa_portal)، فلا
 * يُفتح سند مالك آخر ولا دفعة معكوسة.
 */
const deny = (msg?: string, status = 404) => new Response(renderDeny(msg), { status, headers: denyHeaders });

export async function GET(_req: Request, { params }: { params: { token: string; paymentId: string } }) {
  const token = String(params?.token || "");
  const pid = String(params?.paymentId || "").toLowerCase();
  if (!TOKEN_RE.test(token) || !UUID_RE.test(pid)) return deny();
  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_hoa_portal", { p_token: token });
    if (error) throw error;
    if (!data) return deny();
    const d = data as PortalData;
    const p = (d.payments || []).find((x) => String(x.id).toLowerCase() === pid);
    if (!p) return deny("السند غير متاح");
    const nonce = newNonce();
    return new Response(renderReceiptPage(d, p, { nonce, base: `/r/o/${token}` }), { headers: portalHeaders(nonce) });
  } catch (e: any) {
    console.error("hoa receipt failed", e?.message);
    return deny("تعذّر تحميل السند الآن — أعد المحاولة بعد قليل", 503);
  }
}
