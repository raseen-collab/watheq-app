"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-client";

/** مصادر التسجيل — يختارها المستخدم بنفسه، بلا كوكيز ولا تتبّع */
const SOURCES: { v: string; l: string }[] = [
  { v: "haraj", l: "حراج" },
  { v: "group", l: "قروب واتساب أو تليجرام" },
  { v: "twitter", l: "تويتر / X" },
  { v: "search", l: "بحث في جوجل" },
  { v: "referral", l: "توصية من شخص" },
  { v: "direct", l: "تواصل مباشر معكم" },
  { v: "other", l: "مصدر آخر" },
  { v: "skip", l: "أفضّل عدم الذكر" },
];
const sourceLabel = (v?: string | null) => SOURCES.find((s) => s.v === v)?.l || "—";

/**
 * تنظيف وجهة ما بعد الدخول.
 * يقبل المسارات الداخلية فقط — يمنع `?next=https://…` من نقل المستخدم
 * إلى موقع خارجي بعد تسجيل دخول ناجح (ثغرة إعادة توجيه مفتوحة).
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/")) return "/dashboard";   // روابط مطلقة أو نسبية غريبة
  if (raw.startsWith("//")) return "/dashboard";   // //evil.com يُقرأ كنطاق خارجي
  if (raw.startsWith("/\\")) return "/dashboard";
  return raw;
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
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // يبقى true بعد نجاح الدخول حتى تُغادر الصفحة — فلا يعود الزر قابلًا للضغط
  const [leaving, setLeaving] = useState(false);

  // يقبل ?src=twitter من روابط الحملات فيملأ الحقل تلقائيًّا
  useEffect(() => {
    const s = searchParams.get("src");
    if (s && SOURCES.some((x) => x.v === s)) setSource(s);
    if (searchParams.get("mode") === "signup") setMode("signup");
  }, [searchParams]);

  /**
   * ينقل مصدر التسجيل من بيانات الحساب إلى الملف الشخصي عند أول دخول.
   * سبب التأجيل: عند إنشاء الحساب لا توجد جلسة بعد (يلزم تفعيل البريد)،
   * فلا يمكن الكتابة في profiles إلا بعد أول تسجيل دخول ناجح.
   * ويُكتب مرة واحدة فقط — لا يُستبدل إن كان محفوظًا.
   */
  async function syncSource(supabase: ReturnType<typeof createClient>) {
    try {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      const src = (u?.user_metadata as any)?.signup_source;
      if (!u || !src) return;
      await supabase.from("profiles")
        .update({ signup_source: src })
        .eq("id", u.id)
        .is("signup_source", null);
    } catch {
      /* لا يُعطّل الدخول إن فشل */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name, signup_source: source || "skip" } },
        });
        if (error) throw error;
        setInfo("تم إنشاء الحساب. تحقق من بريدك لتفعيله ثم سجّل الدخول.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await syncSource(supabase);
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
      if (msg.includes("Invalid login")) setError("بريد أو كلمة مرور غير صحيحة.");
      else if (msg.includes("already registered")) setError("هذا البريد مسجّل مسبقًا — سجّل الدخول.");
      else if (msg.includes("Password should")) setError("كلمة المرور قصيرة — استخدم 6 أحرف على الأقل.");
      else setError(msg);
    } finally {
      setLoading(false);   // leaving يبقي الزر معطّلًا حتى تُغادر الصفحة
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-paper">
      <div className="w-full max-w-md bg-white border border-line rounded-2xl shadow-lg p-8">
        <a href="https://watheqapp.netlify.app" className="flex items-center gap-3 mb-6 hover:opacity-90" title="العودة إلى موقع وثيق">
          <div className="w-10 h-10 rounded-lg bg-deep grid place-items-center text-goldSoft font-bold font-display">و</div>
          <div>
            <div className="font-bold font-display text-deep text-lg">وثيق</div>
            <div className="text-xs text-muted">لوحة التحكم</div>
          </div>
        </a>

        <h1 className="font-display text-2xl font-bold text-deep mb-1">{mode === "signin" ? "تسجيل الدخول" : "إنشاء حساب جديد"}</h1>
        <p className="text-sm text-muted mb-5">{mode === "signin" ? "أدخل بريدك وكلمة المرور." : "أنشئ حسابك المجاني لإدارة جمعياتك أو عقاراتك."}</p>

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
          <div>
            <label className="block text-sm font-semibold mb-1">كلمة المرور</label>
            <input className="fld" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="٦ أحرف على الأقل" required minLength={6} />
          </div>

          {mode === "signup" && (
            <div>
              <label className="block text-sm font-semibold mb-1">
                كيف عرفت عن وثيق؟ <span className="text-muted font-normal text-xs">— يساعدنا نعرف أين نكون</span>
              </label>
              <select className="fld" value={source} onChange={(e) => setSource(e.target.value)} required>
                <option value="" disabled>اختر…</option>
                {SOURCES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>
          )}

          {error && <div className="text-sm text-late bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2.5">{error}</div>}
          {info && <div className="text-sm text-[#137a50] bg-[#E6F4EC] border border-[#B7DFC7] rounded-lg p-2.5">{info}</div>}

          <button type="submit" disabled={loading || leaving} className="btn btn-gold w-full justify-center mt-2">
            {leaving ? "جارٍ فتح لوحتك…" : loading ? "..." : mode === "signin" ? "دخول" : "إنشاء الحساب"}
          </button>
        </form>

        <div className="text-center mt-5 text-sm">
          {mode === "signin" ? (
            <>ما عندك حساب؟ <button className="text-gold font-semibold" onClick={() => { setMode("signup"); setError(null); }}>أنشئ واحدًا</button></>
          ) : (
            <>لديك حساب؟ <button className="text-gold font-semibold" onClick={() => { setMode("signin"); setError(null); }}>سجّل الدخول</button></>
          )}
        </div>
        <div className="text-center mt-4 pt-4 border-t border-line text-sm">
          <a href="https://watheqapp.netlify.app" className="text-muted hover:text-deep">← العودة إلى موقع وثيق</a>
        </div>
      </div>
    </div>
  );
}
