"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

type Msg = {
  role: "user" | "bot";
  text: string;
  risk?: "normal" | "high" | "out" | "error";
};

/** أسئلة مقترحة — تحلّ «مشكلة الصندوق الفارغ» وتُظهر نطاق الخدمة فورًا */
const SUGGESTIONS: { group: string; scope: "hoa" | "property"; items: string[] }[] = [
  {
    group: "جمعيات الملاك",
    scope: "hoa",
    items: [
      "متى يجب تأسيس جمعية الملاك؟",
      "كيف يُحدَّد اشتراك الصيانة؟",
      "ما متطلبات تفعيل الجمعية؟",
      "من يكون مدير العقار وما شروطه؟",
    ],
  },
  {
    group: "الإيجار والتحصيل",
    scope: "property",
    items: [
      "هل عقد الإيجار المسجّل سند تنفيذي؟",
      "ما خطوات التحصيل من مستأجر متأخر؟",
      "ما التزامات المطوّر تجاه الجمعية؟",
    ],
  },
];

/* ═══════════════════════════════════════════════════════════════
   عرض Markdown الذي يخرجه المستشار
   ───────────────────────────────────────────────────────────────
   يبني عناصر React مباشرةً — بلا مكتبة خارجية وبلا
   dangerouslySetInnerHTML، فلا مجال لحقن HTML من نص النموذج.
   المدعوم: عناوين # · **غامق** · `كود` · [نص](رابط) · قوائم نقطية
   ومرقّمة · اقتباس > · جدول | · فاصل ---
   ═══════════════════════════════════════════════════════════════ */

const INLINE_SRC = "(`[^`\\n]+`)|(\\*\\*[^*\\n]+\\*\\*)|(\\[[^\\]\\n]+\\]\\((https?:\\/\\/[^\\s)]+)\\))";

