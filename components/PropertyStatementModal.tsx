"use client";
// ============================================================
// وثيق — كشف حساب العقار: اختيار الفترة
//
// الكشف كان يعرض الحالة اللحظية فقط. المالك والمكتب يحتاجان أيضًا فترة
// محددة: هذا الشهر، الربع، السنة، أو من تاريخ إلى تاريخ — ليقارنوا ما
// حُصّل فعلًا في المدة بما كان متوقعًا فيها.
//
// «حتى اليوم» خيار صريح: من بداية العقود إلى تاريخ اليوم — لمن يريد
// الصورة التراكمية كاملة لا شهرًا بعينه.
// ============================================================

import { useMemo, useState } from "react";
import DateField from "@/components/DateField";
import { hijriText } from "@/lib/hijri";

export type StatementPeriod = { from: string; to: string; label: string } | null;

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const monthName = (isoDate: string) => {
  const [y, m] = isoDate.split("-").map(Number);
  return `${AR_MONTHS[(m || 1) - 1]} ${y}`;
};

export default function PropertyStatementModal({ propertyName, onClose, onIssue }: {
  propertyName: string;
  onClose: () => void;
  onIssue: (mode: "brief" | "full", period: StatementPeriod) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<"none" | "month" | "quarter" | "half" | "year" | "all" | "custom">("month");
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [mode, setMode] = useState<"brief" | "full">("full");

  function applyPreset(k: typeof preset) {
    setPreset(k);
    const now = new Date();
    if (k === "month") { setFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(iso(now)); }
    else if (k === "quarter") { setFrom(iso(new Date(now.getFullYear(), now.getMonth() - 2, 1))); setTo(iso(now)); }
    else if (k === "half") { setFrom(iso(new Date(now.getFullYear(), now.getMonth() - 5, 1))); setTo(iso(now)); }
    else if (k === "year") { setFrom(`${now.getFullYear()}-01-01`); setTo(iso(now)); }
    else if (k === "all") { setFrom("2000-01-01"); setTo(iso(now)); }
  }

  const label = preset === "none" ? ""
    : preset === "all" ? "منذ البداية حتى اليوم"
    : preset === "month" ? monthName(from)
    : preset === "year" ? `سنة ${from.slice(0, 4)}`
    : `${monthName(from)} — ${monthName(to)}`;

  const period: StatementPeriod = preset === "none" ? null : { from, to, label };
  const invalid = preset !== "none" && from > to;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-lg mb-1">كشف حساب {propertyName}</h3>
        <p className="text-xs text-muted mb-4">اختر الفترة ومستوى التفصيل — أو أصدره بالحالة اللحظية بلا فترة.</p>

        <label className="block text-sm font-semibold mb-1.5">الفترة</label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {([["none", "الحالة اللحظية"], ["month", "هذا الشهر"], ["quarter", "آخر 3 أشهر"],
             ["half", "آخر 6 أشهر"], ["year", "هذه السنة"], ["all", "منذ البداية حتى اليوم"],
             ["custom", "من — إلى"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => (k === "custom" ? setPreset("custom") : applyPreset(k))}
              className={`text-xs px-3 py-1.5 rounded-full border ${preset === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>{l}</button>
          ))}
        </div>

        {/* الحقلان يقبلان الهجري والميلادي: التصفية بالميلادي (تاريخ قبض النقد
            وأساس الإقرار الضريبي)، ومن يفكّر بالهجري يُدخله ويُحوَّل تلقائيًّا. */}
        {preset !== "none" && (
          <div className="grid grid-cols-2 gap-3 mb-1">
            <div>
              <span className="block text-xs text-muted mb-1">من تاريخ</span>
              <DateField value={from} onChange={(v) => { if (v) { setFrom(v); setPreset("custom"); } }} />
            </div>
            <div>
              <span className="block text-xs text-muted mb-1">إلى تاريخ</span>
              <DateField value={to} onChange={(v) => { if (v) { setTo(v); setPreset("custom"); } }} />
            </div>
          </div>
        )}
        {invalid && <p className="text-xs text-late mb-2">تاريخ البداية بعد تاريخ النهاية.</p>}
        {preset !== "none" && !invalid && (
          <p className="text-[11px] text-muted mb-3">
            سيصدر الكشف عن: <b className="text-deep">{label}</b>
            <span className="block">من {from} ({hijriText(from)}) إلى {to} ({hijriText(to)})</span>
          </p>
        )}

        <label className="block text-sm font-semibold mb-1.5">مستوى التفصيل</label>
        <div className="inline-flex border border-line rounded-lg p-0.5 text-xs mb-2">
          <button type="button" onClick={() => setMode("full")} className={`px-3 py-1.5 rounded-md ${mode === "full" ? "bg-deep text-goldSoft" : "text-muted"}`}>شامل</button>
          <button type="button" onClick={() => setMode("brief")} className={`px-3 py-1.5 rounded-md ${mode === "brief" ? "bg-deep text-goldSoft" : "text-muted"}`}>مختصر</button>
        </div>
        <p className="text-[11px] text-muted mb-4">
          {mode === "full"
            ? "الشامل: بيانات العقار ومواصفات كل وحدة وعقودها وعدّاداتها، والدخل وتوزيع الحالات — ومع الفترة: المحصَّل والمصروفات وتفصيل الدفعات."
            : "المختصر: الملخص وجدول الوحدات بحالتها — ومع الفترة: إجمالي المحصَّل فيها."}
        </p>

        <div className="flex gap-2">
          <button className="btn btn-gold flex-1 justify-center" disabled={invalid} onClick={() => onIssue(mode, period)}>إصدار الكشف</button>
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
