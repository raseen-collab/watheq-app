"use client";
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

  async function load() {
    setErr(null);
    const { data, error } = await supabase.from("invoices")
      .select("id,invoice_no,issue_date,due_date,period_label,amount,status,notes")
      .eq("tenant_id", tenant.id)
      .order("issue_date", { ascending: false })
      .order("invoice_no", { ascending: false })
      .limit(500);
    if (error) { setErr(error.message); setRows([]); return; }
    setRows((data || []) as Invoice[]);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant.id]);

  function reprint(v: Invoice) {
    openDoc(invoiceHTML(tenant as any, property as any, {
      invoice_no: v.invoice_no,
      amount: Number(v.amount) || 0,
      due_date: v.due_date || v.issue_date || "",
      period_label: v.period_label || "",
    }, issuer || {}));
  }

  /* الفاتورة الضريبية لا تُحذف — تُلغى ويبقى رقمها في التسلسل. الحذف يترك
     فجوة في الترقيم يصعب تفسيرها لأي مراجعة. */
  async function voidInvoice(v: Invoice) {
    setBusy(v.id); setErr(null);
    const { error } = await supabase.from("invoices").update({ status: "void" }).eq("id", v.id);
    setBusy(null);
    if (error) { setErr(`تعذّر الإلغاء: ${error.message}`); return; }
    await load();
  }

  const live = (rows || []).filter((v) => v.status !== "void");
  const total = live.reduce((a, v) => a + (Number(v.amount) || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-line px-5 py-4 flex items-center justify-between gap-3">
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
              {rows.length !== live.length && <><span className="text-muted">·</span>
                <span className="text-muted">{rows.length - live.length} ملغاة</span></>}
            </div>

            <div className="overflow-x-auto border border-line rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-paper-2 text-muted text-xs">
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
                    const s = STATUS[String(v.status || "issued")] || STATUS.issued;
                    const voided = v.status === "void";
                    return (
                      <tr key={v.id} className={`border-t border-line ${voided ? "opacity-55" : ""}`}>
                        <td className="px-3 py-2 font-semibold text-deep whitespace-nowrap" dir="ltr">{v.invoice_no}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {v.issue_date ? arDate(v.issue_date) : "—"}
                          {v.issue_date && <div className="text-[11px] text-muted">{hijriShort(v.issue_date)}</div>}
                        </td>
                        <td className="px-3 py-2 text-muted">{v.period_label || "—"}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap"><b>{sar(Number(v.amount) || 0)}</b></td>
                        <td className="px-3 py-2">
                          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex gap-1.5 justify-end">
                            <button onClick={() => reprint(v)} className="btn btn-ghost text-xs px-2.5 py-1">
                              🖨️ {voided ? "عرض" : "طباعة"}
                            </button>
                            {!voided && canIssue && (
                              <button onClick={() => voidInvoice(v)} disabled={busy === v.id}
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

            <p className="text-[11px] text-muted mt-3 leading-relaxed">
              إعادة الطباعة تُخرج الفاتورة بأرقامها كما صدرت — لا تتغيّر إن تغيّر إيجار الوحدة لاحقًا.
              والفاتورة الملغاة يبقى رقمها في التسلسل ولا يُعاد استخدامه.
            </p>
          </>)}
        </div>
      </div>
    </div>
  );
}
