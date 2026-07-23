"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";

export default function OnboardingPage() {
  const router = useRouter();
  const [role, setRole] = useState<"association" | "property" | null>(null);
  const [orgName, setOrgName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!role) return;
    setSaving(true); setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, role, org_name: orgName || null }, { onConflict: "id" });

    if (error) { setError(error.message); setSaving(false); return; }
    router.push(role === "property" ? "/dashboard/property" : "/dashboard/association");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-paper p-4 grid place-items-center">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-deep grid place-items-center text-goldSoft font-bold font-display text-xl mx-auto mb-4">و</div>
          <h1 className="font-display text-2xl font-bold text-deep">أهلًا بك في وثيق 🌿</h1>
          <p className="text-muted mt-2">اختر ما تديره — ستُهيَّأ لوحة التحكم لتناسبك تمامًا.</p>
          <div className="inline-block mt-3 text-sm bg-[#E6F4EC] text-[#137a50] border border-[#B7DFC7] rounded-full px-4 py-1.5 font-semibold">
            🎁 تجربة مجانية ٣٠ يومًا — كل المزايا، بلا بطاقة
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <RoleCard
            selected={role === "property"}
            onClick={() => setRole("property")}
            icon="🏢"
            title="أدير أملاكًا وعقارات"
            desc="مالك عقار أو مكتب إدارة أملاك"
            points={["عمائر، معارض، مكاتب، مستودعات، أراضٍ", "تحصيل الإيجارات وتتبّع العقود", "نماذج إشعارات وإنذارات جاهزة"]}
          />
          <RoleCard
            selected={role === "association"}
            onClick={() => setRole("association")}
            icon="🏗️"
            title="أدير جمعية ملاك"
            desc="مدير اتحاد ملاك أو عضو مجلس"
            points={["محاضر وموازنات جاهزة", "اشتراكات الصيانة وحالة السداد", "تنبيه انتهاء شهادة الجمعية"]}
          />
        </div>

        {role && (
          <div className="mt-6 bg-white border border-line rounded-2xl p-5">
            <label className="block text-sm font-semibold mb-2">
              {role === "property" ? "اسم المكتب أو المالك (يظهر في الإشعارات)" : "اسم الجمعية أو العمارة"}
              <span className="text-muted font-normal"> — اختياري</span>
            </label>
            <input
              className="fld"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder={role === "property" ? "مكتب اليمامة لإدارة الأملاك" : "جمعية ملاك عمارة النرجس"}
            />
          </div>
        )}

        {error && <div className="mt-4 text-sm text-late bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-3">{error}</div>}

        <button
          onClick={save}
          disabled={!role || saving}
          className="btn btn-gold w-full justify-center mt-6 disabled:opacity-40"
        >
          {saving ? "..." : "ابدأ الآن ←"}
        </button>

        <p className="text-center text-xs text-muted mt-4">
          يمكنك تغيير هذا لاحقًا من الإعدادات.
        </p>
      </div>
    </div>
  );
}

function RoleCard({ selected, onClick, icon, title, desc, points }: {
  selected: boolean; onClick: () => void; icon: string; title: string; desc: string; points: string[];
}) {
  return (
    <button
      onClick={onClick}
      className={`text-right bg-white border-2 rounded-2xl p-6 transition-all ${
        selected ? "border-gold shadow-lg scale-[1.01]" : "border-line hover:border-goldSoft"
      }`}
    >
      <div className="text-3xl mb-3">{icon}</div>
      <div className="font-display font-bold text-lg text-deep">{title}</div>
      <div className="text-sm text-muted mb-3">{desc}</div>
      <ul className="space-y-1.5">
        {points.map((p) => (
          <li key={p} className="flex gap-2 text-sm text-[#33413d]">
            <span className="text-paid font-bold">✓</span> {p}
          </li>
        ))}
      </ul>
    </button>
  );
}
