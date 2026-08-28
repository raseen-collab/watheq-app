"use client";
/**
 * 💸 مصروفات العقار — ما دفعه المكتب نيابة عن المالك (سباك، فواتير،
 * رسوم…). هذه الأرقام هي النصف الثاني من تقرير المالك: بدونها يعرف
 * المالك كم دخل ولا يعرف كم صافي له.
 * مكوّن مستقل: يدير CRUD على جدول expenses ويبلّغ الأب ليُحدث تقاريره.
 */
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, today } from "@/lib/utils";
import { arDate } from "@/lib/documents";
import { EXPENSE_CATS, catIcon, catLabel, sumExpenses, type ExpenseRow, type ExpenseCategory } from "@/lib/expenses";

const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const ymLabel = (ym: string) => /^\d{4}-\d{2}$/.test(ym) ? `${AR_MONTHS[Number(ym.slice(5, 7)) - 1] || ym} ${ym.slice(0, 4)}` : ym;

type Row = ExpenseRow & { id: string };

export default function ExpensesModal({ propertyId, propertyName, unitWord, onClose }: {
  propertyId: string; propertyName: string; unitWord: string; onClose: () => void;
}) {
  const supabase = createClient();
  const thisMonth = today().slice(0, 7);
  const [ym, setYm] = useState(thisMonth);
  const [rows, setRows] = useState<Row[] | null>(null); // null = لم يُحمَّل بعد
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);

  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 3500); }

  function friendly(e: any) {
    const t = String(e?.message || e);
    return /expenses/.test(t) && /(not exist|relation|schema cache)/i.test(t)
      ? "شغّل ملف schema-v8.sql في Supabase أولًا ثم أعد المحاولة" : t;
  }

  async function load(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    const from = `${month}-01`;
    const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const { data, error } = await supabase.from("expenses")
      .select("*").eq("property_id", propertyId)
      .gte("spent_on", from).lte("spent_on", to)
      .order("spent_on", { ascending: false }).limit(500);
    if (error) { flash("err", friendly(error)); setRows([]); }
    else setRows((data || []) as Row[]);
  }
  useEffect(() => { void load(ym); /* إعادة التحميل عند تغيير الشهر */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);

  const total = useMemo(() => sumExpenses(rows || []), [rows]);

  async function save(d: Partial<ExpenseRow>) {
    setBusy(true);
    try {
      const uid = await officeId(supabase);
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const { data, error } = await supabase.from("expenses")
        .insert({ ...d, property_id: propertyId, user_id: uid }).select("*").single();
      if (error) throw error;
      // إن كان تاريخ المصروف داخل الشهر المعروض أظهره فورًا
      if (String((data as Row).spent_on || "").startsWith(ym)) setRows([data as Row, ...(rows || [])]);
      flash("ok", "سُجّل المصروف");
      setAdding(false);
    } catch (e) { flash("err", friendly(e)); } finally { setBusy(false); }
  }

  async function remove(x: Row) {
    if (!confirm(`حذف مصروف «${catLabel(x.category)} — ${sar(Number(x.amount))} ريال»؟`)) return;
    const { error } = await supabase.from("expenses").delete().eq("id", x.id);
    if (error) return flash("err", friendly(error));
    setRows((rows || []).filter((r) => r.id !== x.id));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display font-bold text-deep text-xl">💸 المصروفات — {propertyName}</h2>
            <p className="text-sm text-muted mt-1">ما دفعته نيابة عن المالك — يُخصم تلقائيًّا في تقرير المالك ليظهر الصافي.</p>
          </div>
          <button className="btn btn-ghost text-xs" onClick={onClose}>إغلاق</button>
        </div>

        {msg && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
            msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>
            {msg.m}
          </div>
        )}

        <div className="flex items-end justify-between gap-3 mt-4 flex-wrap">
          <label className="block">
            <span className="block text-sm font-semibold mb-1">الشهر</span>
            <input className="fld" type="month" value={ym} max={thisMonth} onChange={(e) => setYm(e.target.value)} />
          </label>
          <div className="text-left">
            <div className="text-[.7rem] text-muted">إجمالي {ymLabel(ym)}</div>
            <div className="font-display font-bold text-xl text-deep">{sar(total)} <span className="text-xs font-normal">ريال</span></div>
          </div>
          <button className="btn btn-gold text-sm" onClick={() => setAdding(true)}>+ مصروف</button>
        </div>

        {adding && <ExpenseForm unitWord={unitWord} busy={busy} onCancel={() => setAdding(false)} onSave={save} />}

        {rows === null ? (
          <p className="text-sm text-muted mt-4">جارٍ التحميل…</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted mt-4 bg-paper border border-line rounded-lg p-3">
            لا مصروفات مسجّلة في {ymLabel(ym)}. سجّل أول مصروف — حتى فاتورة السباك الصغيرة — وسيظهر خصمها في تقرير المالك تلقائيًّا.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {rows.map((x) => (
              <div key={x.id} className="rounded-xl border border-line bg-paper p-3 flex items-center gap-3">
                <span className="text-lg" aria-hidden>{catIcon(x.category)}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{catLabel(x.category)}{x.unit ? ` — ${unitWord} ${x.unit}` : ""}</div>
                  <div className="text-xs text-muted">{arDate(x.spent_on)}{x.note ? ` · ${x.note}` : ""}</div>
                </div>
                <div className="font-bold text-sm shrink-0">{sar(Number(x.amount))}</div>
                <button className="btn btn-ghost text-xs text-late shrink-0" onClick={() => remove(x)}>حذف</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExpenseForm({ unitWord, busy, onSave, onCancel }: {
  unitWord: string; busy: boolean; onSave: (d: Partial<ExpenseRow>) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<any>({ category: "maintenance", amount: "", spent_on: today(), unit: "", note: "" });
  const ready = Number(d.amount) > 0 && !!d.spent_on;
  return (
    <div className="mt-4 border border-line rounded-xl p-4 bg-paper space-y-3">
      <div>
        <span className="block text-sm font-semibold mb-1">التصنيف</span>
        <div className="grid grid-cols-5 gap-2">
          {(Object.keys(EXPENSE_CATS) as ExpenseCategory[]).map((k) => (
            <button key={k} type="button" onClick={() => setD({ ...d, category: k })}
              className={`border-2 rounded-lg py-2 text-[.68rem] font-semibold transition ${
                d.category === k ? "border-gold bg-[#FBF1DF]" : "border-line bg-white hover:border-goldSoft"}`}>
              {EXPENSE_CATS[k].icon}<br />{EXPENSE_CATS[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">المبلغ (ريال)</span>
          <input className="fld" type="number" min={1} value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} placeholder="350" /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">التاريخ</span>
          <input className="fld" type="date" value={d.spent_on} onChange={(e) => setD({ ...d, spent_on: e.target.value })} /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">{unitWord} <span className="text-muted text-xs font-normal">— اختياري</span></span>
          <input className="fld" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} /></label>
      </div>
      <label className="block"><span className="block text-sm font-semibold mb-1">ملاحظة <span className="text-muted text-xs font-normal">— اختياري</span></span>
        <input className="fld" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="إصلاح تسريب دورة مياه شقة 12" /></label>
      <div className="flex gap-2 justify-end">
        <button className="btn btn-ghost text-sm" onClick={onCancel} disabled={busy}>إلغاء</button>
        <button className="btn btn-gold text-sm" disabled={!ready || busy}
          onClick={() => onSave({
            category: d.category, amount: Number(d.amount), spent_on: d.spent_on,
            unit: String(d.unit || "").trim() || null, note: String(d.note || "").trim() || null,
          })}>
          {busy ? "…" : "تسجيل"}
        </button>
      </div>
    </div>
  );
}
