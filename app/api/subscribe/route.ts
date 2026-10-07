import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { tgSend } from "@/lib/telegram";
import { PROP_PLANS, HOA_PLANS, SUB_CLAIM_ERRORS } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * «أرسلت الحوالة» من صفحة /subscribe (schema-v71).
 *
 * - الطلب يُنشأ بجلسة المستخدم نفسه عبر watheq_sub_claim_submit: القاعدة
 *   تتحقق أنه صاحب المكتب، وتحسب المبلغ بنفسها — لا يُقبل مبلغ من المتصفح.
 * - بعد الحفظ تنبيه تليجرام لعبيد بسقف 2.5 ثانية؛ فشله لا يُسقط الطلب.
 * - لا شيء في profiles يتغيّر هنا: التفعيل من /admin/subs وحده.
 */
const escT = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: SUB_CLAIM_ERRORS.not_signed_in }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* فارغ */ }

  if (body?.action === "cancel") {
    const { data, error } = await supabase.rpc("watheq_sub_claim_cancel");
    if (error) return NextResponse.json({ error: "تعذّر الإلغاء — أعد المحاولة." }, { status: 500 });
    return NextResponse.json({ ok: data === "ok" });
  }

  const months = Number(body?.months) === 12 ? 12 : 1;
  const { data: code, error } = await supabase.rpc("watheq_sub_claim_submit", {
    p_prop: body?.prop || null,
    p_hoa: body?.hoa || null,
    p_months: months,
    p_payer: String(body?.payer || "").slice(0, 120),
    p_ref: String(body?.ref || "").slice(0, 120),
    p_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || "")) ? body.date : null,
  });
  if (error) {
    const missing = /Could not find|does not exist|schema cache/i.test(error.message || "");
    return NextResponse.json({ error: missing ? "الصفحة قيد التجهيز — راسلنا على واتساب مؤقتًا." : "تعذّر الإرسال — أعد المحاولة." }, { status: 500 });
  }
  if (code !== "ok") return NextResponse.json({ error: SUB_CLAIM_ERRORS[String(code)] || "تعذّر الإرسال." }, { status: 400 });

  // الطلب المحفوظ (المبلغ كما حسبته القاعدة) + اسم المكتب للتنبيه
  const [{ data: claim }, { data: prof }] = await Promise.all([
    supabase.from("subscription_claims").select("prop_plan,hoa_plan,months,amount,payer_name,bank_ref,transfer_date")
      .eq("user_id", user.id).eq("status", "pending").maybeSingle(),
    supabase.from("profiles").select("org_name,full_name,billing_phone").eq("id", user.id).maybeSingle(),
  ]);

  const chat = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (chat && claim) {
    const c = claim as any, p = (prof || {}) as any;
    const plans = [
      c.prop_plan ? `🏢 ${PROP_PLANS.find((x) => x.id === c.prop_plan)?.name || c.prop_plan}` : "",
      c.hoa_plan ? `🏘 جمعيات: ${HOA_PLANS.find((x) => x.id === c.hoa_plan)?.name || c.hoa_plan}` : "",
    ].filter(Boolean).join(" + ");
    const text = [
      "💳 <b>طلب اشتراك جديد — أرسل الحوالة</b>", "",
      `👤 ${escT(p.org_name || p.full_name || user.email || "—")}`,
      `📧 ${escT(user.email || "—")}${p.billing_phone ? ` · 📱 ${escT(p.billing_phone)}` : ""}`,
      `📦 ${escT(plans)} · ${c.months === 12 ? "سنوي" : "شهري"}`,
      `💰 المبلغ: <b>${Number(c.amount).toLocaleString("en-US")} ريال</b>`,
      `🧾 المحوِّل: ${escT(c.payer_name)}${c.bank_ref ? ` · المرجع: ${escT(c.bank_ref)}` : ""}`,
      `📅 تاريخ التحويل: ${escT(c.transfer_date)}`, "",
      "طابقها مع كشف البنك ثم فعّل أو ارفض من لوحة الاشتراكات.",
    ].join("\n");
    const send = tgSend(chat, text, [[{ text: "افتح لوحة الاشتراكات", url: "https://app.watheqapp.com/admin/subs" }]])
      .catch((e) => console.error("sub claim notify failed", e?.message || e));
    await Promise.race([send, new Promise((r) => setTimeout(r, 2500))]);
  }

  return NextResponse.json({ ok: true });
}
