"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-client";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-muted">جارٍ التحميل…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name } },
        });
        if (error) throw error;
        setInfo("تم إنشاء الحساب. تحقق من بريدك لتفعيله ثم سجّل الدخول.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("Invalid login")) setError("بريد أو كلمة مرور غير صحيحة.");
      else if (msg.includes("already registered")) setError("هذا البريد مسجّل مسبقًا — سجّل الدخول.");
      else if (msg.includes("Password should")) setError("كلمة المرور قصيرة — استخدم 6 أحرف على الأقل.");
      else setError(msg);
    } finally {
      setLoading(false);
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

          {error && <div className="text-sm text-late bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2.5">{error}</div>}
          {info && <div className="text-sm text-[#137a50] bg-[#E6F4EC] border border-[#B7DFC7] rounded-lg p-2.5">{info}</div>}

          <button type="submit" disabled={loading} className="btn btn-gold w-full justify-center mt-2">
            {loading ? "..." : mode === "signin" ? "دخول" : "إنشاء الحساب"}
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
