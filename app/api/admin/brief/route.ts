import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * مستشار المنصة — إحاطة يومية لصاحب وثيق.
 *
 * يقرأ أرقام اليوم الفعلية (القمع، التسجيلات، النشاط، الإيرادات، القنوات)
 * ويعيد: أولوية اليوم، خطوات تنفيذية، تغريدات، إعلان حراج، وخطة الأسبوع.
 *
 * خصوصية: لا تُرسل أسماء عملاء ولا جوالات ولا بيانات مستأجرين إلى النموذج
 * — أرقام مجمّعة فقط. الرسائل الشخصية تُبنى محليًّا من قوالب لا بالذكاء.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const allowed = (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(user.id)) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "مفتاح الذكاء غير مضبوط" }, { status: 500 });

  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const [{ data: profiles }, { data: props }, { data: tenants }, { data: pays }, { data: subs }, { data: team }] = await Promise.all([
    db.from("profiles").select("id,account_type,created_at,trial_ends_at,subscribed_until,plan,signup_source,telegram_chat_id"),
    db.from("properties").select("id,user_id,created_at"),
    db.from("tenants").select("id,property_id,created_at"),
    db.from("payments").select("id,user_id,created_at,paid_on"),
    db.from("subscription_payments").select("amount,paid_at"),
    db.from("team_members").select("member_id"),
  ]);

  const members = new Set((team || []).map((t: any) => t.member_id));
  const accounts = (profiles || []).filter((p: any) => !members.has(p.id));
  const owner: Record<string, string> = {}; (props || []).forEach((p: any) => (owner[p.id] = p.user_id));
  const since = (v?: string | null) => { const t = Date.parse(String(v || "")); return isNaN(t) ? null : Math.round((Date.now() - t) / 86400000); };
  const withProps = new Set((props || []).map((p: any) => p.user_id));
  const withPays = new Set((pays || []).map((p: any) => p.user_id));
  const paying = accounts.filter((p: any) => p.subscribed_until && Date.parse(p.subscribed_until) > Date.now());
  const monthStart = new Date(); monthStart.setDate(1);

  const snapshot = {
    اليوم: new Date().toISOString().slice(0, 10),
    الحسابات: accounts.length,
    أكملوا_الترحيب: accounts.filter((p: any) => p.account_type).length,
    أضافوا_عقارًا: accounts.filter((p: any) => withProps.has(p.id)).length,
    سجّلوا_دفعة: accounts.filter((p: any) => withPays.has(p.id)).length,
    مشتركون_دافعون: paying.length,
    إجمالي_العقارات: (props || []).length,
    إجمالي_الوحدات: (tenants || []).length,
    وحدات_أضيفت_هذا_الأسبوع: (tenants || []).filter((t: any) => (since(t.created_at) ?? 99) <= 7).length,
    دفعات_هذا_الأسبوع: (pays || []).filter((p: any) => (since(p.created_at || p.paid_on) ?? 99) <= 7).length,
    تسجيلات_هذا_الأسبوع: accounts.filter((p: any) => (since(p.created_at) ?? 99) <= 7).length,
    تسجيلات_الأسبوع_الماضي: accounts.filter((p: any) => { const d = since(p.created_at) ?? 999; return d > 7 && d <= 14; }).length,
    تجارب_تنتهي_خلال_أسبوع: accounts.filter((p: any) => { const d = p.trial_ends_at ? Math.round((Date.parse(p.trial_ends_at) - Date.now()) / 86400000) : null; return d !== null && d >= 0 && d <= 7; }).length,
    محصَّل_هذا_الشهر: (subs || []).filter((s: any) => Date.parse(s.paid_at) >= monthStart.getTime()).reduce((a: number, s: any) => a + (Number(s.amount) || 0), 0),
    القنوات: Object.entries((accounts as any[]).reduce((m: any, p: any) => { const k = p.signup_source || "غير معروف"; m[k] = (m[k] || 0) + 1; return m; }, {})),
  };

  const system = `أنت مستشار نمو لمنصة سعودية اسمها "وثيق" — إدارة أملاك وجمعيات ملاك للمكاتب العقارية الصغيرة.
الحقائق الثابتة: التسعير 99 ريال/شهر لمالك العقار و199 للمكتب. المنافس الأكبر "سمات" يبدأ من 499 شهريًا باشتراك سنوي. ميزة وثيق: السعر، البساطة، والتعامل المباشر مع المطوّر. قنوات التوزيع: حراج، تويتر، قروبات تليجرام/واتساب، والتواصل المباشر مع مكاتب جدة.
صاحب المنصة طبيب مقيم يعمل عليها في وقته الخاص — وقته ضيق جدًا. لا تقترح ما يستغرق أسابيع؛ اقترح ما يُنجز اليوم في أقل من ساعة.
تحدث بالعربية السعودية المهنية. لا مبالغة ولا تحفيز فارغ. إن كانت الأرقام سيئة قلها صراحة.
أعد JSON فقط بلا أي نص قبله أو بعده، بهذا الشكل:
{"today":"جملة واحدة: أهم شيء يفعله اليوم ولماذا","reading":"قراءة الأرقام في 2-3 جمل: ما تحسّن وما ساء","actions":["خطوة تنفيذية محددة تُنجز اليوم","...حتى 4"],"tweets":["تغريدة جاهزة للنشر بلا هاشتاقات كثيرة","...3 تغريدات"],"haraj":"نص إعلان حراج جاهز: عنوان ثم وصف قصير ثم دعوة تواصل","week":["هدف الأسبوع 1","...حتى 3"]}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ADVISOR_MODEL || "claude-sonnet-4-6",
        max_tokens: 1600,
        system,
        messages: [{ role: "user", content: `أرقام المنصة اليوم:\n${JSON.stringify(snapshot, null, 1)}` }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("admin brief API error", res.status, t.slice(0, 400));
      return NextResponse.json({ error: `تعذّر الوصول للمستشار (${res.status})` }, { status: 502 });
    }
    const data = await res.json();
    const raw = (data?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    const clean = raw.replace(/^```json|^```|```$/gm, "").trim();
    let brief: any;
    try { brief = JSON.parse(clean); }
    catch { return NextResponse.json({ error: "رد غير مفهوم من المستشار", raw: clean.slice(0, 300) }, { status: 502 }); }
    return NextResponse.json({ ok: true, brief, snapshot, at: new Date().toISOString() });
  } catch (e: any) {
    console.error("admin brief failed", e);
    return NextResponse.json({ error: e?.message || "تعذّر الاتصال" }, { status: 500 });
  }
}
