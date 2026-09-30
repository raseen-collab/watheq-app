import { renderBuildingPage, renderDeny, portalHeaders, denyHeaders, TOKEN_RE } from "@/lib/hoaPortal";
import { portalDb, newNonce } from "@/lib/hoaPortalServer";
import type { BuildingData } from "@/lib/hoaMoney";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * 🏢 شفافية العمارة — /b/{token}
 * رابط عام واحد للعمارة (يُرسل لمجموعة الملاك والسكان) يعرض أرقامًا مجمَّعة فقط:
 * رصيد الصندوق، المحصَّل والمصروف، المصروفات حسب البند، نسبة السداد.
 * لا أسماء ملاك ولا حالة وحدة ولا مورّدين — الدالة (schema-v62) لا تُرجعها أصلًا.
 * الرمز المجهول والمُبطَل يأخذان الرد نفسه.
 */
const deny = (msg?: string, status = 404) => new Response(renderDeny(msg), { status, headers: denyHeaders });

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!TOKEN_RE.test(token)) return deny();
  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_hoa_building", { p_token: token });
    if (error) throw error;
    if (!data) return deny();
    const nonce = newNonce();
    return new Response(renderBuildingPage(data as BuildingData, { nonce }), { headers: portalHeaders(nonce) });
  } catch (e: any) {
    console.error("hoa building page failed", e?.message);
    return deny("تعذّر تحميل الصفحة الآن — أعد فتح الرابط بعد قليل", 503);
  }
}
