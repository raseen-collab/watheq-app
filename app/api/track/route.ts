import { createClient as createServiceClient } from "@supabase/supabase-js";
import { parseFunnelBody, isBotAgent } from "@/lib/funnel";
import { noStoreFetch } from "@/lib/no-store-fetch";

export const dynamic = "force-dynamic";

/**
 * محطات القمع — زيارة، فتح التجربة، صفحة التسجيل، ضغط إنشاء الحساب.
 *
 * يستقبل من الموقع التسويقي (watheqapp.com) ومن التطبيق نفسه عبر
 * navigator.sendBeacon بنص عادي — طلب «بسيط» لا يحتاج إذن CORS مسبقًا.
 *
 * عام بلا جلسة، لذلك:
 *  - كل حقل يُطابَق بقائمة أو نمط (lib/funnel.ts) ولا يُقبل نص حر.
 *  - (sid, event) فريد: الجلسة الواحدة تُعدّ مرة في كل محطة مهما أُعيد الإرسال.
 *  - حدّ بسيط بالمعدّل لكل عنوان، في الذاكرة فقط — العنوان لا يُحفظ أبدًا.
 *  - الزواحف ومعاينات الروابط لا تُعدّ.
 *  - الرد دائمًا 204: القياس لا يُفشل أي صفحة ولا يكشف شيئًا.
 */
const RATE = new Map<string, { n: number; t: number }>();
const WINDOW = 60_000, MAX = 30;

const ok = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  try {
    if (isBotAgent(req.headers.get("user-agent"))) return ok();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    const now = Date.now();
    const cur = RATE.get(ip);
    if (cur && now - cur.t < WINDOW) {
      if (cur.n >= MAX) return ok();
      cur.n++;
    } else RATE.set(ip, { n: 1, t: now });
    if (RATE.size > 5000) RATE.clear();

    const row = parseFunnelBody((await req.text()).slice(0, 1001));
    if (!row) return ok();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return ok();
    const db = createServiceClient(url, key, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
    const { error } = await db.from("site_events").upsert(row, { onConflict: "sid,event", ignoreDuplicates: true });
    if (error) console.error("site_events insert failed:", error.message);
  } catch (e: any) {
    console.error("track threw:", e?.message || e);
  }
  return ok();
}
