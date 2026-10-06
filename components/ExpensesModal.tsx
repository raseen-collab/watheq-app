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
import { arDate, openDoc, expenseVoucherHTML, type ExpenseVoucher } from "@/lib/documents";
import { EXPENSE_CATS, catIcon, catLabel, sumExpenses, type ExpenseRow, type ExpenseCategory } from "@/lib/expenses";
import DateField from "@/components/DateField";

const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const ymLabel = (ym: string) => /^\d{4}-\d{2}$/.test(ym) ? `${AR_MONTHS[Number(ym.slice(5, 7)) - 1] || ym} ${ym.slice(0, 4)}` : ym;

type Row = ExpenseVoucher & { id: string };

export default function ExpensesModal({ propertyId, propertyName, unitWord, onClose, db, issuer, propertyType, ownerName, payeeHints }: {
  propertyId: string; propertyName: string; unitWord: string; onClose: () => void; db?: any;
  /** لسند الصرف (v74): هوية المكتب في الترويسة، ونوع العقار واسم المالك في المتن */
  issuer?: any; propertyType?: string | null; ownerName?: string | null;
  /** أسماء مقترحة للمستلم: مستأجرو العقار والمالك — والكتابة اليدوية مفتوحة */
  payeeHints?: string[];
}) {
  const supabase: any = db || createClient();
  const thisMonth = today().slice(0, 7);
  const [ym, setYm] = useState(thisMonth);
  const [rows, setRows] = useState<Row[] | null>(null); // null = لم يُحمَّل بعد
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);

  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 3500); }

  function friendly(e: any) {
    const t = String(e?.message || e);
    if (/payee_name|payee_ref|voucher_no/.test(t) && /(column|schema cache)/i.test(t))
      return "سند الصرف يحتاج تشغيل schema-v74 في Supabase أولًا — سجّل المصروف بلا سند الآن، أو اطلب التحديث.";
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
    /* حارس الازدواج: أشيع خطأ في المصروفات أن يُسجَّل المصروف مرتين —
       مرة من المكتب ومرة من الموظف، أو نقرتان. نفس العقار والتاريخ
       والمبلغ والتصنيف = تنبيه قبل الحفظ، لا منع (قد يتكرر فعلًا). */
    const dup = (rows || []).find((r) =>
      String(r.spent_on) === String(d.spent_on) &&
      Math.abs(Number(r.amount) - Number(d.amount)) < 0.01 &&
      String(r.category) === String(d.category));
    if (dup && !confirm(
      `يوجد مصروف مطابق مسجّل مسبقًا:\n${catLabel(dup.category)} — ${sar(Number(dup.amount))} ريال — ${dup.spent_on}` +
      `${dup.vendor ? ` — ${dup.vendor}` : ""}\n\nتسجيله مرة أخرى؟`
    )) return;
    setBusy(true);
    try {
      const uid = await officeId(supabase);
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const { data, error } = await supabase.from("expenses")
        .insert({ ...d, property_id: propertyId, user_id: uid }).select("*").single();
      if (error) throw error;
      // إن كان تاريخ المصروف داخل الشهر المعروض أظهره فورًا
      if (String((data as Row).spent_on || "").startsWith(ym)) setRows([data as Row, ...(rows || [])]);
      const vno = (data as Row).voucher_no;
      flash("ok", vno ? `سُجّل المصروف · سند صرف ${vno}` : "سُجّل المصروف");
      setAdding(false);
      if (vno) printVoucher(data as Row);
    } catch (e) { flash("err", friendly(e)); } finally { setBusy(false); }
  }

  async function remove(x: Row) {
    if (!confirm(`حذف مصروف «${catLabel(x.category)} — ${sar(Number(x.amount))} ريال»؟${x.voucher_no ? `\n\nله سند صرف ${x.voucher_no} — يُلغى معه، ولا يُعاد استعمال رقمه.` : ""}`)) return;
    const { data: _del, error } = await supabase.from("expenses").delete().eq("id", x.id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { flash("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) return flash("err", friendly(error));
    setRows((rows || []).filter((r) => r.id !== x.id));
  }

  function printVoucher(x: Row) {
    openDoc(expenseVoucherHTML(x, { name: propertyName, property_type: propertyType, owner_name: ownerName }, issuer || {}));
  }

  /* إصدار سند لمصروف سُجّل قبل ذلك بلا مستلم: القاعدة تعطي الرقم عند إضافة الاسم */
  const [issuing, setIssuing] = useState<{ id: string; name: string; ref: string } | null>(null);
  async function issueVoucher() {
    if (!issuing || !issuing.name.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.from("expenses")
        .update({ payee_name: issuing.name.trim(), payee_ref: issuing.ref.trim() || null })
        .eq("id", issuing.id).select("*");
      if (error) throw error;
      const row = (data || [])[0] as Row | undefined;
      if (!row) { flash("err", "هذا الإجراء يحتاج صلاحية تسجيل المصروفات — اطلبه من صاحب المكتب."); return; }
      setRows((rows || []).map((r) => (r.id === row.id ? row : r)));
      setIssuing(null);
      flash("ok", row.voucher_no ? `صدر سند الصرف ${row.voucher_no}` : "حُفظ المستلم");
      if (row.voucher_no) printVoucher(row);
    } catch (e) { flash("err", friendly(e)); } finally { setBusy(false); }
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

        {adding && <ExpenseForm unitWord={unitWord} busy={busy} payeeHints={payeeHints || []} onCancel={() => setAdding(false)} onSave={save} />}
        {(payeeHints || []).length > 0 && (
          <datalist id="wq-payee-hints">{Array.from(new Set(payeeHints)).map((n) => <option key={n} value={n} />)}</datalist>
        )}

        {rows === null ? (
          <p className="text-sm text-muted mt-4">جارٍ التحميل…</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted mt-4 bg-paper border border-line rounded-lg p-3">
            لا مصروفات مسجّلة في {ymLabel(ym)}. سجّل أول مصروف — حتى فاتورة السباك الصغيرة — وسيظهر خصمها في تقرير المالك تلقائيًّا.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {rows.map((x) => (
              <div key={x.id} className="rounded-xl border border-line bg-paper p-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-lg" aria-hidden>{catIcon(x.category)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{catLabel(x.category)}{x.unit ? ` — ${unitWord} ${x.unit}` : ""}</div>
                    <div className="text-xs text-muted">{arDate(x.spent_on)}{x.note ? ` · ${x.note}` : ""}</div>
                    {x.voucher_no && (
                      <div className="text-xs text-deep mt-0.5">🧾 سند <span dir="ltr" className="font-mono">{x.voucher_no}</span> · المستلم: <b>{x.payee_name}</b></div>
                    )}
                  </div>
                  <div className="font-bold text-sm shrink-0">{sar(Number(x.amount))}</div>
                  {x.voucher_no
                    ? <button className="btn btn-ghost text-xs shrink-0" onClick={() => printVoucher(x)}>🧾 سند الصرف</button>
                    : <button className="btn btn-ghost text-xs shrink-0" onClick={() => setIssuing({ id: x.id, name: "", ref: "" })}>🧾 إصدار سند</button>}
                  <button className="btn btn-ghost text-xs text-late shrink-0" onClick={() => remove(x)}>حذف</button>
                </div>
                {issuing?.id === x.id && (
                  <div className="mt-2 grid sm:grid-cols-[1fr_180px_auto] gap-2 items-end border-t border-line pt-2">
                    <label className="block"><span className="block text-xs font-semibold mb-1">اسم المستلم</span>
                      <input className="fld" list="wq-payee-hints" autoFocus value={issuing.name} onChange={(e) => setIssuing({ ...issuing, name: e.target.value })} placeholder="المستأجر أو أحد الورثة أو الفني" maxLength={120} /></label>
                    <label className="block"><span className="block text-xs font-semibold mb-1">هوية / جوال <span className="font-normal text-muted">— اختياري</span></span>
                      <input className="fld" dir="ltr" value={issuing.ref} onChange={(e) => setIssuing({ ...issuing, ref: e.target.value })} maxLength={60} /></label>
                    <div className="flex gap-1">
                      <button className="btn btn-gold text-xs" disabled={busy || !issuing.name.trim()} onClick={issueVoucher}>إصدار</button>
                      <button className="btn btn-ghost text-xs" onClick={() => setIssuing(null)}>إلغاء</button>
                    </div>
                    <p className="sm:col-span-3 text-[11px] text-muted">بعد الإصدار لا يُعدَّل المبلغ ولا التاريخ ولا المستلم — التصحيح بحذف المصروف وتسجيله من جديد.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExpenseForm({ unitWord, busy, onSave, onCancel, payeeHints }: {
  unitWord: string; busy: boolean; onSave: (d: Partial<ExpenseVoucher>) => void; onCancel: () => void; payeeHints: string[];
}) {
  const [d, setD] = useState<any>({ category: "maintenance", amount: "", spent_on: today(), unit: "", note: "",
    billable: true, paid_by: "collections", status: "paid", vendor: "", invoice_no: "",
    voucher: false, payee_name: "", payee_ref: "" });
  const ready = Number(d.amount) > 0 && !!d.spent_on && (!d.voucher || !!String(d.payee_name || "").trim());
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
          <DateField value={d.spent_on} onChange={(v) => setD({ ...d, spent_on: v })} /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">{unitWord} <span className="text-muted text-xs font-normal">— اختياري</span></span>
          <input className="fld" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} /></label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">المورّد <span className="text-muted text-xs font-normal">— اختياري</span></span>
          <input className="fld" value={d.vendor || ""} onChange={(e) => setD({ ...d, vendor: e.target.value })} placeholder="مؤسسة الصيانة السريعة" /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">رقم الفاتورة <span className="text-muted text-xs font-normal">— اختياري</span></span>
          <input className="fld" dir="ltr" value={d.invoice_no || ""} onChange={(e) => setD({ ...d, invoice_no: e.target.value })} placeholder="INV-2291" /></label>
      </div>

      {/* من يتحمّلها ومن دفعها: بدونهما يُخصم من المالك ما ليس عليه */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">على من تُحسب</span>
          <select className="fld" value={d.billable === false ? "office" : "owner"}
            onChange={(e) => setD({ ...d, billable: e.target.value === "owner" })}>
            <option value="owner">تُخصم من المالك</option>
            <option value="office">على المكتب (لا تُخصم)</option>
          </select>
          <span className="block text-[11px] text-muted mt-1">
            {d.billable === false ? "لن تدخل في صافي المالك — مثل مصروفات المكتب نفسه." : "تدخل في حساب صافي المالك بتقريره."}
          </span>
        </label>
        <label className="block"><span className="block text-sm font-semibold mb-1">من دفعها</span>
          <select className="fld" value={d.paid_by || "collections"} onChange={(e) => setD({ ...d, paid_by: e.target.value })}>
            <option value="collections">من تحصيل العقار</option>
            <option value="office">من المكتب (يُستردّ)</option>
            <option value="owner">دفعها المالك مباشرة</option>
          </select>
        </label>
      </div>

      {!d.voucher && <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="w-4 h-4" checked={d.status === "due"}
          onChange={(e) => setD({ ...d, status: e.target.checked ? "due" : "paid" })} />
        <span>مستحقة ولم تُدفع بعد <span className="text-[11px] text-muted">— تظهر تنبيهًا ولا تُعدّ نقدًا خارجًا</span></span>
      </label>}

      <label className="block"><span className="block text-sm font-semibold mb-1">{d.voucher ? "البيان" : "ملاحظة"} <span className="text-muted text-xs font-normal">— {d.voucher ? "يُطبع في السند" : "اختياري"}</span></span>
        <input className="fld" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="إصلاح تسريب دورة مياه شقة 12" /></label>

      {/* أمر صرف مع سند (v74): المبلغ يُسلَّم لشخص يُكتب اسمه يدويًا، ويصدر سند مرقّم للتوقيع */}
      <div className={`rounded-lg border p-3 ${d.voucher ? "border-gold bg-[#FBF1DF]" : "border-line bg-white"}`}>
        <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
          <input type="checkbox" className="w-4 h-4" checked={!!d.voucher} onChange={(e) => setD({ ...d, voucher: e.target.checked, status: e.target.checked ? "paid" : d.status })} />
          🧾 إصدار سند صرف <span className="text-[11px] text-muted font-normal">— المبلغ سُلِّم لشخص ويوقّع على استلامه</span>
        </label>
        {d.voucher && (
          <div className="grid sm:grid-cols-[1fr_200px] gap-3 mt-3">
            <label className="block"><span className="block text-sm font-semibold mb-1">اسم المستلم</span>
              <input className="fld" list="wq-payee-hints" value={d.payee_name} maxLength={120}
                onChange={(e) => setD({ ...d, payee_name: e.target.value })} placeholder={payeeHints.length ? "اختر أو اكتب الاسم" : "المستأجر أو أحد الورثة أو الفني"} /></label>
            <label className="block"><span className="block text-sm font-semibold mb-1">هوية / جوال <span className="text-muted text-xs font-normal">— اختياري</span></span>
              <input className="fld" dir="ltr" value={d.payee_ref} maxLength={60} onChange={(e) => setD({ ...d, payee_ref: e.target.value })} /></label>
            <p className="sm:col-span-2 text-[11px] text-muted">يصدر رقم سند متسلسل ويُفتح السند للطباعة. المصروف يدخل المصروفات وصافي المالك كالمعتاد.</p>
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <button className="btn btn-ghost text-sm" onClick={onCancel} disabled={busy}>إلغاء</button>
        <button className="btn btn-gold text-sm" disabled={!ready || busy}
          onClick={() => onSave({
            category: d.category, amount: Number(d.amount), spent_on: d.spent_on,
            unit: String(d.unit || "").trim() || null, note: String(d.note || "").trim() || null,
            vendor: (d.vendor || "").trim() || null,
            invoice_no: (d.invoice_no || "").trim() || null,
            billable: d.billable !== false,
            paid_by: d.paid_by || "collections",
            status: d.voucher ? "paid" : d.status === "due" ? "due" : "paid",
            ...(d.voucher ? { payee_name: String(d.payee_name || "").trim(), payee_ref: String(d.payee_ref || "").trim() || null } : {}),
          })}>
          {busy ? "…" : d.voucher ? "تسجيل وإصدار السند" : "تسجيل"}
        </button>
      </div>
    </div>
  );
}
