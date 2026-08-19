"use client";
/**
 * 🔑 تعيين كلمة مرور جديدة — وجهة رابط الاستعادة من البريد.
 *
 * التدفق: بريد Supabase → /auth/callback (يبادل الرمز بجلسة مؤقتة)
 * → هذه الصفحة. وجود الجلسة هو إثبات ملكية البريد، لذا:
 *  - بلا جلسة: لا نعرض النموذج أصلًا، بل رسالة «الرابط منتهٍ» وطريق العودة.
 *  - بجلسة: حقلا كلمة المرور والتأكيد → updateUser → دخول مباشر للوحة.
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-client";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setHasSession(!!data.user);
      setChecking(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mismatch = pw2.length > 0 && pw1 !== pw2;
  const ready = pw1.length >= 6 && pw1 === pw2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null); setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      // نجاح: الجلسة قائمة أصلًا — تنقّل صلب للوحة (نفس درس صفحة الدخول)
      setLeaving(true);
      window.location.assign("/dashboard");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("Password should")) setError("كلمة المرور قصيرة — استخدم 6 أحرف على الأقل.");
      else if (/different from the old|same password/i.test(msg)) setError("الكلمة الجديدة مطابقة للقديمة — اختر غيرها.");
      else setError(msg);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-paper">
      <div className="w-full max-w-md bg-white border border-line rounded-2xl shadow-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-deep grid place-items-center text-goldSoft font-bold font-display">و</div>
          <div>
            <div className="font-bold font-display text-deep text-lg">وثيق</div>
            <div className="text-xs text-muted">تعيين كلمة مرور جديدة</div>
          </div>
        </div>

        {checking ? (
          <p className="text-sm text-muted">جارٍ التحقق من الرابط…</p>
        ) : !hasSession ? (
          <div>
            <h1 className="font-display text-xl font-bold text-deep mb-2">🔒 هذا الرابط لم يعد صالحًا</h1>
            <p className="text-sm text-muted leading-relaxed mb-5">
              روابط الاستعادة مؤقتة وتُستخدم مرة واحدة، ويجب فتحها في نفس المتصفح الذي طلبتها منه.
              اطلب رابطًا جديدًا من صفحة الدخول عبر «نسيت كلمة المرور؟».
            </p>
            <a href="/login" className="btn btn-gold w-full justify-center">العودة لصفحة الدخول</a>
          </div>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold text-deep mb-1">اختر كلمة مرور جديدة</h1>
            <p className="text-sm text-muted mb-5">تم التحقق من بريدك — اكتب كلمتك الجديدة وستدخل لوحتك مباشرة.</p>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold mb-1">كلمة المرور الجديدة</label>
                <input className="fld" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
                  placeholder="٦ أحرف على الأقل" required minLength={6} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">أعدها للتأكيد</label>
                <input className="fld" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6} />
                {mismatch && <p className="text-xs text-late mt-1">الكلمتان غير متطابقتين.</p>}
              </div>
              {error && <div className="text-sm text-late bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2.5">{error}</div>}
              <button type="submit" disabled={!ready || loading || leaving} className="btn btn-gold w-full justify-center mt-2">
                {leaving ? "جارٍ فتح لوحتك…" : loading ? "..." : "حفظ والدخول"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
