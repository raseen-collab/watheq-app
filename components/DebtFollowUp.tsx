"use client";
// ============================================================
// وثيق — متابعة الديون المرحَّلة
//
// محاكاة سبع سنوات أظهرت 13.6 مليون ريال ديونًا مرحَّلة عند مكتب واحد.
// الرقم صحيح، لكنه أعمى: لا يُعرف متى نشأ، ولا آخر متابعة، ولا مصيره.
//
// الدين بلا متابعة يصير بعد سنوات رقمًا لا يجرؤ أحد على لمسه — لا يُطالَب
// به ولا يُشطب، ويُفسد كل تقرير يظهر فيه. هذه الشاشة تعطيه حالة وتاريخًا
// وملاحظة، وترتّبه بالأقدم لأن التقادم يأكل فرصة التحصيل.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { contractState, withVat } from "@/lib/contracts";
import { waLink, openExternal, daysAr } from "@/lib/utils";

const sar = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * ثلاثة مصادر للدين في قائمة واحدة:
 *  unit — دين على صفّ وحدة: مرحَّل على الساكن (_carried) أو متأخرات شاغرة لم تُؤجَّر بعد (_legacy)
 *  past — مستأجر سابق في الأرشيف (schema-v45): باسمه وجواله الحقيقيين
 */
type Row = {
  id: string; name: string; unit: string | null; phone: string | null;
  carried_debt: number; debt_since: string | null; debt_status: string | null;
  debt_note: string | null; status: string | null; property_id: string;
  property_name?: string;
  source?: "unit" | "past"; _legacy?: number; _carried?: number; legacyFlag?: boolean;
  /** متأخرات الشاغرة قبل الضريبة — بوحدة عدّاد الأقساط التي تسجّل بها watheq_record_payment */
  _legacyBase?: number;
};
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const STATUS: Record<string, { label: string; cls: string; hint: string }> = {
  open:        { label: "مفتوح",            cls: "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]", hint: "لم تبدأ متابعته بعد" },
  promised:    { label: "وعد بالسداد",      cls: "bg-[#FDECD2] text-[#9A4B00] border-[#F5CFA0]", hint: "وعد بموعد — تابعه في وقته" },
  legal:       { label: "أُحيل للتنفيذ",    cls: "bg-[#EEF4FB] text-[#2B5C8A] border-[#CFE0F0]", hint: "عند المحكمة أو المحامي" },
  settled:     { label: "سُوّي",             cls: "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]", hint: "سُدّد كاملًا — يُضبط تلقائيًّا عند اكتمال السداد" },
  written_off: { label: "شُطب",              cls: "bg-[#EFEFEC] text-[#5C6B67] border-[#DDDCD4]", hint: "قرار بعدم التحصيل" },
};

/** كم مضى على نشوء الدين — التقادم يقرّر الأولوية */
function ageOf(since: string | null): { days: number; txt: string; tone: string } {
  if (!since) return { days: 0, txt: "—", tone: "text-muted" };
  const d = Math.round((Date.parse(today()) - Date.parse(since)) / 86400000);
  if (d < 0) return { days: 0, txt: "—", tone: "text-muted" };
  const m = Math.floor(d / 30), y = Math.floor(d / 365);
  /* جمع عربي صحيح: «سنة» لا «1 سنة»، و«سنتان» لا «2 سنتان» */
  const txt = y >= 1 ? (y === 1 ? "سنة" : y === 2 ? "سنتين" : y <= 10 ? `${y} سنوات` : `${y} سنة`)
    : m >= 1 ? (m === 1 ? "شهر" : m === 2 ? "شهرين" : m <= 10 ? `${m} أشهر` : `${m} شهرًا`)
    : d === 1 ? "يوم" : daysAr(d);
  return { days: d, txt, tone: d > 365 ? "text-late font-bold" : d > 180 ? "text-[#9A4B00] font-semibold" : "text-muted" };
}

