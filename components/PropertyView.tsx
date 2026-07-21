"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { sar, daysLeft, waLink, today } from "@/lib/utils";

type Tenant = {
  id: string; name: string; unit: string | null; phone: string | null; national_id: string | null;
  rent_amount: number; contract_start: string | null; contract_end: string | null;
  months_late: number; last_paid: string | null;
};
type Note = { id: string; note_date: string; text: string };
type Property = {
  id: string; name: string; address: string | null; manager: string | null; collected: number;
  tenants: Tenant[]; property_notes: Note[];
};

export default function PropertyView({ initial }: { initial: Property[] }) {
  const supabase = createClient();
  const [items, setItems] = useState<Property[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id || null);
  const [modal, setModal] = useState<null | { kind: "newProp" | "editProp" | "newTenant" | "editTenant"; id?: string }>(null);
  const [notice, setNotice] = useState<null | { name: string; body: string }>(null);

  const active = useMemo(() => items.find((p) => p.id === activeId) || null, [items, activeId]);

  // ---------- عقار ----------
  async function createProperty(d: Partial<Property>) {
    const { data, error } = await supabase.from("properties").insert({
      name: d.name, address: d.address || null, manager: d.manager || null, collected: 0,
    }).select("*").single();
    if (error) return alert(error.message);
    const next = { ...(data as any), tenants: [], property_notes: [] };
    setItems([next, ...items]); setActiveId(next.id); setModal(null);
  }
  async function updateProperty(d: Partial<Property>) {
    if (!active) return;
    const { error } = await supabase.from("properties").update({
      name: d.name, address: d.address || null, manager: d.manager || null,
    }).eq("id", active.id);
    if (error) return alert(error.message);
    setItems(items.map((p) => p.id === active.id ? { ...p, ...d } as any : p));
    setModal(null);
  }
  async function deleteProperty() {
    if (!active || !confirm("حذف العقار وكل مستأجريه؟")) return;
    const { error } = await supabase.from("properties").delete().eq("id", active.id);
    if (error) return alert(error.message);
    const rest = items.filter((p) => p.id !== active.id);
    setItems(rest); setActiveId(rest[0]?.id || null); setModal(null);
  }

  // ---------- مستأجر ----------
  async function saveTenant(d: Partial<Tenant>, id?: string) {
    if (!active) return;
    const payload = {
      property_id: active.id, name: d.name, unit: d.unit || null, phone: d.phone || null,
      national_id: d.national_id || null, rent_amount: d.rent_amount || 0,
      contract_start: d.contract_start || null, contract_end: d.contract_end || null,
    };
    if (id) {
      const { error } = await supabase.from("tenants").update(payload).eq("id", id);
      if (error) return alert(error.message);
      setItems(items.map((p) => p.id === active.id ? { ...p, tenants: p.tenants.map((t) => t.id === id ? { ...t, ...payload } as any : t) } : p));
    } else {
      const { data, error } = await supabase.from("tenants").insert({ ...payload, months_late: 0 }).select("*").single();
      if (error) return alert(error.message);
      setItems(items.map((p) => p.id === active.id ? { ...p, tenants: [...p.tenants, data as Tenant] } : p));
    }
    setModal(null);
  }
  async function tenantPatch(id: string, patch: Partial<Tenant>, collectedDelta = 0) {
    if (!active) return;
    const { error } = await supabase.from("tenants").update(patch).eq("id", id);
    if (error) return alert(error.message);
    if (collectedDelta) await supabase.from("properties").update({ collected: (active.collected || 0) + collectedDelta }).eq("id", active.id);
    setItems(items.map((p) => p.id === active.id ? {
      ...p,
      collected: collectedDelta ? (p.collected || 0) + collectedDelta : p.collected,
      tenants: p.tenants.map((t) => t.id === id ? { ...t, ...patch } : t),
    } : p));
  }
  async function deleteTenant(id: string) {
    if (!active || !confirm("حذف المستأجر؟")) return;
    const { error } = await supabase.from("tenants").delete().eq("id", id);
    if (error) return alert(error.message);
    setItems(items.map((p) => p.id === active.id ? { ...p, tenants: p.tenants.filter((t) => t.id !== id) } : p));
  }

  // ---------- ملاحظات ----------
  async function addNote(text: string) {
    if (!active || !text.trim()) return;
    const { data, error } = await supabase.from("property_notes").insert({
      property_id: active.id, text: text.trim(), note_date: today(),
    }).select("*").single();
    if (error) return alert(error.message);
    setItems(items.map((p) => p.id === active.id ? { ...p, property_notes: [data as Note, ...p.property_notes] } : p));
  }
  async function deleteNote(id: string) {
    if (!active) return;
    const { error } = await supabase.from("property_notes").delete().eq("id", id);
    if (error) return alert(error.message);
    setItems(items.map((p) => p.id === active.id ? { ...p, property_notes: p.property_notes.filter((n) => n.id !== id) } : p));
  }

  // ---------- إنذارات ----------
  function tenantRemindLink(t: Tenant) {
    if (!active) return "#";
    const rent = t.rent_amount || 0, total = t.months_late * rent, mgr = active.manager || "إدارة الأملاك";
    const msg = t.months_late <= 1
      ? `مساء الخير ${t.name} 🌿\nتذكير ودّي بأن إيجار الوحدة (${t.unit || "—"}) بعقار ${active.name}${rent ? ` وقدره ${sar(rent)} ريال` : ""} أصبح مستحقًا. نأمل السداد في موعده.\n— ${mgr}`
      : `تحية طيبة ${t.name}،\nالأجرة المتأخرة (${t.months_late} أشهر)${total ? ` بمبلغ ${sar(total)} ريال` : ""} عن الوحدة (${t.unit || "—"}) بعقار ${active.name} لم تُسدَّد. نأمل المبادرة تفاديًا للإجراءات وفق عقد الإيجار الموحّد.\n— ${mgr}`;
    return waLink(t.phone, msg);
  }
  function generateNotice(t: Tenant) {
    if (!active) return;
    const rent = t.rent_amount || 0, total = (t.months_late || 1) * rent, mgr = active.manager || "إدارة الأملاك";
    const body =
`إنذار نهائي بسداد الأجرة المتأخرة
التاريخ: ${today()}

من: ${mgr} — بصفته المؤجر/الوكيل عن مالك العقار.
إلى: المستأجر / ${t.name}${t.national_id ? `، هوية/إقامة رقم (${t.national_id})` : ""}، شاغل الوحدة رقم (${t.unit || "—"}) بعقار ${active.name}${active.address ? ` — ${active.address}` : ""}.

الموضوع: إنذار نهائي بسداد الأجرة المتأخرة بموجب عقد الإيجار الموحّد المسجّل في شبكة إيجار.

بالإشارة إلى عقد الإيجار الموحّد المشار إليه أعلاه، فقد ترصّد بذمّتكم مبلغ ${sar(total)} ريال قيمة أجرة متأخرة عن (${t.months_late || 1}) شهرًا، ولم تُسدَّد رغم تنبيهكم بذلك.

وعليه، نُنذركم إنذارًا نهائيًّا بسداد كامل المبلغ المذكور خلال مدة أقصاها (5) أيام من تاريخ استلامكم هذا الإنذار.

وفي حال عدم السداد خلال المهلة المحددة، فإن المؤجر يحتفظ بكامل حقوقه النظامية في اتخاذ الإجراءات المقرّرة نظامًا — بما في ذلك المطالبة بإخلاء العين المؤجرة واستيفاء الأجرة المتأخرة والتعويضات — عن طريق التقدّم بطلب تنفيذ عقد الإيجار الموحّد لدى محكمة التنفيذ عبر منصة ناجز، استنادًا إلى نظام التنفيذ وأحكام عقد الإيجار الموحّد.

هذا إشعار وإنذار نظامي لحفظ الحقوق.

المؤجر/الوكيل: ${mgr}
التوقيع: ____________________     التاريخ: ${today()}`;
    setNotice({ name: t.name, body });
  }

  // ---------- عرض ----------
  if (!items.length) {
    return (
      <div className="max-w-lg mx-auto bg-white border border-line rounded-2xl shadow-sm p-8 mt-10 text-center">
        <div className="w-12 h-12 rounded-lg bg-deep grid place-items-center text-goldSoft font-bold font-display mx-auto mb-4">و</div>
        <h2 className="font-display text-xl font-bold text-deep mb-2">ابدأ بإضافة عقارك</h2>
        <p className="text-muted mb-6">أدر مستأجريك، الإيجارات، والعقود من مكان واحد.</p>
        <button className="btn btn-gold" onClick={() => setModal({ kind: "newProp" })}>+ إنشاء عقار</button>
        <PropertyModal open={modal?.kind === "newProp"} title="عقار جديد" onClose={() => setModal(null)} onSubmit={createProperty} />
      </div>
    );
  }

  const p = active!;
  const total = p.tenants.length;
  const late = p.tenants.filter((t) => t.months_late > 0);
  const overdue = late.reduce((s, t) => s + t.months_late * (t.rent_amount || 0), 0);
  const pct = total ? Math.round(((total - late.length) / total) * 100) : 0;
  const soon = p.tenants
    .map((t) => ({ t, dl: daysLeft(t.contract_end) }))
    .filter((x) => x.dl !== null && x.dl! <= 60 && x.dl! >= 0)
    .sort((a, b) => (a.dl! - b.dl!))[0];

  const editingTenant = modal?.kind === "editTenant" ? p.tenants.find((x) => x.id === modal.id) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl">{p.name}</h1>
          <div className="text-sm text-muted">إدارة الأملاك والمستأجرين</div>
        </div>
        <select value={p.id} onChange={(e) => setActiveId(e.target.value)} className="fld max-w-[220px] font-semibold text-deep">
          {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="btn btn-ghost text-sm" onClick={() => setModal({ kind: "editProp" })}>⚙︎ إعدادات</button>
        <button className="btn btn-gold text-sm" onClick={() => setModal({ kind: "newProp" })}>+ عقار</button>
      </div>

      {soon && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl p-3.5 mb-4 border ${soon.dl! <= 30 ? "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]" : "bg-[#FBF1DF] border-[#EBD9AA] text-[#8a5a11]"}`}>
          <span>📄</span><span><b>عقد {soon.t.name} (وحدة {soon.t.unit || "—"}) ينتهي خلال {soon.dl} يومًا</b> ({soon.t.contract_end}). جهّز التجديد أو الإخلاء.</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat v={`${pct}٪`} l="نسبة التحصيل" tone="ok" />
        <Stat v={String(late.length)} l="مستأجرون متأخرون" tone={late.length ? "warn" : undefined} />
        <Stat v={sar(overdue)} l="إجمالي المتأخر (ريال)" tone={overdue ? "warn" : undefined} />
        <Stat v={sar(p.collected)} l="المُحصّل (ريال)" />
      </div>

      <div className="grid md:grid-cols-[1.6fr_1fr] gap-5 items-start">
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">المستأجرون <span className="text-sm font-normal text-muted">· {total} وحدة</span></h2>
            <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "newTenant" })}>+ مستأجر</button>
          </div>
          <div className="p-4 flex flex-col gap-2">
            {p.tenants.length ? p.tenants.map((t) => {
              const l = t.months_late > 0, totalDue = t.months_late * (t.rent_amount || 0);
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper p-3">
                  <span className="w-9 h-9 rounded-lg bg-paper2 grid place-items-center font-semibold text-deep">{(t.name || "?").charAt(0)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-muted">وحدة {t.unit || "—"} · إيجار {sar(t.rent_amount)} ريال{l && totalDue > t.rent_amount ? ` · متأخر ${sar(totalDue)} ريال` : ""}{t.contract_end ? ` · ينتهي ${t.contract_end}` : ""}</div>
                  </div>
                  {l
                    ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#FBE9E7] text-[#a5322c] rounded-lg px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-late"/>متأخر {t.months_late > 1 ? `${t.months_late} أشهر` : "شهر"}</span>
                    : <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#E6F4EC] text-[#137a50] rounded-lg px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-paid"/>مسدّد</span>}
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    <button className="btn btn-ghost text-xs" onClick={() => tenantPatch(t.id, { months_late: Math.max(0, t.months_late - 1), last_paid: today() }, t.rent_amount || 0)}>تسجيل دفعة</button>
                    <button className="btn btn-ghost text-xs" onClick={() => tenantPatch(t.id, { months_late: t.months_late + 1 })}>+ استحقاق</button>
                    {l && <a href={tenantRemindLink(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs">تذكير</a>}
                    {l && <button className="btn btn-gold text-xs" onClick={() => generateNotice(t)}>توليد إنذار</button>}
                    <button className="text-deep text-sm px-2" onClick={() => setModal({ kind: "editTenant", id: t.id })} title="تعديل">✎</button>
                    <button className="text-late text-sm px-2" onClick={() => deleteTenant(t.id)} title="حذف">✕</button>
                  </div>
                </div>
              );
            }) : <div className="text-center text-muted py-6 text-sm">لا يوجد مستأجرون — أضف أول مستأجر.</div>}
          </div>
        </div>

        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold">سجل العقار</h2></div>
          <div className="p-4">
            <AddNote onAdd={addNote} placeholder="أضف ملاحظة (صيانة، تجديد عقد…)" />
            {p.property_notes.length ? p.property_notes.map((n) => (
              <div key={n.id} className="flex gap-2.5 py-2.5 border-b border-dashed border-line last:border-0 text-sm">
                <span className="text-xs font-semibold text-[#8a5a11] w-16 shrink-0">{n.note_date}</span>
                <span className="flex-1 text-[#33413d]">{n.text}</span>
                <button className="text-muted text-sm opacity-60 hover:opacity-100 hover:text-late" onClick={() => deleteNote(n.id)}>✕</button>
              </div>
            )) : <div className="text-center text-muted py-6 text-sm">لا ملاحظات بعد.</div>}
          </div>
        </div>
      </div>

      <PropertyModal open={modal?.kind === "newProp"} title="عقار جديد" onClose={() => setModal(null)} onSubmit={createProperty} />
      <PropertyModal open={modal?.kind === "editProp"} title="إعدادات العقار" initial={active || undefined} onClose={() => setModal(null)} onSubmit={updateProperty} onDelete={deleteProperty} />
      <TenantModal open={modal?.kind === "newTenant" || modal?.kind === "editTenant"} initial={editingTenant} onClose={() => setModal(null)} onSubmit={(d) => saveTenant(d, editingTenant?.id)} />

      {notice && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setNotice(null)}>
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-deep text-lg mb-1">إنذار نهائي — {notice.name}</h3>
            <p className="text-xs text-[#8a5a11] mb-4">مسودّة استرشادية — راجعها مع مختص مرخّص قبل الاعتماد الرسمي. التنفيذ عبر ناجز يتطلب عقدًا موحّدًا موثّقًا في شبكة إيجار.</p>
            <pre className="whitespace-pre-wrap bg-paper border border-line rounded-xl p-4 text-sm leading-8 text-ink" style={{ fontFamily: "inherit" }}>{notice.body}</pre>
            <div className="flex gap-2 mt-4">
              <button onClick={() => navigator.clipboard?.writeText(notice.body)} className="btn btn-primary flex-1 justify-center">نسخ النص</button>
              <button onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.write(`<pre dir="rtl" style="font-family:sans-serif;white-space:pre-wrap;padding:24px;line-height:1.9">${notice.body.replace(/</g, "&lt;")}</pre>`); w.document.close(); w.print(); } }} className="btn btn-ghost flex-1 justify-center">طباعة / PDF</button>
              <button onClick={() => setNotice(null)} className="btn text-muted">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ v, l, tone }: { v: string; l: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-paid" : tone === "warn" ? "text-late" : "text-deep";
  return (
    <div className="bg-white border border-line rounded-xl p-4 shadow-sm">
      <div className={`font-display font-bold text-2xl leading-none ${color}`}>{v}</div>
      <div className="mt-1.5 text-sm text-muted">{l}</div>
    </div>
  );
}

function AddNote({ onAdd, placeholder }: { onAdd: (t: string) => void; placeholder: string }) {
  const [t, setT] = useState("");
  return (
    <div className="flex gap-2 mb-3">
      <input className="fld" value={t} onChange={(e) => setT(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === "Enter" && t.trim()) { onAdd(t); setT(""); } }} />
      <button className="btn btn-primary text-sm" onClick={() => { if (t.trim()) { onAdd(t); setT(""); } }}>حفظ</button>
    </div>
  );
}

function PropertyModal({ open, title, initial, onClose, onSubmit, onDelete }: {
  open: boolean; title?: string; initial?: Property; onClose: () => void;
  onSubmit: (d: Partial<Property>) => void; onDelete?: () => void;
}) {
  const [d, setD] = useState<any>(initial || {});
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-bold text-deep text-xl mb-4">{title}</h2>
        <div className="space-y-3">
          <Field label="اسم العقار"><input className="fld" value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="العنوان"><input className="fld" value={d.address || ""} onChange={(e) => setD({ ...d, address: e.target.value })} /></Field>
          <Field label="اسم المكتب / المدير (يظهر في الإنذارات)"><input className="fld" value={d.manager || ""} onChange={(e) => setD({ ...d, manager: e.target.value })} /></Field>
        </div>
        <div className="flex gap-2 mt-6">
          <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold flex-1 justify-center" onClick={() => { if ((d.name || "").trim()) onSubmit(d); }}>حفظ</button>
        </div>
        {onDelete && <div className="text-center mt-3"><button className="text-late text-sm font-semibold underline" onClick={onDelete}>حذف العقار نهائيًّا</button></div>}
      </div>
    </div>
  );
}

function TenantModal({ open, initial, onClose, onSubmit }: {
  open: boolean; initial?: Tenant; onClose: () => void; onSubmit: (d: Partial<Tenant>) => void;
}) {
  const [d, setD] = useState<any>(initial || {});
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-bold text-deep text-xl mb-4">{initial ? "تعديل مستأجر" : "مستأجر جديد"}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="اسم المستأجر"><input className="fld" value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <Field label="رقم الوحدة"><input className="fld" value={d.unit || ""} onChange={(e) => setD({ ...d, unit: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="قيمة الإيجار (ريال)"><input className="fld" type="number" value={d.rent_amount || ""} onChange={(e) => setD({ ...d, rent_amount: +e.target.value })} /></Field>
            <Field label="جوال المستأجر"><input className="fld" value={d.phone || ""} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
          </div>
          <Field label="رقم الهوية/الإقامة (للإنذار النظامي)"><input className="fld" value={d.national_id || ""} onChange={(e) => setD({ ...d, national_id: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="بداية العقد"><input className="fld" type="date" value={d.contract_start || ""} onChange={(e) => setD({ ...d, contract_start: e.target.value })} /></Field>
            <Field label="نهاية العقد"><input className="fld" type="date" value={d.contract_end || ""} onChange={(e) => setD({ ...d, contract_end: e.target.value })} /></Field>
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold flex-1 justify-center" onClick={() => { if ((d.name || "").trim()) onSubmit(d); }}>حفظ</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-semibold mb-1">{label}</span>{children}</label>;
}
