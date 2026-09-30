"use client";
/**
 * وثيق — اتحاد الملاك، الجولة الثالثة (الوضوح):
 * نافذة موحّدة تُغلق بـEscape · شرح المصطلحات (ⓘ) · دليل البداية ·
 * إرسال روابط الملاك · الحوالات المُبلَّغ عنها · علامة «ملاك» · طلبات الصيانة.
 * كل الكتابة عبر دوال schema-v66؛ قبل تطبيقها تختفي الأقسام الجديدة بهدوء.
 */
import { useEffect, useId, useRef, useState } from "react";
import { sar } from "@/lib/utils";
import { moneySigned, REQUEST_CATEGORIES, REQUEST_STATUS_AR, requestCatAr, requestLocAr, riyalsAr } from "@/lib/hoaMoney";
import { arDate } from "@/lib/documents";

// ─── النافذة ───────────────────────────────────────────────────
/** يغلق عند Escape (آخر نافذة مفتوحة فقط تستجيب) */
export function useEscape(onClose: () => void, enabled = true) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); ref.current(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [enabled]);
}

/** خلفية النافذة: نقرة خارجها أو Escape تغلقها. العنصر الداخلي يحمل role="dialog" */
export function Overlay({ onClose, children, z = "z-50" }: { onClose: () => void; children: React.ReactNode; z?: string }) {
  useEscape(onClose);
  return <div className={`fixed inset-0 ${z} grid place-items-center bg-black/50 p-4`} onClick={onClose}>{children}</div>;
}

// ─── المبلغ السالب ──────────────────────────────────────────────
/** «−10» بعلامة طرح حقيقية ومعزول الاتجاه (لا يظهر «10-» في السطر العربي) */
export function Amt({ n, className = "" }: { n: number; className?: string }) {
  return <span dir="ltr" className={`inline-block tabular-nums ${className}`}>{moneySigned(n).replace(/[⁦⁩]/g, "")}</span>;
}

// ─── شرح المصطلحات ─────────────────────────────────────────────
export const TERMS: Record<string, { t: string; ex?: string }> = {
  "مقدَّم": { t: "دفع المالك عن فترات قادمة قبل موعدها، فلا يُطالَب حتى تنتهي.", ex: "الاشتراك 250 ودفع 750 = مسدَّد 3 أشهر مقدَّمًا." },
  "سداد جزئي": { t: "مبلغ أقل من اشتراك فترة كاملة، يُحفظ للمالك ويُكمَل لاحقًا.", ex: "الاشتراك 250 ودفع 100 = يبقى عليه 150 لهذا الشهر." },
  "متأخر": { t: "فترات استُحقّت على المالك ولم يسدّدها بعد.", ex: "لم يدفع يوليو وأغسطس والاشتراك 250 = متأخر شهرين بمبلغ 500." },
  "استحقاق تلقائي": { t: "أول كل شهر (أو أول السنة المالية في الاشتراك السنوي) يُضاف اشتراك الفترة على كل مالك تلقائيًّا، ويُخصم من مقدَّمه إن وُجد.", ex: "بدونه تضيف الاستحقاق يدويًّا لكل مالك." },
  "عكس الدفعة": { t: "لتصحيح دفعة سُجّلت خطأً: يُضاف سطر يلغي أثرها، ويبقى السطران في السجل — لا شيء يُحذف.", ex: "سجّلت 500 بدل 250؟ اعكسها ثم سجّل 250." },
  "سند قبض": { t: "إيصال مرقَّم يصدر تلقائيًّا لكل دفعة تدخل الصندوق، ويراه المالك في صفحته.", ex: "R-00012 — 250 ريال — اشتراك أكتوبر." },
  "سند صرف": { t: "إثبات مرقَّم لكل مصروف يُدفع من الصندوق، ويظهر مجموعه في صفحة الشفافية.", ex: "S-00003 — 300 ريال — صيانة المصعد." },
  "رصيد الصندوق": { t: "ما يُفترض أن يكون في حساب الجمعية حسب السجل: الرصيد السابق + ما قُبض − ما صُرف.", ex: "1,000 + 750 − 200 = 1,550 ريال." },
  "صفحة الشفافية": { t: "رابط عام للعمارة يرى فيه الملاك الرصيد والمحصَّل والمصروفات وعدد طلبات الصيانة — بلا أسماء ولا أرقام وحدات.", ex: "أرسله في مجموعة العمارة مرة، ويتحدّث وحده." },
  "الرصيد الافتتاحي": { t: "ما على المالك يوم بدأت استخدام وثيق، قبل أي دفعة تُسجَّل هنا.", ex: "عليه 3 أشهر من قبل = اكتب 3. لا شيء عليه = اكتب 0." },
  "الحصة": { t: "نسبة الوحدة من العقار (غالبًا حسب المساحة)، ويُوزَّع بها رسم الموازنة.", ex: "موازنة سنوية 12,000 وحصة الوحدة 10٪ = نصيبها 1,200 في السنة." },
  "النصاب": { t: "أقل نسبة حضور (من الحصص) ليصحّ اجتماع الجمعية العامة. النسبة المطبّقة من إعدادات جمعيتك حسب نظامها الأساسي.", ex: "نصاب 75٪: حضر ملاك يملكون 60٪ من الحصص = لا يصحّ الاجتماع الأول." },
};

