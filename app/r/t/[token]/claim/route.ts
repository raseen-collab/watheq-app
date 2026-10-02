import { denyHeaders, TOKEN_RE } from "@/lib/hoaPortal";
import { renderTenantDeny } from "@/lib/tenantPortal";
import { portalDb, clientIp, readPortalForm, latinDigits } from "@/lib/hoaPortalServer";
import { notifyPortalEvent } from "@/lib/portalNotify";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * «أرسلت الحوالة» من صفحة المستأجر — POST /r/t/{token}/claim (نموذج عادي، نص فقط).
 * الحمايات نفسها في بوابة الجمعية: نوع المحتوى، ≤ 4KB، نفس الأصل، رمز بصيغته.
 * كل شرط (الرابط فعّال، الاشتراك، المبلغ، التاريخ، 3 معلّقة كحد أقصى) يُفحص في القاعدة.
 * بعد الحفظ: تنبيه تليجرام فوري لصاحب المكتب.
 */
const deny = (msg?: string, status = 404) => new Response(renderTenantDeny(msg), { status, headers: denyHeaders });
const back = (path: string) => new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = String(params?.token || "");
  if (!TOKEN_RE.test(token)) return deny();
  const base = `/r/t/${token}`;
  const r = await readPortalForm(req);
  if (!r.ok) return deny(r.msg, r.status);
  const f = r.f;

  const amtTxt = latinDigits(String(f.get("amount") || ""));
  const amount = /^\d{1,9}(\.\d{1,2})?$/.test(amtTxt) ? Number(amtTxt) : NaN;
  const date = latinDigits(String(f.get("transfer_date") || ""));
  const ref = String(f.get("bank_ref") || "").replace(/\s+/g, " ").trim();
  const note = String(f.get("note") || "").replace(/\s+/g, " ").trim();
  if (!(amount > 0)) return back(`${base}?m=claim_amount#claim`);
  if (!DATE_RE.test(date)) return back(`${base}?m=claim_date#claim`);
  if (ref.length > 80 || note.length > 300) return back(`${base}?m=claim_ref#claim`);

  const db = portalDb();
  if (!db) return deny("الخدمة غير مهيأة", 500);
  try {
    const { data, error } = await db.rpc("watheq_tenant_claim_submit", {
      p_token: token, p_amount: amount, p_date: date, p_ref: ref || null, p_note: note || null, p_ip: clientIp(req),
    });
    if (error) throw error;
    switch (data as string) {
      case "ok":
        await notifyPortalEvent(db, "tenant", token, { type: "claim", amount, date, ref: ref || null });
        return back(`${base}?m=claim_ok#claim`);
      case "bad_amount": return back(`${base}?m=claim_amount#claim`);
      case "bad_date": return back(`${base}?m=claim_date#claim`);
      case "bad_ref": return back(`${base}?m=claim_ref#claim`);
      case "too_many": return back(`${base}?m=claim_many#claim`);
      case "no_rent": return back(`${base}?m=claim_norent#claim`);
      case "inactive": return back(`${base}?m=inactive`);
      case "invalid_link": return deny();
      default: return back(`${base}?m=claim_err#claim`);
    }
  } catch (e: any) {
    console.error("tenant claim failed", e?.message);
    return back(`${base}?m=claim_err#claim`);
  }
}
