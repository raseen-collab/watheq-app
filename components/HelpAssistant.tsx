"use client";
// ============================================================
// وثيق — مساعد الموقع
//
// يجيب من قاعدة معرفة مكتوبة ومتحقَّق منها — لا من نموذج يؤلّف.
// وحين لا يجد، يقولها ويحوّل المستخدم إلى واتساب المكتب بدل أن يخمّن.
//
// البحث بالكلمات في المتصفح أولًا (فوري ومجاني). وحين لا يجد أو يجد مطابقة ضعيفة
// (v100) يسأل /api/help-ai: نموذج «يطابق» السؤال بأي صيغة على مداخل القاعدة نفسها،
// ويُعرض الجواب المكتوب حرفيًّا — النموذج لا يكتب للمستخدم شيئًا.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { searchKB, SUGGESTED, KB, CATEGORIES, type HelpEntry } from "@/lib/help-kb";
import { needsAI } from "@/lib/help-ai";
import { openExternal, WATHEQ_WA } from "@/lib/utils";

/* rated: تقييم المستخدم للجواب (6 نوفمبر 2026) — «وجد جوابًا» لا يعني «أفاد» */
type Msg = { who: "user" | "bot"; text: string; entries?: HelpEntry[]; noAnswer?: boolean; q?: string; rated?: "up" | "down" };

const WA = WATHEQ_WA;
const waAsk = (q: string) =>
  `https://wa.me/${WA}?text=${encodeURIComponent(`سؤال عن وثيق:\n${q}`)}`;

export default function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [browse, setBrowse] = useState(false);
  const [thinking, setThinking] = useState(false);
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

  const NO_ANSWER = "ما لقيت جوابًا مكتوبًا لسؤالك.\n\nبدل ما أخمّن، أرسله لنا مباشرة وبنرد عليك — وبنضيفه هنا للجميع.";
  const reply = (t: string, entries: HelpEntry[]): Msg =>
    entries.length ? { who: "bot", text: "", entries, q: t } : { who: "bot", noAnswer: true, text: NO_ANSWER };

  /** (v100) مطابقة بالنموذج — يعيد مداخل من القاعدة أو null إن تعذّر (فنرجع للكلمات) */
  async function aiMatch(t: string): Promise<HelpEntry[] | null> {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch("/api/help-ai", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ question: t, path: typeof location !== "undefined" ? location.pathname : null }),
      });
      clearTimeout(timer);
      const j = await r.json().catch(() => null);
      if (!j?.ok || j.error || j.capped || j.limited || j.off) return null;
      const byId = new Map(KB.map((e) => [e.id, e]));
      return (j.ids || []).map((id: string) => byId.get(id)).filter(Boolean) as HelpEntry[];
    } catch { return null; }
  }

  async function ask(text: string) {
    const t = text.trim();
    if (!t || thinking) return;
    const hits = searchKB(t, 3);
    setQ(""); setBrowse(false);
    if (!needsAI(hits)) {
      log(t, hits);
      setMsgs((m) => [...m, { who: "user", text: t }, reply(t, hits.map((h) => h.entry))]);
      return;
    }
    setMsgs((m) => [...m, { who: "user", text: t }]);
    setThinking(true);
    const ai = await aiMatch(t);
    setThinking(false);
    if (ai === null) log(t, hits);            // تعذّر النموذج: نسجّل نتيجة الكلمات (والخادم لم يسجّل)
    const entries = ai && ai.length ? ai : hits.map((h) => h.entry);
    setMsgs((m) => [...m, reply(t, entries)]);
  }

  /** «أفاد / ما أفاد» — يُسجَّل مرة لكل جواب، ولا ينتظره المستخدم */
  function rate(i: number, helpful: boolean) {
    const m = msgs[i];
    if (!m || m.rated) return;
    setMsgs((all) => all.map((x, k) => (k === i ? { ...x, rated: helpful ? "up" : "down" } : x)));
    try {
      fetch("/api/help-log", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "feedback", question: m.q || "", helpful,
          matched_id: m.entries?.[0]?.id || null,
          path: typeof location !== "undefined" ? location.pathname : null,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* تجاهل */ }
  }

  const byCat = useMemo(() => {
    const m: Record<string, HelpEntry[]> = {};
    for (const e of KB) (m[e.cat] ||= []).push(e);
    return m;
  }, []);

  /* يُفتح من القائمة الموحَّدة — كان زرًّا ثالثًا عائمًا يتزاحم مع الاثنين */
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("watheq:help", h);
    return () => window.removeEventListener("watheq:help", h);
  }, []);
  /* (24 نوفمبر — التقييم الثاني) Esc يغلق اللوحة كبقية النوافذ، ويرجع التركيز لما فُتحت منه */
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = (document.activeElement as HTMLElement) || null;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); opener.current?.focus?.(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  if (!open) return null;


  return (
    <div className="fixed z-[45] inset-x-2 sm:inset-x-auto sm:end-4 sm:w-[390px]
                    bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-24
                    bg-white border border-line rounded-2xl shadow-2xl flex flex-col max-h-[78vh] overflow-hidden">
      <div className="bg-deep text-[#EAF1EE] px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <div className="font-display font-bold text-goldSoft text-sm">مساعد وثيق</div>
          <div className="text-[11px] opacity-75">اسأل عن أي شيء في المنصة</div>
        </div>
        <button className="text-sm opacity-80 hover:opacity-100 min-w-[44px] min-h-[44px] -m-2 grid place-items-center" onClick={() => setOpen(false)} aria-label="إغلاق المساعدة">✕</button>
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
                {!!m.entries?.length && (
                  <div className="flex items-center gap-2 text-[11px] text-muted ps-1">
                    {!m.rated ? (
                      <>
                        <span>أفادك الجواب؟</span>
                        <button onClick={() => rate(i, true)} className="border border-line rounded-full px-2.5 py-1 hover:bg-paper min-h-[32px]" aria-label="أفاد">👍 نعم</button>
                        <button onClick={() => rate(i, false)} className="border border-line rounded-full px-2.5 py-1 hover:bg-paper min-h-[32px]" aria-label="ما أفاد">👎 لا</button>
                      </>
                    ) : m.rated === "up" ? (
                      <span>شكرًا 🙏</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>نعتذر — أرسل لنا سؤالك ونرد عليك ونحسّن الجواب للجميع.</span>
                        <button className="btn btn-wa text-[11px] px-3 py-1" onClick={() => openExternal(waAsk(m.q || ""))}>💬 أرسل سؤالك</button>
                      </span>
                    )}
                  </div>
                )}
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
        {thinking && <div className="text-xs text-muted ps-1 animate-pulse" aria-live="polite">أدوّر لك على الجواب…</div>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line p-2.5 shrink-0">
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
          <input className="fld text-sm flex-1" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="اكتب سؤالك…" aria-label="سؤالك" />
          <button type="submit" className="btn btn-gold text-sm px-4" disabled={!q.trim() || thinking}>اسأل</button>
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
