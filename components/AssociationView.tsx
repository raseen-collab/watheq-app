"use client";
import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase-client";
import { sar, daysLeft, waLink, WATHEQ_WA, today } from "@/lib/utils";

type Owner = { id: string; name: string; unit: string | null; phone: string | null; months_late: number; last_paid: string | null; partial_amount?: number | null };
type Note = { id: string; note_date: string; text: string };
type Association = {
  id: string; name: string; units: number; fee: number;
  cert_expiry: string | null; fund_balance: number; grace_days?: number | null;
  owners: Owner[]; association_notes: Note[];
};

/** حالة المالك المعروضة */
type OwnerKey = "critical" | "late" | "partial" | "ok";
const OWNER_META: Record<OwnerKey, { label: string; dot: string; cls: string }> = {
  critical: { label: "حرج", dot: "bg-late", cls: "bg-[#F7DAD7] text-[#8f2b26]" },
  late:     { label: "متأخر", dot: "bg-late", cls: "bg-[#FBE9E7] text-[#a5322c]" },
  partial:  { label: "سداد جزئي", dot: "bg-[#EA8C00]", cls: "bg-[#FDF0DC] text-[#9A5B00]" },
  ok:       { label: "مسدّد", dot: "bg-paid", cls: "bg-[#E6F4EC] text-[#137a50]" },
};
const ownerKey = (o: Owner): OwnerKey =>
  o.months_late >= 3 ? "critical"
    : o.months_late > 0 ? ((Number(o.partial_amount) || 0) > 0 ? "partial" : "late")
    : "ok";
const OWNER_URGENCY: Record<OwnerKey, number> = { critical: 0, late: 1, partial: 2, ok: 3 };

