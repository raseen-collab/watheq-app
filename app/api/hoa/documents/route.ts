import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sanitizeHoaHtml, HOA_BODY_MAX } from "@/lib/hoaSanitize";

export const dynamic = "force-dynamic";

/**
 * مستندات اتحاد الملاك للمكتب (schema-v61).
 *  GET  ?association_id=…      قائمة المستندات مع عدّاد الردود وقائمة كل مالك
 *  GET  ?id=…                  مستند واحد بنصّه (للمعاينة)
 *  POST {association_id, kind, title, body_html, requires_signature, closes_at}  إصدار
 *  POST {action:'cancel', id}  إلغاء
 * كل شيء بجلسة المستخدم: القراءة عبر RLS (watheq_can_read) والكتابة عبر دوال
 * تتحقق من watheq_can_manage داخل القاعدة. مدير الجمعية يرى قرارات كل ملّاكها.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["minutes", "notice", "circular", "budget", "other"]);
const H = { "cache-control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: H });
const friendly = (msg?: string) => /not authorized/i.test(msg || "") ? "لا تملك صلاحية إدارة مستندات الجمعية." : (msg || "تعذّر تنفيذ الطلب");

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return fail("سجّل الدخول أولًا.", 401);

  const one = q.get("id");
  if (one) {
    if (!UUID_RE.test(one)) return fail("طلب غير صالح", 400);
    const { data, error } = await supabase.from("hoa_documents")
      .select("id, association_id, kind, title, body_html, body_sha256, requires_signature, closes_at, created_at, cancelled_at")
      .eq("id", one).maybeSingle();
    if (error) return fail(friendly(error.message), 400);
    if (!data) return fail("المستند غير موجود", 404);
    return NextResponse.json({ ok: true, document: { ...data, body_html: sanitizeHoaHtml(data.body_html) } }, { headers: H });
  }

  const assoc = String(q.get("association_id") || "");
  if (!UUID_RE.test(assoc)) return fail("طلب غير صالح", 400);
  const [docsR, ownersR] = await Promise.all([
    supabase.from("hoa_documents")
      .select("id, kind, title, requires_signature, closes_at, created_at, cancelled_at, body_sha256")
      .eq("association_id", assoc).order("created_at", { ascending: false }).limit(200),
    supabase.from("owners").select("id, name, unit").eq("association_id", assoc).order("unit").limit(2000),
  ]);
  if (docsR.error) return fail(friendly(docsR.error.message), 400);
  if (ownersR.error) return fail(friendly(ownersR.error.message), 400);
  const docs = docsR.data || [];
  const owners = ownersR.data || [];

  const sigs: any[] = [];
  const ids = docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 50) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("hoa_signatures")
        .select("document_id, owner_id, owner_name, unit, decision, typed_name, comment, signed_at, ip")
        .in("document_id", ids.slice(i, i + 50)).order("signed_at").range(from, from + 999);
      if (error) return fail(friendly(error.message), 400);
      sigs.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }

  const out = docs.map((d) => {
    const mine = sigs.filter((s) => s.document_id === d.id);
    const byOwner = new Map<string, { seen_at: string | null; decision: string | null; decided_at: string | null; typed_name: string | null; comment: string | null; ip: string | null }>();
    for (const s of mine) {
      if (!s.owner_id) continue;
      const cur = byOwner.get(s.owner_id) || { seen_at: null, decision: null, decided_at: null, typed_name: null, comment: null, ip: null };
      if (s.decision === "seen") cur.seen_at = s.signed_at;
      else { cur.decision = s.decision; cur.decided_at = s.signed_at; cur.typed_name = s.typed_name; cur.comment = s.comment; cur.ip = s.ip; }
      byOwner.set(s.owner_id, cur);
    }
    const perOwner = owners.map((o) => ({ owner_id: o.id, name: o.name, unit: o.unit, ...(byOwner.get(o.id) || { seen_at: null, decision: null, decided_at: null, typed_name: null, comment: null, ip: null }) }));
    /* قرارات ملّاك حُذفوا لاحقًا تبقى دليلًا — تُعرض بالاسم المحفوظ */
    const former = mine.filter((s) => !s.owner_id && s.decision !== "seen")
      .map((s) => ({ owner_id: null, name: s.owner_name, unit: s.unit, seen_at: null, decision: s.decision, decided_at: s.signed_at, typed_name: s.typed_name, comment: s.comment, ip: s.ip, former: true }));
    const counts = {
      approve: perOwner.filter((x) => x.decision === "approve").length,
      reject: perOwner.filter((x) => x.decision === "reject").length,
      seen: perOwner.filter((x) => !x.decision && x.seen_at).length,
      none: perOwner.filter((x) => !x.decision && !x.seen_at).length,
    };
    return { ...d, counts, owners: [...perOwner, ...former] };
  });
  return NextResponse.json({ ok: true, documents: out }, { headers: H });
}

export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > HOA_BODY_MAX * 3) return fail("المستند أكبر من المسموح", 413);
  let body: any;
  /* JSON فقط: نموذج HTML من موقع آخر لا يستطيع إرسال هذا النوع دون إذن CORS */
  if (!String(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return fail("طلب غير صالح", 415);
  try { body = await req.json(); } catch { return fail("طلب غير صالح", 400); }

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return fail("سجّل الدخول أولًا.", 401);

  if (body?.action === "cancel") {
    const id = String(body?.id || "");
    if (!UUID_RE.test(id)) return fail("طلب غير صالح", 400);
    const { data, error } = await supabase.rpc("watheq_hoa_document_cancel", { p_doc: id });
    if (error) return fail(friendly(error.message), /not authorized/i.test(error.message) ? 403 : 400);
    return NextResponse.json({ ok: true, cancelled: !!data }, { headers: H });
  }

  const assoc = String(body?.association_id || "");
  const kind = String(body?.kind || "");
  const title = String(body?.title || "").replace(/\s+/g, " ").trim();
  const requires = body?.requires_signature === true;
  const closes = body?.closes_at ? String(body.closes_at) : null;
  if (!UUID_RE.test(assoc)) return fail("طلب غير صالح", 400);
  if (!KINDS.has(kind)) return fail("نوع المستند غير معروف", 400);
  if (!title || title.length > 200) return fail("عنوان المستند مطلوب (200 حرف كحد أقصى)", 400);
  if (closes && !/^\d{4}-\d{2}-\d{2}$/.test(closes)) return fail("تاريخ آخر موعد غير صالح", 400);
  if (typeof body?.body_html !== "string") return fail("نص المستند مطلوب", 400);
  const html = sanitizeHoaHtml(body.body_html);
  if (!html.replace(/<[^>]*>/g, "").trim()) return fail("نص المستند فارغ", 400);
  if (html.length > HOA_BODY_MAX) return fail("نص المستند أطول من المسموح (200 ألف حرف)", 413);

  const { data, error } = await supabase.rpc("watheq_hoa_document_create", {
    p_assoc: assoc, p_kind: kind, p_title: title, p_body_html: html,
    p_requires_signature: requires, p_closes_at: requires ? closes : null,
  });
  if (error) return fail(friendly(error.message), /not authorized/i.test(error.message) ? 403 : 400);
  return NextResponse.json({ ok: true, id: data }, { headers: H });
}