/** تحويل التنسيق داخل السطر إلى عُقد React */
function inline(text: string, kp: string): ReactNode[] {
  const re = new RegExp(INLINE_SRC, "g");
  const out: ReactNode[] = [];
  let last = 0, n = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const f = m[0];
    if (f.startsWith("`")) {
      out.push(
        <code key={`${kp}c${n}`} className="bg-paper2 border border-line rounded px-1 py-0.5 text-[.82em]">
          {f.slice(1, -1)}
        </code>
      );
    } else if (f.startsWith("**")) {
      out.push(<b key={`${kp}b${n}`} className="font-bold text-deep">{f.slice(2, -2)}</b>);
    } else {
      const c = f.indexOf("](");
      out.push(
        <a key={`${kp}a${n}`} href={f.slice(c + 2, -1)} target="_blank" rel="noreferrer noopener"
           className="text-gold font-semibold underline underline-offset-2">
          {f.slice(1, c)}
        </a>
      );
    }
    last = m.index + f.length; n++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isHead  = (s: string) => /^#{1,6}\s+/.test(s);
const isQuote = (s: string) => /^>\s?/.test(s);
const isUl    = (s: string) => /^[-*•]\s+/.test(s);
const isOl    = (s: string) => /^\d+[.)]\s+/.test(s);
const isHr    = (s: string) => /^(-{3,}|_{3,}|\*{3,})$/.test(s);
const isRow   = (s: string) => s.startsWith("|") && s.endsWith("|");
const isSep   = (s: string) => /^\|[\s:|-]+\|$/.test(s);
const cellsOf = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function Markdown({ text }: { text: string }) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0, k = 0;

  const isTableStart = (idx: number) =>
    isRow(lines[idx].trim()) && idx + 1 < lines.length && isSep(lines[idx + 1].trim());

  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }

    if (isHr(t)) { out.push(<hr key={k++} className="my-3 border-line" />); i++; continue; }

    if (isHead(t)) {
      const m = t.match(/^(#{1,6})\s+(.*)$/)!;
      const big = m[1].length <= 2;
      out.push(
        <div key={k} className={big
          ? "font-display font-bold text-deep text-[.98rem] mt-3.5 mb-1.5 first:mt-0"
          : "font-semibold text-deep mt-3 mb-1 first:mt-0"}>
          {inline(m[2], `h${k}`)}
        </div>
      );
      k++; i++; continue;
    }

    if (isTableStart(i)) {
      const head = cellsOf(lines[i]); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i].trim()) && !isSep(lines[i].trim())) {
        rows.push(cellsOf(lines[i])); i++;
      }
      out.push(
        <div key={k} className="my-2.5 border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-[.85em]">
            <thead className="bg-paper2">
              <tr>{head.map((h, j) => (
                <th key={j} className="p-2 text-right font-semibold text-deep">{inline(h, `th${k}-${j}`)}</th>
              ))}</tr>
            </thead>
            <tbody>{rows.map((r, ri) => (
              <tr key={ri} className="border-t border-line align-top">
                {r.map((c, ci) => <td key={ci} className="p-2">{inline(c, `td${k}-${ri}-${ci}`)}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      );
      k++; continue;
    }

    if (isQuote(t)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, "")); i++;
      }
      out.push(
        <div key={k} className="bg-paper rounded-lg px-3 py-2 my-2.5 text-muted whitespace-pre-wrap"
             style={{ borderInlineStart: "3px solid #EBD9AA" }}>
          {inline(buf.join("\n"), `q${k}`)}
        </div>
      );
      k++; continue;
    }

    if (isUl(t)) {
      const items: string[] = [];
      while (i < lines.length && isUl(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, "")); i++;
      }
      out.push(
        <ul key={k} className="my-2 space-y-1.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2">
              <span className="text-gold shrink-0 mt-0.5 text-[.7em]">◆</span>
              <span className="flex-1">{inline(it, `u${k}-${j}`)}</span>
            </li>
          ))}
        </ul>
      );
      k++; continue;
    }

    if (isOl(t)) {
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, "")); i++;
      }
      out.push(
        <ol key={k} className="my-2 space-y-1.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2">
              <span className="text-gold font-bold shrink-0">{j + 1}.</span>
              <span className="flex-1">{inline(it, `o${k}-${j}`)}</span>
            </li>
          ))}
        </ol>
      );
      k++; continue;
    }

    const buf: string[] = [];
    while (i < lines.length) {
      const s2 = lines[i].trim();
      if (!s2 || isHr(s2) || isHead(s2) || isQuote(s2) || isUl(s2) || isOl(s2) || isTableStart(i)) break;
      buf.push(lines[i]); i++;
    }
    out.push(
      <p key={k} className="my-1.5 whitespace-pre-wrap first:mt-0 last:mb-0">
        {inline(buf.join("\n"), `p${k}`)}
      </p>
    );
    k++;
  }

  return <>{out}</>;
}

export type AdvisorScope = "hoa" | "property";

export default function AdvisorChat({
  acknowledged, remaining, limit, scope = "hoa",
}: { acknowledged: boolean; remaining: number; limit: number; scope?: AdvisorScope }) {
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
            <Link href={scope === "property" ? "/dashboard/property" : "/dashboard/association"}
              className="btn btn-ghost flex-1 justify-center">رجوع</Link>
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
          <p className="text-sm text-muted">
            {scope === "property"
              ? "إجابات استرشادية عن الإيجار والتحصيل وإدارة الأملاك"
              : "إجابات استرشادية عن جمعيات الملاك وإدارة العقار المشترك"}
          </p>
        </div>
        <span className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${
          left > 0 ? "bg-paper2 text-deep border-line" : "bg-[#FBE9E7] text-late border-[#F5C6C2]"}`}>
          {left} من {limit} اليوم
        </span>
      </div>

      {empty && (
        <div className="mb-4">
          <p className="text-sm text-muted mb-3">جرّب سؤالًا من هذي، أو اكتب سؤالك:</p>
          {[...SUGGESTIONS].sort((a, b) => (a.scope === scope ? -1 : b.scope === scope ? 1 : 0)).map((g) => (
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
                <div className="advisor-md"><Markdown text={m.text} /></div>
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
