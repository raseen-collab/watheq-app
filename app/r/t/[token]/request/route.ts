import { denyHeaders, TOKEN_RE } from "@/lib/hoaPortal";
import { renderTenantDeny } from "@/lib/tenantPortal";
import { portalDb, clientIp, readPortalForm } from "@/lib/hoaPortalServer";
import { REQUEST_CATEGORIES } from "@/lib/hoaMoney";
import { notifyPortalEvent } from "@/lib/portalNotify";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * طلب صيانة من صفحة المستأجر — POST /r/t/{token}/request (نص فقط بلا صور).
 * سقف الحجم 8KB (الوصف حتى 1000 حرف عربي ≈ 6KB مرمَّزة). الحد (5 مفتوحة) في القاعدة.
 * بعد الحفظ: تنبيه تليجرام فوري لصاحب المكتب.
 */
const deny = (msg?: string, status = 404) => new Response(renderTenantDeny(msg), { status, headers: denyHeaders });
const back = (path: string) => new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
const CATS = new Set(REQUEST_CATEGORIES.map((c) => c.v));

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!TOKEN_RE.test(token)) return deny();
  const base = `/r/t/${token}`;
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
    const { data, error } = await db.rpc("watheq_tenant_request_submit", {
      p_token: token, p_category: category, p_location: location, p_description: description, p_ip: clientIp(req),
    });
    if (error) throw error;
    switch (data as string) {
      case "ok":
        await notifyPortalEvent(db, "tenant", token, { type: "request", category, location, description });
        return back(`${base}?m=req_ok#req`);
      case "bad_category": case "bad_location": return back(`${base}?m=req_bad#req`);
      case "bad_text": return back(`${base}?m=req_text#req`);
      case "too_many": return back(`${base}?m=req_many#req`);
      case "inactive": return back(`${base}?m=inactive`);
      case "invalid_link": return deny();
      default: return back(`${base}?m=req_err#req`);
    }
  } catch (e: any) {
    console.error("tenant request failed", e?.message);
    return back(`${base}?m=req_err#req`);
  }
}
