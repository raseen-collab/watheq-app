"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-client";
import { sar, waLink, today } from "@/lib/utils";
import { contractState, buildSchedule, FREQUENCIES, freqLabel, freqShort, derivedEndDate, renewContract, needsRenewal, applyPayment, splitVat, isCommercial, type Frequency } from "@/lib/contracts";
import { PROPERTY_TYPES, typeLabel, unitLabel, typeIcon } from "@/lib/domain";
import { statementHTML, invoiceHTML, propertyStatementHTML, openDoc } from "@/lib/documents";

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
};
type Note = { id: string; note_date: string; text: string };
type Property = {
  id: string; name: string; address: string | null; city: string | null; manager: string | null;
  property_type: string | null; collected: number;
  grace_days?: number | null;
  vat_enabled?: boolean | null; vat_rate?: number | null; vat_inclusive?: boolean | null;
  tenants: Tenant[]; property_notes: Note[];
};

/** حالة الصف المعروضة (تشمل «في التنفيذ») */
type RowKey = "litigation" | "late" | "partial" | "soon" | "expiring" | "ok";
type Row = { t: Tenant; st: ReturnType<typeof contractState>; key: RowKey };

const ROW_META: Record<RowKey, { label: string; dot: string; cls: string }> = {
  litigation: { label: "في التنفيذ",  dot: "bg-[#64748B]", cls: "bg-[#EEF1F4] text-[#475569]" },
  late:       { label: "متأخر",        dot: "bg-late",      cls: "bg-[#FBE9E7] text-[#a5322c]" },
  partial:    { label: "سداد جزئي",    dot: "bg-[#EA8C00]", cls: "bg-[#FDF0DC] text-[#9A5B00]" },
  soon:       { label: "يستحق قريبًا", dot: "bg-gold",      cls: "bg-[#FBF1DF] text-[#8a5a11]" },
  expiring:   { label: "نافذة التجديد", dot: "bg-[#7C3AED]", cls: "bg-[#F1EBFC] text-[#5B21B6]" },
  ok:         { label: "منتظم",        dot: "bg-paid",      cls: "bg-[#E6F4EC] text-[#137a50]" },
};

function rowKey(t: Tenant, st: ReturnType<typeof contractState>): RowKey {
  if (t.litigation) return "litigation";
  if (st.status === "late") return st.hasPartial ? "partial" : "late";
  if (st.status === "soon") return "soon";
  if (st.daysToEnd !== null && st.daysToEnd <= 60 && st.daysToEnd >= 0) return "expiring";
  return "ok";
}

const URGENCY: Record<RowKey, number> = { late: 0, partial: 1, soon: 2, expiring: 3, litigation: 4, ok: 5 };

