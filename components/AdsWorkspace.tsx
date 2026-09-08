"use client";
// مساحة عمل الإعلانات: توليد بقواعد القناة، نشر بضغطة، تسجيل النتيجة
import { useState } from "react";

type Post = { id: string; channel: string; title: string | null; content: string; posted_at: string; url: string | null; outcome: string | null; replies: number };
type Variant = { title?: string; body: string };

const CH = [
  { k: "haraj", l: "حراج", hint: "عنوان + نص، بلا روابط، دعوة واتساب" },
  { k: "twitter", l: "تويتر / X", hint: "معرفي بلا روابط — الحساب حسّاس للسبام" },
  { k: "group", l: "قروبات", hint: "قروب واحد يوميًا، نبرة زميل لا مسوّق" },
  { k: "direct", l: "تواصل مباشر", hint: "رسالة قصيرة لمكتب، عرض التجهيز المجاني" },
  { k: "other", l: "أخرى", hint: "" },
];
const chLabel = (k: string) => CH.find((c) => c.k === k)?.l || k;

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="btn btn-ghost text-xs"
    onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* */ } }}>
    {ok ? "✓ نُسخ" : "نسخ"}</button>;
}

export default function AdsWorkspace({ posts }: { posts: Post[] }) {
  const [channel, setChannel] = useState("haraj");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [why, setWhy] = useState<string>("");
  const [next, setNext] = useState<string>("");
  const [saved, setSaved] = useState<string | null>(null);

  async function generate() {
    setBusy(true); setErr(null); setVariants([]);
    try {
      const res = await fetch("/api/admin/ads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, brief }) });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error || "تعذّر التوليد"); setBusy(false); return; }
      setVariants(d.variants || []); setWhy(d.why || ""); setNext(d.next || "");
    } catch (e: any) { setErr(e?.message || "تعذّر الاتصال"); }
    setBusy(false);
  }

  async function logPost(v: Variant) {
    const res = await fetch("/api/admin/ads", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "log", channel, title: v.title || null, content: v.body }) });
    const d = await res.json();
    if (!res.ok) { setErr(d?.error || "تعذّر التسجيل"); return; }
    setSaved(v.body.slice(0, 30));
    setTimeout(() => window.location.reload(), 700);
  }

  const publishLink = (v: Variant) =>
    channel === "twitter" ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(v.body)}`
    : channel === "haraj" ? "https://haraj.com.sa/newPost"
    : null;

  return (
    <>
      <section className="bg-white border-2 border-gold/40 rounded-2xl p-5 mb-5">
        <h2 className="font-display font-bold text-deep mb-1">اكتب منشور اليوم</h2>
        <p className="text-[11px] text-muted mb-3">يعرف قواعد كل قناة، وما نشرته سابقًا فلا يكرّره، ونتائج كل قناة فيبني عليها.</p>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {CH.map((c) => (
            <button key={c.k} type="button" onClick={() => setChannel(c.k)}
              className={`text-xs px-3 py-1.5 rounded-full border ${channel === c.k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted"}`}>{c.l}</button>
          ))}
        </div>
        <p className="text-[11px] text-muted mb-2">{CH.find((c) => c.k === channel)?.hint}</p>

        <input className="fld mb-3" value={brief} onChange={(e) => setBrief(e.target.value)}
          placeholder="زاوية معيّنة؟ (اختياري — مثال: ركّز على جمعيات الملاك، أو على فرق السعر عن سمات)" />

        <button className="btn btn-gold text-sm" onClick={generate} disabled={busy}>
          {busy ? "يكتب…" : "اكتب 3 نسخ"}
        </button>

        {err && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mt-3">{err}</div>}
        {saved && <div className="bg-[#E6F4EC] border border-[#B7DFC7] text-[#137a50] rounded-xl p-3 text-sm mt-3">✓ سُجّل في السجل — يُحدَّث الآن…</div>}

        {why && <p className="text-xs text-muted mt-4"><b className="text-deep">لماذا هذه الزاوية:</b> {why}</p>}

        {variants.length > 0 && (
          <div className="space-y-3 mt-3">
            {variants.map((v, i) => {
              const link = publishLink(v);
              const full = (v.title ? v.title + "\n\n" : "") + v.body;
              return (
                <div key={i} className="border border-line rounded-xl p-3 bg-paper">
                  {v.title && <div className="font-semibold text-deep mb-1">{v.title}</div>}
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{v.body}</pre>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Copy text={full} />
                    {link && <a className="btn btn-ghost text-xs" href={link} target="_blank" rel="noreferrer">فتح {chLabel(channel)}</a>}
                    <button className="btn btn-primary text-xs" onClick={() => logPost(v)}>نشرته ✓ سجّله</button>
                  </div>
                </div>
              );
            })}
            {next && <p className="text-xs text-muted">التالي المقترح: {next}</p>}
          </div>
        )}
      </section>

      {/* ═══ السجل ═══ */}
      <section className="bg-white border border-line rounded-2xl">
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <h2 className="font-semibold text-deep">سجل النشر ({posts.length})</h2>
          <span className="text-[11px] text-muted">اكتب نتيجة كل منشور — عليها يبني الاقتراح القادم</span>
        </div>
        {!posts.length ? <p className="p-5 text-sm text-muted">لا منشورات مسجّلة بعد. أول منشور تسجّله يبدأ حلقة القياس.</p> : (
          <div className="divide-y divide-line">
            {posts.map((p) => <LogRow key={p.id} p={p} />)}
          </div>
        )}
      </section>
    </>
  );
}

function LogRow({ p }: { p: Post }) {
  const [outcome, setOutcome] = useState(p.outcome || "");
  const [replies, setReplies] = useState(String(p.replies || 0));
  const [state, setState] = useState<"idle" | "saving" | "ok">("idle");
  async function save() {
    setState("saving");
    await fetch("/api/admin/ads", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "outcome", id: p.id, outcome, replies: Number(replies) || 0 }) });
    setState("ok"); setTimeout(() => setState("idle"), 1500);
  }
  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2 text-xs text-muted mb-1">
        <span className="bg-paper2 rounded-full px-2 py-0.5">{chLabel(p.channel)}</span>
        <span>{String(p.posted_at).slice(0, 10)}</span>
        {p.title && <b className="text-deep">{p.title}</b>}
      </div>
      <p className="text-sm text-muted line-clamp-2 mb-2">{p.content.slice(0, 160)}{p.content.length > 160 ? "…" : ""}</p>
      <div className="flex flex-wrap gap-2 items-center">
        <input className="fld text-xs flex-1 min-w-[180px]" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="ما نتج عنه؟ (ردود، مكالمات، تسجيلات…)" />
        <input className="fld text-xs w-20" value={replies} onChange={(e) => setReplies(e.target.value.replace(/\D/g, ""))} placeholder="ردود" />
        <button className="btn btn-ghost text-xs" onClick={save} disabled={state === "saving"}>{state === "ok" ? "✓" : state === "saving" ? "…" : "حفظ"}</button>
      </div>
    </div>
  );
}
