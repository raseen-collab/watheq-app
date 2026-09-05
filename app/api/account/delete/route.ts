import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient as createSession } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * حذف الحساب نهائيًّا — بطلب صاحبه وحده.
 *
 * يشترطه نظام حماية البيانات الشخصية (حق المحو)، وتشترطه متاجر التطبيقات
 * لأي تطبيق فيه تسجيل. ولأن الحذف لا رجعة فيه، فيه ثلاث حواجز:
 *   1) جلسة صاحب الحساب نفسه (لا مفتاح إداري ولا رابط).
 *   2) كتابة كلمة «حذف» حرفيًّا في الواجهة.
 *   3) رفض الحذف ما دام في المكتب موظفون مرتبطون — تُزال العضويات أولًا،
 *      لئلا يفقد موظف وصوله فجأة بلا علم أحد.
 *
 * الحذف يشمل بيانات المكتب كلها (العقارات، الوحدات، الدفعات، المستندات،
 * الصور) لأن المستأجرين والملّاك أشخاص طبيعيون، وإبقاء بياناتهم بعد رحيل
 * المكتب لا سند له. والدفعات لا تُستثنى: وثيق لا يستلم مالًا فلا التزام
 * محاسبيًّا عليه بحفظها — والنسخة الورقية عند المكتب نفسه (زر التصدير).
 */
export async function POST(req: Request) {
  const session = createSession();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مسجّل دخول" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.confirm !== "حذف") {
    return NextResponse.json({ error: "التأكيد غير صحيح" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "الخدمة غير مهيّأة" }, { status: 500 });
  const db = createAdmin(url, key, { auth: { persistSession: false } });

  const uid = user.id;

  // (1) موظفون مرتبطون؟ لا نحذف حسابًا يعمل عليه آخرون بلا إزالتهم أولًا
  const { count: members } = await db.from("team_members")
    .select("member_id", { count: "exact", head: true }).eq("owner_id", uid);
  if ((members || 0) > 0) {
    return NextResponse.json({
      error: `لديك ${members} موظف مرتبط بحسابك. أزِلهم أولًا من قسم «الموظفون» في الإعدادات، ثم أعد المحاولة.`,
    }, { status: 409 });
  }

  try {
    // (2) صور المعروضات في التخزين — مجلدها باسم معرّف المستخدم
    try {
      const { data: files } = await db.storage.from("listing-photos").list(uid, { limit: 1000 });
      const paths = (files || []).map((f) => `${uid}/${f.name}`);
      if (paths.length) await db.storage.from("listing-photos").remove(paths);
    } catch { /* لا صور، أو الحاوية غير موجودة */ }

    // (3) الجداول التابعة للعقار/الجمعية أولًا (مفاتيحها إلى الأب)، ثم الأب
    const { data: props } = await db.from("properties").select("id").eq("user_id", uid);
    const { data: assocs } = await db.from("associations").select("id").eq("user_id", uid);
    const propIds = (props || []).map((p) => p.id);
    const assocIds = (assocs || []).map((a) => a.id);

    if (propIds.length) {
      await db.from("tenants").delete().in("property_id", propIds);
      await db.from("property_notes").delete().in("property_id", propIds);
    }
    if (assocIds.length) {
      await db.from("owners").delete().in("association_id", assocIds);
      await db.from("association_notes").delete().in("association_id", assocIds);
    }

    // (4) الجداول المرتبطة بالمستخدم مباشرة
    for (const t of ["payments", "expenses", "invoices", "owner_links", "listings",
                     "seeker_requests", "compliance_items", "association_budgets",
                     "advisor_log", "team_invites", "team_members"]) {
      try { await db.from(t).delete().eq("user_id", uid); } catch { /* جدول غير منشأ */ }
    }
    // عضويات هذا المستخدم كموظف عند غيره
    try { await db.from("team_members").delete().eq("member_id", uid); } catch { /* */ }

    await db.from("properties").delete().eq("user_id", uid);
    await db.from("associations").delete().eq("user_id", uid);
    await db.from("profiles").delete().eq("id", uid);

    // (5) حساب الدخول أخيرًا — بعده لا يمكن الرجوع
    const { error: authErr } = await db.auth.admin.deleteUser(uid);
    if (authErr) throw new Error(authErr.message);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("account deletion failed", uid, e);
    return NextResponse.json({ error: e?.message || "تعذّر الحذف" }, { status: 500 });
  }
}
