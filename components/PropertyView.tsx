"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, waLink, today } from "@/lib/utils";
import { contractState, buildSchedule, FREQUENCIES, freqLabel, freqShort, derivedEndDate, renewContract, needsRenewal, applyPayment, splitVat, isCommercial, isVacant, settleDeposit,
  vacancyDays, TURNOVER_CHECKLIST, type Frequency } from "@/lib/contracts";
import { PROPERTY_TYPES, typeLabel, unitLabel, typeIcon } from "@/lib/domain";
import { statementHTML, invoiceHTML, propertyStatementHTML, moveOutSettlementHTML, quotationHTML, ownerReportHTML, DEFAULT_CHARGES, openDoc, type ChargeRow, type OwnerReportPayment } from "@/lib/documents";
import { alertCount, type ComplianceItem } from "@/lib/compliance";
import ComplianceModal from "@/components/ComplianceModal";
import OwnerStatementModal from "@/components/OwnerStatementModal";
import ExpensesModal from "@/components/ExpensesModal";
import OwnerLinkModal from "@/components/OwnerLinkModal";
import type { ExpenseRow } from "@/lib/expenses";

/** تحويل كل دورة إلى مكافئ شهري لحساب الدخل التقريبي */
const PERIODS_PER_MONTH: Record<Frequency, number> = {
  daily: 30, weekly: 4.33, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12,
};

type Tenant = {
  id: string; name: string; unit: string | null; phone: string | null; national_id: string | null;
  rent_amount: number; contract_start: string | null; contract_end: string | null;
  payment_frequency: string | null; paid_periods: number | null; contract_periods: number | null;
  partial_amount?: number | null;
  litigation?: boolean | null; enforcement_no?: string | null; enforcement_order?: string | null;
  billing_anchor_day?: number | null;
  status?: string | null; notice_date?: string | null; move_out_date?: string | null;
  deposit_amount?: number | null; deposit_deductions?: number | null; deposit_notes?: string | null;
  meter_elec_in?: string | null; meter_elec_out?: string | null;
  meter_water_in?: string | null; meter_water_out?: string | null;
  turnover_checklist?: { label: string; done?: boolean; note?: string | null }[] | null;
};
type Note = { id: string; note_date: string; text: string };
type Property = {
  id: string; name: string; address: string | null; city: string | null; manager: string | null;
  property_type: string | null; collected: number;
  grace_days?: number | null;
  vat_enabled?: boolean | null; vat_rate?: number | null; vat_inclusive?: boolean | null;
  mgmt_fee_pct?: number | null;
  owner_name?: string | null;
  tenants: Tenant[]; property_notes: Note[];
};

/** حالة الصف المعروضة (تشمل «في التنفيذ») */
type RowKey = "vacant" | "litigation" | "late" | "partial" | "soon" | "expiring" | "ok";
type Row = { t: Tenant; st: ReturnType<typeof contractState>; key: RowKey };

const ROW_META: Record<RowKey, { label: string; dot: string; cls: string }> = {
  vacant:     { label: "شاغرة",        dot: "bg-[#94A3B8]", cls: "bg-[#F1F5F9] text-[#475569]" },
  litigation: { label: "في التنفيذ",  dot: "bg-[#64748B]", cls: "bg-[#EEF1F4] text-[#475569]" },
  late:       { label: "متأخر",        dot: "bg-late",      cls: "bg-[#FBE9E7] text-[#a5322c]" },
  partial:    { label: "سداد جزئي",    dot: "bg-[#EA8C00]", cls: "bg-[#FDF0DC] text-[#9A5B00]" },
  soon:       { label: "يستحق قريبًا", dot: "bg-gold",      cls: "bg-[#FBF1DF] text-[#8a5a11]" },
  expiring:   { label: "نافذة التجديد", dot: "bg-[#7C3AED]", cls: "bg-[#F1EBFC] text-[#5B21B6]" },
  ok:         { label: "منتظم",        dot: "bg-paid",      cls: "bg-[#E6F4EC] text-[#137a50]" },
};

function rowKey(t: Tenant, st: ReturnType<typeof contractState>): RowKey {
  if (isVacant(t)) return "vacant";
  if (t.litigation) return "litigation";
  if (st.status === "late") return st.hasPartial ? "partial" : "late";
  if (st.status === "soon") return "soon";
  if (st.daysToEnd !== null && st.daysToEnd <= 60 && st.daysToEnd >= 0) return "expiring";
  return "ok";
}

const URGENCY: Record<RowKey, number> = { late: 0, partial: 1, soon: 2, expiring: 3, litigation: 4, vacant: 5, ok: 6 };

