"use client";
/**
 * نافذة اختيار بأزرار مسمّاة (24 نوفمبر 2026 — تقييم التجربة P0-2).
 *
 * كانت قرارات المال تمرّ عبر confirm() بصيغة «موافق = كذا · إلغاء = كذا»:
 * من يضغط «إلغاء» ليتراجع كان يسجّل الدين متنازلًا عنه ويغيّر تقرير المالك.
 * هنا كل خيار زر باسم فعله، و«رجوع» زر مستقل لا يغيّر شيئًا (وكذلك Esc والنقر خارج النافذة).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type ChoiceOption = { value: string; label: string; hint?: string; tone?: "primary" | "neutral" | "danger" };
type Req = { title: string; body?: string; options: ChoiceOption[]; backLabel?: string; resolve: (v: string | null) => void };

export function useChoice() {
  const [req, setReq] = useState<Req | null>(null);
  const ask = useCallback((o: Omit<Req, "resolve">) => new Promise<string | null>((resolve) => setReq({ ...o, resolve })), []);
  const done = useCallback((v: string | null) => { setReq((r) => { r?.resolve(v); return null; }); }, []);
  const el = req ? <ChoiceDialog req={req} onDone={done} /> : null;
  return [el, ask] as const;
}

const TONE: Record<string, string> = {
  primary: "border-[#137a50] bg-[#EAF6EE] hover:bg-[#E3F4EA]",
  neutral: "border-line bg-white hover:bg-paper2",
  danger: "border-[#e2b4b0] bg-white hover:bg-[#FFF5F4]",
};

function ChoiceDialog({ req, onDone }: { req: Req; onDone: (v: string | null) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    document.body.classList.add("wq-modal-open");
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onDone(null); } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("wq-modal-open"); };
  }, [onDone]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-end sm:place-items-center bg-black/50 p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="wq-choice-title"
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 sm:p-6 max-h-[90vh] overflow-auto">
        <h3 id="wq-choice-title" className="font-display font-bold text-deep text-lg leading-snug">{req.title}</h3>
        {req.body && <p className="text-sm text-muted mt-1.5 leading-relaxed whitespace-pre-line">{req.body}</p>}
        <div className="mt-4 grid gap-2">
          {req.options.map((o, i) => (
            <button key={o.value} ref={i === 0 ? first : undefined} type="button" onClick={() => onDone(o.value)}
              className={`text-right w-full rounded-xl border px-4 py-3 min-h-[52px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#137a50] ${TONE[o.tone || "neutral"]}`}>
              <span className={`block text-sm font-bold ${o.tone === "danger" ? "text-[#8f2b26]" : "text-deep"}`}>{o.label}</span>
              {o.hint && <span className="block text-xs text-muted mt-0.5 leading-relaxed">{o.hint}</span>}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onDone(null)}
          className="mt-3 w-full min-h-[44px] rounded-xl text-sm font-semibold text-muted hover:text-deep hover:bg-paper2">
          {req.backLabel || "رجوع — لا تغيّر شيئًا"}
        </button>
      </div>
    </div>
  );
}
