import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  /**
   * إعادة توجيه تحمل معها الكوكيز المحدَّثة.
   * ضرورية لأن getUser() أعلاه قد يجدّد رمز الجلسة ويكتب كوكيز جديدة على
   * `response`. إرجاع NextResponse.redirect مباشرةً يُنشئ استجابة أخرى
   * فتضيع تلك الكوكيز، ويبقى المتصفح على رمز تحديث مستهلَك — فتنقطع
   * الجلسة بلا سبب ظاهر عند أول تجديد.
   */
  const redirectTo = (url: URL) => {
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  const path = request.nextUrl.pathname;
  const isDashboard = path.startsWith("/dashboard") || path.startsWith("/onboarding");
  const isLogin = path.startsWith("/login");

  if (isDashboard && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path);
    /* مصدر الزائر ومعرّف جلسة القمع يعبران التحويل — كانت أزرار «ابدأ مجانًا»
       في الموقع تفتح جذر التطبيق فيضيع ?src= هنا ويُسجَّل الحساب بلا قناة.
       بنمط صارم: لا يُنقل نص حر إلى صفحة الدخول. */
    const src = request.nextUrl.searchParams.get("src");
    const wv = request.nextUrl.searchParams.get("wv");
    if (src && /^[a-z]{2,20}$/.test(src)) url.searchParams.set("src", src);
    if (wv && /^[A-Za-z0-9]{10,40}$/.test(wv)) url.searchParams.set("wv", wv);
    return redirectTo(url);
  }
  if (isLogin && user) {
    // احترم ?next إن كان مسارًا داخليًّا، وإلا فاللوحة
    const raw = request.nextUrl.searchParams.get("next");
    const target = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
    const url = request.nextUrl.clone();
    url.search = "";
    url.pathname = target.split("?")[0];
    return redirectTo(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