export default function DebtFollowUp({ properties, orgName, onClose, db }: {
  properties: { id: string; name: string }[];
  orgName?: string;
  onClose: () => void;
  db?: any;
}) {

  /* قفل تمرير الصفحة خلف النافذة — يُزال حتمًا عند الإغلاق */
  useEffect(() => {
    document.body.classList.add("wq-modal-open");
    return () => document.body.classList.remove("wq-modal-open");
  }, []);
  const supabase: any = useMemo(() => db || createClient(), [db]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("active");
  const [prop, setProp] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [eStatus, setEStatus] = useState("open");
  const [eNote, setENote] = useState("");
  const [busy, setBusy] = useState(false);

  const nameOf = useMemo(() => Object.fromEntries(properties.map((p) => [p.id, p.name])), [properties]);

  useEffect(() => {
    let alive = true;
    /**
     * كان يقرأ «carried_debt» وحده فيعطي صفرًا بينما شقة شاغرة عليها
     * 12,000 موسومة «على المستأجر السابق» — ذاك مبلغ آخر (متأخرات لم
     * تُرحَّل بعد، تُحسب من حالة العقد لا من عمود). نجلب الشاغرة كذلك
     * ونحسب متأخراتها هنا.
     *
     * (30 سبتمبر 2026) وبكل ما تحتاجه حالة العقد: بلا first_due وbilling_anchor_day
     * وcontract_end كانت المتأخرات تُعدّ من بداية العقد (3,000 هنا و5,000 في
     * صفحة العقار)، وبلا إعدادات ضريبة العقار كانت تُعرض قبل الضريبة في وضع
     * «مضافة فوق الإيجار» — والصفحة والكشف يطالبان بها شاملة.
     */
    const ids = properties.map((p) => p.id);
    Promise.all([
      supabase.from("tenants")
        .select("id,name,unit,phone,carried_debt,debt_since,debt_status,debt_note,status,property_id,rent_amount,payment_frequency,contract_start,contract_end,contract_periods,paid_periods,partial_amount,calendar,move_out_date,first_due,billing_anchor_day,unit_type,vat_mode")
        .or("carried_debt.gt.0,status.eq.vacated").limit(5000),
      ids.length
        ? supabase.from("properties").select("id,vat_enabled,vat_rate,vat_inclusive,property_type").in("id", ids)
        : Promise.resolve({ data: [], error: null }),
    ]).then(([{ data, error }, { data: props, error: pErr }]: any) => {
        if (!alive) return;
        if (error) {
          setErr(/column|does not exist/i.test(error.message) ? "شغّل schema-v36 في قاعدة البيانات أولًا." : error.message);
          setRows([]); return;
        }
        /* بلا إعدادات الضريبة لا نعرض رقمًا قد ينقص الضريبة بصمت */
        if (pErr) setErr("تعذّر قراءة إعدادات الضريبة للعقارات — المبالغ المعروضة قبل الضريبة: " + pErr.message);
        const propOf: Record<string, any> = Object.fromEntries((props || []).map((p: any) => [p.id, p]));
        /* لكل صفّ: الدين المرحَّل + متأخرات المستأجر السابق إن كانت شاغرة */
        setRows((data || []).map((x: any) => {
          const carried = Number(x.carried_debt) || 0;
          let legacyBase = 0;
          if (String(x.status) === "vacated") {
            try { legacyBase = Math.max(0, contractState(x as any, {}).legacyArrears || 0); } catch { legacyBase = 0; }
          }
          /* الدين المرحَّل مخزَّن شاملًا (يُرحَّل كذلك)؛ المتأخرات بوحدة الإيجار فتُضاف ضريبتها */
          const legacy = r2(withVat(legacyBase, x, propOf[x.property_id]));
          return { ...x, carried_debt: r2(carried + legacy), _legacy: legacy, _legacyBase: r2(legacyBase),
                   property_name: nameOf[x.property_id] || "—" };
        }).filter((x: any) => Number(x.carried_debt) > 0).map((x: any) => ({
          ...x, source: "unit" as const,
          _carried: r2(Math.max(0, Number(x.carried_debt) - (Number(x._legacy) || 0))),
        })));
        /* الأرشيف (v45) — قبل الترحيل لا جدول، فالخطأ يُتجاهَل */
        supabase.from("past_tenancies")
          .select("id, property_id, name, unit, phone, debt_amount, debt_paid, debt_status, debt_note, archived_at, legacy")
          .limit(2000)
          .then(({ data: pd, error: pe }: any) => {
            if (!alive || pe || !Array.isArray(pd)) return;
            const pastRows: Row[] = pd
              .map((x: any) => ({
                id: x.id, name: x.name, unit: x.unit, phone: x.phone, property_id: x.property_id,
                property_name: nameOf[x.property_id] || "—",
                carried_debt: Math.max(0, Math.round(((Number(x.debt_amount) || 0) - (Number(x.debt_paid) || 0)) * 100) / 100),
                debt_since: String(x.archived_at || "").slice(0, 10) || null,
                debt_status: x.debt_status, debt_note: x.debt_note, status: "archived",
                source: "past" as const, legacyFlag: !!x.legacy,
              }))
              .filter((r: Row) => r.carried_debt > 0 || ["written_off"].includes(String(r.debt_status)));
            setRows((cur) => [...(cur || []).filter((r) => r.source !== "past"), ...pastRows]);
          });
      });
    return () => { alive = false; };
  }, [supabase, nameOf, properties]);

  async function save(r: Row) {
    setBusy(true); setErr(null);
    if (r.source === "past") {
      /* الدالة تمنع «سُوّي» ومبلغٌ باقٍ — فلا يختفي مال بصمت */
      const { error } = await supabase.rpc("watheq_set_past_debt", { p_past: r.id, p_status: eStatus, p_note: eNote.trim() || null });
      setBusy(false);
      if (error) return setErr(error.message);
    } else {
      if (eStatus === "settled" && r.carried_debt > 0.005) {
        setBusy(false);
        return setErr(`بقي ${sar(r.carried_debt)} ريال — سجّل سداده بزرّ «سجّل سدادًا»، أو اشطبه إن تنازل عنه المالك.`);
      }
      const { data, error } = await supabase.from("tenants")
        .update({ debt_status: eStatus, debt_note: eNote.trim() || null })
        .eq("id", r.id).select("id");
      setBusy(false);
      if (error) return setErr(error.message);
      if (!data?.length) return setErr("هذا التعديل يحتاج صلاحية أعلى.");
    }
    setRows((cur) => (cur || []).map((x) => (x.id === r.id && x.source === r.source ? { ...x, debt_status: eStatus, debt_note: eNote.trim() || x.debt_note } : x)));
    setEditing(null);
  }

  /**
   * سداد الدين نقدٌ في الدفتر — فيظهر في تقرير المالك.
   * كان «صفّر الدين» يمحو الرقم بلا نقد، فالمال المقبوض لا يصل لأي تقرير.
   */
  async function recordPayment(r: Row) {
    const raw = prompt(`سداد من ${r.name}\nالمتبقي ${sar(r.carried_debt)} ريال\n\nالمبلغ المستلم:`, String(r.carried_debt));
    if (raw === null) return;
    const amt = Math.round((Number(String(raw).replace(/[^\d.]/g, "")) || 0) * 100) / 100;
    if (amt <= 0) return setErr("أدخل مبلغًا أكبر من صفر.");
    if (amt > r.carried_debt + 0.005) return setErr(`المبلغ أكبر من المتبقي (${sar(r.carried_debt)}).`);
    const on = prompt("تاريخ الاستلام (YYYY-MM-DD):", today());
    if (on === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on.trim())) return setErr("التاريخ بصيغة 2026-09-21.");
    setBusy(true); setErr(null);
    let error: any = null;
    let recorded = amt;   // ما سُجِّل فعلًا — يختلف عن amt إن نجح الشقّ الأول وفشل الثاني
    if (r.source === "past") {
      ({ error } = await supabase.rpc("watheq_record_past_payment", { p_past: r.id, p_amount: amt, p_paid_on: on.trim() }));
    } else {
      /* صفّ وحدة: المتأخرات (أقساط) أولًا ثم الدين المرحَّل */
      const toRent = Math.min(amt, Number(r._legacy) || 0), toCarried = Math.round((amt - toRent) * 100) / 100;
      /* (30 سبتمبر 2026) المتأخرات معروضة شاملة الضريبة، وعدّاد الأقساط بوحدة الإيجار
         (قبل الضريبة في «مضافة فوق الإيجار») — كما يسجّل زر الاستلام في صفحة العقار.
         تسجيل المبلغ الشامل كان يقدّم العدّاد بأكثر مما سُدّد. */
      const leg = Number(r._legacy) || 0, legBase = Number(r._legacyBase ?? r._legacy) || 0;
      const toRentBase = toRent >= leg - 0.005 ? legBase : (leg > 0 ? r2(toRent * legBase / leg) : 0);
      if (toRentBase > 0) ({ error } = await supabase.rpc("watheq_record_payment", { p_tenant: r.id, p_amount: toRentBase, p_paid_on: on.trim(), p_method: "transfer" }));
      if (!error && toCarried > 0) {
        ({ error } = await supabase.rpc("watheq_record_carried_payment", { p_tenant: r.id, p_amount: toCarried, p_paid_on: on.trim() }));
        /* (مراجعة 29 سبتمبر 2026) عمليتان منفصلتان: إن سُجّل شقّ الأقساط وفشل شقّ الدين
           كانت الرسالة خطأً عامًّا والصفّ بلا تحديث — فيعيد المكتب المبلغ كاملًا فتُسجَّل
           الأقساط مرتين. الآن نقول ما سُجّل بالضبط ونحدّث الصفّ به. */
        if (error && toRent > 0) {
          recorded = toRent;
          setErr(`سُجّل ${sar(toRent)} ريال للأقساط المتأخرة، ولم يُسجَّل ${sar(toCarried)} ريال للدين المرحَّل (${error.message}). سجّل الباقي وحده — لا تُعِد المبلغ كاملًا.`);
        }
      }
    }
    setBusy(false);
    if (error && recorded === amt) return setErr(/does not exist|function/i.test(error.message)
      ? "تسجيل السداد يحتاج تحديث قاعدة البيانات — شغّل schema-v45 أولًا." : error.message);
    const left = Math.round((r.carried_debt - recorded) * 100) / 100;
    setRows((cur) => (cur || []).map((x) => (x.id === r.id && x.source === r.source
      ? { ...x, carried_debt: left,
          ...(() => { /* ما ذهب للأقساط أولًا ثم للمرحَّل — كما سُجّل فعلًا */
            const legNow = Number(x._legacy) || 0, toLeg = Math.min(recorded, legNow), legLeft = r2(legNow - toLeg);
            const baseNow = Number(x._legacyBase ?? legNow) || 0;
            return { _legacy: legLeft, _legacyBase: legNow > 0 ? r2(baseNow * legLeft / legNow) : 0,
                     _carried: r2(Math.max(0, (Number(x._carried) || 0) - (recorded - toLeg))) };
          })(),
          debt_status: left <= 0.005 ? "settled" : x.debt_status } : x)).filter((x) => x.carried_debt > 0.005));
  }

  /**
   * (30 سبتمبر 2026) الشطب صادق مع ما تشطبه الدالة فعلًا.
   * watheq_write_off_carried تشطب الدين المرحَّل وحده، بينما كانت الشاشة تُزيل الصفّ
   * كاملًا — ومعه متأخرات المستأجر السابق التي بقيت في القاعدة وتعود عند التحديث.
   * ومتأخرات الشاغرة وحدها كانت تُرجع «لا دين مرحَّل». الآن: يُعرض شطب الجزء
   * المرحَّل بمبلغه، والمتأخرات تُسوّى بمسارها (إعادة تأجير الوحدة ⟵ أرشيف باسمه).
   */
  async function writeOff(r: Row) {
    const amount = r.source === "past" ? r.carried_debt : r2(Number(r._carried) || 0);
    if (amount <= 0) return setErr("لا دين مرحَّل على هذه الوحدة — متأخرات المستأجر السابق تُسوّى بإعادة تأجير الوحدة.");
    const why = prompt(`شطب ${sar(amount)} ريال على ${r.name}${r.source === "unit" && (Number(r._legacy) || 0) > 0
      ? `\n(الدين المرحَّل وحده — متأخرات المستأجر السابق ${sar(Number(r._legacy))} تبقى)` : ""}\n\nلا يُسجَّل نقد — تنازلٌ عن الدين. اذكر السبب (يُحفظ في السجل):`);
    if (why === null) return;
    if (!why.trim()) return setErr("اذكر سبب الشطب.");
    setBusy(true); setErr(null);
    const { error } = r.source === "past"
      ? await supabase.rpc("watheq_set_past_debt", { p_past: r.id, p_status: "written_off", p_note: why.trim() })
      /* المبلغ صريحًا (v48): يُشطب ما رآه المكتب بالضبط، لا ما صار في القاعدة بعده */
      : await supabase.rpc("watheq_write_off_carried", { p_tenant: r.id, p_note: why.trim(), p_amount: amount });
    setBusy(false);
    if (error) return setErr(error.message);
    setRows((cur) => (cur || []).map((x) => {
      if (!(x.id === r.id && x.source === r.source)) return x;
      if (x.source === "past") return { ...x, debt_status: "written_off" };
      const left = r2(Number(x.carried_debt) - (Number(x._carried) || 0));
      return { ...x, carried_debt: left, _carried: 0 };
    }).filter((x) => x.source === "past" ? true : x.carried_debt > 0.005));
  }

  const shown = (rows || [])
    .filter((r) => (!prop || r.property_id === prop))
    .filter((r) => filter === "all"
      || (filter === "active" ? !["settled", "written_off"].includes(String(r.debt_status)) : r.debt_status === filter))
    .sort((a, b) => String(a.debt_since || "9999").localeCompare(String(b.debt_since || "9999")));

  const total = shown.reduce((a, r) => a + Number(r.carried_debt || 0), 0);
  const old = shown.filter((r) => ageOf(r.debt_since).days > 365);
  const oldSum = old.reduce((a, r) => a + Number(r.carried_debt || 0), 0);

  const msg = (r: Row) =>
    `السلام عليكم ورحمة الله، ${r.name}\n\n`
    + `بخصوص مبلغ متبقٍّ بذمتكم عن ${r.property_name}${r.unit ? ` — وحدة ${r.unit}` : ""} بمقدار ${sar(r.carried_debt)} ريال.\n`
    + `نرجو التكرم بسداده أو تحديد موعد يناسبكم.\n\n`
    + `وإن كان السداد قد تم فنعتذر عن التذكير، ونرجو تزويدنا بما يفيد لتحديث السجل.\n\n`
    + `شاكرين لكم حسن تعاونكم،\n${orgName || ""}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 grid place-items-center p-3" onClick={onClose}>
      <div className="bg-paper rounded-2xl border border-line w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-deep text-[#EAF1EE] px-5 py-3 flex items-center justify-between">
          <div>
            <div className="font-display font-bold text-goldSoft">💼 الديون المرحَّلة</div>
            <div className="text-[11px] opacity-75">مبالغ على مستأجرين سابقين أو من عقود منتهية — مرتّبة بالأقدم</div>
          </div>
          <button className="text-sm opacity-80 hover:opacity-100" onClick={onClose}>إغلاق ✕</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
          <div className="bg-white border border-line rounded-xl p-3">
            <div className="text-xl font-bold tabular-nums text-late">{sar(total)}</div>
            <div className="text-[11px] text-muted">إجمالي المعروض · {shown.length} وحدة</div>
          </div>
          <div className="bg-white border border-line rounded-xl p-3">
            <div className={`text-xl font-bold tabular-nums ${oldSum ? "text-[#9A4B00]" : "text-muted"}`}>{sar(oldSum)}</div>
            <div className="text-[11px] text-muted">مضى عليه أكثر من سنة · {old.length}</div>
          </div>
          <div className="bg-white border border-line rounded-xl p-3 col-span-2 sm:col-span-1">
            <div className="text-xl font-bold tabular-nums text-deep">
              {shown.filter((r) => r.debt_status === "promised").length}
            </div>
            <div className="text-[11px] text-muted">وعد بالسداد — تابعها</div>
          </div>
        </div>

        <div className="px-3 pb-2 flex flex-wrap gap-1.5 items-center">
          {([["active", "قيد المتابعة"], ["open", "مفتوح"], ["promised", "وعد بالسداد"], ["legal", "تنفيذ"], ["written_off", "مشطوب"], ["all", "الكل"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`text-xs px-3 py-1.5 rounded-full border ${filter === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>{l}</button>
          ))}
          {properties.length > 1 && (
            <select className="fld !w-auto !py-1 text-xs ms-auto" value={prop} onChange={(e) => setProp(e.target.value)}>
              <option value="">كل العقارات</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        <div className="flex-1 overflow-auto px-3 pb-3">
          {err && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mb-2">{err}</div>}
          {rows === null ? <p className="text-center text-sm text-muted py-8">جارٍ التحميل…</p>
            : !shown.length ? (
              <div className="text-center py-10">
                <div className="text-3xl mb-2">✅</div>
                <p className="text-sm text-muted">{filter !== "all" ? "لا ديون مرحَّلة بهذه الحالة." : "لا ديون مرحَّلة."}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shown.map((r) => {
                  const age = ageOf(r.debt_since);
                  const st = STATUS[String(r.debt_status || "open")] || STATUS.open;
                  return (
                    <div key={`${r.source}-${r.id}`} className="bg-white border border-line rounded-xl p-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="font-semibold text-deep">
                            {r.name}
                            <span className={`ms-2 text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                            {String(r.status) === "vacated" && <span className="ms-1 text-[11px] text-muted">· أخلى الوحدة</span>}
                            {r.source === "past" && <span className="ms-1 text-[11px] text-muted">· مستأجر سابق{r.legacyFlag ? " (بلا جوال محفوظ)" : ""}</span>}
                          </div>
                          <div className="text-[11px] text-muted mt-0.5">
                            {r.property_name}{r.unit ? ` · وحدة ${r.unit}` : ""}
                            {r.debt_since ? <> · نشأ {r.debt_since} <span className={age.tone}>(منذ {age.txt})</span></> : " · بلا تاريخ نشوء"}
                          </div>
                          {r.debt_note && <div className="text-xs text-ink mt-1.5 bg-paper rounded-lg px-2.5 py-1.5">{r.debt_note}</div>}
                        </div>
                        <div className="text-left shrink-0">
                          <div className="text-lg font-bold tabular-nums text-late">{sar(r.carried_debt)}</div>
                          <div className="text-[10px] text-muted">ريال</div>
                        </div>
                      </div>

                      {editing === r.id ? (
                        <div className="mt-3 border-t border-line pt-3 space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(STATUS).map(([k, v]) => (
                              <button key={k} onClick={() => setEStatus(k)}
                                className={`text-[11px] px-2.5 py-1 rounded-full border ${eStatus === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted"}`}
                                title={v.hint}>{v.label}</button>
                            ))}
                          </div>
                          <input className="fld text-sm" value={eNote} onChange={(e) => setENote(e.target.value)}
                            placeholder="آخر ما جرى: وعد بالسداد نهاية الشهر · رقم القضية · سبب الشطب…" />
                          <div className="flex gap-2">
                            <button className="btn btn-primary text-xs" disabled={busy} onClick={() => save(r)}>حفظ</button>
                            <button className="btn btn-ghost text-xs" onClick={() => setEditing(null)}>إلغاء</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 mt-2.5 flex-wrap">
                          <button className="btn btn-ghost text-xs"
                            onClick={() => { setEditing(r.id); setEStatus(String(r.debt_status || "open")); setENote(r.debt_note || ""); }}>
                            ✎ حدّث المتابعة
                          </button>
{r.phone ? (
                          <a className="btn btn-wa text-xs" href={waLink(r.phone, msg(r))} target="_blank" rel="noreferrer"
                            onClick={(e) => { e.preventDefault(); openExternal(waLink(r.phone, msg(r))); }}>
                            💬 طالبه
                          </a>
                          ) : (
                            /* دين قديم رُحّل قبل v45: الجوال لم يُحفظ يومها — لا نفتح واتساب لرقم فارغ */
                            <span className="text-[11px] text-muted self-center">لا جوال محفوظ</span>
                          )}
                          <button className="btn btn-primary text-xs" disabled={busy} onClick={() => recordPayment(r)}>
                            ✔ سجّل سدادًا
                          </button>
                          {(r.source === "past" || (Number(r._carried) || 0) > 0) && (
                            <button className="btn btn-ghost text-xs text-late" disabled={busy} onClick={() => writeOff(r)}>
                              {r.source === "unit" && (Number(r._legacy) || 0) > 0 ? `شطب المرحَّل (${sar(Number(r._carried))})` : "شطب"}
                            </button>
                          )}
                          {r.source === "unit" && (Number(r._legacy) || 0) > 0 && (
                            <span className="text-[11px] text-muted self-center basis-full">
                              متأخرات المستأجر السابق ({sar(Number(r._legacy))}) تُسوّى بإعادة تأجير الوحدة: تُؤرشف باسمه، ثم تُحصَّل أو تُشطب من هنا.
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        <div className="border-t border-line bg-white px-3 py-2.5 text-[11px] text-muted leading-relaxed">
          المسدَّد بالكامل يختفي من هنا تلقائيًّا، والمشطوب يبقى في فلتر «مشطوب» بسببه.
          والدين الذي مضى عليه أكثر من سنة يظهر بالأحمر: فرصة تحصيله تقلّ كلما تأخّرت.
        </div>
      </div>
    </div>
  );
}
