"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-client";
import { useRouter } from "next/navigation";
import { ACCOUNT_TYPES, normalizeAccountType } from "@/lib/roles";

export default function SettingsView({ profile }: { profile: any }) {
  const supabase = createClient();
  const router = useRouter();
  const [p, setP] = useState<any>({ ...profile, account_type: normalizeAccountType(profile) });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function save() {
    setSaving(true); setMsg(null);
    const { error } = await supabase.from("profiles").update({
      account_type: p.account_type || null,
      org_name: p.org_name || null,
      billing_name: p.billing_name || null,
      billing_phone: p.billing_phone || null,
      cr_number: p.cr_number || null,
      vat_number: p.vat_number || null,
      telegram_chat_id: p.telegram_chat_id || null,
      notify_enabled: p.notify_enabled ?? true,
      notify_days_before: Number(p.notify_days_before) || 5,
    }).eq("id", p.id);
    setSaving(false);
    if (error) { setMsg({ t: "err", m: error.message }); return; }
    setMsg({ t: "ok", m: "تم الحفظ." });
    router.refresh();
  }

  async function testTelegram() {
    if (!p.telegram_chat_id) return setMsg({ t: "err", m: "أدخل معرّف المحادثة أولًا." });
    setTesting(true); setMsg(null);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: p.telegram_chat_id }),
      });
      const d = await res.json();
      setMsg(d.ok ? { t: "ok", m: "أُرسلت رسالة تجريبية — تحقّق من تليجرام." } : { t: "err", m: d.error || "فشل الإرسال" });
    } catch (e: any) {
      setMsg({ t: "err", m: String(e?.message || e) });
    }
    setTesting(false);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="font-display font-bold text-deep text-2xl">الإعدادات</h1>
          <p className="text-muted text-sm">بيانات الفوترة وقناة التنبيهات.</p>
        </div>
        <Link href="/dashboard" className="btn btn-ghost text-sm">← العودة للّوحة</Link>
      </div>

      {msg && (
        <div className={`rounded-xl p-3 mb-5 text-sm ${msg.t === "ok"
          ? "bg-[#E6F4EC] border border-[#B7DFC7] text-[#137a50]"
          : "bg-[#FBE9E7] border border-[#F5C6C2] text-late"}`}>{msg.m}</div>
      )}

      {/* نوع الحساب */}
      <section className="bg-white border border-line rounded-2xl p-6 mb-5">
        <h2 className="font-semibold text-deep text-lg mb-1">👤 نوع الحساب</h2>
        <p className="text-sm text-muted mb-4">يحدّد اللوحة التي تُفتح لك عند الدخول. اختر «الاثنان معًا» لتحصل على لوحتين وتبدّل بينهما.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          {ACCOUNT_TYPES.map((a) => (
            <button key={a.value} onClick={() => setP({ ...p, account_type: a.value })}
              className={`text-right border-2 rounded-xl p-3.5 transition ${
                p.account_type === a.value ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
              <div className="text-xl mb-1.5">{a.icon}</div>
              <div className="font-semibold text-sm text-deep leading-snug">{a.short}</div>
              <div className="text-xs text-muted mt-1 leading-relaxed">{a.desc}</div>
            </button>
          ))}
        </div>
        {p.account_type === "both" && (
          <p className="text-xs text-[#137a50] bg-[#E6F4EC] border border-[#B7DFC7] rounded-lg p-3 mt-3 leading-relaxed">
            🔀 الحساب المزدوج مفعّل — يظهر مبدّل اللوحتين في الشريط العلوي.
          </p>
        )}
      </section>

      {/* تنبيهات تليجرام */}
      <section className="bg-white border border-line rounded-2xl p-6 mb-5">
        <h2 className="font-semibold text-deep text-lg mb-1">📨 تنبيهات تليجرام</h2>
        <p className="text-sm text-muted mb-4">
          ملخّص إداري يومي يصلك على تليجرام: ما يستحق قريبًا، المتأخرات، والعقود المنتهية.
          <b> التنبيهات لك وحدك</b> — رسائل المستأجرين تبقى عبر واتساب منك مباشرة.
        </p>

        <div className="bg-paper border border-line rounded-xl p-4 mb-4 text-sm">
          <div className="font-semibold text-deep mb-2">كيف تربطه في دقيقة؟</div>
          <ol className="text-muted text-xs leading-relaxed space-y-1 list-decimal pr-4">
            <li>افتح تليجرام وابحث عن <b className="text-ink">@userinfobot</b> واضغط Start.</li>
            <li>سيعطيك رقمًا اسمه <b className="text-ink">Id</b> — انسخه.</li>
            <li>الصقه بالأسفل، ثم افتح بوت وثيق واضغط Start ليُسمح له بمراسلتك.</li>
            <li>اضغط «إرسال رسالة تجريبية» للتأكد.</li>
          </ol>
        </div>

        <label className="block mb-3">
          <span className="block text-sm font-semibold mb-1">معرّف المحادثة (Chat ID)</span>
          <input className="fld" value={p.telegram_chat_id || ""} placeholder="123456789"
            onChange={(e) => setP({ ...p, telegram_chat_id: e.target.value })} />
        </label>

        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <label className="block">
            <span className="block text-sm font-semibold mb-1">التنبيه قبل الاستحقاق بـ</span>
            <select className="fld" value={p.notify_days_before ?? 5}
              onChange={(e) => setP({ ...p, notify_days_before: e.target.value })}>
              {[1, 3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} أيام</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 mt-6">
            <input type="checkbox" className="w-4 h-4" checked={p.notify_enabled ?? true}
              onChange={(e) => setP({ ...p, notify_enabled: e.target.checked })} />
            <span className="text-sm font-semibold">تفعيل الملخّص اليومي</span>
          </label>
        </div>

        <button onClick={testTelegram} disabled={testing} className="btn btn-ghost text-sm">
          {testing ? "..." : "إرسال رسالة تجريبية"}
        </button>
      </section>

      {/* بيانات الفوترة */}
      <section className="bg-white border border-line rounded-2xl p-6 mb-5">
        <h2 className="font-semibold text-deep text-lg mb-1">🧾 بيانات الفوترة</h2>
        <p className="text-sm text-muted mb-4">تظهر في كشوف الحساب والفواتير التي تُصدرها.</p>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-sm font-semibold mb-1">اسم المنشأة أو المالك</span>
            <input className="fld" value={p.billing_name || ""} placeholder="مكتب اليمامة لإدارة الأملاك"
              onChange={(e) => setP({ ...p, billing_name: e.target.value })} />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-semibold mb-1">السجل التجاري <span className="text-muted font-normal text-xs">اختياري</span></span>
              <input className="fld" value={p.cr_number || ""} onChange={(e) => setP({ ...p, cr_number: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-sm font-semibold mb-1">الرقم الضريبي <span className="text-muted font-normal text-xs">اختياري</span></span>
              <input className="fld" value={p.vat_number || ""} onChange={(e) => setP({ ...p, vat_number: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="block text-sm font-semibold mb-1">جوال التواصل</span>
            <input className="fld" value={p.billing_phone || ""} placeholder="05xxxxxxxx"
              onChange={(e) => setP({ ...p, billing_phone: e.target.value })} />
          </label>
        </div>
      </section>

      <button onClick={save} disabled={saving} className="btn btn-gold w-full justify-center">
        {saving ? "..." : "حفظ الإعدادات"}
      </button>

      <p className="text-center text-xs text-muted mt-5 leading-relaxed">
        للدعم: <a href="mailto:watheqdocs@gmail.com" className="text-gold font-semibold">watheqdocs@gmail.com</a>
        {" · "}تليجرام: <a href="https://t.me/+966550165210" target="_blank" rel="noreferrer" className="text-gold font-semibold">+966550165210</a>
      </p>
    </div>
  );
}
