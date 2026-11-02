"use client";
/**
 * 📝 اتفاق سعي من صفحة واحدة (2 نوفمبر 2026)
 * المسوّق يختار من يدفع والمدة والحصرية — والباقي من بيانات المعروض — ثم يطبع
 * أو يحفظ PDF ليوقّعه المالك. لا شيء يُحفظ في القاعدة: الورقة هي الناتج.
 */
import { useState } from "react";
import Icon from "@/components/Icon";
import { openDoc, commissionAgreementHTML, type CommissionTerms } from "@/lib/documents";
import { today } from "@/lib/utils";
import type { Listing } from "@/lib/listings";

const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function CommissionAgreementModal({ listing, orgName, issuer, onClose }: {
  listing: Listing; orgName?: string | null; issuer?: any; onClose: () => void;
}) {
  const [t, setT] = useState<CommissionTerms>({ payer: "owner", exclusive: false, start: today(), end: plusDays(90), note: "" });
  const pct = Number(listing.commission_pct) > 0 ? Number(listing.commission_pct) : null;
  const rent = listing.offer_type === "rent";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl border border-line shadow-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="font-display font-bold text-deep text-lg inline-flex items-center gap-2"><Icon name="doc" size={20} /> اتفاق سعي — {listing.code}</h3>
            <p className="text-xs text-muted leading-relaxed mt-1">صفحة واحدة يوقّعها المالك قبل العرض: النسبة، من يدفع، المدة، والحصرية. أكثر نزاعات السعي سببها اتفاق شفهي.</p>
          </div>
          <button className="btn btn-ghost text-sm shrink-0" onClick={onClose}>إغلاق</button>
        </div>

        {!pct && (
          <div className="mt-3 text-xs bg-[#FDF6E3] border border-[#EAD9A8] text-[#7a5c12] rounded-xl p-3 leading-relaxed">
            لم تسجّل نسبة السعي في المعروض — ستُطبع الورقة بخانة فارغة «____ %». الأفضل: «تعديل» المعروض وسجّل النسبة أولًا.
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <span className="block text-sm font-semibold mb-1">من يدفع السعي؟</span>
            <div className="grid grid-cols-3 gap-2">
              {([["owner", rent ? "المؤجّر" : "البائع"], ["buyer", rent ? "المستأجر" : "المشتري"], ["split", "مناصفة"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setT({ ...t, payer: v })} aria-pressed={t.payer === v}
                  className={`border-2 rounded-lg min-h-[40px] text-xs font-semibold transition ${t.payer === v ? "border-gold bg-[#FBF1DF]" : "border-line bg-white hover:border-goldSoft"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-sm font-semibold mb-1">الحصرية</span>
            <div className="grid grid-cols-2 gap-2">
              {([[false, "غير حصري — يحق للمالك وسطاء آخرون"], [true, "حصري — لا وسيط غيرك خلال المدة"]] as const).map(([v, l]) => (
                <button key={String(v)} type="button" onClick={() => setT({ ...t, exclusive: v })} aria-pressed={t.exclusive === v}
                  className={`border-2 rounded-lg min-h-[44px] px-2 text-xs font-semibold transition ${t.exclusive === v ? "border-gold bg-[#FBF1DF]" : "border-line bg-white hover:border-goldSoft"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="block text-sm font-semibold mb-1">من</span>
              <input type="date" className="fld text-sm" value={t.start} onChange={(e) => setT({ ...t, start: e.target.value })} /></label>
            <label className="block"><span className="block text-sm font-semibold mb-1">إلى <span className="text-muted font-normal text-xs">— 90 يومًا افتراضًا</span></span>
              <input type="date" className="fld text-sm" value={t.end} min={t.start} onChange={(e) => setT({ ...t, end: e.target.value })} /></label>
          </div>
          <label className="block"><span className="block text-sm font-semibold mb-1">شروط إضافية <span className="text-muted font-normal text-xs">— اختياري</span></span>
            <input className="fld text-sm" value={t.note || ""} maxLength={300} onChange={(e) => setT({ ...t, note: e.target.value })} placeholder="مثال: السعي يُدفع عند الإفراغ · تشمل المدة التمديد بموافقة الطرفين" /></label>
        </div>

        <div className="flex items-center justify-between gap-2 mt-4 flex-wrap">
          <span className="text-[11px] text-muted leading-relaxed max-w-[60%]">ملحق تنظيمي — لا يغني عن توثيق عقد الوساطة في منصة الهيئة.</span>
          <button className="btn btn-gold text-sm" disabled={!t.start || !t.end || t.end < t.start}
            onClick={() => openDoc(commissionAgreementHTML(listing, { ...t, note: (t.note || "").trim() || null }, orgName || "", issuer || {}))}>
            <Icon name="print" size={15} /> طباعة / حفظ PDF
          </button>
        </div>
      </div>
    </div>
  );
}
