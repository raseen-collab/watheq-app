"use client";
// ============================================================
// وثيق — مساعد الموقع
//
// يجيب من قاعدة معرفة مكتوبة ومتحقَّق منها — لا من نموذج يؤلّف.
// وحين لا يجد، يقولها ويحوّل المستخدم إلى واتساب المكتب بدل أن يخمّن.
//
// كل شيء في المتصفح: لا خادم، لا استدعاء مدفوع، لا انتظار.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { searchKB, SUGGESTED, KB, CATEGORIES, type HelpEntry } from "@/lib/help-kb";
import { openExternal } from "@/lib/utils";

type Msg = { who: "user" | "bot"; text: string; entries?: HelpEntry[]; noAnswer?: boolean };

const WA = "966596300591";
const waAsk = (q: string) =>
  `https://wa.me/${WA}?text=${encodeURIComponent(`سؤال عن وثيق:\n${q}`)}`;

export default function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [browse, setBrowse] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("wq-help-open", open);
    return () => { document.body.classList.remove("wq-help-open"); };
  }, [open]);

  /** تسجيل صامت للمراقبة — لا ينتظره المستخدم ولا يُفشل شيئًا */
  function log(question: string, hits: ReturnType<typeof searchKB>) {
    try {
      fetch("/api/help-log", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question, answered: hits.length > 0,
          matched_id: hits[0]?.entry.id || null,
          score: hits[0] ? Math.round(hits[0].score * 100) / 100 : null,
          path: typeof location !== "undefined" ? location.pathname : null,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* تجاهل */ }
  }

  function ask(text: string) {
    const t = text.trim();
    if (!t) return;
    const hits = searchKB(t, 3);
    log(t, hits);
    setMsgs((m) => [...m, { who: "user", text: t },
      hits.length
        ? { who: "bot", text: "", entries: hits.map((h) => h.entry) }
        : {
            who: "bot", noAnswer: true,
            text: "ما لقيت جوابًا مكتوبًا لسؤالك.\n\nبدل ما أخمّن، أرسله لنا مباشرة وبنرد عليك — وبنضيفه هنا للجميع.",
          }]);
    setQ(""); setBrowse(false);
  }

  const byCat = useMemo(() => {
    const m: Record<string, HelpEntry[]> = {};
    for (const e of KB) (m[e.cat] ||= []).push(e);
    return m;
  }, []);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="مساعدة"
        className="wq-help-fab fixed z-40 end-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:bottom-24
                   bg-white border border-line shadow-lg rounded-full ps-3 pe-3.5 py-2.5 flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-deep grid place-items-center text-goldSoft text-sm font-bold">؟</span>
        <span className="text-xs font-bold text-deep">مساعدة</span>
      </button>
    );
  }

  return (
    <div className="fixed z-[45] inset-x-2 sm:inset-x-auto sm:end-4 sm:w-[390px]
                    bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-24
                    bg-white border border-line rounded-2xl shadow-2xl flex flex-col max-h-[78vh] overflow-hidden">
      <div className="bg-deep text-[#EAF1EE] px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <div className="font-display font-bold text-goldSoft text-sm">مساعد وثيق</div>
          <div className="text-[11px] opacity-75">اسأل عن أي شيء في المنصة</div>
        </div>
        <button className="text-sm opacity-80 hover:opacity-100" onClick={() => setOpen(false)} aria-label="إغلاق">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {!msgs.length && !browse && (
          <>
            <p className="text-sm text-ink leading-relaxed">
              أهلًا. اسألني بلغتك العادية — مثل «سجّلت دفعة غلط» أو «وش أرسل للمالك».
            </p>
            <div className="space-y-1.5">
              {SUGGESTED.map((s) => (
                <button key={s} onClick={() => ask(s)}
                  className="block w-full text-right text-xs bg-paper hover:bg-paper2 border border-line rounded-xl px-3 py-2 transition">
                  {s}
                </button>
              ))}
            </div>
            <button onClick={() => setBrowse(true)} className="text-xs text-goldInk font-semibold underline underline-offset-4">
              أو تصفّح كل المواضيع
            </button>
          </>
        )}

        {browse && (
          <div className="space-y-3">
            <button onClick={() => setBrowse(false)} className="text-xs text-muted">← رجوع</button>
            {Object.entries(byCat).map(([cat, list]) => (
              <div key={cat}>
                <div className="text-[11px] font-bold text-goldInk mb-1">{CATEGORIES[cat as HelpEntry["cat"]]}</div>
                <div className="space-y-1">
                  {list.map((e) => (
                    <button key={e.id} onClick={() => ask(e.q)}
                      className="block w-full text-right text-xs text-ink hover:text-deep border-b border-line/60 pb-1.5">
                      {e.q}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.who === "user" ? "text-left" : ""}>
            {m.who === "user" ? (
              <span className="inline-block bg-deep text-[#EAF1EE] rounded-2xl rounded-bl-md px-3 py-2 text-sm max-w-[85%] text-right">
                {m.text}
              </span>
            ) : (
              <div className="space-y-2">
                {m.entries?.map((e, k) => (
                  <div key={e.id} className="bg-paper border border-line rounded-xl p-3">
                    {k > 0 && <div className="text-[10px] text-muted mb-1">وقد تقصد أيضًا:</div>}
                    <div className="font-semibold text-deep text-sm mb-1.5">{e.q}</div>
                    <div className="text-[13px] text-ink leading-[1.9] whitespace-pre-line">{e.a}</div>
                  </div>
                ))}
                {m.noAnswer && (
                  <div className="bg-[#FBF1DF] border border-goldSoft rounded-xl p-3">
                    <div className="text-[13px] text-ink leading-relaxed whitespace-pre-line mb-2.5">{m.text}</div>
                    <button className="btn btn-wa text-xs w-full justify-center"
                      onClick={() => openExternal(waAsk(msgs[i - 1]?.text || ""))}>
                      💬 أرسل سؤالك لنا
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line p-2.5 shrink-0">
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
          <input className="fld text-sm flex-1" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="اكتب سؤالك…" aria-label="سؤالك" />
          <button type="submit" className="btn btn-gold text-sm px-4" disabled={!q.trim()}>اسأل</button>
        </form>
        {msgs.length > 0 && (
          <button onClick={() => { setMsgs([]); setBrowse(false); }} className="text-[11px] text-muted mt-1.5">
            ابدأ من جديد
          </button>
        )}
      </div>
    </div>
  );
}
