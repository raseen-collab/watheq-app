"use client";
import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase-client";
import { sar, daysLeft, waLink, WATHEQ_WA, today } from "@/lib/utils";

type Owner = { id: string; name: string; unit: string | null; phone: string | null; months_late: number; last_paid: string | null };
type Note = { id: string; note_date: string; text: string };
type Association = {
  id: string; name: string; units: number; fee: number;
  cert_expiry: string | null; fund_balance: number;
  owners: Owner[]; association_notes: Note[];
};

export default function AssociationView({ initial }: { initial: Association[] }) {
  const supabase = createClient();
  const [items, setItems] = useState<Association[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id || null);
  const [modal, setModal] = useState<null | "new" | "edit">(null);
  const [busy, setBusy] = useTransition();

  const active = useMemo(() => items.find((a) => a.id === activeId) || null, [items, activeId]);

  // ---------- جمعية ----------
  async function createAssociation(data: Partial<Association>) {
    const { data: row, error } = await supabase.from("associations").insert({
      name: data.name, units: data.units || 0, fee: data.fee || 0,
      cert_expiry: data.cert_expiry || null, fund_balance: data.fund_balance || 0,
    }).select("*").single();
    if (error) return alert(error.message);
    const next = { ...(row as any), owners: [], association_notes: [] };
    setItems([next, ...items]); setActiveId(next.id); setModal(null);
  }
  async function updateAssociation(data: Partial<Association>) {
    if (!active) return;
    const { error } = await supabase.from("associations").update({
      name: data.name, units: data.units || 0, fee: data.fee || 0,
      cert_expiry: data.cert_expiry || null, fund_balance: data.fund_balance || 0,
    }).eq("id", active.id);
    if (error) return alert(error.message);
    setItems(items.map((a) => a.id === active.id ? { ...a, ...data } as any : a));
    setModal(null);
  }
  async function deleteAssociation() {
    if (!active || !confirm("حذف الجمعية وكل بياناتها؟")) return;
    const { error } = await supabase.from("associations").delete().eq("id", active.id);
    if (error) return alert(error.message);
    const rest = items.filter((a) => a.id !== active.id);
    setItems(rest); setActiveId(rest[0]?.id || null); setModal(null);
  }

  // ---------- ملّاك ----------
  async function addOwner(name: string, unit: string, phone: string) {
    if (!active || !name.trim()) return;
    const { data, error } = await supabase.from("owners").insert({
      association_id: active.id, name: name.trim(), unit: unit || null, phone: phone || null, months_late: 0,
    }).select("*").single();
    if (error) return alert(error.message);
    setItems(items.map((a) => a.id === active.id ? { ...a, owners: [...a.owners, data as Owner] } : a));
  }
  async function ownerPatch(id: string, patch: Partial<Owner>, fundDelta = 0) {
    if (!active) return;
    const { error } = await supabase.from("owners").update(patch).eq("id", id);
    if (error) return alert(error.message);
    if (fundDelta) await supabase.from("associations").update({ fund_balance: (active.fund_balance || 0) + fundDelta }).eq("id", active.id);
    setItems(items.map((a) => a.id === active.id ? {
      ...a,
      fund_balance: fundDelta ? (a.fund_balance || 0) + fundDelta : a.fund_balance,
      owners: a.owners.map((o) => o.id === id ? { ...o, ...patch } : o),
    } : a));
  }
  async function deleteOwner(id: string) {
    if (!active || !confirm("حذف المالك؟")) return;
    const { error } = await supabase.from("owners").delete().eq("id", id);
    if (error) return alert(error.message);
    setItems(items.map((a) => a.id === active.id ? { ...a, owners: a.owners.filter((o) => o.id !== id) } : a));
  }

  // ---------- ملاحظات ----------
  async function addNote(text: string) {
    if (!active || !text.trim()) return;
    const { data, error } = await supabase.from("association_notes").insert({
      association_id: active.id, text: text.trim(), note_date: today(),
    }).select("*").single();
    if (error) return alert(error.message);
    setItems(items.map((a) => a.id === active.id ? { ...a, association_notes: [data as Note, ...a.association_notes] } : a));
  }
  async function deleteNote(id: string) {
    if (!active) return;
    const { error } = await supabase.from("association_notes").delete().eq("id", id);
    if (error) return alert(error.message);
    setItems(items.map((a) => a.id === active.id ? { ...a, association_notes: a.association_notes.filter((n) => n.id !== id) } : a));
  }

  // ---------- إجراءات واتساب ----------
  function ownerRemindLink(o: Owner) {
    if (!active) return "#";
    const fee = active.fee || 0, total = o.months_late * fee;
    const msg = o.months_late <= 1
      ? `مساء الخير ${o.name} 🌿\nتذكير ودّي بأن اشتراك الصيانة${fee ? ` بمبلغ ${sar(fee)} ريال` : ""} أصبح مستحقًا. نقدّر لك المبادرة بالسداد.\n— إدارة الجمعية`
      : `تحية طيبة ${o.name}،\nاشتراكاتكم المتأخرة (${o.months_late} أشهر)${total ? ` بمبلغ ${sar(total)} ريال` : ""} لا تزال غير مسدّدة. نأمل السداد حرصًا على حقوق بقية الملاك.\n— إدارة الجمعية`;
    return waLink(o.phone, msg);
  }
  function ownerNoticeLink(o: Owner) {
    if (!active) return "#";
    const total = o.months_late * (active.fee || 0);
    return waLink(WATHEQ_WA, `مرحبًا، أرغب بإصدار إنذار سداد رسمي عبر وثيق.\nالجمعية: ${active.name}\nمالك الوحدة: ${o.unit || "—"} (${o.name})\nالمتأخرات: ${o.months_late} أشهر${total ? ` بمبلغ ${sar(total)} ريال` : ""}.`);
  }
  function renewLink() {
    if (!active) return "#";
    const dl = daysLeft(active.cert_expiry);
    return waLink(WATHEQ_WA, `مرحبًا، أرغب بتجهيز مستندات تجديد شهادة جمعيتنا.\nالجمعية: ${active.name}\nانتهاء الشهادة: ${active.cert_expiry || "غير محدد"}${dl !== null ? ` (خلال ${dl} يومًا)` : ""}\nالمطلوب: محضر التجديد + الموازنة.`);
  }

  // ---------- عرض ----------
  if (!items.length) {
    return (
      <div className="max-w-lg mx-auto bg-white border border-line rounded-2xl shadow-sm p-8 mt-10 text-center">
        <div className="w-12 h-12 rounded-lg bg-deep grid place-items-center text-goldSoft font-bold font-display mx-auto mb-4">و</div>
        <h2 className="font-display text-xl font-bold text-deep mb-2">ابدأ بإضافة جمعيتك</h2>
        <p className="text-muted mb-6">أدر ملّاك جمعيتك، حالات السداد، ورصيد الصندوق من مكان واحد.</p>
        <button className="btn btn-gold" onClick={() => setModal("new")}>+ إنشاء جمعية</button>
        <FormModal open={modal === "new"} title="جمعية جديدة" onClose={() => setModal(null)} onSubmit={createAssociation} />
      </div>
    );
  }

  const a = active!;
  const total = a.owners.length;
  const late = a.owners.filter((o) => o.months_late > 0);
  const pct = total ? Math.round(((total - late.length) / total) * 100) : 0;
  const dl = daysLeft(a.cert_expiry);

  return (
    <div>
      {/* شريط اختيار الجمعية */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl">{a.name}</h1>
          <div className="text-sm text-muted">إدارة جمعية الملاك</div>
        </div>
        <select value={a.id} onChange={(e) => setActiveId(e.target.value)} className="fld max-w-[220px] font-semibold text-deep">
          {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="btn btn-ghost text-sm" onClick={() => setModal("edit")}>⚙︎ إعدادات</button>
        <button className="btn btn-gold text-sm" onClick={() => setModal("new")}>+ جمعية</button>
      </div>

      {/* تنبيه الشهادة */}
      {dl !== null && dl < 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl p-3.5 mb-4 bg-[#FBE9E7] border border-[#F5C6C2] text-[#8f2b26]">
          <span>🔴</span><span><b>انتهت شهادة الجمعية.</b> بادر بالتجديد.</span>
          <a href={renewLink()} target="_blank" rel="noreferrer" className="btn btn-gold text-sm mr-auto">جهّز مستندات التجديد</a>
        </div>
      )}
      {dl !== null && dl >= 0 && dl <= 60 && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl p-3.5 mb-4 border ${dl <= 30 ? "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]" : "bg-[#FBF1DF] border-[#EBD9AA] text-[#8a5a11]"}`}>
          <span>{dl <= 30 ? "🔴" : "⚠️"}</span>
          <span><b>تنتهي شهادة الجمعية خلال {dl} يومًا</b> ({a.cert_expiry}). جهّز محضر التجديد والموازنة.</span>
          <a href={renewLink()} target="_blank" rel="noreferrer" className="btn btn-gold text-sm mr-auto">جهّز مستندات التجديد</a>
        </div>
      )}

      {/* إحصاءات */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat v={`${pct}٪`} l="نسبة السداد" tone="ok" />
        <Stat v={String(late.length)} l="ملاك متأخرون" tone={late.length ? "warn" : undefined} />
        <Stat v={sar(a.fund_balance)} l="رصيد الصندوق (ريال)" />
        <Stat v={dl === null ? "—" : String(dl)} l="يوم حتى انتهاء الشهادة" tone={dl !== null && dl <= 30 ? "warn" : undefined} />
      </div>

      <div className="grid md:grid-cols-[1.6fr_1fr] gap-5 items-start">
        {/* الملّاك */}
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">الملّاك وحالة السداد <span className="text-sm font-normal text-muted">· {total} من {a.units || total} وحدة</span></h2>
          </div>
          <div className="p-4">
            <AddOwner onAdd={addOwner} />
            <div className="flex flex-col gap-2">
              {a.owners.length ? a.owners.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper p-3">
                  <span className="w-9 h-9 rounded-lg bg-paper2 grid place-items-center font-semibold text-deep">{(o.name || "?").charAt(0)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{o.name}</div>
                    <div className="text-xs text-muted">{o.unit ? `وحدة ${o.unit}` : "—"}{o.phone ? ` · ${o.phone}` : ""}</div>
                  </div>
                  {o.months_late > 0
                    ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#FBE9E7] text-[#a5322c] rounded-lg px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-late"/>متأخر {o.months_late > 1 ? `${o.months_late} أشهر` : "شهر"}</span>
                    : <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#E6F4EC] text-[#137a50] rounded-lg px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-paid"/>مسدّد</span>}
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    <button className="btn btn-ghost text-xs" onClick={() => ownerPatch(o.id, { months_late: Math.max(0, o.months_late - 1), last_paid: today() }, a.fee || 0)}>سجّل دفعة</button>
                    <button className="btn btn-ghost text-xs" onClick={() => ownerPatch(o.id, { months_late: o.months_late + 1 })}>+ استحقاق</button>
                    {o.months_late > 0 && <a href={ownerRemindLink(o)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs">تذكير</a>}
                    {o.months_late >= 2 && <a href={ownerNoticeLink(o)} target="_blank" rel="noreferrer" className="btn btn-gold text-xs">إنذار رسمي</a>}
                    <button className="text-late text-sm px-2" onClick={() => deleteOwner(o.id)} title="حذف">✕</button>
                  </div>
                </div>
              )) : <div className="text-center text-muted py-6 text-sm">لا يوجد ملّاك — أضف أول مالك بالأعلى.</div>}
            </div>
          </div>
        </div>

        {/* ملاحظات */}
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold">سجل العمارة</h2></div>
          <div className="p-4">
            <AddNote onAdd={addNote} placeholder="أضف ملاحظة (صيانة، تغيّر مالك…)" />
            {a.association_notes.length ? a.association_notes.map((n) => (
              <div key={n.id} className="flex gap-2.5 py-2.5 border-b border-dashed border-line last:border-0 text-sm">
                <span className="text-xs font-semibold text-[#8a5a11] w-16 shrink-0">{n.note_date}</span>
                <span className="flex-1 text-[#33413d]">{n.text}</span>
                <button className="text-muted text-sm opacity-60 hover:opacity-100 hover:text-late" onClick={() => deleteNote(n.id)}>✕</button>
              </div>
            )) : <div className="text-center text-muted py-6 text-sm">لا ملاحظات بعد.</div>}
          </div>
        </div>
      </div>

      <FormModal open={modal === "new"} title="جمعية جديدة" onClose={() => setModal(null)} onSubmit={createAssociation} />
      <FormModal open={modal === "edit"} title="إعدادات الجمعية" initial={active || undefined} onClose={() => setModal(null)} onSubmit={updateAssociation} onDelete={deleteAssociation} />
    </div>
  );
}

// ---------- مكوّنات فرعية ----------
function Stat({ v, l, tone }: { v: string; l: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-paid" : tone === "warn" ? "text-late" : "text-deep";
  return (
    <div className="bg-white border border-line rounded-xl p-4 shadow-sm">
      <div className={`font-display font-bold text-2xl leading-none ${color}`}>{v}</div>
      <div className="mt-1.5 text-sm text-muted">{l}</div>
    </div>
  );
}

function AddOwner({ onAdd }: { onAdd: (n: string, u: string, p: string) => void }) {
  const [n, setN] = useState(""); const [u, setU] = useState(""); const [p, setP] = useState("");
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
      <input className="fld" value={n} onChange={(e) => setN(e.target.value)} placeholder="اسم المالك" />
      <input className="fld" value={u} onChange={(e) => setU(e.target.value)} placeholder="الوحدة" />
      <input className="fld" value={p} onChange={(e) => setP(e.target.value)} placeholder="جوال (اختياري)" />
      <button className="btn btn-gold text-sm justify-center" onClick={() => { if (n.trim()) { onAdd(n, u, p); setN(""); setU(""); setP(""); } }}>+ إضافة</button>
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

function FormModal({ open, title, initial, onClose, onSubmit, onDelete }: {
  open: boolean; title: string; initial?: Association;
  onClose: () => void; onSubmit: (d: Partial<Association>) => void; onDelete?: () => void;
}) {
  const [d, setD] = useState<any>(initial || {});
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-bold text-deep text-xl mb-4">{title}</h2>
        <div className="space-y-3">
          <Field label="اسم الجمعية"><input className="fld" value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="عدد الوحدات"><input className="fld" type="number" value={d.units || ""} onChange={(e) => setD({ ...d, units: +e.target.value })} /></Field>
            <Field label="الاشتراك الشهري (ريال)"><input className="fld" type="number" value={d.fee || ""} onChange={(e) => setD({ ...d, fee: +e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="انتهاء الشهادة"><input className="fld" type="date" value={d.cert_expiry || ""} onChange={(e) => setD({ ...d, cert_expiry: e.target.value })} /></Field>
            <Field label="رصيد الصندوق (ريال)"><input className="fld" type="number" value={d.fund_balance ?? ""} onChange={(e) => setD({ ...d, fund_balance: +e.target.value })} /></Field>
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold flex-1 justify-center" onClick={() => { if ((d.name || "").trim()) onSubmit(d); }}>حفظ</button>
        </div>
        {onDelete && <div className="text-center mt-3"><button className="text-late text-sm font-semibold underline" onClick={onDelete}>حذف الجمعية نهائيًّا</button></div>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-semibold mb-1">{label}</span>{children}</label>;
}
