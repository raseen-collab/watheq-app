"use client";
// ============================================================
// وثيق — مؤلّف الإعلانات (حراج · X · واتساب) من بطاقة المعروض
//
// لماذا نافذة لا صفحة: الإعلان يُكتب لحظة الحاجة من السجل نفسه،
// وبيانات المعروض كلها موجودة أصلًا — فلا يُعاد إدخال شيء.
//
// بوابة الترخيص: النظام يوجب إبراز رقم ترخيص الإعلان ورخصة فال.
// النص لا يُعرض ولا يُنسخ قبلهما — والقرار في lib/ads (adReady)
// لا هنا، حتى لا يلتفّ عليه تعديل واجهة لاحق. رخصة فال تُجلب
// تلقائيًّا من سجل الالتزامات إن سُجّلت هناك، وتراخيص الإعلانات
// تُعرض قائمةً للاختيار — والحقلان يقبلان الكتابة اليدوية دائمًا.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { adReady, harajAd, waShareUrl, whatsappAd, xAd, xIntentUrl, type AdOffice } from "@/lib/ads";
import type { Listing } from "@/lib/listings";

type Platform = "haraj" | "x" | "whatsapp";

const TABS: { v: Platform; label: string }[] = [
  { v: "haraj", label: "حراج" },
  { v: "x", label: "X (تويتر)" },
  { v: "whatsapp", label: "واتساب" },
];

export default function AdComposer({ listing, orgName, phone, onClose }: {
  listing: Listing;
  orgName?: string | null;
  phone?: string | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Platform>("haraj");
  const [fal, setFal] = useState("");
  const [adLic, setAdLic] = useState("");
  const [adOptions, setAdOptions] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  /**
   * جلب واحد عند الفتح: رخصة فال (أحدث بند ref_no من نوعها) تُملأ
   * تلقائيًّا، وأرقام تراخيص الإعلانات تصير datalist. فشل الجلب لا
   * يعطّل شيئًا — يكتب المستخدم الرقمين بيده كما لو لم توجد الميزة.
   */
  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("compliance_items")
          .select("kind, ref_no")
          .in("kind", ["fal_license", "ad_license"])
          .not("ref_no", "is", null)
          .order("created_at", { ascending: false });
        const rows = (data || []) as { kind: string; ref_no: string | null }[];
        const f = rows.find((r) => r.kind === "fal_license")?.ref_no;
        if (f) setFal((prev) => prev || f);
        setAdOptions(rows.filter((r) => r.kind === "ad_license" && r.ref_no).map((r) => r.ref_no!));
      } catch { /* الجلب تحسين لا شرط */ }
    })();
  }, []);

  const office: AdOffice = { org_name: orgName, billing_phone: phone, fal_license: fal, ad_license: adLic };
  const gate = adReady(office);

  const text = useMemo(() => {
    if (!gate.ok) return "";
    if (tab === "haraj") { const h = harajAd(listing, office); return `${h.title}\n${"─".repeat(24)}\n${h.body}`; }
    if (tab === "x") return xAd(listing, office);
    return whatsappAd(listing, office);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, fal, adLic, listing, orgName, phone, gate.ok]);

  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what); setTimeout(() => setCopied(null), 1800);
    } catch { /* متصفحات قديمة: التحديد اليدوي من الصندوق يبقى ممكنًا */ }
  }

  const xLen = tab === "x" ? text.length : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl border border-line shadow-xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="font-display font-bold text-deep text-lg">📣 إعلان جاهز — {listing.code}</h3>
            <p className="text-xs text-muted">النص يُبنى من بيانات المعروض المسجّلة. عدّل المعروض نفسه إن أردت تغيير محتواه.</p>
          </div>
          <button className="btn btn-ghost text-sm shrink-0" onClick={onClose}>إغلاق</button>
        </div>

        {/* الترخيصان — شرط لا خيار */}
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="block text-xs font-semibold mb-1">رقم ترخيص الإعلان</label>
            <input className="fld" dir="ltr" list="watheq-ad-lics" value={adLic}
              onChange={(e) => setAdLic(e.target.value)} placeholder="من منصة الهيئة العامة للعقار" />
            <datalist id="watheq-ad-lics">{adOptions.map((o) => <option key={o} value={o} />)}</datalist>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">رقم رخصة فال</label>
            <input className="fld" dir="ltr" value={fal} onChange={(e) => setFal(e.target.value)}
              placeholder="يُملأ من سجل الالتزامات إن وُجد" />
          </div>
        </div>

        {!gate.ok ? (
          <div className="mt-4 text-sm bg-[#FDF6E3] border border-[#EAD9A8] text-[#7a5c12] rounded-xl p-3.5 leading-relaxed">
            <b>الإعلان بلا ترخيص مخالفة على مكتبك.</b> أكمل أولًا:
            <ul className="mt-1.5 space-y-1">{gate.missing.map((m) => <li key={m}>• {m}</li>)}</ul>
            <div className="text-xs mt-2 text-muted">تُصدر تراخيص الإعلانات من منصة الهيئة العامة للعقار، وتُسجَّل في «الالتزامات» لتصلك تنبيهات قبل انتهائها.</div>
          </div>
        ) : (
          <>
            <div className="flex gap-1.5 mt-4 mb-2">
              {TABS.map((t) => (
                <button key={t.v} onClick={() => setTab(t.v)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition ${
                    tab === t.v ? "bg-deep text-goldSoft border-deep" : "bg-white border-line text-deep hover:border-goldSoft"}`}>
                  {t.label}
                </button>
              ))}
            </div>

            <textarea readOnly value={text} rows={Math.min(14, text.split("\n").length + 1)}
              className="fld font-mono text-[13px] leading-relaxed w-full" dir="rtl" />

            <div className="flex flex-wrap items-center gap-2 mt-2">
              {tab === "haraj" && (
                <button className="btn btn-gold text-sm" onClick={() => copy("body", text)}>
                  {copied === "body" ? "✓ نُسخ" : "نسخ الإعلان"}
                </button>
              )}
              {tab === "x" && (<>
                <a className="btn btn-gold text-sm" href={xIntentUrl(text)} target="_blank" rel="noreferrer">فتح X للنشر ←</a>
                <button className="btn btn-ghost text-sm" onClick={() => copy("body", text)}>{copied === "body" ? "✓ نُسخ" : "نسخ"}</button>
                <span className={`text-xs font-semibold ${xLen > 280 ? "text-late" : "text-muted"}`}>{xLen}/280</span>
              </>)}
              {tab === "whatsapp" && (<>
                <a className="btn btn-gold text-sm" href={waShareUrl(text)} target="_blank" rel="noreferrer">فتح واتساب ←</a>
                <button className="btn btn-ghost text-sm" onClick={() => copy("body", text)}>{copied === "body" ? "✓ نُسخ" : "نسخ"}</button>
              </>)}
            </div>

            <p className="text-[11px] text-muted mt-3 leading-relaxed">
              حراج وX لا يتيحان النشر الآلي المباشر — النسخ ثم اللصق هو المسار المتاح نظاميًّا.
              أرفق صور المعروض من زر «📷 الصور» في بطاقته.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