export default function PropertyView({ initial, orgName, issuer, compliance }: { initial: Property[]; orgName: string; issuer?: any; compliance?: ComplianceItem[] }) {
  const supabase = createClient();
  const router = useRouter();
  /** يضمن أن كل عقار يحمل مصفوفتيه — يمنع انكسار العرض عند صفٍّ جديد */
  const normalize = (list: Property[]): Property[] =>
    (list || []).map((p) => ({
      ...p,
      tenants: Array.isArray(p?.tenants) ? p.tenants : [],
      property_notes: Array.isArray(p?.property_notes) ? p.property_notes : [],
    }));

  const [items, setItems] = useState<Property[]>(() => normalize(initial));
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id || null);
  const [modal, setModal] = useState<null | { kind: "newProp" | "editProp" | "tenant"; id?: string }>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  // ⚖️ التزامات المكتب: تُدار محليًّا وتُزامَن مع بيانات السيرفر عند كل refresh
  const [comp, setComp] = useState<ComplianceItem[]>(compliance || []);
  useEffect(() => { setComp(compliance || []); }, [compliance]);
  const [compOpen, setCompOpen] = useState(false);
  const [ownerStmtOpen, setOwnerStmtOpen] = useState(false);
  const ownerNames = Array.from(new Set(items.map((p) => (p.owner_name || "").trim()).filter(Boolean))).sort();
  const [reporting, setReporting] = useState(false);
  const [expensesOpen, setExpensesOpen] = useState(false);
  const [ownerLinkOpen, setOwnerLinkOpen] = useState(false);
  const [doc, setDoc] = useState<null | { title: string; body: string }>(null);
  const [history, setHistory] = useState<null | { tenant: Tenant; rows: any[] }>(null);
  const [schedule, setSchedule] = useState<Tenant | null>(null);
  const [renewing, setRenewing] = useState<Tenant | null>(null);
  const [enforcing, setEnforcing] = useState<Tenant | null>(null);
  const [paying, setPaying] = useState<Tenant | null>(null);
  const [turnover, setTurnover] = useState<Tenant | null>(null);
  const [remindAll, setRemindAll] = useState(false);

  // ---------- أدوات العرض: بحث / تصفية / فرز / إشعار ----------
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | RowKey>("all");
  const [sort, setSort] = useState<"urgent" | "due" | "amount" | "name">("urgent");
  const [toast, setToast] = useState<null | { k: "ok" | "err"; m: string }>(null);
  // الحسابات تعتمد على تاريخ اليوم، وتوقيت السيرفر يختلف عن توقيت الجهاز.
  // لذلك نرسم المحتوى المعتمد على التاريخ بعد الإماهة فقط — يمنع خطأ hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  // يزامن اللوحة مع أحدث بيانات السيرفر — يمنع اختلاف الأرقام بعد تسجيل دفعة من البوت
  useEffect(() => { setItems(normalize(initial)); }, [initial]);
  const [refreshing, setRefreshing] = useState(false);
  function refreshNow() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 1200);
  }
  function notify(k: "ok" | "err", m: string) {
    setToast({ k, m });
    setTimeout(() => setToast(null), 3600);
  }

  const active = useMemo(() => items.find((p) => p.id === activeId) || null, [items, activeId]);

  // ── تُحسب قبل أي خروج مبكر حتى يبقى ترتيب الـhooks ثابتًا ──
  const allRowsForFilter: Row[] = useMemo(() => {
    const prop = active;
    if (!prop) return [];
    const g = { graceDays: Number(prop.grace_days) || 0 };
    const list = Array.isArray(prop.tenants) ? prop.tenants : [];
    return list.map((t) => { const st = contractState(t, g); return { t, st, key: rowKey(t, st) }; });
  }, [active]);

  // الصفوف المعروضة: بحث ← تصفية ← فرز
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = allRowsForFilter.filter((r) => {
      if (filter !== "all" && r.key !== filter) return false;
      if (!needle) return true;
      return [r.t.name, r.t.unit, r.t.phone].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
    out = [...out].sort((a, b) => {
      if (sort === "amount") return b.st.amountDue - a.st.amountDue;
      if (sort === "name") return String(a.t.name || "").localeCompare(String(b.t.name || ""), "ar");
      if (sort === "due") return String(a.st.nextDueDate || "9999").localeCompare(String(b.st.nextDueDate || "9999"));
      // urgent: الأهم أولًا، ثم الأكبر مبلغًا
      const d = URGENCY[a.key] - URGENCY[b.key];
      return d !== 0 ? d : b.st.amountDue - a.st.amountDue;
    });
    return out;
  }, [allRowsForFilter, q, filter, sort]);


  /** هوية المستخدم الحالي — تشترطها سياسة الصلاحيات (RLS) عند الإدراج */
  /** معرّف المكتب لا المستخدم — دفعة الموظف تُحفظ تحت مكتبه (v9) */
  async function currentUserId(): Promise<string | null> {
    const oid = await officeId(supabase);
    if (oid) return oid;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  }

  /** تسجيل مبلغ مستلم — يحوّل الجزئي إلى دفعات كاملة تلقائيًّا */
  async function recordPayment(t: Tenant, amount: number, method = "transfer", note?: string) {
    const amt = Math.max(0, Number(amount) || 0);
    if (!amt || !active) return;
    const r = applyPayment(t, amt);
    await patchTenant(t.id, { paid_periods: r.paid_periods, partial_amount: r.partial_amount }, amt);

    // سجل الدفعة — يحفظ التاريخ والمبلغ والطريقة للإثبات لاحقًا
    const uid = await currentUserId();
    if (uid) {
      const { error } = await supabase.from("payments").insert({
        user_id: uid, tenant_id: t.id, property_id: active.id,
        paid_on: today(), amount: amt, method,
        periods_covered: r.completed, note: note || null,
      });
      if (error) console.error("Watheq payment log error:", error);
    }

    notify("ok", r.completed > 0
      ? `سُجّل ${sar(amt)} ريال — اكتملت ${r.completed} دفعة`
      : `سُجّل ${sar(amt)} ريال كسداد جزئي`);
  }

  /** تسجيل الإخلاء: تتحوّل الوحدة إلى «شاغرة» ويُوثَّق التسليم */
  async function saveTurnover(t: Tenant, d: any) {
    if (!active) return;
    const patch = {
      status: "vacated",
      notice_date: d.notice_date || null,
      move_out_date: d.move_out_date || today(),
      deposit_amount: Number(d.deposit_amount) || 0,
      deposit_deductions: Number(d.deposit_deductions) || 0,
      deposit_notes: (d.deposit_notes || "").trim() || null,
      meter_elec_out: (d.meter_elec_out || "").trim() || null,
      meter_water_out: (d.meter_water_out || "").trim() || null,
      turnover_checklist: d.checklist || [],
    };
    await patchTenant(t.id, patch);
    // توثيق في سجل العقار حتى لا يضيع تاريخ المستأجر السابق
    await supabase.from("property_notes").insert({
      property_id: active.id, note_date: today(),
      text: `إخلاء ${unitLabel(active.property_type)} ${t.unit || "—"} — ${t.name} بتاريخ ${patch.move_out_date}` +
            (patch.deposit_amount ? ` · تأمين ${sar(patch.deposit_amount)} ريال` : "") +
            (patch.deposit_deductions ? ` · خصومات ${sar(patch.deposit_deductions)} ريال` : ""),
    });
    setTurnover(null);
    notify("ok", "سُجّل الإخلاء — الوحدة صارت شاغرة.");
    router.refresh();
  }

  /** إعادة التأجير: تُفتح نافذة الوحدة ببيانات جديدة */
  function reLet(t: Tenant) {
    setModal({ kind: "tenant", id: t.id });
    notify("ok", "أدخل بيانات المستأجر الجديد — ستعود الوحدة مؤجّرة عند الحفظ.");
  }

  /** مخالصة الإخلاء (مستند) */
  function openSettlement(t: Tenant) {
    if (!active) return;
    openDoc(moveOutSettlementHTML(t as any, active as any, issuer || {}));
  }

  /** يفتح سجل دفعات مستأجر معيّن */
  async function openHistory(t: Tenant) {
    const { data, error } = await supabase.from("payments")
      .select("*").eq("tenant_id", t.id).order("paid_on", { ascending: false }).limit(200);
    if (error) { console.error("Watheq history error:", error); return notify("err", error.message); }
    setHistory({ tenant: t, rows: data || [] });
  }
  async function saveProperty(d: any, id?: string) {
    const payload = {
      name: d.name, address: d.address || null, city: d.city || null,
      manager: d.manager || orgName || null, property_type: d.property_type || "residential",
      grace_days: Math.max(0, Math.min(30, Number(d.grace_days) || 0)),
      vat_enabled: !!d.vat_enabled,
      vat_rate: Number(d.vat_rate) || 15,
      vat_inclusive: d.vat_inclusive !== false,
      // نسبة أتعاب الإدارة: تُخصم من المحصَّل في تقرير المالك (فارغة = لا أتعاب)
      mgmt_fee_pct: Number(d.mgmt_fee_pct) > 0 && Number(d.mgmt_fee_pct) <= 100 ? Number(d.mgmt_fee_pct) : null,
      // اسم المالك يجمع عقاراته في كشف واحد (schema-v10) — يُقصّ حتى لا تتشتت الأسماء بمسافات
      owner_name: (d.owner_name || "").trim() || null,
    };
    if (id) {
      const { error } = await supabase.from("properties").update(payload).eq("id", id);
      if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
      setItems(items.map((p) => (p.id === id ? { ...p, ...payload } as Property : p)));
    } else {
      const uid = await currentUserId();
      if (!uid) return notify("err", "انتهت الجلسة — أعد تسجيل الدخول ثم حاول مرة أخرى.");
      const { data, error } = await supabase.from("properties")
        .insert({ ...payload, collected: 0, user_id: uid }).select("*").single();
      if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
      const next = { ...(data as any), tenants: [], property_notes: [] };
      setItems([next, ...items]); setActiveId(next.id);
    }
    setModal(null);
  }

  async function deleteProperty() {
    if (!active || !confirm("حذف العقار وكل وحداته؟")) return;
    const { data: _del, error } = await supabase.from("properties").delete().eq("id", active.id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    const rest = items.filter((p) => p.id !== active.id);
    setItems(rest); setActiveId(rest[0]?.id || null); setModal(null);
  }

  async function saveTenant(d: any, id?: string) {
    if (!active) return;
    const freq = (d.payment_frequency || "monthly") as Frequency;
    const periods = d.contract_periods ? Number(d.contract_periods) : null;
    const payload = {
      property_id: active.id, name: d.name, unit: d.unit || null, phone: d.phone || null,
      national_id: d.national_id || null, rent_amount: Number(d.rent_amount) || 0,
      contract_start: d.contract_start || null,
      payment_frequency: freq,
      contract_periods: periods,
      contract_end: d.contract_start ? derivedEndDate(d.contract_start, freq, periods) : null,
      billing_anchor_day: d.contract_start ? new Date(d.contract_start).getDate() : null,
    };
    if (id) {
      // إن كانت الوحدة شاغرة فهذا تأجير جديد: تُصفَّر عدّادات المدة السابقة
      const prev = active.tenants.find((x) => x.id === id);
      const reletting = prev && isVacant(prev);
      const full: any = reletting
        ? { ...payload, status: "active", paid_periods: 0, partial_amount: 0,
            notice_date: null, move_out_date: null, deposit_deductions: 0,
            meter_elec_out: null, meter_water_out: null, turnover_checklist: [] }
        : payload;
      const { error } = await supabase.from("tenants").update(full).eq("id", id);
      if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
      setItems(items.map((p) => p.id === active.id
        ? { ...p, tenants: p.tenants.map((t) => (t.id === id ? { ...t, ...full } as Tenant : t)) } : p));
    } else {
      const { data, error } = await supabase.from("tenants").insert({ ...payload, paid_periods: 0 }).select("*").single();
      if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
      setItems(items.map((p) => (p.id === active.id ? { ...p, tenants: [...p.tenants, data as Tenant] } : p)));
    }
    setModal(null);
  }

  async function patchTenant(id: string, patch: any, collectedDelta = 0) {
    if (!active) return;
    const { error } = await supabase.from("tenants").update(patch).eq("id", id);
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    if (collectedDelta) await supabase.from("properties").update({ collected: (active.collected || 0) + collectedDelta }).eq("id", active.id);
    setItems(items.map((p) => p.id === active.id ? {
      ...p,
      collected: collectedDelta ? (p.collected || 0) + collectedDelta : p.collected,
      tenants: p.tenants.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    } : p));
  }

  async function deleteTenant(id: string) {
    if (!active || !confirm("حذف هذه الوحدة؟")) return;
    const { data: _del, error } = await supabase.from("tenants").delete().eq("id", id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((p) => (p.id === active.id ? { ...p, tenants: p.tenants.filter((t) => t.id !== id) } : p)));
  }

  async function addNote(text: string) {
    if (!active || !text.trim()) return;
    const { data, error } = await supabase.from("property_notes")
      .insert({ property_id: active.id, text: text.trim(), note_date: today() }).select("*").single();
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((p) => (p.id === active.id ? { ...p, property_notes: [data as Note, ...p.property_notes] } : p)));
  }

  async function deleteNote(id: string) {
    if (!active) return;
    const { data: _delN } = await supabase.from("property_notes").delete().eq("id", id).select("id");
    if (!_delN || _delN.length === 0) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    setItems(items.map((p) => (p.id === active.id ? { ...p, property_notes: p.property_notes.filter((n) => n.id !== id) } : p)));
  }

  async function doRenew(t: Tenant, opts: { periods: number; newAmount: number | null; newFrequency: Frequency }) {
    if (!active) return;
    const fields = renewContract(t, { periods: opts.periods, newAmount: opts.newAmount, newFrequency: opts.newFrequency });
    const { error } = await supabase.from("tenants").update(fields).eq("id", t.id);
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    // توثيق التجديد في سجل العقار
    await supabase.from("property_notes").insert({
      property_id: active.id, note_date: today(),
      text: `تجديد عقد ${t.name} (${unitLabel(active.property_type)} ${t.unit || "—"}) — من ${fields.contract_start} إلى ${fields.contract_end} بقيمة ${sar(fields.rent_amount)} ريال / ${freqShort(fields.payment_frequency)}`,
    });
    setItems(items.map((pp) => pp.id === active.id ? {
      ...pp,
      tenants: pp.tenants.map((x) => (x.id === t.id ? { ...x, ...fields } as Tenant : x)),
    } : pp));
    setRenewing(null);
    router.refresh();
  }

  async function openStatement(t: Tenant) {
    if (!active) return;
    // نجلب سجل المدفوعات الموثّق ليظهر في الكشف بتواريخه وطرقه
    const { data, error } = await supabase.from("payments")
      .select("id,paid_on,amount,method,periods_covered,note")
      .eq("tenant_id", t.id).order("paid_on", { ascending: true }).limit(500);
    if (error) console.error("Watheq statement payments error:", error);
    openDoc(statementHTML(t as any, active as any, issuer || {}, (data || []) as any));
  }

  function openPropertyStatement() {
    if (!active) return;
    openDoc(propertyStatementHTML(active as any, issuer || {}));
  }

  /** تصدير وحدات العقار CSV — يفتح مباشرة في Excel بترميز عربي سليم */
  function exportCSV() {
    if (!active) return;
    const ul = unitLabel(active.property_type);
    const g = { graceDays: Number(active.grace_days) || 0 };
    const head = ["الاسم", ul, "الجوال", "الهوية/السجل", "الإيجار", "الدورة",
      "بداية العقد", "نهاية العقد", "الحالة", "المتأخر (ريال)", "الدفعة القادمة"];
    const lines = (active.tenants || []).map((t) => {
      const st = contractState(t, g);
      const key = rowKey(t, st);
      return [t.name, t.unit || "", t.phone || "", t.national_id || "",
        Number(t.rent_amount) || 0, freqShort(t.payment_frequency),
        t.contract_start || "", st.endDate || "", ROW_META[key].label,
        key === "late" || key === "partial" ? st.amountDue : 0, st.nextDueDate || ""]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    });
    const csv = "\uFEFF" + [head.join(","), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const aEl = document.createElement("a");
    aEl.href = url; aEl.download = `${active.name}-${today()}.csv`;
    aEl.click(); URL.revokeObjectURL(url);
  }

  async function openInvoice(t: Tenant) {
    if (!active) return;
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0 });
    const total = t.contract_periods || 12;
    const n = Math.min((t.paid_periods || 0) + 1, total);
    const period = `الدفعة ${n} من ${total}`;
    const amount = Number(t.rent_amount) || 0;
    const dueDate = st.nextDueDate || today();

    // ترقيم متسلسل من قاعدة البيانات
    let invoiceNo = `INV-${new Date().getFullYear()}-0001`;
    const { data } = await supabase.rpc("next_invoice_no", { p_user: await officeId(supabase) });
    if (typeof data === "string") invoiceNo = data;

    await supabase.from("invoices").insert({
      user_id: await officeId(supabase),
      tenant_id: t.id, property_id: active.id,
      invoice_no: invoiceNo, due_date: dueDate, period_label: period, amount,
    });

    openDoc(invoiceHTML(t as any, active as any, { invoice_no: invoiceNo, amount, due_date: dueDate, period_label: period }, issuer || {}));
  }

  /** تذكير ودّي — يوضّح تفاصيل المطالبة وتاريخ استحقاقها */
  function remindLink(t: Tenant) {
    if (!active) return "#";
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0 });
    const who = active.manager || orgName || "إدارة الأملاك";
    const ul = unitLabel(active.property_type);
    const unit = `${ul} (${t.unit || "—"})`;
    const v = { enabled: !!active.vat_enabled, rate: Number(active.vat_rate) || 15, inclusive: active.vat_inclusive !== false };
    const one = splitVat(Number(t.rent_amount) || 0, v);

    const L: string[] = [`السلام عليكم ورحمة الله، ${t.name} 🌿`, ""];

    if (st.unpaid === 0) {
      L.push(`تذكير ودّي بأن الدفعة القادمة عن ${unit} بعقار ${active.name} تستحق بتاريخ ${st.nextDueDate}.`);
      if (one.total) L.push(`• قيمة الدفعة: ${sar(one.total)} ريال${v.enabled ? ` (منها ${sar(one.vat)} ريال ضريبة قيمة مضافة)` : ""}`);
    } else {
      L.push(`نودّ تذكيركم بوجود مستحقّات غير مسدَّدة عن ${unit} بعقار ${active.name}، وبيانها:`);
      L.push(`• عدد الدفعات المتأخرة: ${st.unpaid}`);
      if (one.total) L.push(`• قيمة الدفعة: ${sar(one.total)} ريال`);
      if (st.hasPartial) L.push(`• المسدَّد جزئيًّا: ${sar(st.partial)} ريال`);
      L.push(`• المبلغ المتبقّي: ${sar(st.amountDue)} ريال`);
      if (st.nextDueDate) L.push(`• تاريخ أقرب دفعة مستحقة: ${st.nextDueDate}`);
    }

    L.push("");
    L.push("ويكون السداد بالوسيلة المتفق عليها في العقد.");
    L.push("");
    L.push("فإن كان السداد قد تم فنعتذر عن التذكير، ونرجو تزويدنا بما يفيد لتحديث السجل.");
    L.push("");
    L.push("شاكرين لكم حسن تعاونكم،");
    L.push(who);
    return waLink(t.phone, L.join("\n"));
  }

  /** إشعار مكتوب — يوضّح المطالبة والمسار النظامي عبر «إيجار» و«ناجز» */
  function makeNotice(t: Tenant) {
    if (!active) return;
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0 });
    const who = active.manager || orgName || "إدارة الأملاك";
    const ul = unitLabel(active.property_type);
    const v = { enabled: !!active.vat_enabled, rate: Number(active.vat_rate) || 15, inclusive: active.vat_inclusive !== false };
    const one = splitVat(Number(t.rent_amount) || 0, v);
    const totalDue = splitVat(st.amountDue, v);

    // نطاق الفترة المتأخرة: من أول دفعة غير مسدَّدة إلى أحدث دفعة استحقّت
    const sch = buildSchedule(t);
    const lateRows = sch.filter((r) => r.status === "late" || r.status === "partial");
    const fromDate = lateRows[0]?.date || st.nextDueDate || "—";
    const toDate = lateRows[lateRows.length - 1]?.date || fromDate;

    const body = [
      "إشعار بسداد أجرة متأخرة",
      `التاريخ: ${today()}`,
      "",
      `من: ${who}`,
      `إلى: المكرَّم ${t.name}${t.national_id ? `، هوية/سجل رقم (${t.national_id})` : ""}، شاغل ${ul} رقم (${t.unit || "—"}) بعقار ${active.name}${active.address ? ` — ${active.address}` : ""}${active.city ? `، ${active.city}` : ""}.`,
      "",
      "الموضوع: مطالبة بسداد الأجرة المتأخرة.",
      "",
      "السلام عليكم ورحمة الله وبركاته،",
      "",
      `بالإشارة إلى عقد الإيجار المبرم بيننا (بداية العقد: ${t.contract_start || "—"}، نهايته: ${st.endDate || "—"}، دورة السداد: ${freqLabel(t.payment_frequency)}${one.total ? `، وقيمة الدفعة ${sar(one.total)} ريال` : ""})؛`,
      "",
      `نفيدكم بأنه قد ترصَّد بذمّتكم مبلغ (${sar(st.amountDue)}) ريال، قيمة (${st.unpaid}) دفعة مستحقة عن الفترة من (${fromDate}) إلى (${toDate})${st.hasPartial ? `، بعد خصم مبلغ (${sar(st.partial)}) ريال مسدَّد جزئيًّا` : ""}، ولم يُسدَّد حتى تاريخ هذا الإشعار.`,
      ...(v.enabled && totalDue.vat > 0 ? ["", `ويشمل المبلغ المذكور ضريبة قيمة مضافة قدرها (${sar(totalDue.vat)}) ريال بنسبة (${v.rate}%).`] : []),
      "",
      "لذا نأمل المبادرة بسداد المبلغ خلال (5) أيام من تاريخ استلامكم هذا الإشعار، بالوسيلة المتفق عليها في العقد، وتزويدنا بما يفيد السداد.",
      "",
      "وفي حال عدم السداد خلال المدة المذكورة، فسيتّخذ المؤجّر ما يحفظ حقوقه من إجراءات نظامية، ومنها إرسال إنذار رسمي عبر منصة «إيجار»، ثم تقديم طلب تنفيذ عبر بوابة «ناجز» استنادًا إلى عقد الإيجار الموثّق بوصفه سندًا تنفيذيًّا.",
      "",
      "ونؤكّد رغبتنا في استمرار العلاقة التعاقدية وحلّ الأمر ودّيًا.",
      "",
      "وتقبّلوا تحياتنا،",
      who,
      "",
      "الاسم: ____________________     الصفة: ____________________",
      `التوقيع: ____________________     التاريخ: ${today()}`,
    ].join("\n");
    setDoc({ title: `إشعار سداد — ${t.name}`, body });
  }

  if (!hydrated) {
    return <div className="text-center text-muted py-16 text-sm">جارٍ تحميل لوحتك…</div>;
  }

  if (!items.length) {
    return (
      <div className="max-w-lg mx-auto bg-white border border-line rounded-2xl shadow-sm p-8 mt-8 text-center">
        <div className="text-4xl mb-3">🏢</div>
        <h2 className="font-display text-xl font-bold text-deep mb-2">أضف أول عقار لك</h2>
        <p className="text-muted mb-6">عمارة، معرض تجاري، مكتب، مستودع، فيلا، أو أرض — كلها مدعومة.</p>
        <div className="flex gap-2 justify-center flex-wrap">
          <button className="btn btn-gold" onClick={() => setModal({ kind: "newProp" })}>+ إضافة عقار</button>
          <Link href="/dashboard/property/import" className="btn btn-ghost">رفع من ملف Excel</Link>
        </div>
        <PropertyModal open={modal?.kind === "newProp"} orgName={orgName} onClose={() => setModal(null)} onSubmit={(d) => saveProperty(d)} />
      </div>
    );
  }


  const p = active!;
  const ul = unitLabel(p.property_type);

  // كل الصفوف مع حالتها (تُستخدم للإحصاءات)
  const grace = { graceDays: Number(p.grace_days) || 0 };
  const vat = { enabled: !!p.vat_enabled, rate: Number(p.vat_rate) || 15, inclusive: p.vat_inclusive !== false };
  const tenants = Array.isArray(p.tenants) ? p.tenants : [];
  const notes = Array.isArray(p.property_notes) ? p.property_notes : [];
  const allRows: Row[] = allRowsForFilter;

  const counts = allRows.reduce((acc, r) => { acc[r.key] = (acc[r.key] || 0) + 1; return acc; },
    {} as Record<RowKey, number>);
  const lateRows = allRows.filter((r) => r.key === "late" || r.key === "partial");
  const lateCount = lateRows.length;
  const monthlyIncome = tenants.reduce((sum, t) =>
    sum + (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency], 0);
  const overdue = lateRows.reduce((s, r) => s + r.st.amountDue, 0);
  const pct = allRows.length ? Math.round(((allRows.length - lateRows.length) / allRows.length) * 100) : 100;


  const expiringSoon = allRows
    .filter((r) => r.st.daysToEnd !== null && r.st.daysToEnd <= 60 && r.st.daysToEnd >= 0 && !r.t.litigation)
    .sort((a, b) => (a.st.daysToEnd || 0) - (b.st.daysToEnd || 0))[0];
  const editing = modal?.kind === "tenant" && modal.id ? tenants.find((t) => t.id === modal.id) : undefined;

  // ملخّص المحفظة كاملة (كل العقارات)
  const portfolio = items.reduce((acc, prop) => {
    (Array.isArray(prop.tenants) ? prop.tenants : []).forEach((t) => {
      const st = contractState(t, { graceDays: Number(prop.grace_days) || 0 });
      acc.units++;
      if (st.status === "late") { acc.late++; acc.overdue += st.amountDue; }
      if (st.status === "soon") acc.soon++;
      if (st.daysToEnd !== null && st.daysToEnd <= 60 && st.daysToEnd >= 0) acc.expiring++;
      if (isVacant(t)) acc.vacant++;
      acc.monthly += (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency];
    });
    return acc;
  }, { units: 0, late: 0, soon: 0, overdue: 0, expiring: 0, monthly: 0, vacant: 0 });
  const occupancyPct = portfolio.units
    ? Math.round(((portfolio.units - portfolio.vacant) / portfolio.units) * 100) : 100;

  const chips: { k: "all" | RowKey; label: string }[] = [
    { k: "all", label: `الكل ${allRows.length}` },
    { k: "late", label: `متأخر ${counts.late || 0}` },
    { k: "soon", label: `قريب ${counts.soon || 0}` },
    { k: "expiring", label: `تجديد ${counts.expiring || 0}` },
    { k: "litigation", label: `تنفيذ ${counts.litigation || 0}` },
    { k: "vacant", label: `شاغرة ${counts.vacant || 0}` },
  ];

  return (
    <div>
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[70] rounded-xl px-4 py-3 text-sm font-semibold shadow-lg border ${
          toast.k === "ok" ? "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]" : "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]"}`}>
          {toast.m}
        </div>
      )}

      {items.length > 1 && (
        <div className="bg-deep text-[#EAF1EE] rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="font-display font-bold text-sm text-goldSoft">محفظتك · {items.length} عقارات</div>
          <PortfolioStat v={String(portfolio.units)} l="وحدة" />
          <PortfolioStat v={String(portfolio.late)} l="متأخرة" tone={portfolio.late ? "warn" : undefined} />
          <PortfolioStat v={sar(portfolio.overdue)} l="ريال متأخر" tone={portfolio.overdue ? "warn" : undefined} />
          <PortfolioStat v={String(portfolio.soon)} l="تستحق خلال 7 أيام" />
          <PortfolioStat v={String(portfolio.expiring)} l="عقود تنتهي قريبًا" />
          <PortfolioStat v={`${occupancyPct}%`} l={`إشغال (${portfolio.vacant} شاغرة)`} tone={portfolio.vacant ? "warn" : undefined} />
          <PortfolioStat v={sar(Math.round(portfolio.monthly))} l="دخل شهري تقريبي" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl flex items-center gap-2">
            <span>{typeIcon(p.property_type)}</span> {p.name}
          </h1>
          <div className="text-sm text-muted">{typeLabel(p.property_type)}{p.city ? ` · ${p.city}` : ""} · {tenants.length} {ul}</div>
        </div>
        <select value={p.id} onChange={(e) => setActiveId(e.target.value)} className="fld max-w-[220px] font-semibold text-deep">
          {items.map((x) => <option key={x.id} value={x.id}>{typeIcon(x.property_type)} {x.name}</option>)}
        </select>
        <button type="button" className="btn btn-ghost text-sm" onClick={refreshNow} disabled={refreshing}
          title="تحديث البيانات من السيرفر (بعد تسجيل دفعة من البوت مثلًا)">
          {refreshing ? "…" : "↻ تحديث"}
        </button>
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setCompOpen(true)}
          title="عقود الوساطة ومددها، تراخيص الإعلانات، ورخصة فال — بتنبيهات قبل فوات وقتها">
          ⚖️ الالتزامات{alertCount(comp) > 0 && (
            <span className="mr-1.5 inline-grid place-items-center min-w-[20px] h-5 px-1 rounded-full bg-[#FBE9E7] text-[#a5322c] text-[.68rem] font-bold">{alertCount(comp)}</span>
          )}
        </button>
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setOwnerStmtOpen(true)}
          title="كل عقارات المالك في كشف واحد لفترة تحددها">📑 كشف مالك</button>
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setModal({ kind: "editProp" })}>الإعدادات</button>
        <button className="btn btn-gold text-sm" onClick={() => setModal({ kind: "newProp" })}>+ عقار</button>
      </div>

      {expiringSoon && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl p-3.5 mb-4 border text-sm ${
          (expiringSoon.st.daysToEnd || 0) <= 30 ? "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]" : "bg-[#FBF1DF] border-[#EBD9AA] text-[#8a5a11]"}`}>
          <span>عقد {expiringSoon.t.name} ({ul} {expiringSoon.t.unit || "—"}) ينتهي خلال <b>{expiringSoon.st.daysToEnd}</b> يومًا ({expiringSoon.st.endDate}). جهّز التجديد أو الإخلاء.</span>
          <button className="btn btn-ghost text-xs mr-auto" onClick={() => setRenewing(expiringSoon.t)}>تجديد الآن</button>
        </div>
      )}

      {/* إحصاءات — قابلة للنقر للتصفية */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat v={sar(Math.round(monthlyIncome))} l="الدخل الشهري التقريبي" kpi="income" icon="↑" onClick={() => setFilter("all")} active={filter === "all"} />
        <Stat v={sar(overdue)} l={`المتأخر (${lateCount} وحدة)`} kpi="overdue" icon="!" onClick={() => { setFilter("late"); setSort("amount"); }} active={filter === "late"} />
        <Stat v={String(counts.soon || 0)} l="تستحق خلال 7 أيام" kpi="soon" icon="●" onClick={() => setFilter("soon")} active={filter === "soon"} />
        <Stat v={String(counts.expiring || 0)} l="عقود تنتهي قريبًا" kpi="expiring" icon="↻" onClick={() => setFilter("expiring")} active={filter === "expiring"} />
      </div>

      <div className="grid md:grid-cols-[1.65fr_1fr] gap-5 items-start">
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 gap-2 flex-wrap">
            <h2 className="font-semibold">الوحدات والمستأجرون</h2>
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-ghost text-xs" onClick={() => setExpensesOpen(true)}
                title="ما دفعه المكتب نيابة عن المالك — يُخصم تلقائيًّا في تقرير المالك">💸 المصروفات</button>
              <button className="btn btn-ghost text-xs" onClick={() => setOwnerLinkOpen(true)}
                title="رابط قراءة حي يرسله المكتب للمالك — يرى تقريره بلا حساب">🔗 رابط المالك</button>
              <button className="btn btn-ghost text-xs" onClick={() => setReporting(true)}
                title="تقرير فترة للمالك: الإشغال والمحصَّل والمصروفات والصافي — من السجلات">📊 تقرير المالك</button>
              <button className="btn btn-ghost text-xs" onClick={openPropertyStatement}>كشف حساب العقار</button>
              <button className="btn btn-ghost text-xs" onClick={() => setQuoteOpen(true)}
                title="إصدار عرض سعر تأجير لمستأجر محتمل قبل التعاقد">📋 عرض سعر</button>
              <button className="btn btn-ghost text-xs" onClick={exportCSV} title="تنزيل ملف Excel/CSV بكل الوحدات وحالتها">⬇️ CSV</button>
              {lateCount > 0 && (
                <button className="btn btn-wa text-xs" onClick={() => setRemindAll(true)}
                  title="إرسال تذكير واتساب لكل المتأخرين واحدًا تلو الآخر">💬 تذكير جماعي ({lateCount})</button>
              )}
              <Link href="/dashboard/property/import" className="btn btn-ghost text-xs">رفع Excel</Link>
              <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "tenant" })}>+ {ul}</button>
            </div>
          </div>

          {/* شريط التحكّم: بحث · تصفية · فرز */}
          {tenants.length > 0 && (
            <div className="border-b border-line px-4 py-3 flex flex-wrap gap-2 items-center bg-paper">
              <input className="fld flex-1 min-w-[150px]" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={`ابحث باسم المستأجر أو رقم ${ul}…`} />
              <select className="fld max-w-[170px]" value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="urgent">الأهم أولًا</option>
                <option value="due">الأقرب استحقاقًا</option>
                <option value="amount">الأكبر متأخرًا</option>
                <option value="name">الاسم</option>
              </select>
              <div className="flex flex-wrap gap-1.5 w-full">
                {chips.map((c) => (
                  <button key={c.k} onClick={() => setFilter(c.k)}
                    className={`text-xs font-semibold rounded-lg px-2.5 py-1 border transition ${
                      filter === c.k ? "bg-deep text-[#F6F1E4] border-deep" : "bg-white text-deep border-line hover:border-goldSoft"}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 flex flex-col gap-2">
            {!tenants.length ? (
              <div className="text-center text-muted py-8 text-sm">
                لا توجد وحدات بعد.
                <div className="mt-3 flex gap-2 justify-center">
                  <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "tenant" })}>+ أضف {ul}</button>
                  <Link href="/dashboard/property/import" className="btn btn-ghost text-xs">رفع Excel</Link>
                </div>
              </div>
            ) : !rows.length ? (
              <div className="text-center text-muted py-8 text-sm">
                لا نتائج مطابقة.
                <button className="btn btn-ghost text-xs mt-3 mx-auto" onClick={() => { setQ(""); setFilter("all"); }}>مسح البحث والتصفية</button>
              </div>
            ) : rows.map(({ t, st, key }) => (
              <div key={t.id} className={`rounded-xl border p-3 ${key === "litigation" ? "border-[#CBD5E1] bg-[#F8FAFC]" : "border-line bg-paper"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-9 h-9 rounded-lg bg-paper2 grid place-items-center font-semibold text-deep shrink-0">{(t.name || "?").charAt(0)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{t.name}</div>
                      <div className="text-xs text-muted">
                        {ul} {t.unit || "—"} · {sar(t.rent_amount)} ريال / {freqShort(t.payment_frequency)}
                      </div>
                      {vat.enabled && (() => { const v = splitVat(Number(t.rent_amount) || 0, vat); return (
                        <div className="text-[.7rem] text-muted mt-0.5">
                          أساسي {sar(v.base)} + ضريبة {sar(v.vat)} = <b className="text-deep">{sar(v.total)}</b>
                        </div>
                      ); })()}
                    </div>
                  </div>
                  {/* الحالة + الرقم المهم — تنتقل لسطر مستقل على الجوال */}
                  <div className="text-right sm:text-left shrink-0">
                    <StatusPill k={key} />
                    <div className="text-xs mt-1 tabular-nums">
                      {key === "vacant" ? (() => { const v = vacancyDays(t.move_out_date); return (
                          <span className="text-[#475569] font-semibold">شاغرة{v !== null ? ` منذ ${v} يوم` : ""}</span>
                        ); })()
                        : st.inGrace ? <span className="text-[#8a5a11] font-semibold">فترة سماح — {st.graceDaysLeft} يوم</span>
                        : key === "partial" ? <span className="text-[#9A5B00] font-semibold">دُفع {sar(st.partial)} · متبقٍ {sar(st.amountDue)}</span>
                        : key === "late" ? <span className="text-late font-bold">متأخر {sar(st.amountDue)}</span>
                        : key === "expiring" && st.daysToEnd !== null ? <span className="text-[#5B21B6] font-semibold">ينتهي بعد {st.daysToEnd} يوم</span>
                        : key === "litigation" ? <span className="text-[#475569]">{t.enforcement_no ? `طلب ${t.enforcement_no}` : "متابعة نظامية"}</span>
                        : st.nextDueDate ? <span className="text-muted">القادمة {st.nextDueDate}</span> : null}
                    </div>
                  </div>
                </div>

                {/* إجراء رئيسي + قائمة المزيد */}
                <div className="flex flex-wrap gap-1.5 justify-stretch sm:justify-end mt-2.5 items-center [&>*]:flex-1 sm:[&>*]:flex-none [&>*]:justify-center">
                  {key === "vacant" ? (
                    <>
                      <button type="button" className="btn btn-primary text-xs" onClick={() => reLet(t)}>🔑 تأجير جديد</button>
                      <button type="button" className="btn btn-ghost text-xs" onClick={() => openSettlement(t)}>📄 مخالصة الإخلاء</button>
                      <button type="button" className="btn btn-ghost text-xs" onClick={() => setTurnover(t)}>تعديل بيانات الإخلاء</button>
                    </>
                  ) : key === "litigation" ? (
                    <>
                      <button className="btn btn-ghost text-xs" onClick={() => setEnforcing(t)}>متابعة التنفيذ</button>
                      <button className="btn btn-ghost text-xs" onClick={() => { if (confirm("إلغاء رفع العقد للتنفيذ؟ ستعود الإشعارات الودية.")) patchTenant(t.id, { litigation: false }); }}>إلغاء الرفع</button>
                    </>
                  ) : (
                    <>
                      <QuickBtn title="تأكيد استلام الدفعة كاملة" cls="btn-primary" onClick={() => recordPayment(t, Number(t.rent_amount) || 0)}>&#10004;</QuickBtn>
                      <QuickBtn title="سداد جزئي" cls="btn-ghost" onClick={() => setPaying(t)}>&#189;</QuickBtn>
                      <a href={remindLink(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs px-2.5" title="إرسال تذكير واتساب">&#128172;</a>
                      {t.phone && <a href={`tel:${String(t.phone).replace(/[^0-9+]/g, "")}`} className="btn btn-ghost text-xs px-2.5 sm:hidden" title="اتصال مباشر">&#128222;</a>}
                      <QuickBtn title="إصدار فاتورة" cls="btn-ghost" onClick={() => openInvoice(t)}>&#128196;</QuickBtn>
                      {st.unpaid > 0 && <button className="btn btn-gold text-xs" onClick={() => makeNotice(t)}>نموذج إشعار</button>}
                      {needsRenewal(t) && <button className="btn text-xs" style={{ background: "#0E3A37", color: "#F6F1E4" }} onClick={() => setRenewing(t)}>تجديد</button>}
                    </>
                  )}
                  <RowMenu
                    items={[
                      { label: "📅 جدول الدفعات", run: () => setSchedule(t) },
                      { label: "🧮 سجل المدفوعات", run: () => openHistory(t) },
                      { label: "🧾 كشف حساب", run: () => openStatement(t) },
                      ...((t.paid_periods || 0) > 0 ? [{ label: "↩︎ تراجع عن دفعة", run: () => patchTenant(t.id, { paid_periods: Math.max(0, (t.paid_periods || 0) - 1) }) }] : []),
                      ...(!t.litigation && st.unpaid > 0 ? [{ label: "⚖️ رفع للتنفيذ", run: () => setEnforcing(t) }] : []),
                      ...(!isVacant(t) ? [{ label: "🔑 إنهاء العقد وإخلاء", run: () => setTurnover(t) }] : []),
                      { label: "✎ تعديل البيانات", run: () => setModal({ kind: "tenant", id: t.id }) },
                      { label: "🗑 حذف", run: () => deleteTenant(t.id), danger: true },
                    ]}
                  />
                </div>
              </div>
            ))}

            {tenants.length > 0 && rows.length > 0 && (
              <div className="text-center text-xs text-muted pt-1">عرض {rows.length} من {allRows.length} {ul}</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold">سجل العقار</h2></div>
          <div className="p-4">
            <AddNote onAdd={addNote} />
            {notes.length ? notes.map((n) => (
              <div key={n.id} className="flex gap-2.5 py-2.5 border-b border-dashed border-line last:border-0 text-sm">
                <span className="text-xs font-semibold text-[#8a5a11] w-16 shrink-0">{n.note_date}</span>
                <span className="flex-1 text-[#33413d]">{n.text}</span>
                <button className="text-muted opacity-60 hover:opacity-100 hover:text-late" onClick={() => deleteNote(n.id)}>حذف</button>
              </div>
            )) : <div className="text-center text-muted py-6 text-sm">لا ملاحظات بعد.</div>}
          </div>
        </div>
      </div>

      {/* عرض شرطي مقصود: النموذج يُفكَّك عند الإغلاق فتُمحى حقوله.
          كان يبقى مركَّبًا ويكتفي بإخفاء نفسه، فتبقى بيانات آخر إدخال ظاهرة
          في المرة التالية — لأن useState لا يُعاد تشغيله إلا عند التركيب. */}
      {modal?.kind === "newProp" && (
        <PropertyModal open orgName={orgName} ownerNames={ownerNames} onClose={() => setModal(null)} onSubmit={(d) => saveProperty(d)} />
      )}
      {modal?.kind === "editProp" && active && (
        <PropertyModal open initial={active} orgName={orgName} ownerNames={ownerNames}
          onClose={() => setModal(null)} onSubmit={(d) => saveProperty(d, active.id)} onDelete={deleteProperty} />
      )}
      {modal?.kind === "tenant" && (
        <TenantModal open initial={editing} unitWord={ul}
          onClose={() => setModal(null)} onSubmit={(d) => saveTenant(d, editing?.id)} />
      )}

      {quoteOpen && active && (
        <QuoteModal property={active} unitWord={ul} issuer={issuer || {}} onClose={() => setQuoteOpen(false)} />
      )}

      {ownerStmtOpen && <OwnerStatementModal properties={items} issuer={issuer} onClose={() => setOwnerStmtOpen(false)} />}

      {compOpen && (
        <ComplianceModal initial={comp} orgName={orgName} issuer={issuer || {}}
          properties={items.map((x) => ({ id: x.id, name: x.name }))}
          onChanged={setComp} onClose={() => { setCompOpen(false); router.refresh(); }} />
      )}
      {reporting && active && (
        <OwnerReportModal property={active} unitWord={ul} issuer={issuer || {}} onClose={() => setReporting(false)} />
      )}
      {expensesOpen && active && (
        <ExpensesModal propertyId={active.id} propertyName={active.name} unitWord={ul} onClose={() => setExpensesOpen(false)} />
      )}
      {ownerLinkOpen && active && (
        <OwnerLinkModal propertyId={active.id} propertyName={active.name} onClose={() => setOwnerLinkOpen(false)} />
      )}

      {schedule && <ScheduleModal tenant={schedule} unitWord={ul} onClose={() => setSchedule(null)} />}
      {renewing && <RenewModal tenant={renewing} unitWord={ul} onClose={() => setRenewing(null)} onRenew={(o) => doRenew(renewing, o)} />}
      {enforcing && <EnforcementModal tenant={enforcing} unitWord={ul}
        onClose={() => setEnforcing(null)}
        onSubmit={(no, order) => { patchTenant(enforcing.id, { litigation: true, enforcement_no: no || null, enforcement_order: order || null }); setEnforcing(null); }} />}
      {paying && <PaymentModal tenant={paying} unitWord={ul} onClose={() => setPaying(null)}
        onSubmit={(amt, method, note) => { recordPayment(paying, amt, method, note); setPaying(null); }} />}
      {turnover && <TurnoverModal tenant={turnover} unitWord={ul} onClose={() => setTurnover(null)}
        onSubmit={(d) => saveTurnover(turnover, d)} />}
      {history && <HistoryModal data={history} unitWord={ul} onClose={() => setHistory(null)} />}
      {remindAll && <RemindAllModal rows={lateRows} unitWord={ul} linkOf={remindLink}
        onClose={() => setRemindAll(false)} />}
      {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}

/** بطاقة إحصاء — قابلة للنقر للتصفية */
/** بطاقة KPI — أيقونة ولون دلالي لقراءة بصرية خاطفة */
const KPI: Record<string, { ring: string; icon: string; val: string; bold?: boolean }> = {
  income:   { ring: "bg-[#E6F4EC] text-[#137a50]", icon: "text-[#137a50]", val: "text-paid" },
  overdue:  { ring: "bg-[#FBE9E7] text-[#a5322c]", icon: "text-[#a5322c]", val: "text-late", bold: true },
  soon:     { ring: "bg-[#FBF1DF] text-[#8a5a11]", icon: "text-[#8a5a11]", val: "text-[#8a5a11]" },
  expiring: { ring: "bg-[#F1EBFC] text-[#5B21B6]", icon: "text-[#5B21B6]", val: "text-[#5B21B6]" },
  plain:    { ring: "bg-paper2 text-deep",          icon: "text-deep",      val: "text-deep" },
};

function Stat({ v, l, kpi = "plain", icon, onClick, active }: {
  v: string; l: string; kpi?: keyof typeof KPI | string; icon?: string; onClick?: () => void; active?: boolean;
}) {
  const k = KPI[kpi] || KPI.plain;
  const base = `bg-white border rounded-xl p-4 shadow-sm text-right w-full transition ${active ? "border-gold ring-1 ring-goldSoft" : "border-line"}`;
  const inner = (
    <>
      <div className="flex items-center gap-2 mb-1.5 min-w-0">
        {icon && <span className={`w-7 h-7 rounded-lg grid place-items-center text-sm font-bold shrink-0 ${k.ring}`}>{icon}</span>}
        <div className={`font-display leading-none min-w-0 truncate ${k.val} ${k.bold ? "font-extrabold" : "font-bold"} ${String(v).length > 8 ? "text-lg" : String(v).length > 6 ? "text-xl" : "text-2xl"}`}
          title={String(v)}>{v}</div>
      </div>
      <div className="text-sm text-muted">{l}</div>
    </>
  );
  if (!onClick) return <div className={base}>{inner}</div>;
  return <button type="button" onClick={onClick} className={`${base} hover:border-goldSoft cursor-pointer`}>{inner}</button>;
}

/** زر إجراء سريع أيقوني */
function QuickBtn({ children, title, cls, onClick }: { children: React.ReactNode; title: string; cls: string; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={`btn ${cls} text-xs px-2.5`}>{children}</button>
  );
}

/** نافذة تسجيل مبلغ مستلم — كامل أو جزئي */
const METHODS: { v: string; l: string }[] = [
  { v: "transfer", l: "تحويل بنكي" }, { v: "cash", l: "نقدًا" },
  { v: "pos", l: "شبكة" }, { v: "cheque", l: "شيك" }, { v: "other", l: "أخرى" },
];
export const methodLabel = (v?: string | null) => METHODS.find((m) => m.v === v)?.l || "أخرى";

function PaymentModal({ tenant, unitWord, onClose, onSubmit }: {
  tenant: Tenant; unitWord: string; onClose: () => void;
  onSubmit: (amount: number, method: string, note?: string) => void;
}) {
  const rent = Number(tenant.rent_amount) || 0;
  const already = Number(tenant.partial_amount) || 0;
  const remaining = Math.max(0, rent - already);
  const [amount, setAmount] = useState<string>(String(remaining || rent));
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");
  const amt = Number(amount) || 0;
  const pool = already + amt;
  const completed = rent > 0 ? Math.floor(pool / rent) : 0;
  const leftover = rent > 0 ? +(pool - completed * rent).toFixed(2) : 0;

  return (
    <Shell onClose={onClose}>
      <h3 className="font-display font-bold text-deep text-xl mb-1">تسجيل مبلغ مستلم</h3>
      <p className="text-sm text-muted mb-4">{tenant.name} · {unitWord} {tenant.unit || "—"}</p>

      <div className="bg-paper2 border border-line rounded-xl p-3 mb-4 text-sm">
        <div className="flex justify-between"><span className="text-muted">قيمة الدفعة</span><b className="tabular-nums">{sar(rent)} ريال</b></div>
        {already > 0 && (
          <div className="flex justify-between mt-1"><span className="text-muted">مدفوع جزئيًّا سابقًا</span>
            <b className="tabular-nums text-[#9A5B00]">{sar(already)} ريال</b></div>
        )}
      </div>

      <Field label="المبلغ المستلم (ريال)">
        <input className="fld" type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="flex gap-2 mt-2 flex-wrap">
        {remaining > 0 && remaining !== rent && (
          <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(remaining))}>إكمال الدفعة ({sar(remaining)})</button>
        )}
        <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(rent))}>دفعة كاملة ({sar(rent)})</button>
        <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(Math.round(rent / 2)))}>نصف الدفعة</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="طريقة السداد">
          <select className="fld" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </Field>
        <Field label="ملاحظة" hint="اختياري">
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder="رقم الحوالة…" />
        </Field>
      </div>

      {amt > 0 && (
        <div className="bg-[#E6F4EC] border border-[#B7DFC7] rounded-xl p-3 mt-4 text-xs text-[#137a50] leading-relaxed">
          {completed > 0 && <div>ستكتمل <b>{completed}</b> دفعة.</div>}
          {leftover > 0 && <div>ويتبقّى <b>{sar(leftover)} ريال</b> مسجّلة كسداد جزئي على الدفعة التالية.</div>}
          {completed === 0 && leftover > 0 && <div>لن تكتمل دفعة — يُسجَّل المبلغ جزئيًّا فقط.</div>}
        </div>
      )}

      <div className="flex gap-2 mt-5">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!amt} onClick={() => onSubmit(amt, method, note.trim() || undefined)}>تسجيل</button>
      </div>
    </Shell>
  );
}

/** إنهاء العقد والإخلاء — قائمة تحقّق وتسوية تأمين وقراءات عدادات */
function TurnoverModal({ tenant, unitWord, onClose, onSubmit }: {
  tenant: Tenant; unitWord: string; onClose: () => void; onSubmit: (d: any) => void;
}) {
  const [d, setD] = useState<any>({
    notice_date: tenant.notice_date || "",
    move_out_date: tenant.move_out_date || today(),
    deposit_amount: tenant.deposit_amount ?? "",
    deposit_deductions: tenant.deposit_deductions ?? "",
    deposit_notes: tenant.deposit_notes || "",
    meter_elec_out: tenant.meter_elec_out || "",
    meter_water_out: tenant.meter_water_out || "",
  });
  const [list, setList] = useState(
    Array.isArray(tenant.turnover_checklist) && tenant.turnover_checklist.length
      ? tenant.turnover_checklist.map((x) => ({ label: x.label, done: !!x.done, note: x.note || "" }))
      : TURNOVER_CHECKLIST.map((x) => ({ ...x, note: "" }))
  );
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  const st = contractState(tenant as any, {});
  const s = settleDeposit(
    { deposit_amount: Number(d.deposit_amount) || 0, deposit_deductions: Number(d.deposit_deductions) || 0 },
    st.amountDue
  );
  const doneCount = list.filter((x) => x.done).length;

  return (
    <Shell onClose={onClose} wide>
      <h3 className="font-display font-bold text-deep text-xl mb-1">إنهاء العقد وإخلاء {unitWord}</h3>
      <p className="text-sm text-muted mb-4">{tenant.name} · {unitWord} {tenant.unit || "—"}</p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="تاريخ الإشعار" hint="اختياري">
          <input className="fld" type="date" value={d.notice_date} onChange={(e) => set("notice_date", e.target.value)} />
        </Field>
        <Field label="تاريخ الإخلاء الفعلي">
          <input className="fld" type="date" value={d.move_out_date} onChange={(e) => set("move_out_date", e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="قراءة عدّاد الكهرباء">
          <input className="fld" value={d.meter_elec_out} onChange={(e) => set("meter_elec_out", e.target.value)} placeholder="الرقم عند الإخلاء" />
        </Field>
        <Field label="قراءة عدّاد المياه">
          <input className="fld" value={d.meter_water_out} onChange={(e) => set("meter_water_out", e.target.value)} placeholder="الرقم عند الإخلاء" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="مبلغ التأمين المستلم (ريال)">
          <input className="fld" type="number" min={0} value={d.deposit_amount} onChange={(e) => set("deposit_amount", e.target.value)} />
        </Field>
        <Field label="خصم التلفيات (ريال)">
          <input className="fld" type="number" min={0} value={d.deposit_deductions} onChange={(e) => set("deposit_deductions", e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="تفصيل الخصومات" hint="اختياري">
          <input className="fld" value={d.deposit_notes} onChange={(e) => set("deposit_notes", e.target.value)} placeholder="مثال: إصلاح باب + دهان غرفة" />
        </Field>
      </div>

      {/* التسوية المحسوبة */}
      <div className={`rounded-xl p-3 mt-4 text-sm border ${s.refund > 0 ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#a5322c]"}`}>
        <div className="font-semibold mb-1.5">تسوية التأمين</div>
        <div className="text-xs leading-relaxed space-y-0.5">
          <div>التأمين: <b className="tabular-nums">{sar(s.deposit)}</b> ريال</div>
          <div>يُخصم إيجار متأخر: <b className="tabular-nums">{sar(s.outstanding)}</b> ريال</div>
          <div>يُخصم تلفيات: <b className="tabular-nums">{sar(s.deductions)}</b> ريال</div>
          <div className="pt-1 font-semibold">
            {s.refund > 0
              ? <>يُردّ للمستأجر: <b className="tabular-nums">{sar(s.refund)}</b> ريال</>
              : <>يبقى على المستأجر: <b className="tabular-nums">{sar(s.dueFromTenant)}</b> ريال</>}
          </div>
        </div>
      </div>

      {/* قائمة التحقّق */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">قائمة تحقّق التسليم</span>
          <span className="text-xs text-muted">{doneCount} من {list.length}</span>
        </div>
        <div className="border border-line rounded-xl divide-y divide-line max-h-[34vh] overflow-y-auto">
          {list.map((x, i) => (
            <label key={i} className="flex items-center gap-2.5 p-2.5 cursor-pointer hover:bg-paper">
              <input type="checkbox" className="w-4 h-4 accent-[#1E9E6A] shrink-0" checked={x.done}
                onChange={(e) => setList(list.map((y, n) => (n === i ? { ...y, done: e.target.checked } : y)))} />
              <span className={`text-sm flex-1 ${x.done ? "text-muted line-through" : ""}`}>{x.label}</span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted mt-3 leading-relaxed">
        عند الحفظ تتحوّل الوحدة إلى <b>شاغرة</b>، وتتوقّف عن تراكم المتأخرات من تاريخ الإخلاء،
        ويُسجَّل ملخّص العملية في سجل العقار.
      </p>

      <div className="flex gap-2 mt-5">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center"
          onClick={() => onSubmit({ ...d, checklist: list })}>تسجيل الإخلاء</button>
      </div>
    </Shell>
  );
}

/** سجل المدفوعات — التاريخ والمبلغ والطريقة، أساس الإثبات عند الخلاف */
function HistoryModal({ data, unitWord, onClose }: {
  data: { tenant: Tenant; rows: any[] }; unitWord: string; onClose: () => void;
}) {
  const { tenant, rows } = data;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return (
    <Shell onClose={onClose} wide>
      <h3 className="font-display font-bold text-deep text-lg mb-1">سجل المدفوعات — {tenant.name}</h3>
      <p className="text-sm text-muted mb-4">{unitWord} {tenant.unit || "—"} · {rows.length} عملية · الإجمالي {sar(total)} ريال</p>

      {!rows.length ? (
        <div className="text-center text-muted py-10 text-sm">
          لا مدفوعات مسجّلة بعد.
          <div className="text-xs mt-2">الدفعات التي تُسجّلها من الآن ستُحفظ هنا بتاريخها وطريقتها.</div>
        </div>
      ) : (
        <div className="border border-line rounded-xl overflow-hidden max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper2 sticky top-0"><tr>
              <th className="p-2 text-right font-semibold">التاريخ</th>
              <th className="p-2 text-right font-semibold">المبلغ</th>
              <th className="p-2 text-right font-semibold">الطريقة</th>
              <th className="p-2 text-right font-semibold">اكتملت</th>
              <th className="p-2 text-right font-semibold">ملاحظة</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="p-2 tabular-nums">{r.paid_on}</td>
                  <td className="p-2 tabular-nums font-semibold">{sar(r.amount)}</td>
                  <td className="p-2">{methodLabel(r.method)}</td>
                  <td className="p-2 text-muted">{r.periods_covered || "—"}</td>
                  <td className="p-2 text-muted text-xs">{r.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
    </Shell>
  );
}


/** شارة الحالة — تقرأ من ROW_META */
function StatusPill({ k }: { k: RowKey }) {
  const m = ROW_META[k];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1 ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} /> {m.label}
    </span>
  );
}

/** قائمة إجراءات منسدلة — تُخفي الأزرار الثانوية */
function RowMenu({ items }: { items: { label: string; run: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="إجراءات أخرى"
        className="btn btn-ghost text-xs px-2.5" title="المزيد">⋯</button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 top-full mt-1 left-0 min-w-[190px] bg-white border border-line rounded-xl shadow-lg overflow-hidden py-1">
            {items.map((it, i) => (
              <button key={i} type="button"
                onClick={() => { setOpen(false); it.run(); }}
                className={`block w-full text-right px-3.5 py-2 text-xs font-semibold hover:bg-paper2 transition ${it.danger ? "text-late" : "text-deep"}`}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


function AddNote({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState("");
  return (
    <div className="flex gap-2 mb-3">
      <input className="fld" value={t} onChange={(e) => setT(e.target.value)} placeholder="ملاحظة (صيانة، تجديد عقد...)"
        onKeyDown={(e) => { if (e.key === "Enter" && t.trim()) { onAdd(t); setT(""); } }} />
      <button className="btn btn-primary text-sm" onClick={() => { if (t.trim()) { onAdd(t); setT(""); } }}>حفظ</button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold mb-1">{label} {hint && <span className="text-muted font-normal text-xs">— {hint}</span>}</span>
      {children}
    </label>
  );
}

function Shell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function PropertyModal({ open, initial, orgName, ownerNames = [], onClose, onSubmit, onDelete }: {
  open: boolean; initial?: Property; orgName: string; ownerNames?: string[]; onClose: () => void;
  onSubmit: (d: any) => void; onDelete?: () => void;
}) {
  const [d, setD] = useState<any>(initial || { property_type: "residential", manager: orgName });
  if (!open) return null;
  return (
    <Shell onClose={onClose}>
      <h2 className="font-display font-bold text-deep text-xl mb-4">{initial ? "إعدادات العقار" : "عقار جديد"}</h2>
      <div className="space-y-3">
        <Field label="نوع العقار">
          <div className="grid grid-cols-3 gap-2">
            {PROPERTY_TYPES.map((pt) => (
              <button key={pt.value} type="button" onClick={() => setD({ ...d, property_type: pt.value })}
                className={`border-2 rounded-xl p-2.5 text-center text-xs font-semibold transition ${
                  d.property_type === pt.value ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                <div className="text-lg mb-0.5">{pt.icon}</div>{pt.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="اسم العقار"><input className="fld" value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="برج الياسمين" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المدينة"><input className="fld" value={d.city || ""} onChange={(e) => setD({ ...d, city: e.target.value })} placeholder="الرياض" /></Field>
          <Field label="الحي / العنوان"><input className="fld" value={d.address || ""} onChange={(e) => setD({ ...d, address: e.target.value })} placeholder="حي الياسمين" /></Field>
        </div>
        <Field label="اسم المالك أو المكتب" hint="يظهر في الخطابات"><input className="fld" value={d.manager || ""} onChange={(e) => setD({ ...d, manager: e.target.value })} placeholder={orgName || "مكتب اليمامة"} /></Field>
        <Field label="المالك" hint="يجمع عقاراته في كشف حساب واحد — اختر اسمًا موجودًا أو اكتب جديدًا">
          <input className="fld" list="watheq-owner-names" value={d.owner_name || ""} onChange={(e) => setD({ ...d, owner_name: e.target.value })} placeholder="مثال: عبدالله بن سعد" />
          <datalist id="watheq-owner-names">{ownerNames.map((n) => <option key={n} value={n} />)}</datalist>
        </Field>

        <div className="block">
          <span className="block text-sm font-semibold mb-1">فترة السماح (أيام) <span className="text-muted font-normal text-xs">— لا تُحتسب الدفعة متأخرة خلالها</span></span>
          <div className="flex gap-2 flex-wrap">
            {[0, 3, 5, 7].map((g) => (
              <button key={g} type="button" onClick={() => setD({ ...d, grace_days: g })}
                className={`border-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  (Number(d.grace_days) || 0) === g ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                {g === 0 ? "بدون" : `${g} أيام`}
              </button>
            ))}
            <input className="fld max-w-[90px]" type="number" min={0} max={30} placeholder="مخصّص"
              value={[0, 3, 5, 7].includes(Number(d.grace_days) || 0) ? "" : (d.grace_days ?? "")}
              onChange={(e) => setD({ ...d, grace_days: e.target.value })} />
          </div>
        </div>

        <Field label="نسبة أتعاب الإدارة %" hint="اختياري — تُخصم من المحصَّل ويظهر الصافي في تقرير المالك">
          <input className="fld" type="number" min={0} max={100} step={0.5} placeholder="مثال: 5"
            value={d.mgmt_fee_pct ?? ""} onChange={(e) => setD({ ...d, mgmt_fee_pct: e.target.value })} />
        </Field>

        <div className="border border-line rounded-xl p-3 bg-paper">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-[#B8791F]" checked={!!d.vat_enabled}
              onChange={(e) => setD({ ...d, vat_enabled: e.target.checked })} />
            <span className="text-sm font-semibold">تطبيق ضريبة القيمة المضافة (15%)</span>
          </label>
          <p className="text-xs text-muted mt-1.5 leading-relaxed">
            تُفصل قيمة الإيجار الأساسي عن الضريبة في كشوف الحساب والفواتير.
            {isCommercial(d.property_type) ? " موصى بها للعقارات التجارية." : ""}
          </p>
          {d.vat_enabled && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="النسبة %">
                <input className="fld" type="number" value={d.vat_rate ?? 15} onChange={(e) => setD({ ...d, vat_rate: e.target.value })} />
              </Field>
              <Field label="قيمة الإيجار المُدخلة">
                <select className="fld" value={d.vat_inclusive === false ? "ex" : "in"}
                  onChange={(e) => setD({ ...d, vat_inclusive: e.target.value === "in" })}>
                  <option value="in">شاملة الضريبة</option>
                  <option value="ex">غير شاملة (تُضاف فوقها)</option>
                </select>
              </Field>
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!(d.name || "").trim()}
          title={!(d.name || "").trim() ? "أدخل اسم العقار أولًا" : "حفظ"}
          style={!(d.name || "").trim() ? { opacity: .5, cursor: "not-allowed" } : undefined}
          onClick={() => onSubmit(d)}>حفظ</button>
      </div>
      {!(d.name || "").trim() && <p className="text-xs text-late mt-3 text-center">اسم العقار مطلوب لتفعيل الحفظ.</p>}
      {onDelete && <div className="text-center mt-3"><button type="button" className="text-late text-sm font-semibold underline" onClick={onDelete}>حذف العقار</button></div>}
    </Shell>
  );
}

function TenantModal({ open, initial, unitWord, onClose, onSubmit }: {
  open: boolean; initial?: Tenant; unitWord: string; onClose: () => void; onSubmit: (d: any) => void;
}) {
  const [d, setD] = useState<any>(initial || { payment_frequency: "monthly", contract_start: today() });
  if (!open) return null;
  const preview = d.contract_start && d.rent_amount ? contractState({ ...d, paid_periods: d.paid_periods || 0 }) : null;
  const totalValue = (Number(d.rent_amount) || 0) * (Number(d.contract_periods) || 12);
  return (
    <Shell onClose={onClose}>
      <h2 className="font-display font-bold text-deep text-xl mb-1">{initial ? "تعديل الوحدة" : `${unitWord} جديدة`}</h2>
      <p className="text-sm text-muted mb-4">أدخل تاريخ البداية والدورة والقيمة — والنظام يستنتج بقية التواريخ والدفعات تلقائيًّا.</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="اسم المستأجر"><input className="fld" value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label={`رقم ${unitWord}`}><input className="fld" value={d.unit || ""} onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="101" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="قيمة الدفعة (ريال)"><input className="fld" type="number" value={d.rent_amount || ""} onChange={(e) => setD({ ...d, rent_amount: e.target.value })} placeholder="2500" /></Field>
          <Field label="جوال المستأجر"><input className="fld" value={d.phone || ""} onChange={(e) => setD({ ...d, phone: e.target.value })} placeholder="05xxxxxxxx" /></Field>
        </div>
        <Field label="دورة السداد">
          <div className="grid grid-cols-3 gap-2">
            {FREQUENCIES.map((f) => (
              <button key={f.value} type="button" onClick={() => setD({ ...d, payment_frequency: f.value })}
                className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                  d.payment_frequency === f.value ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="بداية العقد"><input className="fld" type="date" value={d.contract_start || ""} onChange={(e) => setD({ ...d, contract_start: e.target.value })} /></Field>
          <Field label="عدد الدفعات" hint="فارغ = سنة">
            <input className="fld" type="number" value={d.contract_periods || ""} onChange={(e) => setD({ ...d, contract_periods: e.target.value })} placeholder="12" />
          </Field>
        </div>
        <Field label="رقم الهوية / السجل" hint="للخطابات"><input className="fld" value={d.national_id || ""} onChange={(e) => setD({ ...d, national_id: e.target.value })} /></Field>
        {preview && (
          <div className="bg-paper border border-line rounded-xl p-3 text-sm">
            <div className="font-semibold text-deep mb-1.5">استنتاج تلقائي</div>
            <div className="text-muted space-y-1 text-xs leading-relaxed">
              <div>الدفعة القادمة: <b className="text-ink">{preview.nextDueDate}</b></div>
              <div>نهاية العقد: <b className="text-ink">{preview.endDate}</b></div>
              <div>إجمالي قيمة العقد: <b className="text-ink">{sar(totalValue)} ريال</b></div>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!(d.name || "").trim()}
          title={!(d.name || "").trim() ? "أدخل اسم المستأجر أولًا" : "حفظ"}
          style={!(d.name || "").trim() ? { opacity: .5, cursor: "not-allowed" } : undefined}
          onClick={() => onSubmit(d)}>حفظ</button>
      </div>
      {!(d.name || "").trim() && <p className="text-xs text-late mt-3 text-center">اسم المستأجر مطلوب لتفعيل الحفظ.</p>}
    </Shell>
  );
}

/** عرض سعر تأجير — مستند مبدئي غير مُلزم يُرسل لمستأجر محتمل قبل التعاقد */
/**
 * 📊 تقرير المالك الدوري — يختار المكتب الشهر، فنجلب دفعاته الموثّقة
 * من جدول payments ونصدر تقرير الفترة: إشغال + محصَّل فعلي + متأخرات.
 * هذا هو المستند الذي يبيع المكتب به نفسه لملّاكه كل شهر.
 */
const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function OwnerReportModal({ property, unitWord, issuer, onClose }: {
  property: Property; unitWord: string; issuer: any; onClose: () => void;
}) {
  const supabase = createClient();
  const thisMonth = today().slice(0, 7); // YYYY-MM
  const [ym, setYm] = useState(thisMonth);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = /^\d{4}-\d{2}$/.test(ym);
  const label = valid ? `${AR_MONTHS[Number(ym.slice(5, 7)) - 1] || ym} ${ym.slice(0, 4)}` : ym;

  async function issue() {
    if (!valid) return;
    setLoading(true); setErr(null);
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    const from = `${ym}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${ym}-${String(lastDay).padStart(2, "0")}`;

    // دفعات العقار الموثّقة خلال الشهر — نفس السجل الذي يغذّي كشف حساب المستأجر
    const { data, error } = await supabase.from("payments")
      .select("id,paid_on,amount,method,periods_covered,note,tenant_id")
      .eq("property_id", property.id)
      .gte("paid_on", from).lte("paid_on", to)
      .order("paid_on", { ascending: true }).limit(1000);
    setLoading(false);
    if (error) { setErr(error.message); return; }

    const byId: Record<string, Tenant> = {};
    (property.tenants || []).forEach((t) => { byId[t.id] = t; });
    const payments: OwnerReportPayment[] = (data || []).map((x: any) => ({
      id: x.id, paid_on: x.paid_on, amount: x.amount, method: x.method,
      periods_covered: x.periods_covered, note: x.note,
      tenant_name: byId[x.tenant_id]?.name || null,
      unit: byId[x.tenant_id]?.unit || null,
    }));

    // مصروفات الفترة نفسها — إن لم يُشغَّل schema-v8 بعد نُصدر التقرير بلا خصومات
    let expenses: ExpenseRow[] = [];
    const ex = await supabase.from("expenses").select("*")
      .eq("property_id", property.id).gte("spent_on", from).lte("spent_on", to)
      .order("spent_on", { ascending: true }).limit(500);
    if (!ex.error) expenses = (ex.data || []) as ExpenseRow[];

    openDoc(ownerReportHTML(property as any, { label, from, to }, payments, issuer || {},
      { expenses, fee_pct: (property as any).mgmt_fee_pct }));
    onClose();
  }

  return (
    <Shell onClose={onClose}>
      <h2 className="font-display font-bold text-deep text-xl mb-1">📊 تقرير المالك — {property.name}</h2>
      <p className="text-sm text-muted mb-4">
        تقرير فترة يجمع الإشغال والمحصَّل فعليًّا والمصروفات وأتعاب الإدارة و<b>صافي المالك</b> —
        من السجلات الموثّقة في وثيق، أرسله للمالك كل شهر بدل تجميعه يدويًّا.
      </p>
      <div className="space-y-3">
        <Field label="شهر التقرير">
          <input className="fld" type="month" value={ym} max={thisMonth} onChange={(e) => setYm(e.target.value)} />
        </Field>
        <div className="bg-paper border border-line rounded-xl p-3 text-xs text-muted leading-relaxed">
          يشمل التقرير: نسبة الإشغال وعدد الشواغر · جدول {unitWord === "وحدة" ? "الوحدات" : `كل ${unitWord}`} وحالتها ·
          الدفعات المستلمة خلال <b className="text-deep">{label}</b> بإجماليها · والمتأخرات القائمة وقت الإصدار.
          الأرقام تعكس ما وثّقه المكتب في النظام.
        </div>
        {err && <div className="text-xs font-semibold text-[#8f2b26] bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2.5">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="btn btn-ghost text-sm" onClick={onClose} disabled={loading}>إلغاء</button>
          <button className="btn btn-gold text-sm" onClick={issue} disabled={!valid || loading}>
            {loading ? "…" : "🖨️ إصدار التقرير"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

function QuoteModal({ property, unitWord, issuer, onClose }: {
  property: Property; unitWord: string; issuer: any; onClose: () => void;
}) {
  const plusDays = (n: number) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const stamp = () => {
    const d = new Date(), z = (n: number) => String(n).padStart(2, "0");
    return `Q-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
  };
  const [d, setD] = useState<any>({
    quote_no: stamp(), tenant_name: "", unit: "", rent_amount: "",
    payment_frequency: "annual", contract_periods: 1,
    start_date: today(), deposit: "", valid_until: plusDays(7), notes: "",
  });
  const [charges, setCharges] = useState<ChargeRow[]>(DEFAULT_CHARGES.map((c) => ({ ...c })));

  const periods = Math.max(1, Number(d.contract_periods) || 1);
  const perPeriod = Number(d.rent_amount) || 0;
  const gross = perPeriod * periods;
  const v = { enabled: !!property.vat_enabled, rate: Number(property.vat_rate) || 15, inclusive: property.vat_inclusive !== false };
  const x = splitVat(gross, v);
  const xp = splitVat(perPeriod, v);
  const upfront = xp.total + (Number(d.deposit) || 0);
  const ready = !!(d.tenant_name || "").trim() && perPeriod > 0 && !!d.start_date;

  function issue() {
    openDoc(quotationHTML(property as any, {
      quote_no: d.quote_no || stamp(),
      tenant_name: String(d.tenant_name || "").trim(),
      unit: String(d.unit || "").trim(),
      rent_amount: perPeriod,
      payment_frequency: d.payment_frequency,
      contract_periods: periods,
      start_date: d.start_date,
      deposit: Number(d.deposit) || 0,
      valid_until: d.valid_until,
      charges,
      notes: String(d.notes || "").trim() || null,
    }, issuer));
    onClose();
  }

  return (
    <Shell onClose={onClose} wide>
      <h2 className="font-display font-bold text-deep text-xl mb-1">عرض سعر تأجير</h2>
      <p className="text-sm text-muted mb-4">
        مستند مبدئي غير مُلزم تُرسله لمستأجر محتمل. التعاقد النهائي يُوثَّق عبر منصة إيجار.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="اسم المستأجر المحتمل">
            <input className="fld" value={d.tenant_name} onChange={(e) => setD({ ...d, tenant_name: e.target.value })} />
          </Field>
          <Field label={`رقم ${unitWord}`}>
            <input className="fld" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="101" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`قيمة الدفعة (ريال)${v.enabled ? v.inclusive ? " — شاملة الضريبة" : " — قبل الضريبة" : ""}`}>
            <input className="fld" type="number" value={d.rent_amount}
              onChange={(e) => setD({ ...d, rent_amount: e.target.value })} placeholder="25000" />
          </Field>
          <Field label="عدد الدفعات">
            <input className="fld" type="number" value={d.contract_periods}
              onChange={(e) => setD({ ...d, contract_periods: e.target.value })} placeholder="1" />
          </Field>
        </div>

        <Field label="دورة السداد">
          <div className="grid grid-cols-3 gap-2">
            {FREQUENCIES.map((f) => (
              <button key={f.value} type="button" onClick={() => setD({ ...d, payment_frequency: f.value })}
                className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                  d.payment_frequency === f.value ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="بداية العقد">
            <input className="fld" type="date" value={d.start_date} onChange={(e) => setD({ ...d, start_date: e.target.value })} />
          </Field>
          <Field label="التأمين (ريال)" hint="مسترد">
            <input className="fld" type="number" value={d.deposit} onChange={(e) => setD({ ...d, deposit: e.target.value })} placeholder="5000" />
          </Field>
          <Field label="العرض صالح حتى">
            <input className="fld" type="date" value={d.valid_until} onChange={(e) => setD({ ...d, valid_until: e.target.value })} />
          </Field>
        </div>

        <Field label="من يتحمّل ماذا" hint="اضغط لتبديل الطرف">
          <div className="border border-line rounded-xl overflow-hidden">
            {charges.map((c, i) => (
              <div key={c.label} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line last:border-b-0 text-sm">
                <span className="text-ink">{c.label}</span>
                <button type="button"
                  onClick={() => setCharges(charges.map((r, j) => j === i ? { ...r, who: r.who === "tenant" ? "owner" : "tenant" } : r))}
                  className={`text-xs font-semibold rounded-lg px-2.5 py-1 border transition ${
                    c.who === "tenant" ? "bg-deep text-[#F6F1E4] border-deep" : "bg-[#FBF1DF] text-[#8a5a11] border-[#EBD9AA]"}`}>
                  {c.who === "tenant" ? "المستأجر" : "المؤجّر"}
                </button>
              </div>
            ))}
          </div>
        </Field>

        <Field label="ملاحظات إضافية" hint="اختياري">
          <input className="fld" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })}
            placeholder="يشمل موقف سيارة واحد…" />
        </Field>

        <Field label="رقم العرض">
          <input className="fld" value={d.quote_no} onChange={(e) => setD({ ...d, quote_no: e.target.value })} />
        </Field>

        {perPeriod > 0 && (
          <div className="bg-paper border border-line rounded-xl p-3 text-sm">
            <div className="font-semibold text-deep mb-1.5">ملخّص العرض</div>
            <div className="text-muted space-y-1 text-xs leading-relaxed">
              <div>إجمالي قيمة العقد{v.enabled ? " (شامل الضريبة)" : ""}: <b className="text-ink">{sar(x.total)} ريال</b></div>
              {v.enabled && <div>منها ضريبة قيمة مضافة ({v.rate}%): <b className="text-ink">{sar(x.vat)} ريال</b></div>}
              <div>المطلوب عند التعاقد (الدفعة الأولى + التأمين): <b className="text-ink">{sar(upfront)} ريال</b></div>
              <div>عدد الدفعات: <b className="text-ink">{periods}</b> · {freqLabel(d.payment_frequency)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-6">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!ready}
          style={!ready ? { opacity: .5, cursor: "not-allowed" } : undefined}
          onClick={issue}>إصدار عرض السعر</button>
      </div>
      {!ready && <p className="text-xs text-late mt-3 text-center">اسم المستأجر وقيمة الدفعة وتاريخ البداية مطلوبة.</p>}
    </Shell>
  );
}

function ScheduleModal({ tenant, unitWord, onClose }: { tenant: Tenant; unitWord: string; onClose: () => void }) {
  const rows = buildSchedule(tenant);
  const st = contractState(tenant);
  return (
    <Shell onClose={onClose} wide>
      <h3 className="font-display font-bold text-deep text-lg mb-1">جدول الدفعات — {tenant.name}</h3>
      <p className="text-sm text-muted mb-4">{unitWord} {tenant.unit || "—"} · {freqLabel(tenant.payment_frequency)} · {sar(tenant.rent_amount)} ريال/دفعة</p>
      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <div className="bg-[#E6F4EC] rounded-lg p-2"><div className="font-bold text-[#137a50]">{st.paid}</div><div className="text-xs text-muted">مسدّدة</div></div>
        <div className="bg-[#FBE9E7] rounded-lg p-2"><div className="font-bold text-[#a5322c]">{st.unpaid}</div><div className="text-xs text-muted">متأخرة</div></div>
        <div className="bg-paper2 rounded-lg p-2"><div className="font-bold text-deep">{Math.max(0, rows.length - st.due)}</div><div className="text-xs text-muted">قادمة</div></div>
      </div>
      <div className="border border-line rounded-xl overflow-hidden max-h-[45vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper2 sticky top-0"><tr>
            <th className="p-2 text-right font-semibold">#</th>
            <th className="p-2 text-right font-semibold">التاريخ</th>
            <th className="p-2 text-right font-semibold">المبلغ</th>
            <th className="p-2 text-right font-semibold">الحالة</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className="border-t border-line">
                <td className="p-2 text-muted">{r.n}</td>
                <td className="p-2">{r.date}</td>
                <td className="p-2">{sar(r.amount)}</td>
                <td className="p-2">
                  {r.status === "paid" ? <span className="text-[#137a50] font-semibold">مسدّدة</span>
                   : r.status === "late" ? <span className="text-[#a5322c] font-semibold">متأخرة</span>
                   : <span className="text-muted">قادمة</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
    </Shell>
  );
}

function DocModal({ doc, onClose }: { doc: { title: string; body: string }; onClose: () => void }) {
  return (
    <Shell onClose={onClose} wide>
      <h3 className="font-display font-bold text-deep text-lg mb-1">{doc.title}</h3>
      <p className="text-xs text-[#8a5a11] mb-4 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5 leading-relaxed">
        هذا <b>خطاب تذكير إداري</b> تستخدمه بنفسك، وليس إنذارًا نظاميًّا ذا حجية.
        الإنذار الرسمي يُرسل عبر منصة «إيجار» فيُسلَّم إلكترونيًّا، ثم يكون طلب التنفيذ عبر «ناجز» استنادًا إلى العقد الموثّق.
        وثيق لا يقدّم خدمات قانونية، ولا يرفع دعاوى، ولا يستلم أو يحوّل أي مبالغ — راجع النص مع مختص مرخّص قبل أي استخدام رسمي.
      </p>
      <pre className="whitespace-pre-wrap bg-paper border border-line rounded-xl p-4 text-sm leading-8 text-ink" style={{ fontFamily: "inherit" }}>{doc.body}</pre>
      <div className="flex gap-2 mt-4">
        <button onClick={() => navigator.clipboard?.writeText(doc.body)} className="btn btn-primary flex-1 justify-center">نسخ النص</button>
        <button onClick={() => openDoc('<!doctype html><html dir="rtl"><meta charset="utf-8"><body><pre style="font-family:sans-serif;white-space:pre-wrap;padding:24px;line-height:1.9">' + doc.body.replace(/</g, "&lt;") + "</pre></body></html>")} className="btn btn-ghost flex-1 justify-center">طباعة</button>
        <button type="button" onClick={onClose} className="btn text-muted">إغلاق</button>
      </div>
    </Shell>
  );
}


function PortfolioStat({ v, l, tone }: { v: string; l: string; tone?: "warn" }) {
  return (
    <div>
      <div className={`font-display font-bold text-lg leading-none ${tone === "warn" ? "text-[#F5A9A4]" : "text-[#EAF1EE]"}`}>{v}</div>
      <div className="text-[.7rem] text-[#9FB8B3] mt-1">{l}</div>
    </div>
  );
}

function RenewModal({ tenant, unitWord, onClose, onRenew }: {
  tenant: Tenant; unitWord: string; onClose: () => void;
  onRenew: (o: { periods: number; newAmount: number | null; newFrequency: Frequency }) => void;
}) {
  const cur = contractState(tenant);
  const curFreq = (tenant.payment_frequency || "monthly") as Frequency;
  const [freq, setFreq] = useState<Frequency>(curFreq);
  const [periods, setPeriods] = useState<string>(String(tenant.contract_periods || 12));
  const [amount, setAmount] = useState<string>(String(tenant.rent_amount || ""));
  const [busy, setBusy] = useState(false);

  const preview = renewContract(tenant, {
    periods: Number(periods) || null,
    newAmount: Number(amount) || null,
    newFrequency: freq,
  });
  const changed = Number(amount) !== Number(tenant.rent_amount);
  const diff = Number(amount) - Number(tenant.rent_amount || 0);

  return (
    <Shell onClose={onClose}>
      <h3 className="font-display font-bold text-deep text-xl mb-1">تجديد العقد</h3>
      <p className="text-sm text-muted mb-4">{tenant.name} · {unitWord} {tenant.unit || "—"}</p>

      <div className="bg-paper2 border border-line rounded-xl p-3 mb-4 text-sm">
        <div className="font-semibold text-deep mb-1">المدة الحالية</div>
        <div className="text-muted text-xs leading-relaxed">
          من {tenant.contract_start || "—"} إلى <b className="text-ink">{cur.endDate}</b> ·
          {" "}{sar(tenant.rent_amount)} ريال / {freqShort(curFreq)} ·
          {" "}{cur.daysToEnd !== null && cur.daysToEnd >= 0 ? `متبقٍ ${cur.daysToEnd} يومًا` : "منتهية"}
        </div>
      </div>

      <div className="space-y-3">
        <Field label="دورة السداد للمدة الجديدة">
          <div className="grid grid-cols-3 gap-2">
            {FREQUENCIES.map((f) => (
              <button key={f.value} type="button" onClick={() => setFreq(f.value)}
                className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                  freq === f.value ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="عدد الدفعات"><input className="fld" type="number" value={periods} onChange={(e) => setPeriods(e.target.value)} placeholder="12" /></Field>
          <Field label="قيمة الدفعة (ريال)"><input className="fld" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        </div>
      </div>

      <div className="bg-[#E6F4EC] border border-[#B7DFC7] rounded-xl p-3 mt-4 text-sm">
        <div className="font-semibold text-[#137a50] mb-1.5">المدة الجديدة بعد التجديد</div>
        <div className="text-[#137a50] space-y-1 text-xs leading-relaxed">
          <div>تبدأ: <b>{preview.contract_start}</b> · تنتهي: <b>{preview.contract_end}</b></div>
          <div>إجمالي قيمة المدة: <b>{sar(preview.rent_amount * preview.contract_periods)} ريال</b></div>
          {changed && (
            <div>تغيّر الإيجار: <b>{diff > 0 ? "+" : ""}{sar(diff)} ريال</b> لكل دفعة
              {Number(tenant.rent_amount) > 0 && ` (${diff > 0 ? "+" : ""}${Math.round((diff / Number(tenant.rent_amount)) * 100)}%)`}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted mt-3 leading-relaxed">
        سيبدأ عدّاد الدفعات من الصفر للمدة الجديدة، وسيُسجَّل التجديد تلقائيًّا في سجل العقار.
      </p>

      <div className="flex gap-2 mt-5">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button className="btn btn-gold flex-1 justify-center" disabled={busy || !Number(periods)}
          onClick={() => { setBusy(true); onRenew({ periods: Number(periods), newAmount: Number(amount) || null, newFrequency: freq }); }}>
          {busy ? "..." : "تأكيد التجديد"}
        </button>
      </div>
    </Shell>
  );
}

function EnforcementModal({ tenant, unitWord, onClose, onSubmit }: {
  tenant: Tenant; unitWord: string; onClose: () => void; onSubmit: (no: string, order: string) => void;
}) {
  const [no, setNo] = useState(tenant.enforcement_no || "");
  const [order, setOrder] = useState(tenant.enforcement_order || "");
  const already = !!tenant.litigation;
  return (
    <Shell onClose={onClose}>
      <h3 className="font-display font-bold text-deep text-xl mb-1">{already ? "متابعة التنفيذ" : "رفع العقد للتنفيذ"}</h3>
      <p className="text-sm text-muted mb-4">{tenant.name} · {unitWord} {tenant.unit || "—"}</p>
      <div className="bg-[#F1F5F9] border border-[#CBD5E1] rounded-xl p-3 mb-4 text-xs text-[#475569] leading-relaxed">
        عند الرفع للتنفيذ تُجمّد الإشعارات الودّية (التذكير والخطابات) لهذا العقد، وتتحوّل حالته إلى «في التنفيذ». هذه متابعة إدارية فقط — وثيق لا يقدّم خدمات قانونية ولا يرفع دعاوى.
      </div>
      <div className="space-y-3">
        <Field label="رقم طلب التنفيذ" hint="من ناجز"><input className="fld" value={no} onChange={(e) => setNo(e.target.value)} placeholder="مثال: 4512345678" /></Field>
        <Field label="سند الأمر" hint="اختياري"><input className="fld" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="رقم/وصف سند الأمر" /></Field>
      </div>
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button className="btn flex-1 justify-center" style={{ background: "#475569", color: "#fff" }} onClick={() => onSubmit(no.trim(), order.trim())}>
          {already ? "حفظ" : "رفع للتنفيذ"}
        </button>
      </div>
    </Shell>
  );
}

/** تذكير جماعي — يفتح واتساب لكل متأخر واحدًا تلو الآخر مع تتبّع من أُرسل له */
function RemindAllModal({ rows, unitWord, linkOf, onClose }: {
  rows: Row[]; unitWord: string; linkOf: (t: Tenant) => string; onClose: () => void;
}) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const withPhone = rows.filter((r) => r.t.phone);
  const noPhone = rows.length - withPhone.length;
  const sentCount = Object.values(sent).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">💬 تذكير جماعي بالسداد</h3>
        <p className="text-sm text-muted mb-4">
          واتساب لا يسمح بالإرسال الجماعي الآلي — لكن كل زر هنا يفتح محادثة برسالة جاهزة بتفاصيل ذلك المستأجر.
          أرسلها بضغطة، وارجع للتالي. أُرسل {sentCount} من {withPhone.length}.
        </p>

        <div className="flex flex-col gap-2">
          {withPhone.map(({ t, st }) => (
            <div key={t.id} className={`flex items-center gap-3 rounded-xl border p-3 ${sent[t.id] ? "border-[#B7DFC7] bg-[#F2FAF5]" : "border-line bg-paper"}`}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate text-sm">{t.name}</div>
                <div className="text-xs text-muted">{unitWord} {t.unit || "—"} · {st.unpaid} دفعة · {sar(st.amountDue)} ريال</div>
              </div>
              {sent[t.id] && <span className="text-xs font-bold text-paid">✓ أُرسل</span>}
              <a href={linkOf(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs"
                onClick={() => setSent((s) => ({ ...s, [t.id]: true }))}>فتح واتساب</a>
            </div>
          ))}
          {!withPhone.length && <div className="text-center text-muted text-sm py-6">لا يوجد متأخرون لديهم أرقام جوال مسجّلة.</div>}
        </div>

        {noPhone > 0 && (
          <p className="text-xs text-[#8a5a11] mt-3 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5">
            {noPhone} متأخر بلا رقم جوال — أضف أرقامهم من تعديل الوحدة ليظهروا هنا.
          </p>
        )}

        <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
      </div>
    </div>
  );
}
