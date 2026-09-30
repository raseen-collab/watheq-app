import { renderDeny, denyHeaders, TOKEN_RE } from "@/lib/hoaPortal";
import { portalDb, clientIp, readPortalForm } from "@/lib/hoaPortalServer";
import { REQUEST_CATEGORIES } from "@/lib/hoaMoney";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * طلب صيانة من بوابة المالك — POST /r/o/{token}/request (نموذج عادي، نص فقط بلا صور).
 * الحمايات نفسها في /sign. الحد (5 طلبات مفتوحة لكل مالك) والتحقق يتمّان في القاعدة.
 * سقف الحجم هنا 8KB لا 4KB: الوصف حتى 1000 حرف عربي، والحرف العربي في النموذج
 * المرمَّز يأخذ 6 بايت (%D8%A7) ⇒ 1000 حرف ≈ 6KB. بقية المسارات 4KB.
 */
const deny = (msg?: string, status = 404) => new Response(renderDeny(msg), { status, headers: denyHeaders });
const back = (path: string) => new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
const CATS = new Set(REQUEST_CATEGORIES.map((c) => c.v));

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!TOKEN_RE.test(token)) return deny();
  const base = `/r/o/${token}`;
  const r = await readPortalForm(req, 8192);
  if (!r.ok) return deny(r.msg, r.status);
  const f = r.f;

  const category = String(f.get("category") || "");
  const location = String(f.get("location") || "");
  const description = String(f.get("description") || "").replace(/[ \t]+/g, " ").trim();
  if (!CATS.has(category) || (location !== "common" && location !== "unit")) return back(`${base}?m=req_bad#req`);
  if (description.length < 3 || description.length > 1000) return back(`${base}?m=req_text#req`);

  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_hoa_request_submit", {
      p_token: token, p_category: category, p_location: location, p_description: description, p_ip: clientIp(req),
    });
    if (error) throw error;
    switch (data as string) {
      case "ok": return back(`${base}?m=req_ok#req`);
      case "bad_category": case "bad_location": return back(`${base}?m=req_bad#req`);
      case "bad_text": return back(`${base}?m=req_text#req`);
      case "too_many": return back(`${base}?m=req_many#req`);
      case "invalid_link": return deny();
      default: return back(`${base}?m=req_err#req`);
    }
  } catch (e: any) {
    console.error("hoa request failed", e?.message);
    return back(`${base}?m=req_err#req`);
  }
}
