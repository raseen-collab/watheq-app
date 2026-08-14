"use client";

import { useMemo, useState } from "react";
import { openDoc, subscriptionInvoiceHTML } from "@/lib/documents";
import { recordSubPayment } from "@/app/admin/subs/actions";

export type SubRow = {
  id: string;
  full_name: string | null;
  org_name: string | null;
  account_type: string | null;
  billing_phone: string | null;
  plan: string | null;
  trial_ends_at: string | null;
  subscribed_until: string | null;
  created_at: string | null;
};

export type PayRow = {
  id: string;
  user_id: string;
  invoice_no: string | null;
  months: number;
  amount: number;
  plan: string | null;
  method: string | null;
  note: string | null;
  paid_at: string;
  extended_to: string | null;
};

/** أسماء الباقات كما تُعرض للعميل — تختلف بحسب نوع الحساب */
const PLAN_AR: Record<string, { landlord: string; hoa: string }> = {
  basic: { landlord: "باقة المالك", hoa: "الأساسية" },
  pro: { landlord: "الاحترافية", hoa: "الاحترافية" },
  full: { landlord: "باقة المكتب", hoa: "الشاملة" },
};
const planLabel = (plan?: string | null, acct?: string | null) => {
  if (!plan) return "بلا باقة";
  const p = PLAN_AR[plan];
  if (!p) return plan;
  return acct === "hoa_manager" ? p.hoa : p.landlord;
};

const METHODS: { v: string; l: string }[] = [
  { v: "transfer", l: "تحويل بنكي" },
  { v: "cash", l: "نقدًا" },
  { v: "pos", l: "شبكة" },
  { v: "other", l: "أخرى" },
];

/** مدد التجديد كما تُقرأ لا كأرقام مجرّدة */
const DURATIONS: { m: number; l: string; verb: string }[] = [
  { m: 1, l: "شهر", verb: "شهرًا" },
  { m: 3, l: "3 أشهر", verb: "3 أشهر" },
  { m: 6, l: "6 أشهر", verb: "6 أشهر" },
  { m: 12, l: "سنة", verb: "سنة" },
  { m: 24, l: "سنتان", verb: "سنتين" },
];
const durVerb = (m: number) => DURATIONS.find((d) => d.m === m)?.verb || `${m} شهرًا`;
const durLabel = (m: number) => DURATIONS.find((d) => d.m === m)?.l || `${m} شهرًا`;

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو",
                   "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

