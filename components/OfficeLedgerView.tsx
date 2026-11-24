"use client";
import { wqConfirm } from "@/lib/confirm";
import { friendlyError } from "@/lib/friendlyError";
/**
 * 📒 دفتر حسابات المكتب (schema-v84) — دخل المكتب ومصروفاته وصافيه، منفصلًا عن حساب المالك.
 *
 * الدخل:  أتعاب الإدارة المحتسبة من المحصَّل (معادلة تقرير المالك نفسها — لا تُدخل يدويًّا)
 *         + ما يسجّله المكتب هنا (سعي، رسوم توثيق، دخل آخر).
 * المصروف: ما يسجّله المكتب هنا (إيجار المكتب، رواتب موظفيه، اشتراكات…)
 *         + مصروفات العقارات الموسومة «على المكتب (لا تُخصم)».
 * لا يكتب هذا الدفتر في المصروفات ولا الدفعات؛ وقيوده لا تظهر في أي مستند للمالك.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { getOffice, can, type Office } from "@/lib/office";
import { fetchAllRows } from "@/lib/fetch-all";
import { sar, today } from "@/lib/utils";
import { arDate, pastVatOf } from "@/lib/documents";
import { buildCollection } from "@/lib/collection";
import { catLabel } from "@/lib/expenses";
import { INCOME_CATS, EXPENSE_CATS_OFFICE, ledgerSummary, periodBounds, validateEntry, ledgerCatIcon, ledgerCSV, prefillFromQuery,
  type LedgerEntry, type LedgerKind, type LedgerSummary } from "@/lib/office-ledger";
import DateField from "@/components/DateField";
import { exportLines, monthlySummary, EXPORT_HEAD, lineCells } from "@/lib/accounting-export";

type Prop = { id: string; name: string; is_demo?: boolean | null };

export default function OfficeLedgerView({ orgName, issuer }: { orgName: string; issuer?: { vat_number?: string | null } }) {
  const supabase: any = createClient();
  const search = useSearchParams();
  const thisMonth = today().slice(0, 7);
  const [office, setOffice] = useState<Office | null>(null);
  const [officeKnown, setOfficeKnown] = useState(false);
  const [period, setPeriod] = useState(thisMonth);          // "YYYY-MM" أو "YYYY"
  const [props, setProps] = useState<Prop[]>([]);
  const [sum, setSum] = useState<LedgerSummary | null>(null);
  const [missing, setMissing] = useState(false);              // v84 لم يُشغَّل
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<LedgerKind | null>(null);
  /* تعبئة مسبقة من رابط («سجّل السعي» من المعروضات) أو من قيد يُعدَّل */
  const [draft, setDraft] = useState<Partial<LedgerEntry> | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);
  const [showLines, setShowLines] = useState<"all" | "income" | "expense">("all");

  const bounds = useMemo(() => periodBounds(period), [period]);
  const yearOf = period.slice(0, 4);
  const canWrite = can(office, "manage_expenses");
  const canDelete = can(office, "undo_actions");
  const canView = can(office, "view_financials");

  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 4000); }

  useEffect(() => { getOffice(supabase).then((o) => { setOffice(o); setOfficeKnown(true); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* ?add=income&cat=brokerage&amount=… — يفتح النموذج معبّأً مرة واحدة */
  useEffect(() => {
    const pre = prefillFromQuery(search as any);
    if (pre && pre.kind) { setDraft(pre); setAdding(pre.kind); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!bounds) return;
    setLoading(true); setErr(null);
    try {
      const o = office || await getOffice(supabase);
      const uid = o?.officeId;
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      /* عقارات المكتب الحقيقية فقط: بذرة التجربة لا تدخل دفتر المكتب */
      const { data: pr, error: pe } = await supabase.from("properties").select("*").eq("user_id", uid);
      if (pe) throw pe;
      const real = (pr || []).filter((p: any) => !p.is_demo);
      setProps(real.map((p: any) => ({ id: p.id, name: p.name, is_demo: p.is_demo })));
      const ids = real.map((p: any) => p.id);

      // 1) قيود المكتب
      const lq = await supabase.from("office_ledger").select("*").eq("user_id", uid)
        .gte("entry_on", bounds.from).lte("entry_on", bounds.to).order("entry_on", { ascending: false }).limit(5000);
      if (lq.error) {
        if (/office_ledger/.test(String(lq.error.message)) && /(does not exist|schema cache|relation)/i.test(String(lq.error.message))) { setMissing(true); setSum(null); return; }
        throw lq.error;
      }
      setMissing(false);
      setEntries((lq.data || []) as LedgerEntry[]);

      // 2) مصروفات العقارات في الفترة (كل الحقول: «على من» و«من دفعها»)
      const exps = ids.length ? await fetchAllRows(supabase, "expenses", "*",
        (q: any) => q.in("property_id", ids).gte("spent_on", bounds.from).lte("spent_on", bounds.to)) : [];

      // 3) أتعاب الإدارة المحتسبة — معادلة كشف التحصيل/تقرير المالك نفسها
      let fees = { fee: 0, feeVat: 0 };
      if (ids.length) {
        const pays = await fetchAllRows(supabase, "payments", "*",
          (q: any) => q.in("property_id", ids).gte("paid_on", bounds.from).lte("paid_on", bounds.to).order("paid_on", { ascending: true }));
        const tenants = await fetchAllRows(supabase, "tenants", "*", (q: any) => q.in("property_id", ids));
        const pastQ = await supabase.from("past_tenancies").select("id, snapshot").in("property_id", ids).limit(5000);
        const { fin } = buildCollection({
          periodPayments: pays || [], allTenantPayments: [], expenses: exps || [], tenants: tenants || [],
          properties: real, pastVat: pastQ.error ? undefined : pastVatOf(pastQ.data as any), issuer: issuer || {}, from: bounds.from, to: bounds.to,
        });
        fees = { fee: fin.fee, feeVat: fin.feeVat };
      }

      const pn: Record<string, string> = Object.fromEntries(real.map((p: any) => [p.id, p.name]));
      setSum(ledgerSummary({ fees, entries: (lq.data || []) as LedgerEntry[], propertyExpenses: exps || [], propertyNames: pn, propCatLabel: catLabel }));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  /* (22 نوفمبر 2026) «فواتير للمحاسب»: فواتير الإيجار الصادرة في الفترة بملف Excel جاهز
     للاستيراد في البرنامج المحاسبي المربوط بالزكاة (المرحلة الثانية من الفوترة الإلكترونية).
     المبالغ من الفاتورة كما صدرت — lib/accounting-export.ts — مع ملخّص شهري للإقرار. */
  const [acctBusy, setAcctBusy] = useState(false);
  async function exportForAccountant() {
    if (!bounds) return;
    setAcctBusy(true); setErr(null);
    try {
      const o = office || await getOffice(supabase);
      const uid = o?.officeId;
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const { data: pr, error: pe } = await supabase.from("properties").select("*").eq("user_id", uid);
      if (pe) throw pe;
      const real = (pr || []).filter((p: any) => !p.is_demo);
      const ids = real.map((p: any) => p.id);
      const invoices = ids.length ? await fetchAllRows(supabase, "invoices", "*", (q: any) => q.eq("user_id", uid).in("property_id", ids)) : [];
      const tenants = ids.length ? await fetchAllRows(supabase, "tenants", "id,name,unit,unit_type,vat_mode,property_id", (q: any) => q.in("property_id", ids)) : [];
      const pastQ = ids.length ? await supabase.from("past_tenancies").select("id,unit_row_id,archived_at,name,unit").in("property_id", ids).limit(5000) : { data: [] as any[] };
      const past = ((pastQ as any).error ? [] : (pastQ as any).data || []) as any[];
      /* فاتورة صدرت قبل أرشفة مستأجرٍ من الوحدة هي فاتورته هو — نفس قاعدة التصدير الكامل */
      const holderOf = (inv: any) => past
        .filter((a) => a.unit_row_id && a.unit_row_id === inv.tenant_id && String(a.archived_at || "") > String(inv.created_at || ""))
        .sort((a, b) => String(a.archived_at).localeCompare(String(b.archived_at)))[0] || null;
      const lines = exportLines({ invoices: invoices as any[], tenants: tenants as any[], props: real, holderOf,
        issuer: { org_name: orgName, vat_number: issuer?.vat_number || null }, from: bounds.from, to: bounds.to });
      if (!lines.length) { setErr(`لا فواتير صادرة في ${bounds.label}.`); return; }
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      const ws = XLSX.utils.aoa_to_sheet([[...EXPORT_HEAD], ...lines.map(lineCells)]);
      ws["!cols"] = [16, 12, 12, 12, 24, 22, 16, 8, 40, 14, 10, 12, 12, 10, 22, 18, 12, 18].map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, "الفواتير");
      const sum = monthlySummary(lines);
      const ws2 = XLSX.utils.aoa_to_sheet([["الشهر", "عدد الفواتير", "المبلغ قبل الضريبة", "منه خاضع للضريبة", "مبلغ الضريبة", "الإجمالي"],
        ...sum.map((m) => [m.month, m.count, m.base, m.taxableBase, m.vat, m.total])]);
      ws2["!cols"] = [10, 12, 18, 18, 14, 14].map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws2, "ملخص شهري");
      const ws3 = XLSX.utils.aoa_to_sheet([
        ["اقرأني"],
        ["هذا الملف من وثيق: فواتير الإيجار الصادرة في " + bounds.label + "، صف لكل فاتورة."],
        ["استورده في برنامجك المحاسبي المربوط بهيئة الزكاة (قسم فواتير المبيعات ← استيراد) لتُصدر منه الفاتورة الإلكترونية المعتمدة."],
        ["المبالغ كما صدرت الفاتورة في وثيق. «إشعار دائن» يلغي فاتورة بمبالغ سالبة ويُحتسب في شهر إصداره، والفاتورة التي ألغاها تبقى في شهرها."],
        ["الفواتير الملغاة قبل الإشعارات الدائنة (قبل 22 نوفمبر 2026) مذكورة بحالتها وخارج «الملخص الشهري»."],
        ["«ضريبية» = فيها ضريبة 15% وللبائع رقم ضريبي صحيح. البائع هو المكتب، أو المالك إن كان العقار مضبوطًا على «الفاتورة باسم المالك». الإيجار السكني معفى."],
        ["«قياسية» = فاتورة ضريبية لمستأجر مسجَّل في الضريبة، ورقمه في العمود الأخير. «مبسطة» = لغير المسجَّل."],
      ]);
      ws3["!cols"] = [{ wch: 110 }];
      XLSX.utils.book_append_sheet(wb, ws3, "اقرأني");
      XLSX.writeFile(wb, `فواتير-للمحاسب-${period}.xlsx`);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally { setAcctBusy(false); }
  }

  async function save(d: Partial<LedgerEntry>) {
    const bad = validateEntry(d);
    if (bad) return flash("err", bad);
    setBusy(true);
    try {
      const o = office || await getOffice(supabase);
      if (!o?.officeId) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const { id, ...body } = d as any;
      if (id) {
        /* تعديل: التحديث لمن يدير المصروفات (سياسة office_ledger_upd)؛ صف فارغ = بلا صلاحية */
        const { data, error } = await supabase.from("office_ledger").update(body).eq("id", id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("هذا الإجراء يحتاج صلاحية تسجيل المصروفات — اطلبه من صاحب المكتب.");
        flash("ok", "عُدّل القيد");
      } else {
        const { error } = await supabase.from("office_ledger").insert({ ...body, user_id: o.officeId }).select("id").single();
        if (error) throw error;
        flash("ok", d.kind === "income" ? "سُجّل الدخل" : "سُجّل المصروف");
      }
      setAdding(null); setDraft(null);
      await load();
    } catch (e: any) {
      const t = String(e?.message || e);
      flash("err", /row-level security|policy/i.test(t) ? "هذا الإجراء يحتاج صلاحية تسجيل المصروفات — اطلبه من صاحب المكتب." : friendlyError(t));
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!(await wqConfirm("حذف هذا القيد من دفتر المكتب؟"))) return;
    const { data, error } = await supabase.from("office_ledger").delete().eq("id", id).select("id");
    if (error) return flash("err", String(error.message));
    if (!data?.length) return flash("err", "الحذف لصاحب المكتب أو المدير فقط.");
    flash("ok", "حُذف القيد");
    await load();
  }

  function startEdit(id: string) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    setDraft({ ...e }); setAdding(e.kind);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportCSV() {
    if (!sum) return;
    const blob = new Blob([ledgerCSV(sum.lines, bounds?.label || period)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `حسابات-المكتب-${period}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const lines = (sum?.lines || []).filter((l) => showLines === "all" || l.kind === showLines);

  /* موظف بلا صلاحية «أرقام المالك»: القاعدة تُخفي القيود أصلًا — نوضّح بدل صفحة فارغة مضلِّلة */
  if (officeKnown && !canView) {
    return <div className="card p-6 text-sm text-muted text-center">حسابات المكتب تحتاج صلاحية «أرقام المكتب والمالك» — اطلبها من صاحب المكتب.</div>;
  }

  return (
    <div className="space-y-4">
      {/* الفترة */}
      <div className="card p-4 flex flex-wrap items-center gap-3 print:hidden">
        <div className="font-semibold text-sm">الفترة</div>
        <input type="month" className="fld !w-auto" value={/^\d{4}-\d{2}$/.test(period) ? period : thisMonth} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        <button className={`btn text-sm ${period === yearOf ? "btn-primary" : "btn-ghost"}`} onClick={() => setPeriod(period === yearOf ? thisMonth : yearOf)}>
          {period === yearOf ? `سنة ${yearOf} ✓` : `السنة كاملة ${yearOf}`}
        </button>
        <div className="ms-auto flex gap-2">
          {canWrite && <button className="btn btn-gold text-sm" onClick={() => { setDraft(null); setAdding(adding === "income" ? null : "income"); }}>+ دخل</button>}
          {canWrite && <button className="btn btn-ghost text-sm" onClick={() => { setDraft(null); setAdding(adding === "expense" ? null : "expense"); }}>+ مصروف مكتب</button>}
          {can(office, "export_data") && <button className="btn btn-ghost text-sm" onClick={exportCSV} disabled={!sum} title="تصدير CSV (Excel)">⬇ CSV</button>}
          {can(office, "export_data") && can(office, "view_financials") && <button className="btn btn-ghost text-sm" onClick={() => void exportForAccountant()} disabled={acctBusy}
            title="فواتير الإيجار الصادرة في الفترة — ملف Excel جاهز لاستيراده في برنامجك المحاسبي المربوط بالزكاة">{acctBusy ? "…" : "🧾 فواتير للمحاسب"}</button>}
          <button className="btn btn-ghost text-sm" onClick={() => window.print()} title="طباعة الدفتر">🖨️</button>
        </div>
      </div>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.m}</div>}

      {adding && <EntryForm key={draft?.id || `new-${adding}`} kind={adding} props={props} busy={busy} initial={draft} onCancel={() => { setAdding(null); setDraft(null); }} onSave={save} />}

      {missing && (
        <div className="card p-4 text-sm bg-[#FBF1DF] border-gold">
          دفتر المكتب يحتاج تشغيل <code>schema-v84-office-ledger.sql</code> في Supabase أولًا. تظهر الأتعاب المحتسبة ومصروفات العقارات «على المكتب» بعد التشغيل مع القيود اليدوية.
        </div>
      )}
      {err && <div className="card p-4 text-sm text-red-700">{err}</div>}
      {loading && <div className="text-sm text-muted p-4">⏳ جارٍ جمع أرقام {bounds?.label}…</div>}

      {sum && !loading && (
        <>
          {/* بطاقات الملخص */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={`دخل المكتب — ${bounds?.label}`} value={sum.income.total} tone="pos"
              sub={`أتعاب محتسبة ${sar(sum.income.fees)} · مسجَّل ${sar(sum.income.manual)}`} />
            <Stat label="مصروفات المكتب" value={sum.expense.total} tone="neg"
              sub={`مكتب ${sar(sum.expense.manual)} · من العقارات ${sar(sum.expense.property)}`} />
            <Stat label="صافي المكتب" value={sum.net} tone={sum.net >= 0 ? "pos" : "neg"} big />
            <Stat label="سلف للملّاك (تُستردّ)" value={sum.advances} tone="muted"
              sub="دفعها المكتب عن الملّاك من جيبه — ليست مصروفًا" />
          </div>
          {sum.income.feeVat > 0 && (
            <p className="text-xs text-muted">+ ضريبة قيمة مضافة على الأتعاب {sar(sum.income.feeVat)} ريال — محصَّلة لحساب الهيئة، لا تُعدّ دخلًا.</p>
          )}
          {sum.feeDoubleRisk && (
            <div className="text-xs rounded-lg px-3 py-2 bg-[#FBF1DF] border border-gold">
              ⚠️ في هذه الفترة أتعاب محتسبة تلقائيًّا ({sar(sum.income.fees)}) وأتعاب مسجَّلة يدويًّا ({sar(sum.income.manualFees)}). الأتعاب اليدوية لعقار بلا نسبة أتعاب فقط — وإلا تُحسب مرتين.
            </div>
          )}

          {/* التوزيع */}
          <div className="grid md:grid-cols-2 gap-3">
            <Breakdown title="الدخل حسب النوع" rows={sum.income.byCat} total={sum.income.total} />
            <Breakdown title="المصروفات حسب النوع" rows={sum.expense.byCat} total={sum.expense.total} />
          </div>

          {/* القيود */}
          <div className="card p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="font-semibold">القيود ({lines.length})</h3>
              <div className="flex gap-1 print:hidden">
                {(["all", "income", "expense"] as const).map((k) => (
                  <button key={k} onClick={() => setShowLines(k)}
                    className={`text-xs px-2 py-1 rounded-full border ${showLines === k ? "bg-deep text-white border-deep" : "border-line"}`}>
                    {k === "all" ? "الكل" : k === "income" ? "دخل" : "مصروف"}
                  </button>
                ))}
              </div>
            </div>
            {!lines.length ? (
              <p className="text-sm text-muted">لا قيود في هذه الفترة.{canWrite ? " سجّل سعيًا أو رسوم توثيق أو مصروف مكتب من الأزرار أعلاه." : ""}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-muted text-xs border-b border-line">
                    <th className="text-start py-1">التاريخ</th><th className="text-start">البيان</th><th className="text-start">العقار / الطرف</th><th className="text-end">المبلغ</th><th className="print:hidden"></th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.id || `${l.source}-${i}`} className="border-b border-line/60">
                        <td className="py-1.5 whitespace-nowrap">{l.date ? arDate(l.date) : <span className="text-muted">الفترة كلها</span>}</td>
                        <td>
                          <span className="me-1">{l.source === "fee" ? "📊" : l.source === "property" ? "🏢" : ledgerCatIcon(l.kind, l.category)}</span>
                          {l.label}{l.note ? <span className="text-muted"> — {l.note}</span> : null}
                        </td>
                        <td className="text-muted text-xs">{[l.property, l.unit, l.party].filter(Boolean).join(" · ")}</td>
                        <td className={`text-end font-semibold whitespace-nowrap ${l.kind === "income" ? "text-green-700" : "text-red-700"}`}>
                          {l.kind === "income" ? "+" : "−"}{sar(l.amount)}
                        </td>
                        <td className="text-end print:hidden">
                          {l.source === "ledger" && canWrite && l.id && <button className="text-xs text-muted hover:text-deep me-2" onClick={() => startEdit(l.id!)}>تعديل</button>}
                          {l.source === "ledger" && canDelete && l.id && <button className="text-xs text-muted hover:text-red-700" onClick={() => remove(l.id!)}>حذف</button>}
                          {l.source === "property" && <span className="text-[10px] text-muted">من مصروفات العقار</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted leading-relaxed">
            هذا الدفتر للمكتب فقط ({orgName || "مكتبك"}): قيوده لا تظهر في تقرير المالك ولا كشف الحساب ولا صافي المالك.
            أتعاب الإدارة تُحتسب من دفعات الفترة بنسبة كل عقار — كما في تقرير المالك — ولا تُسجَّل هنا يدويًّا حتى لا تُحسب مرتين.
            راتب حارس العمارة وعقد المصاعد مصروفات عقار (تُسجَّل داخل العقار)، وتظهر هنا فقط إن كانت «على المكتب».
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone, big }: { label: string; value: number; sub?: string; tone: "pos" | "neg" | "muted"; big?: boolean }) {
  const color = tone === "pos" ? "text-green-800" : tone === "neg" ? "text-red-700" : "text-muted";
  return (
    <div className="card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-bold ${big ? "text-2xl" : "text-xl"} ${color}`}>{value < 0 ? "−" : ""}{sar(Math.abs(value))} <span className="text-xs font-normal">ريال</span></div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: { category: string; label: string; total: number }[]; total: number }) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-sm mb-2">{title}</h3>
      {!rows.length ? <p className="text-xs text-muted">لا شيء في هذه الفترة.</p> : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const pct = total > 0 ? Math.round((r.total / total) * 100) : 0;
            return (
              <li key={r.category} className="text-sm">
                <div className="flex justify-between"><span>{r.label}</span><span className="font-semibold">{sar(r.total)} <span className="text-xs text-muted">({pct}%)</span></span></div>
                <div className="h-1.5 bg-line/60 rounded-full overflow-hidden"><div className="h-full bg-gold" style={{ width: `${pct}%` }} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EntryForm({ kind, props, busy, initial, onSave, onCancel }: {
  kind: LedgerKind; props: Prop[]; busy: boolean; initial?: Partial<LedgerEntry> | null; onSave: (d: Partial<LedgerEntry>) => void; onCancel: () => void;
}) {
  const cats = kind === "income" ? INCOME_CATS : EXPENSE_CATS_OFFICE;
  const first = Object.keys(cats)[0];
  const editing = !!initial?.id;
  const [d, setD] = useState<any>({
    category: initial?.category && cats[initial.category] ? initial.category : first,
    amount: initial?.amount ?? "", entry_on: initial?.entry_on || today(), property_id: initial?.property_id || "",
    unit: initial?.unit || "", party: initial?.party || "", note: initial?.note || "", reference: initial?.reference || "",
  });
  const ready = Number(d.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.entry_on);
  return (
    <div className="card p-4 border-gold bg-[#FBF1DF] space-y-3 print:hidden">
      <div className="font-semibold">{editing ? "تعديل قيد — " : ""}{kind === "income" ? "دخل للمكتب" : "مصروف على المكتب"}</div>
      <div>
        <span className="block text-sm font-semibold mb-1">النوع</span>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(cats).map(([k, c]) => (
            <button key={k} type="button" onClick={() => setD({ ...d, category: k })} title={c.hint}
              className={`border-2 rounded-lg py-2 text-[.68rem] font-semibold transition ${d.category === k ? "border-gold bg-white" : "border-line bg-white/60 hover:border-goldSoft"}`}>
              {c.icon}<br />{c.label}
            </button>
          ))}
        </div>
        {cats[d.category]?.hint && <p className="text-[11px] text-muted mt-1">{cats[d.category].hint}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">المبلغ (ريال)</span>
          <input className="fld" type="number" min={1} step="0.01" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} placeholder={kind === "income" ? "2500" : "1200"} /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">التاريخ</span>
          <DateField value={d.entry_on} onChange={(iso) => setD({ ...d, entry_on: iso })} /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">يخص عقارًا <span className="text-muted text-xs font-normal">— اختياري، للإشارة فقط</span></span>
          <div className="flex gap-2">
            <select className="fld" value={d.property_id} onChange={(e) => setD({ ...d, property_id: e.target.value, unit: e.target.value ? d.unit : "" })}>
              <option value="">— بلا عقار (المكتب عامةً) —</option>
              {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {d.property_id && <input className="fld !w-24" value={d.unit} maxLength={40} onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="الوحدة" title="رقم الوحدة — اختياري" />}
          </div></label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">{kind === "income" ? "من (الطرف الدافع)" : "لمن (المستفيد)"} <span className="text-muted text-xs font-normal">— اختياري</span></span>
          <input className="fld" value={d.party} maxLength={160} onChange={(e) => setD({ ...d, party: e.target.value })} placeholder={kind === "income" ? "اسم المستأجر أو المالك" : "اسم الجهة"} /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">البيان <span className="text-muted text-xs font-normal">— اختياري</span></span>
          <input className="fld" value={d.note} maxLength={300} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder={kind === "income" ? "سعي تأجير شقة 3" : "إيجار المكتب — نوفمبر"} /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">مرجع <span className="text-muted text-xs font-normal">— رقم عقد/فاتورة/حوالة</span></span>
          <input className="fld" value={d.reference} maxLength={80} onChange={(e) => setD({ ...d, reference: e.target.value })} /></label>
      </div>
      <div className="flex gap-2 justify-end">
        <button className="btn btn-ghost text-sm" onClick={onCancel} disabled={busy}>إلغاء</button>
        <button className="btn btn-gold text-sm" disabled={!ready || busy} onClick={() => onSave({
          ...(editing ? { id: initial!.id } : {}),
          kind, category: d.category, amount: Number(d.amount), entry_on: d.entry_on,
          property_id: d.property_id || null, unit: String(d.unit || "").trim() || null,
          party: String(d.party || "").trim() || null, note: String(d.note || "").trim() || null, reference: String(d.reference || "").trim() || null,
        })}>{busy ? "…" : editing ? "حفظ التعديل" : "حفظ"}</button>
      </div>
    </div>
  );
}