export default function PropertyView({ initial, orgName, issuer }: { initial: Property[]; orgName: string; issuer?: any }) {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<Property[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id || null);
  const [modal, setModal] = useState<null | { kind: "newProp" | "editProp" | "tenant"; id?: string }>(null);
  const [doc, setDoc] = useState<null | { title: string; body: string }>(null);
  const [schedule, setSchedule] = useState<Tenant | null>(null);
  const [renewing, setRenewing] = useState<Tenant | null>(null);
  const [enforcing, setEnforcing] = useState<Tenant | null>(null);
  const [paying, setPaying] = useState<Tenant | null>(null);

  // ---------- أدوات العرض: بحث / تصفية / فرز / إشعار ----------
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | RowKey>("all");
  const [sort, setSort] = useState<"urgent" | "due" | "amount" | "name">("urgent");
  const [toast, setToast] = useState<null | { k: "ok" | "err"; m: string }>(null);
  function notify(k: "ok" | "err", m: string) {
    setToast({ k, m });
    setTimeout(() => setToast(null), 3600);
  }

  const active = useMemo(() => items.find((p) => p.id === activeId) || null, [items, activeId]);

  /** تسجيل مبلغ مستلم — يحوّل الجزئي إلى دفعات كاملة تلقائيًّا */
  async function recordPayment(t: Tenant, amount: number) {
    const amt = Math.max(0, Number(amount) || 0);
    if (!amt) return;
    const r = applyPayment(t, amt);
    await patchTenant(t.id, { paid_periods: r.paid_periods, partial_amount: r.partial_amount }, amt);
    notify("ok", r.completed > 0
      ? `سُجّل ${sar(amt)} ريال — اكتملت ${r.completed} دفعة`
      : `سُجّل ${sar(amt)} ريال كسداد جزئي`);
  }
  async function saveProperty(d: any, id?: string) {
    const payload = {
      name: d.name, address: d.address || null, city: d.city || null,
      manager: d.manager || orgName || null, property_type: d.property_type || "residential",
      grace_days: Math.max(0, Math.min(30, Number(d.grace_days) || 0)),
      vat_enabled: !!d.vat_enabled,
      vat_rate: Number(d.vat_rate) || 15,
      vat_inclusive: d.vat_inclusive !== false,
    };
    if (id) {
      const { error } = await supabase.from("properties").update(payload).eq("id", id);
      if (error) return notify("err", error.message);
      setItems(items.map((p) => (p.id === id ? { ...p, ...payload } as Property : p)));
    } else {
      const { data, error } = await supabase.from("properties").insert({ ...payload, collected: 0 }).select("*").single();
      if (error) return notify("err", error.message);
      const next = { ...(data as any), tenants: [], property_notes: [] };
      setItems([next, ...items]); setActiveId(next.id);
    }
    setModal(null);
  }

  async function deleteProperty() {
    if (!active || !confirm("حذف العقار وكل وحداته؟")) return;
    const { error } = await supabase.from("properties").delete().eq("id", active.id);
    if (error) return notify("err", error.message);
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
    };
    if (id) {
      const { error } = await supabase.from("tenants").update(payload).eq("id", id);
      if (error) return notify("err", error.message);
      setItems(items.map((p) => p.id === active.id
        ? { ...p, tenants: p.tenants.map((t) => (t.id === id ? { ...t, ...payload } as Tenant : t)) } : p));
    } else {
      const { data, error } = await supabase.from("tenants").insert({ ...payload, paid_periods: 0 }).select("*").single();
      if (error) return notify("err", error.message);
      setItems(items.map((p) => (p.id === active.id ? { ...p, tenants: [...p.tenants, data as Tenant] } : p)));
    }
    setModal(null);
  }

  async function patchTenant(id: string, patch: any, collectedDelta = 0) {
    if (!active) return;
    const { error } = await supabase.from("tenants").update(patch).eq("id", id);
    if (error) return notify("err", error.message);
    if (collectedDelta) await supabase.from("properties").update({ collected: (active.collected || 0) + collectedDelta }).eq("id", active.id);
    setItems(items.map((p) => p.id === active.id ? {
      ...p,
      collected: collectedDelta ? (p.collected || 0) + collectedDelta : p.collected,
      tenants: p.tenants.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    } : p));
  }

  async function deleteTenant(id: string) {
    if (!active || !confirm("حذف هذه الوحدة؟")) return;
    const { error } = await supabase.from("tenants").delete().eq("id", id);
    if (error) return notify("err", error.message);
    setItems(items.map((p) => (p.id === active.id ? { ...p, tenants: p.tenants.filter((t) => t.id !== id) } : p)));
  }

  async function addNote(text: string) {
    if (!active || !text.trim()) return;
    const { data, error } = await supabase.from("property_notes")
      .insert({ property_id: active.id, text: text.trim(), note_date: today() }).select("*").single();
    if (error) return notify("err", error.message);
    setItems(items.map((p) => (p.id === active.id ? { ...p, property_notes: [data as Note, ...p.property_notes] } : p)));
  }

  async function deleteNote(id: string) {
    if (!active) return;
    await supabase.from("property_notes").delete().eq("id", id);
    setItems(items.map((p) => (p.id === active.id ? { ...p, property_notes: p.property_notes.filter((n) => n.id !== id) } : p)));
  }

  async function doRenew(t: Tenant, opts: { periods: number; newAmount: number | null; newFrequency: Frequency }) {
    if (!active) return;
    const fields = renewContract(t, { periods: opts.periods, newAmount: opts.newAmount, newFrequency: opts.newFrequency });
    const { error } = await supabase.from("tenants").update(fields).eq("id", t.id);
    if (error) return notify("err", error.message);
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

  function openStatement(t: Tenant) {
    if (!active) return;
    openDoc(statementHTML(t as any, active as any, issuer || {}));
  }

  function openPropertyStatement() {
    if (!active) return;
    openDoc(propertyStatementHTML(active as any, issuer || {}));
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
    const { data } = await supabase.rpc("next_invoice_no", { p_user: (await supabase.auth.getUser()).data.user?.id });
    if (typeof data === "string") invoiceNo = data;

    await supabase.from("invoices").insert({
      user_id: (await supabase.auth.getUser()).data.user?.id,
      tenant_id: t.id, property_id: active.id,
      invoice_no: invoiceNo, due_date: dueDate, period_label: period, amount,
    });

    openDoc(invoiceHTML(t as any, active as any, { invoice_no: invoiceNo, amount, due_date: dueDate, period_label: period }, issuer || {}));
  }

  function remindLink(t: Tenant) {
    if (!active) return "#";
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0 });
    const who = active.manager || orgName || "إدارة الأملاك";
    const ul = unitLabel(active.property_type);
    const msg = st.unpaid === 0
      ? `مساء الخير ${t.name}\nتذكير ودّي: تستحق دفعة إيجار ${ul} (${t.unit || "—"}) بعقار ${active.name}${t.rent_amount ? ` وقدرها ${sar(t.rent_amount)} ريال` : ""} بتاريخ ${st.nextDueDate}. شكرًا لتعاونكم.\n— ${who}`
      : `تحية طيبة ${t.name}،\nنفيدكم بوجود ${st.unpaid} دفعة متأخرة${st.amountDue ? ` بمبلغ ${sar(st.amountDue)} ريال` : ""} عن ${ul} (${t.unit || "—"}) بعقار ${active.name}. نأمل المبادرة بالسداد.\n— ${who}`;
    return waLink(t.phone, msg);
  }

  function makeNotice(t: Tenant) {
    if (!active) return;
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0 });
    const who = active.manager || orgName || "إدارة الأملاك";
    const ul = unitLabel(active.property_type);
    const body = [
      "إشعار بسداد مستحقات متأخرة",
      `التاريخ: ${today()}`,
      "",
      `من: ${who}`,
      `إلى: ${t.name}${t.national_id ? ` — هوية/سجل رقم (${t.national_id})` : ""}، شاغل ${ul} رقم (${t.unit || "—"}) بعقار ${active.name}${active.address ? ` — ${active.address}` : ""}.`,
      "",
      "الموضوع: إشعار بسداد الأجرة المتأخرة.",
      "",
      `نفيدكم بأنه بموجب عقد الإيجار المبرم بيننا (بداية العقد: ${t.contract_start || "—"}، دورة السداد: ${freqLabel(t.payment_frequency)})، قد ترصّد بذمّتكم مبلغ ${sar(st.amountDue)} ريال، قيمة (${st.unpaid}) دفعة متأخرة، ولم تُسدَّد حتى تاريخه.`,
      "",
      "نأمل المبادرة بسداد المبلغ المذكور خلال (5) أيام من تاريخ استلامكم هذا الإشعار، حفاظًا على العلاقة التعاقدية بين الطرفين.",
      "",
      "وفي حال عدم السداد، سيتخذ المؤجر ما يحفظ حقوقه وفق ما تقتضيه الأنظمة المعمول بها والعقد المبرم بين الطرفين.",
      "",
      "وتقبلوا تحياتنا،",
      who,
      `التوقيع: ____________________     التاريخ: ${today()}`,
    ].join("\n");
    setDoc({ title: `إشعار سداد — ${t.name}`, body });
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
  const allRows: Row[] = p.tenants.map((t) => {
    const st = contractState(t, grace);
    return { t, st, key: rowKey(t, st) };
  });

  const counts = allRows.reduce((acc, r) => { acc[r.key] = (acc[r.key] || 0) + 1; return acc; },
    {} as Record<RowKey, number>);
  const lateRows = allRows.filter((r) => r.key === "late" || r.key === "partial");
  const lateCount = lateRows.length;
  const monthlyIncome = p.tenants.reduce((sum, t) =>
    sum + (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency], 0);
  const overdue = lateRows.reduce((s, r) => s + r.st.amountDue, 0);
  const pct = allRows.length ? Math.round(((allRows.length - lateRows.length) / allRows.length) * 100) : 100;

  // الصفوف المعروضة: بحث ← تصفية ← فرز
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = allRows.filter((r) => {
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
  }, [allRows, q, filter, sort]);

  const expiringSoon = allRows
    .filter((r) => r.st.daysToEnd !== null && r.st.daysToEnd <= 60 && r.st.daysToEnd >= 0 && !r.t.litigation)
    .sort((a, b) => (a.st.daysToEnd || 0) - (b.st.daysToEnd || 0))[0];
  const editing = modal?.kind === "tenant" && modal.id ? p.tenants.find((t) => t.id === modal.id) : undefined;

  // ملخّص المحفظة كاملة (كل العقارات)
  const portfolio = items.reduce((acc, prop) => {
    prop.tenants.forEach((t) => {
      const st = contractState(t, { graceDays: Number(prop.grace_days) || 0 });
      acc.units++;
      if (st.status === "late") { acc.late++; acc.overdue += st.amountDue; }
      if (st.status === "soon") acc.soon++;
      if (st.daysToEnd !== null && st.daysToEnd <= 60 && st.daysToEnd >= 0) acc.expiring++;
      acc.monthly += (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency];
    });
    return acc;
  }, { units: 0, late: 0, soon: 0, overdue: 0, expiring: 0, monthly: 0 });

  const chips: { k: "all" | RowKey; label: string }[] = [
    { k: "all", label: `الكل ${allRows.length}` },
    { k: "late", label: `متأخر ${counts.late || 0}` },
    { k: "soon", label: `قريب ${counts.soon || 0}` },
    { k: "expiring", label: `تجديد ${counts.expiring || 0}` },
    { k: "litigation", label: `تنفيذ ${counts.litigation || 0}` },
  ];

  return (
    <div>
      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] rounded-xl px-4 py-3 text-sm font-semibold shadow-lg border ${
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
          <PortfolioStat v={sar(Math.round(portfolio.monthly))} l="دخل شهري تقريبي" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl flex items-center gap-2">
            <span>{typeIcon(p.property_type)}</span> {p.name}
          </h1>
          <div className="text-sm text-muted">{typeLabel(p.property_type)}{p.city ? ` · ${p.city}` : ""} · {p.tenants.length} {ul}</div>
        </div>
        <select value={p.id} onChange={(e) => setActiveId(e.target.value)} className="fld max-w-[220px] font-semibold text-deep">
          {items.map((x) => <option key={x.id} value={x.id}>{typeIcon(x.property_type)} {x.name}</option>)}
        </select>
        <button className="btn btn-ghost text-sm" onClick={() => setModal({ kind: "editProp" })}>الإعدادات</button>
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
            <div className="flex gap-2">
              <button className="btn btn-ghost text-xs" onClick={openPropertyStatement}>كشف حساب العقار</button>
              <Link href="/dashboard/property/import" className="btn btn-ghost text-xs">رفع Excel</Link>
              <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "tenant" })}>+ {ul}</button>
            </div>
          </div>

          {/* شريط التحكّم: بحث · تصفية · فرز */}
          {p.tenants.length > 0 && (
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
            {!p.tenants.length ? (
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
                      {st.inGrace ? <span className="text-[#8a5a11] font-semibold">فترة سماح — {st.graceDaysLeft} يوم</span>
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
                  {key === "litigation" ? (
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
                      { label: "🧾 كشف حساب", run: () => openStatement(t) },
                      ...((t.paid_periods || 0) > 0 ? [{ label: "↩︎ تراجع عن دفعة", run: () => patchTenant(t.id, { paid_periods: Math.max(0, (t.paid_periods || 0) - 1) }) }] : []),
                      ...(!t.litigation && st.unpaid > 0 ? [{ label: "⚖️ رفع للتنفيذ", run: () => setEnforcing(t) }] : []),
                      { label: "✎ تعديل البيانات", run: () => setModal({ kind: "tenant", id: t.id }) },
                      { label: "🗑 حذف", run: () => deleteTenant(t.id), danger: true },
                    ]}
                  />
                </div>
              </div>
            ))}

            {p.tenants.length > 0 && rows.length > 0 && (
              <div className="text-center text-xs text-muted pt-1">عرض {rows.length} من {allRows.length} {ul}</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold">سجل العقار</h2></div>
          <div className="p-4">
            <AddNote onAdd={addNote} />
            {p.property_notes.length ? p.property_notes.map((n) => (
              <div key={n.id} className="flex gap-2.5 py-2.5 border-b border-dashed border-line last:border-0 text-sm">
                <span className="text-xs font-semibold text-[#8a5a11] w-16 shrink-0">{n.note_date}</span>
                <span className="flex-1 text-[#33413d]">{n.text}</span>
                <button className="text-muted opacity-60 hover:opacity-100 hover:text-late" onClick={() => deleteNote(n.id)}>حذف</button>
              </div>
            )) : <div className="text-center text-muted py-6 text-sm">لا ملاحظات بعد.</div>}
          </div>
        </div>
      </div>

      <PropertyModal open={modal?.kind === "newProp"} orgName={orgName} onClose={() => setModal(null)} onSubmit={(d) => saveProperty(d)} />
      <PropertyModal open={modal?.kind === "editProp"} initial={active || undefined} orgName={orgName}
        onClose={() => setModal(null)} onSubmit={(d) => saveProperty(d, active!.id)} onDelete={deleteProperty} />
      <TenantModal open={modal?.kind === "tenant"} initial={editing} unitWord={ul}
        onClose={() => setModal(null)} onSubmit={(d) => saveTenant(d, editing?.id)} />

      {schedule && <ScheduleModal tenant={schedule} unitWord={ul} onClose={() => setSchedule(null)} />}
      {renewing && <RenewModal tenant={renewing} unitWord={ul} onClose={() => setRenewing(null)} onRenew={(o) => doRenew(renewing, o)} />}
      {enforcing && <EnforcementModal tenant={enforcing} unitWord={ul}
        onClose={() => setEnforcing(null)}
        onSubmit={(no, order) => { patchTenant(enforcing.id, { litigation: true, enforcement_no: no || null, enforcement_order: order || null }); setEnforcing(null); }} />}
      {paying && <PaymentModal tenant={paying} unitWord={ul} onClose={() => setPaying(null)}
        onSubmit={(amt) => { recordPayment(paying, amt); setPaying(null); }} />}
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
      <div className="flex items-center gap-2 mb-1.5">
        {icon && <span className={`w-7 h-7 rounded-lg grid place-items-center text-sm font-bold shrink-0 ${k.ring}`}>{icon}</span>}
        <div className={`font-display leading-none ${k.val} ${k.bold ? "font-extrabold text-2xl" : "font-bold text-2xl"}`}>{v}</div>
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
function PaymentModal({ tenant, unitWord, onClose, onSubmit }: {
  tenant: Tenant; unitWord: string; onClose: () => void; onSubmit: (amount: number) => void;
}) {
  const rent = Number(tenant.rent_amount) || 0;
  const already = Number(tenant.partial_amount) || 0;
  const remaining = Math.max(0, rent - already);
  const [amount, setAmount] = useState<string>(String(remaining || rent));
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

      {amt > 0 && (
        <div className="bg-[#E6F4EC] border border-[#B7DFC7] rounded-xl p-3 mt-4 text-xs text-[#137a50] leading-relaxed">
          {completed > 0 && <div>ستكتمل <b>{completed}</b> دفعة.</div>}
          {leftover > 0 && <div>ويتبقّى <b>{sar(leftover)} ريال</b> مسجّلة كسداد جزئي على الدفعة التالية.</div>}
          {completed === 0 && leftover > 0 && <div>لن تكتمل دفعة — يُسجَّل المبلغ جزئيًّا فقط.</div>}
        </div>
      )}

      <div className="flex gap-2 mt-5">
        <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button className="btn btn-gold flex-1 justify-center" disabled={!amt} onClick={() => onSubmit(amt)}>تسجيل</button>
      </div>
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

function PropertyModal({ open, initial, orgName, onClose, onSubmit, onDelete }: {
  open: boolean; initial?: Property; orgName: string; onClose: () => void;
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
              <button key={pt.value} onClick={() => setD({ ...d, property_type: pt.value })}
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

        <Field label="فترة السماح (أيام)" hint="لا تُحتسب الدفعة متأخرة خلالها">
          <div className="flex gap-2 flex-wrap">
            {[0, 3, 5, 7].map((g) => (
              <button key={g} onClick={() => setD({ ...d, grace_days: g })}
                className={`border-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  (Number(d.grace_days) || 0) === g ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                {g === 0 ? "بدون" : `${g} أيام`}
              </button>
            ))}
            <input className="fld max-w-[90px]" type="number" min={0} max={30} placeholder="مخصّص"
              value={[0, 3, 5, 7].includes(Number(d.grace_days) || 0) ? "" : (d.grace_days ?? "")}
              onChange={(e) => setD({ ...d, grace_days: e.target.value })} />
          </div>
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
        <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button className="btn btn-gold flex-1 justify-center" onClick={() => (d.name || "").trim() && onSubmit(d)}>حفظ</button>
      </div>
      {onDelete && <div className="text-center mt-3"><button className="text-late text-sm font-semibold underline" onClick={onDelete}>حذف العقار</button></div>}
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
              <button key={f.value} onClick={() => setD({ ...d, payment_frequency: f.value })}
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
        <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button className="btn btn-gold flex-1 justify-center" onClick={() => (d.name || "").trim() && onSubmit(d)}>حفظ</button>
      </div>
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
      <button className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
    </Shell>
  );
}

function DocModal({ doc, onClose }: { doc: { title: string; body: string }; onClose: () => void }) {
  return (
    <Shell onClose={onClose} wide>
      <h3 className="font-display font-bold text-deep text-lg mb-1">{doc.title}</h3>
      <p className="text-xs text-[#8a5a11] mb-4 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5 leading-relaxed">
        هذا <b>نموذج خطاب تذكير</b> تستخدمه بنفسك. وثيق لا يقدّم خدمات قانونية، ولا يرفع دعاوى، ولا يستلم أو يحوّل أي مبالغ.
        راجع النص مع مختص مرخّص قبل أي استخدام رسمي.
      </p>
      <pre className="whitespace-pre-wrap bg-paper border border-line rounded-xl p-4 text-sm leading-8 text-ink" style={{ fontFamily: "inherit" }}>{doc.body}</pre>
      <div className="flex gap-2 mt-4">
        <button onClick={() => navigator.clipboard?.writeText(doc.body)} className="btn btn-primary flex-1 justify-center">نسخ النص</button>
        <button onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.write('<pre dir="rtl" style="font-family:sans-serif;white-space:pre-wrap;padding:24px;line-height:1.9">' + doc.body.replace(/</g, "&lt;") + "</pre>"); w.document.close(); w.print(); } }} className="btn btn-ghost flex-1 justify-center">طباعة</button>
        <button onClick={onClose} className="btn text-muted">إغلاق</button>
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
              <button key={f.value} onClick={() => setFreq(f.value)}
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
        <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
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
        <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button className="btn flex-1 justify-center" style={{ background: "#475569", color: "#fff" }} onClick={() => onSubmit(no.trim(), order.trim())}>
          {already ? "حفظ" : "رفع للتنفيذ"}
        </button>
      </div>
    </Shell>
  );
}
