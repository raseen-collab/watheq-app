"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { ACCOUNT_TYPES, defaultDashboard, dashboardPath, type AccountType } from "@/lib/roles";

export default function OnboardingPage() {
  const router = useRouter();
  const [type, setType] = useState<AccountType | null>(null);
  const [orgName, setOrgName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * تطبيع رقم الجوال قبل التحقق: كثيرون يكتبونه بالأرقام العربية (٠٥…)
   * أو بمسافات وشرطات أو بصيغة +966. كلها تُقبل وتُخزَّن بصيغة واحدة
   * 05xxxxxxxx حتى تعمل روابط واتساب (waNumber) وتظهر موحّدة في الفواتير.
   */
  function normalizeSaPhone(raw: string): string {
    const latin = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
                     .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    let d = latin.replace(/\D/g, "");
    if (d.startsWith("966")) d = "0" + d.slice(3);
    else if (d.length === 9 && d.startsWith("5")) d = "0" + d;
    return d;
  }
  const phoneClean = normalizeSaPhone(phone);
  const phoneOk = /^05\d{8}$/.test(phoneClean);

  async function save() {
    if (!type || !phoneOk) return;
    setSaving(true); setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    /**
     * select() بعد upsert مقصود: يجبر القاعدة على إرجاع الصف المكتوب فعلًا.
     * بدونه قد ينجح الطلب شكليًّا دون أن يُحفظ شيء (سياسة RLS مثلًا)،
     * فيعود المستخدم إلى هذه الصفحة نفسها في حلقة لا تنتهي بلا رسالة خطأ.
     */
    const { data: saved, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          account_type: type,
          org_name: orgName || null,
          billing_phone: phoneClean,
          // اسم الفوترة يُملأ من اسم المنشأة إن كان فارغًا — يظهر في الفواتير وكشوف الحساب
          ...(orgName ? { billing_name: orgName } : {}),
        },
        { onConflict: "id" },
      )
      .select("account_type")
      .maybeSingle();

    if (error) { setError(error.message); setSaving(false); return; }
    if (!saved?.account_type) {
      setError("لم يُحفظ نوع الحساب. حدّث الصفحة وحاول مرة أخرى، وإن تكرر راسلنا على watheqdocs@gmail.com");
      setSaving(false);
      return;
    }

    /**
     * تنقّل صلب بدل router.push + router.refresh — الاثنان يتسابقان،
     * وذاكرة موجّه App Router قد تُعيد نسخة اللوحة المخزّنة من قبل الحفظ
     * (وهي حينها إعادة توجيه إلى /onboarding) فتبدو الصفحة عالقة.
     */
    window.location.assign(dashboardPath(defaultDashboard(type)));
  }

  const placeholder =
    type === "hoa_manager" ? "جمعية ملاك عمارة النرجس"
    : type === "landlord" ? "مكتب اليمامة لإدارة الأملاك"
    : "اسم منشأتك أو اسمك";

  return (
    <div className="min-h-screen bg-paper p-4 py-10">
      <div className="w-full max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-deep grid place-items-center text-goldSoft font-bold font-display text-xl mx-auto mb-4">و</div>
          <h1 className="font-display text-2xl font-bold text-deep">أهلًا بك في وثيق 🌿</h1>
          <p className="text-muted mt-2">اختر نوع حسابك — ستُهيَّأ لوحة التحكم لتناسبك تمامًا.</p>
          <div className="inline-block mt-3 text-sm bg-[#E6F4EC] text-[#137a50] border border-[#B7DFC7] rounded-full px-4 py-1.5 font-semibold">
            🎁 تجربة مجانية ٣٠ يومًا — كل المزايا، بلا بطاقة
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {ACCOUNT_TYPES.map((a) => (
            <button key={a.value} onClick={() => setType(a.value)}
              className={`text-right bg-white border-2 rounded-2xl p-5 transition-all flex flex-col ${
                type === a.value ? "border-gold shadow-lg scale-[1.02]" : "border-line hover:border-goldSoft"}`}>
              <div className="text-3xl mb-3">{a.icon}</div>
              <div className="font-display font-bold text-deep">{a.label}</div>
              <div className="text-sm text-muted mb-3">{a.desc}</div>
              <ul className="space-y-1.5 mt-auto">
                {a.points.map((p) => (
                  <li key={p} className="flex gap-2 text-xs text-[#33413d] leading-relaxed">
                    <span className="text-paid font-bold shrink-0">✓</span> {p}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {type && (
          <div className="mt-6 bg-white border border-line rounded-2xl p-5 max-w-xl mx-auto">
            <label className="block text-sm font-semibold mb-2">
              اسم المنشأة أو الجهة <span className="text-muted font-normal">— اختياري، يظهر في الخطابات</span>
            </label>
            <input className="fld" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder={placeholder} />

            {/* جوال التواصل — مطلوب.
                السبب: كان لدينا حسابات لا نملك أي وسيلة للوصول إليها حين تتعثّر،
                فتنتهي تجربتها بصمت. حقل واحد هنا يحلّ ذلك، ومكانه هذه الشاشة
                لا نموذج التسجيل لأن الداخلين بحساب قوقل لا يمرّون بذلك النموذج. */}
            <label className="block text-sm font-semibold mb-2 mt-4">جوال التواصل</label>
            <input
              className="fld"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05xxxxxxxx"
              aria-invalid={phone.length > 0 && !phoneOk}
              required
            />
            <p className="text-xs text-muted mt-1.5">
              {phone.length > 0 && !phoneOk
                ? <span className="text-late font-semibold">أدخل رقمًا سعوديًا يبدأ بـ 05 (عشرة أرقام).</span>
                : "نستخدمه للتواصل معك بخصوص حسابك فقط — ولن يظهر لأي مستخدم آخر."}
            </p>
            {type === "both" && (
              <p className="text-xs text-muted mt-3 bg-paper border border-line rounded-lg p-3 leading-relaxed">
                🔀 بالحساب المزدوج ستحصل على <b>لوحتين منفصلتين</b>، وتبدّل بينهما من الشريط العلوي في أي وقت.
              </p>
            )}
          </div>
        )}

        {error && <div className="mt-4 max-w-xl mx-auto text-sm text-late bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-3">{error}</div>}

        <div className="max-w-xl mx-auto">
          <button onClick={save} disabled={!type || !phoneOk || saving}
            className="btn btn-gold w-full justify-center mt-6 disabled:opacity-40">
            {saving ? "جارٍ التجهيز…" : "ابدأ الآن ←"}
          </button>
          <p className="text-center text-xs text-muted mt-4">يمكنك تغيير نوع حسابك ورقم جوالك لاحقًا من الإعدادات.</p>
        </div>
      </div>
    </div>
  );
}
