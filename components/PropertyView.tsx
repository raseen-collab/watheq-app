"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-client";
import { officeId, getOffice, ROLE_LABEL, OWNER_PERMS } from "@/lib/office";
import { arDate } from "@/lib/documents";
import { hijriShort, hijriText, parseHijriInput } from "@/lib/hijri";
import { sar, waLink, today, WATHEQ_WA, openExternal } from "@/lib/utils";
import { contractState, buildSchedule, FREQUENCIES, freqLabel, freqShort, derivedEndDate, renewContract, needsRenewal, applyPayment, splitVat, isCommercial, isVacant, settleDeposit, unitVatApplies,
  vacancyDays, TURNOVER_CHECKLIST, type Frequency } from "@/lib/contracts";
import { PROPERTY_TYPES, typeLabel, unitLabel, typeIcon } from "@/lib/domain";
import { statementHTML, invoiceHTML, propertyStatementHTML, moveOutSettlementHTML, quotationHTML, ownerReportHTML, DEFAULT_CHARGES, openDoc, type ChargeRow, type OwnerReportPayment } from "@/lib/documents";
import { alertCount, type ComplianceItem } from "@/lib/compliance";
import ComplianceModal from "@/components/ComplianceModal";
import OwnerStatementModal from "@/components/OwnerStatementModal";
import ActivityLog from "@/components/ActivityLog";
import StatusLegend from "@/components/StatusLegend";
import PropertyStatementModal, { type StatementPeriod } from "@/components/PropertyStatementModal";
import DemoGuide from "@/components/DemoGuide";
import ExpensesModal from "@/components/ExpensesModal";
import OwnerLinkModal from "@/components/OwnerLinkModal";
import type { ExpenseRow } from "@/lib/expenses";
import DateField from "@/components/DateField";

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
  elec_account?: string | null; water_account?: string | null;
  contract_no?: string | null; calendar?: string | null; first_due?: string | null; vat_mode?: string | null;
  carried_debt?: number | null; carried_debt_note?: string | null;
  unit_type?: string | null; rooms?: number | null; baths?: number | null; acs?: number | null;
  meter_water_in?: string | null; meter_water_out?: string | null;
  turnover_checklist?: { label: string; done?: boolean; note?: string | null }[] | null;
};
/** ملاحظة السجل صارت مهمة قابلة للمتابعة: موعد وحالة ونوع */
type Note = {
  id: string; note_date: string; text: string;
  due_date?: string | null; done_at?: string | null; kind?: string | null; unit?: string | null;
};

/** أنواع المهام — للفرز وللونها في السجل */
const NOTE_KINDS: Record<string, { label: string; icon: string }> = {
  maintenance: { label: "صيانة", icon: "🔧" },
  renewal:     { label: "تجديد", icon: "🔁" },
  government:  { label: "حكومي", icon: "🏛️" },
  financial:   { label: "مالي", icon: "💰" },
  other:       { label: "أخرى", icon: "📌" },
};
type Property = {
  id: string; name: string; address: string | null; city: string | null; manager: string | null;
  property_type: string | null; collected: number;
  grace_days?: number | null; soon_days?: number | null; imminent_days?: number | null; expiring_days?: number | null; usage?: string | null;
  vat_enabled?: boolean | null; vat_rate?: number | null; vat_inclusive?: boolean | null;
  mgmt_fee_pct?: number | null;
  owner_name?: string | null;
  tenants: Tenant[]; property_notes: Note[];
};

/** حالة الصف المعروضة (تشمل «في التنفيذ») */
type RowKey = "vacant" | "litigation" | "incomplete" | "late" | "partial" | "due" | "soon" | "expiring" | "ok";
type Row = { t: Tenant; st: ReturnType<typeof contractState>; key: RowKey };

const ROW_META: Record<RowKey, { label: string; dot: string; cls: string }> = {
  vacant:     { label: "شاغرة",        dot: "bg-[#94A3B8]", cls: "bg-[#F1F5F9] text-[#475569]" },
  litigation: { label: "في التنفيذ",  dot: "bg-[#64748B]", cls: "bg-[#EEF1F4] text-[#475569]" },
  late:       { label: "متأخر",        dot: "bg-late",      cls: "bg-[#FBE9E7] text-[#a5322c]" },
  partial:    { label: "سداد جزئي",    dot: "bg-[#EA8C00]", cls: "bg-[#FDF0DC] text-[#9A5B00]" },
  incomplete: { label: "بيانات ناقصة",  dot: "bg-[#7C3AED]", cls: "bg-[#F1EBFC] text-[#5B21B6]" },
  due:        { label: "مستحق",        dot: "bg-[#D97706]", cls: "bg-[#FDECD2] text-[#9A4B00]" },
  soon:       { label: "قريب",         dot: "bg-gold",      cls: "bg-[#FBF1DF] text-[#8a5a11]" },
  expiring:   { label: "ينتهي قريبًا", dot: "bg-[#DC2626]", cls: "bg-[#FEE2E2] text-[#991B1B]" },
  ok:         { label: "منتظم",        dot: "bg-paid",      cls: "bg-[#E6F4EC] text-[#137a50]" },
};

function rowKey(t: Tenant, st: ReturnType<typeof contractState>): RowKey {
  if (isVacant(t)) return "vacant";
  /* وحدة مؤجّرة بلا تاريخ بداية كانت تظهر «منتظم» خضراء — فيمرّ عليها المكتب
     مطمئنًّا وهي بلا استحقاقات إطلاقًا. تُعرَض الآن كنقص يستدعي إكمالًا. */
  if (st.incomplete) return "incomplete";
  if (t.litigation) return "litigation";
  if (st.status === "late") return st.hasPartial ? "partial" : "late";
  if (st.status === "soon") return st.soonTier === "near" ? "soon" : "due";
  if (st.expiringSoon) return "expiring";
  return "ok";
}

const UNIT_TYPES: Record<string, string> = {
  apartment: "شقة", annex: "شقة ملحق", studio: "استديو", room: "غرفة", shop: "محل", office: "مكتب", warehouse: "مستودع", land: "أرض", villa: "فيلا", other: "أخرى",
};
const PROPERTY_USAGE: Record<string, string> = { families: "سكني — عوائل", singles: "سكني — عزّاب", mixed: "سكني تجاري — عزّاب أو عوائل", commercial: "تجاري" };

/** جمع عربي صحيح: 1 وحدة · 2 وحدتان · 3–10 وحدات · 11+ وحدة */
function plural(n: number, one: string, two: string, few: string, many = one): string {
  const x = Math.abs(Math.round(n));
  if (x === 1) return `${one}`;
  if (x === 2) return `${two}`;
  if (x >= 3 && x <= 10) return `${x} ${few}`;
  return `${x} ${many}`;
}

const URGENCY: Record<RowKey, number> = { incomplete: 0, late: 1, partial: 2, due: 3, soon: 4, expiring: 5, litigation: 6, vacant: 7, ok: 8 };

