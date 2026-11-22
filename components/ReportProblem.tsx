"use client";
// ============================================================
// وثيق — «بلّغ عن مشكلة» (22 نوفمبر 2026)
//
// سطر واحد من المستخدم، والباقي يُرفق وحده: الصفحة (بلا رموز الرابط)،
// مقاس الشاشة، المتصفح، نسخة التطبيق، ومعرّف آخر خطأ التقطه Sentry في
// هذه الجلسة — فيصل البلاغ قابلًا للتتبّع من أول مرة بدل «ما يشتغل».
// ============================================================

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

export default function ReportProblem({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setTimeout(() => ref.current?.focus(), 30); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function send() {
    if (text.trim().length < 3) { setState({ ok: false, msg: "اكتب وصفًا قصيرًا للمشكلة." }); return; }
    setBusy(true); setState(null);
    let ev: string | undefined;
    try { ev = Sentry.lastEventId(); } catch { /* */ }
    try {
      const r = await fetch("/api/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(), path: pathname,
          viewport: `${window.innerWidth}x${window.innerHeight}`, sentry_event: ev || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { setState({ ok: true, msg: "وصلنا بلاغك ✓ — نراجعه ونرد عليك قريبًا." }); setText(""); }
      else setState({ ok: false, msg: j.error || "تعذّر الإرسال — جرّب مرة ثانية أو راسلنا على واتساب 0550165210." });
    } catch {
      setState({ ok: false, msg: "ما فيه اتصال — جرّب مرة ثانية أو راسلنا على واتساب 0550165210." });
    } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setState(null); }} className={className}
        title="بلّغ عن مشكلة — تُرفق الصفحة والجهاز تلقائيًّا">
        🐞 بلّغ عن مشكلة
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/40 grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="rp-title"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
          <div className="w-full max-w-md bg-white text-ink rounded-2xl shadow-xl p-5" dir="rtl">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 id="rp-title" className="font-bold text-deep text-base">🐞 بلّغ عن مشكلة</h2>
              <button type="button" onClick={() => !busy && setOpen(false)} className="text-muted hover:text-ink text-xl leading-none" aria-label="إغلاق">×</button>
            </div>
            {state?.ok ? (
              <div className="py-4">
                <p className="text-paid font-semibold text-sm">{state.msg}</p>
                <button type="button" className="btn btn-ghost text-sm mt-4 w-full" onClick={() => setOpen(false)}>إغلاق</button>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted mb-3 leading-relaxed">وش اللي صار؟ ووش كنت تتوقع؟ سطر واحد يكفي. نرفق معه الصفحة الحالية ونوع الجهاز تلقائيًّا — بدون أي بيانات من حسابك.</p>
                <textarea ref={ref} value={text} onChange={(e) => { setText(e.target.value); if (state && !state.ok) setState(null); }} maxLength={2000} rows={4}
                  className="w-full border border-line rounded-xl p-3 text-sm bg-paper focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold"
                  placeholder="مثال: ضغطت «تسجيل دفعة» وطلعت رسالة خطأ" />
                <p className="text-[11px] text-muted mt-1">الصفحة: <span dir="ltr">{pathname}</span></p>
                {state && !state.ok && <p className="text-sm text-late mt-2">{state.msg}</p>}
                <div className="flex gap-2 mt-4">
                  <button type="button" disabled={busy} onClick={send} className="btn btn-gold text-sm flex-1 disabled:opacity-60">{busy ? "جارٍ الإرسال…" : "إرسال البلاغ"}</button>
                  <button type="button" disabled={busy} onClick={() => setOpen(false)} className="btn btn-ghost text-sm">إلغاء</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
