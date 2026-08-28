"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, daysLeft, waLink, WATHEQ_WA, today } from "@/lib/utils";
import { ownerStatementHTML, associationStatementHTML, budgetHTML, foundingMinutesHTML,
  renewalMinutesHTML, DEFAULT_BUDGET_ITEMS, openDoc, type BudgetItem } from "@/lib/documents";

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

export default function AssociationView({ initial, issuer }: { initial: Association[]; issuer?: any }) {
  const supabase = createClient();
  const router = useRouter();
  /** يضمن أن كل جمعية تحمل مصفوفتيها — يمنع انكسار العرض عند صفٍّ جديد */
  const normalize = (list: Association[]): Association[] =>
    (list || []).map((a) => ({
      ...a,
      owners: Array.isArray(a?.owners) ? a.owners : [],
      association_notes: Array.isArray(a?.association_notes) ? a.association_notes : [],
    }));

  const [items, setItems] = useState<Association[]>(() => normalize(initial));
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id || null);
  const [modal, setModal] = useState<null | "new" | "edit">(null);
  const [busy, setBusy] = useTransition();

  // ---------- أدوات العرض: بحث / تصفية / فرز / إشعار ----------
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | OwnerKey>("all");
  const [sort, setSort] = useState<"urgent" | "amount" | "name" | "unit">("urgent");
  const [paying, setPaying] = useState<Owner | null>(null);
  const [doc, setDoc] = useState<null | { title: string; body: string; kind?: "notice" | "final" | "file" }>(null);
  const [history, setHistory] = useState<null | { owner: Owner; rows: any[] }>(null);
  const [ownerModal, setOwnerModal] = useState<null | { owner?: Owner }>(null);
  const [budget, setBudget] = useState<null | { year: number; items: BudgetItem[]; reserve_pct: number; notes: string }>(null);
  const [minutes, setMinutes] = useState(false);
  /** حزمة تجديد الشهادة — المستندان المطلوبان في منصة ملاك: المحضر + الموازنة */
  const [renewal, setRenewal] = useState<null | { annualBudget: number | null }>(null);
  const [bulk, setBulk] = useState(false);
  const [remindAll, setRemindAll] = useState(false);
  /** ملف التحصيل — سلّم التصعيد وصولًا إلى مستندات السند التنفيذي */
  const [collect, setCollect] = useState<null | { owner?: Owner }>(null);
  const [toast, setToast] = useState<null | { k: "ok" | "err"; m: string }>(null);
  // الحسابات تعتمد على تاريخ اليوم، وتوقيت السيرفر يختلف عن توقيت الجهاز.
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

  const active = useMemo(() => items.find((a) => a.id === activeId) || null, [items, activeId]);

  // ── تُحسب قبل أي خروج مبكر حتى يبقى ترتيب الـhooks ثابتًا ──
  const ownersForFilter: Owner[] = useMemo(() => {
    const assoc = active;
    if (!assoc) return [];
    return Array.isArray(assoc.owners) ? assoc.owners : [];
  }, [active]);

  // الصفوف المعروضة: بحث ← تصفية ← فرز
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = ownersForFilter.filter((o) => {
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
  }, [ownersForFilter, q, filter, sort]);


  /** تسجيل مبلغ مستلم من مالك — يحوّل الجزئي إلى أشهر مسدّدة */
  async function recordOwnerPayment(o: Owner, fee: number, amount: number, method = "transfer", note?: string) {
    const amt = Math.max(0, Number(amount) || 0);
    if (!amt || fee <= 0 || !active) return;
    const pool = (Number(o.partial_amount) || 0) + amt;
    const months = Math.floor(pool / fee);
    const rest = +(pool - months * fee).toFixed(2);
    const newLate = Math.max(0, o.months_late - months);
    await ownerPatch(o.id, {
      months_late: newLate,
      partial_amount: rest,
      ...(months > 0 ? { last_paid: today() } : {}),
    }, amt);
    // سجل الدفعة — التاريخ والمبلغ والطريقة
    const uid = await currentUserId();
    if (uid) {
      const { error } = await supabase.from("payments").insert({
        user_id: uid, owner_id: o.id, association_id: active.id,
        paid_on: today(), amount: amt, method,
        periods_covered: months, note: note || null,
      });
      if (error) console.error("Watheq payment log error:", error);
    }

    notify("ok", months > 0
      ? `سُجّل ${sar(amt)} ريال — سُدّد ${months} شهر`
      : `سُجّل ${sar(amt)} ريال كسداد جزئي`);
  }

  /** حفظ بيانات مالك (تعديل) — لم يكن ممكنًا قبل الآن */
  async function saveOwner(id: string, d: any) {
    const patch = {
      name: (d.name || "").trim(),
      unit: (d.unit || "").trim() || null,
      phone: (d.phone || "").trim() || null,
      months_late: Math.max(0, Number(d.months_late) || 0),
    };
    if (!patch.name) return notify("err", "اسم المالك مطلوب.");
    await ownerPatch(id, patch);
    setOwnerModal(null);
    notify("ok", "حُدّثت بيانات المالك.");
  }

  /** كشف حساب مالك — مع سجل مدفوعاته الموثّق */
  async function openOwnerStatement(o: Owner) {
    if (!active) return;
    const { data, error } = await supabase.from("payments")
      .select("id,paid_on,amount,method,periods_covered,note")
      .eq("owner_id", o.id).order("paid_on", { ascending: true }).limit(500);
    if (error) console.error("Watheq statement payments error:", error);
    openDoc(ownerStatementHTML(o as any, active as any, issuer || {}, (data || []) as any));
  }

  /** يفتح الموازنة: يجلب المحفوظة أو يبدأ بالبنود النموذجية */
  async function openBudget() {
    if (!active) return;
    const year = new Date().getFullYear();
    const { data, error } = await supabase.from("association_budgets")
      .select("*").eq("association_id", active.id).eq("year", year).maybeSingle();
    if (error) console.error("Watheq budget load error:", error);
    setBudget({
      year,
      items: (data?.items as BudgetItem[]) || DEFAULT_BUDGET_ITEMS.map((i) => ({ ...i })),
      reserve_pct: Number(data?.reserve_pct ?? 10),
      notes: data?.notes || "",
    });
  }

  /** حفظ الموازنة (إنشاء أو تحديث للسنة نفسها) */
  async function saveBudget(b: { year: number; items: BudgetItem[]; reserve_pct: number; notes: string }) {
    if (!active) return;
    const uid = await currentUserId();
    if (!uid) return notify("err", "انتهت الجلسة — أعد تسجيل الدخول.");
    const { error } = await supabase.from("association_budgets").upsert({
      user_id: uid, association_id: active.id, year: b.year,
      items: b.items.filter((i) => i.label?.trim()),
      reserve_pct: b.reserve_pct, notes: b.notes || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "association_id,year" });
    if (error) { console.error("Watheq budget save error:", error); return notify("err", error.message); }
    notify("ok", `حُفظت موازنة ${b.year}.`);
  }

  /** إجمالي الموازنة السنوية المحفوظة (تشغيل + احتياطي) لسنة معيّنة — أو null إن لم تُحفظ */
  async function savedAnnualBudget(year: number): Promise<number | null> {
    if (!active) return null;
    const { data } = await supabase.from("association_budgets")
      .select("items,reserve_pct").eq("association_id", active.id).eq("year", year).maybeSingle();
    if (!data) return null;
    const monthly = ((data.items as BudgetItem[]) || []).reduce((s, i) => s + (Number(i.monthly) || 0), 0);
    const ops = monthly * 12;
    return Math.round(ops + ops * ((Number(data.reserve_pct) || 0) / 100));
  }

  /** يفتح حزمة تجديد الشهادة — يجلب موازنة العام القادم (أو الحالي) لتعبئة المحضر تلقائيًّا */
  async function openRenewal() {
    if (!active) return;
    const nextYear = new Date().getFullYear() + 1;
    const annualBudget = (await savedAnnualBudget(nextYear)) ?? (await savedAnnualBudget(nextYear - 1));
    setRenewal({ annualBudget });
  }

  /** طباعة الموازنة المحفوظة مباشرة — يفضّل موازنة العام القادم ثم الحالي */
  async function printSavedBudget() {
    if (!active) return;
    const nextYear = new Date().getFullYear() + 1;
    for (const y of [nextYear, nextYear - 1]) {
      const { data } = await supabase.from("association_budgets")
        .select("*").eq("association_id", active.id).eq("year", y).maybeSingle();
      if (data) {
        return openDoc(budgetHTML(active as any, {
          year: y, items: (data.items as BudgetItem[]) || [],
          reserve_pct: Number(data.reserve_pct ?? 10), notes: data.notes || "",
        } as any, issuer || {}));
      }
    }
    notify("err", "لا توجد موازنة محفوظة بعد — أنشئها من زر «الموازنة» أولًا.");
  }

  /** إضافة ملّاك دفعة واحدة — سطر لكل مالك: الاسم، الوحدة، الجوال */
  async function addOwnersBulk(rows: { name: string; unit: string | null; phone: string | null }[]) {
    if (!active || !rows.length) return;
    const { data, error } = await supabase.from("owners").insert(
      rows.map((r) => ({ association_id: active.id, name: r.name, unit: r.unit, phone: r.phone, months_late: 0 }))
    ).select("*");
    if (error) { console.error("Watheq bulk owners error:", error); return notify("err", error.message); }
    setItems(items.map((a) => a.id === active.id ? { ...a, owners: [...a.owners, ...((data || []) as Owner[])] } : a));
    setBulk(false);
    notify("ok", `أُضيف ${rows.length} مالكًا دفعة واحدة.`);
  }

  /** تصدير الملّاك CSV — يفتح مباشرة في Excel بترميز عربي سليم */
  function exportOwnersCSV() {
    if (!active) return;
    const fee = active.fee || 0;
    const head = ["الاسم", "الوحدة", "الجوال", "أشهر متأخرة", "المتأخر (ريال)", "مسدَّد جزئيًّا", "آخر سداد", "الحالة"];
    const lines = (active.owners || []).map((o) => {
      const k = ownerKey(o);
      return [o.name, o.unit || "", o.phone || "", o.months_late,
        Math.max(0, o.months_late * fee - (Number(o.partial_amount) || 0)),
        Number(o.partial_amount) || 0, o.last_paid || "", OWNER_META[k].label]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    });
    const csv = "\uFEFF" + [head.join(","), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const aEl = document.createElement("a");
    aEl.href = url; aEl.download = `ملاك-${active.name}-${today()}.csv`;
    aEl.click(); URL.revokeObjectURL(url);
  }

  /** كشف حساب الجمعية كاملة */
  function openAssocStatement() {
    if (!active) return;
    openDoc(associationStatementHTML(active as any, issuer || {}));
  }

  /** يفتح سجل مدفوعات مالك معيّن */
  async function openHistory(o: Owner) {
    const { data, error } = await supabase.from("payments")
      .select("*").eq("owner_id", o.id).order("paid_on", { ascending: false }).limit(200);
    if (error) { console.error("Watheq history error:", error); return notify("err", error.message); }
    setHistory({ owner: o, rows: data || [] });
  }
  // ---------- جمعية ----------
  /** هوية المستخدم الحالي — تشترطها سياسة الصلاحيات (RLS) عند الإدراج */
  /** معرّف المكتب لا المستخدم — قيود الموظف تُسجَّل تحت مكتبه (v9) */
  async function currentUserId(): Promise<string | null> {
    const oid = await officeId(supabase);
    if (oid) return oid;
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
    const next = { ...(row as any), owners: [], association_notes: [] } as Association;
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
  /** تذكير ودّي — يحفظ حسن الجوار ويوضّح تفاصيل المطالبة */
  function ownerRemindLink(o: Owner) {
    if (!active) return "#";
    const fee = active.fee || 0;
    const partial = Number(o.partial_amount) || 0;
    const gross = o.months_late * fee;
    const due = Math.max(0, gross - partial);
    const unit = o.unit ? `الوحدة (${o.unit})` : "وحدتكم";
    const assoc = active.name;

    const lines: string[] = [`السلام عليكم ورحمة الله، ${o.name} 🌿`, ""];

    if (o.months_late <= 0) {
      lines.push(`تذكير ودّي بأن اشتراك الصيانة عن ${unit} في ${assoc}${fee ? ` وقدره ${sar(fee)} ريال` : ""} أصبح مستحقًّا.`);
    } else {
      lines.push(`نودّ تذكيركم بأن اشتراك الصيانة عن ${unit} في ${assoc} لا يزال غير مسدَّد، وبيانه:`);
      lines.push(`• عدد الفترات المتأخرة: ${o.months_late}`);
      if (fee) lines.push(`• قيمة الاشتراك للفترة: ${sar(fee)} ريال`);
      if (partial > 0) lines.push(`• المسدَّد جزئيًّا: ${sar(partial)} ريال`);
      if (due) lines.push(`• المبلغ المتبقّي: ${sar(due)} ريال`);
    }

    lines.push("");
    lines.push("وتُصرف هذه الاشتراكات على صيانة الأجزاء المشتركة وخدماتها بما يحفظ قيمة العقار للجميع، ويُسدَّد المبلغ في الحساب البنكي للجمعية.");
    lines.push("");
    lines.push("فإن كان السداد قد تم فنعتذر عن التذكير، ونرجو تزويدنا بما يفيد لتحديث السجل.");
    lines.push("");
    lines.push("شاكرين لكم حسن تعاونكم،");
    lines.push(`إدارة ${assoc}`);
    return waLink(o.phone, lines.join("\n"));
  }

  /** إشعار مكتوب — مستند إلى الأساس النظامي والمسار الصحيح للتحصيل */
  function makeOwnerNotice(o: Owner) {
    if (!active) return;
    const fee = active.fee || 0;
    const partial = Number(o.partial_amount) || 0;
    const due = Math.max(0, o.months_late * fee - partial);
    const unit = o.unit || "—";
    const body = [
      ...trialBanner(),
      "إشعار بسداد اشتراكات الصيانة المتأخرة",
      `التاريخ: ${today()}`,
      "",
      `من: إدارة ${active.name} (جمعية الملاك)`,
      `إلى: المكرَّم ${o.name}، مالك الوحدة العقارية رقم (${unit}).`,
      "",
      "الموضوع: مطالبة بسداد اشتراكات الصيانة المستحقة.",
      "",
      "السلام عليكم ورحمة الله وبركاته،",
      "",
      "بالإشارة إلى نظام ملكية الوحدات العقارية وفرزها وإدارتها، الصادر بالمرسوم الملكي رقم (م/85) وتاريخ 02/07/1441هـ، وإلى النظام الأساسي للجمعية وقرار الجمعية العامة المعتمد بتحديد مبلغ الاشتراك؛",
      "",
      `نفيدكم بأنه قد ترصَّد بذمّتكم مبلغ (${sar(due)}) ريال، قيمة (${o.months_late}) فترة اشتراك مستحقة عن الوحدة رقم (${unit})${fee ? `، بواقع (${sar(fee)}) ريال للفترة` : ""}${partial > 0 ? `، بعد خصم مبلغ (${sar(partial)}) ريال مسدَّد جزئيًّا` : ""}، ولم يُسدَّد حتى تاريخ هذا الإشعار.`,
      "",
      "وتُخصَّص هذه الاشتراكات لصيانة الأجزاء المشتركة وتشغيلها وفق الموازنة المعتمدة، ويؤثّر التأخّر في سدادها على حقوق بقية الملاك وعلى استدامة خدمات العقار.",
      "",
      "لذا نأمل المبادرة بسداد المبلغ المذكور خلال (10) أيام من تاريخ استلامكم هذا الإشعار، إيداعًا في الحساب البنكي للجمعية، وتزويد إدارة الجمعية بما يفيد السداد.",
      "",
      "وفي حال عدم السداد خلال المدة المذكورة، فسيتخذ مدير العقار الإجراءات النظامية المتاحة، ومنها رفع بيانات المتعثّرين عن السداد عبر منصة «ملاك»، والتوجّه إلى محكمة التنفيذ أو الجهة المختصة وفق الإجراءات المعتمدة.",
      "",
      "ونؤكّد أن غايتنا حفظ حقوق الجميع وحسن الجوار، ونتطلّع إلى تسوية الأمر ودّيًا.",
      "",
      "وتقبّلوا تحياتنا،",
      `إدارة ${active.name}`,
      "",
      "الاسم: ____________________     الصفة: ____________________",
      `التوقيع: ____________________     التاريخ: ${today()}`,
      ...brandLine(),
    ].join("\n");
    setDoc({ title: `إشعار سداد اشتراكات — ${o.name}`, body, kind: "notice" });
    logNotice(o, "خطاب مطالبة");
  }

  // ════════════════════════════════════════════════════════════
  //  ملف التحصيل — سلّم تصعيد موثّق ينتهي بمستندات السند التنفيذي.
  //  الحدّ النظامي: وثيق يُجهّز المستندات فقط؛ ورفع طلب السند التنفيذي
  //  في منصة «ملاك» واستكماله عبر «ناجز» يتم من مدير العقار نفسه.
  // ════════════════════════════════════════════════════════════

  /** المبلغ الصافي المتأخر على مالك */
  const ownerDue = (o: Owner) =>
    Math.max(0, o.months_late * (active?.fee || 0) - (Number(o.partial_amount) || 0));

  /** وسم يميّز خطابات التحصيل داخل سجل العمارة */
  const NOTICE_TAG = "[تحصيل]";
  const ownerRef = (o: Owner) => (o.unit ? `الوحدة (${o.unit})` : o.name);

  /** سجل المطالبات السابقة لمالك — يُقرأ من سجل العمارة نفسه، بلا جدول جديد */
  const noticeLog = (o: Owner): Note[] =>
    (active?.association_notes || [])
      .filter((n) => String(n.text || "").startsWith(NOTICE_TAG) && String(n.text).includes(ownerRef(o)))
      .sort((x, y) => String(x.note_date).localeCompare(String(y.note_date)));

  /** درجة التصعيد: 0 لم تُوثَّق مطالبة · 1 أُرسلت مطالبة · 2 صدر إنذار نهائي */
  const escalation = (o: Owner): 0 | 1 | 2 => {
    const log = noticeLog(o);
    if (log.some((n) => String(n.text).includes("إنذار نهائي"))) return 2;
    return log.length ? 1 : 0;
  };

  /** توثيق خطوة تصعيد في سجل العمارة — هذا التوثيق هو «سجل المطالبات» في الملف */
  async function logNotice(o: Owner, label: string) {
    if (!active) return;
    const text = `${NOTICE_TAG} ${label} — ${ownerRef(o)} · ${o.name} · ${o.months_late} فترة متأخرة بمبلغ ${sar(ownerDue(o))} ريال`;
    const { data, error } = await supabase.from("association_notes").insert({
      association_id: active.id, text, note_date: today(),
    }).select("*").single();
    if (error) { console.error("Watheq notice log error:", error); return; }
    setItems((prev) => prev.map((x) => x.id === active.id
      ? { ...x, association_notes: [data as Note, ...(x.association_notes || [])] } : x));
  }

  /** ثلاث حالات: مشترك = نظيف · تجربة نشطة = لا شيء (سطر المصدر في التذييل) · انتهت بلا اشتراك = علامة */
  const trialBanner = () => issuer?.expired
    ? ["《 نسخة تجريبية — غير معتمدة 》", "انتهت فترة التجربة ولم يُفعَّل اشتراك. فعّل اشتراكك لإصدار النسخة النهائية.", "", "──────────────────────────────", ""]
    : [];

  /** سطر المصدر — يُذيَّل به كل مستند نصّي أثناء التجربة النشطة */
  const brandLine = () => (issuer?.trial && !issuer?.expired)
    ? ["", "──────────────────────────────", "أُنشئ عبر وثيق · watheqapp.com"]
    : [];

  /** إنذار نهائي — آخر خطوة ودّية قبل اللجوء إلى إجراءات المنصة */
  function makeFinalNotice(o: Owner, feeApprovedOn?: string) {
    if (!active) return;
    const fee = active.fee || 0;
    const partial = Number(o.partial_amount) || 0;
    const due = ownerDue(o);
    const unit = o.unit || "—";
    const prev = noticeLog(o);
    const body = [
      ...trialBanner(),
      "إنذار نهائي بسداد اشتراكات الصيانة المتأخرة",
      `التاريخ: ${today()}`,
      "",
      `من: إدارة ${active.name} (جمعية الملاك)`,
      `إلى: المكرَّم ${o.name}، مالك الوحدة العقارية رقم (${unit}).`,
      "",
      "الموضوع: إنذار نهائي قبل اتخاذ الإجراءات النظامية.",
      "",
      "السلام عليكم ورحمة الله وبركاته،",
      "",
      `إلحاقًا بمطالباتنا السابقة${prev.length ? ` (${prev.map((n) => n.note_date).join("، ")})` : ""}، وبالإشارة إلى نظام ملكية الوحدات العقارية وفرزها وإدارتها الصادر بالمرسوم الملكي رقم (م/85) وتاريخ 02/07/1441هـ ولائحته التنفيذية، وإلى النظام الأساسي لجمعية الملاك${feeApprovedOn ? ` وقرار الجمعية العامة بتحديد مبلغ الاشتراك الصادر بتاريخ ${feeApprovedOn}` : ""}؛`,
      "",
      `نُنذركم إنذارًا نهائيًّا بسداد مبلغ (${sar(due)}) ريال، قيمة (${o.months_late}) فترة اشتراك مستحقة عن الوحدة رقم (${unit})${fee ? `، بواقع (${sar(fee)}) ريال للفترة` : ""}${partial > 0 ? `، بعد خصم مبلغ (${sar(partial)}) ريال مسدَّد جزئيًّا` : ""}.`,
      "",
      "ويكون السداد — وفق المادة السادسة من النظام الأساسي — بتحويل بنكي من حسابكم إلى الحساب البنكي لجمعية الملاك، مع تزويد رئيس الجمعية بما يفيد التحويل فور إتمامه، وذلك خلال (15) يومًا من تاريخ استلامكم هذا الإنذار.",
      "",
      "ونذكّركم بأن النظام الأساسي لا يجيز التخلّي عن الالتزام تجاه الجمعية بأي مسوّغ، ولو أبديتم رغبتكم بعدم الانتفاع بالأجزاء المشتركة (المادة الثلاثون)، وأن التزامكم يبقى قائمًا حتى لو كانت الوحدة مؤجَّرة (المادة الحادية والثلاثون).",
      "",
      "وفي حال عدم السداد خلال المدة المذكورة، سيتّخذ مدير العقار الإجراءات المقرّرة نظامًا — بما فيها الاستناد إلى قراره بقيم الاشتراكات المعتمد من الهيئة العامة للعقار، والذي يُعدّ سندًا تنفيذيًّا في مواجهة الملاك وفق المادة السادسة/4 والمادة العشرين من النظام الأساسي — واستكمال إجراءات التنفيذ لدى الجهة المختصة.",
      "",
      "ونؤكّد رغبتنا في تسوية الأمر ودّيًا قبل بلوغ هذه المرحلة، وباب التواصل مفتوح لأي ترتيب للسداد.",
      "",
      "وتقبّلوا تحياتنا،",
      `إدارة ${active.name}`,
      "",
      "الاسم: ____________________     الصفة: ____________________",
      `التوقيع: ____________________     التاريخ: ${today()}`,
      ...brandLine(),
    ].join("\n");
    setDoc({ title: `إنذار نهائي — ${o.name}`, body, kind: "final" });
    logNotice(o, "إنذار نهائي");
  }


  function ownerNoticeLink(o: Owner) {
    if (!active) return "#";
    const total = o.months_late * (active.fee || 0);
    return waLink(WATHEQ_WA, `مرحبًا، أرغب بتجهيز نموذج خطاب تذكير بالسداد عبر وثيق.\nالجمعية: ${active.name}\nمالك الوحدة: ${o.unit || "—"} (${o.name})\nالمتأخرات: ${o.months_late} أشهر${total ? ` بمبلغ ${sar(total)} ريال` : ""}.`);
  }
  function renewLink() {
    if (!active) return "#";
    const dl = daysLeft(active.cert_expiry);
    return waLink(WATHEQ_WA, `مرحبًا، أرغب بمساعدتكم في تجهيز موازنة جمعيتنا وأرقام الاشتراك.\nالجمعية: ${active.name}\nانتهاء الشهادة: ${active.cert_expiry || "غير محدد"}${dl !== null ? ` (خلال ${dl} يومًا)` : ""}\nالمطلوب: الموازنة وبنود رسوم الاشتراك.`);
  }

  // ---------- عرض ----------
  if (!hydrated) {
    return <div className="text-center text-muted py-16 text-sm">جارٍ تحميل لوحتك…</div>;
  }

  if (!items.length) {
    return (
      <div className="max-w-lg mx-auto bg-white border border-line rounded-2xl shadow-sm p-8 mt-10 text-center">
        <div className="w-12 h-12 rounded-lg bg-deep grid place-items-center text-goldSoft font-bold font-display mx-auto mb-4">و</div>
        <h2 className="font-display text-xl font-bold text-deep mb-2">ابدأ بإضافة جمعيتك</h2>
        <p className="text-muted mb-6">أدر ملّاك جمعيتك، حالات السداد، ورصيد الصندوق من مكان واحد.</p>
        <button className="btn btn-gold" onClick={() => setModal("new")}>+ إنشاء جمعية</button>
        {modal === "new" && <FormModal open title="جمعية جديدة" onClose={() => setModal(null)} onSubmit={createAssociation} />}
      </div>
    );
  }

  const a = active!;
  const owners = Array.isArray(a.owners) ? a.owners : [];
  const notes = Array.isArray(a.association_notes) ? a.association_notes : [];
  const total = owners.length;
  const late = owners.filter((o) => o.months_late > 0);
  const critical = owners.filter((o) => o.months_late >= 3);
  const pct = total ? Math.round(((total - late.length) / total) * 100) : 0;
  const dl = daysLeft(a.cert_expiry);
  const owedTotal = late.reduce((s, o) => s + Math.max(0, o.months_late * (a.fee || 0) - (Number(o.partial_amount) || 0)), 0);
  const expectedMonthly = total * (a.fee || 0);


  const chips: { k: "all" | OwnerKey; label: string }[] = [
    { k: "all", label: `الكل ${total}` },
    { k: "critical", label: `حرج ${critical.length}` },
    { k: "late", label: `متأخر ${owners.filter((o) => ownerKey(o) === "late").length}` },
    { k: "partial", label: `سداد جزئي ${owners.filter((o) => ownerKey(o) === "partial").length}` },
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

      {/* ملخّص كل الجمعيات */}
      {items.length > 1 && (() => {
        const p = items.reduce((acc, x) => {
          const ow = Array.isArray(x.owners) ? x.owners : [];
          const f = Number(x.fee) || 0;
          ow.forEach((o) => {
            acc.owners++;
            const d = Math.max(0, (Number(o.months_late) || 0) * f - (Number(o.partial_amount) || 0));
            if ((Number(o.months_late) || 0) > 0) { acc.late++; acc.owed += d; }
          });
          acc.expected += ow.length * f;
          acc.fund += Number(x.fund_balance) || 0;
          const dd = daysLeft(x.cert_expiry);
          if (dd !== null && dd <= 60) acc.certs++;
          return acc;
        }, { owners: 0, late: 0, owed: 0, expected: 0, fund: 0, certs: 0 });
        return (
          <div className="bg-deep text-[#EAF1EE] rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="font-display font-bold text-sm text-goldSoft">محفظتك · {items.length} جمعيات</div>
            <PortfolioStat v={String(p.owners)} l="مالك" />
            <PortfolioStat v={String(p.late)} l="متأخر" tone={p.late ? "warn" : undefined} />
            <PortfolioStat v={sar(p.owed)} l="ريال متأخر" tone={p.owed ? "warn" : undefined} />
            <PortfolioStat v={sar(p.expected)} l="إيراد الفترة المتوقّع" />
            <PortfolioStat v={sar(p.fund)} l="رصيد الصناديق" />
            <PortfolioStat v={String(p.certs)} l="شهادات تنتهي قريبًا" tone={p.certs ? "warn" : undefined} />
          </div>
        );
      })()}

      {/* شريط اختيار الجمعية */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl flex items-center gap-2">
            <span>🏗️</span> {a.name}
          </h1>
          <div className="text-sm text-muted">إدارة جمعية الملاك · {total} من {a.units || total} وحدة</div>
        </div>
        <select value={a.id} onChange={(e) => setActiveId(e.target.value)} className="fld max-w-[220px] font-semibold text-deep">
          {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button type="button" className="btn btn-ghost text-sm" onClick={refreshNow} disabled={refreshing}
          title="تحديث البيانات من السيرفر">{refreshing ? "…" : "↻ تحديث"}</button>
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setModal("edit")}>⚙︎ إعدادات</button>
        <button className="btn btn-gold text-sm" onClick={() => setModal("new")}>+ جمعية</button>
      </div>

      {/* تنبيه الشهادة */}
      {dl !== null && dl < 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl p-3.5 mb-4 bg-[#FBE9E7] border border-[#F5C6C2] text-[#8f2b26]">
          <span>🔴</span><span><b>انتهت شهادة الجمعية.</b> إصدارها من «ملاك» إجراء مباشر ويشترط الرقم الموحّد 700 أولًا.</span>
          <div className="flex gap-2 mr-auto">
            <button type="button" className="btn btn-gold text-sm" onClick={openRenewal}>🗂 جهّز الاجتماع السنوي</button>
            <a href={renewLink()} target="_blank" rel="noreferrer" className="btn btn-ghost text-sm">اطلبها جاهزة</a>
          </div>
        </div>
      )}
      {dl !== null && dl >= 0 && dl <= 60 && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl p-3.5 mb-4 border ${dl <= 30 ? "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]" : "bg-[#FBF1DF] border-[#EBD9AA] text-[#8a5a11]"}`}>
          <span>{dl <= 30 ? "🔴" : "⚠️"}</span>
          <span><b>تنتهي شهادة الجمعية خلال {dl} يومًا</b> ({a.cert_expiry}). إصدارها من «ملاك» إجراء مباشر ويشترط الرقم الموحّد 700 أولًا.</span>
          <div className="flex gap-2 mr-auto">
            <button type="button" className="btn btn-gold text-sm" onClick={openRenewal}>🗂 جهّز الاجتماع السنوي</button>
            <a href={renewLink()} target="_blank" rel="noreferrer" className="btn btn-ghost text-sm">اطلبها جاهزة</a>
          </div>
        </div>
      )}

      {/* إحصاءات — قابلة للنقر للتصفية */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat v={sar(expectedMonthly)} l="الدخل الشهري المتوقّع" kpi="income" icon="↑" onClick={() => setFilter("all")} active={filter === "all"} />
        <Stat v={sar(owedTotal)} l={`المتأخر (${late.length} مالك)`} kpi="overdue" icon="!" onClick={() => { setFilter("late"); setSort("amount"); }} active={filter === "late"} />
        <Stat v={`${pct}%`} l="نسبة السداد" kpi="soon" icon="●" onClick={() => setFilter("ok")} active={filter === "ok"} />
        <Stat v={dl === null ? "—" : String(dl)} l="يوم حتى انتهاء الشهادة" kpi={dl !== null && dl <= 30 ? "overdue" : "expiring"} icon="↻" />
      </div>

      <div className="grid md:grid-cols-[1.6fr_1fr] gap-5 items-start">
        {/* الملّاك */}
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 gap-2 flex-wrap">
            <h2 className="font-semibold">الملّاك وحالة السداد</h2>
            <div className="flex gap-2 items-center">
              {a.fee > 0 && <span className="text-xs text-muted">الاشتراك {sar(a.fee)} ريال/شهر</span>}
              <button type="button" className="btn btn-ghost text-xs" onClick={openAssocStatement}>كشف حساب</button>
              <button type="button" className="btn btn-ghost text-xs" onClick={exportOwnersCSV} title="تنزيل ملف Excel/CSV بكل الملّاك وحالتهم">⬇️ CSV</button>
              {late.length > 0 && (
                <button type="button" className="btn btn-ghost text-xs" onClick={() => setCollect({})}
                  title="سلّم التحصيل: تذكير ← خطاب مطالبة ← إنذار نهائي، وجاهزية السند التنفيذي">⚖️ التحصيل ({late.length})</button>
              )}
              <button type="button" className="btn btn-ghost text-xs" onClick={openBudget}>📊 الموازنة</button>
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setMinutes(true)}>📄 محضر تأسيسي</button>
              <button type="button" className="btn btn-gold text-xs" onClick={openRenewal} title="موازنة العام القادم + محضر الاجتماع السنوي، وأرقامهما جاهزة لقرار الرسوم في المنصة">🗂 الاجتماع السنوي</button>
            </div>
          </div>

          <div className="p-4">
            <AddOwner onAdd={addOwner} />
            <div className="flex justify-end -mt-1 mb-3">
              <button type="button" className="text-xs font-semibold text-gold hover:underline" onClick={() => setBulk(true)}>
                📋 عندك قائمة جاهزة؟ الصقها وأضف كل الملّاك دفعة واحدة
              </button>
            </div>

            {/* شريط التحكّم: بحث · تصفية · فرز */}
            {total > 0 && (
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <input className="fld flex-1 min-w-[150px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم المالك أو رقم الوحدة…" />
                {late.length > 0 && (
                  <button type="button" className="btn btn-wa text-xs" onClick={() => setRemindAll(true)}
                    title="إرسال تذكير واتساب لكل المتأخرين واحدًا تلو الآخر">💬 تذكير جماعي ({late.length})</button>
                )}
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
                      {o.months_late >= 2 && <button type="button" className="btn btn-gold text-xs" onClick={() => makeOwnerNotice(o)}>نموذج إشعار</button>}
                      <RowMenu
                        items={[
                          { label: "🧾 كشف حساب", run: () => openOwnerStatement(o) },
                          { label: "🧮 سجل المدفوعات", run: () => openHistory(o) },
                          { label: "✎ تعديل البيانات", run: () => setOwnerModal({ owner: o }) },
                          { label: "➕ إضافة استحقاق", run: () => ownerPatch(o.id, { months_late: o.months_late + 1 }) },
                          ...(o.months_late === 0 ? [{ label: "💬 رسالة للمالك", run: () => window.open(ownerRemindLink(o), "_blank") }] : []),
                          ...(o.months_late > 0 ? [{ label: "⚖️ ملف التحصيل والتصعيد", run: () => setCollect({ owner: o }) }] : []),
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
            {notes.length ? notes.map((n) => (
              <div key={n.id} className="flex gap-2.5 py-2.5 border-b border-dashed border-line last:border-0 text-sm">
                <span className="text-xs font-semibold text-[#8a5a11] w-16 shrink-0">{n.note_date}</span>
                <span className="flex-1 text-[#33413d]">{n.text}</span>
                <button className="text-muted text-sm opacity-60 hover:opacity-100 hover:text-late" onClick={() => deleteNote(n.id)}>✕</button>
              </div>
            )) : <div className="text-center text-muted py-6 text-sm">لا ملاحظات بعد.</div>}
          </div>
        </div>
      </div>

      {budget && <BudgetModal assoc={a} budget={budget} onClose={() => setBudget(null)}
        onSave={(b) => { saveBudget(b); setBudget(b); }}
        onPrint={(b) => openDoc(budgetHTML(a as any, b as any, issuer || {}))} />}
      {minutes && <MinutesModal assoc={a} onClose={() => setMinutes(false)}
        onPrint={(d) => openDoc(foundingMinutesHTML(a as any, d as any, issuer || {}))} />}
      {renewal && <RenewalModal assoc={a} annualBudget={renewal.annualBudget}
        onClose={() => setRenewal(null)}
        onEditBudget={() => { setRenewal(null); openBudget(); }}
        onPrintBudget={printSavedBudget}
        onPrintMinutes={(d) => openDoc(renewalMinutesHTML(a as any, d as any, issuer || {}))} />}
      {bulk && <BulkOwnersModal onClose={() => setBulk(false)} onSubmit={addOwnersBulk} />}
      {remindAll && <RemindAllOwnersModal owners={late} fee={a.fee || 0} linkOf={ownerRemindLink}
        onClose={() => setRemindAll(false)} />}
      {collect && <CollectionsModal assoc={a} owners={late} only={collect.owner}
        fee={a.fee || 0} stageOf={escalation} logOf={noticeLog} dueOf={ownerDue}
        onClose={() => setCollect(null)}
        onRemind={(o) => window.open(ownerRemindLink(o), "_blank")}
        onNotice={(o) => makeOwnerNotice(o)}
        onFinal={(o, d) => makeFinalNotice(o, d)} />}
      {ownerModal?.owner && <OwnerModal owner={ownerModal.owner} onClose={() => setOwnerModal(null)}
        onSubmit={(d) => saveOwner(ownerModal.owner!.id, d)} />}
      {history && <HistoryModal data={history} onClose={() => setHistory(null)} />}
      {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
      {paying && <OwnerPaymentModal owner={paying} fee={a.fee || 0} onClose={() => setPaying(null)}
        onSubmit={(amt, method, note) => { recordOwnerPayment(paying, a.fee || 0, amt, method, note); setPaying(null); }} />}
      {/* عرض شرطي: التفكيك عند الإغلاق هو ما يمحو الحقول */}
      {modal === "new" && <FormModal open title="جمعية جديدة" onClose={() => setModal(null)} onSubmit={createAssociation} />}
      {modal === "edit" && active && (
        <FormModal open title="إعدادات الجمعية" initial={active} onClose={() => setModal(null)} onSubmit={updateAssociation} onDelete={deleteAssociation} />
      )}
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

/** نافذة تسجيل مبلغ مستلم من مالك — كامل أو جزئي */
const METHODS: { v: string; l: string }[] = [
  { v: "transfer", l: "تحويل بنكي" }, { v: "cash", l: "نقدًا" },
  { v: "pos", l: "شبكة" }, { v: "cheque", l: "شيك" }, { v: "other", l: "أخرى" },
];
const methodLabel = (v?: string | null) => METHODS.find((m) => m.v === v)?.l || "أخرى";

function OwnerPaymentModal({ owner, fee, onClose, onSubmit }: {
  owner: Owner; fee: number; onClose: () => void;
  onSubmit: (amount: number, method: string, note?: string) => void;
}) {
  const already = Number(owner.partial_amount) || 0;
  const remaining = Math.max(0, fee - already);
  const [amount, setAmount] = useState<string>(String(remaining || fee));
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");
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

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="طريقة السداد">
          <select className="fld" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </Field>
        <Field label="ملاحظة (اختياري)">
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder="رقم الحوالة…" />
        </Field>
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
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!amt} onClick={() => onSubmit(amt, method, note.trim() || undefined)}>تسجيل</button>
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

/** الموازنة التقديرية — بنود قابلة للتعديل مع حساب الاشتراك المقترح */
function BudgetModal({ assoc, budget, onClose, onSave, onPrint }: {
  assoc: Association;
  budget: { year: number; items: BudgetItem[]; reserve_pct: number; notes: string };
  onClose: () => void;
  onSave: (b: any) => void;
  onPrint: (b: any) => void;
}) {
  const [items, setItems] = useState<BudgetItem[]>(budget.items);
  const [reserve, setReserve] = useState<string>(String(budget.reserve_pct));
  const [notes, setNotes] = useState(budget.notes || "");

  const monthly = items.reduce((s, i) => s + (Number(i.monthly) || 0), 0);
  const annualOps = monthly * 12;
  const rp = Math.max(0, Math.min(50, Number(reserve) || 0));
  const reserveAmt = Math.round(annualOps * (rp / 100));
  const total = annualOps + reserveAmt;
  const units = Number(assoc.units) || (Array.isArray(assoc.owners) ? assoc.owners.length : 0);
  const perMonth = units ? Math.round(total / units / 12) : 0;
  const currentFee = Number(assoc.fee) || 0;
  const gap = total - currentFee * 12 * units;

  const payload = { year: budget.year, items, reserve_pct: rp, notes };
  const setItem = (n: number, patch: Partial<BudgetItem>) =>
    setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">الموازنة التقديرية {budget.year}</h3>
        <p className="text-sm text-muted mb-4">{assoc.name}{units ? ` · ${units} وحدة` : ""} — أدخل المصروف الشهري لكل بند، ويُحسب الاشتراك المقترح تلقائيًّا.</p>

        {units === 0 && (
          <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#8f2b26] rounded-xl p-3.5 mb-4 text-sm leading-relaxed">
            <b>لم يُحدَّد عدد الوحدات لهذه الجمعية.</b> بدونه لا يُحتسب اشتراك الوحدة — وهو الرقم الأهم في الموازنة.
            أغلق هذه النافذة، افتح <b>⚙︎ إعدادات</b>، واكتب عدد الوحدات، ثم عُد.
            <div className="text-xs mt-1.5">الطباعة معطّلة حتى يُضبط العدد، منعًا لإصدار مستند ناقص.</div>
          </div>
        )}

        <div className="border border-line rounded-xl overflow-hidden mb-3">
          <table className="w-full text-sm">
            <thead className="bg-paper2"><tr>
              <th className="p-2 text-right font-semibold">البند</th>
              <th className="p-2 text-right font-semibold w-28">شهريًّا</th>
              <th className="p-2 text-right font-semibold w-24">سنويًّا</th>
              <th className="w-8"></th>
            </tr></thead>
            <tbody>
              {items.map((it, n) => (
                <tr key={n} className="border-t border-line">
                  <td className="p-1.5">
                    <input className="fld text-xs" value={it.label}
                      onChange={(e) => setItem(n, { label: e.target.value })} placeholder="اسم البند" />
                  </td>
                  <td className="p-1.5">
                    <input className="fld text-xs" type="number" min={0} value={it.monthly || ""}
                      onChange={(e) => setItem(n, { monthly: Number(e.target.value) || 0 })} placeholder="0" />
                  </td>
                  <td className="p-1.5 tabular-nums text-muted text-xs">{sar((Number(it.monthly) || 0) * 12)}</td>
                  <td className="p-1.5">
                    <button type="button" className="text-late text-xs px-1" title="حذف البند"
                      onClick={() => setItems(items.filter((_, i) => i !== n))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          <button type="button" className="btn btn-ghost text-xs"
            onClick={() => setItems([...items, { label: "", monthly: 0 }])}>+ بند جديد</button>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">احتياطي الصيانة الرأسمالية</span>
            <input className="fld max-w-[70px] text-xs" type="number" min={0} max={50}
              value={reserve} onChange={(e) => setReserve(e.target.value)} />
            <span className="text-muted">%</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-center">
          <div className="bg-paper2 rounded-lg p-2.5">
            <div className="font-display font-bold text-deep tabular-nums">{sar(annualOps)}</div>
            <div className="text-[.7rem] text-muted mt-0.5">تشغيلي سنويًّا</div>
          </div>
          <div className="bg-paper2 rounded-lg p-2.5">
            <div className="font-display font-bold text-deep tabular-nums">{sar(reserveAmt)}</div>
            <div className="text-[.7rem] text-muted mt-0.5">احتياطي {rp}%</div>
          </div>
          <div className="bg-[#E6F4EC] rounded-lg p-2.5">
            <div className="font-display font-bold text-[#137a50] tabular-nums">{sar(total)}</div>
            <div className="text-[.7rem] text-muted mt-0.5">إجمالي الموازنة</div>
          </div>
          <div className={`rounded-lg p-2.5 ${gap > 0 ? "bg-[#FBE9E7]" : "bg-[#E6F4EC]"}`}>
            <div className={`font-display font-bold tabular-nums ${gap > 0 ? "text-late" : "text-[#137a50]"}`}>{sar(Math.abs(gap))}</div>
            <div className="text-[.7rem] text-muted mt-0.5">{gap > 0 ? "عجز متوقّع" : "فائض متوقّع"}</div>
          </div>
        </div>

        {units > 0 && (
          <div className="bg-[#FBF1DF] border border-[#EBD9AA] rounded-xl p-3 mb-4 text-sm text-[#8a5a11] leading-relaxed">
            الاشتراك المقترح: <b>{sar(perMonth)} ريال</b> شهريًّا لكل وحدة ({sar(units ? Math.round(total / units) : 0)} ريال سنويًّا).
            {currentFee > 0 && <> والاشتراك الحالي المعتمد <b>{sar(currentFee)}</b> ريال.</>}
            <div className="text-xs mt-1.5">يُحدَّد الاشتراك بقرار الجمعية العامة — هذا حساب استرشادي.</div>
          </div>
        )}

        <Field label="ملاحظات على الموازنة (اختياري)">
          <input className="fld" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: لا تشمل تجديد المصاعد" />
        </Field>

        <div className="flex gap-2 mt-5 flex-wrap">
          <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إغلاق</button>
          <button type="button" className="btn btn-primary flex-1 justify-center" onClick={() => onSave(payload)}>حفظ</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" disabled={units === 0}
            title={units === 0 ? "أدخل عدد الوحدات في إعدادات الجمعية أولًا" : undefined}
            onClick={() => onPrint(payload)}>طباعة الموازنة</button>
        </div>
      </div>
    </div>
  );
}

/** محضر الجمعية العمومية التأسيسية */
function MinutesModal({ assoc, onClose, onPrint }: {
  assoc: Association; onClose: () => void; onPrint: (d: any) => void;
}) {
  const units = Number(assoc.units) || (Array.isArray(assoc.owners) ? assoc.owners.length : 0);
  const [d, setD] = useState<any>({
    meeting_date: today(), mode: "حضوري", place: "", attendees: "",
    total_units: units || "", president: "", manager: "", fee: assoc.fee || "",
    due_day: "في الخامس من كل شهر", bank: "", year: new Date().getFullYear(), annual_budget: "",
  });
  const set = (k: string, v: any) => setD({ ...d, [k]: v });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">محضر الجمعية العمومية التأسيسية</h3>
        <p className="text-sm text-muted mb-4">{assoc.name} — املأ ما تعرفه، واترك الباقي فراغات تُملأ بخطّ اليد.</p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاريخ الاجتماع">
              <input className="fld" type="date" value={d.meeting_date} onChange={(e) => set("meeting_date", e.target.value)} />
            </Field>
            <Field label="طريقة الانعقاد">
              <select className="fld" value={d.mode} onChange={(e) => set("mode", e.target.value)}>
                <option value="حضوري">حضوري</option>
                <option value="إلكتروني">إلكتروني</option>
                <option value="حضوري وإلكتروني">حضوري وإلكتروني</option>
              </select>
            </Field>
          </div>
          <Field label="مكان الاجتماع">
            <input className="fld" value={d.place} onChange={(e) => set("place", e.target.value)} placeholder="مثال: مقر العقار — الدور الأرضي" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="عدد الحاضرين" hint="بعد انعقاد الاجتماع فقط">
              <input className="fld" type="number" min={0} max={Number(d.total_units) || undefined}
                value={d.attendees} placeholder="اتركه فارغًا قبل الاجتماع"
                onChange={(e) => {
                  const cap = Number(d.total_units) || 0;
                  const v = e.target.value === "" ? "" : String(Math.max(0, Math.min(Number(e.target.value) || 0, cap || Infinity)));
                  set("attendees", v);
                }} />
            </Field>
            <Field label="إجمالي الوحدات">
              <input className="fld" type="number" min={0} value={d.total_units} onChange={(e) => set("total_units", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="رئيس الجمعية">
              <input className="fld" value={d.president} onChange={(e) => set("president", e.target.value)} placeholder="الاسم" />
            </Field>
            <Field label="مدير العقار">
              <input className="fld" value={d.manager} onChange={(e) => set("manager", e.target.value)} placeholder="الاسم أو المكتب" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="اشتراك الوحدة (ريال)">
              <input className="fld" type="number" min={0} value={d.fee} onChange={(e) => set("fee", e.target.value)} />
            </Field>
            <Field label="موعد السداد">
              <input className="fld" value={d.due_day} onChange={(e) => set("due_day", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="إجمالي الموازنة المعتمدة (ريال)">
              <input className="fld" type="number" min={0} value={d.annual_budget} onChange={(e) => set("annual_budget", e.target.value)} placeholder="من نافذة الموازنة" />
            </Field>
            <Field label="البنك">
              <input className="fld" value={d.bank} onChange={(e) => set("bank", e.target.value)} placeholder="اسم البنك" />
            </Field>
          </div>
        </div>

        <p className="text-xs text-[#8a5a11] mt-4 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5 leading-relaxed">
          <b>لا تُثبت وقائع لم تقع.</b> اترك عدد الحاضرين واسمي الرئيس ومدير العقار فراغات إن لم يُعقد الاجتماع بعد —
          تُملأ بخطّ اليد أثناء الاجتماع أو تُدخل بعده. المحضر مستند يُرفع لجهة رسمية، وإثبات حضور لم يحصل يُعرّض مُصدِره للمساءلة.
          <br />
          ويُدرج جدول توقيعات بأسماء الملّاك المسجّلين عندك تلقائيًّا. وثيق لا يقدّم خدمات قانونية —
          راجع المحضر مع مختص مرخّص وطابقه مع النظام الأساسي قبل تقديمه رسميًّا.
        </p>

        <div className="flex gap-2 mt-5">
          <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" onClick={() => onPrint(d)}>إنشاء المحضر</button>
        </div>
      </div>
    </div>
  );
}

/** إحصاء داخل شريط المحفظة الداكن */
function PortfolioStat({ v, l, tone }: { v: string; l: string; tone?: "warn" }) {
  return (
    <div>
      <div className={`font-display font-bold text-lg leading-none ${tone === "warn" ? "text-[#F5A9A4]" : "text-[#EAF1EE]"}`}>{v}</div>
      <div className="text-[.7rem] text-[#9FB8B3] mt-1">{l}</div>
    </div>
  );
}

/** تعديل بيانات مالك — لم يكن ممكنًا قبل الآن */
function OwnerModal({ owner, onClose, onSubmit }: {
  owner: Owner; onClose: () => void; onSubmit: (d: any) => void;
}) {
  const [d, setD] = useState<any>({
    name: owner.name || "", unit: owner.unit || "",
    phone: owner.phone || "", months_late: owner.months_late || 0,
  });
  const ready = String(d.name || "").trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">تعديل بيانات المالك</h3>
        <p className="text-sm text-muted mb-4">{owner.unit ? `وحدة ${owner.unit}` : "—"}</p>

        <div className="space-y-3">
          <Field label="اسم المالك">
            <input className="fld" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم الوحدة">
              <input className="fld" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="101" />
            </Field>
            <Field label="الجوال">
              <input className="fld" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} placeholder="05xxxxxxxx" />
            </Field>
          </div>
          <Field label="الفترات المتأخرة">
            <input className="fld" type="number" min={0} value={d.months_late}
              onChange={(e) => setD({ ...d, months_late: e.target.value })} />
          </Field>
          <p className="text-xs text-muted leading-relaxed">
            تعديل الفترات المتأخرة يدويًّا للتصحيح فقط؛ الأفضل تسجيل السداد من زرّ ✔ أو ½ ليُحفظ في سجل المدفوعات.
          </p>
        </div>

        <div className="flex gap-2 mt-6">
          <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!ready}
            style={!ready ? { opacity: .5, cursor: "not-allowed" } : undefined}
            onClick={() => onSubmit(d)}>حفظ</button>
        </div>
        {!ready && <p className="text-xs text-late mt-3 text-center">اسم المالك مطلوب لتفعيل الحفظ.</p>}
      </div>
    </div>
  );
}

/** سجل المدفوعات — التاريخ والمبلغ والطريقة */
function HistoryModal({ data, onClose }: { data: { owner: Owner; rows: any[] }; onClose: () => void }) {
  const { owner, rows } = data;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-lg mb-1">سجل المدفوعات — {owner.name}</h3>
        <p className="text-sm text-muted mb-4">{owner.unit ? `وحدة ${owner.unit}` : "—"} · {rows.length} عملية · الإجمالي {sar(total)} ريال</p>
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
                <th className="p-2 text-right font-semibold">أشهر</th>
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
      </div>
    </div>
  );
}

/** عرض الخطاب مع النسخ والطباعة */
/** ════════════════════════════════════════════════════════════
 *  ملف التحصيل — سلّم تصعيد موثّق:
 *  ① تذكير واتساب  ② خطاب مطالبة  ③ إنذار نهائي — ثم جاهزية السند التنفيذي في المنصة
 *  كل خطوة تُوثَّق تلقائيًّا في سجل العمارة، وهذا التوثيق هو ما يبني
 *  «سجل المطالبات» داخل الملف — وهو أهم ما يُطلب عند الرفع.
 *  ════════════════════════════════════════════════════════════ */
const STAGE_META = [
  { label: "لم تُوثَّق مطالبة", cls: "bg-paper2 text-deep" },
  { label: "أُرسلت مطالبة", cls: "bg-[#FDF0DC] text-[#9A5B00]" },
  { label: "أُنذر نهائيًّا", cls: "bg-[#F7DAD7] text-[#8f2b26]" },
];

function CollectionsModal({ assoc, owners, only, fee, stageOf, logOf, dueOf, onClose, onRemind, onNotice, onFinal }: {
  assoc: Association;
  owners: Owner[];
  only?: Owner;
  fee: number;
  stageOf: (o: Owner) => 0 | 1 | 2;
  logOf: (o: Owner) => Note[];
  dueOf: (o: Owner) => number;
  onClose: () => void;
  onRemind: (o: Owner) => void;
  onNotice: (o: Owner) => void;
  onFinal: (o: Owner, feeApprovedOn?: string) => void;
}) {
  const [feeApprovedOn, setFeeApprovedOn] = useState("");
  const list = only ? [only] : owners;
  const missingFee = !(Number(fee) > 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-lg mb-1">ملف التحصيل — {assoc.name}</h3>
        <p className="text-sm text-muted mb-4">
          تصعيد متدرّج وموثّق: تذكير ← مطالبة ← إنذار نهائي. كل خطوة تُسجَّل بتاريخها في سجل العمارة.
        </p>

        {missingFee && (
          <div className="text-xs bg-[#FBE9E7] border border-[#F5C6C2] text-[#8f2b26] rounded-lg p-2.5 mb-4 leading-relaxed">
            قيمة الاشتراك غير محدَّدة في إعدادات الجمعية — ستظهر كل المبالغ أصفارًا. حدّدها أولًا من «⚙︎ إعدادات».
          </div>
        )}

        {/* جاهزية السند التنفيذي — شروط الخدمة الحكومية المجانية */}
        <div className="bg-paper border border-line rounded-xl p-4 mb-4">
          <div className="text-sm font-semibold mb-1.5">جاهزية السند التنفيذي</div>
          <p className="text-xs text-muted mb-3 leading-relaxed">
            «السند التنفيذي الإلكتروني» خدمة مجانية وفورية في منصة «ملاك» يقدّمها <b>مدير العقار</b>؛ تعرض المنصة قائمة المتعثّرين بنفسها
            ثم تُصدر النموذج المعتمد لاستكماله عبر «ناجز». لا يوجد ملف تُعدّه أنت. لكنها تشترط ثلاثة أمور:
          </p>
          <ul className="text-xs text-[#33413d] leading-relaxed space-y-1.5">
            <li>① <b>جمعية مفعّلة</b> — لها رئيس ومدير عقار ورسوم مقرّرة.</li>
            <li>② <b>فواتير متأخرة داخل المنصة</b> — أي أن الرسوم صُوّت عليها واعتُمدت وصدرت فواتيرها هناك. التحصيل خارج المنصة لا يُنشئ متأخرات لديها.</li>
            <li>③ <b>رقم موحّد 700</b> للجمعية — يُصدَر من «المزيد من الإجراءات ← إصدار الرقم الموحّد».</li>
          </ul>
          <p className="text-xs text-muted mt-3 leading-relaxed">
            ودور وثيق هنا ما لا تفعله المنصة: حساب الأرقام، ومتابعة المتأخرات، و<b>كتابة خطابات المطالبة والإنذار</b> وتوثيق تواريخها —
            وهي ما يفيدك في التسوية الودّية قبل بلوغ هذه المرحلة.
          </p>
          <div className="mt-3">
            <Field label="تاريخ قرار الجمعية العامة بتحديد الاشتراك" hint="يُذكر في الإنذار كسند للمطالبة — اختياري">
              <input type="date" className="fld w-full sm:w-64" value={feeApprovedOn} onChange={(e) => setFeeApprovedOn(e.target.value)} />
            </Field>
          </div>
        </div>

        {/* الملّاك المتأخرون */}
        <div className="space-y-3">
          {list.map((o) => {
            const stage = stageOf(o);
            const log = logOf(o);
            const meta = STAGE_META[stage];
            return (
              <div key={o.id} className="border border-line rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-semibold">{o.name}</span>
                  <span className="text-xs text-muted">الوحدة {o.unit || "—"}</span>
                  <span className={`text-xs font-semibold rounded-lg px-2 py-0.5 ${meta.cls}`}>{meta.label}</span>
                  <span className="text-sm font-bold text-late mr-auto">{sar(dueOf(o))} ريال · {o.months_late} فترة</span>
                </div>

                {log.length > 0 && (
                  <div className="text-xs text-muted mb-2.5 leading-relaxed">
                    المطالبات الموثّقة: {log.map((n) => n.note_date).join(" · ")}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="btn btn-wa text-xs" onClick={() => onRemind(o)}>💬 تذكير واتساب</button>
                  <button type="button" className={`btn text-xs ${stage === 0 ? "btn-gold" : "btn-ghost"}`} onClick={() => onNotice(o)}>📄 خطاب مطالبة</button>
                  <button type="button" className={`btn text-xs ${stage === 1 ? "btn-gold" : "btn-ghost"}`} onClick={() => onFinal(o, feeApprovedOn)}>⚠️ إنذار نهائي</button>

                </div>

                {stage < 2 && (
                  <div className="text-xs text-muted mt-2 leading-relaxed">
                    وثّق خطاب مطالبة ثم إنذارًا نهائيًّا — تواريخهما تُثبت جدّية المطالبة وتفيدك في أي تسوية لاحقة.
                  </div>
                )}
              </div>
            );
          })}
          {!list.length && <div className="text-center text-muted py-8 text-sm">لا يوجد ملّاك متأخرون.</div>}
        </div>

        <p className="text-xs text-muted mt-4 leading-relaxed">
          <b>تذكير نظامي:</b> الحد الأعلى للاشتراك السنوي وفق المادة السادسة/1 من النظام الأساسي هو 3% من القيمة السوقية أو الشرائية —
          أيّهما أعلى — للوحدة التي تتجاوز قيمتها 300,000 ريال، و7% لما قيمته 300,000 ريال فأقل.
        </p>
        <p className="text-xs text-[#8a5a11] mt-2 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5 leading-relaxed">
          <b>حدّ دورنا:</b> وثيق يكتب الخطابات ويحسب المبالغ ويوثّق التواريخ فقط. أمّا طلب السند التنفيذي في «ملاك»
          واستكماله عبر «ناجز» فيقوم به <b>مدير العقار</b> المرخّص نفسه داخل المنصة.
        </p>

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost flex-1 justify-center">إغلاق</button>
        </div>
      </div>
    </div>
  );
}

function DocModal({ doc, onClose }: { doc: { title: string; body: string; kind?: "notice" | "final" | "file" }; onClose: () => void }) {
  const kind = doc.kind || "notice";
  const banner = kind === "file"
    ? <>هذا <b>ملف إداري مُجهَّز من بيانات لوحتك</b> ليستخدمه مدير العقار. رفع طلب السند التنفيذي في منصة «ملاك» واعتماده من الهيئة العامة للعقار ثم استكماله عبر «ناجز» — إجراءات يقوم بها <b>مدير العقار</b> نفسه. وثيق لا يرفع نيابةً عنك ولا يمثّلك أمام أي جهة ولا يستلم أي مبالغ.</>
    : kind === "final"
      ? <>هذا <b>إنذار إداري</b> تصدره إدارة الجمعية، وليس إنذارًا قضائيًّا ذا حجية تنفيذية. المسار النظامي يمرّ عبر منصة «ملاك» ثم محكمة التنفيذ أو الجهة المختصة. راجع النص مع مختص مرخّص قبل أي استخدام رسمي.</>
      : <>هذا <b>خطاب تذكير إداري</b> تستخدمه إدارة الجمعية، وليس إنذارًا نظاميًّا ذا حجية. المسار النظامي للتحصيل يمرّ عبر منصة «ملاك» ثم محكمة التنفيذ أو الجهة المختصة. وثيق لا يقدّم خدمات قانونية ولا يستلم أي مبالغ — راجع النص مع مختص مرخّص قبل أي استخدام رسمي.</>;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-lg mb-1">{doc.title}</h3>
        <p className="text-xs text-[#8a5a11] mb-4 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5 leading-relaxed">
          {banner}
        </p>
        <pre className="whitespace-pre-wrap bg-paper border border-line rounded-xl p-4 text-sm leading-8 text-ink" style={{ fontFamily: "inherit" }}>{doc.body}</pre>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => navigator.clipboard?.writeText(doc.body)} className="btn btn-primary flex-1 justify-center">نسخ النص</button>
          <button type="button" onClick={() => openDoc('<!doctype html><html dir="rtl"><meta charset="utf-8"><body><pre style="font-family:sans-serif;white-space:pre-wrap;padding:24px;line-height:1.9">' + doc.body.replace(/</g, "&lt;") + "</pre></body></html>")} className="btn btn-ghost flex-1 justify-center">طباعة</button>
          <button type="button" onClick={onClose} className="btn text-muted">إغلاق</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-semibold mb-1">{label}
    {hint && <span className="font-normal text-muted text-xs"> — {hint}</span>}</span>{children}</label>;
}

/** ════════════════════════════════════════════════════════════
 *  حزمة الاجتماع السنوي — الأرقام التي تحتاجها جمعيتك:
 *  ① موازنة العام القادم  ② محضر الاجتماع السنوي  ③ إدخالها في المنصة
 *  ملاحظة مهمّة: إصدار شهادة الجمعية إجراء إلكتروني مباشر في «ملاك»
 *  ولا يتطلّب رفع مستندات — لكنه يشترط إصدار الرقم الموحّد 700 أولًا.
 *  ════════════════════════════════════════════════════════════ */
function RenewalModal({ assoc, annualBudget, onClose, onEditBudget, onPrintBudget, onPrintMinutes }: {
  assoc: Association; annualBudget: number | null; onClose: () => void;
  onEditBudget: () => void; onPrintBudget: () => void; onPrintMinutes: (d: any) => void;
}) {
  const units = Number(assoc.units) || (Array.isArray(assoc.owners) ? assoc.owners.length : 0);
  const nextYear = new Date().getFullYear() + 1;
  const [d, setD] = useState<any>({
    meeting_date: today(), mode: "حضوري", place: "",
    attendees: "", total_units: units || "",
    president: "", manager: "", fee: assoc.fee || "",
    year: nextYear, annual_budget: annualBudget ?? "",
    collected: "", spent: "", fund_balance: assoc.fund_balance ?? "", notes: "",
  });
  const set = (k: string, v: any) => setD({ ...d, [k]: v });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">🗂 حزمة الاجتماع السنوي</h3>
        <p className="text-sm text-muted mb-4">
          {assoc.name} — موازنة العام القادم ومحضر الاجتماع، ثم إدخال الأرقام في قرار الرسوم بالمنصة.
        </p>

        {/* الخطوة ١ — الموازنة */}
        <div className="border border-line rounded-xl p-4 mb-3 bg-paper">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-6 h-6 rounded-full bg-deep text-goldSoft grid place-items-center text-xs font-bold shrink-0">١</span>
            <b className="text-deep">موازنة عام {nextYear}</b>
            {annualBudget !== null
              ? <span className="text-xs font-semibold text-paid bg-[#E6F4EC] border border-[#B7DFC7] rounded-full px-2 py-0.5 mr-auto">محفوظة · {sar(annualBudget)} ريال</span>
              : <span className="text-xs font-semibold text-[#8a5a11] bg-[#FBF1DF] border border-[#EBD9AA] rounded-full px-2 py-0.5 mr-auto">لم تُنشأ بعد</span>}
          </div>
          <p className="text-xs text-muted mb-2.5">الموازنة التقديرية للتشغيل والصيانة مع احتياطي رأس المال — بنودها وأرقامها هي ما تُدخله في قرار رسوم الاشتراك بالمنصة.</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn btn-ghost text-xs" onClick={onEditBudget}>✎ {annualBudget !== null ? "تعديل الموازنة" : "إنشاء الموازنة"}</button>
            {annualBudget !== null && <button type="button" className="btn btn-primary text-xs" onClick={onPrintBudget}>🖨 طباعة الموازنة</button>}
          </div>
        </div>

        {/* الخطوة ٢ — محضر الاجتماع السنوي */}
        <div className="border border-line rounded-xl p-4 mb-3 bg-paper">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-6 h-6 rounded-full bg-deep text-goldSoft grid place-items-center text-xs font-bold shrink-0">٢</span>
            <b className="text-deep">محضر الاجتماع العمومي السنوي</b>
          </div>
          <p className="text-xs text-muted mb-3">املأ ما تعرفه، واترك الباقي فراغات تُملأ بخطّ اليد. يُدرج جدول توقيعات الملّاك المسجّلين تلقائيًّا.</p>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="تاريخ الاجتماع">
                <input className="fld" type="date" value={d.meeting_date} onChange={(e) => set("meeting_date", e.target.value)} />
              </Field>
              <Field label="طريقة الانعقاد">
                <select className="fld" value={d.mode} onChange={(e) => set("mode", e.target.value)}>
                  <option value="حضوري">حضوري</option>
                  <option value="إلكتروني">إلكتروني</option>
                  <option value="حضوري وإلكتروني">حضوري وإلكتروني</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="عدد الحاضرين">
                <input className="fld" type="number" min={0} value={d.attendees} onChange={(e) => set("attendees", e.target.value)} />
              </Field>
              <Field label="إجمالي الوحدات">
                <input className="fld" type="number" min={0} value={d.total_units} onChange={(e) => set("total_units", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="رئيس الجمعية">
                <input className="fld" value={d.president} onChange={(e) => set("president", e.target.value)} placeholder="الاسم" />
              </Field>
              <Field label="مدير العقار">
                <input className="fld" value={d.manager} onChange={(e) => set("manager", e.target.value)} placeholder="الاسم أو المكتب" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`اشتراك الوحدة لعام ${nextYear} (ريال)`}>
                <input className="fld" type="number" min={0} value={d.fee} onChange={(e) => set("fee", e.target.value)} />
              </Field>
              <Field label="إجمالي الموازنة المعتمدة (ريال)">
                <input className="fld" type="number" min={0} value={d.annual_budget} onChange={(e) => set("annual_budget", e.target.value)} placeholder="يتعبّأ من الموازنة المحفوظة" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="المحصَّل خلال العام (ريال)">
                <input className="fld" type="number" min={0} value={d.collected} onChange={(e) => set("collected", e.target.value)} placeholder="اختياري" />
              </Field>
              <Field label="المصروف خلال العام (ريال)">
                <input className="fld" type="number" min={0} value={d.spent} onChange={(e) => set("spent", e.target.value)} placeholder="اختياري" />
              </Field>
            </div>
            <Field label="بنود إضافية أُقرّت في الاجتماع">
              <input className="fld" value={d.notes} onChange={(e) => set("notes", e.target.value)} placeholder="اختياري" />
            </Field>
          </div>

          <button type="button" className="btn btn-gold text-sm w-full justify-center mt-3" onClick={() => onPrintMinutes(d)}>
            🖨 إنشاء محضر الاجتماع السنوي
          </button>
        </div>

        {/* الخطوة ٣ — الرفع في منصة ملاك */}
        <div className="border border-line rounded-xl p-4 bg-paper">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-6 h-6 rounded-full bg-deep text-goldSoft grid place-items-center text-xs font-bold shrink-0">٣</span>
            <b className="text-deep">ماذا تفعل بعدها في منصة ملاك</b>
          </div>
          <ol className="text-xs text-[#33413d] leading-relaxed pr-4 list-decimal space-y-1">
            <li>ادخل «ملاك» عبر النفاذ الوطني بحساب رئيس الجمعية أو مدير العقار.</li>
            <li>من <b>قرارات الجمعية</b> أنشئ قرار <b>«إعادة تحديد رسوم الاشتراك»</b>، وأدخل البنود والمبالغ من موازنة عام {nextYear}، وحدّد موعد استحقاق إصدار الفواتير، ثم اطرحه للتصويت.</li>
            <li>إن لم يكن للجمعية <b>رقم موحّد 700</b> فأصدره من «المزيد من الإجراءات» — وهو شرط إصدار شهادة الجمعية.</li>
            <li>الشهادة تُصدَر من «المزيد من الإجراءات ← إصدار شهادة الجمعية ← تأكيد» — بلا رفع مستندات. حدّث تاريخ انتهائها في إعدادات الجمعية هنا.</li>
          </ol>
        </div>

        <p className="text-xs text-[#8a5a11] mt-3 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5 leading-relaxed">
          المستندان استرشاديان للسجل الداخلي للجمعية — طابقهما مع النظام الأساسي المعتمد قبل أي اعتماد رسمي.
          إجراءات منصة «ملاك» مجانية وتقوم بها بنفسك، ووثيق لا يقدّم خدمات قانونية ولا يمثّل الجمعية أمام أي جهة.
        </p>

        <div className="flex gap-2 mt-4">
          <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}

/** لصق قائمة ملّاك — سطر لكل مالك: «الاسم، الوحدة، الجوال» بأي فاصل شائع */
function BulkOwnersModal({ onClose, onSubmit }: {
  onClose: () => void; onSubmit: (rows: { name: string; unit: string | null; phone: string | null }[]) => void;
}) {
  const [text, setText] = useState("");

  /** يحلّل كل سطر: يقبل الفاصلة العربية/الإنجليزية أو Tab أو الشرطة */
  const rows = text.split(/\n+/).map((line) => {
    const parts = line.split(/[،,\t]| - /).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    // يلتقط الجوال (أرقام 9+) والوحدة (رقم/رمز قصير) أينما وُضعا
    let name = "", unit: string | null = null, phone: string | null = null;
    for (const p of parts) {
      const digits = p.replace(/[^0-9+]/g, "");
      if (!phone && digits.length >= 9 && digits.length >= p.length - 3) phone = p;
      else if (!unit && p.length <= 6 && /[0-9]/.test(p)) unit = p;
      else name = name ? `${name} ${p}` : p;
    }
    return name ? { name, unit, phone } : null;
  }).filter(Boolean) as { name: string; unit: string | null; phone: string | null }[];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">📋 إضافة ملّاك دفعة واحدة</h3>
        <p className="text-sm text-muted mb-3">
          الصق قائمتك — سطر لكل مالك بصيغة: <b>الاسم، الوحدة، الجوال</b> (الوحدة والجوال اختياريان).
        </p>
        <textarea className="fld min-h-[180px] font-mono text-sm leading-relaxed" dir="rtl"
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"محمد العتيبي، 101، 05XXXXXXXX\nسارة القحطاني، 102\nخالد الشمري"} />

        {rows.length > 0 && (
          <div className="bg-paper2 border border-line rounded-xl p-3 mt-3 text-xs max-h-[160px] overflow-auto">
            <div className="font-semibold text-deep mb-1.5">معاينة — سيُضاف {rows.length} مالكًا:</div>
            {rows.slice(0, 30).map((r, i) => (
              <div key={i} className="flex gap-2 py-0.5 border-b border-dashed border-line last:border-0">
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-muted">{r.unit ? `وحدة ${r.unit}` : "—"}</span>
                <span className="text-muted tabular-nums">{r.phone || "—"}</span>
              </div>
            ))}
            {rows.length > 30 && <div className="text-muted pt-1">… و{rows.length - 30} آخرون</div>}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!rows.length}
            onClick={() => onSubmit(rows)}>إضافة {rows.length || ""} مالك</button>
        </div>
      </div>
    </div>
  );
}

/** تذكير جماعي — يفتح واتساب لكل متأخر واحدًا تلو الآخر مع تتبّع من أُرسل له */
function RemindAllOwnersModal({ owners, fee, linkOf, onClose }: {
  owners: Owner[]; fee: number; linkOf: (o: Owner) => string; onClose: () => void;
}) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const sentCount = Object.values(sent).filter(Boolean).length;
  const withPhone = owners.filter((o) => o.phone);
  const noPhone = owners.length - withPhone.length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">💬 تذكير جماعي بالسداد</h3>
        <p className="text-sm text-muted mb-4">
          واتساب لا يسمح بالإرسال الجماعي الآلي — لكن كل زر هنا يفتح محادثة برسالة جاهزة بتفاصيل ذلك المالك.
          أرسلها بضغطة، وارجع للتالي. أُرسل {sentCount} من {withPhone.length}.
        </p>

        <div className="flex flex-col gap-2">
          {withPhone.map((o) => {
            const owed = Math.max(0, o.months_late * fee - (Number(o.partial_amount) || 0));
            return (
              <div key={o.id} className={`flex items-center gap-3 rounded-xl border p-3 ${sent[o.id] ? "border-[#B7DFC7] bg-[#F2FAF5]" : "border-line bg-paper"}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate text-sm">{o.name}</div>
                  <div className="text-xs text-muted">{o.unit ? `وحدة ${o.unit} · ` : ""}{o.months_late} شهر · {sar(owed)} ريال</div>
                </div>
                {sent[o.id] && <span className="text-xs font-bold text-paid">✓ أُرسل</span>}
                <a href={linkOf(o)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs"
                  onClick={() => setSent((s) => ({ ...s, [o.id]: true }))}>فتح واتساب</a>
              </div>
            );
          })}
          {!withPhone.length && <div className="text-center text-muted text-sm py-6">لا يوجد متأخرون لديهم أرقام جوال مسجّلة.</div>}
        </div>

        {noPhone > 0 && (
          <p className="text-xs text-[#8a5a11] mt-3 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5">
            {noPhone} مالك متأخر بلا رقم جوال — أضف أرقامهم من «تعديل البيانات» ليظهروا هنا.
          </p>
        )}

        <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
      </div>
    </div>
  );
}