export default function PropertyView({ initial, orgName, issuer, compliance, dueSoonDays, dueImminentDays, expiringDays, db, demo = false }: {
  initial: Property[]; orgName: string; issuer?: any; compliance?: ComplianceItem[];
  dueSoonDays?: number | null; dueImminentDays?: number | null; expiringDays?: number | null;
  /** عميل بديل — صفحة التجربة العامة تمرّر قاعدة في الذاكرة بلا خادم */
  db?: any;
  /** وضع التجربة قبل التسجيل: لا حفظ دائم، وبعض المسارات تُستبدل بدعوة للتسجيل */
  demo?: boolean;
}) {
  const officeExpiring = Math.max(1, Math.min(180, Number(expiringDays) || 60));
  // نوافذ الحالة: افتراضي المكتب، وكل عقار يستطيع تجاوزه من إعداداته
  const officeSoon = Math.max(1, Math.min(60, Number(dueSoonDays) || 10));
  const officeImminent = Math.max(1, Math.min(60, Number(dueImminentDays) || 5));
  const windowsOf = (p?: { soon_days?: number | null; imminent_days?: number | null; expiring_days?: number | null } | null) => ({
    soonDays: Number(p?.soon_days) || officeSoon,
    imminentDays: Number(p?.imminent_days) || officeImminent,
    expiringDays: Number(p?.expiring_days) || officeExpiring,
  });
  const supabase: any = useMemo(() => db || createClient(), [db]);
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
  // وصول مباشر من صفحة النظرة العامة: ?p=<معرّف العقار>&q=<نص بحث>
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const pid = sp.get("p"); const qq = sp.get("q");
      if (pid && initial.some((x) => x.id === pid)) setActiveId(pid);
      if (qq) setQ(qq);
    } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [modal, setModal] = useState<null | { kind: "newProp" | "editProp" | "tenant"; id?: string }>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  // ⚖️ التزامات المكتب: تُدار محليًّا وتُزامَن مع بيانات السيرفر عند كل refresh
  const [comp, setComp] = useState<ComplianceItem[]>(compliance || []);
  useEffect(() => { setComp(compliance || []); }, [compliance]);
  const [compOpen, setCompOpen] = useState(false);
  const [ownerStmtOpen, setOwnerStmtOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [chatTenant, setChatTenant] = useState<Tenant | null>(null);
  /* حارس النقر المزدوج: على شبكة جوال بطيئة يضغط المحصّل «✔» مرتين قبل أن
     يرد الخادم، فتُسجَّل دفعتان — مال يُضاف للمستأجر بلا سبب. مجموعة
     العمليات الجارية تمنع تكرار العملية نفسها على الوحدة نفسها. */
  const busyRef = useRef<Set<string>>(new Set());
  const [busyTick, setBusyTick] = useState(0);
  const isBusy = (id: string) => busyRef.current.has(id);
  async function once<T>(id: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current.has(id)) return undefined;
    busyRef.current.add(id); setBusyTick((n) => n + 1);
    try { return await fn(); }
    finally { busyRef.current.delete(id); setBusyTick((n) => n + 1); }
  }
  /* عدد رسائل الفريق لكل وحدة — تظهر شارة على الصف فيعرف الجميع أن هناك نقاشًا */
  const [msgCount, setMsgCount] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    supabase.from("office_messages").select("tenant_id").not("tenant_id", "is", null).limit(2000)
      .then(({ data }: any) => {
        if (!alive) return;
        const m: Record<string, number> = {};
        (data || []).forEach((x: any) => { if (x.tenant_id) m[x.tenant_id] = (m[x.tenant_id] || 0) + 1; });
        setMsgCount(m);
      });
    return () => { alive = false; };
  }, [supabase, items]);
  const chatLookup = useMemo(() => {
    const props: Record<string, string> = {}; const tenants: Record<string, string> = {};
    items.forEach((p) => { props[p.id] = p.name; (p.tenants || []).forEach((t) => { tenants[t.id] = `${unitLabel(p.property_type)} ${t.unit || "—"} — ${t.name}`; }); });
    return { props, tenants };
  }, [items]);
  const [incPeriod, setIncPeriod] = useState<"year" | "12m" | "month">("year");
  const [collectedInPeriod, setCollectedInPeriod] = useState<number | null>(null);
  /* الدخل الشهري في البطاقة = ما قُبض فعلًا هذا الشهر (طلب مكتب تميز)، والمتوقع بجانبه */
  const [collectedThisMonth, setCollectedThisMonth] = useState<number | null>(null);
  /**
   * مفتاح إعادة الجلب: كان الاعتماد على «items» نفسها — وهي مصفوفة تتغيّر
   * هويتها مع كل رسم، فيتكرّر الاستعلام مرتين وثلاثًا في كل تنقّل (ظهر في
   * سجل Sentry). الرقم المجمَّع يتغيّر عند تسجيل دفعة فعلًا لا قبلها،
   * فتُجلب الأرقام مرة واحدة ويخفّ الحمل على القاعدة إلى النصف.
   */
  const paidKey = useMemo(
    () => items.reduce((a, p) => a + (Number(p.collected) || 0)
      + (p.tenants || []).reduce((b, t) => b + (Number(t.paid_periods) || 0), 0), 0),
    [items],
  );
  useEffect(() => {
    if (!activeId) return;
    const now = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
    const from = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-01`;
    const to = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    let alive = true;
    supabase.from("payments").select("amount").eq("property_id", activeId).gte("paid_on", from).lte("paid_on", to).limit(5000)
      .then(({ data }: any) => { if (alive) setCollectedThisMonth((data || []).reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0)); });
    return () => { alive = false; };
  }, [activeId, paidKey, supabase]);
  useEffect(() => {
    if (!activeId) return;
    const now = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
    const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    const from = incPeriod === "year" ? `${now.getFullYear()}-01-01`
      : incPeriod === "month" ? `${now.getFullYear()}-${p2(now.getMonth() + 1)}-01`
      : iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1));
    let alive = true;
    supabase.from("payments").select("amount").eq("property_id", activeId).gte("paid_on", from).lte("paid_on", iso(now)).limit(5000)
      .then(({ data }: any) => { if (alive) setCollectedInPeriod((data || []).reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0)); });
    return () => { alive = false; };
  }, [activeId, incPeriod, paidKey, supabase]);
  /**
   * عرض الوحدات: بطاقات (الجوال دائمًا) أو جدول (الكمبيوتر). الجدول يعرض
   * 25 وحدة في شاشة بدل 5، والعين تمسح عمود الحالة في ثانية — وهو ما
   * يحتاجه مكتب بمئات الوحدات. الاختيار يُحفظ في المتصفح. الترقيم 50/صفحة
   * حتى لا يثقل عقار بـ400 وحدة الصفحة.
   */
  const [view, setView] = useState<"cards" | "table">("cards");
  const [tSort, setTSort] = useState<"urgent" | "due" | "amount" | "unit" | "name">("urgent");
  const [tPage, setTPage] = useState(0);
  /* البطاقات كانت تُرسم كلها: 500 وحدة = 500 عنصر في الصفحة فيثقل الجوال.
     نعرض دفعة ونزيد بالطلب — الجدول مرقَّم أصلًا بـ50. */
  const [cardsShown, setCardsShown] = useState(60);
  /* كثافة الجدول: «مضغوط» يعرض نحو 40% صفوفًا أكثر في الشاشة نفسها —
     فرق محسوس مع مئات الوحدات. الاختيار يُحفظ في المتصفح. */
  const [dense, setDense] = useState(false);
  const [propQ, setPropQ] = useState("");
  useEffect(() => { try { setDense(localStorage.getItem("watheq.units.dense") === "1"); } catch { /* */ } }, []);
  const setDensity = (v: boolean) => { setDense(v); try { localStorage.setItem("watheq.units.dense", v ? "1" : "0"); } catch { /* */ } };
  const cellY = dense ? "py-1" : "py-2";
  const PAGE = 50;
  useEffect(() => {
    try {
      const saved = localStorage.getItem("watheq.units.view");
      const wide = window.matchMedia("(min-width: 1024px)").matches;
      setView(saved === "table" || saved === "cards" ? (saved as any) : wide ? "table" : "cards");
    } catch { /* */ }
  }, []);
  function pickView(v: "cards" | "table") { setView(v); try { localStorage.setItem("watheq.units.view", v); } catch { /* */ } }
  /**
   * دور المستخدم في هذا المكتب. القاعدة تمنع ما لا يحق له (v9) — لكن عرض
   * أزرار سترفضها القاعدة تجربة سيئة، وإظهار أرقام المكتب (أتعاب الإدارة،
   * صافي المالك، روابط الملّاك) لمحصّلٍ ليس من شأنه. نخفيها عرضًا،
   * والحماية الحقيقية تبقى في القاعدة لا هنا.
   */
  const [role, setRole] = useState<string | null>(null);   // null = المالك نفسه
  const [perms, setPerms] = useState<Record<string, boolean>>(OWNER_PERMS);
  useEffect(() => { getOffice(supabase).then((o) => {
    setRole(o?.isOwner ? null : o?.role || null);
    setPerms(o?.isOwner === false ? (o.perms || {}) : OWNER_PERMS);
  }); }, [supabase]);
  const may = (k: string) => perms[k] !== false;           // صلاحية دقيقة
  const isManager = role === null || role === "manager";   // المالك أو المدير
  const canCollect = may("record_payments");
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
  useEffect(() => { setTPage(0); }, [filter, q, tSort, activeId]);
  useEffect(() => { setCardsShown(60); }, [filter, q, activeId]);
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
    const g = { graceDays: Number(prop.grace_days) || 0, ...windowsOf(prop) };
    const list = Array.isArray(prop.tenants) ? prop.tenants : [];
    return list.map((t) => { const st = contractState(t, g); return { t, st, key: rowKey(t, st) }; });
  }, [active]);

  // الصفوف المعروضة: بحث ← تصفية ← فرز
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = allRowsForFilter.filter((r) => {
      if (filter !== "all" && r.key !== filter && !(filter === "soon" && r.key === "due")) return false;
      if (!needle) return true;
      // نفس حقول بحث «النظرة العامة» — لا يجد المستأجر في صفحة ويعجز في أخرى
      return [r.t.name, r.t.unit, r.t.phone, r.t.contract_no, r.t.national_id, r.t.elec_account, r.t.water_account].filter(Boolean)
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

  /**
   * تسجيل مبلغ مستلم — عملية ذرّية واحدة في القاعدة (schema-v12):
   * قفل صف المستأجر، تحقق الصلاحية، تحديث العدّاد والمحصَّل وسطر السجل
   * معًا أو لا شيء. لا حساب في المتصفح ولا كتابات متفرقة — فلا سباق
   * بين موظفين ولا رفض صامت للمحصّل. القيم المعروضة تأتي من القاعدة.
   */
  async function recordPayment(t: Tenant, amount: number, method = "transfer", note?: string, paidOn?: string, reference?: string) {
    const amt = Math.max(0, Number(amount) || 0);
    if (!amt || !active) return;
    return once(`pay:${t.id}`, async () => {
    const { data, error } = await supabase.rpc("watheq_record_payment", {
      p_tenant: t.id, p_amount: amt, p_method: method, p_note: note || null,
      p_paid_on: paidOn || today(), p_reference: reference || null,
    });
    if (error) {
      const m = String(error.message || "");
      return notify("err", /not authorized/.test(m) ? "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."
        : /does not exist|function/.test(m) ? "شغّل schema-v12 في قاعدة البيانات أولًا." : m);
    }
    const r = data as { paid_periods: number; partial_amount: number; completed: number };
    setItems(items.map((p) => p.id === active.id ? {
      ...p,
      collected: (p.collected || 0) + amt,
      tenants: p.tenants.map((x) => (x.id === t.id ? { ...x, paid_periods: r.paid_periods, partial_amount: r.partial_amount } : x)),
    } : p));
    notify("ok", r.completed > 0
      ? `سُجّل ${sar(amt)} ريال — اكتملت ${r.completed} دفعة`
      : `سُجّل ${sar(amt)} ريال كسداد جزئي`);
    });
  }

  /** التراجع عن آخر دفعة — ذرّي في القاعدة، للمدير فقط، بصف سالب في السجل */
  async function undoPayment(t: Tenant) {
    if (!active) return;
    if (isBusy(`pay:${t.id}`) || isBusy(`undo:${t.id}`)) return;
    return once(`undo:${t.id}`, async () => {
    const amt = Number(t.rent_amount) || 0;
    if (!confirm(`التراجع عن آخر دفعة مسجّلة؟\n\n${t.name} — ${ul} ${t.unit || "—"} — ${active.name}\nسيُخصم ${sar(amt)} ريال من المحصَّل ويُسجَّل التراجع باسمك في سجل العمليات.`)) return;
    const { data, error } = await supabase.rpc("watheq_undo_payment", { p_tenant: t.id });
    if (error) {
      const m = String(error.message || "");
      return notify("err", /not authorized/.test(m) ? "التراجع عن الدفعات للمدير أو صاحب المكتب." : m);
    }
    const r = data as { paid_periods: number; reversed: number };
    setItems(items.map((p) => p.id === active.id ? {
      ...p,
      collected: (p.collected || 0) - (r.reversed || amt),
      tenants: p.tenants.map((x) => (x.id === t.id ? { ...x, paid_periods: r.paid_periods } : x)),
    } : p));
    notify("ok", `تم التراجع — خُصم ${sar(r.reversed || amt)} ريال وسُجّل في سجل العمليات`);
    });
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
    /* الملاحظة توثيق لا شرط: إن رفضتها الصلاحيات نُكمل ونُعلم بلا إفشال العملية */
    const noteRes = await supabase.from("property_notes").insert({
      property_id: active.id, note_date: today(),
      text: `إخلاء ${unitLabel(active.property_type)} ${t.unit || "—"} — ${t.name} بتاريخ ${patch.move_out_date}` +
            (patch.deposit_amount ? ` · تأمين ${sar(patch.deposit_amount)} ريال` : "") +
            (patch.deposit_deductions ? ` · خصومات ${sar(patch.deposit_deductions)} ريال` : ""),
    });
    setTurnover(null);
    notify("ok", noteRes.error ? "سُجّل الإخلاء — الوحدة صارت شاغرة. (تعذّر كتابة الملاحظة في السجل)" : "سُجّل الإخلاء — الوحدة صارت شاغرة.");
    router.refresh();
  }

  /** إعادة التأجير: تُفتح نافذة الوحدة ببيانات جديدة */
  function reLet(t: Tenant) {
    /* الوحدة المُخلاة يُعاد استعمال صفّها للمستأجر الجديد — فكان دين السابق
       يختفي بلا أثر. ننبّه ونرحّله ليبقى مطالَبًا به. */
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0, ...windowsOf(active) });
    const debt = (st.legacyArrears || 0) + (Number(t.carried_debt) || 0);
    if (debt > 0) {
      const carry = confirm(`على المستأجر السابق ${t.name} دين ${sar(debt)} ريال.\n\nموافق = يُرحَّل كدين على الوحدة ويبقى ظاهرًا للمتابعة\nإلغاء = سُوّي بالكامل ولا يُرحَّل`);
      setModal({ kind: "tenant", id: t.id, preset: { carried_debt: carry ? Math.round(debt * 100) / 100 : 0, carried_debt_note: carry ? `دين ${t.name} قبل الإخلاء` : null } } as any);
      notify("ok", carry ? `أدخل بيانات المستأجر الجديد — ودين ${sar(debt)} ريال مرحَّل على الوحدة.` : "أدخل بيانات المستأجر الجديد.");
      return;
    }
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
    /* أول عقار حقيقي بينما التجريبي قائم: نسأل ونحذف — الخلط بين الاثنين
       أخطر ما في الفكرة، ولا نتركه لذاكرة المستخدم. */
    if (!id && hasDemo && confirm("تضيف عقارك الحقيقي الأول — نحذف البيانات التجريبية الآن؟\n\nموافق = حذف التجريبي والبدء نظيفًا\nإلغاء = إبقاؤه مؤقتًا")) {
      await clearDemo(true);
    }
    const payload = {
      name: d.name, address: d.address || null, city: d.city || null,
      manager: d.manager || orgName || null, property_type: d.property_type || "residential",
      grace_days: Math.max(0, Math.min(30, Number(d.grace_days) || 0)),
      usage: d.usage || null,
      expiring_days: d.expiring_days ? Math.max(1, Math.min(180, Number(d.expiring_days))) : null,
      soon_days: d.soon_days ? Math.max(1, Math.min(60, Number(d.soon_days))) : null,
      imminent_days: d.imminent_days ? Math.max(1, Math.min(60, Number(d.imminent_days))) : null,
      vat_enabled: !!d.vat_enabled,
      vat_rate: Number(d.vat_rate) || 15,
      vat_inclusive: d.vat_inclusive !== false,
      // نسبة أتعاب الإدارة: تُخصم من المحصَّل في تقرير المالك (فارغة = لا أتعاب)
      mgmt_fee_pct: Number(d.mgmt_fee_pct) > 0 && Number(d.mgmt_fee_pct) <= 100 ? Number(d.mgmt_fee_pct) : null,
      // اسم المالك يجمع عقاراته في كشف واحد (schema-v10) — يُقصّ حتى لا تتشتت الأسماء بمسافات
      owner_name: (d.owner_name || "").trim() || null,
    };
    if (id) {
      const { data: _u1, error } = await supabase.from("properties").update(payload).eq("id", id).select("id");
      if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
      if (!_u1 || _u1.length === 0) return notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.");
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
    if (!active) return;
    /**
     * الحذف يمسح الوحدات والدفعات والمصروفات معه (cascade في القاعدة).
     * مع عقار فيه 100 وحدة، سؤال «حذف العقار وكل وحداته؟» لا يكفي —
     * نسمّي ما سيضيع بالأرقام ونطلب كتابة اسم العقار حرفيًّا.
     */
    const n = active.tenants.length;
    const warn = `⚠️ حذف نهائي لا رجعة فيه\n\nالعقار: ${active.name}\nسيُحذف معه: ${n} ${n === 1 ? ul : ul + " (وكل عقودها)"}, وكل الدفعات والمصروفات والملاحظات المرتبطة به.\n\nإن كنت تريد نسخة، صدّرها أولًا من الإعدادات.\n\nاكتب اسم العقار للتأكيد:`;
    const typed = prompt(warn);
    if (typed === null) return;
    if (typed.trim() !== active.name.trim()) return notify("err", "الاسم غير مطابق — أُلغي الحذف.");
    const { data: _del, error } = await supabase.from("properties").delete().eq("id", active.id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    const rest = items.filter((p) => p.id !== active.id);
    setItems(rest); setActiveId(rest[0]?.id || null); setModal(null);
  }

  async function saveTenant(d: any, id?: string) {
    if (!active) return;
    setSaveErr(null); setSaving(true);
    /**
     * تحذير التكرار: مع 100+ وحدة يسهل إدخال نفس رقم الوحدة مرتين، فتظهر
     * وحدتان بالرقم نفسه وتنقسم بينهما الدفعات. لا نمنع (قد يكون تأجيرًا
     * جديدًا لوحدة أُخليت) — لكن لا نتركه يمرّ بصمت.
     */
    const unitTxt = String(d.unit || "").trim();
    if (unitTxt) {
      const clash = active.tenants.find((t) => t.id !== id && String(t.unit || "").trim() === unitTxt && !isVacant(t));
      if (clash && !confirm(`${ul} ${unitTxt} مشغولة حاليًّا بـ«${clash.name}».\n\nإن كان مستأجرًا جديدًا، سجّل إخلاء السابق أولًا حتى لا تظهر الوحدة مرتين.\n\nمتابعة الإضافة على أي حال؟`)) { setSaving(false); return; }
    }
    /* أشيع خطأ عند النقل من إكسل: كتابة 1447-03-15 في منتقي التاريخ الميلادي.
       المتصفح يقبلها كسنة 1447 ميلادية فيصير العقد قبل ستة قرون. */
    const y0 = Number(String(d.contract_start || "").slice(0, 4));
    if (y0 && y0 < 1900) {
      fail(`تاريخ البداية «${d.contract_start}» يبدو هجريًّا أُدخل في خانة ميلادية. اضغط زر «هجري» فوق الخانة ثم أدخله.`);
      return;
    }
    if (y0 && y0 > 2100) { fail(`تاريخ البداية «${d.contract_start}» غير معقول.`); return; }
    /* الوحدة المؤجّرة بلا تاريخ بداية لا تُحسب لها أقساط ولا استحقاق — وكان
       الحفظ يمرّ بصمت فتبقى الوحدة بلا مواعيد ويظن الموظف أن التعديل «لا يعمل». */
    if (!d.contract_start && String(d.status || "active") !== "vacated") {
      fail("أدخل تاريخ بداية العقد — بدونه لا يستطيع النظام حساب الاستحقاقات لهذه الوحدة.");
      return;
    }
    const freq = (d.payment_frequency || "monthly") as Frequency;
    const periods = d.contract_periods ? Number(d.contract_periods) : null;
    const payload = {
      property_id: active.id, name: d.name, unit: d.unit || null, phone: d.phone || null,
      national_id: d.national_id || null, rent_amount: Number(d.rent_amount) || 0,
      contract_start: d.contract_start || null,
      payment_frequency: freq,
      contract_periods: periods,
      /**
       * نهاية العقد تُحسب بتقويم العقد نفسه.
       *
       * كانت تُحسب ميلاديًّا دائمًا ثم تُخزَّن — وحالة العقد تستعمل المخزَّنة
       * إن وُجدت، فتتجاوز الحساب الهجري الصحيح. النتيجة: عقد يبدأ 1448/02/18
       * هجريًّا كان ينتهي 1449/02/28 بدل 1449/02/18 (فرق عشرة أيام)، ولا
       * يُصلحه أي تعديل لاحق لأن القيمة الخاطئة محفوظة في القاعدة.
       */
      contract_end: d.contract_start
        ? derivedEndDate(d.contract_start, freq, periods, null, d.calendar === "hijri" ? "hijri" : "gregorian")
        : null,
      billing_anchor_day: d.contract_start ? new Date(d.contract_start).getDate() : null,
      // المرافق: رقما حساب الكهرباء والماء ثابتان للوحدة ويبقيان مع تغيّر المستأجر؛
      // وقراءتا التسليم تُثبتان في مخالصة الإخلاء لاحقًا
      contract_no: (d.contract_no || "").trim() || null,
      calendar: d.calendar === "hijri" ? "hijri" : "gregorian",  // _calAuto واجهة فقط
      vat_mode: ["on", "off"].includes(String(d.vat_mode)) ? d.vat_mode : "auto",
      carried_debt: Math.max(0, Number(d.carried_debt) || 0),
      first_due: d.first_due || null,
      unit_type: d.unit_type || null,
      rooms: d.rooms === "" || d.rooms == null ? null : Math.max(0, Math.min(50, Number(d.rooms) || 0)),
      baths: d.baths === "" || d.baths == null ? null : Math.max(0, Math.min(50, Number(d.baths) || 0)),
      acs: d.acs === "" || d.acs == null ? null : Math.max(0, Math.min(50, Number(d.acs) || 0)),
      elec_account: (d.elec_account || "").trim() || null,
      water_account: (d.water_account || "").trim() || null,
      meter_elec_in: (d.meter_elec_in || "").trim() || null,
      meter_water_in: (d.meter_water_in || "").trim() || null,
    };
    if (id) {
      // إن كانت الوحدة شاغرة فهذا تأجير جديد: تُصفَّر عدّادات المدة السابقة
      const prev = active.tenants.find((x) => x.id === id);
      /**
       * تعديل الإيجار وسط عقد فيه دفعات مسجَّلة يُعيد تقييمها كلها بالسعر
       * الجديد: من دفع شهرين بـ5,000 يصير كأنه دفع بـ8,000، فتتغيّر متأخراته
       * دون أن يدفع شيئًا. هذا صحيح حسابيًّا (النظام يعدّ دفعات لا مبالغ)
       * لكنه مفاجئ — فنُنبّه ونقترح التجديد الذي يبدأ مدة جديدة بسعر جديد.
       */
      if (prev && (prev.paid_periods || 0) > 0 && Number(d.rent_amount) !== Number(prev.rent_amount)) {
        const st0 = contractState(prev, { graceDays: Number(active.grace_days) || 0, ...windowsOf(active) });
        const after = contractState({ ...prev, rent_amount: Number(d.rent_amount) || 0 }, { graceDays: Number(active.grace_days) || 0, ...windowsOf(active) });
        const diff = Math.round(after.amountDue - st0.amountDue);
        if (!confirm(
          `تغيير الإيجار من ${sar(prev.rent_amount)} إلى ${sar(d.rent_amount)} ريال.\n\n`
          + `على هذا العقد ${prev.paid_periods} دفعة مسجَّلة، وستُقيَّم بالسعر الجديد — `
          + (diff > 0 ? `فيرتفع المتأخر ${sar(diff)} ريال.` : diff < 0 ? `فينخفض المتأخر ${sar(-diff)} ريال.` : "بلا أثر على المتأخر.")
          + `\n\nإن كان السعر الجديد يبدأ من مدة قادمة فالأفضل «تجديد العقد» بدل التعديل.\n\nمتابعة التعديل؟`
        )) { setSaving(false); return; }
      }
      /* الرصيد الافتتاحي يُعدَّل يدويًّا، لكنه لا يقابله سجل دفعات — فإن
         كان للوحدة دفعات مسجّلة ننبّه، لأن التعديل يفكّ ارتباط العدّاد
         بالسجل ويجعل تقرير المالك يخالف حالة الوحدة. */
      const paidNew = Math.max(0, Math.floor(Number(d.paid_periods) || 0));
      if (prev && paidNew !== (prev.paid_periods || 0)) {
        const { count } = await supabase.from("payments")
          .select("id", { count: "exact", head: true }).eq("tenant_id", id);
        const recorded = Number(count) || 0;
        if (recorded > 0 && !confirm(
          `تغيير «الدفعات المسدَّدة» من ${prev.paid_periods || 0} إلى ${paidNew}؟\n\n`
          + `على هذه الوحدة ${recorded} دفعة مسجّلة في السجل.\n`
          + `التعديل اليدوي لا يضيف ولا يحذف دفعة — فقد يختلف العدّاد عن سجل المدفوعات وتقرير المالك.\n\n`
          + `للتراجع عن دفعة سُجّلت خطأً استعمل «↩︎ تراجع عن آخر دفعة».\n\nمتابعة؟`
        )) { setSaving(false); return; }
      }

      const reletting = prev && isVacant(prev);
      const full: any = reletting
        ? { ...payload, status: "active", paid_periods: 0, partial_amount: 0,
            notice_date: null, move_out_date: null, deposit_deductions: 0,
            meter_elec_out: null, meter_water_out: null, turnover_checklist: [] }
        : { ...payload, paid_periods: paidNew };
      const { data: _u2, error } = await supabase.from("tenants").update(full).eq("id", id).select("id");
      if (error) { console.error("Watheq save error:", error); return fail(error.message); }
      if (!_u2 || _u2.length === 0) return fail("هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.");
      setItems(items.map((p) => p.id === active.id
        ? { ...p, tenants: p.tenants.map((t) => (t.id === id ? { ...t, ...full } as Tenant : t)) } : p));
    } else {
      const paidSoFar = Math.max(0, Math.min(Math.floor(Number(d.paid_periods) || 0), periods || 9999));
      const { data, error } = await supabase.from("tenants").insert({ ...payload, paid_periods: paidSoFar }).select("*").single();
      if (error) { console.error("Watheq save error:", error); return fail(error.message); }
      setItems(items.map((p) => (p.id === active.id ? { ...p, tenants: [...p.tenants, data as Tenant] } : p)));
    }
    setSaving(false); setSaveErr(null);
    setModal(null);
  }

  async function patchTenant(id: string, patch: any, collectedDelta = 0) {
    if (!active) return;
    const { data: _upd, error } = await supabase.from("tenants").update(patch).eq("id", id).select("id");
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    /* تعديل رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نُحدّث الشاشة كأنه نجح */
    if (!_upd || _upd.length === 0) return notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.");
    if (collectedDelta) await supabase.from("properties").update({ collected: (active.collected || 0) + collectedDelta }).eq("id", active.id);
    setItems(items.map((p) => p.id === active.id ? {
      ...p,
      collected: collectedDelta ? (p.collected || 0) + collectedDelta : p.collected,
      tenants: p.tenants.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    } : p));
  }

  async function deleteTenant(id: string) {
    if (!active) return;
    /**
     * الحذف لا يمحو الدفعات — تبقى في السجل بلا وحدة (on delete set null).
     * فالمال لا يضيع، لكنه يختفي من كشوف الوحدة ومن تقرير المالك. لذلك
     * نُظهر عدد الدفعات المسجّلة قبل السؤال: من يحذف صفًّا مكرّرًا يجب أن
     * يحذف الفارغ منهما لا المحمّل بالسجل.
     */
    const t = active.tenants.find((x) => x.id === id);
    const { count } = await supabase.from("payments")
      .select("id", { count: "exact", head: true }).eq("tenant_id", id);
    const n = Number(count) || 0;
    const msg = n > 0
      ? `حذف «${t?.name || "الوحدة"}» — ${ul} ${t?.unit || "—"}؟\n\n⚠️ عليها ${n} دفعة مسجّلة.\nالدفعات لن تُحذف، لكنها ستبقى في السجل بلا وحدة، وتختفي من كشف الوحدة ومن تقرير المالك.\n\nإن كنت تحذف صفًّا مكرّرًا فاحذف الصفّ الذي لا دفعات عليه.\n\nمتابعة الحذف؟`
      : `حذف «${t?.name || "الوحدة"}» — ${ul} ${t?.unit || "—"}؟\n\nلا دفعات مسجّلة عليها.`;
    if (!confirm(msg)) return;
    const { data: _del, error } = await supabase.from("tenants").delete().eq("id", id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((p) => (p.id === active.id ? { ...p, tenants: p.tenants.filter((t) => t.id !== id) } : p)));
  }

  async function addNote(text: string, extra?: { due_date?: string | null; kind?: string; unit?: string | null }) {
    if (!active || !text.trim()) return;
    const { data, error } = await supabase.from("property_notes")
      .insert({ property_id: active.id, text: text.trim(), note_date: today(),
                due_date: extra?.due_date || null, kind: extra?.kind || "other", unit: extra?.unit || null })
      .select("*").single();
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((p) => (p.id === active.id ? { ...p, property_notes: [data as Note, ...p.property_notes] } : p)));
  }

  /** إغلاق المهمة أو إعادة فتحها — المتابعة تحتاج «تمّت» وإلا تتراكم وتُهمل */
  async function toggleNote(n: Note) {
    if (!active) return;
    const done_at = n.done_at ? null : new Date().toISOString();
    const { data, error } = await supabase.from("property_notes")
      .update({ done_at }).eq("id", n.id).select("*");
    if (error) return notify("err", error.message);
    if (!data?.length) return notify("err", "هذا الإجراء يحتاج صلاحية أعلى.");
    setItems(items.map((p) => (p.id === active.id
      ? { ...p, property_notes: p.property_notes.map((x) => (x.id === n.id ? (data[0] as Note) : x)) } : p)));
  }

  async function deleteNote(id: string) {
    if (!active) return;
    const { data: _delN } = await supabase.from("property_notes").delete().eq("id", id).select("id");
    if (!_delN || _delN.length === 0) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    setItems(items.map((p) => (p.id === active.id ? { ...p, property_notes: p.property_notes.filter((n) => n.id !== id) } : p)));
  }

  async function doRenew(t: Tenant, opts: { periods: number; newAmount: number | null; newFrequency: Frequency; arrears?: "carry" | "settled" }) {
    if (!active) return;
    /* متأخرات المدة المنتهية لا تختفي بالتجديد: تُرحَّل دينًا ظاهرًا ما لم
       يؤكّد المكتب صراحةً أنها سُدّدت. كان التجديد يمحوها بلا أثر. */
    const before = contractState(t, { graceDays: Number(active.grace_days) || 0, ...windowsOf(active) });
    let arrears = opts.arrears;
    if (before.amountDue > 0 && !arrears) {
      arrears = confirm(`على ${t.name} متأخرات ${sar(before.amountDue)} ريال من المدة المنتهية.\n\nموافق = تُرحَّل كدين على العقد الجديد (تبقى ظاهرة حتى تُسدَّد)\nإلغاء = سُدّدت بالكامل ولا تُرحَّل`)
        ? "carry" : "settled";
    }
    const fields = renewContract(t, { periods: opts.periods, newAmount: opts.newAmount, newFrequency: opts.newFrequency, arrears });
    const { data: _u3, error } = await supabase.from("tenants").update(fields).eq("id", t.id).select("id");
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    if (!_u3 || _u3.length === 0) return notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.");
    if ((fields as any).carried_debt > 0) notify("ok", `جُدّد العقد — ورُحّل دين ${sar((fields as any).carried_debt)} ريال يظهر على الوحدة حتى يُسدَّد.`);
    // توثيق التجديد في سجل العقار
    /* الملاحظة توثيق لا شرط: إن رفضتها الصلاحيات نُكمل ونُعلم بلا إفشال العملية */
    const noteRes = await supabase.from("property_notes").insert({
      property_id: active.id, note_date: today(),
      text: `تجديد عقد ${t.name} (${unitLabel(active.property_type)} ${t.unit || "—"}) — من ${fields.contract_start} إلى ${fields.contract_end} بقيمة ${sar(fields.rent_amount)} ريال / ${freqShort(fields.payment_frequency)}`,
    });
    setItems(items.map((pp) => pp.id === active.id ? {
      ...pp,
      tenants: pp.tenants.map((x) => (x.id === t.id ? { ...x, ...fields } as Tenant : x)),
    } : pp));
    setRenewing(null);
    if (noteRes.error) notify("err", "جُدّد العقد، لكن تعذّرت كتابة الملاحظة في سجل العقار.");
    router.refresh();
  }

  async function openStatement(t: Tenant, mode: "brief" | "full" = "full") {
    if (!active) return;
    // نجلب سجل المدفوعات الموثّق ليظهر في الكشف بتواريخه وطرقه
    const { data, error } = await supabase.from("payments")
      .select("id,paid_on,amount,method,periods_covered,note")
      .eq("tenant_id", t.id).order("paid_on", { ascending: true }).limit(500);
    if (error) console.error("Watheq statement payments error:", error);
    openDoc(statementHTML(t as any, active as any, issuer || {}, (data || []) as any, mode));
  }

  const [stmtOpen, setStmtOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  /* خطأ الحفظ يُعرض داخل النموذج لا إشعارًا عائمًا في أعلى الصفحة: على
     الجوال يكون المستخدم منزلًا داخل نموذج طويل، فيضغط «حفظ» ويظهر الإشعار
     خارج نظره — فيقول «ضغطت ولا صار شي». */
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fail = (m: string) => { setSaveErr(m); notify("err", m); setSaving(false); };
  const hasDemo = items.some((p) => (p as any).is_demo);

  async function seedDemo() {
    setSeeding(true);
    try {
      const r = await fetch("/api/demo", { method: "POST" });
      const j = await r.json();
      if (!r.ok) { notify("err", j.error || "تعذّر التجهيز"); return; }
      notify("ok", `جاهز — ${j.properties} عقارات و${j.units} وحدة. تجوّل وجرّب كل شيء.`);
      router.refresh();
    } finally { setSeeding(false); }
  }
  /* الصفحة العامة ترسم الدليل وتبعث أفعاله — واللوحة تنفّذها */
  useEffect(() => {
    const h = (e: any) => onGuideEvent(String(e?.detail || ""));
    window.addEventListener("watheq:guide", h);
    return () => window.removeEventListener("watheq:guide", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** أفعال دليل التجربة: كل خطوة تفتح ما تشرحه بدل أن تصفه */
  function onGuideEvent(ev: string) {
    if (ev === "filter:late") { setFilter("late"); setSort("amount"); window.scrollTo({ top: 400, behavior: "smooth" }); }
    else if (ev === "open:statement") setStmtOpen(true);
    else if (ev === "open:owner") setReporting(true);
    else if (ev === "clear-demo") void clearDemo();
  }

  async function clearDemo(silent = false) {
    /* التجربة العامة بلا حساب: لا شيء يُحذف من خادم — ندعوه للتسجيل */
    if (demo) { window.dispatchEvent(new CustomEvent("watheq:demo-join")); return; }
    if (!silent && !confirm("حذف كل البيانات التجريبية؟\n\nتُحذف العقارات الخمسة ووحداتها ودفعاتها ومصروفاتها — ولا تمسّ أي بيانات حقيقية.")) return;
    const r = await fetch("/api/demo", { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) return notify("err", j.error || "تعذّر الحذف");
    if (!silent) notify("ok", "حُذفت البيانات التجريبية — ابدأ ببياناتك.");
    router.refresh();
  }
  async function openPropertyStatement(mode: "brief" | "full", period: StatementPeriod) {
    if (!active) return;
    setStmtOpen(false);
    if (!period) { openDoc(propertyStatementHTML(active as any, issuer || {}, mode)); return; }
    /* الأرقام من السجل الفعلي للفترة — لا من الحالة اللحظية، فيطابق تقرير المالك */
    const [pay, exp] = await Promise.all([
      supabase.from("payments").select("id, paid_on, reference, created_at, amount, method, note, tenant_id, unit:tenant_id")
        .eq("property_id", active.id).gte("paid_on", period.from).lte("paid_on", period.to).limit(5000),
      supabase.from("expenses").select("id, spent_on, amount, category, note, unit")
        .eq("property_id", active.id).gte("spent_on", period.from).lte("spent_on", period.to).limit(5000),
    ]);
    if (pay.error) return notify("err", pay.error.message);
    const nameOf: Record<string, { name: string; unit: string | null }> = {};
    (active.tenants || []).forEach((t) => { nameOf[t.id] = { name: t.name, unit: t.unit }; });
    const rowsP = (pay.data || []).map((x: any) => ({
      ...x, tenant_name: nameOf[x.tenant_id]?.name || "—", unit: nameOf[x.tenant_id]?.unit || null,
    }));
    openDoc(propertyStatementHTML(active as any, issuer || {}, mode, period, rowsP as any, (exp.data || []) as any));
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
    const one = splitVat(Number(t.rent_amount) || 0, active && unitVatApplies(t, active) ? v : { ...v, enabled: false });

    const L: string[] = [`السلام عليكم ورحمة الله، ${t.name}`, ""];

    if (st.unpaid === 0) {
      /* المستأجر يقرأ عقده بالتقويم المكتوب فيه: نضيف الهجري للعقد الهجري،
         وعدد الأيام لأن «1 ديسمبر» وحدها لا تقول إن أمامه شهرين. */
      const dueTxt = `${arDate(st.nextDueDate)}${t.calendar === "hijri" && st.nextDueDate ? ` (${hijriText(st.nextDueDate)})` : ""}`;
      const inDays = st.daysToNextDue;
      L.push(`تذكير ودّي بأن الدفعة القادمة عن ${unit} بعقار ${active.name} تستحق بتاريخ ${dueTxt}${
        inDays !== null && inDays > 0 ? ` — بعد ${inDays === 1 ? "يوم واحد" : inDays === 2 ? "يومين" : inDays <= 10 ? `${inDays} أيام` : `${inDays} يومًا`}` : inDays === 0 ? " — اليوم" : ""}.`);
      if (one.total) L.push(`• قيمة الدفعة: ${sar(one.total)} ريال${one.vat > 0 ? ` (منها ${sar(one.vat)} ريال ضريبة قيمة مضافة)` : ""}`);
    } else {
      L.push(`نودّ تذكيركم بوجود مستحقّات غير مسدَّدة عن ${unit} بعقار ${active.name}، وبيانها:`);
      L.push(`• عدد الدفعات المتأخرة: ${st.unpaid}`);
      if (one.total) L.push(`• قيمة الدفعة: ${sar(one.total)} ريال`);
      if (st.hasPartial) L.push(`• المسدَّد جزئيًّا: ${sar(st.partial)} ريال`);
      L.push(`• المبلغ المتبقّي: ${sar(st.amountDue)} ريال`);
      if (st.nextDueDate) L.push(`• تاريخ أقرب دفعة مستحقة: ${arDate(st.nextDueDate)}${t.calendar === "hijri" ? ` (${hijriText(st.nextDueDate)})` : ""}`);
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
    const one = splitVat(Number(t.rent_amount) || 0, active && unitVatApplies(t, active) ? v : { ...v, enabled: false });
    const totalDue = splitVat(st.amountDue, active && unitVatApplies(t, active) ? v : { ...v, enabled: false });

    // نطاق الفترة المتأخرة: من أول دفعة غير مسدَّدة إلى أحدث دفعة استحقّت
    const sch = buildSchedule(t);
    const lateRows = sch.filter((r) => r.status === "late" || r.status === "partial");
    const fromDate = lateRows[0]?.date || st.nextDueDate || "—";
    const toDate = lateRows[lateRows.length - 1]?.date || fromDate;

    const body = [
      "إشعار بسداد أجرة متأخرة",
      `التاريخ: ${arDate(today())}`,
      "",
      `من: ${who}`,
      `إلى: المكرَّم ${t.name}${t.national_id ? `، هوية/سجل رقم (${t.national_id})` : ""}، شاغل ${ul} رقم (${t.unit || "—"}) بعقار ${active.name}${active.address ? ` — ${active.address}` : ""}${active.city ? `، ${active.city}` : ""}.`,
      "",
      "الموضوع: مطالبة بسداد الأجرة المتأخرة.",
      "",
      "السلام عليكم ورحمة الله وبركاته،",
      "",
      `بالإشارة إلى عقد الإيجار المبرم بيننا${t.contract_no ? ` رقم (${t.contract_no})` : ""} (بداية العقد: ${arDate(t.contract_start)}${t.contract_start ? ` — ${hijriText(t.contract_start)}` : ""}، نهايته: ${arDate(st.endDate)}، دورة السداد: ${freqLabel(t.payment_frequency)}${one.total ? `، وقيمة الدفعة ${sar(one.total)} ريال` : ""})؛`,
      "",
      `نفيدكم بأنه قد ترصَّد بذمّتكم مبلغ (${sar(st.amountDue)}) ريال، قيمة (${st.unpaid}) دفعة مستحقة عن الفترة من (${arDate(fromDate)}) إلى (${arDate(toDate)})${st.hasPartial ? `، بعد خصم مبلغ (${sar(st.partial)}) ريال مسدَّد جزئيًّا` : ""}، ولم يُسدَّد حتى تاريخ هذا الإشعار.`,
      ...(totalDue.vat > 0 ? ["", `ويشمل المبلغ المذكور ضريبة قيمة مضافة قدرها (${sar(totalDue.vat)}) ريال بنسبة (${v.rate}%).`] : []),
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

  /* كل الخطافات قبل أي خروج مبكر — وإلا اختلف عددها بين الرسمات وانهار React */
  /* يمرّ على وحدات كل العقارات: بلا تذكير يُعاد الحساب مع كل ضغطة في
     البحث — عند 500 وحدة يظهر ذلك بطئًا محسوسًا في الكتابة. */
  const portfolio = useMemo(() => items.reduce((acc, prop) => {
    (Array.isArray(prop.tenants) ? prop.tenants : []).forEach((t) => {
      const st = contractState(t, { graceDays: Number(prop.grace_days) || 0, ...windowsOf(prop) });
      acc.units++;
      /* المُخلاة: لا تدخل في الدخل الشهري (لا ساكن يدفع) ولا في عدّاد المتأخرين؛
         ودينها القديم يُجمع على حدة. كانت تُعدّ كأنها مؤجّرة فيرتفع الدخل زورًا. */
      if (st.vacant) { acc.vacant++; acc.legacy += st.legacyArrears; return; }
      if (st.status === "late") { acc.late++; acc.overdue += st.amountDue; }
      if (st.incomplete) acc.incomplete++;
      if (st.status === "soon") { if (st.soonTier === "near") acc.soon++; else acc.due++; }
      if (st.expiringSoon) acc.expiring++;
      acc.monthly += (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency];
    });
    return acc;
  }, { units: 0, late: 0, soon: 0, due: 0, overdue: 0, expiring: 0, monthly: 0, vacant: 0, legacy: 0, incomplete: 0 }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, officeSoon, officeImminent, officeExpiring]);

  if (!hydrated) {
    return <div className="text-center text-muted py-16 text-sm">جارٍ تحميل لوحتك…</div>;
  }



  if (!items.length) {
    return (
      <div className="max-w-lg mx-auto bg-white border border-line rounded-2xl shadow-sm p-8 mt-8 text-center">
        <div className="text-4xl mb-3">🏢</div>
        <h2 className="font-display text-xl font-bold text-deep mb-2">أضف أول عقار لك</h2>
        <p className="text-muted mb-5">عمارة، معرض تجاري، مكتب، مستودع، فيلا، أو أرض — كلها مدعومة.</p>

        {/* ثلاث خطوات: المستخدم الجديد يعرف أين هو وما التالي بدل لوحة فارغة */}
        <div className="grid sm:grid-cols-3 gap-2 text-right mb-5">
          {[["١", "أضف عقارك", "الاسم والمدينة — دقيقة"],
            ["٢", "أدخل وحداته", "يدويًّا أو رفع Excel دفعة واحدة"],
            ["٣", "سجّل أول دفعة", "وتبدأ اللوحة تعمل لك"]].map(([n, t, d]) => (
            <div key={n} className="border border-line rounded-xl p-3 bg-paper">
              <div className="text-xs font-bold text-gold mb-0.5">{n}</div>
              <div className="text-sm font-semibold text-deep">{t}</div>
              <div className="text-[11px] text-muted mt-0.5">{d}</div>
            </div>
          ))}
        </div>

        {/**
          * الزائر من إعلان لا وقت عنده ليدخل بياناته ليرى شيئًا — فيغادر أمام
          * لوحة فارغة. البيانات التجريبية تعطيه مكتبًا حيًّا في ثلاث ثوانٍ:
          * خمسة عقارات وثمانون وحدة بكل الحالات، تُحذف بضغطة أو تلقائيًّا
          * حين يضيف أول عقار حقيقي.
          */}
        <div className="bg-[#FBF1DF] border border-goldSoft rounded-xl p-4 mb-4 text-right">
          <div className="font-semibold text-deep text-sm mb-1">🎯 تبغى تشوفها تشتغل قبل ما تدخل بياناتك؟</div>
          <p className="text-xs text-muted mb-3 leading-relaxed">
            نجهّز لك مكتبًا تجريبيًّا: 5 عقارات و80 وحدة بحالات حقيقية — متأخرون ومنتظمون وشواغر
            وتقارير مُلّاك ومصروفات. تتجوّل فيه، وتحذفه بضغطة وتبدأ ببياناتك.
          </p>
          <button className="btn btn-gold w-full justify-center" disabled={seeding} onClick={seedDemo}>
            {seeding ? "جارٍ التجهيز…" : "🚀 جرّب ببيانات تجريبية"}
          </button>
        </div>

        <div className="flex gap-2 justify-center flex-wrap">
          <button className="btn btn-ghost" onClick={() => setModal({ kind: "newProp" })}>+ إضافة عقار</button>
          <Link href="/dashboard/property/import" className="btn btn-ghost">رفع من ملف Excel</Link>
        </div>

        {/* أقوى عرض عندنا — وكان غائبًا عن أهم شاشة في المنتج */}
        <div className="bg-paper border border-line rounded-xl p-3 mt-5 text-sm text-right">
          <b className="text-deep">ما عندك وقت للإدخال؟</b> أرسل لنا بياناتك بأي شكل (ملف إكسل، صورة دفتر، أو حتى رسالة) ونجهّز حسابك كاملًا خلال يوم — بلا أي التزام.
          <a href={waLink(WATHEQ_WA, "السلام عليكم، أبغى أجهّز حسابي في وثيق وعندي بيانات عقاراتي.")} target="_blank" rel="noreferrer"
             className="btn btn-wa text-xs mt-2" onClick={(e) => { e.preventDefault(); openExternal(waLink(WATHEQ_WA, "السلام عليكم، أبغى أجهّز حسابي في وثيق وعندي بيانات عقاراتي.")); }}>💬 أرسل بياناتك على واتساب</a>
        </div>
        <PropertyModal open={modal?.kind === "newProp"} orgName={orgName} onClose={() => setModal(null)} onSubmit={(d) => saveProperty(d)} />
      </div>
    );
  }


  /* حارس: لو اختفى العقار النشط (حُذف من جهاز آخر، أو تغيّرت البيانات
     بعد تحديث الخادم) فلا نُسقط الصفحة بـ active! — نعود لأول عقار. */
  if (!active) {
    const first = items[0]?.id || null;
    if (first && first !== activeId) { setTimeout(() => setActiveId(first), 0); }
    return (
      <div className="max-w-lg mx-auto bg-white border border-line rounded-2xl p-8 mt-8 text-center">
        <p className="text-muted mb-4">لم يعد هذا العقار متاحًا — ربما حُذف أو تغيّرت صلاحياتك.</p>
        <button className="btn btn-gold" onClick={() => router.refresh()}>تحديث الصفحة</button>
      </div>
    );
  }
  const p = active;
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
  // الدخل الشهري المتوقع من الوحدات المؤجّرة فقط — الشاغرة كانت تُحسب فيه كأن فيها ساكنًا
  const monthlyIncome = tenants.reduce((sum, t) =>
    sum + (isVacant(t) ? 0 : (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency]), 0);
  const overdue = lateRows.reduce((s, r) => s + r.st.amountDue, 0);
  /**
   * الدخل السنوي للعقار = مجموع إيجارات الوحدات المشغولة مُقيَّسًا على سنة
   * (شهري ×12، ربع سنوي ×4...). و«المحصَّل منه» يُقرأ من سجل الدفعات
   * للفترة التي يختارها المكتب — هذه السنة أو آخر 12 شهرًا أو هذا الشهر.
   */
  const annualIncome = tenants.reduce((sum, t) =>
    sum + (isVacant(t) ? 0 : (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency] * 12), 0);
  const pct = allRows.length ? Math.round(((allRows.length - lateRows.length) / allRows.length) * 100) : 100;


  const expiringSoon = allRows
    .filter((r) => r.st.expiringSoon && !r.t.litigation)
    .sort((a, b) => (a.st.daysToEnd || 0) - (b.st.daysToEnd || 0))[0];
  const editingBase = modal?.kind === "tenant" && modal.id ? tenants.find((t) => t.id === modal.id) : undefined;
  /* عند التأجير الجديد نمرّر الدين المرحَّل مُهيّأً في النموذج فلا يُنسى */
  const editing = editingBase && (modal as any)?.preset
    ? { ...editingBase, ...(modal as any).preset } as Tenant : editingBase;

  // ملخّص المحفظة كاملة (كل العقارات)

  const occupancyPct = portfolio.units
    ? Math.round(((portfolio.units - portfolio.vacant) / portfolio.units) * 100) : 100;

  const chips: { k: "all" | RowKey; label: string }[] = [
    { k: "all", label: `الكل ${allRows.length}` },
    { k: "late", label: `متأخر ${counts.late || 0}` },
    ...(counts.incomplete ? [{ k: "incomplete" as const, label: `بيانات ناقصة ${counts.incomplete}` }] : []),
    { k: "due", label: `مستحق ${counts.due || 0}` },
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

      {hasDemo && !demo && (
        <div className="bg-[#FBF1DF] border-2 border-dashed border-gold rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <b className="text-deep">🎯 أنت في مكتب تجريبي</b>
            <span className="text-muted"> — عقارات ووحدات ودفعات وهمية بلا أرقام جوال أو هويات حقيقية. لا تدخل الملخّص اليومي ولا تقارير الإدارة.</span>
          </div>
          <button className="btn btn-gold text-xs" onClick={() => clearDemo()}>🗑 احذفها وابدأ ببياناتي</button>
        </div>
      )}

      {items.length > 1 && (

        <div className="bg-deep text-[#EAF1EE] rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="font-display font-bold text-sm text-goldSoft">محفظتك · {plural(items.length, "عقار واحد", "عقاران", "عقارات", "عقارًا")}</div>
          <PortfolioStat v={String(portfolio.units)} l={portfolio.units === 1 ? "وحدة" : portfolio.units === 2 ? "وحدتان" : portfolio.units <= 10 ? "وحدات" : "وحدة"} />
          <PortfolioStat v={String(portfolio.late)} l={portfolio.late === 1 ? "وحدة متأخرة" : "متأخرة"} tone={portfolio.late ? "warn" : undefined} />
          <PortfolioStat v={sar(portfolio.overdue)} l="ريال متأخر" tone={portfolio.overdue ? "warn" : undefined} />
          <PortfolioStat v={String(portfolio.due + portfolio.soon)} l={`تستحق خلال ${plural(officeSoon, "يوم واحد", "يومين", "أيام", "يومًا")}`} />
          <PortfolioStat v={String(portfolio.expiring)} l="عقود تنتهي قريبًا" />
          <PortfolioStat v={`${occupancyPct}%`} l={`إشغال (${portfolio.vacant === 0 ? "لا شاغر" : plural(portfolio.vacant, "وحدة شاغرة", "وحدتان شاغرتان", "شاغرة", "شاغرة")})`} tone={portfolio.vacant ? "warn" : undefined} />
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
{/* مكتب بمئة عقار: قائمة منسدلة بمئة خيار لا يُبحث فيها — وعلى الجوال
            عجلة طويلة. فوق 12 عقارًا نعرض حقل بحث يصفّي القائمة. */}
        {items.length > 12 && (
          <input className="fld max-w-[150px] text-xs" value={propQ} onChange={(e) => setPropQ(e.target.value)}
            placeholder={`ابحث في ${items.length} عقارًا…`} />
        )}
        <select value={p.id} onChange={(e) => setActiveId(e.target.value)} className="fld max-w-[220px] font-semibold text-deep">
          {(() => {
            const q = propQ.trim().toLowerCase();
            const list = [...items].sort((a, b) => a.name.localeCompare(b.name, "ar"))
              .filter((x) => !q || `${x.name} ${x.city || ""} ${x.owner_name || ""}`.toLowerCase().includes(q) || x.id === p.id);
            return list.map((x) =>
              <option key={x.id} value={x.id}>{typeIcon(x.property_type)} {x.name} · {x.tenants.length}</option>);
          })()}
        </select>
{/* شريط العقار صار للتنقّل وحده. كل الأدوات انتقلت إلى شريط الوحدات
            مجمَّعةً في ثلاث قوائم — كان الشريطان يعرضان 15 زرًّا معًا،
            ومستندات المالك موزّعة بينهما بلا منطق. */}
        <button type="button" className="btn btn-ghost text-sm px-3" onClick={refreshNow} disabled={refreshing}
          title="تحديث البيانات من السيرفر (بعد تسجيل دفعة من البوت مثلًا)">{refreshing ? "…" : "↻"}</button>
        {isManager && <button type="button" className="btn btn-ghost text-sm px-3" onClick={() => setModal({ kind: "editProp" })} title="إعدادات هذا العقار">⚙️</button>}
        {items.length > 1 && <Link href="/dashboard/property/overview" className="btn btn-ghost text-sm" title="كل العقارات في صفحة واحدة">🗂️ نظرة عامة</Link>}
        {isManager && <button className="btn btn-ghost text-sm" onClick={() => setModal({ kind: "newProp" })}>+ عقار</button>}
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
        <Stat v={collectedThisMonth === null ? "…" : sar(Math.round(collectedThisMonth))} l={`المحصَّل فعليًّا هذا الشهر · المتوقع ${sar(Math.round(monthlyIncome))}`} kpi="income" icon="↑" />
        {(lateCount > 0 || overdue > 0) && <Stat v={sar(overdue)} l={`المتأخر (${lateCount === 0 ? "لا وحدات" : plural(lateCount, "وحدة واحدة", "وحدتان", "وحدات", "وحدة")})`} kpi="overdue" icon="!" onClick={() => { setFilter("late"); setSort("amount"); }} active={filter === "late"} />}
        {((counts.due || 0) + (counts.soon || 0)) > 0 && <Stat v={String((counts.due || 0) + (counts.soon || 0))} l={`تستحق خلال ${plural(windowsOf(active).soonDays, "يوم واحد", "يومين", "أيام", "يومًا")}`} kpi="soon" icon="●" onClick={() => setFilter("soon")} active={filter === "soon"} />}
        {(counts.expiring || 0) > 0 && <Stat v={String(counts.expiring || 0)} l="عقود تنتهي قريبًا" kpi="expiring" icon="↻" onClick={() => setFilter("expiring")} active={filter === "expiring"} />}
      </div>

      {/* الدخل السنوي والمحصَّل منه — سؤال المالك الأول: «كم يدخل هذا العقار في السنة، وكم قبضنا منه؟» */}
      {tenants.length > 0 && (() => {
        const expectedSoFar = incPeriod === "year"
          ? annualIncome * ((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (365 * 86400000))
          : incPeriod === "month" ? annualIncome / 12 : annualIncome;
        const col = collectedInPeriod ?? 0;
        /* النسبة الحقيقية قد تتجاوز 100% (سداد سنوي مقدَّم، أو إدخال دفعات سنوات
           سابقة). قصّها عند 100 كان يعرض «100%» بينما المحصَّل 141% — رقم كاذب.
           الشريط يُقصّ بصريًّا، والنص يقول الحقيقة. */
        const pctOfAnnual = annualIncome > 0 ? Math.round((col / annualIncome) * 100) : 0;
        const barPct = Math.min(100, pctOfAnnual);
        const label = incPeriod === "year" ? `هذه السنة (${new Date().getFullYear()})` : incPeriod === "month" ? "هذا الشهر" : "آخر 12 شهرًا";
        return (
          <div className="bg-white border border-line rounded-2xl p-4 mb-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <div>
                <div className="text-xs text-muted">الدخل السنوي المتوقع للعقار</div>
                <div className="text-2xl font-bold text-deep tabular-nums">{sar(Math.round(annualIncome))} <span className="text-sm font-normal text-muted">ريال / سنة</span></div>
              </div>
              <div className="inline-flex items-center gap-0.5 border border-line rounded-lg p-0.5 text-[11px]">
                {([["year", "هذه السنة"], ["12m", "آخر 12 شهرًا"], ["month", "هذا الشهر"]] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setIncPeriod(k)}
                    className={`px-2.5 py-1 rounded-md ${incPeriod === k ? "bg-deep text-goldSoft" : "text-muted hover:text-deep"}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="flex items-baseline justify-between text-sm mb-1">
              <span>المحصَّل {label}: <b className="tabular-nums text-[#137a50]">{collectedInPeriod === null ? "…" : sar(Math.round(col))}</b> ريال</span>
              <span className={`text-xs tabular-nums ${pctOfAnnual > 100 ? "text-[#137a50] font-semibold" : "text-muted"}`}>{pctOfAnnual}% من الدخل السنوي{pctOfAnnual > 100 ? " — يشمل سدادًا مقدَّمًا أو دفعات سنوات سابقة" : ""}</span>
            </div>
            <div className="h-2.5 bg-paper2 rounded-full overflow-hidden">
              <div className="h-full bg-[#1E9E6A] rounded-full transition-all" style={{ width: `${barPct}%` }} />
            </div>
            <div className="text-[11px] text-muted mt-1.5">
              {incPeriod === "year"
                ? <>المتوقع حتى اليوم بنسبة الأيام المنقضية: <b className="tabular-nums">{sar(Math.round(expectedSoFar))}</b> — {col >= expectedSoFar ? <span className="text-[#137a50]">التحصيل في موعده أو أفضل ✓</span> : <span className="text-late">متأخر عن المتوقع بـ {sar(Math.round(expectedSoFar - col))} ريال</span>}</>
                : <>المتوقع للفترة: <b className="tabular-nums">{sar(Math.round(expectedSoFar))}</b> ريال</>}
              · يُحسب من الوحدات المشغولة فقط ومن الدفعات المسجّلة في وثيق.
            </div>
          </div>
        );
      })()}

      {/* الوحدات تأخذ العرض كاملًا: مكتب بمئات الوحدات يحتاج كل بكسل للجدول،
          وسجل العقار (ملاحظات نصية) ينتقل أسفلها — يُقرأ حين يُطلب لا دائمًا. */}
      <div className="grid grid-cols-1 gap-5 items-start">
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 gap-2 flex-wrap">
            <div className="hidden lg:inline-flex items-center gap-0.5 border border-line rounded-lg p-0.5 me-2 align-middle text-[11px]">
              <button type="button" onClick={() => pickView("table")} className={`px-2.5 py-1 rounded-md ${view === "table" ? "bg-deep text-goldSoft" : "text-muted hover:text-deep"}`} title="جدول: صف لكل وحدة">☰ جدول</button>
              <button type="button" onClick={() => pickView("cards")} className={`px-2.5 py-1 rounded-md ${view === "cards" ? "bg-deep text-goldSoft" : "text-muted hover:text-deep"}`} title="بطاقات">▦ بطاقات</button>
            </div>
            {view === "table" && (
              <div className="hidden lg:inline-flex items-center gap-0.5 border border-line rounded-lg p-0.5 me-2 align-middle text-[11px]">
                <button type="button" onClick={() => setDensity(false)} className={`px-2.5 py-1 rounded-md ${!dense ? "bg-deep text-goldSoft" : "text-muted hover:text-deep"}`} title="صفوف مريحة">مريح</button>
                <button type="button" onClick={() => setDensity(true)} className={`px-2.5 py-1 rounded-md ${dense ? "bg-deep text-goldSoft" : "text-muted hover:text-deep"}`} title="صفوف مضغوطة — وحدات أكثر في الشاشة">مضغوط</button>
              </div>
            )}
            <h2 className="font-semibold">الوحدات والمستأجرون
              {active && <StatusLegend soonDays={windowsOf(active).soonDays} imminentDays={windowsOf(active).imminentDays} expiringDays={windowsOf(active).expiringDays} graceDays={active.grace_days}
                scope={active.soon_days || active.imminent_days ? `هذا العقار (${active.name})` : "المكتب"} />}
              {role && <span className="ms-2 text-[11px] font-normal bg-paper2 border border-line rounded-full px-2 py-0.5 text-muted">
                دورك: {ROLE_LABEL[role] || role}
              </span>}
            </h2>
            <div className="flex gap-2 flex-wrap">
              {/* ثلاث قوائم بدل تسعة أزرار: ما يُطبع · ما يخصّ المالك · ما يخصّ البيانات.
                  الأدوات نفسها — لكن العين تجد مكانها بدل أن تمسح صفًّا طويلًا. */}
              <MenuBtn label="📄 مستندات" items={[
                { label: "كشف حساب العقار", run: () => setStmtOpen(true) },
                { label: "عرض سعر لمستأجر محتمل", run: () => setQuoteOpen(true) },
                ...(may("manage_compliance") ? [{ label: `التزامات المكتب${alertCount(comp) > 0 ? ` (${alertCount(comp)})` : ""}`, run: () => setCompOpen(true) }] : []),
              ]} badge={may("manage_compliance") ? alertCount(comp) : 0} />

              {may("view_financials") && <MenuBtn label="👤 المالك" items={[
                { label: "تقرير المالك", run: () => setReporting(true) },
                { label: "كشف مالك مجمّع", run: () => setOwnerStmtOpen(true) },
                { label: "رابط المالك", run: () => setOwnerLinkOpen(true) },
                ...(may("manage_expenses") ? [{ label: "المصروفات", run: () => setExpensesOpen(true) }] : []),
              ]} />}

              <MenuBtn label="🗂️ البيانات" items={[
                ...(may("edit_tenants") ? [{ label: "رفع من Excel", href: "/dashboard/property/import" }] : []),
                { label: "تصدير CSV", run: exportCSV },
                ...(may("view_activity") ? [{ label: "سجل الحركات المالية", run: () => setLogOpen(true) }] : []),
              ]} />

              {lateCount > 0 && may("send_reminders") && (
                <button className="btn btn-wa text-xs" onClick={() => setRemindAll(true)}
                  title="إرسال تذكير واتساب لكل المتأخرين واحدًا تلو الآخر">💬 تذكير جماعي ({lateCount})</button>
              )}
              {may("edit_tenants") && <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "tenant" })}>+ {ul}</button>}
            </div>
          </div>

          {/* شريط التحكّم: بحث · تصفية · فرز */}
          {tenants.length > 0 && (
            <div className="border-b border-line px-4 py-3 flex flex-wrap gap-2 items-center bg-paper">
              <input className="fld flex-1 min-w-[150px]" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={`ابحث بالاسم أو رقم ${ul} أو الجوال أو الهوية أو رقم العقد أو حساب الكهرباء…`} />
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
            ) : view === "table" ? (() => {
              const sorted = [...rows].sort((a, b) => {
                if (tSort === "due") return String(a.st.nextDueDate || "9999").localeCompare(String(b.st.nextDueDate || "9999"));
                if (tSort === "amount") return b.st.amountDue - a.st.amountDue;
                if (tSort === "unit") return String(a.t.unit || "").localeCompare(String(b.t.unit || ""), "ar", { numeric: true });
                if (tSort === "name") return String(a.t.name || "").localeCompare(String(b.t.name || ""), "ar");
                const d = URGENCY[a.key] - URGENCY[b.key]; return d !== 0 ? d : b.st.amountDue - a.st.amountDue;
              });
              const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
              const page = Math.min(tPage, pages - 1);
              const slice = sorted.slice(page * PAGE, page * PAGE + PAGE);
              const totalDue = rows.reduce((a, r) => a + (r.st.amountDue || 0), 0);
              const nearest = rows.map((r) => r.st.nextDueDate).filter(Boolean).sort()[0];
              const Th = ({ k, label, cls = "" }: { k: typeof tSort; label: string; cls?: string }) => (
                <th className={`px-3 py-2.5 text-right font-semibold text-xs text-muted select-none cursor-pointer whitespace-nowrap ${cls}`}
                  onClick={() => setTSort(k)} title="اضغط للفرز">
                  {label}{tSort === k ? " ▾" : ""}
                </th>
              );
              const badge = (key: RowKey) => ({
                late: "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]", partial: "bg-[#FDF6E3] text-[#7a5c12] border-[#EAD9A8]",
                incomplete: "bg-[#F1EBFC] text-[#5B21B6] border-[#D9CEF6]", due: "bg-[#FDECD2] text-[#9A4B00] border-[#F5CFA0]", soon: "bg-[#FDF6E3] text-[#7a5c12] border-[#EAD9A8]", expiring: "bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]",
                litigation: "bg-[#F1F5F9] text-[#334155] border-[#CBD5E1]", vacant: "bg-[#EEF2F7] text-[#475569] border-[#CBD5E1]",
                ok: "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]",
              })[key];
              const label = (key: RowKey) => ({ incomplete: "بيانات ناقصة", late: "متأخر", partial: "سداد جزئي", due: "مستحق", soon: "قريب", expiring: "ينتهي قريبًا", litigation: "تنفيذ", vacant: "شاغرة", ok: "منتظم" })[key];
              return (
                <div className="border border-line rounded-xl overflow-hidden">
                  <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                    <table className="w-full text-sm">
                      {/* الترويسة تثبت عند التمرير: مع 300 وحدة لا تعرف أي عمود تقرأ بدونها */}
                      <thead className="bg-paper sticky top-0 z-10 shadow-[0_1px_0_var(--tw-shadow-color)] shadow-line">
                        <tr>
                          <Th k="unit" label={ul} cls="w-14" />
                          <Th k="name" label="المستأجر" cls="w-[30%]" />
                          <th className="px-3 py-2.5 text-right font-semibold text-xs text-muted whitespace-nowrap w-[15%]">الإيجار</th>
                          <Th k="due" label="الاستحقاق القادم" cls="w-[16%]" />
                          <Th k="urgent" label="الحالة" cls="w-[11%]" />
                          <Th k="amount" label="المستحق" cls="text-left w-[12%]" />
                          <th className="px-3 py-2.5 w-[150px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {slice.map(({ t, st, key }, i) => (
                          <tr key={t.id} className={`border-t border-line transition-colors hover:bg-paper/70 ${key === "late" ? "bg-[#FFF5F4]" : key === "litigation" ? "bg-[#F8FAFC]" : key === "vacant" ? "bg-[#FAFAF8]" : i % 2 ? "bg-paper/30" : ""}`}>
                            <td className={`px-3 ${cellY} font-semibold tabular-nums`}>{t.unit || "—"}</td>
                            <td className={`px-3 ${cellY}`}>
                              {key === "vacant" ? (
                                <>
                                  <div className="text-muted">— شاغرة —</div>
                                  {t.name && <div className="text-[11px] text-muted">آخر مستأجر: {t.name}</div>}
                                </>
                              ) : null}
                              <div className={`font-medium ${key === "vacant" ? "hidden" : ""}`}>{t.name}{msgCount[t.id] > 0 && <span className="ms-1 text-[10px] bg-deep text-goldSoft rounded-full px-1.5 py-0.5" title="رسائل الفريق على هذه الوحدة">💬 {msgCount[t.id]}</span>}</div>
                              {t.contract_no && <div className="text-[11px] text-muted" dir="ltr">عقد {t.contract_no}</div>}
                            </td>
                            <td className={`px-3 ${cellY} whitespace-nowrap tabular-nums ${key === "vacant" ? "text-muted/70" : "text-muted"}`}>{sar(t.rent_amount)} / {freqShort(t.payment_frequency)}{key === "vacant" && <div className="text-[10px]">الإيجار المطلوب</div>}</td>
                            <td className={`px-3 ${cellY} whitespace-nowrap tabular-nums`}>
                              {key === "vacant" ? <span className="text-muted">—</span>
                              : st.fullyPaid && st.endDate ? (<>
                                <div className="text-[#137a50]">ينتهي {st.endDate}</div>
                                <div className="text-[11px] text-muted">{hijriShort(st.endDate)} · القادم مع التجديد</div>
                              </>)
                              : st.nextDueDate ? (<>
                                <div>{st.nextDueDate}</div>
                                <div className="text-[11px] text-muted">{hijriShort(st.nextDueDate)}</div>
                              </>) : <span className="text-muted">—</span>}
                            </td>
                            <td className={`px-3 ${cellY}`}><span className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${badge(key)}`}>{key === "ok" && st.fullyPaid ? `✓ مسدَّد ${st.paid}/${t.contract_periods || st.paid}` : label(key)}</span></td>
                            <td className={`px-3 ${cellY} text-left tabular-nums whitespace-nowrap ${st.totalOwed > 0 ? "font-bold text-late" : "text-muted"}`}>
                              {st.totalOwed > 0 ? (<>
                                {sar(st.amountDue)}
                                {st.carriedDebt > 0 && <div className="text-[10px] font-normal text-[#9A4B00]">+ {sar(st.carriedDebt)} دين مرحَّل</div>}
                                {/* الوحدة فارغة والمبلغ على من سكنها قبل الإخلاء — تسميته «المستحق» توهم أن الشاغرة مدينة */}
                                {key === "vacant" && <div className="text-[10px] font-normal text-muted">على المستأجر السابق</div>}
                              </>) : "—"}
                            </td>
                            <td className={`px-2 ${dense ? "py-1" : "py-1.5"} text-left whitespace-nowrap`}>
                              <div className="inline-flex items-center gap-1">
                                {key === "vacant" ? (
                                  <button type="button" className="btn btn-primary text-xs whitespace-nowrap" onClick={() => reLet(t)}>🔑 تأجير</button>
                                ) : key === "litigation" ? (
                                  <button className="btn btn-ghost text-xs" onClick={() => setEnforcing(t)}>متابعة التنفيذ</button>
                                ) : (<>
                                  {canCollect && <QuickBtn title={isBusy(`pay:${t.id}`) ? "جارٍ التسجيل…" : "تأكيد استلام الدفعة كاملة"} cls={`btn-primary ${isBusy(`pay:${t.id}`) ? "opacity-50 pointer-events-none" : ""}`} onClick={() => {
                                    const amt = Number(t.rent_amount) || 0;
                                    if (confirm(`تسجيل استلام دفعة كاملة؟\n\n${sar(amt)} ريال من ${t.name} — ${ul} ${t.unit || "—"} — ${active?.name}\n\nتاريخ السداد: اليوم (${today()})\nلتاريخ مختلف أو مرجع حوالة استعمل زر ½.\n\n(تُسجَّل باسمك في سجل العمليات)`)) recordPayment(t, amt);
                                  }}>&#10004;</QuickBtn>}
                                  {canCollect && <QuickBtn title="سداد جزئي" cls="btn-ghost" onClick={() => setPaying(t)}>&#189;</QuickBtn>}
                                  <a href={remindLink(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs px-2.5" title="إرسال تذكير واتساب" onClick={(e) => { e.preventDefault(); openExternal(remindLink(t)); }}>&#128172;</a>
                                </>)}
                                <RowMenu items={[
                                  /* ثلاث مجموعات بترتيب الاستعمال لا بترتيب البناء:
                                     ما يُطبع · ما يُرسل · ما يغيّر العقد. */
                                  { sep: "📄 مستندات" } as any,
                                  { label: "كشف حساب شامل", run: () => openStatement(t, "full") },
                                  { label: "كشف حساب مختصر", run: () => openStatement(t, "brief") },
                                  ...(may("issue_invoices") ? [{ label: "فاتورة", run: () => openInvoice(t) }] : []),
                                  { label: "جدول الدفعات", run: () => setSchedule(t) },
                                  { label: "سجل المدفوعات", run: () => openHistory(t) },
                                  ...(isVacant(t) ? [{ label: "مخالصة الإخلاء", run: () => openSettlement(t) }] : []),

                                  { sep: "✉️ مراسلة" } as any,
                                  ...(st.unpaid > 0 && may("send_reminders") ? [{ label: "خطاب إشعار رسمي", run: () => makeNotice(t) }] : []),
                                  { label: "ناقش مع الفريق", run: () => window.dispatchEvent(new CustomEvent("watheq:chat", { detail: { propertyId: active?.id, propertyName: active?.name, tenantId: t.id, tenantName: t.name, unit: t.unit } })) },

                                  ...(may("edit_tenants") || may("renew_contracts") || may("move_out") || may("undo_actions") || isManager
                                    ? [{ sep: "🔧 العقد" } as any] : []),
                                  ...(may("edit_tenants") ? [{ label: "تعديل البيانات", run: () => setModal({ kind: "tenant", id: t.id }) }] : []),
                                  ...(needsRenewal(t) && may("renew_contracts") ? [{ label: "تجديد العقد", run: () => setRenewing(t) }] : []),
                                  ...(may("move_out") && !isVacant(t) ? [{ label: "إنهاء العقد وإخلاء", run: () => setTurnover(t) }] : []),
                                  ...(isManager && !t.litigation && st.unpaid > 0 ? [{ label: "رفع للتنفيذ القضائي", run: () => setEnforcing(t) }] : []),
                                  ...(may("undo_actions") && (t.paid_periods || 0) > 0 ? [{ label: "↩︎ تراجع عن آخر دفعة", run: () => undoPayment(t), danger: true }] : []),
                                  ...(may("undo_actions") ? [{ label: "🗑 حذف الوحدة", run: () => deleteTenant(t.id), danger: true }] : []),
                                ]} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-paper border-t border-line text-xs text-muted">
                        <tr>
                          <td className="px-3 py-2" colSpan={2}>عرض {slice.length} من {rows.length}{rows.length !== allRows.length ? ` (من ${allRows.length})` : ""}</td>
                          <td className="px-3 py-2 whitespace-nowrap">الدخل المتوقع: {sar(Math.round(annualIncome))} سنويًّا · {sar(Math.round(monthlyIncome))} شهريًّا</td>
                          <td className="px-3 py-2 whitespace-nowrap" colSpan={2}>{nearest ? `أقرب استحقاق: ${nearest}` : "—"}</td>
                          <td className={`px-3 py-2 text-left font-bold ${totalDue > 0 ? "text-late" : ""}`}>{totalDue > 0 ? <>{sar(totalDue)}<div className="text-[10px] font-normal text-muted">إجمالي المتأخر</div></> : "—"}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {pages > 1 && (
                    <div className="flex items-center justify-center gap-2 py-2 border-t border-line text-xs">
                      <button className="btn btn-ghost text-xs" disabled={page === 0} onClick={() => setTPage(page - 1)}>‹ السابق</button>
                      <span className="text-muted">صفحة {page + 1} من {pages}</span>
                      <button className="btn btn-ghost text-xs" disabled={page >= pages - 1} onClick={() => setTPage(page + 1)}>التالي ›</button>
                    </div>
                  )}
                </div>
              );
            })() : rows.slice(0, cardsShown).map(({ t, st, key }) => (
              <div key={t.id} className={`rounded-xl border p-3 ${key === "litigation" ? "border-[#CBD5E1] bg-[#F8FAFC]" : "border-line bg-paper"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-9 h-9 rounded-lg bg-paper2 grid place-items-center font-semibold text-deep shrink-0">{(t.name || "?").charAt(0)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{t.name}</div>
                      <div className="text-xs text-muted">
                        {t.unit_type ? UNIT_TYPES[t.unit_type] || ul : ul} {t.unit || "—"} · {sar(t.rent_amount)} ريال / {freqShort(t.payment_frequency)}{(t.rooms || t.baths || t.acs) ? <span className="text-[11px]"> · {[t.rooms ? `${t.rooms} غرف` : "", t.baths ? `${t.baths} دورات مياه` : "", t.acs ? `${t.acs} مكيف` : ""].filter(Boolean).join(" · ")}</span> : null}
                        {t.contract_no && <> · عقد <span dir="ltr">{t.contract_no}</span></>}
                        {msgCount[t.id] > 0 && <span className="ms-1 text-[10px] bg-deep text-goldSoft rounded-full px-1.5 py-0.5" title="رسائل الفريق على هذه الوحدة">💬 {msgCount[t.id]}</span>}
                      </div>
                      {active && unitVatApplies(t, active) && (() => { const v = splitVat(Number(t.rent_amount) || 0, vat); return (
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
                        : key === "due" ? <span className="text-[#9A4B00] font-semibold">{st.statusLabel}{st.nextDueDate ? <span className="font-normal text-muted"> · {st.nextDueDate}</span> : null}</span>
                        : key === "expiring" && st.daysToEnd !== null ? <span className="text-[#5B21B6] font-semibold">ينتهي بعد {st.daysToEnd} يوم</span>
                        : key === "litigation" ? <span className="text-[#475569]">{t.enforcement_no ? `طلب ${t.enforcement_no}` : "متابعة نظامية"}</span>
                        : st.fullyPaid ? <span className="text-[#137a50] font-semibold">✓ سدّد كامل العقد ({st.paid} من {t.contract_periods || st.paid}){st.endDate ? <span className="font-normal text-muted"> · ينتهي {st.endDate}{st.daysToEnd !== null && st.daysToEnd >= 0 ? ` (بعد ${st.daysToEnd} يوم)` : ""} — القسط القادم مع التجديد</span> : null}</span>
                        : st.nextDueDate ? <span className="text-muted">القادمة {st.nextDueDate}{st.nextDueDate ? ` · ${hijriShort(st.nextDueDate)}` : ""}</span> : null}
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
                      <QuickBtn title="تأكيد استلام الدفعة كاملة" cls="btn-primary" onClick={() => {
                        /* دفعة بضغطة واحدة بلا تأكيد = أخطاء لا تُكتشف إلا في كشف المالك. نسمّي المبلغ والمستأجر والوحدة قبل التسجيل */
                        const amt = Number(t.rent_amount) || 0;
                        if (confirm(`تسجيل استلام دفعة كاملة؟\n\n${sar(amt)} ريال من ${t.name} — ${ul} ${t.unit || "—"} — ${active?.name}\n\nتاريخ السداد: اليوم (${today()})\nلتاريخ مختلف أو مرجع حوالة استعمل زر ½.\n\n(تُسجَّل باسمك في سجل العمليات)`)) recordPayment(t, amt);
                      }}>&#10004;</QuickBtn>
                      <QuickBtn title="سداد جزئي" cls="btn-ghost" onClick={() => setPaying(t)}>&#189;</QuickBtn>
                      <a href={remindLink(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs px-2.5" title="إرسال تذكير واتساب" onClick={(e) => { e.preventDefault(); openExternal(remindLink(t)); }}>&#128172;</a>
                      {t.phone && <a href={`tel:${String(t.phone).replace(/[^0-9+]/g, "")}`} className="btn btn-ghost text-xs px-2.5 sm:hidden" title="اتصال مباشر">&#128222;</a>}
                      <QuickBtn title="إصدار فاتورة" cls="btn-ghost" onClick={() => openInvoice(t)}>&#128196;</QuickBtn>
                      {st.unpaid > 0 && <button className="btn btn-gold text-xs" onClick={() => makeNotice(t)}>نموذج إشعار</button>}
                      {needsRenewal(t) && <button className="btn text-xs" style={{ background: "#0E3A37", color: "#F6F1E4" }} onClick={() => setRenewing(t)}>تجديد</button>}
                    </>
                  )}
                  <RowMenu
                    items={[
/* نفس ترتيب الجدول حرفيًّا: المستخدم لا يتعلّم قائمتين */
                      { sep: "📄 مستندات" } as any,
                      { label: "كشف حساب شامل", run: () => openStatement(t, "full") },
                      { label: "كشف حساب مختصر", run: () => openStatement(t, "brief") },
                      ...(may("issue_invoices") ? [{ label: "فاتورة", run: () => openInvoice(t) }] : []),
                      { label: "جدول الدفعات", run: () => setSchedule(t) },
                      { label: "سجل المدفوعات", run: () => openHistory(t) },
                      ...(isVacant(t) ? [{ label: "مخالصة الإخلاء", run: () => openSettlement(t) }] : []),

                      { sep: "✉️ مراسلة" } as any,
                      ...(st.unpaid > 0 && may("send_reminders") ? [{ label: "خطاب إشعار رسمي", run: () => makeNotice(t) }] : []),
                      { label: "ناقش مع الفريق", run: () => window.dispatchEvent(new CustomEvent("watheq:chat", { detail: { propertyId: active?.id, propertyName: active?.name, tenantId: t.id, tenantName: t.name, unit: t.unit } })) },

                      ...(may("edit_tenants") || may("renew_contracts") || may("move_out") || may("undo_actions") || isManager
                        ? [{ sep: "🔧 العقد" } as any] : []),
                      ...(may("edit_tenants") ? [{ label: "تعديل البيانات", run: () => setModal({ kind: "tenant", id: t.id }) }] : []),
                      ...(needsRenewal(t) && may("renew_contracts") ? [{ label: "تجديد العقد", run: () => setRenewing(t) }] : []),
                      ...(may("move_out") && !isVacant(t) ? [{ label: "إنهاء العقد وإخلاء", run: () => setTurnover(t) }] : []),
                      ...(isManager && !t.litigation && st.unpaid > 0 ? [{ label: "رفع للتنفيذ القضائي", run: () => setEnforcing(t) }] : []),
                      ...(may("undo_actions") && (t.paid_periods || 0) > 0 ? [{ label: "↩︎ تراجع عن آخر دفعة", run: () => undoPayment(t), danger: true }] : []),
                      ...(may("undo_actions") ? [{ label: "🗑 حذف الوحدة", run: () => deleteTenant(t.id), danger: true }] : []),
                    ]}
                  />
                </div>
              </div>
            ))}

            {view === "cards" && rows.length > cardsShown && (
              <button className="btn btn-ghost text-sm w-full justify-center" onClick={() => setCardsShown((n) => n + 60)}>
                عرض 60 {ul} إضافية — بقي {rows.length - cardsShown}
              </button>
            )}
            {view === "cards" && tenants.length > 0 && rows.length > 0 && (
              <div className="text-center text-xs text-muted pt-1">عرض {Math.min(cardsShown, rows.length)} من {rows.length}{rows.length !== allRows.length ? ` (من ${allRows.length})` : ""}</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold">📝 سجل العقار <span className="text-xs font-normal text-muted">— ملاحظات الصيانة والتجديد والإخلاء</span></h2></div>
          <div className="p-4">
            <AddNote onAdd={addNote} unitWord={ul} />
            {(() => {
              /* المهام المفتوحة أولًا مرتّبة بموعدها، ثم بقية السجل — القائمة
                 التي لا تُرتّب بالإلحاح تُقرأ مرة وتُهمل. */
              const open = notes.filter((n) => !n.done_at && n.due_date)
                .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
              const rest = notes.filter((n) => n.done_at || !n.due_date);
              const t0 = today();
              if (!notes.length) return <div className="text-center text-muted py-6 text-sm">لا ملاحظات بعد.</div>;
              const row = (n: Note) => {
                const late = !n.done_at && n.due_date && n.due_date < t0;
                const soon = !n.done_at && n.due_date === t0;
                return (
                  <div key={n.id} className={`flex items-start gap-2.5 py-2.5 border-b border-dashed border-line last:border-0 text-sm ${n.done_at ? "opacity-55" : ""}`}>
                    <button className={`mt-0.5 w-4 h-4 rounded border shrink-0 grid place-items-center text-[10px] ${n.done_at ? "bg-[#137a50] border-[#137a50] text-white" : "border-line hover:border-deep"}`}
                      title={n.done_at ? "إعادة فتح" : "تمّت"} onClick={() => toggleNote(n)}>{n.done_at ? "✓" : ""}</button>
                    <span className="text-xs font-semibold w-24 shrink-0 tabular-nums">
                      {n.due_date ? (
                        <span className={late ? "text-late" : soon ? "text-[#9A4B00]" : "text-[#8a5a11]"}>
                          {late ? "متأخرة · " : soon ? "اليوم · " : ""}{n.due_date}
                        </span>
                      ) : <span className="text-muted">{n.note_date}</span>}
                    </span>
                    <span className={`flex-1 text-[#33413d] ${n.done_at ? "line-through" : ""}`}>
                      {n.kind && n.kind !== "other" && <span className="me-1">{NOTE_KINDS[n.kind]?.icon}</span>}
                      {n.text}
                    </span>
                    <button className="text-muted opacity-60 hover:opacity-100 hover:text-late text-xs" onClick={() => deleteNote(n.id)}>حذف</button>
                  </div>
                );
              };
              return (
                <>
                  {open.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs font-bold text-deep mb-1">
                        مهام مفتوحة ({open.length})
                        {open.filter((n) => String(n.due_date) < t0).length > 0 &&
                          <span className="text-late font-normal"> · {open.filter((n) => String(n.due_date) < t0).length} متأخرة</span>}
                      </div>
                      {open.map(row)}
                    </div>
                  )}
                  {rest.length > 0 && (
                    <>
                      {open.length > 0 && <div className="text-xs font-bold text-muted mt-3 mb-1">السجل</div>}
                      {rest.map(row)}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* عرض شرطي مقصود: النموذج يُفكَّك عند الإغلاق فتُمحى حقوله.
          كان يبقى مركَّبًا ويكتفي بإخفاء نفسه، فتبقى بيانات آخر إدخال ظاهرة
          في المرة التالية — لأن useState لا يُعاد تشغيله إلا عند التركيب. */}
      {modal?.kind === "newProp" && (
        <PropertyModal open orgName={orgName} ownerNames={ownerNames} officeSoon={officeSoon} officeImminent={officeImminent} officeExpiring={officeExpiring} onClose={() => setModal(null)} onSubmit={(d) => saveProperty(d)} />
      )}
      {modal?.kind === "editProp" && active && (
        <PropertyModal open initial={active} orgName={orgName} ownerNames={ownerNames} officeSoon={officeSoon} officeImminent={officeImminent} officeExpiring={officeExpiring}
          onClose={() => setModal(null)} onSubmit={(d) => saveProperty(d, active.id)} onDelete={deleteProperty} />
      )}
      {modal?.kind === "tenant" && (
        <TenantModal open initial={editing} unitWord={ul} error={saveErr} saving={saving}
          onClose={() => setModal(null)} onSubmit={(d) => saveTenant(d, editing?.id)} />
      )}

      {quoteOpen && active && (
        <QuoteModal property={active} unitWord={ul} issuer={issuer || {}} onClose={() => setQuoteOpen(false)} />
      )}

      {ownerStmtOpen && <OwnerStatementModal properties={items} issuer={issuer} onClose={() => setOwnerStmtOpen(false)} />}
      {logOpen && <ActivityLog properties={items} onClose={() => setLogOpen(false)} />}
      {/* الصفحة العامة ترسم دليلها بنفسها — لا نكرّره هنا */}
      {hasDemo && !demo && <DemoGuide onEvent={onGuideEvent} />}
      {stmtOpen && active && <PropertyStatementModal propertyName={active.name} onClose={() => setStmtOpen(false)} onIssue={openPropertyStatement} />}

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
        <OwnerLinkModal propertyId={active.id} propertyName={active.name} ownerName={active.owner_name} onClose={() => setOwnerLinkOpen(false)} />
      )}

      {schedule && <ScheduleModal tenant={schedule} unitWord={ul} onClose={() => setSchedule(null)} />}
      {renewing && <RenewModal key={renewing.id} tenant={renewing} unitWord={ul} onClose={() => setRenewing(null)} onRenew={(o) => doRenew(renewing, o)} />}
      {enforcing && <EnforcementModal tenant={enforcing} unitWord={ul}
        onClose={() => setEnforcing(null)}
        onSubmit={(no, order) => { patchTenant(enforcing.id, { litigation: true, enforcement_no: no || null, enforcement_order: order || null }); setEnforcing(null); }} />}
      {paying && <PaymentModal tenant={paying} unitWord={ul} onClose={() => setPaying(null)}
        onSubmit={(amt, method, note, paidOn, reference) => { recordPayment(paying, amt, method, note, paidOn, reference); setPaying(null); }} />}
      {turnover && <TurnoverModal key={turnover.id} tenant={turnover} unitWord={ul} onClose={() => setTurnover(null)}
        onSubmit={(d) => saveTurnover(turnover, d)} />}
      {history && <HistoryModal data={history} unitWord={ul} canEdit={may("record_payments")} onClose={() => setHistory(null)} />}
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
      className={`btn wq-quick ${cls} text-xs px-2.5`}>{children}</button>
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
  onSubmit: (amount: number, method: string, note?: string, paidOn?: string, reference?: string) => void;
}) {
  const rent = Number(tenant.rent_amount) || 0;
  const already = Number(tenant.partial_amount) || 0;
  const remaining = Math.max(0, rent - already);
  const [amount, setAmount] = useState<string>(String(remaining || rent));
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");
  /* تاريخ وصول المال ومرجع الحوالة — أساس مطابقة كشف البنك */
  const [paidOn, setPaidOn] = useState(today());
  const [reference, setReference] = useState("");
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
        {/* تاريخ وصول المال لا تاريخ إدخاله: المستأجر يحوّل الخميس والمكتب
            يسجّل الأحد، فيبحث في كشف البنك عن حوالة الأحد ولا يجدها. */}
        <Field label="تاريخ السداد" hint="يوم وصول المال — لا يوم التسجيل">
          <DateField value={paidOn} onChange={(v) => v && setPaidOn(v)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="مرجع الحوالة" hint="آخر أرقام العملية — لمطابقة كشف البنك">
          <input className="fld" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="…4417" />
        </Field>
        <Field label="ملاحظة" hint="اختياري">
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder="سداد شهر رجب" />
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
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!amt} onClick={() => onSubmit(amt, method, note.trim() || undefined, paidOn, reference.trim() || undefined)}>تسجيل</button>
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
          <DateField value={d.notice_date} onChange={(v) => set("notice_date", v)} />
        </Field>
        <Field label="تاريخ الإخلاء الفعلي">
          <DateField value={d.move_out_date} onChange={(v) => set("move_out_date", v)} />
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
/**
 * سجل المدفوعات — مع تصحيح تاريخ الحوالة ومرجعها.
 *
 * زر ✔ السريع يسجّل بتاريخ اليوم لأنه الغالب. لكن من يراجع كشف بنكه بعد
 * أسبوع يحتاج تصحيح تاريخ وصول المال أو إضافة مرجعه — بلا مساس بالمبلغ
 * (تغييره يفسد عدّاد الدفعات). القاعدة تسمح بهذين العمودين فقط.
 */
function HistoryModal({ data, unitWord, onClose, canEdit = true }: {
  data: { tenant: Tenant; rows: any[] }; unitWord: string; onClose: () => void; canEdit?: boolean;
}) {
  const { tenant } = data;
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<any[]>(data.rows);
  const [editing, setEditing] = useState<string | null>(null);
  const [eDate, setEDate] = useState("");
  const [eRef, setERef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function saveEdit(id: string) {
    setBusy(true); setErr(null);
    const { data: up, error } = await supabase.from("payments")
      .update({ paid_on: eDate || null, reference: eRef.trim() || null })
      .eq("id", id).select("id, paid_on, reference");
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (!up?.length) { setErr("هذا التعديل يحتاج صلاحية أعلى."); return; }
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, paid_on: up[0].paid_on, reference: up[0].reference } : r)));
    setEditing(null);
  }

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return (
    <Shell onClose={onClose} wide>
      <h3 className="font-display font-bold text-deep text-lg mb-1">سجل المدفوعات — {tenant.name}</h3>
      <p className="text-sm text-muted mb-4">{unitWord} {tenant.unit || "—"} · {rows.length} عملية · الإجمالي {sar(total)} ريال</p>
      {err && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-2.5 text-xs mb-3">{err}</div>}

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
              <th className="p-2 text-right font-semibold">المرجع</th>
              <th className="p-2 text-right font-semibold">اكتملت</th>
              <th className="p-2 text-right font-semibold">ملاحظة</th>
              {canEdit && <th className="p-2"></th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="p-2 tabular-nums">
                    {editing === r.id
                      ? <input className="fld !py-0.5 !text-xs !w-32" type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} />
                      : r.paid_on}
                    {r.created_at && String(r.created_at).slice(0, 10) !== String(r.paid_on) && (
                      <div className="text-[10px] text-muted">سُجّل {String(r.created_at).slice(0, 10)}</div>
                    )}
                  </td>
                  <td className="p-2 tabular-nums font-semibold">{sar(r.amount)}</td>
                  <td className="p-2">{methodLabel(r.method)}</td>
                  {/* المرجع ووقت التسجيل: مطابقة كشف البنك تحتاج الاثنين —
                      تاريخ وصول المال أعلاه، ولحظة إدخاله هنا للتدقيق. */}
                  <td className="p-2 tabular-nums text-xs" dir="ltr">
                    {editing === r.id
                      ? <input className="fld !py-0.5 !text-xs !w-24" dir="ltr" value={eRef} onChange={(e) => setERef(e.target.value)} placeholder="المرجع" />
                      : (r.reference || "—")}
                  </td>
                  <td className="p-2 text-muted">{r.periods_covered || "—"}</td>
                  <td className="p-2 text-muted text-xs">{r.note || "—"}</td>
                  {canEdit && (
                    <td className="p-2 whitespace-nowrap">
                      {editing === r.id ? (
                        <span className="flex gap-1">
                          <button className="btn btn-primary text-[10px] px-2 py-0.5" disabled={busy} onClick={() => saveEdit(r.id)}>حفظ</button>
                          <button className="btn btn-ghost text-[10px] px-2 py-0.5" onClick={() => setEditing(null)}>إلغاء</button>
                        </span>
                      ) : (
                        <button className="btn btn-ghost text-[10px] px-2 py-0.5"
                          onClick={() => { setEditing(r.id); setEDate(String(r.paid_on || "").slice(0, 10)); setERef(r.reference || ""); }}
                          title="تصحيح تاريخ وصول الحوالة أو مرجعها — المبلغ لا يُعدَّل">✎ تاريخ/مرجع</button>
                      )}
                    </td>
                  )}
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
/**
 * زر بقائمة — لتجميع الأدوات بدل نشرها في شريط طويل.
 * مثبّت بإحداثيات الشاشة كقائمة الصف، فلا يقصّه أي إطار متمرّر.
 */
function MenuBtn({ label, items, badge = 0 }: {
  label: string;
  items: { label: string; run?: () => void; href?: string }[];
  badge?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const H = Math.min(items.length * 34 + 16, 300);
      const W = 210;                       // عرض القائمة الأدنى
      const below = window.innerHeight - r.bottom;
      /* على الجوال يقع الزر قرب الحافة، فتخرج القائمة خارج الشاشة ويُقصّ نصفها.
         نحاذيها بيمين الزر ونقصّها داخل حدود النافذة. */
      const left = Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8);
      setPos({ top: below > H + 12 ? r.bottom + 4 : Math.max(8, r.top - H - 4), left: Math.max(8, left) });
    }
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open, items.length]);
  if (!items.length) return null;
  return (
    <>
      <button ref={ref} type="button" className="btn btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>
        {label} <span className="opacity-60">▾</span>
        {badge > 0 && <span className="mr-1 inline-grid place-items-center min-w-[18px] h-4 px-1 rounded-full bg-[#FBE9E7] text-[#a5322c] text-[.62rem] font-bold">{badge}</span>}
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 min-w-[210px] max-w-[calc(100vw-16px)] bg-white border border-line rounded-xl shadow-lg py-1">
            {items.map((it, i) => it.href ? (
              <Link key={i} href={it.href} className="block px-3.5 py-2 text-xs font-semibold text-deep hover:bg-paper2">{it.label}</Link>
            ) : (
              <button key={i} type="button" onClick={() => { setOpen(false); it.run?.(); }}
                className="block w-full text-right px-3.5 py-2 text-xs font-semibold text-deep hover:bg-paper2">{it.label}</button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function RowMenu({ items }: { items: { label?: string; run?: () => void; danger?: boolean; sep?: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  /**
   * القائمة تُثبَّت بإحداثيات الشاشة لا داخل الصف.
   *
   * جدول الوحدات له تمرير رأسي (لتثبيت الترويسة)، وأي قائمة منسدلة داخله
   * يقصّها إطاره — فصفوف أسفل الشاشة تفتح قائمة نصفها مخفي. بالتثبيت على
   * الشاشة تخرج من الإطار، وتنقلب للأعلى إن ضاق ما تحتها.
   */
  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const H = Math.min(items.length * 30 + 24, 320);
    const W = 190;
    const below = window.innerHeight - r.bottom;
    const top = below > H + 12 ? r.bottom + 4 : Math.max(8, r.top - H - 4);
    /* داخل حدود الشاشة دائمًا — على الجوال كانت تُقصّ من الحافة */
    const left = Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8);
    setPos({ top, left: Math.max(8, left) });
  }
  useEffect(() => {
    if (!open) return;
    place();
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);   // التمرير يغلقها بدل أن تطير
    return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!items.length) return null;
  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={() => setOpen((v) => !v)} aria-label="إجراءات أخرى"
        className="btn btn-ghost text-xs px-2.5" title="المزيد">⋯</button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 min-w-[190px] max-w-[calc(100vw-16px)] max-h-[70vh] overflow-y-auto bg-white border border-line rounded-xl shadow-lg py-1">
            {items.map((it, i) => it.sep ? (
              /* لا نعرض عنوان قسم لا عناصر بعده — يحدث مع الموظف محدود الصلاحيات */
              items.slice(i + 1).findIndex((x) => !x.sep) === -1 ? null : (
              /* عنوان قسم: تسع خيارات متساوية تُقرأ ببطء — التقسيم يجعل العين تقفز */
              <div key={i} className="px-3.5 pt-2 pb-1 text-[10px] font-bold text-muted border-t border-line first:border-0 first:pt-1">{it.sep}</div>
              )
            ) : (
              <button key={i} type="button"
                onClick={() => { setOpen(false); it.run?.(); }}
                className={`block w-full text-right px-3.5 py-1.5 text-xs font-semibold hover:bg-paper2 transition ${it.danger ? "text-late" : "text-deep"}`}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


/**
 * إضافة ملاحظة أو مهمة.
 *
 * الملاحظة بلا موعد توثيق يُقرأ حين يُبحث عنه؛ ومع موعد تصير متابعة تأتي
 * إليك — تظهر على بطاقة العقار وفي ملخّص تليجرام الصباحي حتى تُغلق.
 */
function AddNote({ onAdd, unitWord }: {
  onAdd: (t: string, extra?: { due_date?: string | null; kind?: string }) => void;
  unitWord: string;
}) {
  const [t, setT] = useState("");
  const [kind, setKind] = useState("maintenance");
  const [due, setDue] = useState("");
  const submit = () => { if (t.trim()) { onAdd(t, { due_date: due || null, kind }); setT(""); setDue(""); } };
  return (
    <div className="border border-line rounded-xl p-3 mb-3 bg-paper">
      <div className="flex gap-2 mb-2">
        <input className="fld" value={t} onChange={(e) => setT(e.target.value)}
          placeholder={`ما الذي حدث أو يجب عمله؟ (تسريب في ${unitWord} 12 · تجديد رخصة · دهان السلالم)`}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <button className="btn btn-primary text-sm shrink-0" onClick={submit}>حفظ</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {Object.entries(NOTE_KINDS).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`text-[11px] px-2 py-1 rounded-full border ${kind === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted ms-auto">
          ذكّرني في
          <input className="fld !py-1 !text-xs !w-36" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <p className="text-[10px] text-muted mt-1.5">
        بموعد: تصير مهمة تظهر على العقار وفي ملخّص تليجرام حتى تُغلق · بلا موعد: ملاحظة في السجل فقط.
      </p>
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

function PropertyModal({ open, initial, orgName, ownerNames = [], officeSoon = 10, officeImminent = 5, officeExpiring = 60, onClose, onSubmit, onDelete }: {
  open: boolean; initial?: Property; orgName: string; ownerNames?: string[]; officeSoon?: number; officeImminent?: number; officeExpiring?: number; onClose: () => void;
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
        <Field label="استخدام العقار" hint="يظهر في المستندات والإعلانات">
          <select className="fld" value={d.usage || ""} onChange={(e) => setD({ ...d, usage: e.target.value })}>
            <option value="">— غير محدد —</option>
            {Object.entries(PROPERTY_USAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="تنبيه انتهاء العقد قبله بـ (يوم)" hint={`فارغ = افتراضي المكتب (${officeExpiring} يوم) — يظهر باللون الأحمر ضمن «ينتهي قريبًا»`}>
          <input className="fld" type="number" min={1} max={180} value={d.expiring_days ?? ""} onChange={(e) => setD({ ...d, expiring_days: e.target.value === "" ? null : Number(e.target.value) })} placeholder={String(officeExpiring)} />
        </Field>
        <Field label="نافذة «قريب» لهذا العقار" hint={`فارغ = افتراضي المكتب (${officeSoon} يوم)`}>
          <input className="fld" type="number" min={1} max={60} value={d.soon_days ?? ""} onChange={(e) => setD({ ...d, soon_days: e.target.value === "" ? null : Number(e.target.value) })} placeholder={`افتراضي المكتب: ${officeSoon}`} />
        </Field>
        <Field label="نافذة «مستحق» لهذا العقار" hint={`فارغ = افتراضي المكتب (${officeImminent} يوم) — يجب أن تكون أقل من «قريب»`}>
          <input className="fld" type="number" min={1} max={60} value={d.imminent_days ?? ""} onChange={(e) => setD({ ...d, imminent_days: e.target.value === "" ? null : Number(e.target.value) })} placeholder={`افتراضي المكتب: ${officeImminent}`} />
        </Field>
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

function TenantModal({ open, initial, unitWord, error, saving, onClose, onSubmit }: {
  open: boolean; initial?: Tenant; unitWord: string; onClose: () => void; onSubmit: (d: any) => void;
  /** سبب فشل الحفظ — يُعرض بجانب الزر لا في أعلى الصفحة */
  error?: string | null;
  saving?: boolean;
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
          <Field label="بداية العقد">
          <DateField value={d.contract_start || ""} onChange={(v, mode) => setD({ ...d, contract_start: v,
            /* أدخل التاريخ بالهجري؟ إذن عقده هجري وأقساطه تُحسب بالأشهر الهجرية —
               كان يجب عليه تغيير خانة ثانية بنفسه، فينسى وتخرج الاستحقاقات منحرفة أيامًا */
            ...(mode ? { calendar: mode === "h" ? "hijri" : "gregorian", _calAuto: true } : {}) })} /></Field>
        <Field label="أول تاريخ استحقاق" hint="اختياري — الافتراضي أن أول دفعة تستحق يوم بداية العقد. املأه فقط إن كان يختلف (يبدأ 1/1 والدفعة الأولى 5/1). بقية الدفعات تُعدّ منه">
          <DateField value={d.first_due || ""} onChange={(v) => setD({ ...d, first_due: v })} />
        </Field>
        <Field label="تُحسب الأقساط بالتقويم" hint={d._calAuto ? `ضُبط تلقائيًّا لأنك أدخلت البداية بالتقويم ${d.calendar === "hijri" ? "الهجري" : "الميلادي"} — غيّره إن كان العقد مكتوبًا بالتقويم الآخر` : "عقد مكتوب بالهجري (كل 6 أشهر هجرية) اختر هجري — وإلا يزحف الاستحقاق أيامًا كل قسط"}>
          <select className="fld" value={d.calendar || "gregorian"} onChange={(e) => setD({ ...d, calendar: e.target.value, _calAuto: false })}>
            <option value="gregorian">ميلادي — الأشهر الميلادية</option>
            <option value="hijri">هجري — الأشهر الهجرية (أم القرى)</option>
          </select>
        </Field>
          <Field label="عدد الدفعات — وهو ما يحدد مدة العقد" hint={(() => {
            /* عدد الدفعات هو مدة العقد فعليًّا: 24 دفعة شهرية = سنتان، و6 = نصف
               سنة. كان الحقل يقول «فارغ = سنة» فقط، فيظنّ المكتب أن العقود
               السنوية وحدها مدعومة. الآن يرى المدة والنهاية وهو يكتب. */
            const n = Number(d.contract_periods) || 0;
            const f = (d.payment_frequency || "monthly") as Frequency;
            if (!n) return "فارغ = سنة كاملة. اكتب 24 لعقد سنتين، أو 6 لعقد نصف سنة.";
            const months = n * ({ daily: 0, weekly: 0, monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as any)[f];
            const dur = !months ? `${n} دفعة`
              : months % 12 === 0 ? plural(months / 12, "سنة واحدة", "سنتان", "سنوات", "سنة")
              : months < 12 ? plural(months, "شهر واحد", "شهران", "أشهر", "شهرًا")
              : `${plural(Math.floor(months / 12), "سنة", "سنتان", "سنوات", "سنة")} و${plural(months % 12, "شهر", "شهران", "أشهر", "شهرًا")}`;
            const end = d.contract_start ? derivedEndDate(d.contract_start, f, n, null, d.calendar === "hijri" ? "hijri" : "gregorian") : null;
            return `المدة: ${dur}${end ? ` · ينتهي ${end}` : ""}`;
          })()}>
            <input className="fld" type="number" min={1} value={d.contract_periods || ""} onChange={(e) => setD({ ...d, contract_periods: e.target.value })} placeholder="12" />
          </Field>
        </div>
        <Field label="رقم الهوية / السجل" hint="للخطابات"><input className="fld" value={d.national_id || ""} onChange={(e) => setD({ ...d, national_id: e.target.value })} /></Field>
        <Field label="دين مرحَّل (ريال)" hint="متأخرات من عقد سابق أو مستأجر سابق — تظهر في الكشوف ولا تدخل في دفعات العقد الجاري">
          <input className="fld" type="number" min={0} value={d.carried_debt ?? ""} onChange={(e) => setD({ ...d, carried_debt: e.target.value })} placeholder="0" />
        </Field>
        <Field label="ضريبة القيمة المضافة لهذه الوحدة" hint="العمارة المختلطة: السكني معفى والتجاري خاضع — «تلقائي» يقرّر بحسب نوع الوحدة">
          <select className="fld" value={d.vat_mode || "auto"} onChange={(e) => setD({ ...d, vat_mode: e.target.value })}>
            <option value="auto">تلقائي — بحسب نوع الوحدة</option>
            <option value="on">تُطبَّق دائمًا</option>
            <option value="off">معفاة</option>
          </select>
        </Field>
        <Field label="نوع الوحدة" hint="يظهر في المستندات ومخالصة الإخلاء">
          <select className="fld" value={d.unit_type || ""} onChange={(e) => setD({ ...d, unit_type: e.target.value })}>
            <option value="">— بحسب العقار —</option>
            {Object.entries(UNIT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="الغرف"><input className="fld" type="number" min={0} value={d.rooms ?? ""} onChange={(e) => setD({ ...d, rooms: e.target.value })} /></Field>
          <Field label="دورات المياه"><input className="fld" type="number" min={0} value={d.baths ?? ""} onChange={(e) => setD({ ...d, baths: e.target.value })} /></Field>
          <Field label="المكيفات"><input className="fld" type="number" min={0} value={d.acs ?? ""} onChange={(e) => setD({ ...d, acs: e.target.value })} /></Field>
        </div>
        <Field label="رقم العقد" hint="رقمه لديكم أو في «إيجار» — يظهر في كشوف الحساب والخطابات"><input className="fld" dir="ltr" value={d.contract_no || ""} onChange={(e) => setD({ ...d, contract_no: e.target.value })} /></Field>
        {/* كان يظهر عند الإضافة فقط، فمن أخطأ في الرقم — أو استورده خطأً من
            إكسل — لا يستطيع تصحيحه من اللوحة إطلاقًا، وتبقى الوحدة تشير إلى
            دفعة خاطئة أبدًا. الآن يظهر في الحالتين بنصّ يناسب كلًّا منهما. */}
        <Field label="دفعات سُدّدت حتى اليوم"
          hint={initial
            ? "صحّحه إن كان الرقم غلطًا. الدفعات المسجَّلة بزر ✔ تُضاف فوقه تلقائيًّا"
            : "للعقد القائم — عقد شهري من يناير مدفوع حتى أغسطس = 8. عقد جديد = 0"}>
          <input className="fld" type="number" min={0} value={d.paid_periods ?? ""}
            onChange={(e) => setD({ ...d, paid_periods: e.target.value })} placeholder="0" />
          {Number(d.paid_periods) > 0 && Number(d.contract_periods) > 0 && (
            <span className="block text-[11px] text-muted mt-1">
              {Number(d.paid_periods) > Number(d.contract_periods)
                ? `⚠️ أكبر من مدة العقد (${d.contract_periods} دفعة) — سداد مقدَّم لمدة قادمة؟`
                : `المتبقي ${Number(d.contract_periods) - Number(d.paid_periods)} دفعة من ${d.contract_periods}`}
            </span>
          )}
        </Field>
        <details className="mt-3 border border-line rounded-xl p-3 bg-paper">
          <summary className="cursor-pointer text-sm font-semibold text-deep">⚡ المرافق — حساب الكهرباء والماء وقراءات التسليم</summary>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <Field label="رقم حساب الكهرباء" hint="ثابت للوحدة — يُستخدم في الاستعلام ونقل الخدمة">
              <input className="fld" dir="ltr" value={d.elec_account || ""} onChange={(e) => setD({ ...d, elec_account: e.target.value })} placeholder="رقم الحساب في شركة الكهرباء" />
            </Field>
            <Field label="رقم حساب الماء" hint="ثابت للوحدة">
              <input className="fld" dir="ltr" value={d.water_account || ""} onChange={(e) => setD({ ...d, water_account: e.target.value })} placeholder="رقم الحساب في المياه الوطنية" />
            </Field>
            <Field label="قراءة عدّاد الكهرباء عند التسليم" hint="تظهر في مخالصة الإخلاء مقابل قراءة الخروج">
              <input className="fld" dir="ltr" value={d.meter_elec_in || ""} onChange={(e) => setD({ ...d, meter_elec_in: e.target.value })} />
            </Field>
            <Field label="قراءة عدّاد الماء عند التسليم">
              <input className="fld" dir="ltr" value={d.meter_water_in || ""} onChange={(e) => setD({ ...d, meter_water_in: e.target.value })} />
            </Field>
          </div>
        </details>
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
      {/* سبب الفشل بجانب الزر: الإشعار العائم في أعلى الصفحة لا يراه من كان
          منزلًا داخل النموذج على الجوال، فيظن أن الزر لا يعمل. */}
      {error && (
        <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mt-4 leading-relaxed">
          <b>لم يُحفظ:</b> {error}
        </div>
      )}
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!(d.name || "").trim() || !!saving}
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
  /* كان الشهر الواحد هو الخيار الوحيد. المالك يطلب الربع والسنة و«منذ
     البداية»، والمكتب يحتاج فترة مخصّصة عند التسليم أو النزاع. */
  const [preset, setPreset] = useState<"month" | "quarter" | "half" | "year" | "all" | "custom">("month");
  const [from, setFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; });
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState<"full" | "brief">("full");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyPreset(k: typeof preset) {
    setPreset(k);
    const n = new Date(); const p2 = (x: number) => String(x).padStart(2, "0");
    const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    if (k === "month") { setFrom(`${n.getFullYear()}-${p2(n.getMonth() + 1)}-01`); setTo(ymd(n)); }
    else if (k === "quarter") { setFrom(ymd(new Date(n.getFullYear(), n.getMonth() - 2, 1))); setTo(ymd(n)); }
    else if (k === "half") { setFrom(ymd(new Date(n.getFullYear(), n.getMonth() - 5, 1))); setTo(ymd(n)); }
    else if (k === "year") { setFrom(`${n.getFullYear()}-01-01`); setTo(ymd(n)); }
    else if (k === "all") { setFrom("2000-01-01"); setTo(ymd(n)); }
  }
  const valid = !!from && !!to && from <= to;
  const label = preset === "all" ? "منذ البداية حتى اليوم"
    : preset === "month" ? `${AR_MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`
    : preset === "year" ? `سنة ${from.slice(0, 4)}`
    : `${arDate(from)} — ${arDate(to)}`;

  async function issue() {
    if (!valid) return;
    setLoading(true); setErr(null);

    // دفعات العقار الموثّقة خلال الشهر — نفس السجل الذي يغذّي كشف حساب المستأجر
    const { data, error } = await supabase.from("payments")
      .select("id,paid_on,amount,method,periods_covered,note,tenant_id")
      .eq("property_id", property.id)
      .gte("paid_on", from).lte("paid_on", to)
      .order("paid_on", { ascending: true }).limit(5000);
    setLoading(false);
    if (error) { setErr(error.message); return; }

    const byId: Record<string, Tenant> = {};
    (property.tenants || []).forEach((t) => { byId[t.id] = t; });
    const payments: OwnerReportPayment[] = (data || []).map((x: any) => ({
      id: x.id, paid_on: x.paid_on, amount: x.amount, method: x.method, reference: x.reference, created_at: x.created_at,
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
      { expenses, fee_pct: (property as any).mgmt_fee_pct }, mode));
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
        <div>
          <label className="block text-sm font-semibold mb-1.5">الفترة</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {([["month", "هذا الشهر"], ["quarter", "آخر 3 أشهر"], ["half", "آخر 6 أشهر"],
               ["year", "هذه السنة"], ["all", "منذ البداية"], ["custom", "من — إلى"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => (k === "custom" ? setPreset("custom") : applyPreset(k))}
                className={`text-xs px-3 py-1.5 rounded-full border ${preset === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-xs text-muted mb-1">من تاريخ</span>
              <DateField value={from} onChange={(v) => { if (v) { setFrom(v); setPreset("custom"); } }} />
            </div>
            <div>
              <span className="block text-xs text-muted mb-1">إلى تاريخ</span>
              <DateField value={to} onChange={(v) => { if (v) { setTo(v); setPreset("custom"); } }} />
            </div>
          </div>
          {!valid && <p className="text-xs text-late mt-1">تاريخ البداية بعد تاريخ النهاية.</p>}
          {valid && <p className="text-[11px] text-muted mt-1">سيصدر عن: <b className="text-deep">{label}</b></p>}
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1.5">مستوى التفصيل</label>
          <div className="inline-flex border border-line rounded-lg p-0.5 text-xs">
            <button type="button" onClick={() => setMode("full")} className={`px-3 py-1.5 rounded-md ${mode === "full" ? "bg-deep text-goldSoft" : "text-muted"}`}>شامل</button>
            <button type="button" onClick={() => setMode("brief")} className={`px-3 py-1.5 rounded-md ${mode === "brief" ? "bg-deep text-goldSoft" : "text-muted"}`}>مختصر</button>
          </div>
          <p className="text-[11px] text-muted mt-1">
            {mode === "full" ? "الشامل: جدول كل وحدة بمواصفاتها وعقدها وحالتها، وتفصيل كل دفعة ومصروف في الفترة."
              : "المختصر: الأرقام والصافي وجدول الوحدات — بلا تفصيل الدفعات."}
          </p>
        </div>
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
  const xp = splitVat(perPeriod, property && unitVatApplies({ unit_type: d.unit_type, vat_mode: d.vat_mode }, property) ? v : { ...v, enabled: false });
  const upfront = xp.total + (Number(d.deposit) || 0);
  const ready = !!(d.tenant_name || "").trim() && perPeriod > 0 && !!d.start_date;

  function issue() {
    openDoc(quotationHTML(property as any, {
      quote_no: d.quote_no || stamp(),
      tenant_name: String(d.tenant_name || "").trim(),
      unit: String(d.unit || "").trim(),
      unit_type: d.unit_type || null, vat_mode: d.vat_mode || null,
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
          <Field label="نوع الوحدة" hint="يحدد الضريبة في العمارة المختلطة (سكني معفى · تجاري خاضع)">
            <select className="fld" value={d.unit_type || ""} onChange={(e) => setD({ ...d, unit_type: e.target.value })}>
              <option value="">— بحسب العقار —</option>
              {Object.entries(UNIT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`قيمة الدفعة (ريال)${property && unitVatApplies({ unit_type: d.unit_type, vat_mode: d.vat_mode }, property) ? (v.inclusive ? " — شاملة الضريبة" : " — قبل الضريبة") : ""}`}>
            <input className="fld" type="number" value={d.rent_amount}
              onChange={(e) => setD({ ...d, rent_amount: e.target.value })} placeholder="25000" />
          </Field>
          <Field label="مدة العقد" hint="عقود المكاتب ليست كلها سنة — اختر المدة ويُحسب عدد الدفعات">
            {(() => {
              /* المكتب يفكّر بالمدة («سنتان»)، لا بعدد الدفعات («4»). تحويلها
                 بيده مصدر خطأ: عقد سنتين نصف سنوي = 4 دفعات لا 2. نأخذ المدة
                 ونحسب العدد، ونعرض النتيجة ليراها قبل الحفظ. */
              const perYear = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 }[
                (d.payment_frequency || "monthly") as Frequency] || 12;
              const months = Math.round((Number(d.contract_periods) || 0) * (12 / perYear));
              const setMonths = (m: number) => {
                const per = Math.max(1, Math.round(m * perYear / 12));
                setD({ ...d, contract_periods: per, _months: m });
              };
              const PRESETS = [[3, "3 أشهر"], [6, "6 أشهر"], [12, "سنة"], [18, "سنة ونصف"], [24, "سنتان"], [36, "3 سنوات"]] as const;
              const matched = PRESETS.find(([m]) => m === months);
              return (
                <>
                  <select className="fld" value={matched ? String(months) : "custom"}
                    onChange={(e) => { if (e.target.value !== "custom") setMonths(Number(e.target.value)); else setD({ ...d, _custom: true }); }}>
                    {PRESETS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                    <option value="custom">مدة أخرى…</option>
                  </select>
                  {(!matched || d._custom) && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <input className="fld" type="number" min={1} value={months || ""} placeholder="عدد الأشهر"
                        onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))} />
                      <input className="fld" type="number" min={1} value={d.contract_periods || ""} placeholder="عدد الدفعات"
                        onChange={(e) => setD({ ...d, contract_periods: e.target.value })} />
                    </div>
                  )}
                  <span className="block text-[11px] text-muted mt-1">
                    {Number(d.contract_periods) > 0
                      ? `${d.contract_periods} دفعة ${freqLabel(d.payment_frequency)}${d.contract_start ? ` · ينتهي ${derivedEndDate(d.contract_start, (d.payment_frequency || "monthly") as Frequency, Number(d.contract_periods), null, d.calendar === "hijri" ? "hijri" : "gregorian")}` : ""}`
                      : "حدّد المدة"}
                  </span>
                </>
              );
            })()}
          </Field>
        </div>

        {/**
          * الرصيد الافتتاحي: عدد الدفعات المستلمة قبل الدخول على وثيق.
          *
          * كان يُدخَل عند الرفع من إكسل فقط، فمن أخطأ فيه لا يستطيع تصحيحه
          * من اللوحة — والوحدة تبقى تشير إلى دفعة خاطئة إلى الأبد. متاح
          * للمدير وحده لأنه يغيّر المتأخرات بلا سجل دفعة يقابله.
          */}
        <Field label="الدفعات المسدَّدة" hint="عدد الدفعات المستلمة حتى الآن. الدفعات التي تُسجَّل بزر ✔ تُضاف فوقها تلقائيًّا">
          <input className="fld" type="number" min={0} max={999}
            value={d.paid_periods ?? ""} onChange={(e) => setD({ ...d, paid_periods: e.target.value })} placeholder="0" />
          {Number(d.paid_periods) > 0 && Number(d.contract_periods) > 0 && (
            <span className="block text-[11px] text-muted mt-1">
              {Number(d.paid_periods) > Number(d.contract_periods)
                ? `⚠️ أكبر من مدة العقد (${d.contract_periods}) — سداد مقدَّم لمدة قادمة؟`
                : `المتبقي ${Number(d.contract_periods) - Number(d.paid_periods)} دفعة`}
            </span>
          )}
        </Field>

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
            <DateField value={d.start_date} onChange={(v) => setD({ ...d, start_date: v })} />
          </Field>
          <Field label="التأمين (ريال)" hint="مسترد">
            <input className="fld" type="number" value={d.deposit} onChange={(e) => setD({ ...d, deposit: e.target.value })} placeholder="5000" />
          </Field>
          <Field label="العرض صالح حتى">
            <DateField value={d.valid_until} onChange={(v) => setD({ ...d, valid_until: v })} />
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
              {xp.vat > 0 && <div>منها ضريبة قيمة مضافة ({v.rate}%): <b className="text-ink">{sar(xp.vat)} ريال</b></div>}
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