/** 31 أغسطس 2026 — ميلادي بأسماء عربية، بلا اعتماد على لغة الجهاز */
function arDate(v?: string | null): string {
  if (!v) return "—";
  const t = Date.parse(v);
  if (isNaN(t)) return "—";
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`;
}

/** صياغة العدد كما تُنطق: يوم · يومان · أيام · يومًا */
function daysWord(n: number): string {
  const a = Math.abs(n);
  if (a === 1) return "يوم واحد";
  if (a === 2) return "يومان";
  if (a >= 3 && a <= 10) return `${a} أيام`;
  return `${a} يومًا`;
}

const day = (v?: string | null) => (v ? String(v).slice(0, 10) : "—");
const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const daysTo = (v?: string | null) => {
  if (!v) return null;
  const t = Date.parse(v);
  if (isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
};

type State = "paid" | "soon" | "ended" | "trial" | "trial_ended";

function stateOf(r: SubRow): { s: State; label: string; tone: string } {
  const sub = daysTo(r.subscribed_until);
  if (sub !== null && sub >= 0) {
    return sub <= 14
      ? { s: "soon", label: `بقي ${daysWord(sub)}`, tone: "text-gold font-semibold" }
      : { s: "paid", label: `بقي ${daysWord(sub)}`, tone: "text-paid font-semibold" };
  }
  if (sub !== null && sub < 0) {
    return { s: "ended", label: `انتهى قبل ${daysWord(sub)}`, tone: "text-late font-semibold" };
  }
  const tr = daysTo(r.trial_ends_at);
  if (tr !== null && tr >= 0) return { s: "trial", label: `تجربة · بقي ${daysWord(tr)}`, tone: "text-muted" };
  return { s: "trial_ended", label: "انتهت التجربة بلا اشتراك", tone: "text-late" };
}

export default function SubsAdmin({ rows, pays }: { rows: SubRow[]; pays: PayRow[] }) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState("");
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");

  const paysByUser = useMemo(() => {
    const m: Record<string, PayRow[]> = {};
    pays.forEach((p) => { (m[p.user_id] = m[p.user_id] || []).push(p); });
    return m;
  }, [pays]);

  const enriched = rows.map((r) => ({ r, st: stateOf(r), last: (paysByUser[r.id] || [])[0] || null }));

  const nPaid = enriched.filter((e) => e.st.s === "paid" || e.st.s === "soon").length;
  const nSoon = enriched.filter((e) => e.st.s === "soon").length;
  const nEnded = enriched.filter((e) => e.st.s === "ended").length;
  const revenue = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  function reset() {
    setMonths(1); setAmount(""); setPlan(""); setMethod("transfer"); setNote("");
  }

  async function submit(r: SubRow) {
    setBusy(true); setMsg(null);
    const res = await recordSubPayment({
      userId: r.id,
      months,
      amount: Number(amount) || 0,
      plan: plan || null,
      method,
      note,
    });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
    setMsg({ kind: "ok", text: `سُجّلت الدفعة · الاشتراك حتى ${arDate(res.extendedTo)} · فاتورة ${res.invoiceNo}` });
    setOpenFor(null);
    reset();
  }

  /** إصدار فاتورة من دفعة مسجَّلة */
  function invoice(r: SubRow, p: PayRow) {
    const from = new Date(p.extended_to || p.paid_at);
    from.setMonth(from.getMonth() - (p.months || 1));
    openDoc(
      subscriptionInvoiceHTML({
        invoice_no: p.invoice_no || `WTQ-${day(p.paid_at)}`,
        to_name: r.full_name || "—",
        to_org: r.org_name,
        to_phone: r.billing_phone,
        plan_label: planLabel(p.plan || r.plan, r.account_type),
        months: p.months,
        amount: Number(p.amount) || 0,
        from_date: from.toISOString().slice(0, 10),
        to_date: day(p.extended_to),
        method: p.method,
        paid_at: day(p.paid_at),
        // اترك vat_number فارغًا ما دمتَ غير مسجَّل في ضريبة القيمة المضافة
        vat_number: null,
      })
    );
  }

  const K = ({ v, l, tone }: { v: string; l: string; tone?: string }) => (
    <div className="bg-white border border-line rounded-xl p-4 shadow-sm">
      <div className={`font-display font-bold text-2xl leading-none ${tone || "text-deep"}`}>{v}</div>
      <div className="mt-1.5 text-sm text-muted">{l}</div>
    </div>
  );

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <K v={String(nPaid)} l="مشتركون حاليًّا" tone={nPaid ? "text-paid" : undefined} />
        <K v={String(nSoon)} l="ينتهي خلال 14 يومًا" tone={nSoon ? "text-gold" : undefined} />
        <K v={String(nEnded)} l="انتهى ولم يجدّد" tone={nEnded ? "text-late" : undefined} />
        <K v={sar(revenue)} l="إجمالي المحصَّل (ريال)" />
      </div>

      {msg && (
        <div className={`rounded-xl p-3 mb-4 text-sm border ${
          msg.kind === "ok"
            ? "bg-[#EAF6EE] border-[#BFE0CB] text-[#1b6b3a]"
            : "bg-[#FBE9E7] border-[#F5C6C2] text-[#a5322c]"}`}>
          {msg.text}
        </div>
      )}

      <div className="bg-white border border-line rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper2"><tr>
              <th className="p-2.5 text-right font-semibold">الحساب</th>
              <th className="p-2.5 text-right font-semibold">الباقة</th>
              <th className="p-2.5 text-right font-semibold">الحالة</th>
              <th className="p-2.5 text-right font-semibold">ينتهي في</th>
              <th className="p-2.5 text-right font-semibold">آخر دفعة</th>
              <th className="p-2.5 text-right font-semibold">إجراء</th>
            </tr></thead>
            <tbody>
              {enriched.map(({ r, st, last }) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="p-2.5">
                    <div className="font-semibold">{r.full_name || "—"}</div>
                    <div className="text-xs text-muted">{r.org_name || ""}</div>
                  </td>
                  <td className="p-2.5 text-xs whitespace-nowrap">{planLabel(r.plan, r.account_type)}</td>
                  <td className={`p-2.5 text-xs whitespace-nowrap ${st.tone}`}>{st.label}</td>
                  <td className="p-2.5 text-xs whitespace-nowrap">{arDate(r.subscribed_until)}</td>
                  <td className="p-2.5 text-xs whitespace-nowrap">
                    {last
                      ? <>{arDate(last.paid_at)} · {sar(Number(last.amount))} ريال</>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="p-2.5">
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => { setOpenFor(openFor === r.id ? null : r.id); setMsg(null); reset(); }}
                        className="btn btn-primary text-xs px-2.5">
                        {openFor === r.id ? "إلغاء" : "سجّل دفعة"}
                      </button>
                      {last && (
                        <button onClick={() => invoice(r, last)} className="btn btn-ghost text-xs px-2.5">
                          🧾 فاتورة
                        </button>
                      )}
                    </div>

                    {openFor === r.id && (
                      <div className="mt-3 bg-paper2 border border-line rounded-xl p-3 min-w-[280px]">
                        <div className="text-xs text-muted mb-2">المدة المجدَّدة</div>
                        <div className="flex gap-1.5 mb-3 flex-wrap">
                          {DURATIONS.map((d) => (
                            <button key={d.m} onClick={() => setMonths(d.m)}
                              className={`text-xs rounded-full px-3 py-1.5 border ${
                                months === d.m ? "bg-gold text-white border-gold font-semibold"
                                              : "bg-white text-deep border-line"}`}>
                              {d.l}
                            </button>
                          ))}
                        </div>

                        <div className="text-xs text-muted mb-2">الباقة</div>
                        <div className="flex gap-1.5 mb-3 flex-wrap">
                          {[{ v: "", l: "بلا تغيير" }, { v: "basic", l: planLabel("basic", r.account_type) },
                            { v: "pro", l: planLabel("pro", r.account_type) }, { v: "full", l: planLabel("full", r.account_type) }].map((o) => (
                            <button key={o.v} onClick={() => setPlan(o.v)}
                              className={`text-xs rounded-full px-3 py-1.5 border ${
                                plan === o.v ? "bg-gold text-white border-gold font-semibold"
                                             : "bg-white text-deep border-line"}`}>
                              {o.l}
                            </button>
                          ))}
                        </div>

                        <div className="flex gap-2 mb-3">
                          <input value={amount} onChange={(e) => setAmount(e.target.value)}
                            inputMode="numeric" placeholder="المبلغ (ريال)"
                            className="flex-1 border border-line rounded-lg px-2.5 py-1.5 text-sm bg-white" />
                          <select value={method} onChange={(e) => setMethod(e.target.value)}
                            className="border border-line rounded-lg px-2 py-1.5 text-sm bg-white">
                            {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                          </select>
                        </div>

                        <input value={note} onChange={(e) => setNote(e.target.value)}
                          placeholder="ملاحظة (اختياري)"
                          className="w-full border border-line rounded-lg px-2.5 py-1.5 text-sm bg-white mb-3" />

                        <button disabled={busy} onClick={() => submit(r)}
                          className="btn btn-primary w-full justify-center text-sm disabled:opacity-60">
                          {busy ? "…" : `أكّد الدفع وجدّد ${durVerb(months)}`}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!enriched.length && (
                <tr><td colSpan={6} className="p-8 text-center text-muted">لا حسابات.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pays.length > 0 && (
        <>
          <h2 className="font-semibold text-deep mb-2">سجلّ الدفعات</h2>
          <div className="bg-white border border-line rounded-2xl shadow-sm overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper2"><tr>
                  <th className="p-2.5 text-right font-semibold">التاريخ</th>
                  <th className="p-2.5 text-right font-semibold">الفاتورة</th>
                  <th className="p-2.5 text-right font-semibold">الحساب</th>
                  <th className="p-2.5 text-right font-semibold">المدة</th>
                  <th className="p-2.5 text-right font-semibold">المبلغ</th>
                  <th className="p-2.5 text-right font-semibold">يمتد إلى</th>
                </tr></thead>
                <tbody>
                  {pays.map((p) => {
                    const r = rows.find((x) => x.id === p.user_id);
                    return (
                      <tr key={p.id} className="border-t border-line">
                        <td className="p-2.5 text-xs whitespace-nowrap">{arDate(p.paid_at)}</td>
                        <td className="p-2.5 text-xs whitespace-nowrap">{p.invoice_no || "—"}</td>
                        <td className="p-2.5 text-xs">{r?.full_name || "—"}</td>
                        <td className="p-2.5 text-xs whitespace-nowrap">{durLabel(p.months)}</td>
                        <td className="p-2.5 text-xs whitespace-nowrap">{sar(Number(p.amount))} ريال</td>
                        <td className="p-2.5 text-xs whitespace-nowrap">{arDate(p.extended_to)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <p className="text-xs text-muted leading-relaxed">
        التمديد يبدأ من تاريخ الانتهاء إن كان الاشتراك ساريًا، ومن اليوم إن كان منتهيًا —
        فلا يخسر من جدّد مبكرًا أيامه، ولا يُمدَّد اشتراك إلى الماضي.
      </p>
    </>
  );
}
