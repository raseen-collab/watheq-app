import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { buildDemo, demoPayments } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

/**
 * البيانات التجريبية — إنشاء وحذف.
 *
 * POST  /api/demo   → ينشئ 5 عقارات و80 وحدة لحساب المستخدم — بشرط ألا يملك أي عقار
 * DELETE /api/demo  → يحذف كل ما وُسم is_demo لهذا المستخدم فقط
 *
 * الكتابة بمفتاح الخدمة بعد التحقق من الجلسة: الإدراج الجماعي يتجاوز فحوص
 * الواجهة، فنشترط هنا ما لا يمكن الالتفاف عليه — حساب فارغ للإنشاء، ووسم
 * is_demo مع user_id للحذف. لا يمسّ هذا المسار صفًّا حقيقيًّا واحدًا.
 */
function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdmin(url, key, { auth: { persistSession: false } });
}

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "الخدمة غير مهيأة" }, { status: 500 });

  /* الموظف حسابه بلا عقارات باسمه — فكان سيمرّ من الشرط التالي وينشئ مكتبًا
     تجريبيًّا باسمه هو. التجريبي لصاحب حساب جديد، لا لموظف داخل مكتب قائم. */
  const { data: tm } = await db.from("team_members").select("owner_id").eq("member_id", user.id).maybeSingle();
  if (tm?.owner_id) return NextResponse.json({ error: "البيانات التجريبية لصاحب المكتب — أنت عضو في مكتب قائم." }, { status: 403 });

  // شرط لا يُلتفّ عليه: حساب بلا أي عقار — فلا تكرار ولا خلط
  const { count } = await db.from("properties").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count || 0) > 0) return NextResponse.json({ error: "الحساب فيه عقارات — البيانات التجريبية للحساب الفارغ فقط." }, { status: 409 });

  const props = buildDemo(new Date());
  let units = 0, pays = 0;
  for (const p of props) {
    const { tenants, expenses, notes, ...prop } = p;
    const { data: created, error } = await db.from("properties")
      .insert({ ...prop, user_id: user.id, is_demo: true, collected: 0 }).select("id").single();
    if (error || !created) return NextResponse.json({ error: error?.message || "تعذّر إنشاء العقار" }, { status: 500 });
    const pid = created.id as string;

    const { data: tRows, error: tErr } = await db.from("tenants")
      .insert(tenants.map((t) => ({ ...t, property_id: pid }))).select("id, unit");
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    units += tRows?.length || 0;
    const idByUnit: Record<string, string> = {};
    (tRows || []).forEach((r: any) => { idByUnit[String(r.unit)] = r.id; });

    // دفعات فعلية تظهر في التقارير وتحرّك «المحصَّل»
    const payRows = demoPayments(p).filter((x) => idByUnit[x.unit]).map((x) => ({
      user_id: user.id, property_id: pid, tenant_id: idByUnit[x.unit], paid_on: x.paid_on,
      amount: x.amount, method: x.method, note: x.note, reference: x.reference, periods_covered: 1, created_by: user.id,
    }));
    if (payRows.length) {
      const { error: pErr } = await db.from("payments").insert(payRows);
      if (!pErr) {
        pays += payRows.length;
        const total = payRows.reduce((a, x) => a + x.amount, 0);
        await db.from("properties").update({ collected: total }).eq("id", pid);
      }
    }
    if (expenses.length) {
      await db.from("expenses").insert(expenses.map((e) => ({ ...e, property_id: pid, user_id: user.id })));
    }
    if (notes.length) {
      await db.from("property_notes").insert(notes.map((n) => ({ ...n, property_id: pid })));
    }
  }
  return NextResponse.json({ ok: true, properties: props.length, units, payments: pays });
}

export async function DELETE() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "الخدمة غير مهيأة" }, { status: 500 });

  /* الدفعات والمصروفات لا تُحذف مع العقار — يُفرَّغ مرجعها فقط (set null)
     فتبقى صفوفًا يتيمة تعبث بسجل الحركات وفحص السلامة. نحذفها صراحةً أولًا،
     ثم العقارات (والوحدات والملاحظات تتبعها بالحذف المتسلسل). */
  const { data: demoProps } = await db.from("properties").select("id")
    .eq("user_id", user.id).eq("is_demo", true);
  const ids = (demoProps || []).map((x: any) => x.id as string);
  if (!ids.length) return NextResponse.json({ ok: true, removed: 0 });

  await db.from("payments").delete().eq("user_id", user.id).in("property_id", ids);
  await db.from("expenses").delete().eq("user_id", user.id).in("property_id", ids);
  const { data, error } = await db.from("properties").delete()
    .eq("user_id", user.id).eq("is_demo", true).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, removed: data?.length || 0 });
}
