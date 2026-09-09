"use client";
// ============================================================
// وثيق — المصروفات على مستوى المكتب
//
// كانت المصروفات محبوسة داخل كل عقار: لا صورة واحدة، ولا طباعة لمالك عن
// عقاراته كلها، ولا معرفة بما هو مستحق ولم يُدفع. هذه الشاشة تجمعها بفلترة
// على المالك والفترة والتصنيف، وتفصل ما يتحمّله المالك عمّا على المكتب.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { expensesRegisterHTML, openDoc } from "@/lib/documents";
import { EXPENSE_CATS, catLabel, isBillable, PAID_BY, type ExpenseRow } from "@/lib/expenses";
import DateField from "@/components/DateField";

type Row = ExpenseRow & { id: string; property_id: string; property_name?: string; owner_name?: string };
const sar = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export default function ExpensesOverview({ properties, issuer, onClose }: {
  properties: { id: string; name: string; owner_name?: string | null }[];
  issuer?: any;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-${p2(now.getMonth() + 1)}-01`);
  const [to, setTo] = useState(iso(now));
  const [owner, setOwner] = useState("");
  const [cat, setCat] = useState("");
  const [prop, setProp] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const owners = useMemo(() =>
    [...new Set(properties.map((p) => (p.owner_name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")),
    [properties]);
  const nameOf = useMemo(() => Object.fromEntries(properties.map((p) => [p.id, p])), [properties]);

  useEffect(() => {
    let alive = true;
    setRows(null); setErr(null);
    supabase.from("expenses").select("*").gte("spent_on", from).lte("spent_on", to)
      .order("spent_on", { ascending: false }).limit(5000)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setErr(/does not exist|column/.test(error.message) ? "شغّل schema-v30 في قاعدة البيانات أولًا." : error.message); setRows([]); return; }
        setRows((data || []).map((x: any) => ({
          ...x, property_name: nameOf[x.property_id]?.name || "—",
          owner_name: nameOf[x.property_id]?.owner_name || "",
        })));
      });
    return () => { alive = false; };
  }, [supabase, from, to, nameOf]);

  const shown = (rows || []).filter((r) =>
    (!owner || r.owner_name === owner) && (!cat || String(r.category || "other") === cat) && (!prop || r.property_id === prop));

  const total = shown.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const billable = shown.filter(isBillable).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const onOffice = total - billable;
  const due = shown.filter((r) => r.status === "due").reduce((a, r) => a + (Number(r.amount) || 0), 0);

  const byProp = useMemo(() => {
    const m: Record<string, { name: string; owner: string; total: number; n: number }> = {};
    shown.forEach((r) => {
      const k = r.property_id;
      m[k] ||= { name: r.property_name || "—", owner: r.owner_name || "—", total: 0, n: 0 };
      m[k].total += Number(r.amount) || 0; m[k].n++;
    });
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [shown]);

  function print() {
    openDoc(expensesRegisterHTML(shown as any,
      { label: owner ? `${owner} — ${from} إلى ${to}` : `${from} إلى ${to}`, from, to },
      issuer || {}, { owner: owner || null, category: cat || null }));
  }

  const preset = (months: number) => {
    const n = new Date();
    setFrom(iso(new Date(n.getFullYear(), n.getMonth() - months + 1, 1)));
    setTo(iso(n));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 grid place-items-center p-3" onClick={onClose}>
      <div className="bg-paper rounded-2xl border border-line w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-deep text-[#EAF1EE] px-5 py-3 flex items-center justify-between">
          <div>
            <div className="font-display font-bold text-goldSoft">💸 مصروفات المكتب — كل العقارات</div>
            <div className="text-[11px] opacity-75">فلترة بالمالك والفترة والتصنيف · جاهزة للطباعة</div>
          </div>
          <button className="text-sm opacity-80 hover:opacity-100" onClick={onClose}>إغلاق ✕</button>
        </div>

        {/* الفلاتر */}
        <div className="bg-white border-b border-line p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {([["هذا الشهر", 1], ["آخر 3 أشهر", 3], ["آخر 6 أشهر", 6], ["آخر 12 شهرًا", 12]] as const).map(([l, m]) => (
              <button key={l} type="button" onClick={() => preset(m)} className="text-xs px-3 py-1.5 rounded-full border border-line text-muted hover:text-deep hover:border-deep">{l}</button>
            ))}
          </div>
          <div className="grid sm:grid-cols-5 gap-2">
            <div><span className="block text-[11px] text-muted mb-1">من</span><DateField value={from} onChange={(v) => v && setFrom(v)} /></div>
            <div><span className="block text-[11px] text-muted mb-1">إلى</span><DateField value={to} onChange={(v) => v && setTo(v)} /></div>
            <div>
              <span className="block text-[11px] text-muted mb-1">المالك</span>
              <select className="fld" value={owner} onChange={(e) => { setOwner(e.target.value); setProp(""); }}>
                <option value="">كل الملّاك</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <span className="block text-[11px] text-muted mb-1">العقار</span>
              <select className="fld" value={prop} onChange={(e) => setProp(e.target.value)}>
                <option value="">كل العقارات</option>
                {properties.filter((p) => !owner || (p.owner_name || "") === owner).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <span className="block text-[11px] text-muted mb-1">التصنيف</span>
              <select className="fld" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">كل التصنيفات</option>
                {Object.entries(EXPENSE_CATS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* الأرقام */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
          {[
            { v: sar(total), l: `الإجمالي · ${shown.length} قيدًا`, c: "text-deep" },
            { v: sar(billable), l: "تُخصم من المالك", c: "text-late" },
            { v: sar(onOffice), l: "على المكتب", c: "text-muted" },
            { v: sar(due), l: "مستحقة لم تُدفع", c: due > 0 ? "text-[#9A4B00]" : "text-muted" },
          ].map((x) => (
            <div key={x.l} className="bg-white border border-line rounded-xl p-3">
              <div className={`text-xl font-bold tabular-nums ${x.c}`}>{x.v}</div>
              <div className="text-[11px] text-muted">{x.l}</div>
            </div>
          ))}
        </div>

        {/* الجدول */}
        <div className="flex-1 overflow-auto px-3 pb-3">
          {err && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mb-2">{err}</div>}
          {rows === null ? <p className="text-center text-sm text-muted py-8">جارٍ التحميل…</p>
            : shown.length === 0 ? <p className="text-center text-sm text-muted py-8">لا مصروفات في هذه الفترة بهذه الفلترة.</p> : (
            <>
              {byProp.length > 1 && (
                <div className="bg-white border border-line rounded-xl overflow-hidden mb-3">
                  <div className="px-3 py-2 text-xs font-bold text-deep border-b border-line">حسب العقار</div>
                  {byProp.map((r) => (
                    <div key={r.name} className="flex items-center justify-between px-3 py-1.5 text-sm border-b border-line last:border-0">
                      <span>{r.name} <span className="text-[11px] text-muted">· {r.owner} · {r.n} قيد</span></span>
                      <b className="tabular-nums">{sar(r.total)}</b>
                    </div>
                  ))}
                </div>
              )}
              <div className="bg-white border border-line rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-paper text-xs text-muted sticky top-0">
                    <tr>
                      <th className="text-right px-3 py-2">التاريخ</th><th className="text-right px-3 py-2">العقار</th>
                      <th className="text-right px-3 py-2">التصنيف</th><th className="text-right px-3 py-2">المورّد</th>
                      <th className="text-left px-3 py-2">المبلغ</th><th className="text-right px-3 py-2">على من</th>
                      <th className="text-right px-3 py-2">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 300).map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{r.spent_on}</td>
                        <td className="px-3 py-1.5">{r.property_name}{r.unit ? <span className="text-[11px] text-muted"> · وحدة {r.unit}</span> : null}</td>
                        <td className="px-3 py-1.5">{catLabel(r.category)}</td>
                        <td className="px-3 py-1.5 text-muted">{r.vendor || "—"}{r.invoice_no ? <div className="text-[10px]" dir="ltr">{r.invoice_no}</div> : null}</td>
                        <td className="px-3 py-1.5 text-left font-semibold tabular-nums">{sar(r.amount)}</td>
                        <td className="px-3 py-1.5 text-xs">{isBillable(r) ? "المالك" : <span className="text-muted">المكتب</span>}
                          {r.paid_by ? <div className="text-[10px] text-muted">{PAID_BY[String(r.paid_by)]}</div> : null}</td>
                        <td className="px-3 py-1.5">{r.status === "due"
                          ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FDECD2] text-[#9A4B00]">مستحقة</span>
                          : <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#E7F3EC] text-[#137a50]">مدفوعة</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length > 300 && <div className="text-center text-[11px] text-muted py-2">عُرض 300 من {shown.length} — ضيّق الفترة أو الفلترة.</div>}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-line bg-white p-3 flex gap-2">
          <button className="btn btn-gold" onClick={print} disabled={!shown.length}>🖨️ طباعة السجل</button>
          <span className="text-[11px] text-muted self-center">
            «تُخصم من المالك» تدخل في صافيه بتقرير المالك · «على المكتب» لا تدخل.
          </span>
        </div>
      </div>
    </div>
  );
}
