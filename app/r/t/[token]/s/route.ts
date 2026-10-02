import { denyHeaders, TOKEN_RE } from "@/lib/hoaPortal";
import { renderTenantDeny, type TenantPortalData } from "@/lib/tenantPortal";
import { portalDb } from "@/lib/hoaPortalServer";
import { statementHTML } from "@/lib/documents";
import { issuerMarks } from "@/lib/subscription";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * كشف حساب المستأجر من صفحته — /r/t/{token}/s
 * المستند نفسه الذي يصدره المكتب من اللوحة («كشف حساب مختصر») بالدفعات نفسها
 * (المدة الحالية)، لكن بلا هوية ولا جوال. لا يُفتح إن أخفى المكتب الرصيد.
 * ترويسة CSP: لا سكربت إلا ما يحمل nonce المستند نفسه (زرّ الطباعة).
 */
const deny = (msg?: string, status = 404) => new Response(renderTenantDeny(msg), { status, headers: denyHeaders });
const DOC_CSP_RE = /^<!DOCTYPE html><html[^>]*><head><meta charset="UTF-8">\s*<meta http-equiv="Content-Security-Policy" content="([^"<>]+)">/;
const secHeaders = (html: string): Record<string, string> => {
  const m = DOC_CSP_RE.exec(html);
  const csp = m && /script-src 'nonce-[0-9a-z]+'/.test(m[1]) ? m[1]
    : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'";
  return { "content-security-policy": `${csp}; frame-ancestors 'none'`, "x-content-type-options": "nosniff" };
};

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!TOKEN_RE.test(token)) return deny();
  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_tenant_portal", { p_token: token });
    if (error) throw error;
    if (!data) return deny();
    const d = data as TenantPortalData;
    if (!d.show_balance) return deny("كشف الحساب غير متاح من هذه الصفحة — اطلبه من المكتب", 403);
    const office = d.office || {};
    const { trial, expired } = issuerMarks(office as any);
    const issuer = { org_name: office.org_name, billing_name: office.billing_name, billing_phone: office.billing_phone,
      cr_number: office.cr_number, vat_number: office.vat_number, due_soon_days: office.due_soon_days,
      due_imminent_days: office.due_imminent_days, expiring_days: office.expiring_days, trial, expired };
    /* بلا هوية ولا جوال: الرابط قد يُعاد توجيهه */
    const tenant = { ...d.tenant, national_id: null, phone: null };
    const html = statementHTML(tenant as any, d.property as any, issuer as any, (d.payments || []) as any, "brief");
    return new Response(html, { headers: {
      "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow", "cache-control": "no-store", ...secHeaders(html) } });
  } catch (e: any) {
    console.error("tenant statement failed", e?.message);
    return deny("تعذّر تحميل الكشف الآن — أعد المحاولة بعد قليل", 503);
  }
}
