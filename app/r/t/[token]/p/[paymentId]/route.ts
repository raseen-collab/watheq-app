import { denyHeaders, portalHeaders, TOKEN_RE, UUID_RE } from "@/lib/hoaPortal";
import { renderTenantReceiptPage, renderTenantDeny, type TenantReceiptData } from "@/lib/tenantPortal";
import { portalDb, newNonce } from "@/lib/hoaPortalServer";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * 🧾 سند قبض دفعة إيجار — /r/t/{token}/p/{paymentId} (schema-v80)
 * الدفعة تُؤخذ بدالة الرابط نفسها (watheq_tenant_receipt): دفعات هذا
 * المستأجر وحده عند هذا المكتب، لا عكس ولا دفعة غيره. المعكوسة تُفتح
 * بختم «معكوس» لا تختفي. الرمز المجهول أو المُبطَل: الرد نفسه.
 */
const deny = (msg?: string, status = 404) => new Response(renderTenantDeny(msg), { status, headers: denyHeaders });

export async function GET(_req: Request, { params }: { params: { token: string; paymentId: string } }) {
  const token = String(params?.token || "");
  const pid = String(params?.paymentId || "").toLowerCase();
  if (!TOKEN_RE.test(token) || !UUID_RE.test(pid)) return deny();
  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_tenant_receipt", { p_token: token, p_payment: pid });
    if (error) throw error;
    if (!data) return deny("السند غير متاح");
    const nonce = newNonce();
    return new Response(renderTenantReceiptPage(data as TenantReceiptData, { nonce, base: `/r/t/${token}` }), { headers: portalHeaders(nonce) });
  } catch (e: any) {
    console.error("tenant receipt failed", e?.message);
    return deny("تعذّر تحميل السند الآن — أعد المحاولة بعد قليل", 503);
  }
}