/**
 * ⓘ بجانب المصطلح: نقرة تفتح شرحًا قصيرًا بمثال، ويُغلق بنقرة خارجه أو Escape.
 * ليس title أصليًّا (لا يظهر باللمس). منطقة اللمس 44px.
 */
export function InfoTip({ term, label }: { term: keyof typeof TERMS | string; label?: string }) {
  const def = TERMS[term as string];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const width = Math.min(320, vw - 32);
      const left = Math.max(16, Math.min(vw - 16 - width, r.left + r.width / 2 - width / 2));
      const below = r.bottom + 6;
      const top = below + 170 > window.innerHeight && r.top > 190 ? Math.max(8, r.top - 6 - (box.current?.offsetHeight || 150)) : below;
      setPos({ top, left, width });
    };
    place();
    const out = (e: Event) => { const t = e.target as Node; if (!box.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", out, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", out, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  if (!def) return null;
  return (
    <span className="inline-flex align-middle">
      <button ref={btn} type="button" className="hoa-tip" aria-label={`ما معنى «${label || term}»؟`} aria-expanded={open} aria-controls={id}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        <span aria-hidden className="hoa-tip-i">i</span>
      </button>
      {open && (
        <div ref={box} id={id} role="dialog" aria-label={`شرح «${label || term}»`}
          className="fixed z-[80] bg-white border border-line rounded-xl shadow-lg p-3 text-right text-sm text-[#33413d] leading-relaxed"
          style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: "hidden", top: 0, left: 0 }}
          onClick={(e) => e.stopPropagation()}>
          <div className="font-bold text-deep mb-1">{label || term}</div>
          <div>{def.t}</div>
          {def.ex && <div className="mt-1.5 text-xs rounded-lg bg-paper2 px-2.5 py-1.5 text-deep">مثال: {def.ex}</div>}
        </div>
      )}
    </span>
  );
}

// ─── دليل البداية ──────────────────────────────────────────────
export type GuideStep = { key: string; label: string; hint?: string; done: boolean; optional?: boolean; term?: string;
  action: { label: string; run: () => void }; extra?: { label: string; run: () => void } };

