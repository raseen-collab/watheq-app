import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * مسؤول الإعلانات — توليد المحتوى وتسجيل النشر.
 *
 * الفرق عن مولّد نصوص عادي: النموذج يستلم قواعد كل قناة، وما نُشر فيها
 * سابقًا (حتى لا يكرّر)، ونتائج كل قناة فعليًّا (تسجيلات وتفعيلات) — فيكتب
 * ما لم يُجرَّب ويضاعف ما نجح، كما يفعل مسؤول إعلانات يعرف حسابه.
 *
 * خصوصية: لا أسماء عملاء ولا جوالات تُرسل للنموذج — أرقام وقنوات فقط.
 */

function admin() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
async function requireAdmin(): Promise<string> {
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) throw new Error("غير مصرّح");
  const allowed = (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(user.id)) throw new Error("غير مصرّح");
  return user.id;
}

const CHANNEL_RULES: Record<string, string> = {
  haraj: `حراج: جمهوره ملّاك ومكاتب يبحثون بجدّية. العنوان يجب أن يذكر المشكلة لا اسم المنتج. النص قصير بأسطر مفصولة، بلا مبالغة تسويقية، وينتهي بدعوة تواصل واتساب لا برابط موقع (الروابط تُقلّل الوصول وقد تُصنّف إعلانًا). لا تكرّر نفس العنوان مرتين — حراج يخفض المكرر.`,
  twitter: `تويتر/X: الحساب @watheqapp تعرّض سابقًا لتصنيف سبام بسبب تكرار الروابط، فالقاعدة: تغريدات معرفية مفيدة بلا روابط في الأغلب، ورابط واحد كل عدة تغريدات فقط. التغريدة الأقوى هي التي تعلّم شيئًا نظاميًّا (نظام الإيجار، إيجار، فال، جمعيات الملاك) ثم تذكر وثيق بجملة واحدة. بلا هاشتاقات كثيرة (اثنان كحد أقصى).`,
  group: `قروبات واتساب/تليجرام العقارية: قروب واحد في اليوم فقط، ورسالة واحدة بلا تكرار. النبرة زميل يشارك أداة لا مسوّق. اذكر أنك المطوّر وأن التواصل معك مباشر — هذه أقوى ميزة أمام أنظمة الشركات الكبيرة.`,
  direct: `تواصل مباشر مع مكاتب عقارية (زيارة أو واتساب): رسالة قصيرة جدًا، تذكر اسم الحي أو المدينة، وتعرض التجهيز اليدوي للبيانات مجانًا بلا التزام — هذا هو العرض الذي حوّل أول عميل فعليًّا.`,
  other: `قناة أخرى: اكتب محتوى قصيرًا واضحًا يركّز على المشكلة والحل والتواصل المباشر.`,
};

