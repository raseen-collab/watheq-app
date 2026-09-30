"use client";
/**
 * وثيق — بوابة الملاك في اتحاد الملاك: أدوات المكتب (schema-v61).
 *
 *  • MemberLinkButton — رابط المالك الخاص: إنشاء/نسخ/إرسال عبر واتساب/إبطال.
 *  • HoaDocumentsPanel — إصدار مستندات الجمعية (محاضر، إشعارات، تعاميم)
 *    ومتابعة اطلاع الملاك واعتمادهم.
 * مستقل بذاته: يتصل بـ /api/hoa/member-link و /api/hoa/documents فقط.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { openExternal, today } from "@/lib/utils";
import { plainTextToHoaHtml, sanitizeHoaHtml } from "@/lib/hoaSanitize";

// ─── أدوات ─────────────────────────────────────────────────────
/** رقم واتساب سعودي: 05xxxxxxxx / 5xxxxxxxx / +9665… / 009665… → 9665xxxxxxxx، وإلا "" */
export function saudiWa(phone?: string | null): string {
  let p = String(phone || "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (/^05\d{8}$/.test(p)) p = "966" + p.slice(1);
  else if (/^5\d{8}$/.test(p)) p = "966" + p;
  return /^9665\d{8}$/.test(p) ? p : "";
}

const KIND_LABEL: Record<string, string> = { minutes: "محضر", notice: "إشعار", circular: "تعميم", budget: "موازنة", other: "مستند آخر" };
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const stamp = (ts?: string | null) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const [y, m, dd] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-");
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y} · ${t}`;
};
const dayAr = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
};

async function postJSON(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || "تعذّر تنفيذ الطلب");
  return j;
}

function Modal({ onClose, children, wide }: { onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

const LEGAL_NOTE = "الاعتماد عبر الرابط يُسجَّل باسم المالك المكتوب ووقت الرد وعنوان الشبكة وبصمة المستند، فهو دليل موثَّق على الاطلاع والموافقة، لكنه ليس توقيعًا إلكترونيًّا معتمدًا (مثل التوقيع عبر «نفاذ»).";

// ─── ١) رابط المالك ─────────────────────────────────────────────
export type HoaOwnerLite = { id: string; name: string; unit?: string | null; phone?: string | null };

export function MemberLinkButton({ owner, associationName, className }: {
  owner: HoaOwnerLite; associationName: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchLink = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const j = await postJSON("/api/hoa/member-link", { owner_id: owner.id, action: "get" });
      setUrl(`${window.location.origin}${j.path}`);
      setRevoked(false);
    } catch (e: any) { setErr(e?.message || "تعذّر إنشاء الرابط"); }
    finally { setBusy(false); }
  }, [owner.id]);

  const onOpen = () => { setOpen(true); setConfirming(false); setCopied(false); fetchLink(); };
  const close = useCallback(() => { setOpen(false); setConfirming(false); }, []);

  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch {
      const el = document.getElementById(`hoa-link-${owner.id}`) as HTMLInputElement | null;
      el?.select();
    }
  };

  const wa = saudiWa(owner.phone);
  const message = url ? [
    `السلام عليكم ${owner.name}،`,
    `هذا رابطك الخاص في ${associationName}${owner.unit ? ` (${owner.unit})` : ""}:`,
    url,
    "",
    "تجد فيه حالة اشتراكك وسندات دفعاتك، ومستندات الجمعية (المحاضر والإشعارات) التي تحتاج اطلاعك أو اعتمادك — دون حساب أو كلمة مرور.",
    "الرابط خاص بك، فلا تشاركه مع أحد.",
  ].join("\n") : "";
  const sendWa = () => { if (url) openExternal(`https://wa.me/${wa}?text=${encodeURIComponent(message)}`); };

  const revoke = async () => {
    setBusy(true); setErr(null);
    try {
      await postJSON("/api/hoa/member-link", { owner_id: owner.id, action: "revoke" });
      setUrl(null); setRevoked(true); setConfirming(false);
    } catch (e: any) { setErr(e?.message || "تعذّر إبطال الرابط"); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" className={className || "btn btn-ghost text-xs"} onClick={onOpen} title="رابط خاص للمالك يرى فيه حسابه ومستندات الجمعية">
        رابط المالك
      </button>
      {open && (
        <Modal onClose={close}>
          <h3 className="font-display font-bold text-deep text-lg mb-1">الرابط الخاص بالمالك</h3>
          <p className="text-sm text-muted mb-4">{owner.name}{owner.unit ? ` · ${owner.unit}` : ""} — يرى فيه حالة اشتراكه وسنداته ومستندات الجمعية، ويعتمد ما يحتاج اعتمادًا. بلا حساب ولا كلمة مرور.</p>

          {busy && !url && <p className="text-sm text-muted">جارٍ التجهيز…</p>}
          {err && <p className="text-sm text-late mb-3">{err}</p>}

          {revoked && !url && (
            <div className="rounded-xl bg-[#F6F2E8] p-3 text-sm mb-3">
              أُبطل الرابط — من يفتحه الآن يرى صفحة «الرابط غير متاح».
              <div className="mt-2"><button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={fetchLink}>إنشاء رابط جديد</button></div>
            </div>
          )}

          {url && (
            <>
              <div className="flex gap-2 items-stretch">
                <input id={`hoa-link-${owner.id}`} className="fld text-xs" dir="ltr" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn btn-ghost text-xs whitespace-nowrap" onClick={copy}>{copied ? "نُسخ ✓" : "نسخ"}</button>
              </div>
              <button type="button" className="btn btn-wa w-full justify-center mt-3" onClick={sendWa}>
                إرسال عبر واتساب{wa ? "" : " (اختر المحادثة)"}
              </button>
              {!wa && <p className="text-xs text-muted mt-1">لا يوجد رقم جوال سعودي صحيح لهذا المالك — سيفتح واتساب لتختار المحادثة بنفسك.</p>}
              <p className="text-xs text-muted mt-3">الرسالة لا تحتوي أي مبالغ — الأرقام تظهر داخل الرابط فقط.</p>

              <div className="border-t border-line mt-4 pt-3">
                {!confirming ? (
                  <button type="button" className="text-late text-sm font-semibold underline" onClick={() => setConfirming(true)}>إبطال هذا الرابط</button>
                ) : (
                  <div className="rounded-xl bg-[#FBE9E7] p-3 text-sm">
                    <p className="font-semibold text-[#8f2b26]">سيتوقف هذا الرابط فورًا ولن يفتح عند المالك. قراراته السابقة على المستندات تبقى محفوظة.</p>
                    <div className="flex gap-2 mt-3">
                      <button type="button" className="btn btn-ghost text-xs flex-1 justify-center" onClick={() => setConfirming(false)}>تراجع</button>
                      <button type="button" className="btn text-xs flex-1 justify-center bg-late text-white" disabled={busy} onClick={revoke}>تأكيد الإبطال</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="flex justify-end mt-4"><button type="button" className="btn btn-ghost" onClick={close}>إغلاق</button></div>
        </Modal>
      )}
    </>
  );
}

// ─── ٢) مستندات الجمعية ─────────────────────────────────────────
type OwnerRow = {
  owner_id: string | null; name: string; unit: string | null; seen_at: string | null;
  decision: "approve" | "reject" | null; decided_at: string | null; typed_name: string | null;
  comment: string | null; ip: string | null; former?: boolean;
};
type DocRow = {
  id: string; kind: string; title: string; requires_signature: boolean; closes_at: string | null;
  created_at: string; cancelled_at: string | null; body_sha256: string | null;
  counts: { approve: number; reject: number; seen: number; none: number };
  owners: OwnerRow[];
};
export type HoaDocPrefill = { title: string; kind: "minutes" | "notice" | "circular" | "budget" | "other"; body_html: string };

export function HoaDocumentsPanel({ association, owners, prefill, onPrefillUsed }: {
  association: { id: string; name: string };
  owners: { id: string; name: string; unit?: string | null }[];
  prefill?: HoaDocPrefill | null;
  onPrefillUsed?: () => void;
}) {
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<null | { title: string; kind: string; text: string; html: string | null; requires: boolean; closes: string }>(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelAsk, setCancelAsk] = useState<string | null>(null);
  const [preview, setPreview] = useState<null | { title: string; html: string; sha: string | null }>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/hoa/documents?association_id=${encodeURIComponent(association.id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "تعذّر تحميل المستندات");
      setDocs(j.documents || []);
    } catch (e: any) { setErr(e?.message || "تعذّر تحميل المستندات"); setDocs([]); }
  }, [association.id]);

  useEffect(() => { setDocs(null); load(); }, [load]);
  /* عدد الملاك تغيّر (إضافة/حذف) ⇒ أعد الحساب */
  const ownersKey = useMemo(() => owners.map((o) => o.id).join(","), [owners]);
  useEffect(() => { if (docs) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ownersKey]);

  useEffect(() => {
    if (!prefill) return;
    setForm({ title: prefill.title, kind: prefill.kind, text: "", html: sanitizeHoaHtml(prefill.body_html), requires: prefill.kind === "minutes", closes: "" });
    setFormErr(null);
    onPrefillUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const openNew = () => { setForm({ title: "", kind: "notice", text: "", html: null, requires: false, closes: "" }); setFormErr(null); };

  const submit = async () => {
    if (!form) return;
    const body_html = form.html ?? plainTextToHoaHtml(form.text);
    if (!form.title.trim()) return setFormErr("اكتب عنوان المستند.");
    if (!body_html.replace(/<[^>]*>/g, "").trim()) return setFormErr("اكتب نص المستند.");
    if (form.requires && form.closes && form.closes < today()) return setFormErr("آخر موعد للرد لا يكون في الماضي.");
    setSaving(true); setFormErr(null);
    try {
      await postJSON("/api/hoa/documents", {
        association_id: association.id, kind: form.kind, title: form.title.trim(), body_html,
        requires_signature: form.requires, closes_at: form.requires && form.closes ? form.closes : null,
      });
      setForm(null);
      await load();
    } catch (e: any) { setFormErr(e?.message || "تعذّر إصدار المستند"); }
    finally { setSaving(false); }
  };

  const cancelDoc = async (id: string) => {
    try { await postJSON("/api/hoa/documents", { action: "cancel", id }); setCancelAsk(null); await load(); }
    catch (e: any) { setErr(e?.message || "تعذّر الإلغاء"); }
  };

  const openPreview = async (d: DocRow) => {
    try {
      const r = await fetch(`/api/hoa/documents?id=${encodeURIComponent(d.id)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error);
      setPreview({ title: d.title, html: j.document.body_html || "", sha: j.document.body_sha256 || null });
    } catch (e: any) { setErr(e?.message || "تعذّر فتح المستند"); }
  };

  const total = owners.length;

  return (
    <div className="card bg-white rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-display font-bold text-deep text-lg">مستندات الملاك</h3>
          <p className="text-xs text-muted">محاضر وإشعارات وتعاميم تظهر في صفحة كل مالك ({association.name})، ومعها من اطّلع ومن اعتمد.</p>
        </div>
        <button type="button" className="btn btn-gold text-sm" onClick={openNew}>مستند جديد</button>
      </div>
      <p className="text-xs text-muted mt-2 rounded-lg bg-[#F6F2E8] p-2">{LEGAL_NOTE}</p>

      {err && <p className="text-sm text-late mt-3">{err}</p>}
      {docs === null && <p className="text-sm text-muted mt-3">جارٍ التحميل…</p>}
      {docs && docs.length === 0 && !err && (
        <p className="text-sm text-muted mt-3">لا مستندات بعد. أصدر أول مستند، ثم أرسل لكل مالك رابطه (زر «رابط المالك») — يظهر المستند في صفحته تلقائيًّا.</p>
      )}

      <div className="mt-3 space-y-3">
        {(docs || []).map((d) => {
          const c = d.counts;
          const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
          const cancelled = !!d.cancelled_at;
          const closed = !!(d.closes_at && d.closes_at < today());
          return (
            <div key={d.id} className={`rounded-xl border border-line p-3 ${cancelled ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-deep break-words">{d.title}</div>
                  <div className="text-xs text-muted">
                    {KIND_LABEL[d.kind] || "مستند"} · {stamp(d.created_at)}
                    {d.requires_signature ? (d.closes_at ? ` · آخر موعد ${dayAr(d.closes_at)}${closed ? " (انتهى)" : ""}` : " · يحتاج اعتمادًا") : " · للاطلاع"}
                    {cancelled && " · ملغى"}
                  </div>
                </div>
                <button type="button" className="btn btn-ghost text-xs" onClick={() => openPreview(d)}>عرض</button>
              </div>

              {total > 0 && (
                <>
                  <div className="flex h-2 rounded-full overflow-hidden bg-[#EEE8DA] mt-3" aria-hidden>
                    <div className="bg-[#137a50]" style={{ width: pct(c.approve) }} />
                    <div className="bg-[#a5322c]" style={{ width: pct(c.reject) }} />
                    <div className="bg-[#E7C877]" style={{ width: pct(c.seen) }} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-2">
                    {d.requires_signature && <span className="text-[#137a50] font-semibold">اعتمد {c.approve}</span>}
                    {d.requires_signature && <span className="text-[#a5322c] font-semibold">رفض {c.reject}</span>}
                    <span className="text-[#9A5B00]">{d.requires_signature ? "اطّلع دون رد" : "اطّلع"} {d.requires_signature ? c.seen : c.seen + c.approve + c.reject}</span>
                    <span className="text-muted">لم يفتحه {c.none} من {total}</span>
                  </div>
                </>
              )}

              <div className="flex gap-3 mt-2 text-xs">
                <button type="button" className="font-semibold underline text-deep" onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                  {expanded === d.id ? "إخفاء تفاصيل الملاك" : "تفاصيل الملاك"}
                </button>
                {!cancelled && cancelAsk !== d.id && (
                  <button type="button" className="font-semibold underline text-late" onClick={() => setCancelAsk(d.id)}>إلغاء المستند</button>
                )}
              </div>
              {cancelAsk === d.id && (
                <div className="rounded-lg bg-[#FBE9E7] p-2 mt-2 text-xs">
                  <p className="font-semibold text-[#8f2b26]">يختفي المستند من صفحات الملاك ويتوقف الرد عليه. الردود المسجَّلة تبقى محفوظة. لا يمكن التراجع.</p>
                  <div className="flex gap-2 mt-2">
                    <button type="button" className="btn btn-ghost text-xs" onClick={() => setCancelAsk(null)}>تراجع</button>
                    <button type="button" className="btn text-xs bg-late text-white" onClick={() => cancelDoc(d.id)}>تأكيد الإلغاء</button>
                  </div>
                </div>
              )}

              {expanded === d.id && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-muted text-right">
                      <th className="py-1 pe-2">المالك</th><th className="py-1 pe-2">الحالة</th><th className="py-1 pe-2">الوقت</th><th className="py-1">التفاصيل</th>
                    </tr></thead>
                    <tbody>
                      {d.owners.map((o, i) => (
                        <tr key={(o.owner_id || "x") + i} className="border-t border-line align-top">
                          <td className="py-1 pe-2">{o.name}{o.unit ? ` · ${o.unit}` : ""}{o.former ? " (محذوف)" : ""}</td>
                          <td className="py-1 pe-2 whitespace-nowrap">
                            {o.decision === "approve" ? <span className="text-[#137a50] font-semibold">اعتمد</span>
                              : o.decision === "reject" ? <span className="text-[#a5322c] font-semibold">رفض</span>
                              : o.seen_at ? <span className="text-[#9A5B00]">اطّلع</span>
                              : <span className="text-muted">لم يفتحه</span>}
                          </td>
                          <td className="py-1 pe-2 whitespace-nowrap">{stamp(o.decided_at || o.seen_at)}</td>
                          <td className="py-1 text-muted">
                            {o.typed_name ? <>بالاسم: {o.typed_name}</> : null}
                            {o.ip ? <span dir="ltr" className="block">IP {o.ip}</span> : null}
                            {o.comment ? <span className="block">ملاحظة: {o.comment}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {form && (
        <Modal wide onClose={() => !saving && setForm(null)}>
          <h3 className="font-display font-bold text-deep text-lg mb-1">مستند جديد للملاك</h3>
          <p className="text-xs text-muted mb-4">يظهر في صفحة كل مالك في {association.name}. بعد الإصدار لا يُعدَّل نصّه — يمكن إلغاؤه وإصدار نسخة جديدة.</p>
          <div className="space-y-3">
            <label className="block"><span className="block text-sm font-semibold mb-1">العنوان</span>
              <input className="fld" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="مثال: محضر اجتماع الجمعية العمومية السنوي" />
            </label>
            <label className="block"><span className="block text-sm font-semibold mb-1">النوع</span>
              <select className="fld" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {form.html !== null ? (
              <div>
                <span className="block text-sm font-semibold mb-1">النص (مُولَّد)</span>
                <div className="rounded-lg border border-line p-3 max-h-64 overflow-auto text-sm bg-[#FFFEFB]" dir="rtl"
                  /* نُظِّف عند الاستلام (sanitizeHoaHtml) — لا style ولا سكربت يتسرّب إلى اللوحة؛ ويُنظَّف مجددًا في الخادم */
                  dangerouslySetInnerHTML={{ __html: form.html }} />
                <button type="button" className="text-xs underline mt-1" onClick={() => setForm({ ...form, html: null })}>استبدل بنص أكتبه بنفسي</button>
                <p className="text-xs text-muted mt-1">التنسيقات المتقدمة (الألوان والخطوط) لا تُنقل — يبقى النص والجداول والعناوين.</p>
              </div>
            ) : (
              <label className="block"><span className="block text-sm font-semibold mb-1">النص</span>
                <textarea className="fld" rows={8} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })}
                  placeholder="اكتب نص المستند. سطر فارغ بين الفقرات." />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={form.requires} onChange={(e) => setForm({ ...form, requires: e.target.checked })} />
              يحتاج اعتماد الملاك (موافقة / رفض)
            </label>
            {form.requires && (
              <label className="block"><span className="block text-sm font-semibold mb-1">آخر موعد للرد (اختياري)</span>
                <input className="fld" type="date" min={today()} value={form.closes} onChange={(e) => setForm({ ...form, closes: e.target.value })} />
              </label>
            )}
            {form.requires && <p className="text-xs text-muted">{LEGAL_NOTE}</p>}
          </div>
          {formErr && <p className="text-sm text-late mt-3">{formErr}</p>}
          <div className="flex gap-2 mt-5">
            <button type="button" className="btn btn-ghost flex-1 justify-center" disabled={saving} onClick={() => setForm(null)}>إلغاء</button>
            <button type="button" className="btn btn-gold flex-1 justify-center" disabled={saving} onClick={submit}>{saving ? "جارٍ الإصدار…" : "إصدار المستند"}</button>
          </div>
        </Modal>
      )}

      {preview && (
        <Modal wide onClose={() => setPreview(null)}>
          <h3 className="font-display font-bold text-deep text-lg mb-2">{preview.title}</h3>
          {/* نص منظَّف في الخادم (sanitizeHoaHtml) عند الإصدار وعند القراءة */}
          <div className="rounded-lg border border-line p-3 text-sm bg-[#FFFEFB] overflow-x-auto" dir="rtl" dangerouslySetInnerHTML={{ __html: preview.html }} />
          {preview.sha && <p className="text-xs text-muted mt-2">بصمة المستند: <span dir="ltr" className="font-mono">{preview.sha.slice(0, 16)}</span></p>}
          <div className="flex justify-end mt-4"><button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>إغلاق</button></div>
        </Modal>
      )}
    </div>
  );
}