const guideKey = (id: string) => `watheq.hoa.guide.${id}`;
/** يظهر أعلى الجمعية حتى تكتمل الخطوات الأساسية. طيّه محفوظ لكل جمعية في هذا المتصفح */
export function GuideCard({ assocId, steps }: { assocId: string; steps: GuideStep[] }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(guideKey(assocId)) === "collapsed"); } catch { setCollapsed(false); }
  }, [assocId]);
  const toggle = () => setCollapsed((v) => {
    const n = !v;
    try { localStorage.setItem(guideKey(assocId), n ? "collapsed" : "open"); } catch { /* تخزين محجوب: يبقى للجلسة فقط */ }
    return n;
  });
  const required = steps.filter((s) => !s.optional);
  const doneN = required.filter((s) => s.done).length;
  if (required.length && doneN === required.length) return null;
  const next = steps.find((s) => !s.done && !s.optional);
  return (
    <section className="bg-white border border-[#EBD9AA] rounded-2xl shadow-sm mb-5" aria-label="دليل البداية">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display font-bold text-deep">ابدأ جمعيتك في خطوات</h2>
          <div className="text-xs text-muted">أنجزت {doneN} من {required.length}{next && collapsed ? ` · التالي: ${next.label}` : ""}</div>
          <div className="h-1.5 rounded-full bg-paper2 mt-1.5 overflow-hidden" aria-hidden>
            <div className="h-full bg-paid rounded-full" style={{ width: `${Math.round((doneN / Math.max(1, required.length)) * 100)}%` }} />
          </div>
        </div>
        <button type="button" className="btn btn-ghost text-xs" aria-expanded={!collapsed} onClick={toggle}>{collapsed ? "عرض الخطوات ▾" : "طيّ ▴"}</button>
      </div>
      {!collapsed && (
        <ol className="border-t border-line divide-y divide-line">
          {steps.map((s, i) => (
            <li key={s.key} className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 ${s.done ? "opacity-70" : ""}`}>
              <span aria-hidden className={`w-8 h-8 rounded-full grid place-items-center text-sm font-bold ${s.done ? "bg-[#E6F4EC] text-[#137a50]" : "bg-paper2 text-deep"}`}>{s.done ? "✓" : i + 1}</span>
              <div className="min-w-0">
                <div className="font-semibold text-sm text-deep flex items-center flex-wrap gap-x-1">
                  <span className={s.done ? "line-through decoration-1" : ""}>{s.label}</span>
                  {s.optional && <span className="text-xs text-muted font-normal">(اختياري)</span>}
                  {s.term && <InfoTip term={s.term} />}
                  <span className="sr-only">{s.done ? "— تمّت" : "— لم تتم"}</span>
                </div>
                {s.hint && <div className="text-xs text-muted">{s.hint}</div>}
                {!s.done && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button type="button" className={`btn text-xs ${s === next ? "btn-gold" : "btn-ghost"}`} onClick={s.action.run}>{s.action.label}</button>
                    {s.extra && <button type="button" className="btn btn-ghost text-xs" onClick={s.extra.run}>{s.extra.label}</button>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ─── إرسال روابط الملاك ─────────────────────────────────────────
export function SendLinksModal({ owners, onSend, onClose }: {
  owners: { id: string; name: string; unit: string | null; phone: string | null }[];
  onSend: (id: string) => Promise<boolean>; onClose: () => void;
}) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sl-h" className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 id="sl-h" className="font-display font-bold text-deep text-lg">أرسل لكل مالك رابطه</h3>
        <p className="text-sm text-muted mb-3">رابط خاص يرى فيه المالك رصيده وسنداته ومستندات الجمعية، ويبلّغ منه عن حوالته أو عطل. يُفتح واتساب لكل مالك على حدة.</p>
        <div className="flex flex-col gap-2">
          {owners.map((o) => (
            <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-line p-2.5">
              <div className="min-w-0"><div className="font-semibold text-sm truncate">{o.name}</div>
                <div className="text-xs text-muted">{o.unit ? `وحدة ${o.unit}` : "—"}{o.phone ? "" : " · بلا جوال"}</div></div>
              <button type="button" className={`btn text-xs ${sent[o.id] ? "btn-ghost" : "btn-wa"}`} disabled={busy === o.id}
                onClick={async () => { setBusy(o.id); const ok = await onSend(o.id); setBusy(null); if (ok) setSent((m) => ({ ...m, [o.id]: true })); }}>
                {busy === o.id ? "…" : sent[o.id] ? "أُرسل ✓ (مرة أخرى)" : "أرسل الرابط"}</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
      </div>
    </Overlay>
  );
}

// ─── الحوالات المُبلَّغ عنها ──────────────────────────────────────
export type Claim = { id: string; owner_id: string | null; owner_name: string | null; unit: string | null; amount: number;
  transfer_date: string; bank_ref: string | null; note: string | null; status: "pending" | "approved" | "rejected";
  reject_reason: string | null; approved_payment_id: string | null; created_at: string; decided_at: string | null };

export function ClaimsModal({ claims, onApprove, onReject, onClose }: {
  claims: Claim[]; onApprove: (c: Claim, force?: boolean) => Promise<boolean | "near_dup">; onReject: (c: Claim, reason: string) => Promise<boolean>; onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  /** F1: تأكيد داخل التطبيق حين توجد دفعة بالمبلغ نفسه قرب تاريخ الحوالة */
  const [nearDup, setNearDup] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showDone, setShowDone] = useState(false);
  const pending = claims.filter((c) => c.status === "pending");
  const decided = claims.filter((c) => c.status !== "pending");
  const list = showDone ? decided : pending;
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="cl-h" className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 id="cl-h" className="font-display font-bold text-deep text-lg">حوالات أبلغ عنها الملاك</h3>
        <p className="text-sm text-muted mb-3">طابق كل حوالة مع كشف حساب الجمعية البنكي أولًا. «اعتماد» يسجّل الدفعة بتاريخ الحوالة ويصدر سند القبض — والضغط مرتين لا يكرّرها.</p>
        <div className="flex gap-1.5 mb-3" role="tablist">
          <button type="button" role="tab" aria-selected={!showDone} className={`hoa-chip ${!showDone ? "hoa-chip-on" : ""}`} onClick={() => setShowDone(false)}>بانتظار المراجعة {pending.length}</button>
          <button type="button" role="tab" aria-selected={showDone} className={`hoa-chip ${showDone ? "hoa-chip-on" : ""}`} onClick={() => setShowDone(true)}>تمّ البتّ فيها {decided.length}</button>
        </div>
        {!list.length && <div className="text-center text-muted py-8 text-sm">{showDone ? "لا حوالات معتمدة أو مرفوضة بعد." : "لا حوالات بانتظار المراجعة."}</div>}
        <div className="flex flex-col gap-2">
          {list.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-paper p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{c.owner_name || "مالك محذوف"}{c.unit ? ` · وحدة ${c.unit}` : ""}</div>
                  <div className="text-xs text-muted">حوالة {arDate(c.transfer_date)}{c.bank_ref ? <> · مرجع <span dir="ltr">{c.bank_ref}</span></> : ""}</div>
                  {c.note && <div className="text-xs text-muted break-words">«{c.note}»</div>}
                </div>
                <b className="tabular-nums text-deep">{riyalsAr(Number(c.amount), sar)}</b>
              </div>
              {c.status === "approved" && <div className="text-xs text-[#137a50] font-semibold mt-1">اعتُمدت وسُجّلت الدفعة ✓</div>}
              {c.status === "rejected" && <div className="text-xs text-[#a5322c] mt-1 break-words">رُفضت: {c.reject_reason}</div>}
              {c.status === "pending" && nearDup === c.id ? (
                <div className="mt-2 rounded-lg border border-[#EBD9AA] bg-[#FDF0DC] p-2.5 text-[#7A4800]" role="alertdialog" aria-labelledby={`nd-${c.id}`}>
                  <div id={`nd-${c.id}`} className="text-xs font-semibold">توجد دفعة مسجّلة لهذا المالك بالمبلغ نفسه قريبًا من تاريخ الحوالة. راجع سجل مدفوعاته — قد تكون الحوالة نفسها مسجّلة يدويًّا.</div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" className="btn btn-ghost text-xs flex-1 justify-center" onClick={() => setNearDup(null)} autoFocus>راجع أولًا</button>
                    <button type="button" className="btn btn-primary text-xs flex-1 justify-center" disabled={busy === c.id}
                      onClick={async () => { setBusy(c.id); const r = await onApprove(c, true); setBusy(null); if (r === true) setNearDup(null); }}>
                      {busy === c.id ? "…" : "اعتمد مع التأكيد"}</button>
                  </div>
                </div>
              ) : c.status === "pending" && (rejecting === c.id ? (
                <div className="mt-2">
                  <label className="text-xs font-semibold text-deep" htmlFor={`rr-${c.id}`}>سبب الرفض (يظهر للمالك)</label>
                  <input id={`rr-${c.id}`} className="fld mt-1" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="مثال: لم تصل الحوالة إلى حساب الجمعية" autoFocus />
                  <div className="flex gap-2 mt-2">
                    <button type="button" className="btn btn-ghost text-xs flex-1 justify-center" onClick={() => { setRejecting(null); setReason(""); }}>تراجع</button>
                    <button type="button" className="btn text-xs flex-1 justify-center bg-late text-white" disabled={reason.trim().length < 3 || busy === c.id}
                      onClick={async () => { setBusy(c.id); const ok = await onReject(c, reason.trim()); setBusy(null); if (ok) { setRejecting(null); setReason(""); } }}>
                      {busy === c.id ? "…" : "ارفض الحوالة"}</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-2">
                  <button type="button" className="btn btn-ghost text-xs flex-1 justify-center" disabled={!!busy} onClick={() => { setRejecting(c.id); setReason(""); }}>رفض</button>
                  <button type="button" className="btn btn-primary text-xs flex-1 justify-center" disabled={!!busy || !c.owner_id}
                    onClick={async () => { setBusy(c.id); const r = await onApprove(c); setBusy(null); if (r === "near_dup") setNearDup(c.id); }}>{busy === c.id ? "…" : "✔ اعتماد وإصدار السند"}</button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose} disabled={!!busy}>إغلاق</button>
      </div>
    </Overlay>
  );
}

// ─── علامة «ملاك» ───────────────────────────────────────────────
export type MullakPay = { id: string; amount: number; paid_on: string; receipt_no?: string | null; payer_name?: string | null; unit_label?: string | null;
  mullak_registered?: boolean | null; mullak_invoice_no?: string | null; reverses?: string | null };

/** زر «مسجّلة في ملاك ✓» مع رقم الفاتورة الاختياري */
export function MullakToggle({ p, onSet }: { p: MullakPay; onSet: (p: MullakPay, on: boolean, inv: string | null) => Promise<boolean> }) {
  const [edit, setEdit] = useState(false);
  const [inv, setInv] = useState(p.mullak_invoice_no || "");
  const [busy, setBusy] = useState(false);
  if (p.mullak_registered && !edit) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold rounded-md px-2 py-1 bg-[#E6F4EC] text-[#137a50]">مسجّلة في ملاك ✓{p.mullak_invoice_no ? <> · <span dir="ltr">{p.mullak_invoice_no}</span></> : ""}</span>
        <button type="button" className="btn btn-ghost text-xs" onClick={() => setEdit(true)}>تعديل</button>
      </span>
    );
  }
  if (!edit) return <button type="button" className="btn btn-ghost text-xs" onClick={() => setEdit(true)}>سجّلتها في ملاك؟</button>;
  return (
    <span className="grid grid-cols-[minmax(0,1fr)] gap-1.5 w-full">
      <input className="fld" value={inv} maxLength={60} dir="ltr" onChange={(e) => setInv(e.target.value)} placeholder="رقم فاتورة ملاك (اختياري)" aria-label="رقم فاتورة ملاك" />
      <span className="flex flex-wrap gap-1.5">
        <button type="button" className="btn btn-primary text-xs" disabled={busy}
          onClick={async () => { setBusy(true); const ok = await onSet(p, true, inv.trim() || null); setBusy(false); if (ok) setEdit(false); }}>{busy ? "…" : "✓ مسجّلة في ملاك"}</button>
        {p.mullak_registered && <button type="button" className="btn btn-ghost text-xs" disabled={busy}
          onClick={async () => { setBusy(true); const ok = await onSet(p, false, null); setBusy(false); if (ok) setEdit(false); }}>إزالة العلامة</button>}
        <button type="button" className="btn btn-ghost text-xs" onClick={() => setEdit(false)}>إلغاء</button>
      </span>
    </span>
  );
}

/** كل دفعات الجمعية مع تصفية «لم تُسجَّل في ملاك» */
export function MullakModal({ rows, loading, onSet, onClose }: {
  rows: MullakPay[] | null; loading: boolean; onSet: (p: MullakPay, on: boolean, inv: string | null) => Promise<boolean>; onClose: () => void;
}) {
  const [only, setOnly] = useState(true);
  const list = (rows || []).filter((r) => !only || !r.mullak_registered);
  const missing = (rows || []).filter((r) => !r.mullak_registered).length;
  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="mk-h" className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 id="mk-h" className="font-display font-bold text-deep text-lg">الدفعات ومنصة «ملاك»</h3>
        <p className="text-sm text-muted mb-3">علّم كل دفعة سجّلتها أيضًا في منصة «ملاك» الرسمية (مع رقم فاتورتها إن شئت) — فيعرف المالك أنها مسجّلة رسميًّا، وتعرف أنت ما بقي.</p>
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <button type="button" className={`hoa-chip ${only ? "hoa-chip-on" : ""}`} aria-pressed={only} onClick={() => setOnly(true)}>دفعات لم تُسجَّل في ملاك {missing}</button>
          <button type="button" className={`hoa-chip ${!only ? "hoa-chip-on" : ""}`} aria-pressed={!only} onClick={() => setOnly(false)}>كل الدفعات {(rows || []).length}</button>
        </div>
        {loading && <div className="text-center text-muted py-6 text-sm">جارٍ التحميل…</div>}
        {!loading && !list.length && <div className="text-center text-muted py-6 text-sm">{only ? "كل الدفعات مسجّلة في ملاك ✓" : "لا دفعات بعد."}</div>}
        <div className="flex flex-col gap-2">
          {list.map((p) => (
            <div key={p.id} className="rounded-xl border border-line bg-paper p-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 items-start">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{p.payer_name || "—"}{p.unit_label ? ` · وحدة ${p.unit_label}` : ""}</div>
                <div className="text-xs text-muted">{arDate(p.paid_on)}{p.receipt_no ? <> · <span dir="ltr">{p.receipt_no}</span></> : ""}</div>
              </div>
              <b className="tabular-nums text-deep">{riyalsAr(Number(p.amount), sar)}</b>
              <div className="col-span-2"><MullakToggle p={p} onSet={onSet} /></div>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
      </div>
    </Overlay>
  );
}

// ─── طلبات الصيانة ─────────────────────────────────────────────
export type HoaRequest = { id: string; owner_id: string | null; owner_name: string | null; unit: string | null; category: string; location: string;
  description: string; status: "new" | "in_progress" | "done" | "rejected"; manager_note: string | null; expense_id: string | null;
  created_at: string; updated_at: string; closed_at: string | null };
export type RequestLog = { id: number; request_id: string; status_from: string | null; status_to: string; note: string | null; created_at: string };

const riyadhDay = (ts?: string | null) => {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const STATUS_CLS: Record<string, string> = {
  new: "bg-[#FDF0DC] text-[#9A5B00]", in_progress: "bg-[#E8EEF9] text-[#1E3A8A]", done: "bg-[#E6F4EC] text-[#137a50]", rejected: "bg-[#FBE9E7] text-[#a5322c]",
};

export function RequestsPanel({ rows, logs, expenses, error, onSet, onReload }: {
  rows: HoaRequest[] | null; logs: RequestLog[]; expenses: { id: string; label: string }[]; error?: string | null;
  onSet: (r: HoaRequest, status: HoaRequest["status"], note: string | null, expense: string | null) => Promise<boolean>; onReload: () => void;
}) {
  const [f, setF] = useState<"open" | "closed" | "all">("open");
  const [edit, setEdit] = useState<string | null>(null);
  const [st, setSt] = useState<HoaRequest["status"]>("in_progress");
  const [note, setNote] = useState("");
  const [exp, setExp] = useState("");
  const [busy, setBusy] = useState(false);
  const all = rows || [];
  const isOpen = (r: HoaRequest) => r.status === "new" || r.status === "in_progress";
  const list = all.filter((r) => f === "all" || (f === "open" ? isOpen(r) : !isOpen(r)));
  return (
    <div className="bg-white rounded-2xl border border-line shadow-sm p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
        <div className="min-w-0">
          <h3 className="font-display font-bold text-deep text-lg">طلبات الصيانة</h3>
          <p className="text-xs text-muted">يفتحها الملاك من صفحاتهم (نص فقط). كل تغيير حالة يُسجَّل ويراه صاحب الطلب، وصفحة الشفافية تعرض الأعداد فقط.</p>
        </div>
        <button type="button" className="btn btn-ghost text-xs" onClick={onReload} aria-label="تحديث الطلبات">↻</button>
      </div>
      <div className="flex gap-1.5 flex-wrap mt-3">
        {([["open", `مفتوحة ${all.filter(isOpen).length}`], ["closed", `مغلقة ${all.filter((r) => !isOpen(r)).length}`], ["all", `الكل ${all.length}`]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={f === k} className={`hoa-chip ${f === k ? "hoa-chip-on" : ""}`} onClick={() => setF(k)}>{l}</button>
        ))}
      </div>
      {error && <p className="text-sm text-late mt-3">{error}</p>}
      {rows === null && !error && <p className="text-sm text-muted mt-3">جارٍ التحميل…</p>}
      {rows && !list.length && <p className="text-sm text-muted mt-3 text-center py-6">{f === "open" ? "لا طلبات مفتوحة." : "لا طلبات."}</p>}
      <div className="flex flex-col gap-2 mt-3">
        {list.map((r) => {
          const lg = logs.filter((x) => x.request_id === r.id);
          return (
            <div key={r.id} className="rounded-xl border border-line bg-paper p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{requestCatAr(r.category)} <span className="text-xs text-muted font-normal">· {requestLocAr(r.location)}</span></div>
                  <div className="text-xs text-muted truncate">{r.owner_name || "مالك محذوف"}{r.unit ? ` · وحدة ${r.unit}` : ""} · {arDate(riyadhDay(r.created_at))}</div>
                </div>
                <span className={`text-xs font-semibold rounded-lg px-2.5 py-1 ${STATUS_CLS[r.status] || ""}`}>{REQUEST_STATUS_AR[r.status]}</span>
              </div>
              <p className="text-sm text-[#33413d] mt-1.5 break-words whitespace-pre-line">{r.description}</p>
              {r.manager_note && <p className="text-xs mt-1 rounded-lg bg-paper2 px-2.5 py-1.5 break-words">ملاحظتك للمالك: {r.manager_note}</p>}
              {r.expense_id && <p className="text-xs text-muted mt-1">مرتبط بسند صرف ✓</p>}
              {lg.length > 1 && (
                <details className="mt-1.5 text-xs text-muted"><summary className="cursor-pointer min-h-[44px] flex items-center">سجل الحالات ({lg.length})</summary>
                  <ul className="pr-3 list-disc">{lg.map((x) => <li key={x.id}>{arDate(riyadhDay(x.created_at))}: {x.status_from ? `${REQUEST_STATUS_AR[x.status_from] || x.status_from} ← ` : ""}{REQUEST_STATUS_AR[x.status_to] || x.status_to}{x.note ? ` — ${x.note}` : ""}</li>)}</ul>
                </details>
              )}
              {edit === r.id ? (
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">
                  <label className="text-xs font-semibold text-deep">الحالة
                    <select className="fld mt-1" value={st} onChange={(e) => setSt(e.target.value as any)}>
                      {(["new", "in_progress", "done", "rejected"] as const).map((k) => <option key={k} value={k}>{REQUEST_STATUS_AR[k]}</option>)}
                    </select></label>
                  <label className="text-xs font-semibold text-deep">ملاحظة للمالك {st === "rejected" ? "(سبب الرفض — مطلوب)" : "(اختياري)"}
                    <input className="fld mt-1" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="مثال: تم التواصل مع شركة المصاعد، الزيارة الأحد" /></label>
                  {expenses.length > 0 && (st === "done" || st === "in_progress") && (
                    <label className="text-xs font-semibold text-deep">ربط بسند صرف (اختياري)
                      <select className="fld mt-1" value={exp} onChange={(e) => setExp(e.target.value)}>
                        <option value="">— بلا ربط —</option>
                        {expenses.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select></label>
                  )}
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-ghost text-xs flex-1 justify-center" onClick={() => setEdit(null)}>إلغاء</button>
                    <button type="button" className="btn btn-primary text-xs flex-1 justify-center"
                      disabled={busy || (st === "rejected" && note.trim().length < 3 && !r.manager_note)}
                      onClick={async () => { setBusy(true); const ok = await onSet(r, st, note.trim() || null, exp || null); setBusy(false); if (ok) setEdit(null); }}>
                      {busy ? "…" : "حفظ الحالة"}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-2 justify-end">
                  {r.status === "new" && <button type="button" className="btn btn-primary text-xs" disabled={busy}
                    onClick={async () => { setBusy(true); await onSet(r, "in_progress", null, null); setBusy(false); }}>بدأ التنفيذ</button>}
                  {r.status === "in_progress" && <button type="button" className="btn btn-primary text-xs" disabled={busy}
                    onClick={() => { setEdit(r.id); setSt("done"); setNote(""); setExp(""); }}>✓ أُنجز</button>}
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => { setEdit(r.id); setSt(r.status === "new" ? "in_progress" : r.status); setNote(""); setExp(""); }}>تغيير الحالة / ملاحظة</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { REQUEST_CATEGORIES };