export async function POST(req: Request) {
  let uid: string;
  try { uid = await requireAdmin(); } catch { return NextResponse.json({ error: "غير مصرّح" }, { status: 403 }); }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const db = admin();

  // ---------- تسجيل منشور ----------
  if (action === "log") {
    const { error } = await db.from("ad_posts").insert({
      channel: String(body.channel || "other"), title: body.title || null,
      content: String(body.content || "").slice(0, 4000), url: body.url || null,
      outcome: body.outcome || null, replies: Number(body.replies) || 0, created_by: uid,
      ...(body.posted_at ? { posted_at: body.posted_at } : {}),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ---------- تحديث نتيجة منشور ----------
  if (action === "outcome") {
    const { error } = await db.from("ad_posts").update({ outcome: body.outcome || null, replies: Number(body.replies) || 0 }).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ---------- توليد محتوى ----------
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "مفتاح الذكاء غير مضبوط" }, { status: 500 });
  const channel = String(body?.channel || "haraj");
  const brief = String(body?.brief || "").slice(0, 500);

  const [{ data: profiles }, { data: props }, { data: tenants }, { data: posts }, { data: team }] = await Promise.all([
    db.from("profiles").select("id,account_type,created_at,signup_source,subscribed_until"),
    db.from("properties").select("id,user_id"),
    db.from("tenants").select("id"),
    db.from("ad_posts").select("channel,title,content,posted_at,outcome,replies").order("posted_at", { ascending: false }).limit(25),
    db.from("team_members").select("member_id"),
  ]);
  const members = new Set((team || []).map((t: any) => t.member_id));
  const accounts = (profiles || []).filter((p: any) => !members.has(p.id));
  const withProps = new Set((props || []).map((p: any) => p.user_id));
  const perChannel: Record<string, { signups: number; activated: number; paid: number }> = {};
  accounts.forEach((p: any) => {
    const k = p.signup_source || "غير معروف";
    perChannel[k] ||= { signups: 0, activated: 0, paid: 0 };
    perChannel[k].signups++;
    if (withProps.has(p.id)) perChannel[k].activated++;
    if (p.subscribed_until && Date.parse(p.subscribed_until) > Date.now()) perChannel[k].paid++;
  });

  const system = `أنت مسؤول الإعلانات والنمو لمنصة "وثيق" السعودية (إدارة أملاك وجمعيات ملاك للمكاتب العقارية الصغيرة).

الحقائق الثابتة التي تكتب على أساسها:
- التسعير: 99 ريال/شهر لمالك العقار، 199 للمكتب. المنافس "سمات" يبدأ 499 شهريًا باشتراك سنوي إلزامي (6000 ريال حدًّا أدنى).
- ما تملكه وثيق ولا يملكه المنافسون: التزامات المكتب (رخصة فال، عقود الوساطة، تراخيص الإعلانات)، جمعيات الملاك، مستشار نظامي، كشف مالك مجمّع، تواريخ هجرية، والتعامل المباشر مع المطوّر.
- ما لا تملكه وثيق ولا تعد به أبدًا: ربط منصة إيجار، محاسبة كاملة، تحصيل أو بوابة دفع، صيانة بمقاولين، فاتورة المرحلة الثانية. لا تكتب أي وعد خارج هذه القائمة.
- وثيق أداة تنظيمية: لا تستلم أموالًا ولا تقدّم خدمات قانونية. لا تكتب ما يوحي بغير ذلك.
- صاحب المنصة طبيب مقيم، وقته ضيق، والتواصل معه مباشر عبر واتساب 0596300591.

قواعد القناة المطلوبة الآن:
${CHANNEL_RULES[channel] || CHANNEL_RULES.other}

اكتب بالعربية السعودية المهنية. بلا مبالغة، بلا "ثورة" و"الأفضل"، وبلا وعود غير مدعومة. الجملة القصيرة أقوى.
أعد JSON فقط بلا أي نص خارجه:
{"variants":[{"title":"عنوان قصير (اترك فارغًا إن كانت القناة لا تحتاج عنوانًا)","body":"النص الجاهز للنشر"},{...}],"why":"سطر واحد: لماذا هذه الزاوية الآن بناءً على الأرقام والمنشورات السابقة","next":"اقتراح واحد لما يُنشر بعده"}
اكتب 3 نسخ مختلفة الزاوية لا مختلفة الصياغة فقط.`;

  const context = {
    القناة: channel,
    طلب_خاص: brief || "(لا شيء — اختر أنت أفضل زاوية)",
    أرقام_المنصة: {
      حسابات: accounts.length,
      فعّلوا_بيانات: accounts.filter((p: any) => withProps.has(p.id)).length,
      وحدات_مدارة: (tenants || []).length,
      تسجيلات_آخر_14_يوم: accounts.filter((p: any) => (Date.now() - Date.parse(p.created_at || "")) / 86400000 <= 14).length,
    },
    نتائج_القنوات: perChannel,
    آخر_ما_نُشر: (posts || []).map((p: any) => ({ القناة: p.channel, التاريخ: String(p.posted_at).slice(0, 10), العنوان: p.title, مقتطف: String(p.content).slice(0, 120), النتيجة: p.outcome, ردود: p.replies })),
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.ADVISOR_MODEL || "claude-sonnet-4-6", max_tokens: 1800, system, messages: [{ role: "user", content: JSON.stringify(context, null, 1) }] }),
    });
    if (!res.ok) {
      const t = await res.text(); console.error("ads gen error", res.status, t.slice(0, 300));
      return NextResponse.json({ error: `تعذّر التوليد (${res.status})` }, { status: 502 });
    }
    const data = await res.json();
    const raw = (data?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim().replace(/^```json|^```|```$/gm, "").trim();
    try { return NextResponse.json({ ok: true, ...JSON.parse(raw) }); }
    catch { return NextResponse.json({ error: "رد غير مفهوم", raw: raw.slice(0, 300) }, { status: 502 }); }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "تعذّر الاتصال" }, { status: 500 });
  }
}
