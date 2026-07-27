"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Msg = {
  role: "user" | "bot";
  text: string;
  risk?: "normal" | "high" | "out" | "error";
};

/** أسئلة مقترحة — تحلّ «مشكلة الصندوق الفارغ» وتُظهر نطاق الخدمة فورًا */
const SUGGESTIONS: { group: string; items: string[] }[] = [
  {
    group: "جمعيات الملاك",
    items: [
      "متى يجب تأسيس جمعية الملاك؟",
      "كيف يُحدَّد اشتراك الصيانة؟",
      "ما متطلبات تفعيل الجمعية؟",
      "من يكون مدير العقار وما شروطه؟",
    ],
  },
  {
    group: "الإيجار والتحصيل",
    items: [
      "هل عقد الإيجار المسجّل سند تنفيذي؟",
      "ما خطوات التحصيل من مستأجر متأخر؟",
      "ما التزامات المطوّر تجاه الجمعية؟",
    ],
  },
];

export default function AdvisorChat({
  acknowledged, remaining, limit,
}: { acknowledged: boolean; remaining: number; limit: number }) {
  const [ack, setAck] = useState(acknowledged);
  const [ackBusy, setAckBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(remaining);
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function confirmAck() {
    setAckBusy(true);
    try {
      const r = await fetch("/api/advisor/ack", { method: "POST" });
      const d = await r.json();
      if (d?.ok) setAck(true);
      else setErr(d?.error || "تعذّر حفظ الإقرار.");
    } catch { setErr("تعذّر حفظ الإقرار."); }
    setAckBusy(false);
  }

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setErr("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    setBusy(true);
    try {
      const r = await fetch("/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const d = await r.json();
      if (d?.ok) {
        setMsgs((m) => [...m, { role: "bot", text: d.answer, risk: d.risk }]);
        if (typeof d.remaining === "number") setLeft(d.remaining);
        else setLeft((n) => Math.max(0, n - 1));
      } else {
        setErr(d?.error || "تعذّر الحصول على إجابة.");
        if (d?.quota) setLeft(0);
      }
    } catch {
      setErr("تعذّر الاتصال. تحقّق من الشبكة وحاول مرة أخرى.");
    }
    setBusy(false);
  }

  // ───────── بوّابة الإقرار ─────────
  if (!ack) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white border border-line rounded-2xl shadow-sm p-6">
          <h2 className="font-display font-bold text-deep text-xl mb-1">قبل أن تبدأ — حدود المستشار</h2>
          <p className="text-sm text-muted mb-4">اقرأها مرّة واحدة، ثم لن تظهر لك مجددًا.</p>

          <ul className="space-y-2.5 text-sm leading-relaxed">
            {[
              ["ليس رأيًا قانونيًّا ولا فتوى", "إجاباته استرشادية عامة، ولا تُنشئ أي علاقة مهنية."],
              ["لا يُغني عن محامٍ مرخّص", "في أي مسألة تمسّ حقًّا أو نزاعًا أو إجراءً قضائيًّا."],
              ["لا يُغني عن وسيط أو مدير عقاري مرخّص", "من الهيئة العامة للعقار، فيما يشترط النظام له ترخيصًا."],
              ["لا يُصدر حكمًا على حالتك", "يشرح القاعدة العامة؛ والوقائع الدقيقة قد تغيّر النتيجة."],
              ["قد لا يكون محدَّثًا", "الأنظمة تتغيّر — المصدر الرسمي هو المرجع لا المستشار."],
              ["لا يُصدر إنذارات نظامية", "الإنذار الرسمي عبر «إيجار»، والتصعيد عبر «ناجز» أو الجهة المختصة."],
            ].map(([t, d], i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-gold shrink-0 mt-0.5">◆</span>
                <span><b className="text-deep">{t}</b> — <span className="text-muted">{d}</span></span>
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted mt-4 leading-relaxed bg-paper border border-line rounded-xl p-3">
            تُحفظ أسئلتك وإجاباتها في سجل خاص بحسابك لأغراض الجودة والتدقيق، ويمكنك طلب حذفها في أي وقت.
            التفاصيل في <a href="https://watheqapp.netlify.app/legal.html" target="_blank" rel="noreferrer" className="text-gold font-semibold">الشروط</a>.
          </p>

          {err && <p className="text-sm text-late mt-3">{err}</p>}

          <div className="flex gap-2 mt-5">
            <Link href="/dashboard/property" className="btn btn-ghost flex-1 justify-center">رجوع</Link>
            <button type="button" className="btn btn-gold flex-1 justify-center" disabled={ackBusy} onClick={confirmAck}>
              {ackBusy ? "…" : "أقرّ وأبدأ"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ───────── المحادثة ─────────
  const empty = msgs.length === 0;
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1">
          <h1 className="font-display font-bold text-deep text-xl">المستشار الذكي</h1>
          <p className="text-sm text-muted">إجابات استرشادية عن إدارة الأملاك وجمعيات الملاك</p>
        </div>
        <span className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${
          left > 0 ? "bg-paper2 text-deep border-line" : "bg-[#FBE9E7] text-late border-[#F5C6C2]"}`}>
          {left} من {limit} اليوم
        </span>
      </div>

      {empty && (
        <div className="mb-4">
          <p className="text-sm text-muted mb-3">جرّب سؤالًا من هذي، أو اكتب سؤالك:</p>
          {SUGGESTIONS.map((g) => (
            <div key={g.group} className="mb-3">
              <div className="text-xs font-semibold text-gold mb-1.5">{g.group}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)}
                    className="text-xs text-deep bg-white border border-line rounded-lg px-3 py-2 hover:border-goldSoft transition text-right">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!empty && (
        <div className="flex flex-col gap-3 mb-4">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="self-end max-w-[88%] bg-deep text-[#EAF1EE] rounded-2xl rounded-tl-md px-4 py-2.5 text-sm">
                {m.text}
              </div>
            ) : (
              <div key={i} className={`self-start max-w-[95%] rounded-2xl rounded-tr-md px-4 py-3 text-sm leading-relaxed border ${
                m.risk === "high" || m.risk === "out"
                  ? "bg-[#FBF1DF] border-[#EBD9AA] text-[#6b4a12]"
                  : "bg-white border-line text-ink"}`}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-dashed border-line">
                  <span className="text-[.68rem] text-muted flex-1 leading-relaxed">
                    ⚖️ استرشادي — لا يُغني عن محامٍ أو مختص عقاري مرخّص.
                  </span>
                  <button type="button" title="نسخ" onClick={() => navigator.clipboard?.writeText(m.text)}
                    className="text-xs text-muted hover:text-deep shrink-0">نسخ</button>
                </div>
              </div>
            )
          )}
          {busy && (
            <div className="self-start bg-white border border-line rounded-2xl rounded-tr-md px-4 py-3">
              <span className="inline-flex gap-1">
                <i className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "0ms" }} />
                <i className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "150ms" }} />
                <i className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {err && (
        <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 mb-3 text-sm">{err}</div>
      )}

      <div className="sticky bottom-4">
        <div className="flex gap-2 bg-white border border-line rounded-2xl p-2 shadow-sm">
          <input
            className="fld border-0 flex-1"
            value={q}
            maxLength={600}
            placeholder={left > 0 ? "اكتب سؤالك…" : "بلغت حدّك اليومي — يتجدّد غدًا"}
            disabled={busy || left <= 0}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); } }}
          />
          <button type="button" className="btn btn-gold px-5" disabled={busy || left <= 0 || !q.trim()} onClick={() => ask(q)}>
            {busy ? "…" : "اسأل"}
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-muted mt-4 leading-relaxed">
        المصدر الرسمي هو المرجع دائمًا: الهيئة العامة للعقار · منصة ملاك · منصة إيجار · بوابة ناجز.
      </p>
    </div>
  );
}