export default function AssociationView({ initial }: { initial: Association[] }) {
  const supabase = createClient();
  const [items, setItems] = useState<Association[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id || null);
  const [modal, setModal] = useState<null | "new" | "edit">(null);
  const [busy, setBusy] = useTransition();

  // ---------- أدوات العرض: بحث / تصفية / فرز / إشعار ----------
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | OwnerKey>("all");
  const [sort, setSort] = useState<"urgent" | "amount" | "name" | "unit">("urgent");
  const [paying, setPaying] = useState<Owner | null>(null);
  const [toast, setToast] = useState<null | { k: "ok" | "err"; m: string }>(null);
  function notify(k: "ok" | "err", m: string) {
    setToast({ k, m });
    setTimeout(() => setToast(null), 3600);
  }

  const active = useMemo(() => items.find((a) => a.id === activeId) || null, [items, activeId]);

  /** تسجيل مبلغ مستلم من مالك — يحوّل الجزئي إلى أشهر مسدّدة */
  async function recordOwnerPayment(o: Owner, fee: number, amount: number) {
    const amt = Math.max(0, Number(amount) || 0);
    if (!amt || fee <= 0) return;
    const pool = (Number(o.partial_amount) || 0) + amt;
    const months = Math.floor(pool / fee);
    const rest = +(pool - months * fee).toFixed(2);
    const newLate = Math.max(0, o.months_late - months);
    await ownerPatch(o.id, {
      months_late: newLate,
      partial_amount: rest,
      ...(months > 0 ? { last_paid: today() } : {}),
    }, amt);
    notify("ok", months > 0
      ? `سُجّل ${sar(amt)} ريال — سُدّد ${months} شهر`
      : `سُجّل ${sar(amt)} ريال كسداد جزئي`);
  }
  // ---------- جمعية ----------
  /** هوية المستخدم الحالي — تشترطها سياسة الصلاحيات (RLS) عند الإدراج */
  async function currentUserId(): Promise<string | null> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  }

  async function createAssociation(data: Partial<Association>) {
    const uid = await currentUserId();
    if (!uid) return notify("err", "انتهت الجلسة — أعد تسجيل الدخول ثم حاول مرة أخرى.");
    const { data: row, error } = await supabase.from("associations").insert({
      name: data.name, units: data.units || 0, fee: data.fee || 0,
      cert_expiry: data.cert_expiry || null, fund_balance: data.fund_balance || 0,
      grace_days: Math.max(0, Math.min(30, Number(data.grace_days) || 0)),
      user_id: uid,
    }).select("*").single();
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    const next = { ...(row as any), owners: [], association_notes: [] };
    setItems([next, ...items]); setActiveId(next.id); setModal(null);
  }
  async function updateAssociation(data: Partial<Association>) {
    if (!active) return;
    const { error } = await supabase.from("associations").update({
      name: data.name, units: data.units || 0, fee: data.fee || 0,
      cert_expiry: data.cert_expiry || null, fund_balance: data.fund_balance || 0,
      grace_days: Math.max(0, Math.min(30, Number(data.grace_days) || 0)),
    }).eq("id", active.id);
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((a) => a.id === active.id ? { ...a, ...data } as any : a));
    setModal(null);
  }
  async function deleteAssociation() {
    if (!active || !confirm("حذف الجمعية وكل بياناتها؟")) return;
    const { error } = await supabase.from("associations").delete().eq("id", active.id);
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    const rest = items.filter((a) => a.id !== active.id);
    setItems(rest); setActiveId(rest[0]?.id || null); setModal(null);
  }

  // ---------- ملّاك ----------
  async function addOwner(name: string, unit: string, phone: string) {
    if (!active || !name.trim()) return;
    const { data, error } = await supabase.from("owners").insert({
      association_id: active.id, name: name.trim(), unit: unit || null, phone: phone || null, months_late: 0,
    }).select("*").single();
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((a) => a.id === active.id ? { ...a, owners: [...a.owners, data as Owner] } : a));
  }
  async function ownerPatch(id: string, patch: Partial<Owner>, fundDelta = 0) {
    if (!active) return;
    const { error } = await supabase.from("owners").update(patch).eq("id", id);
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
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
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((a) => a.id === active.id ? { ...a, owners: a.owners.filter((o) => o.id !== id) } : a));
  }

  // ---------- ملاحظات ----------
  async function addNote(text: string) {
    if (!active || !text.trim()) return;
    const { data, error } = await supabase.from("association_notes").insert({
      association_id: active.id, text: text.trim(), note_date: today(),
    }).select("*").single();
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((a) => a.id === active.id ? { ...a, association_notes: [data as Note, ...a.association_notes] } : a));
  }
  async function deleteNote(id: string) {
    if (!active) return;
    const { error } = await supabase.from("association_notes").delete().eq("id", id);
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
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
    return waLink(WATHEQ_WA, `مرحبًا، أرغب بتجهيز نموذج خطاب تذكير بالسداد عبر وثيق.\nالجمعية: ${active.name}\nمالك الوحدة: ${o.unit || "—"} (${o.name})\nالمتأخرات: ${o.months_late} أشهر${total ? ` بمبلغ ${sar(total)} ريال` : ""}.`);
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
  const critical = a.owners.filter((o) => o.months_late >= 3);
  const pct = total ? Math.round(((total - late.length) / total) * 100) : 0;
  const dl = daysLeft(a.cert_expiry);
  const owedTotal = late.reduce((s, o) => s + Math.max(0, o.months_late * (a.fee || 0) - (Number(o.partial_amount) || 0)), 0);
  const expectedMonthly = total * (a.fee || 0);

  // الصفوف المعروضة: بحث ← تصفية ← فرز
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = a.owners.filter((o) => {
      if (filter !== "all" && ownerKey(o) !== filter) return false;
      if (!needle) return true;
      return [o.name, o.unit, o.phone].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
    out = [...out].sort((x, y) => {
      if (sort === "amount") return y.months_late - x.months_late;
      if (sort === "name") return String(x.name || "").localeCompare(String(y.name || ""), "ar");
      if (sort === "unit") return String(x.unit || "").localeCompare(String(y.unit || ""), "ar", { numeric: true });
      const d = OWNER_URGENCY[ownerKey(x)] - OWNER_URGENCY[ownerKey(y)];
      return d !== 0 ? d : y.months_late - x.months_late;
    });
    return out;
  }, [a.owners, q, filter, sort]);

  const chips: { k: "all" | OwnerKey; label: string }[] = [
    { k: "all", label: `الكل ${total}` },
    { k: "critical", label: `حرج ${critical.length}` },
    { k: "late", label: `متأخر ${a.owners.filter((o) => ownerKey(o) === "late").length}` },
    { k: "partial", label: `سداد جزئي ${a.owners.filter((o) => ownerKey(o) === "partial").length}` },
    { k: "ok", label: `مسدّد ${total - late.length}` },
  ];

  return (
    <div>
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[70] rounded-xl px-4 py-3 text-sm font-semibold shadow-lg border ${
          toast.k === "ok" ? "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]" : "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]"}`}>
          {toast.m}
        </div>
      )}

      {/* شريط اختيار الجمعية */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl">{a.name}</h1>
          <div className="text-sm text-muted">إدارة جمعية الملاك · {total} من {a.units || total} وحدة</div>
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

      {/* إحصاءات — قابلة للنقر للتصفية */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat v={sar(expectedMonthly)} l="الدخل الشهري المتوقّع" kpi="income" icon="\u2191" onClick={() => setFilter("all")} active={filter === "all"} />
        <Stat v={sar(owedTotal)} l={`المتأخر (${late.length} مالك)`} kpi="overdue" icon="!" onClick={() => { setFilter("late"); setSort("amount"); }} active={filter === "late"} />
        <Stat v={`${pct}%`} l="نسبة السداد" kpi="soon" icon="\u25CF" onClick={() => setFilter("ok")} active={filter === "ok"} />
        <Stat v={dl === null ? "—" : String(dl)} l="يوم حتى انتهاء الشهادة" kpi={dl !== null && dl <= 30 ? "overdue" : "expiring"} icon="\u21BB" />
      </div>

      <div className="grid md:grid-cols-[1.6fr_1fr] gap-5 items-start">
        {/* الملّاك */}
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">الملّاك وحالة السداد</h2>
            {a.fee > 0 && <span className="text-xs text-muted">الاشتراك {sar(a.fee)} ريال/شهر</span>}
          </div>

          <div className="p-4">
            <AddOwner onAdd={addOwner} />

            {/* شريط التحكّم: بحث · تصفية · فرز */}
            {total > 0 && (
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <input className="fld flex-1 min-w-[150px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم المالك أو رقم الوحدة…" />
                <select className="fld max-w-[165px]" value={sort} onChange={(e) => setSort(e.target.value as any)}>
                  <option value="urgent">الأهم أولًا</option>
                  <option value="amount">الأكثر تأخّرًا</option>
                  <option value="unit">رقم الوحدة</option>
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

            <div className="flex flex-col gap-2">
              {!total ? (
                <div className="text-center text-muted py-6 text-sm">لا يوجد ملّاك — أضف أول مالك بالأعلى.</div>
              ) : !rows.length ? (
                <div className="text-center text-muted py-6 text-sm">
                  لا نتائج مطابقة.
                  <button className="btn btn-ghost text-xs mt-3 mx-auto" onClick={() => { setQ(""); setFilter("all"); }}>مسح البحث والتصفية</button>
                </div>
              ) : rows.map((o) => {
                const k = ownerKey(o);
                const owed = o.months_late * (a.fee || 0);
                return (
                  <div key={o.id} className={`rounded-xl border p-3 ${k === "critical" ? "border-[#F5C6C2] bg-[#FEF7F6]" : "border-line bg-paper"}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="w-9 h-9 rounded-lg bg-paper2 grid place-items-center font-semibold text-deep shrink-0">{(o.name || "?").charAt(0)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate">{o.name}</div>
                          <div className="text-xs text-muted">
                            {o.unit ? `وحدة ${o.unit}` : "—"}{o.last_paid ? ` · آخر سداد ${o.last_paid}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="text-right sm:text-left shrink-0">
                        <StatusPill k={k} />
                        <div className="text-xs mt-1 tabular-nums">
                          {o.months_late > 0
                            ? (Number(o.partial_amount) || 0) > 0
                              ? <span className="text-[#9A5B00] font-semibold">دُفع {sar(Number(o.partial_amount) || 0)} · متبقٍ {sar(owed)}</span>
                              : <span className="text-late font-bold">{o.months_late} شهر · {sar(owed)} ريال</span>
                            : <span className="text-muted">لا مستحقات</span>}
                        </div>
                      </div>
                    </div>

                    {/* إجراء رئيسي + قائمة المزيد */}
                    <div className="flex flex-wrap gap-1.5 justify-stretch sm:justify-end mt-2.5 items-center [&>*]:flex-1 sm:[&>*]:flex-none [&>*]:justify-center">
                      {o.months_late > 0 && (
                        <QuickBtn title="تأكيد استلام اشتراك شهر" cls="btn-primary" onClick={() => recordOwnerPayment(o, a.fee || 0, a.fee || 0)}>&#10004;</QuickBtn>
                      )}
                      {o.months_late > 0 && <QuickBtn title="سداد جزئي" cls="btn-ghost" onClick={() => setPaying(o)}>&#189;</QuickBtn>}
                      {o.months_late > 0 && <a href={ownerRemindLink(o)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs px-2.5" title="إرسال تذكير واتساب">&#128172;</a>}
                      {o.phone && <a href={`tel:${String(o.phone).replace(/[^0-9+]/g, "")}`} className="btn btn-ghost text-xs px-2.5 sm:hidden" title="اتصال مباشر">&#128222;</a>}
                      {o.months_late >= 2 && <a href={ownerNoticeLink(o)} target="_blank" rel="noreferrer" className="btn btn-gold text-xs">نموذج خطاب</a>}
                      <RowMenu
                        items={[
                          { label: "➕ إضافة استحقاق", run: () => ownerPatch(o.id, { months_late: o.months_late + 1 }) },
                          ...(o.months_late === 0 ? [{ label: "💬 رسالة للمالك", run: () => window.open(ownerRemindLink(o), "_blank") }] : []),
                          ...(o.months_late > 0 ? [{ label: "✅ سدّد الكل", run: () => ownerPatch(o.id, { months_late: 0, last_paid: today() }, o.months_late * (a.fee || 0)) }] : []),
                          { label: "🗑 حذف المالك", run: () => deleteOwner(o.id), danger: true },
                        ]}
                      />
                    </div>
                  </div>
                );
              })}

              {total > 0 && rows.length > 0 && (
                <div className="text-center text-xs text-muted pt-1">عرض {rows.length} من {total} مالك</div>
              )}
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

      {paying && <OwnerPaymentModal owner={paying} fee={a.fee || 0} onClose={() => setPaying(null)}
        onSubmit={(amt) => { recordOwnerPayment(paying, a.fee || 0, amt); setPaying(null); }} />}
      <FormModal open={modal === "new"} title="جمعية جديدة" onClose={() => setModal(null)} onSubmit={createAssociation} />
      <FormModal open={modal === "edit"} title="إعدادات الجمعية" initial={active || undefined} onClose={() => setModal(null)} onSubmit={updateAssociation} onDelete={deleteAssociation} />
    </div>
  );
}

// ---------- مكوّنات فرعية ----------

/** بطاقة إحصاء — قابلة للنقر للتصفية */
/** بطاقة KPI — أيقونة ولون دلالي لقراءة بصرية خاطفة */
const KPI: Record<string, { ring: string; val: string; bold?: boolean }> = {
  income:   { ring: "bg-[#E6F4EC] text-[#137a50]", val: "text-paid" },
  overdue:  { ring: "bg-[#FBE9E7] text-[#a5322c]", val: "text-late", bold: true },
  soon:     { ring: "bg-[#FBF1DF] text-[#8a5a11]", val: "text-[#8a5a11]" },
  expiring: { ring: "bg-[#F1EBFC] text-[#5B21B6]", val: "text-[#5B21B6]" },
  plain:    { ring: "bg-paper2 text-deep",          val: "text-deep" },
};

function Stat({ v, l, kpi = "plain", icon, onClick, active }: {
  v: string; l: string; kpi?: string; icon?: string; onClick?: () => void; active?: boolean;
}) {
  const k = KPI[kpi] || KPI.plain;
  const base = `bg-white border rounded-xl p-4 shadow-sm text-right w-full transition ${active ? "border-gold ring-1 ring-goldSoft" : "border-line"}`;
  const inner = (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        {icon && <span className={`w-7 h-7 rounded-lg grid place-items-center text-sm font-bold shrink-0 ${k.ring}`}>{icon}</span>}
        <div className={`font-display leading-none text-2xl ${k.val} ${k.bold ? "font-extrabold" : "font-bold"}`}>{v}</div>
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

/** نافذة تسجيل مبلغ مستلم من مالك — كامل أو جزئي */
function OwnerPaymentModal({ owner, fee, onClose, onSubmit }: {
  owner: Owner; fee: number; onClose: () => void; onSubmit: (amount: number) => void;
}) {
  const already = Number(owner.partial_amount) || 0;
  const remaining = Math.max(0, fee - already);
  const [amount, setAmount] = useState<string>(String(remaining || fee));
  const amt = Number(amount) || 0;
  const pool = already + amt;
  const months = fee > 0 ? Math.floor(pool / fee) : 0;
  const leftover = fee > 0 ? +(pool - months * fee).toFixed(2) : 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-display font-bold text-deep text-xl mb-1">تسجيل مبلغ مستلم</h3>
      <p className="text-sm text-muted mb-4">{owner.name} · {owner.unit ? `وحدة ${owner.unit}` : "—"}</p>

      <div className="bg-paper2 border border-line rounded-xl p-3 mb-4 text-sm">
        <div className="flex justify-between"><span className="text-muted">الاشتراك الشهري</span><b className="tabular-nums">{sar(fee)} ريال</b></div>
        <div className="flex justify-between mt-1"><span className="text-muted">أشهر متأخرة</span><b className="tabular-nums text-late">{owner.months_late}</b></div>
        {already > 0 && (
          <div className="flex justify-between mt-1"><span className="text-muted">مدفوع جزئيًّا سابقًا</span>
            <b className="tabular-nums text-[#9A5B00]">{sar(already)} ريال</b></div>
        )}
      </div>

      <Field label="المبلغ المستلم (ريال)">
        <input className="fld" type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="flex gap-2 mt-2 flex-wrap">
        {remaining > 0 && remaining !== fee && (
          <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(remaining))}>إكمال الشهر ({sar(remaining)})</button>
        )}
        <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(fee))}>شهر كامل ({sar(fee)})</button>
        {owner.months_late > 1 && (
          <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(owner.months_late * fee - already))}>سداد الكل</button>
        )}
      </div>

      {amt > 0 && (
        <div className="bg-[#E6F4EC] border border-[#B7DFC7] rounded-xl p-3 mt-4 text-xs text-[#137a50] leading-relaxed">
          {months > 0 && <div>سيُسدَّد <b>{Math.min(months, owner.months_late)}</b> شهر.</div>}
          {leftover > 0 && <div>ويتبقّى <b>{sar(leftover)} ريال</b> مسجّلة كسداد جزئي.</div>}
          {months === 0 && leftover > 0 && <div>لن يكتمل شهر — يُسجَّل المبلغ جزئيًّا فقط.</div>}
        </div>
      )}

      <div className="flex gap-2 mt-5">
        <button className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button className="btn btn-gold flex-1 justify-center" disabled={!amt} onClick={() => onSubmit(amt)}>تسجيل</button>
      </div>
      </div>
    </div>
  );
}


/** شارة حالة المالك */
function StatusPill({ k }: { k: OwnerKey }) {
  const m = OWNER_META[k];
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
              <button key={i} type="button" onClick={() => { setOpen(false); it.run(); }}
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
            <div className="block">
              <span className="block text-sm font-semibold mb-1">فترة السماح (أيام)</span>
              <div className="flex gap-2 flex-wrap">
                {[0, 3, 5, 7].map((g) => (
                  <button key={g} type="button" onClick={() => setD({ ...d, grace_days: g })}
                    className={`border-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      (Number(d.grace_days) || 0) === g ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                    {g === 0 ? "بدون" : `${g} أيام`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {!(d.name || "").trim() && (
          <p className="text-xs text-late mt-3">اسم الجمعية مطلوب لتفعيل الحفظ.</p>
        )}
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!(d.name || "").trim()}
            title={!(d.name || "").trim() ? "أدخل اسم الجمعية أولًا" : "حفظ"}
            style={!(d.name || "").trim() ? { opacity: .5, cursor: "not-allowed" } : undefined}
            onClick={() => onSubmit(d)}>حفظ</button>
        </div>
        {onDelete && <div className="text-center mt-3"><button className="text-late text-sm font-semibold underline" onClick={onDelete}>حذف الجمعية نهائيًّا</button></div>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-semibold mb-1">{label}</span>{children}</label>;
}
