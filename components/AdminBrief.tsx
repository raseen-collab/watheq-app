"use client";
// ============================================================
// وثيق — مستشار المنصة: إحاطة اليوم
//
// يقرأ أرقام المنصة الفعلية ويعيد: أولوية اليوم، قراءة الأرقام، خطوات
// تُنجز اليوم، تغريدات جاهزة، إعلان حراج، وخطة الأسبوع. تُحفظ الإحاطة
// في المتصفح بتاريخها فلا تُستهلك تكلفة عند كل فتح للصفحة.
// ============================================================

import { useEffect, useState } from "react";

type Brief = { today: string; reading: string; actions: string[]; tweets: string[]; haraj: string; week: string[] };
const KEY = "watheq.admin.brief";

function Copy({ text, label = "نسخ" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="text-[11px] border border-line rounded-md px-2 py-0.5 text-muted hover:text-deep shrink-0"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* */ } }}>
      {ok ? "✓ نُسخ" : label}
    </button>
  );
}

export default function AdminBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.day === new Date().toISOString().slice(0, 10)) { setBrief(saved.brief); setAt(saved.at); }
    } catch { /* */ }
  }, []);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/brief", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error || "تعذّر التجهيز"); setBusy(false); return; }
      setBrief(data.brief); setAt(data.at);
      try { localStorage.setItem(KEY, JSON.stringify({ day: new Date().toISOString().slice(0, 10), brief: data.brief, at: data.at })); } catch { /* */ }
    } catch (e: any) { setErr(e?.message || "تعذّر الاتصال"); }
    setBusy(false);
  }

  return (
    <section className="bg-white border-2 border-gold/40 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="font-display font-bold text-deep">🧠 مستشار المنصة — إحاطة اليوم</h2>
          <p className="text-[11px] text-muted">يقرأ أرقامك الفعلية ويجهّز الخطوات والمحتوى. بلا أسماء عملاء — أرقام مجمّعة فقط.</p>
        </div>
        <button className="btn btn-gold text-sm" onClick={run} disabled={busy}>
          {busy ? "يقرأ الأرقام…" : brief ? "تحديث الإحاطة" : "جهّز إحاطة اليوم"}
        </button>
      </div>

      {err && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mb-3">{err}</div>}
      {!brief && !busy && !err && <p className="text-sm text-muted">اضغط الزر — تستغرق ثوانٍ، وتُحفظ ليومك فلا تتكرر التكلفة.</p>}

      {brief && (
        <div className="space-y-4">
          <div className="bg-deep text-[#EAF1EE] rounded-xl p-4">
            <div className="text-xs text-goldSoft mb-1">أولوية اليوم</div>
            <p className="font-semibold leading-relaxed">{brief.today}</p>
            <p className="text-sm opacity-85 mt-2 leading-relaxed">{brief.reading}</p>
          </div>

          {brief.actions?.length > 0 && (
            <div>
              <div className="text-xs font-bold text-muted mb-1.5">خطوات تُنجز اليوم</div>
              <ul className="space-y-1.5">
                {brief.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 bg-paper border border-line rounded-lg px-3 py-2 text-sm">
                    <span className="text-gold font-bold">{i + 1}</span><span className="flex-1">{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.tweets?.length > 0 && (
            <div>
              <div className="text-xs font-bold text-muted mb-1.5">تغريدات جاهزة</div>
              <div className="space-y-1.5">
                {brief.tweets.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 bg-paper border border-line rounded-lg px-3 py-2 text-sm">
                    <span className="flex-1 whitespace-pre-wrap leading-relaxed">{t}</span>
                    <div className="flex flex-col gap-1">
                      <Copy text={t} />
                      <a className="text-[11px] border border-line rounded-md px-2 py-0.5 text-muted hover:text-deep text-center"
                        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}`} target="_blank" rel="noreferrer">نشر</a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {brief.haraj && (
            <div>
              <div className="text-xs font-bold text-muted mb-1.5">إعلان حراج</div>
              <div className="flex items-start gap-2 bg-paper border border-line rounded-lg px-3 py-2 text-sm">
                <pre className="flex-1 whitespace-pre-wrap font-sans leading-relaxed">{brief.haraj}</pre>
                <Copy text={brief.haraj} />
              </div>
            </div>
          )}

          {brief.week?.length > 0 && (
            <div>
              <div className="text-xs font-bold text-muted mb-1.5">أهداف هذا الأسبوع</div>
              <ul className="text-sm space-y-1">
                {brief.week.map((w, i) => <li key={i} className="text-muted">• {w}</li>)}
              </ul>
            </div>
          )}

          {at && <p className="text-[11px] text-muted">جُهّزت {new Date(at).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} · اقتراحات استرشادية، القرار قرارك.</p>}
        </div>
      )}
    </section>
  );
}
