"use client";
// ============================================================
// وثيق — دليل الحالات: ماذا تعني كل حالة، وبأرقام هذا المكتب تحديدًا
// موظف جديد يفتحه مرة ويفهم النمط كله — لا شرح شفهي ولا تخمين.
// ============================================================
import { useState } from "react";

export default function StatusLegend({ soonDays, imminentDays, graceDays, scope }: {
  soonDays: number; imminentDays: number; graceDays?: number | null; scope: string;
}) {
  const [open, setOpen] = useState(false);
  const g = Number(graceDays) || 0;
  const rows: { dot: string; name: string; when: string }[] = [
    { dot: "bg-paid", name: "منتظم", when: `لا استحقاق خلال ${soonDays} يومًا القادمة، وكل دفعاته السابقة مسدَّدة.` },
    { dot: "bg-gold", name: "قريب", when: `تبقّى على الاستحقاق ${imminentDays + 1}–${soonDays} يومًا — للمتابعة الهادئة.` },
    { dot: "bg-[#D97706]", name: "مستحق", when: `تبقّى ${imminentDays} أيام أو أقل — وقت التذكير.` },
    { dot: "bg-[#D97706]", name: "يستحق اليوم", when: "اليوم هو يوم الاستحقاق — للمستأجر يومه كاملًا." },
    ...(g > 0 ? [{ dot: "bg-[#8a5a11]", name: "فترة سماح", when: `مرّ يوم الاستحقاق ولم يسدّد، وله ${g} أيام مهلة قبل أن يُعدّ متأخرًا.` }] : []),
    { dot: "bg-late", name: "متأخر", when: g > 0 ? `انتهت المهلة (${g} أيام بعد الاستحقاق) ولم يسدّد.` : "مرّ يوم الاستحقاق ولم يسدّد — يبدأ من اليوم التالي." },
    { dot: "bg-[#EA8C00]", name: "سداد جزئي", when: "سدّد جزءًا من الدفعة المستحقة والباقي متأخر." },
    { dot: "bg-[#7C3AED]", name: "تجديد", when: "العقد ينتهي خلال 60 يومًا — وقت التفاوض على التجديد." },
    { dot: "bg-[#137a50]", name: "✓ مسدَّد كاملًا", when: "سدّد كل دفعات العقد مقدّمًا — القسط القادم مع التجديد." },
    { dot: "bg-[#64748B]", name: "في التنفيذ", when: "أُحيل إلى محكمة التنفيذ — يُتابَع نظاميًّا لا بالتذكير." },
    { dot: "bg-[#94A3B8]", name: "شاغرة", when: "لا مستأجر — لا تدخل في الحسابات ولا التنبيهات." },
  ];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="ماذا تعني الحالات؟"
        className="text-[11px] border border-line rounded-full w-5 h-5 inline-grid place-items-center text-muted hover:text-deep hover:border-deep ms-1 align-middle">?</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl border border-line max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-deep mb-1">دليل حالات المستأجر</h3>
            <p className="text-[11px] text-muted mb-3">الأرقام أدناه هي إعدادات {scope} — تُغيَّر من الإعدادات، والحالات تتحدّث تلقائيًّا.</p>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.name} className="flex items-start gap-2 text-sm">
                  <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${r.dot}`} />
                  <span><b className="text-deep">{r.name}</b> <span className="text-muted">— {r.when}</span></span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted mt-3">الترتيب في اللوحة بحسب الأهمية: المتأخر أولًا، ثم المستحق، ثم القريب، ثم التجديد.</p>
            <button className="btn btn-ghost text-sm mt-3" onClick={() => setOpen(false)}>فهمت</button>
          </div>
        </div>
      )}
    </>
  );
}
