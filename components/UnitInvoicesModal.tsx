"use client";
import { friendlyError } from "@/lib/friendlyError";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { invoiceHTML, openDoc, arDate } from "@/lib/documents";
import { hijriShort } from "@/lib/hijri";
import { sar } from "@/lib/utils";

/**
 * سجلّ فواتير الوحدة.
 *
 * جدول `invoices` كان يُكتب فيه ولا يُقرأ منه في أي شاشة: كل فاتورة تُحفظ
 * برقمها وتاريخها ومبلغها، ثم تُطبع وتختفي. فمكتب أصدر ثلاث فواتير لوحدة
 * لا يستطيع أن يرى أيها صدر ولا أن يعيد طباعة واحدة طلبها المستأجر — ولا
 * أن يتأكد أنه لم يُصدر فاتورتين لنفس الدفعة.
 *
 * إعادة الطباعة تستعمل المبلغ والفترة وتاريخ الاستحقاق **المحفوظة** لا
 * المحسوبة اليوم: الفاتورة الضريبية مستند صدر بأرقامه، ولا يجوز أن يتغيّر
 * محتواه إن تغيّر إيجار الوحدة أو عدد دفعاتها لاحقًا.
 */

type Invoice = {
  id: string; invoice_no: string; issue_date: string | null; due_date: string | null;
  period_label: string | null; amount: number | null; status: string | null; notes: string | null;
  created_at?: string | null; vat_enabled?: boolean | null; vat_rate?: number | null; vat_inclusive?: boolean | null;
  /** (v95) الإشعار الدائن ولقطة البائع والمشتري */
  doc_type?: string | null; ref_invoice_id?: string | null; reason?: string | null;
  seller_mode?: string | null; seller_name?: string | null; seller_vat?: string | null; seller_cr?: string | null; seller_address?: string | null;
  buyer_name?: string | null; buyer_id?: string | null; unit_label?: string | null; property_name?: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  issued: { label: "صادرة", cls: "bg-[#FDF6E3] text-[#7a5c12] border-[#EAD9A8]" },
  paid:   { label: "مسدَّدة", cls: "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]" },
  void:   { label: "ملغاة", cls: "bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]" },
};

