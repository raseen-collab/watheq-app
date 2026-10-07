"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { CHOSEN_SOURCES, isSignupSource, sourceFromReferrer, sourceLabel } from "@/lib/signup-sources";
import { track, funnelSrc } from "@/lib/track";

/**
 * تنظيف وجهة ما بعد الدخول.
 * يقبل المسارات الداخلية فقط — يمنع `?next=https://…` من نقل المستخدم
 * إلى موقع خارجي بعد تسجيل دخول ناجح (ثغرة إعادة توجيه مفتوحة).
 */
/** أصل وهمي ثابت للتحليل فقط — نفس النتيجة على الخادم والمتصفح */
const BASE = "https://watheq.invalid";
function safeNext(raw: string | null): string {
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-muted">جارٍ التحميل…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  /**
   * مصدر مستنتَج من الصفحة السابقة — يُستعمل فقط حين لا يوجد `?src=` ولم
   * يختر المستخدم شيئًا. لا يُملأ به الحقل الظاهر: جواب الإنسان أولى من
   * استنتاجنا، ولا يصح أن يجد في القائمة جوابًا لم يكتبه.
   */
  const [inferred, setInferred] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // يبقى true بعد نجاح الدخول حتى تُغادر الصفحة — فلا يعود الزر قابلًا للضغط
  const [leaving, setLeaving] = useState(false);

  // يقبل ?src=twitter و?src=demo من روابط الحملات فيملأ الحقل تلقائيًّا
  useEffect(() => {
    const s = searchParams.get("src");
    if (isSignupSource(s)) setSource(s as string);
    else {
      /* لا `?src=` في الرابط: من وصل مباشرةً من بحث أو من تويتر يُعرف من
         `document.referrer`. القادم من watheqapp.com تعود فارغة — سكربت
         الموقع هناك هو من يمرّر المصدر في الرابط. وإن لم يُعرف من هذا ولا
         ذاك، فمصدر الجلسة المحفوظ (من زار التجربة قادمًا من حراج ثم ضغط
         «دخول» بلا معامل) خيرٌ من الفراغ. */
      const inf = sourceFromReferrer(typeof document === "undefined" ? "" : document.referrer) || funnelSrc();
      if (isSignupSource(inf)) setInferred(inf);
    }
    if (searchParams.get("mode") === "signup") setMode("signup");
    // خطأ عائد من /auth/callback (فشل قوقل أو رفض المستخدم)
    const err = searchParams.get("err");
    if (err) setError(err.includes("access_denied") ? "أُلغي الدخول بقوقل." : err);
  }, [searchParams]);

  /* محطة القمع: ظهور نموذج إنشاء الحساب — مرة واحدة للجلسة (track يمنع التكرار) */
  useEffect(() => { if (mode === "signup") track("signup_view"); }, [mode]);

  /**
   * ينقل مصدر التسجيل من بيانات الحساب إلى الملف الشخصي عند أول دخول.
   * سبب التأجيل: عند إنشاء الحساب لا توجد جلسة بعد (يلزم تفعيل البريد)،
   * فلا يمكن الكتابة في profiles إلا بعد أول تسجيل دخول ناجح.
   *
   * ⚠️ كان يكتب من المتصفح مباشرةً — وصلاحيات الأعمدة على `profiles` تُمنح
   * عمودًا عمودًا (schema-v11)، فأي عمود أضيف بعد ذلك المنح قد يُرفَض بـ42501
   * ويُبتلع الخطأ في catch صامت. صار النداء على مسار خادم يكتب بمفتاح الخدمة
   * فلا يعتمد الرقم على منحٍ قد نكون نسيناه.
   */
  async function syncSource(src?: string) {
    try {
      const q = src ? `?src=${encodeURIComponent(src)}` : "";
      await fetch(`/api/auth/source${q}`, { method: "POST" });
    } catch {
      /* لا يُعطّل الدخول إن فشل */
    }
  }

  /**
   * الدخول بحساب قوقل.
   * لا نحتاج معالجة نجاح هنا: المتصفح يغادر الصفحة إلى قوقل، ثم يعود
   * إلى /auth/callback الذي يبادل الرمز بجلسة وينقل المستخدم.
   */
  async function signInWithGoogle() {
    setError(null); setInfo(null); setGoogleLoading(true);
    if (mode === "signup") track("signup_submit");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          /* المصدر يُحمَل في الوجهة: قوقل لا يسمح بحشوه في user_metadata،
             و/auth/callback هو أول موضع تتوفّر فيه جلسة ناجحة ليُثبَّت. */
          redirectTo: (() => {
            /* اختيار المستخدم أولًا، ثم الرابط، ثم الاستنتاج من الصفحة السابقة.
               داخل قوقل تحديدًا لا يوجد اختيار مستخدم أصلًا، فالاستنتاج هو
               الفرصة الوحيدة لمعرفة القناة. */
            const s = source || inferred;
            return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}${s ? `&src=${encodeURIComponent(s)}` : ""}`;
          })(),
          queryParams: { prompt: "select_account" },   // يسمح باختيار الحساب لا الدخول بآخر واحد صامتًا
        },
      });
      if (error) throw error;
      setLeaving(true);
    } catch (e: any) {
      setError(String(e?.message || e));
      setGoogleLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    const supabase = createClient();
    try {
      if (mode === "forgot") {
        /**
         * استعادة كلمة المرور: Supabase يرسل بريدًا برابط مؤقت يعود إلى
         * /auth/callback (يبادل الرمز بجلسة) ثم إلى /reset-password.
         * الرسالة واحدة سواء وُجد البريد أم لا — حتى لا يُستخدم النموذج
         * لاكتشاف أي البريدات مسجّلة عندنا (تعداد حسابات).
         */
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
        });
        if (error && /rate limit|seconds/i.test(String(error.message))) {
          setError("طلبات كثيرة متتالية — انتظر دقيقة ثم أعد المحاولة.");
        } else {
          setInfo("إن كان هذا البريد مسجّلًا عندنا فستصلك رسالة برابط تعيين كلمة مرور جديدة خلال دقائق. تحقق أيضًا من مجلد الرسائل غير المرغوبة.");
        }
        return;
      }
      if (mode === "signup") {
        track("signup_submit");
        const { data, error } = await supabase.auth.signUp({
          email, password,
          /* فارغ لا يعني «أرفض الذكر»: القائمة لا تحوي خيار التخطي أصلًا.
             فإن لم يختر شيئًا، الاستنتاج خيرٌ من «لم يُذكر». */
          options: { data: { name, signup_source: source || inferred || "skip" } },
        });
        if (error) throw error;

        /**
         * حين يكون «Confirm email» مُعطَّلًا في Supabase تُنشأ جلسة فورًا
         * ولا يُرسل أي بريد. عرض «تحقق من بريدك» هنا كان يوقف المستخدم
         * أمام رسالة لن تصل أبدًا رغم أن حسابه جاهز — فيغادر.
         * لذا: إن وُجدت جلسة، ادخل به مباشرةً. وإن لم توجد (أي التأكيد
         * مُفعَّل) فأبقِ رسالة البريد كما هي. الفرعان يعملان في الحالتين
         * فلا ينكسر شيء إن غُيّر الإعداد لاحقًا.
         */
        if (data.session) {
          await syncSource();
          setLeaving(true);
          window.location.assign(next);
          return;
        }

        setInfo("تم إنشاء الحساب. تحقق من بريدك لتفعيله ثم سجّل الدخول.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await syncSource();
        /**
         * تنقّل صلب مقصود بدل router.push + router.refresh.
         * السبب: الاثنان معًا يتسابقان — refresh يُلغي التنقّل الجاري أحيانًا
         * فيبقى المستخدم على صفحة الدخول رغم نجاحها، كما أن ذاكرة موجّه
         * App Router قد تُعيد نسخة /dashboard المخزّنة من قبل الدخول
         * (وهي إعادة توجيه إلى /login). التحميل الكامل يجعل الخادم يقرأ
         * كوكي الجلسة الجديد ويبني الصفحة من جديد — بلا ذاكرة وبلا سباق.
         */
        setLeaving(true);
        window.location.assign(next);
        return;   // finally أدناه لا يُفعّل الزر لأن leaving بقيت true
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      /* لا تصل رسالة إنجليزية خام للمستخدم: أول انطباع بلغة لا يفهمها
         يُفقد الثقة. نترجم الحالات الشائعة، وما عداها رسالة عربية مع
         وسيلة تواصل — والنص الأصلي في سجل المتصفح للتشخيص. */
      console.error("Watheq auth error:", msg);
      if (/Invalid login/i.test(msg)) setError("بريد أو كلمة مرور غير صحيحة.");
      else if (/already registered/i.test(msg)) setError("هذا البريد مسجّل مسبقًا — سجّل الدخول، أو اضغط «نسيت كلمة المرور».");
      else if (/Password should/i.test(msg)) setError("كلمة المرور قصيرة — استخدم 6 أحرف على الأقل.");
      else if (/Email not confirmed/i.test(msg)) setError("لم يُفعّل بريدك بعد — افتح رسالة التفعيل في بريدك (وتحقق من مجلد الرسائل غير المرغوبة).");
      else if (/rate limit|after \d+ seconds|too many/i.test(msg)) setError("محاولات كثيرة متتابعة — انتظر دقيقة ثم أعد المحاولة.");
      else if (/network|fetch failed|Failed to fetch/i.test(msg)) setError("تعذّر الاتصال — تحقّق من الإنترنت وأعد المحاولة.");
      else if (/User not found/i.test(msg)) setError("لا يوجد حساب بهذا البريد — أنشئ حسابًا جديدًا.");
      else setError("تعذّر إتمام العملية. أعد المحاولة، وإن تكرر راسلنا على واتساب 0596300591 ونساعدك فورًا.");
    } finally {
      setLoading(false);   // leaving يبقي الزر معطّلًا حتى تُغادر الصفحة
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-paper">
      <div className="w-full max-w-md bg-white border border-line rounded-2xl shadow-lg p-8">
        <a href="https://watheqapp.com" className="flex items-center gap-3 mb-6 hover:opacity-90" title="العودة إلى موقع وثيق">
          <div className="w-10 h-10 rounded-lg bg-deep grid place-items-center text-goldSoft font-bold font-display">و</div>
          <div>
            <div className="font-bold font-display text-deep text-lg">وثيق</div>
            <div className="text-xs text-muted">لوحة التحكم</div>
          </div>
        </a>

        <h1 className="font-display text-2xl font-bold text-deep mb-1">
          {mode === "signin" ? "تسجيل الدخول" : mode === "signup" ? "إنشاء حساب جديد" : "استعادة كلمة المرور"}
        </h1>
        <p className="text-sm text-muted mb-5">
          {mode === "signin" ? "أدخل بريدك وكلمة المرور."
            : mode === "signup" ? "أنشئ حسابك المجاني لإدارة جمعياتك أو عقاراتك."
            : "أدخل بريدك المسجَّل وسنرسل لك رابط تعيين كلمة مرور جديدة."}
        </p>

        {/* الدخول بقوقل أولًا وأكبر: يحذف حقلين من طريق زائر بارد */}
        {mode !== "forgot" && (<>
        <button type="button" onClick={signInWithGoogle} disabled={googleLoading || leaving}
          className="w-full flex items-center justify-center gap-3 border border-line rounded-xl
                     bg-white hover:bg-paper2 transition px-4 py-3 font-semibold text-deep
                     disabled:opacity-60 mb-4">
          <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z"/>
            <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z"/>
            <path fill="#FBBC05" d="M11.6 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.3C2.8 17.2 2 20.5 2 24s.8 6.8 2.3 9.8l7.3-5.7z"/>
            <path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C34.9 4.2 30 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.3 5.7c1.7-5.2 6.6-9.1 12.4-9.1z"/>
          </svg>
          {googleLoading ? "جارٍ التحويل…" : "المتابعة بحساب قوقل"}
        </button>

        <div className="flex items-center gap-3 mb-4 text-xs text-muted">
          <span className="h-px bg-line flex-1" />
          أو بالبريد الإلكتروني
          <span className="h-px bg-line flex-1" />
        </div>
        </>)}

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <div>
              <label className="block text-sm font-semibold mb-1">اسمك</label>
              <input className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="عبيد الحربي" required />
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold mb-1">البريد الإلكتروني</label>
            <input className="fld" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          {mode !== "forgot" && (
            <div>
              <label className="block text-sm font-semibold mb-1">كلمة المرور</label>
              <input className="fld" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="٦ أحرف على الأقل" required minLength={6} />
              {mode === "signin" && (
                <div className="text-left mt-1">
                  <button type="button" className="text-xs text-muted hover:text-gold font-semibold"
                    onClick={() => { setMode("forgot"); setError(null); setInfo(null); }}>
                    نسيت كلمة المرور؟
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === "signup" && (
            <div>
              <label className="block text-sm font-semibold mb-1">
                كيف عرفت عن وثيق؟ <span className="text-muted font-normal text-xs">— اختياري</span>
              </label>
              {/* غير إلزامي عمدًا: حقل رابع مطلوب على زائر بارد يوقف التسجيل،
                  وفائدته لنا لا له. الفارغ يُحفظ "skip" كما كان. */}
              <select className="fld" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">أفضّل عدم الذكر</option>
                {CHOSEN_SOURCES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                {/* مصدر جاء من رابط حملة (مثل demo) — يُعرض ولا يُختار يدويًّا */}
                {source && !CHOSEN_SOURCES.some((s) => s.v === source) && (
                  <option value={source}>{sourceLabel(source)}</option>
                )}
              </select>
            </div>
          )}

          {error && <div className="text-sm text-late bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2.5">{error}</div>}
          {info && <div className="text-sm text-[#137a50] bg-[#E6F4EC] border border-[#B7DFC7] rounded-lg p-2.5">{info}</div>}

          <button type="submit" disabled={loading || leaving} className="btn btn-gold w-full justify-center mt-2">
            {leaving ? "جارٍ فتح لوحتك…" : loading ? "..." : mode === "signin" ? "دخول" : mode === "signup" ? "إنشاء الحساب" : "إرسال رابط الاستعادة"}
          </button>
        </form>

        <div className="text-center mt-5 text-sm">
          {mode === "signin" ? (
            <>ما عندك حساب؟ <button className="text-gold font-semibold" onClick={() => { setMode("signup"); setError(null); }}>أنشئ واحدًا</button></>
          ) : mode === "signup" ? (
            <>لديك حساب؟ <button className="text-gold font-semibold" onClick={() => { setMode("signin"); setError(null); }}>سجّل الدخول</button></>
          ) : (
            <>تذكرتها؟ <button className="text-gold font-semibold" onClick={() => { setMode("signin"); setError(null); setInfo(null); }}>سجّل الدخول</button></>
          )}
        </div>
        <div className="text-center mt-4 pt-4 border-t border-line text-sm">
          <a href="https://watheqapp.com" className="text-muted hover:text-deep">← العودة إلى موقع وثيق</a>
        </div>
      </div>
    </div>
  );
}
