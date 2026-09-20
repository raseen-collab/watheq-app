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
import { contractState } from "@/lib/contracts";
import { waLink, openExternal } from "@/lib/utils";

const sar = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

type Row = {
  id: string; name: string; unit: string | null; phone: string | null;
  carried_debt: number; debt_since: string | null; debt_status: string | null;
  debt_note: string | null; status: string | null; property_id: string;
  property_name?: string;
};

const STATUS: Record<string, { label: string; cls: string; hint: string }> = {
  open:        { label: "مفتوح",            cls: "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]", hint: "لم تبدأ متابعته بعد" },
  promised:    { label: "وعد بالسداد",      cls: "bg-[#FDECD2] text-[#9A4B00] border-[#F5CFA0]", hint: "وعد بموعد — تابعه في وقته" },
  legal:       { label: "أُحيل للتنفيذ",    cls: "bg-[#EEF4FB] text-[#2B5C8A] border-[#CFE0F0]", hint: "عند المحكمة أو المحامي" },
  settled:     { label: "سُوّي",             cls: "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]", hint: "سُدّد — صفّر المبلغ ليختفي" },
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
    : d === 1 ? "يوم" : d === 2 ? "يومين" : `${d} يومًا`;
  return { days: d, txt, tone: d > 365 ? "text-late font-bold" : d > 180 ? "text-[#9A4B00] font-semibold" : "text-muted" };
}

export default function DebtFollowUp({ properties, orgName, onClose }: {
  properties: { id: string; name: string }[];
  orgName?: string;
  onClose: () => void;
}) {

  /* قفل تمرير الصفحة خلف النافذة — يُزال حتمًا عند الإغلاق */
  useEffect(() => {
    document.body.classList.add("wq-modal-open");
    return () => document.body.classList.remove("wq-modal-open");
  }, []);
  const supabase = useMemo(() => createClient(), []);
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
    supabase.from("tenants")
      /**
       * كان يقرأ «carried_debt» وحده فيعطي صفرًا بينما شقة شاغرة عليها
       * 12,000 موسومة «على المستأجر السابق» — ذاك مبلغ آخر (متأخرات لم
       * تُرحَّل بعد، تُحسب من حالة العقد لا من عمود). نجلب الشاغرة كذلك
       * ونحسب متأخراتها هنا.
       */
      .select("id,name,unit,phone,carried_debt,debt_since,debt_status,debt_note,status,property_id,rent_amount,payment_frequency,contract_start,contract_periods,paid_periods,partial_amount,calendar,move_out_date")
      .or("carried_debt.gt.0,status.eq.vacated").limit(5000)
      .then(({ data, error }: any) => {
        if (!alive) return;
        if (error) {
          setErr(/column|does not exist/i.test(error.message) ? "شغّل schema-v36 في قاعدة البيانات أولًا." : error.message);
          setRows([]); return;
        }
        /* لكل صفّ: الدين المرحَّل + متأخرات المستأجر السابق إن كانت شاغرة */
        setRows((data || []).map((x: any) => {
          const carried = Number(x.carried_debt) || 0;
          let legacy = 0;
          if (String(x.status) === "vacated") {
            try { legacy = Math.max(0, contractState(x as any, {}).legacyArrears || 0); } catch { legacy = 0; }
          }
          return { ...x, carried_debt: carried + legacy, _legacy: legacy,
                   property_name: nameOf[x.property_id] || "—" };
        }).filter((x: any) => Number(x.carried_debt) > 0));
      });
    return () => { alive = false; };
  }, [supabase, nameOf]);

  async function save(id: string) {
    setBusy(true);
    const { data, error } = await supabase.from("tenants")
      .update({ debt_status: eStatus, debt_note: eNote.trim() || null })
      .eq("id", id).select("id,debt_status,debt_note");
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data?.length) return setErr("هذا التعديل يحتاج صلاحية أعلى.");
    setRows((cur) => (cur || []).map((r) => (r.id === id ? { ...r, debt_status: data[0].debt_status, debt_note: data[0].debt_note } : r)));
    setEditing(null);
  }

  async function clearDebt(r: Row) {
    if (!confirm(
      `تصفير الدين المرحَّل؟\n\n${r.name} — ${r.property_name}\n${sar(r.carried_debt)} ريال\n\n`
      + `استعمله إذا سُدّد الدين فعلًا أو قررت شطبه.\nيختفي من هذه الشاشة ومن بطاقة الوحدة.`
    )) return;
    setBusy(true);
    const { error } = await supabase.from("tenants").update({ carried_debt: 0 }).eq("id", r.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setRows((cur) => (cur || []).filter((x) => x.id !== r.id));
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
                    <div key={r.id} className="bg-white border border-line rounded-xl p-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="font-semibold text-deep">
                            {r.name}
                            <span className={`ms-2 text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                            {String(r.status) === "vacated" && <span className="ms-1 text-[11px] text-muted">· أخلى الوحدة</span>}
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
                            <button className="btn btn-primary text-xs" disabled={busy} onClick={() => save(r.id)}>حفظ</button>
                            <button className="btn btn-ghost text-xs" onClick={() => setEditing(null)}>إلغاء</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 mt-2.5 flex-wrap">
                          <button className="btn btn-ghost text-xs"
                            onClick={() => { setEditing(r.id); setEStatus(String(r.debt_status || "open")); setENote(r.debt_note || ""); }}>
                            ✎ حدّث المتابعة
                          </button>
                          <a className="btn btn-wa text-xs" href={waLink(r.phone, msg(r))} target="_blank" rel="noreferrer"
                            onClick={(e) => { e.preventDefault(); openExternal(waLink(r.phone, msg(r))); }}>
                            💬 طالبه
                          </a>
                          <button className="btn btn-ghost text-xs text-late" disabled={busy} onClick={() => clearDebt(r)}>
                            🗑 صفّر الدين
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        <div className="border-t border-line bg-white px-3 py-2.5 text-[11px] text-muted leading-relaxed">
          «صفّر الدين» للمسدَّد أو المشطوب — يختفي من هنا ومن بطاقة الوحدة.
          والدين الذي مضى عليه أكثر من سنة يظهر بالأحمر: فرصة تحصيله تقلّ كلما تأخّرت.
        </div>
      </div>
    </div>
  );
}
