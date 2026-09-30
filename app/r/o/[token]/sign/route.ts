import { renderDeny, denyHeaders, TOKEN_RE, UUID_RE } from "@/lib/hoaPortal";
import { portalDb, clientIp, userAgent } from "@/lib/hoaPortalServer";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * اعتماد/رفض مستند من بوابة المالك — POST /r/o/{token}/sign (نموذج عادي).
 * كل الشروط تُفحص داخل القاعدة في استدعاء واحد (watheq_hoa_sign):
 * الرابط فعّال، المستند لنفس الجمعية وغير ملغى، لم تنتهِ مدته بتوقيت الرياض،
 * ولم يُسجَّل قرار سابق. القرار لا يُعدَّل بعد تسجيله.
 */
const MAX_BODY = 4096;
const deny = (msg?: string, status = 404) => new Response(renderDeny(msg), { status, headers: denyHeaders });
const back = (path: string) => new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store", "referrer-policy": "no-referrer" } });

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!TOKEN_RE.test(token)) return deny();
  const base = `/r/o/${token}`;

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) return deny("الطلب أكبر من المسموح", 413);
  const ctype = (req.headers.get("content-type") || "").toLowerCase();
  if (!ctype.startsWith("application/x-www-form-urlencoded")) return deny("طلب غير صالح", 415);
  /* نموذج من موقع آخر لا يعرف الرمز أصلًا؛ ومع ذلك نرفض أصلًا مختلفًا صراحةً */
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    try { if (new URL(origin).host !== new URL(req.url).host) return deny("طلب غير صالح", 403); } catch { return deny("طلب غير صالح", 403); }
  }

  let raw: string;
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BODY) return deny("الطلب أكبر من المسموح", 413);
    raw = new TextDecoder().decode(buf);
  } catch { return deny("طلب غير صالح", 400); }
  const f = new URLSearchParams(raw);
  const doc = String(f.get("doc") || "");
  if (!UUID_RE.test(doc)) return deny();
  const docPath = `${base}/d/${doc}`;
  const decision = String(f.get("decision") || "");
  const name = String(f.get("typed_name") || "").replace(/\s+/g, " ").trim();
  const comment = String(f.get("comment") || "").trim();
  if (decision !== "approve" && decision !== "reject") return back(`${docPath}?m=err`);
  if (f.get("ack") !== "1") return back(`${docPath}?m=ack`);
  if (!name || name.length > 80) return back(`${docPath}?m=name`);
  if (comment.length > 300) return back(`${docPath}?m=big`);

  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_hoa_sign", {
      p_token: token, p_doc: doc, p_decision: decision, p_typed_name: name,
      p_comment: comment || null, p_ip: clientIp(req), p_ua: userAgent(req),
    });
    if (error) throw error;
    switch (data as string) {
      case "ok": return back(`${base}?m=${decision}`);
      case "duplicate": return back(`${base}?m=dup`);
      case "closed": return back(`${docPath}?m=closed`);
      case "cancelled": return back(`${base}?m=cancelled`);
      case "not_required": return back(`${docPath}?m=notreq`);
      case "bad_name": return back(`${docPath}?m=name`);
      case "invalid_link": case "not_found": return deny();
      default: return back(`${docPath}?m=err`);
    }
  } catch (e: any) {
    console.error("hoa sign failed", e?.message);
    return back(`${docPath}?m=err`);
  }
}
