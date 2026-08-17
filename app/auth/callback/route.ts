import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

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
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//")) return "/dashboard";   // //evil.com يُقرأ كنطاق خارجي
  if (raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

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

  // نجحت الجلسة — الوسيط يتكفّل بتوجيه من لم يكمل onboarding
  return NextResponse.redirect(new URL(next, url.origin));
}