export default function UnitInvoicesModal({ tenant, property, issuer, onClose, db, canIssue }: {
  tenant: any; property: any; issuer?: any; onClose: () => void;
  /** قاعدة التجربة في الذاكرة — صفحة /demo تمرّرها */
  db?: any;
  /** صلاحية إصدار الفواتير — بدونها لا إلغاء */
  canIssue?: boolean;
}) {
  const supabase: any = db || createClient();
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* (v95) الإلغاء بإشعار دائن: سبب مكتوب إلزامي قبل الإصدار */
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [reason, setReason] = useState("");

  async function load() {
    setErr(null);
    const { data, error } = await supabase.from("invoices")
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("issue_date", { ascending: false })
      .order("invoice_no", { ascending: false })
      .limit(500);
    if (error) { setErr(friendlyError(error.message)); setRows([]); return; }
    setRows((data || []) as Invoice[]);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant.id]);

  const byId = new Map((rows || []).map((r) => [r.id, r]));
  /* الإشعار الدائن لكل فاتورة ملغاة (واحد لكل فاتورة — فهرس فريد في v95) */
  const cnOf = new Map((rows || []).filter((r) => r.doc_type === "credit_note" && r.ref_invoice_id).map((r) => [r.ref_invoice_id!, r]));

  /** يفتح الفاتورة أو الإشعار بإعدادات الضريبة ولقطة البائع المحفوظة يوم الإصدار */
  function printRow(v: Invoice, ref?: Invoice | null) {
    /* (مراجعة 30 سبتمبر 2026) بإعدادات الضريبة المحفوظة يوم الإصدار إن وُجدت —
       كان تغيير نسبة العقار أو وضعه لاحقًا يغيّر مبلغ فاتورة صدرت وسُلّمت.
       الفواتير الأقدم من schema-v56 بلا إعدادات محفوظة فتُطبع كما كانت. */
    const snap = v.vat_enabled === true || v.vat_enabled === false;
    const pAt = snap ? { ...(property as any), vat_enabled: v.vat_enabled, vat_rate: v.vat_rate ?? (property as any)?.vat_rate, vat_inclusive: v.vat_inclusive } : property;
    const tAt = snap ? { ...(tenant as any), vat_mode: v.vat_enabled ? "on" : "off" } : tenant;
    openDoc(invoiceHTML(tAt as any, pAt as any, {
      ...v,
      amount: Number(v.amount) || 0,
      due_date: v.due_date || (v.doc_type === "credit_note" ? "" : v.issue_date || ""),
      period_label: v.period_label || "",
      /* بتاريخها ووقتها وحالتها الأصلية — لا بتاريخ اليوم */
      issue_date: v.issue_date || null,
      status: v.status || null,
      created_at: v.created_at || null,
      vat_snapshot: snap ? !!v.vat_enabled : null,
      ref_invoice_no: ref?.invoice_no || null,
      ref_issue_date: ref?.issue_date || null,
      credit_note_no: cnOf.get(v.id)?.invoice_no || null,
    }, issuer || {}));
  }
  const reprint = (v: Invoice) => printRow(v, v.ref_invoice_id ? byId.get(v.ref_invoice_id) : null);

  /* الفاتورة الضريبية لا تُحذف ولا تُعدَّل — تُلغى بإشعار دائن يرجع إليها بسبب مكتوب،
     من نفس تسلسل الأرقام (الدليل التفصيلي للفوترة الإلكترونية §5.6 و§4.3). */
  async function confirmVoid() {
    const v = voiding; if (!v) return;
    const why = reason.trim();
    if (why.length < 3) { setErr("اكتب سبب الإلغاء — يُطبع في الإشعار الدائن."); return; }
    setBusy(v.id); setErr(null);
    const { data, error } = await supabase.rpc("watheq_void_invoice", { p_invoice: v.id, p_reason: why });
    setBusy(null);
    if (error) { setErr(`تعذّر الإلغاء: ${friendlyError(error.message)}`); return; }
    setVoiding(null); setReason("");
    await load();
    /* يُفتح الإشعار الدائن ليُسلَّم للمستأجر — من صفّه المحفوظ (لقطة القاعدة) */
    const cnId = (data as any)?.id;
    if (cnId) {
      const { data: cn } = await supabase.from("invoices").select("*").eq("id", cnId).limit(1);
      const row = (cn || [])[0] as Invoice | undefined;
      if (row) printRow(row, v);
    }
  }

  const invs = (rows || []).filter((v) => v.doc_type !== "credit_note");
  const live = invs.filter((v) => v.status !== "void");
  const cns = (rows || []).length - invs.length;
  const total = live.reduce((a, v) => a + (Number(v.amount) || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-line px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-deep">فواتير الوحدة</h3>
            <p className="text-xs text-muted mt-0.5">
              {tenant.unit ? `${tenant.unit} · ` : ""}{tenant.name || "—"} · {property.name}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none px-2" aria-label="إغلاق">×</button>
        </div>

        <div className="p-5">
          {err && <p className="text-sm text-late mb-3">{err}</p>}

          {rows === null ? <p className="text-sm text-muted">جارٍ التحميل…</p>
          : rows.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted">لم تُصدر فواتير لهذه الوحدة بعد.</p>
              <p className="text-xs text-muted mt-1">أصدر أول فاتورة من زر «فاتورة» في صف الوحدة.</p>
            </div>
          ) : (<>
            <div className="flex flex-wrap gap-3 mb-3 text-xs">
              <span className="text-muted">{live.length === 1 ? "فاتورة واحدة سارية" : `${live.length} فواتير سارية`}</span>
              <span className="text-muted">·</span>
              <span className="text-muted">إجماليها <b className="text-deep tabular-nums">{sar(total)}</b> ريال</span>
              {invs.length !== live.length && <><span className="text-muted">·</span>
                <span className="text-muted">{invs.length - live.length} ملغاة</span></>}
              {cns > 0 && <><span className="text-muted">·</span>
                <span className="text-muted">{cns === 1 ? "إشعار دائن واحد" : `${cns} إشعارات دائنة`}</span></>}
            </div>

            <div className="overflow-x-auto border border-line rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-paper2 text-muted text-xs">
                  <tr>
                    <th className="text-start px-3 py-2 font-semibold">رقم الفاتورة</th>
                    <th className="text-start px-3 py-2 font-semibold">تاريخ الإصدار</th>
                    <th className="text-start px-3 py-2 font-semibold">الفترة</th>
                    <th className="text-start px-3 py-2 font-semibold">المبلغ</th>
                    <th className="text-start px-3 py-2 font-semibold">الحالة</th>
                    <th className="text-start px-3 py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((v) => {
                    const isCN = v.doc_type === "credit_note";
                    const s = isCN ? { label: "إشعار دائن", cls: "bg-[#FBF1DF] text-[#8a5a11] border-[#EAD9A8]" } : STATUS[String(v.status || "issued")] || STATUS.issued;
                    const voided = !isCN && v.status === "void";
                    return (
                      <tr key={v.id} className={`border-t border-line ${voided ? "opacity-55" : ""}`}>
                        <td className="px-3 py-2 font-semibold text-deep whitespace-nowrap" dir="ltr">{v.invoice_no}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {v.issue_date ? arDate(v.issue_date) : "—"}
                          {v.issue_date && <div className="text-[11px] text-muted">{hijriShort(v.issue_date)}</div>}
                        </td>
                        <td className="px-3 py-2 text-muted">
                          {v.period_label || "—"}
                          {isCN && <div className="text-[11px]">عن <span dir="ltr" className="whitespace-nowrap">{v.ref_invoice_id ? byId.get(v.ref_invoice_id)?.invoice_no || "—" : "—"}</span>{v.reason ? ` · ${v.reason}` : ""}</div>}
                          {voided && cnOf.get(v.id) && <div className="text-[11px]">أُلغيت بـ <span dir="ltr" className="whitespace-nowrap">{cnOf.get(v.id)!.invoice_no}</span></div>}
                        </td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap"><b>{isCN ? "−" : ""}{sar(Number(v.amount) || 0)}</b></td>
                        <td className="px-3 py-2">
                          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex gap-1.5 justify-end">
                            <button onClick={() => reprint(v)} className="btn btn-ghost text-xs px-2.5 py-1">
                              🖨️ {voided ? "عرض" : "طباعة"}
                            </button>
                            {!voided && !isCN && canIssue && (
                              <button onClick={() => { setVoiding(v); setReason(""); setErr(null); }} disabled={busy === v.id}
                                className="btn btn-ghost text-xs px-2.5 py-1 text-late">
                                {busy === v.id ? "…" : "إلغاء"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {voiding && (
              <div className="mt-3 border border-[#F5C6C2] bg-[#FFF5F4] rounded-xl p-3">
                <div className="text-sm font-semibold text-[#a5322c] mb-1">إلغاء الفاتورة <span dir="ltr">{voiding.invoice_no}</span> بإشعار دائن</div>
                <p className="text-xs text-[#7a3b36] mb-2 leading-relaxed">
                  يصدر إشعار دائن برقم جديد يرجع لهذه الفاتورة ويلغيها بكامل قيمتها، ويُطبع لتسلّمه للمستأجر.
                  الفاتورة لا تُحذف ولا تُعدَّل — لتصحيح المبلغ أصدر فاتورة جديدة بعد الإلغاء.
                </p>
                <input className="fld text-sm" value={reason} maxLength={300} autoFocus
                  onChange={(e) => setReason(e.target.value)} placeholder="سبب الإلغاء — مثال: خطأ في المبلغ، صدرت مرتين" />
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-gold text-sm" disabled={busy === voiding.id} onClick={() => void confirmVoid()}>
                    {busy === voiding.id ? "…" : "إصدار الإشعار الدائن"}
                  </button>
                  <button className="btn btn-ghost text-sm" onClick={() => { setVoiding(null); setReason(""); }}>تراجع</button>
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted mt-3 leading-relaxed">
              إعادة الطباعة تُخرج الفاتورة بأرقامها وبيانات مُصدِرها كما صدرت — لا تتغيّر إن تغيّر الإيجار أو الإعدادات لاحقًا.
              الفاتورة لا تُحذف ولا تُعدَّل: تُلغى بإشعار دائن من نفس تسلسل الأرقام.
            </p>
          </>)}
        </div>
      </div>
    </div>
  );
}
