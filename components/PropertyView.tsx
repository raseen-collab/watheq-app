"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-client";
import { sar, waLink, today } from "@/lib/utils";
import { contractState, buildSchedule, FREQUENCIES, freqLabel, freqShort, derivedEndDate, renewContract, needsRenewal, type Frequency } from "@/lib/contracts";
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
  litigation?: boolean | null; enforcement_no?: string | null; enforcement_order?: string | null;
};};
type Note = { id: string; note_date: string; text: string };
type Property = {
  id: string; name: string; address: string | null; city: string | null; manager: string | null;
  property_type: string | null; collected: number;
  tenants: Tenant[]; property_notes: Note[];
};

export default function PropertyView({ initial, orgName, issuer }: { initial: Property[]; orgName: string; issuer?: any }) {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<Property[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id || null);
  const [modal, setModal] = useState<null | { kind: "newProp" | "editProp" | "tenant"; id?: string }>(null);
  const [doc, setDoc] = useState<null | { title: string; body: string }>(null);
  const [schedule, setSchedule] = useState<Tenant | null>(null);
  const [renewing, setRenewing] = useState<Tenant | null>(null);

  const active = useMemo(() => items.find((p) => p.id === activeId) || null, [items, activeId]);

  async function saveProperty(d: any, id?: string) {
    const payload = {
      name: d.name, address: d.address || null, city: d.city || null,
      manager: d.manager || orgName || null, property_type: d.property_type || "residential",
    };
    if (id) {
      const { error } = await supabase.from("properties").update(payload).eq("id", id);
      if (error) return alert(error.message);
      setItems(items.map((p) => (p.id === id ? { ...p, ...payload } as Property : p)));
    } else {
      const { data, error } = await supabase.from("properties").insert({ ...payload, collected: 0 }).select("*").single();
      if (error) return alert(error.message);
      const next = { ...(data as any), tenants: [], property_notes: [] };
      setItems([next, ...items]); setActiveId(next.id);
    }
    setModal(null);
  }

  async function deleteProperty() {
    if (!active || !confirm("حذف العقار وكل وحداته؟")) return;
    const { error } = await supabase.from("properties").delete().eq("id", active.id);
    if (error) return alert(error.message);
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
      if (error) return alert(error.message);
      setItems(items.map((p) => p.id === active.id
        ? { ...p, tenants: p.tenants.map((t) => (t.id === id ? { ...t, ...payload } as Tenant : t)) } : p));
    } else {
      const { data, error } = await supabase.from("tenants").insert({ ...payload, paid_periods: 0 }).select("*").single();
      if (error) return alert(error.message);
      setItems(items.map((p) => (p.id === active.id ? { ...p, tenants: [...p.tenants, data as Tenant] } : p)));
    }
    setModal(null);
  }

  async function patchTenant(id: string, patch: any, collectedDelta = 0) {
    if (!active) return;
    const { error } = await supabase.from("tenants").update(patch).eq("id", id);
    if (error) return alert(error.message);
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
    if (error) return alert(error.message);
    setItems(items.map((p) => (p.id === active.id ? { ...p, tenants: p.tenants.filter((t) => t.id !== id) } : p)));
  }

  async function addNote(text: string) {
    if (!active || !text.trim()) return;
    const { data, error } = await supabase.from("property_notes")
      .insert({ property_id: active.id, text: text.trim(), note_date: today() }).select("*").single();
    if (error) return alert(error.message);
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
    if (error) return alert(error.message);
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
    const st = contractState(t);
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
    const st = contractState(t);
    const who = active.manager || orgName || "إدارة الأملاك";
    const ul = unitLabel(active.property_type);
    const msg = st.unpaid === 0
      ? `مساء الخير ${t.name}\nتذكير ودّي: تستحق دفعة إيجار ${ul} (${t.unit || "—"}) بعقار ${active.name}${t.rent_amount ? ` وقدرها ${sar(t.rent_amount)} ريال` : ""} بتاريخ ${st.nextDueDate}. شكرًا لتعاونكم.\n— ${who}`
      : `تحية طيبة ${t.name}،\nنفيدكم بوجود ${st.unpaid} دفعة متأخرة${st.amountDue ? ` بمبلغ ${sar(st.amountDue)} ريال` : ""} عن ${ul} (${t.unit || "—"}) بعقار ${active.name}. نأمل المبادرة بالسداد.\n— ${who}`;
    return waLink(t.phone, msg);
  }

  function makeNotice(t: Tenant) {
    if (!active) return;
    const st = contractState(t);
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
  const states = p.tenants.map((t) => ({ t, st: contractState(t) }));
  const late = states.filter((x) => x.st.status === "late");
  const soon = states.filter((x) => x.st.status === "soon");
  const overdue = late.reduce((s, x) => s + x.st.amountDue, 0);
  const pct = states.length ? Math.round(((states.length - late.length) / states.length) * 100) : 100;
  const expiring = states
    .filter((x) => x.st.daysToEnd !== null && x.st.daysToEnd <= 60 && x.st.daysToEnd >= 0)
    .sort((a, b) => (a.st.daysToEnd || 0) - (b.st.daysToEnd || 0))[0];
  const editing = modal?.kind === "tenant" && modal.id ? p.tenants.find((t) => t.id === modal.id) : undefined;

  // ملخّص المحفظة كاملة (كل العقارات)
  const portfolio = items.reduce((acc, prop) => {
    prop.tenants.forEach((t) => {
      const st = contractState(t);
      acc.units++;
      if (st.status === "late") { acc.late++; acc.overdue += st.amountDue; }
      if (st.status === "soon") acc.soon++;
      if (st.daysToEnd !== null && st.daysToEnd <= 60 && st.daysToEnd >= 0) acc.expiring++;
      acc.monthly += (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency];
    });
    return acc;
  }, { units: 0, late: 0, soon: 0, overdue: 0, expiring: 0, monthly: 0 });

  return (
    <div>
      {items.length > 1 && (
        <div className="bg-deep text-[#EAF1EE] rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="font-display font-bold text-sm text-goldSoft">محفظتك · {items.length} عقارات</div>
          <PortfolioStat v={String(portfolio.units)} l="وحدة" />
          <PortfolioStat v={String(portfolio.late)} l="متأخرة" tone={portfolio.late ? "warn" : undefined} />
          <PortfolioStat v={sar(portfolio.overdue)} l="ريال متأخر" tone={portfolio.overdue ? "warn" : undefined} />
          <PortfolioStat v={String(portfolio.soon)} l="تستحق خلال ٧ أيام" />
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

      {expiring && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl p-3.5 mb-4 border text-sm ${
          (expiring.st.daysToEnd || 0) <= 30 ? "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]" : "bg-[#FBF1DF] border-[#EBD9AA] text-[#8a5a11]"}`}>
          <span>عقد {expiring.t.name} ({ul} {expiring.t.unit || "—"}) ينتهي خلال <b>{expiring.st.daysToEnd}</b> يومًا ({expiring.st.endDate}). جهّز التجديد أو الإخلاء.</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat v={`${pct}٪`} l="نسبة الانتظام" tone="ok" />
        <Stat v={String(late.length)} l="وحدات متأخرة" tone={late.length ? "warn" : undefined} />
        <Stat v={sar(overdue)} l="إجمالي المتأخر (ريال)" tone={overdue ? "warn" : undefined} />
        <Stat v={String(soon.length)} l="دفعات خلال ٧ أيام" />
      </div>

      <div className="grid md:grid-cols-[1.65fr_1fr] gap-5 items-start">
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 gap-2 flex-wrap">
            <h2 className="font-semibold">الوحدات والمستأجرون</h2>
            <div className="flex gap-2">
              <button className="btn btn-ghost text-xs" onClick={openPropertyStatement}>كشف حساب العقار</button>
              <Link href="/dashboard/property/import" className="btn btn-ghost text-xs">رفع Excel</Link>
              <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "tenant" })}>+ وحدة</button>
            </div>
          </div>
          <div className="p-4 flex flex-col gap-2">
            {states.length ? states.map(({ t, st }) => (
              <div key={t.id} className="rounded-xl border border-line bg-paper p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-9 h-9 rounded-lg bg-paper2 grid place-items-center font-semibold text-deep shrink-0">{(t.name || "?").charAt(0)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-muted">
                      {ul} {t.unit || "—"} · {sar(t.rent_amount)} ريال / {freqShort(t.payment_frequency)}
                      {st.nextDueDate && st.unpaid === 0 ? ` · القادمة ${st.nextDueDate}` : ""}
                      {st.amountDue ? ` · متأخر ${sar(st.amountDue)} ريال` : ""}
                    </div>
                  </div>
                  <StatusPill state={st.status} label={st.statusLabel} />
                </div>
                <div className="flex flex-wrap gap-1.5 justify-end mt-2.5">
                  <button className="btn btn-ghost text-xs" onClick={() => patchTenant(t.id, { paid_periods: (t.paid_periods || 0) + 1 }, t.rent_amount || 0)}>سجّل دفعة</button>
                  {(t.paid_periods || 0) > 0 && (
                    <button className="btn btn-ghost text-xs" onClick={() => patchTenant(t.id, { paid_periods: Math.max(0, (t.paid_periods || 0) - 1) })}>تراجع</button>
                  )}
                  <button className="btn btn-ghost text-xs" onClick={() => setSchedule(t)}>الجدول</button>
                  <button className="btn btn-ghost text-xs" onClick={() => openStatement(t)}>كشف حساب</button>
                  <button className="btn btn-ghost text-xs" onClick={() => openInvoice(t)}>فاتورة</button>
                  <a href={remindLink(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs">تذكير واتساب</a>
                  {st.unpaid > 0 && <button className="btn btn-gold text-xs" onClick={() => makeNotice(t)}>نموذج إشعار</button>}
                  {needsRenewal(t) && <button className="btn text-xs" style={{ background: "#0E3A37", color: "#F6F1E4" }} onClick={() => setRenewing(t)}>تجديد العقد</button>}
                  <button className="text-deep text-sm px-2" onClick={() => setModal({ kind: "tenant", id: t.id })} title="تعديل">تعديل</button>
                  <button className="text-late text-sm px-2" onClick={() => deleteTenant(t.id)} title="حذف">حذف</button>
                </div>
              </div>
            )) : (
              <div className="text-center text-muted py-8 text-sm">
                لا توجد وحدات بعد.
                <div className="mt-3 flex gap-2 justify-center">
                  <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "tenant" })}>+ أضف وحدة</button>
                  <Link href="/dashboard/property/import" className="btn btn-ghost text-xs">رفع Excel</Link>
                </div>
              </div>
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
      {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}

function Stat({ v, l, tone }: { v: string; l: string; tone?: "ok" | "warn" }) {
  const c = tone === "ok" ? "text-paid" : tone === "warn" ? "text-late" : "text-deep";
  return (
    <div className="bg-white border border-line rounded-xl p-4 shadow-sm">
      <div className={`font-display font-bold text-2xl leading-none ${c}`}>{v}</div>
      <div className="mt-1.5 text-sm text-muted">{l}</div>
    </div>
  );
}

function StatusPill({ state, label }: { state: "late" | "soon" | "ok"; label: string }) {
  const map = { late: "bg-[#FBE9E7] text-[#a5322c]", soon: "bg-[#FBF1DF] text-[#8a5a11]", ok: "bg-[#E6F4EC] text-[#137a50]" };
  const dot = { late: "bg-late", soon: "bg-gold", ok: "bg-paid" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1 ${map[state]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot[state]}`} /> {label}
    </span>
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
              {Number(tenant.rent_amount) > 0 && ` (${diff > 0 ? "+" : ""}${Math.round((diff / Number(tenant.rent_amount)) * 100)}٪)`}
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
