import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { recordSignupSource } from "@/lib/signup-source-server";

export const dynamic = "force-dynamic";

/**
 * وجهة العودة من قوقل.
 *
 * تدفّق PKCE: قوقل يعيد المستخدم إلى Supabase، وSupabase يعيده إلى هنا
 * ومعه `code`. نبادله بجلسة، فتُكتب كوكيز الجلسة على نطاقنا، ثم ننقله.
 *
 * 🔒 `next` لا يُؤخذ كما جاء: تُقبل المسارات الداخلية فقط. بدون هذا
 * يصير الرابط أداة تحويل مفتوح — يُرسَل للضحية `?next=https://evil.com`
 * فتنتقل إلى موقع خارجي **بعد** دخول ناجح فتظن أنه جزء من وثيق.
 * (نفس الحماية المطبَّقة في صفحة الدخول)
 */
function safeNext(raw: string | null, BASE: string): string {
  if (!raw) return "/dashboard";
  // 30 سبتمبر 2026: "/\t/evil.com" كان يمرّ — المتصفح يحذف الـTab فيصير
  // "//evil.com". نرفض أي محرف تحكّم أو شرطة مائلة عكسية أصلًا.
  if (/[\u0000-\u001F\u007F-\u009F\\]/.test(raw)) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  try {
    // الحَكَم الأخير هو محلّل URL نفسه: يجب أن يبقى على نفس الأصل، والمسار
    // الناتج بعد التطبيع (مثل "/.//evil.com") لا يبدأ بـ"//".
    const u = new URL(raw, BASE);
    if (u.origin !== new URL(BASE).origin) return "/dashboard";
    const out = u.pathname + u.search + u.hash;
    if (!out.startsWith("/") || out.startsWith("//")) return "/dashboard";
    return out;
  } catch {
    return "/dashboard";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), url.origin);

  // قوقل يعيد الخطأ في المعاملات لا كاستثناء
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/login?err=${encodeURIComponent(oauthError)}`, url.origin)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login?err=رمز+الدخول+مفقود", url.origin));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?err=${encodeURIComponent(error.message)}`, url.origin)
    );
  }

  /* مصدر التسجيل للداخل بقوقل: قوقل يملك `user_metadata` فلا يمكن حشو المصدر
     فيه كما نفعل في التسجيل بالبريد، ولا يمرّ مستخدم قوقل بقائمة «كيف عرفت
     عنا؟». فيُحمَل المصدر في `redirectTo` من صفحة الدخول ويُثبَّت هنا — وهذه
     هي اللحظة الوحيدة التي تجمع جلسةً ناجحة وقيمةَ المصدر معًا.
     لا يُعطّل الدخول إن فشل: الدالة لا ترمي، ولا نتحقق من نتيجتها. */
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await recordSignupSource(user.id, url.searchParams.get("src"), { requireFreshProfile: true });
  }

  // نجحت الجلسة — الوسيط يتكفّل بتوجيه من لم يكمل onboarding
  return NextResponse.redirect(new URL(next, url.origin));
}
