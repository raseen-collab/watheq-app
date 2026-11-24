"use client";
/**
 * مضيف نوافذ التأكيد والتنبيه (lib/confirm) — يُركّب مرة واحدة في app/layout.
 * طابور: إن طُلب تأكيدان معًا يظهران واحدًا بعد الآخر.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { registerConfirmHost, splitMessage, okLabel, type ConfirmReq } from "@/lib/confirm";

export default function ConfirmHost() {
  const [queue, setQueue] = useState<ConfirmReq[]>([]);
  useEffect(() => registerConfirmHost((r) => setQueue((q) => [...q, r])), []);
  const cur = queue[0] || null;
  const done = useCallback((v: boolean) => {
    setQueue((q) => { q[0]?.resolve(v); return q.slice(1); });
  }, []);
  if (!cur) return null;
  return <Dialog key={queue.length + cur.message.slice(0, 20)} req={cur} onDone={done} />;
}

function Dialog({ req, onDone }: { req: ConfirmReq; onDone: (v: boolean) => void }) {
  const { title, body } = splitMessage(req.message, req.kind);
  const { ok, danger } = okLabel(title, req.opts);
  const okRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    document.body.classList.add("wq-modal-open");
    /* الحذف: التركيز على «رجوع» حتى لا يُنفَّذ بضغطة Enter عابرة */
    (req.kind === "alert" || !danger ? okRef : backRef).current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onDone(req.kind === "alert"); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); document.body.classList.remove("wq-modal-open"); };
  }, [req, danger, onDone]);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-end sm:place-items-center bg-black/50 p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onDone(req.kind === "alert"); }}>
      <div role={req.kind === "alert" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="wq-confirm-title"
        aria-describedby={body ? "wq-confirm-body" : undefined}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 sm:p-6 max-h-[85vh] overflow-auto">
        <h3 id="wq-confirm-title" className="font-display font-bold text-deep text-lg leading-snug">{title}</h3>
        {body && <p id="wq-confirm-body" className="text-sm text-ink/80 mt-2 leading-relaxed whitespace-pre-line">{body}</p>}
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-start gap-2">
          {req.kind === "confirm" && (
            <button ref={backRef} type="button" onClick={() => onDone(false)}
              className="btn btn-ghost min-h-[44px] sm:min-w-[110px] justify-center">{req.opts.cancel || "رجوع"}</button>
          )}
          <button ref={okRef} type="button" onClick={() => onDone(true)}
            className={`btn min-h-[44px] sm:min-w-[130px] justify-center ${danger ? "bg-[#8f2b26] text-white hover:opacity-90" : "btn-primary"}`}>
            {req.kind === "alert" ? (req.opts.ok || "حسنًا") : ok}
          </button>
        </div>
      </div>
    </div>
  );
}
