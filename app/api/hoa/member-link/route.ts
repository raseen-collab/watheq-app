import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * رابط المالك الخاص في اتحاد الملاك — POST {owner_id, action: 'get'|'revoke'}
 * يمرّ على دوال schema-v61 بجلسة المستخدم نفسه، فالتحقق من الصلاحية
 * (record_payments) ومن تبعية المالك للمكتب يتم داخل القاعدة.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  let body: any;
  /* JSON فقط: نموذج HTML من موقع آخر لا يستطيع إرسال هذا النوع دون إذن CORS */
  if (!String(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return fail("طلب غير صالح", 415);
  try { body = await req.json(); } catch { return fail("طلب غير صالح", 400); }
  const ownerId = String(body?.owner_id || "");
  const action = body?.action === "revoke" ? "revoke" : body?.action === "get" ? "get" : null;
  if (!UUID_RE.test(ownerId) || !action) return fail("طلب غير صالح", 400);

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return fail("سجّل الدخول أولًا.", 401);

  if (action === "get") {
    const { data, error } = await supabase.rpc("watheq_hoa_link_get_or_create", { p_owner: ownerId });
    if (error || !data) {
      const denied = /not authorized/i.test(error?.message || "");
      if (!denied) console.error("hoa member link get failed", error?.message);
      return fail(denied ? "لا تملك صلاحية إنشاء روابط الملاك." : (error?.message || "تعذّر إنشاء الرابط"), denied ? 403 : 400);
    }
    return NextResponse.json({ ok: true, token: data, path: `/r/o/${data}` }, { headers: { "cache-control": "no-store" } });
  }
  const { data, error } = await supabase.rpc("watheq_hoa_link_revoke", { p_owner: ownerId });
  if (error) {
    const denied = /not authorized/i.test(error.message || "");
    return fail(denied ? "لا تملك صلاحية إبطال روابط الملاك." : error.message, denied ? 403 : 400);
  }
  return NextResponse.json({ ok: true, revoked: Number(data) || 0 }, { headers: { "cache-control": "no-store" } });
}
