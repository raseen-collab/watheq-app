"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveSubClaim, rejectSubClaim } from "@/app/admin/subs/actions";
import { PROP_PLANS, HOA_PLANS } from "@/lib/pricing";

export type AdminClaim = {
  id: string; user_id: string; name: string; account_type: string;
  prop_plan: string | null; hoa_plan: string | null; months: number; amount: number;
  payer_name: string; bank_ref: string | null; transfer_date: string; status: string; created_at: string;
};

/** طلبات «أرسلت الحوالة» — طابق مع كشف البنك ثم فعّل بضغطة (schema-v71) */
export default function SubClaimsPanel({ claims }: { claims: AdminClaim[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  if (!claims.length) return null;

  const label = (c: AdminClaim) => [
    c.prop_plan ? PROP_PLANS.find((x) => x.id === c.prop_plan)?.name : "",
    c.hoa_plan ? `جمعيات: ${HOA_PLANS.find((x) => x.id === c.hoa_plan)?.name}` : "",
  ].filter(Boolean).join(" + ");

  async function approve(c: AdminClaim) {
    if (busy) return;
    if (!confirmAction(`تفعيل ${c.name} — ${label(c)} — ${Number(c.amount).toLocaleString("en-US")} ريال؟`)) return;
    setBusy(c.id);
    const r = await approveSubClaim(c.id);
    setMsg((m) => ({ ...m, [c.id]: r.ok ? `✓ فُعّل حتى ${r.extendedTo} · فاتورة ${r.invoiceNo}` : `✗ ${r.error}` }));
    setBusy(null);
    if (r.ok) router.refresh();
  }
  async function reject(c: AdminClaim) {
    if (busy) return;
    const reason = window.prompt("سبب الرفض (يظهر لصاحب الحساب):", "لم تصل الحوالة إلى الحساب");
    if (reason === null) return;
    setBusy(c.id);
    const r = await rejectSubClaim(c.id, reason);
    setMsg((m) => ({ ...m, [c.id]: r.ok ? "رُفض الطلب" : `✗ ${r.error}` }));
    setBusy(null);
    if (r.ok) router.refresh();
  }

  return (
    <section className="bg-white border-2 border-gold/40 rounded-2xl p-5 mb-6">
      <h2 className="font-display font-bold text-deep text-lg mb-1">💳 طلبات اشتراك بانتظار التأكيد ({claims.length})</h2>
      <p className="text-xs text-muted mb-4">طابق كل طلب مع كشف البنك (الاسم والمبلغ والتاريخ) قبل التفعيل. التفعيل يسجّل الدفعة ويصدر الفاتورة ويمدّد الاشتراك.</p>
      <div className="space-y-3">
        {claims.map((c) => (
          <div key={c.id} className="border border-line rounded-xl p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <b className="text-deep">{c.name}</b>
              <span className="text-muted">{c.created_at.slice(0, 10)}</span>
            </div>
            <div className="mt-1">{label(c)} · {c.months === 12 ? "سنوي" : "شهري"} · <b>{Number(c.amount).toLocaleString("en-US")} ريال</b></div>
            <div className="text-muted mt-1">المحوِّل: {c.payer_name}{c.bank_ref ? ` · المرجع: ${c.bank_ref}` : ""} · التاريخ: {c.transfer_date}</div>
            {c.status === "processing" && <div className="text-[#8a5a11] mt-1">قيد المعالجة… حدّث الصفحة بعد لحظات.</div>}
            {msg[c.id] && <div className="mt-2 font-semibold">{msg[c.id]}</div>}
            {c.status === "pending" && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => approve(c)} disabled={!!busy} className="btn btn-gold text-sm">{busy === c.id ? "…" : "✓ وصلت — فعّل"}</button>
                <button onClick={() => reject(c)} disabled={!!busy} className="btn text-sm bg-white border border-line text-[#8f2b26]">رفض</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function confirmAction(text: string) {
  return typeof window !== "undefined" ? window.confirm(text) : false;
}
