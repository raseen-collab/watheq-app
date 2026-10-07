"use client";
import { LIMIT_MSG, atLimit, type LimitsWire } from "@/lib/entitlements";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import { createClient } from "@/lib/supabase-client";
import { cleanMeters, metersCountLine, METER_TYPE_AR, MAX_METERS, type PropertyMeter } from "@/lib/meters";
import { officeId, getOffice, ROLE_LABEL, OWNER_PERMS } from "@/lib/office";
import { arDate, termRentPaidOf, pastVatOf } from "@/lib/documents";
import { annualRentRoll } from "@/lib/income";
import { unitStatus, unitStatusLabel, arrearsOf, firstDueOutOfRange, dateDistanceAr, contractRemaining, excessOverRemaining, nearDuplicatePayment, renewalTooEarly, gregorianAr, recentCovers, vatInclusiveSlip } from "@/lib/contract-state";
import type { ComplianceItem } from "@/lib/compliance";
import { fetchAllRows } from "@/lib/fetch-all";
import { hijriShort, hijriText, parseHijriInput } from "@/lib/hijri";
import { sar, waLink, today, WATHEQ_WA, openExternal, daysAr, countAr, normalizeSearch, csvCell } from "@/lib/utils";
import { endNoticeText, meterNoticeText } from "@/lib/tenant-messages";
import { contractState, expectedNext12, buildSchedule, FREQUENCIES, freqLabel, freqShort, derivedEndDate, renewContract, needsRenewal, applyPayment, splitVat, isCommercial, isVacant, settleDeposit, unitVatApplies,
  vacancyDays, TURNOVER_CHECKLIST, defaultTermPeriods, parseDate, dueWithVat, rentWithVat, withVat, unitVat, firstDueGap, type Frequency } from "@/lib/contracts";
import { PROPERTY_TYPES, typeLabel, unitLabel, typeIcon } from "@/lib/domain";
import { statementHTML, invoiceHTML, propertyStatementHTML, moveOutSettlementHTML, quotationHTML, ownerReportHTML, DEFAULT_CHARGES, openDoc, type ChargeRow, type OwnerReportPayment } from "@/lib/documents";
import OwnerStatementModal from "@/components/OwnerStatementModal";
import ActivityLog from "@/components/ActivityLog";
import StatusLegend from "@/components/StatusLegend";
import PropertyStatementModal, { type StatementPeriod } from "@/components/PropertyStatementModal";
import DemoGuide from "@/components/DemoGuide";
import DebtFollowUp from "@/components/DebtFollowUp";
import UnitInvoicesModal from "@/components/UnitInvoicesModal";
import CollectionStatementModal from "@/components/CollectionStatementModal";
import ExpensesModal from "@/components/ExpensesModal";
import OwnerLinkModal from "@/components/OwnerLinkModal";
import { TenantLinkModal, TenantPortalInbox, type TenantClaim } from "@/components/TenantPortal";
import type { ExpenseRow } from "@/lib/expenses";
import DateField from "@/components/DateField";

/** تحويل كل دورة إلى مكافئ شهري لحساب الدخل التقريبي */
const PERIODS_PER_MONTH: Record<Frequency, number> = {
  daily: 30, weekly: 4.33, monthly: 1, quarterly: 1 / 3, trimester: 1 / 4, semiannual: 1 / 6, annual: 1 / 12,
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
  /** آخر إشعار «سجّل العداد باسمك» وعدد مراته (schema-v74) */
  elec_notice_at?: string | null; elec_notice_count?: number | null;
  /** لمن أُرسل وعلى أي عداد (v74b) — بعد إعادة التأجير لا يُحسب إشعار السابق للجديد */
  elec_notice_name?: string | null; elec_notice_account?: string | null;
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
  /** عدادات العقار الرئيسية (schema-v68) — المصعد، الخدمات، الماء… */
  meters?: PropertyMeter[] | null;
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


/**
 * سطر «الدفعة القادمة» تحت المتأخر.
 *
 * طلب مكتب: أن يرى مبلغ القادمة لا تاريخها وحده. والمتأخر يبقى الرقم
 * البارز لأنه المستحق الآن — تقديم القادمة عليه يُنزل المبلغ المتأخر
 * الصغير إلى سطر ثانوي فيُنسى تحصيله.
 * وحين تقع القادمة داخل نافذة «مستحق قريبًا» نجمع الاثنين: المحصّل يزور
 * المستأجر مرة واحدة ويأخذ الكل.
 */

/**
 * حين لا تبقى دفعات في العقد: نقول متى ينتهي وأن التالية مع التجديد.
 * «لا دفعات قادمة في العقد» كانت صحيحة ومُربكة معًا — المكتب يرى
 * دفعة بعد أيام في عقده الورقي، وهي في الحقيقة أول دفعة من التجديد.
 */
function renewalNote(st: ReturnType<typeof contractState>): string {
  if (st.endDate && st.daysToEnd !== null && st.daysToEnd >= 0)
    return `العقد ينتهي ${arDate(st.endDate)} (${st.daysToEnd === 0 ? "اليوم" : `بعد ${daysAr(st.daysToEnd)}`}) — الدفعة التالية مع التجديد`;
  if (st.endDate) return `انتهى العقد ${arDate(st.endDate)} — جدّده لتظهر الدفعات القادمة`;
  return "لا دفعات قادمة في العقد";
}

function UpcomingLine({ st, rent, imminentDays, due: dueIn }: {
  st: ReturnType<typeof contractState>; rent: number; imminentDays: number;
  /** المتأخر شاملًا الضريبة (dueWithVat) — بدونه يُستعمل amountDue كما هو */
  due?: number;
}) {
  if (!st.upcomingDate) return null;
  const due = dueIn ?? st.amountDue;
  const d = st.daysToUpcoming ?? 0;
  const soon = d <= imminentDays;
  return (
    <span className="block font-normal text-muted mt-0.5">
      القادمة {rent > 0 ? <b className="text-ink">{sar(rent)} ريال</b> : null} · <bdi dir="ltr" className="whitespace-nowrap">{st.upcomingDate}</bdi>
      {" · "}{d === 0 ? "اليوم" : `بعد ${d} ${d === 1 ? "يوم" : d === 2 ? "يومين" : d <= 10 ? "أيام" : "يومًا"}`}
      {soon && rent > 0 && due > 0 && (
        /* المجموع وحده يُخفي أن جزءًا منه متأخر أصلًا — والمكتب يحتاج أن
           يقول للمستأجر «منها 500 متأخرة من الشهر الماضي». */
        <span className="block text-[#8a5a11] font-semibold">
          اجمعها معًا: {sar(due + rent)} ريال
          <span className="block font-normal">
            <span className="text-late font-semibold">{sar(due)} متأخرة</span> + {sar(rent)} القادمة
          </span>
        </span>
      )}
    </span>
  );
}

/* التصنيف في lib/contract-state (unitStatus) — مشترك مع رابط المالك وتقاريره،
   فلا تعرض اللوحة «مستحق» والتقرير «منتظم» للوحدة نفسها */
function rowKey(t: Tenant, st: ReturnType<typeof contractState>): RowKey {
  return unitStatus(t, st as any) as RowKey;
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

export default function PropertyView({ initial, orgName, issuer, compliance, dueSoonDays, dueImminentDays, expiringDays, db, demo = false, limits }: {
  initial: Property[]; orgName: string; issuer?: any; compliance?: ComplianceItem[];
  /** حدود الباقة (v67) — القاعدة تمنع، وهذا ينبّه قبل ملء نموذج سيُرفض */
  limits?: LimitsWire;
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
  /* الدخل الشهري في البطاقة = ما قُبض فعلًا هذا الشهر (طلب مكتب تميز)، والمتوقع بجانبه */
  const [collectedThisMonth, setCollectedThisMonth] = useState<number | null>(null);
  /* مصروفات الشهر: ما على المالك (يُخصم في تقريره) وما على المكتب نفسه */
  const [expThisMonth, setExpThisMonth] = useState<{ owner: number; office: number } | null>(null);
  const [expKey, setExpKey] = useState(0);
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
    /* حدود الشهر بتوقيت الرياض — لا بساعة الجهاز */
    const to = today(), from = `${to.slice(0, 7)}-01`;
    let alive = true;
    setCollectedThisMonth(null); setExpThisMonth(null);
    supabase.from("payments").select("amount").eq("property_id", activeId).gte("paid_on", from).lte("paid_on", to).limit(1000)
      .then(({ data }: any) => { if (alive) setCollectedThisMonth((data || []).reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0)); });
    supabase.from("expenses").select("amount, billable").eq("property_id", activeId).gte("spent_on", from).lte("spent_on", to).limit(1000)
      .then(({ data, error }: any) => {
        if (!alive) return;
        if (error) { setExpThisMonth({ owner: 0, office: 0 }); return; }
        let owner = 0, office = 0;
        (data || []).forEach((e: any) => { if (e.billable === false) office += Number(e.amount) || 0; else owner += Number(e.amount) || 0; });
        setExpThisMonth({ owner, office });
      });
    return () => { alive = false; };
  }, [activeId, paidKey, expKey, supabase]);
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
      const wide = window.matchMedia("(min-width: 768px)").matches;
      /* الجدول على شاشة ضيّقة يُخفي أعمدة الحالة والمبلغ والأزرار خارج
         الشاشة. فالبطاقات هي الافتراضي تحت 768px حتى لو حُفظ الجدول —
         والمفتاح ظاهر لمن أرادها. */
      setView(!wide ? "cards" : (saved === "table" || saved === "cards" ? (saved as any) : "table"));
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
  /** (جولة 4) دفعات المستأجر الأخيرة لحارس «دفعة مشابهة»، ومبلغ مقترح حين يحوّل ✔ إلى النافذة */
  const [payRecent, setPayRecent] = useState<any[] | null>(null);
  const [payInit, setPayInit] = useState<{ amount: number; why: string; paidOn?: string; reference?: string | null } | null>(null);
  /* v70: رابط المستأجر — نافذة الرابط، والحوالة المُبلَّغ عنها قيد الاعتماد، ومفتاح تحديث صندوق البلاغات */
  const [tenantLinkFor, setTenantLinkFor] = useState<Tenant | null>(null);
  const [payClaim, setPayClaim] = useState<TenantClaim | null>(null);
  const [inboxKey, setInboxKey] = useState(0);
  /** (جولة 4) تجديد مبكر: سؤال داخل التطبيق قبل فتح نافذة التجديد */
  const [renewAsk, setRenewAsk] = useState<Tenant | null>(null);
  const renewAcked = useRef<string | null>(null);
  const [turnover, setTurnover] = useState<Tenant | null>(null);
  const [remindAll, setRemindAll] = useState(false);

  // ---------- أدوات العرض: بحث / تصفية / فرز / إشعار ----------
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | RowKey>("all");
  useEffect(() => { setTPage(0); }, [filter, q, tSort, activeId]);
  useEffect(() => { setCardsShown(60); }, [filter, q, activeId]);
  const [sort, setSort] = useState<"urgent" | "due" | "amount" | "name">("urgent");
  const [toast, setToast] = useState<null | { k: "ok" | "err"; m: string; undo?: () => void }>(null);
  /* ديون المستأجرين السابقين المفتوحة (schema-v45). قبل الترحيل لا يوجد
     الجدول — فالخطأ يُتجاهَل ويبقى المؤشر كما كان. */
  const [past, setPast] = useState<{ id: string; property_id: string; name: string; unit: string | null;
    debt_amount: number; debt_paid: number; debt_status: string }[]>([]);
  async function loadPast() {
    try {
      const { data, error } = await supabase.from("past_tenancies")
        .select("id, property_id, name, unit, debt_amount, debt_paid, debt_status")
        .not("debt_status", "in", "(settled,written_off)").limit(2000);
      /* الفلتر يُعاد هنا: قاعدة التجربة لا تطبّق .not() */
      if (!error && Array.isArray(data)) setPast((data as any[]).filter((x) => !["settled", "written_off"].includes(String(x.debt_status))));
    } catch { /* قاعدة قبل v45 أو وضع التجربة */ }
  }
  useEffect(() => { loadPast(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supabase]);
  const pastOwed = (pid?: string) => past
    .filter((x) => !pid || x.property_id === pid)
    .reduce((a, x) => a + Math.max(0, (Number(x.debt_amount) || 0) - (Number(x.debt_paid) || 0)), 0);
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
  function notify(k: "ok" | "err", m: string, undo?: () => void) {
    setToast({ k, m, undo });
    /* الإشعار القابل للتراجع يبقى أطول: زرّ ✔ ينفّذ بنقرة واحدة وهو ملاصق
       لزر السداد الجزئي — فالخطأ وارد، والتراجع كان مدفونًا في قائمة ⋯. */
    setTimeout(() => setToast(null), undo ? 7000 : 3600);
  }

  /** «+ عقار»: الحساب المنتهي للقراءة فقط، وباقة المالك عقار واحد (التجريبي لا يُحسب) */
  function openNewProperty() {
    if (limits?.readOnly) return notify("err", LIMIT_MSG.readOnly);
    if (atLimit(items.filter((p: any) => !p.is_demo).length, limits?.maxProperties)) return notify("err", LIMIT_MSG.properties);
    setModal({ kind: "newProp" });
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
    /* (30 سبتمبر 2026) normalizeSearch: الأرقام العربية وى/ي وة/ه والهمزات — كان «٠٥٥» لا يجد «055» */
    const needle = normalizeSearch(q);
    let out = allRowsForFilter.filter((r) => {
      if (filter !== "all" && r.key !== filter && !(filter === "soon" && r.key === "due")) return false;
      if (!needle) return true;
      // نفس حقول بحث «النظرة العامة» — لا يجد المستأجر في صفحة ويعجز في أخرى
      return [r.t.name, r.t.unit, r.t.phone, r.t.contract_no, r.t.national_id, r.t.elec_account, r.t.water_account].filter(Boolean)
        .some((v) => normalizeSearch(v).includes(needle));
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
  async function recordPayment(t: Tenant, amount: number, method = "transfer", note?: string, paidOn?: string, reference?: string, guarded = false) {
    /**
     * حارس التكرار.
     *
     * سجل مكتب حقيقي أظهر 35,000 مسجَّلة أربع مرات في يوم واحد لنفس الوحدة،
     * و2,500 أربع مرات لوحدة أخرى — فانتفخ «المحصَّل هذا الشهر» وظنّ المكتب
     * أن الحساب خاطئ. حارس النقر المزدوج يمنع النقرتين المتتاليتين، لا
     * التسجيل المتكرر بعد دقائق أو من موظف آخر.
     *
     * تنبيه لا منع: قد يدفع مستأجر دفعتين فعلًا في يوم واحد.
     */
    const day = paidOn || today();
    const { data: dup } = await supabase.from("payments")
      .select("*")
      .eq("tenant_id", t.id).eq("paid_on", day).limit(20);
    const same = (dup || []).filter((x: any) => Math.abs(Number(x.amount) - amount) < 0.01);
    /* guarded: النافذة سألت عن «دفعة مشابهة» (±3 أيام، فرق ≤1٪ أو 5 ريالات) — لا سؤال ثانٍ */
    if (same.length && !guarded && !confirm(
      `⚠️ سُجّلت دفعة مطابقة اليوم نفسه لهذه الوحدة.\n\n`
      + `${t.name} — ${ul} ${t.unit || "—"}\n`
      + `${sar(amount)} ريال بتاريخ ${day}${same.length > 1 ? ` (مسجّلة ${same.length} مرات)` : ""}\n\n`
      + `تسجيلها مرة أخرى يضاعف المحصَّل ويقدّم عدّاد الدفعات.\n`
      + `راجع «سجل المدفوعات» قبل المتابعة.\n\nتسجيلها على أي حال؟`
    )) return;

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
      : `سُجّل ${sar(amt)} ريال كسداد جزئي`,
      /* تراجع بنقرة واحدة لسبع ثوانٍ: أقرب من قائمة ⋯ حين يكون الخطأ طازجًا */
      may("undo_actions") ? () => undoPayment(t) : undefined);
    });
  }

  /**
   * v70: «اعتماد وتسجيل» حوالة أبلغ عنها المستأجر من رابطه.
   * تفتح نافذة التسجيل المعتادة (بحرّاس «يزيد على المتبقي» و«يشبه دفعة») بمبلغ
   * البلاغ وتاريخه ومرجعه. في «مضافة فوق الإيجار» يُقترح المبلغ قبل الضريبة —
   * فكل تسجيل في وثيق بوحدة الإيجار — مع ذكر ما حوّله المستأجر فعلًا.
   */
  function startClaimApprove(c: TenantClaim) {
    const prop = items.find((x) => x.id === c.property_id);
    const t = prop?.tenants.find((x) => x.id === c.tenant_id);
    if (!prop || !t) return notify("err", "الوحدة غير موجودة في القائمة — حدّث الصفحة ثم أعد المحاولة.");
    const v = unitVat(t, prop);
    const exVat = v.enabled && !v.inclusive;
    const amt = exVat ? Math.round((Number(c.amount) / (1 + (Number(v.rate) || 15) / 100)) * 100) / 100 : Number(c.amount);
    setActiveId(prop.id);
    setPayInit({
      amount: amt,
      why: exVat
        ? `بلاغ حوالة من المستأجر: ${sar(Number(c.amount))} ريال شاملة الضريبة — يُسجَّل قبل الضريبة ${sar(amt)}`
        : `بلاغ حوالة من المستأجر بتاريخ ${c.transfer_date} — طابقه مع كشف البنك`,
      paidOn: c.transfer_date, reference: c.bank_ref,
    });
    setPayClaim(c);
    setPaying(t);
  }
  async function approveClaimPayment(t: Tenant, c: TenantClaim, amount: number, method: string, note?: string, paidOn?: string, reference?: string) {
    const amt = Math.max(0, Number(amount) || 0);
    if (!amt) return;
    return once(`pay:${t.id}`, async () => {
      const { data, error } = await supabase.rpc("watheq_tenant_claim_approve", {
        p_claim: c.id, p_amount: amt, p_method: method, p_note: note || null, p_paid_on: paidOn || c.transfer_date, p_reference: reference || null,
      });
      if (error) {
        const m = String(error.message || "");
        return notify("err", /not authorized/.test(m) ? "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."
          : /does not exist|schema cache|Could not find/.test(m) ? "شغّل schema-v70 في قاعدة البيانات أولًا." : m);
      }
      const r = data as { duplicate?: boolean; paid_periods?: number; partial_amount?: number; completed?: number };
      setInboxKey((k) => k + 1);
      if (r?.duplicate) return notify("ok", "هذا البلاغ معتمد سابقًا — لم تُسجَّل دفعة جديدة.");
      setItems((list) => list.map((p) => p.id === c.property_id ? {
        ...p,
        collected: (p.collected || 0) + amt,
        tenants: p.tenants.map((x) => (x.id === t.id ? { ...x, paid_periods: r.paid_periods ?? x.paid_periods, partial_amount: r.partial_amount ?? x.partial_amount } : x)),
      } : p));
      notify("ok", `اعتُمدت حوالة ${t.name} وسُجّل ${sar(amt)} ريال${(r.completed || 0) > 0 ? ` — اكتملت ${r.completed} دفعة` : " كسداد جزئي"}`);
    });
  }

  /**
   * زرّ ✔ (30 سبتمبر 2026): «استلمتُ ما يُكمل الدفعة الحالية».
   * كان يسجّل الإيجار كاملًا ولو على الدفعة جزئيٌّ مدفوع — فمستأجر دفع 1,000 من
   * 3,000 ثم أكمل 2,000 يُسجَّل له 3,000، ويظهر 1,000 زائدًا على الدفعة التالية.
   * المبلغ بوحدة الإيجار كما يُسجَّل كل سداد (قبل الضريبة في وضع «مضافة»).
   */
  async function quickPay(t: Tenant, st: ReturnType<typeof contractState>) {
    const rent = Number(t.rent_amount) || 0;
    const part = st.hasPartial ? Math.min(rent, Math.max(0, Number(st.partial) || 0)) : 0;
    const amt = Math.round((rent - part) * 100) / 100;
    if (!(amt > 0)) return notify("err", `قيمة الدفعة غير محدَّدة — أدخل إيجار ${ul} ${t.unit || t.name} أولًا.`);
    /* (جولة 4) ✔ يسجّل مبلغًا محسوبًا: إن زاد على المتبقي من العقد أو شابه دفعة قريبة
       نفتح نافذة التسجيل بالمبلغ نفسه — والسؤال فيها داخل التطبيق لا نافذة المتصفح. */
    const rem = contractRemaining(t);
    let why = excessOverRemaining(amt, rem.remaining) > 0 ? `المبلغ يزيد على المتبقي من العقد (${sar(Math.max(0, rem.remaining))})` : "";
    if (!why) {
      try {
        const { data: rp } = await supabase.from("payments").select("id, amount, paid_on, reverses").eq("tenant_id", t.id).order("paid_on", { ascending: false }).limit(60);
        const near = nearDuplicatePayment(amt, today(), (rp || []) as any[]);
        if (near) why = `يشبه دفعة ${sar(Number(near.amount))} بتاريخ ${String(near.paid_on).slice(0, 10)}`;
      } catch { /* بلا قراءة: يبقى التأكيد المعتاد */ }
    }
    if (why) { setPayInit({ amount: amt, why }); setPaying(t); return; }
    const vatNote = active && unitVatApplies(t, active) && active.vat_inclusive === false ? " (قبل الضريبة المضافة)" : "";
    const head = part > 0
      ? `تسجيل استلام باقي الدفعة الحالية؟\n\n${sar(amt)} ريال${vatNote} = الدفعة ${sar(rent)} − مدفوع منها سابقًا ${sar(part)}`
      : `تسجيل استلام دفعة كاملة؟\n\n${sar(amt)} ريال${vatNote}`;
    if (confirm(`${head}\nمن ${t.name} — ${ul} ${t.unit || "—"} — ${active?.name}\n\nتاريخ السداد: اليوم (${today()})\nلمبلغ أو تاريخ مختلف أو مرجع حوالة استعمل «½ جزئي».\n\n(تُسجَّل باسمك في سجل الحركات المالية)`)) recordPayment(t, amt);
  }

  useEffect(() => {
    if (!paying) { setPayRecent(null); return; }
    let live = true;
    supabase.from("payments").select("id, amount, paid_on, reverses").eq("tenant_id", paying.id).order("paid_on", { ascending: false }).limit(60)
      /* (F2) خطأ القراءة = null (لم يُفحص) — لا قائمة فارغة توهم أن لا دفعات قريبة */
      .then(({ data, error }: any) => { if (live) setPayRecent(!error && Array.isArray(data) ? data : null); }, () => { if (live) setPayRecent(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paying?.id]);
  /** (جولة 4 · F1b) دفعات الوحدة المفتوحة في «تعديل البيانات» — لتنبيه إلغاء «شاغرة» */
  const [editPayInfo, setEditPayInfo] = useState<null | { any: number; inTerm: number }>(null);
  const editId = modal?.kind === "tenant" ? ((modal as any).id as string | undefined) : undefined;
  useEffect(() => {
    if (!editId) { setEditPayInfo(null); return; }
    let on = true;
    const t0: any = items.flatMap((p) => p.tenants || []).find((x: any) => x.id === editId);
    const since = String(t0?.term_started_at || "");
    const useSince = !!since && !/infinity/i.test(since);
    supabase.from("payments").select("id, amount, created_at, reverses").eq("tenant_id", editId).limit(1000)
      .then(({ data, error }: any) => {
        if (!on) return;
        if (error || !Array.isArray(data)) { setEditPayInfo(null); return; }
        const rev = new Set(data.filter((x: any) => x.reverses).map((x: any) => String(x.reverses)));
        const liveP = data.filter((x: any) => Number(x.amount) > 0 && !x.reverses && !rev.has(String(x.id)));
        setEditPayInfo({ any: liveP.length, inTerm: liveP.filter((x: any) => !useSince || String(x.created_at || "") >= since).length });
      });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);
  /** (جولة 4) «تجديد العقد» قبل نهايته بأكثر من 30 يومًا ⇒ سؤال داخل التطبيق أولًا */
  function askRenew(t: Tenant) {
    const end = contractState(t).endDate;
    if (renewalTooEarly(end, today())) { setRenewAsk(t); return; }
    setRenewing(t);
  }

  /** التراجع عن آخر دفعة — ذرّي في القاعدة، للمدير فقط، بصف سالب في السجل */
  async function undoPayment(t: Tenant) {
    if (!active) return;
    if (isBusy(`pay:${t.id}`) || isBusy(`undo:${t.id}`)) return;
    return once(`undo:${t.id}`, async () => {
    /* (30 سبتمبر 2026) التأكيد كان يقول «سيُخصم <الإيجار>» — والدالة تعكس آخر
       دفعة إيجار حيّة بمبلغها الفعلي (جزئية 500 مثلًا). نقرؤها بقاعدة الدالة
       نفسها (v44: إيجار موجب، لم يُعكس، ضمن المدة الحالية)؛ وإن تعذّر نصوغ بلا رقم. */
    let last: { amount: number; paid_on: string } | null = null, known = false;
    try {
      const { data: pr, error: pe } = await supabase.from("payments")
        .select("id, amount, paid_on, created_at, applies_to, reverses")
        .eq("tenant_id", t.id).order("created_at", { ascending: false }).limit(100);
      if (!pe && Array.isArray(pr)) {
        known = true;
        const since = String((t as any).term_started_at || "");
        const useSince = !!since && !/infinity/i.test(since);
        const reversed = new Set(pr.filter((x: any) => x.reverses).map((x: any) => String(x.reverses)));
        const live = [...pr]
          .filter((x: any) => Number(x.amount) > 0 && (x.applies_to || "rent") === "rent" && !reversed.has(String(x.id))
            && (!useSince || String(x.created_at || "") >= since))
          .sort((a: any, b: any) => String(b.created_at || b.paid_on || "").localeCompare(String(a.created_at || a.paid_on || "")))[0];
        if (live) last = { amount: Number(live.amount) || 0, paid_on: String(live.paid_on || "").slice(0, 10) };
      }
    } catch { /* نصوغ التأكيد بلا رقم */ }
    const what = last
      ? `سيُعكس ${sar(last.amount)} ريال (دفعة ${last.paid_on}) ويُخصم من المحصَّل`
      : known ? "لا دفعة مسجّلة في الدفتر لهذه المدة — سيُصحَّح عدّاد الدفعات وحده بلا أثر نقدي (رصيد افتتاحي)"
      : "سيُعكس آخر مبلغ إيجار مسجَّل (تجده في «سجل المدفوعات») ويُخصم من المحصَّل";
    if (!confirm(`التراجع عن آخر دفعة مسجّلة؟\n\n${t.name} — ${ul} ${t.unit || "—"} — ${active.name}\n${what}، ويُسجَّل التراجع باسمك في سجل الحركات المالية.`)) return;
    const amt = last?.amount || 0;
    const { data, error } = await supabase.rpc("watheq_undo_payment", { p_tenant: t.id });
    if (error) {
      const m = String(error.message || "");
      return notify("err", /not authorized/.test(m) ? "التراجع عن الدفعات للمدير أو صاحب المكتب." : m);
    }
    const r = data as { paid_periods: number; partial_amount?: number; reversed: number; paid_on?: string; opening_balance?: boolean };
    setItems(items.map((p) => p.id === active.id ? {
      ...p,
      /* الرصيد الافتتاحي لم يمسّ الدفتر — و«0 || amt» كان يُنقص المحصَّل رغمه */
      collected: (p.collected || 0) - (r.opening_balance ? 0 : (r.reversed || amt)),
      /* v44 يُرجع الجزئي بعد العكس — كانت الشاشة تُبقي القديم حتى التحديث */
      tenants: p.tenants.map((x) => (x.id === t.id ? { ...x, paid_periods: r.paid_periods,
        ...(r.partial_amount !== undefined ? { partial_amount: r.partial_amount } : {}) } : x)),
    } : p));
    /* نذكر شهر الدفعة الأصلية: التراجع يُصحّح الشهر الذي دخلت فيه لا الشهر
       الجاري، وبدون ذكره يظن المكتب أن تحصيل هذا الشهر نقص بلا سبب. */
    /* رصيد افتتاحي: لا نقد في الدفتر عُكس — صُحّح العدّاد وحده (v42).
       كان «|| amt» يُظهر «خُصم 13,000» والدالة لم تخصم شيئًا. */
    /* v70: دفعة جاءت من بلاغ حوالة ⇒ عاد البلاغ «بانتظار المراجعة» — نحدّث الصندوق */
    setInboxKey((k) => k + 1);
    notify("ok", r.opening_balance
      ? "صُحّح عدّاد الدفعات — كانت دفعة سُدّدت قبل وثيق، فلا تُسجَّل في الدفتر"
      : ((r.reversed || amt) ? `تم التراجع — خُصم ${sar(r.reversed || amt)} ريال` : "تم التراجع")
        + (r.paid_on ? ` من تحصيل ${r.paid_on}` : "") + " وسُجّل في سجل الحركات المالية");
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

  /**
   * إعادة التأجير (schema-v45).
   *
   * كانت تكتب المستأجر الجديد فوق صفّ السابق: اسمه وجواله يُمحيان، ودينه
   * يُرحَّل على صفّ الجديد فيُطالَب به من لا يدين به. الآن يُؤرشَف السابق
   * بصاحبه ودينه ودفعاته، ويُكتب الجديد نظيفًا — في عملية واحدة عند الحفظ.
   *
   * والنموذج يُفتح بحقول المستأجر فارغة: كان يُفتح ببيانات السابق، فمن
   * غيّر الاسم ونسي الجوال أرسل تذكيرات الجديد إلى جوال السابق.
   */
  function reLet(t: Tenant) {
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0, ...windowsOf(active) });
    /* (30 سبتمبر 2026) تاريخ إخلاء غير صالح يجعل المتأخر تقديرًا — لا يُؤرشف دين على تقدير */
    if (st.incomplete && isVacant(t)) {
      notify("err", "تاريخ الإخلاء غير صالح أو غير مسجَّل — صحّحه من «تعديل البيانات» قبل إعادة التأجير، حتى يُحسب دين المستأجر السابق صحيحًا.");
      return;
    }
    /* المتأخر في «مضافة فوق الإيجار» قبل الضريبة — يُؤرشف شاملًا لها وإلا ضاعت ضريبته */
    const debt = Math.round((withVat(st.legacyArrears || 0, t, active) + (Number(t.carried_debt) || 0)) * 100) / 100;
    /**
     * مصير دين السابق: ثلاثة لا اثنان.
     *
     * كان «إلغاء = سُوّي بالكامل» يمحو الدين بلا أثر: إن استلم المكتب المبلغ
     * نقدًا عند الإخلاء لم يدخل أي دفتر ولا تقرير مالك، وإن تنازل عنه ضاع أنه
     * كان دينًا أصلًا. (دراسة 685 احتمالًا: 144 قصة، وكل فروق المحصَّل منها.)
     * الآن الدين يُحفظ دائمًا باسم صاحبه، ثم: يبقى مفتوحًا، أو يُسجَّل سداده
     * نقدًا في الدفتر، أو يُشطب بسببه — ولكلٍّ أثر.
     */
    let fate: "none" | "open" | "paid" | "forgiven" = "none";
    if (debt > 0) {
      const keep = confirm(
        `على المستأجر السابق ${t.name} مبلغ ${sar(debt)} ريال.\n\n`
        + `موافق = يبقى دينًا عليه باسمه وجواله في «الديون المرحَّلة» — ولا يظهر على المستأجر الجديد.\n`
        + `إلغاء = سُوّي (ستُسأل: استلمتَه أم تنازلتَ عنه).`);
      if (keep) fate = "open";
      else fate = confirm(
        `كيف سُوّي دين ${t.name} (${sar(debt)} ريال)؟\n\n`
        + `موافق = استلمتُه — يُسجَّل في الدفتر ويظهر في تقرير المالك.\n`
        + `إلغاء = تنازلتُ عنه — يُشطب ويُحفظ أثره.`) ? "paid" : "forgiven";
    }
    const keepDebt = debt > 0 ? debt : 0;
    const x = t as any;
    setModal({ kind: "tenant", id: t.id, preset: {
      _relet: true, _reletDebt: keepDebt, _reletFate: fate, _prevName: t.name,
      _prevMoveOut: (t as any).move_out_date || null,
      /* ما يخصّ المستأجر: فارغ */
      name: "", phone: "", national_id: "", contract_no: "", contract_start: today(), contract_end: null,
      first_due: null, paid_periods: 0, partial_amount: 0, carried_debt: 0, carried_debt_note: null,
      status: "active", move_out_date: null,
      /* قراءة التسليم للجديد = قراءة الخروج للسابق */
      meter_elec_in: x.meter_elec_out || x.meter_elec_in || "", meter_water_in: x.meter_water_out || x.meter_water_in || "",
    } } as any);
    notify("ok", fate === "open"
      ? `أدخل بيانات المستأجر الجديد — ودين ${t.name} (${sar(keepDebt)} ريال) يُحفظ باسمه عند الحفظ.`
      : fate === "paid" ? `أدخل بيانات المستأجر الجديد — وسداد ${t.name} (${sar(keepDebt)} ريال) يُسجَّل في الدفتر عند الحفظ.`
      : fate === "forgiven" ? `أدخل بيانات المستأجر الجديد — ودين ${t.name} يُشطب بأثر عند الحفظ.`
      : "أدخل بيانات المستأجر الجديد — ستعود الوحدة مؤجّرة عند الحفظ.");
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
      // عدادات العقار الرئيسية: الصف بلا رقم حساب يُسقط، والفارغ يُحفظ null
      meters: cleanMeters(d.meters),
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
    /* الوحدة الشاغرة: لا مستأجر ولا عقد. عمود الاسم NOT NULL في القاعدة،
       فنضع «شاغرة» بدل اسم وهمي يختلط ببيانات حقيقية. */
    if (String(d.status || "active") === "vacated") {
      d = { ...d, name: (d.name || "").trim() || "شاغرة", contract_start: d.contract_start || null,
            paid_periods: 0, partial_amount: 0, move_out_date: d.move_out_date || today() };
    }
    if (!d.contract_start && String(d.status || "active") !== "vacated") {
      fail("أدخل تاريخ بداية العقد — بدونه لا يستطيع النظام حساب الاستحقاقات لهذه الوحدة.");
      return;
    }
    const freq = (d.payment_frequency || "monthly") as Frequency;
    const periods = d.contract_periods ? Number(d.contract_periods) : null;
    const payload = {
      /**
       * الحالة تُرسل صراحةً.
       *
       * كانت غائبة عن الحمولة كلها، فالوحدة التي يُعلَّم لها «الوحدة شاغرة»
       * تُحفظ بالحالة الافتراضية «مؤجّرة» بلا تاريخ بداية — فتظهر «بيانات
       * ناقصة — لا تاريخ بداية». المربع كان يعمل في النموذج ولا يصل للقاعدة.
       */
      status: String(d.status || "active") === "vacated" ? "vacated" : "active",
      move_out_date: String(d.status || "active") === "vacated" ? (d.move_out_date || today()) : null,
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
      /* يوم السداد (مراجعة 29 سبتمبر 2026): من «أول استحقاق» إن أُدخل — هو ما
         كتبه المكتب صراحةً — لا من بداية العقد. كان عقدٌ يبدأ 1 يناير وأول
         استحقاقه 20 يناير يُجدوَل على الأول من كل شهر، فيظهر المستأجر «متأخرًا»
         من يوم 2 إلى 19 وهو لم يتأخر.
         وعند التعديل بلا «أول استحقاق» وبلا تغيير في البداية، يبقى اليوم المحفوظ:
         عقدٌ جُدِّد (فصُفِّر أول استحقاقه) لا يفقد يومه بتعديل اسم أو جوال. */
      billing_anchor_day: (() => {
        const dayOf = (v?: string | null) => (v ? parseDate(v).getDate() : null);
        if (d.first_due) return dayOf(d.first_due);
        const orig: any = id ? tenants.find((x) => x.id === id) : null;
        if (orig?.billing_anchor_day && orig.contract_start === d.contract_start) return Number(orig.billing_anchor_day);
        return dayOf(d.contract_start);
      })(),
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
      /* القيم التي فُتح بها النموذج (30 سبتمبر 2026) — أساس «هل غيّر الموظف العدّادات؟»
         وأساس حارس التزامن أدناه. بدونها: النموذج المفتوح دقائق يحمل نسخة قديمة. */
      const init: { paid_periods: number | null; carried_debt: number | null } =
        (d as any)._init || { paid_periods: prev?.paid_periods ?? null, carried_debt: (prev as any)?.carried_debt ?? null };
      /**
       * تعديل الإيجار وسط عقد فيه دفعات مسجَّلة يُعيد تقييمها كلها بالسعر
       * الجديد: من دفع شهرين بـ5,000 يصير كأنه دفع بـ8,000، فتتغيّر متأخراته
       * دون أن يدفع شيئًا. هذا صحيح حسابيًّا (النظام يعدّ دفعات لا مبالغ)
       * لكنه مفاجئ — فنُنبّه ونقترح التجديد الذي يبدأ مدة جديدة بسعر جديد.
       */
      /**
       * تغيير دورة السداد وسط عقد عليه دفعات: العدّاد يعدّ دفعات بالدورة القديمة.
       * «مسدَّد 7» شهرية (سبعة أشهر) تُقرأ بعد التغيير سبع دفعات نصف سنوية —
       * ثلاث سنوات ونصف مقدّمًا، فيظهر المستأجر منتظمًا لسنوات. لم يكن عليه حارس
       * (بخلاف تغيير الإيجار أدناه). نمنع الحفظ ما لم يُراجَع «مسدَّد حتى»، ونعرض
       * ما يعادله بالدورة الجديدة.
       */
      if (prev && (prev.paid_periods || 0) > 0 && (d.payment_frequency || "monthly") !== (prev.payment_frequency || "monthly")
          && Number(d.paid_periods) === Number(init.paid_periods)) {
        const MO: Record<string, number> = { monthly: 1, quarterly: 3, trimester: 4, semiannual: 6, annual: 12 };
        const oldM = MO[prev.payment_frequency || "monthly"], newM = MO[d.payment_frequency || "monthly"];
        const months = (prev.paid_periods || 0) * (oldM || 0);
        const eq = oldM && newM ? months / newM : null;
        fail(`غيّرت دورة السداد لعقد عليه ${prev.paid_periods} دفعة مسجَّلة بالدورة القديمة`
          + (eq !== null ? ` (= ${months} ${months === 1 ? "شهر" : "أشهر"}${Number.isInteger(eq) ? `، أي ${eq} بالدورة الجديدة` : `، أي ${Math.floor(eq)} دفعة وجزء من التالية بالدورة الجديدة`})` : "")
          + `. راجع «مسدَّد حتى» واختر آخر دفعة سُدّدت فعلًا بالدورة الجديدة، ثم احفظ. أو جدّد العقد بالدورة الجديدة.`);
        return;
      }
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
      const paidChanged = paidNew !== (Number(init.paid_periods) || 0);
      const carriedChanged = Math.abs((Number(payload.carried_debt) || 0) - (Number(init.carried_debt) || 0)) > 0.005;
      if (prev && paidChanged) {
        const { count } = await supabase.from("payments")
          .select("id", { count: "exact", head: true }).eq("tenant_id", id);
        const recorded = Number(count) || 0;
        if (recorded > 0 && !confirm(
          `تغيير «الدفعات المسدَّدة» من ${Number(init.paid_periods) || 0} إلى ${paidNew}؟\n\n`
          + `على هذه الوحدة ${recorded} دفعة مسجّلة في السجل.\n`
          + `التعديل اليدوي لا يضيف ولا يحذف دفعة — فقد يختلف العدّاد عن سجل المدفوعات وتقرير المالك.\n\n`
          + `للتراجع عن دفعة سُجّلت خطأً استعمل «↩︎ تراجع عن آخر دفعة».\n\nمتابعة؟`
        )) { setSaving(false); return; }
      }

      const reletting = prev && isVacant(prev);
      /* إعادة التأجير عبر دالة واحدة لا تتجزأ (schema-v45): أرشفة السابق
         بدينه ودفعاته، ثم كتابة الجديد نظيفًا. لا يُترك نصف عملية. */
      if (reletting && (d as any)._relet) {
        const opening = Math.max(0, Math.min(Math.floor(Number(d.paid_periods) || 0), periods || 9999));
        const { data: rr, error: re } = await supabase.rpc("watheq_relet_unit", {
          p_tenant: id, p_debt: Number((d as any)._reletDebt) || 0, p_new: payload,
        });
        if (re) {
          console.error("Watheq relet error:", re);
          return fail(/does not exist|function/i.test(re.message)
            ? "إعادة التأجير تحتاج تحديث قاعدة البيانات — شغّل schema-v45 أولًا."
            : re.message);
        }
        /* الجديد دفع عند التوقيع؟ رصيده الافتتاحي بعد الأرشفة (يُسجَّل أثره) */
        /* كان فشله يُعرض نجاحًا فيظهر الجديد متأخرًا بعد أول تحديث */
        if (opening > 0) {
          const { error: oe } = await supabase.from("tenants").update({ paid_periods: opening }).eq("id", id);
          if (oe) notify("err", `أُعيد تأجير الوحدة، لكن تعذّر حفظ ما دفعه ${payload.name} عند التوقيع (${opening} ${opening === 1 ? "دفعة" : "دفعات"}) — عدّله من «تعديل البيانات».`);
        }
        const fresh = { ...prev, ...payload, status: "active", paid_periods: opening, partial_amount: 0,
          carried_debt: 0, carried_debt_note: null, move_out_date: null } as Tenant;
        setItems(items.map((p) => p.id === active.id
          ? { ...p, tenants: p.tenants.map((t) => (t.id === id ? fresh : t)) } : p));
        /* مصير الدين: سداد نقدي في الدفتر، أو شطب بأثر. إن فشل هذا الجزء يبقى
           الدين مفتوحًا باسم صاحبه — لا يضيع شيء، ويُسوّى من «الديون المرحَّلة». */
        const arch = (rr as any)?.past_tenancy_id, fateD = (d as any)._reletFate;
        let fateErr: string | null = null;
        if (arch && Number((rr as any)?.debt) > 0 && fateD === "paid") {
          const mo = String((d as any)._prevMoveOut || "").slice(0, 10);
          const on = mo && mo <= today() ? mo : today();
          const { error: pe } = await supabase.rpc("watheq_record_past_payment", { p_past: arch, p_amount: Number((rr as any).debt), p_paid_on: on });
          if (pe) fateErr = pe.message;
        } else if (arch && Number((rr as any)?.debt) > 0 && fateD === "forgiven") {
          const { error: we } = await supabase.rpc("watheq_set_past_debt", { p_past: arch, p_status: "written_off", p_note: "تنازل عند إعادة التأجير" });
          if (we) fateErr = we.message;
        }
        const moved = Number((rr as any)?.payments_moved) || 0, dbt = Number((rr as any)?.debt) || 0;
        notify(fateErr ? "err" : "ok", `سُجّل ${payload.name} في الوحدة ${payload.unit || ""}`
          + (fateErr ? ` — لكن تعذّرت تسوية دين ${(d as any)._prevName || "السابق"} (${fateErr}). هو محفوظ مفتوحًا في «الديون المرحَّلة» — سوِّه من هناك.`
            : dbt > 0 && fateD === "paid" ? ` — وسداد ${(d as any)._prevName || "السابق"} (${sar(dbt)}) سُجّل في الدفتر`
            : dbt > 0 && fateD === "forgiven" ? ` — ودين ${(d as any)._prevName || "السابق"} (${sar(dbt)}) شُطب وحُفظ أثره`
            : dbt > 0 ? ` — ودين ${(d as any)._prevName || "السابق"} (${sar(dbt)}) محفوظ باسمه في «الديون المرحَّلة»` : "")
          + (moved ? ` · ودفعاته (${moved}) انتقلت معه` : ""));
        setSaving(false); setSaveErr(null); setModal(null);
        loadPast();
        router.refresh();
        return;
      }
      /* إعادة التأجير طريقها زرّ «إعادة تأجير» وحده. كان أي حفظ لوحدة شاغرة
         يُعدّ إعادة تأجير: «تعديل البيانات» لتصحيح رقم عدّاد مثلًا يُعيد
         المستأجر الذي غادر «مؤجّرًا» بعدّاد صفر — فيبدو مطالَبًا بالعقد كله. */
      if (reletting && payload.status === "active") {
        return fail("لتأجير الوحدة لمستأجر جديد استعمل «إعادة تأجير» من قائمة الوحدة — تحفظ المستأجر السابق ودينه ودفعاته. والتعديل هنا يُبقي الوحدة شاغرة.");
      }
      /* تعديل ينقل البداية للأمام ويصفّر المسدَّد وعلى المدة متأخرات: يُحفظ تصحيحًا
         (schema-v49) فتختفي متأخرات تلك المدة. إن كان المقصود تجديدًا فطريقه
         «تجديد العقد» الذي يسأل عنها. كان التعديل «يجدّد» صامتًا ويمحوها. */
      if (prev && prev.contract_start && payload.contract_start && paidNew === 0) {
        const jump = (Date.parse(String(payload.contract_start)) - Date.parse(String(prev.contract_start))) / 86400000;
        const st0 = contractState(prev, { graceDays: Number(active.grace_days) || 0, ...windowsOf(active) });
        if (jump >= 25 && (st0.amountDue || 0) > 0 && !confirm(
          `نقلتَ بداية العقد ${plural(jump, "يومًا واحدًا", "يومين", "أيام", "يومًا")} للأمام وصفّرت المسدَّد، وعلى المدة الحالية متأخرات ${sar(st0.amountDue)} ريال.\n\n`
          + `إن كان هذا تجديدًا لعقد جديد: اضغط «إلغاء» واستعمل «تجديد العقد» من قائمة الوحدة — يسألك عن المتأخرات ولا يضيّعها.\n\n`
          + `إن كان تصحيحًا لبيانات أُدخلت خطأً: اضغط «موافق».`)) { setSaving(false); return; }
      }
      /**
       * كتابة قديمة فوق دفعة زميل (30 سبتمبر 2026).
       *
       * كان الحفظ يكتب «الدفعات المسدَّدة» و«الدين المرحَّل» من نسخة النموذج دائمًا:
       * موظف يفتح التعديل لتصحيح جوال، وزميله يسجّل دفعة في هذه الأثناء (العدّاد
       * صار 4)، فيحفظ الأول ويُعيد العدّاد 3 — دفعة مستلمة تختفي من الحساب.
       * الآن: العدّادات المالية لا تُكتب إلا إن غيّرها الموظف فعلًا، وحين تُكتب
       * يُشترط أن تكون في القاعدة كما فُتح بها النموذج؛ وإلا لا يُكتب شيء.
       */
      const { carried_debt: _cdNew, ...base } = payload as any;
      const full: any = { ...base,
        ...(paidChanged ? { paid_periods: paidNew } : {}),
        ...(carriedChanged ? { carried_debt: _cdNew } : {}) };
      let upd: any = supabase.from("tenants").update(full).eq("id", id);
      const guard = (col: string, v: any) => { upd = v === null || v === undefined ? upd.is(col, null) : upd.eq(col, v); };
      if (paidChanged) guard("paid_periods", init.paid_periods);
      if (carriedChanged) guard("carried_debt", init.carried_debt);
      const { data: _u2, error } = await upd.select("id");
      if (error) { console.error("Watheq save error:", error); return fail(error.message); }
      if (!_u2 || _u2.length === 0) {
        if (paidChanged || carriedChanged) {
          /* صفر صفوف مع حارس: إمّا تغيّر العدّاد في القاعدة، وإمّا الصلاحيات. نقرأ لنعرف */
          const { data: cur } = await supabase.from("tenants").select("*").eq("id", id).limit(1);
          const row = Array.isArray(cur) ? cur[0] : null;
          if (row && (Number(row.paid_periods) !== Number(init.paid_periods ?? 0) || Math.abs((Number(row.carried_debt) || 0) - (Number(init.carried_debt) || 0)) > 0.005)) {
            setItems(items.map((pp) => pp.id === active.id
              ? { ...pp, tenants: pp.tenants.map((x) => (x.id === id ? { ...x, ...row } as Tenant : x)) } : pp));
            return fail(`لم يُحفظ شيء: سجّل أحد الزملاء دفعة أو عدّل رصيد هذه ${ul} أثناء فتحك النموذج `
              + `(الدفعات المسدَّدة الآن ${Number(row.paid_periods) || 0}${Number(row.carried_debt) > 0 ? ` · الدين المرحَّل ${sar(row.carried_debt)}` : ""}). `
              + `أغلق النموذج وافتحه من جديد لترى الأرقام الحالية، ثم أعد تعديلك.`);
          }
        }
        return fail("هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.");
      }
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
    if (error) { console.error("Watheq save error:", error); notify("err", error.message); return false; }
    /* تعديل رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نُحدّث الشاشة كأنه نجح */
    if (!_upd || _upd.length === 0) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return false; }
    if (collectedDelta) await supabase.from("properties").update({ collected: (active.collected || 0) + collectedDelta }).eq("id", active.id);
    setItems(items.map((p) => p.id === active.id ? {
      ...p,
      collected: collectedDelta ? (p.collected || 0) + collectedDelta : p.collected,
      tenants: p.tenants.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    } : p));
      return true;
  }

  async function deleteTenant(id: string) {
    if (!active) return;
    /**
     * الحذف لا يمحو الدفعات — تبقى في السجل بلا وحدة (on delete set null)،
     * وتبقى في تقارير المالك وكشف التحصيل (تجمع كل دفعات العقار). لكنها كانت
     * تفقد اسم دافعها ووحدته (تأخذهما من الصفّ المحذوف) فتظهر «—». الآن يُختم
     * عليها الاسم والوحدة قبل الحذف — كما يفعل الأرشيف عند إعادة التأجير.
     */
    const t = active.tenants.find((x) => x.id === id);
    const { count } = await supabase.from("payments")
      .select("id", { count: "exact", head: true }).eq("tenant_id", id);
    const n = Number(count) || 0;
    const msg = n > 0
      ? `حذف «${t?.name || "الوحدة"}» — ${ul} ${t?.unit || "—"}؟\n\n⚠️ عليها ${n} دفعة مسجّلة.\nالدفعات لن تُحذف: تبقى في تقارير المالك وكشف التحصيل باسم «${t?.name || "—"}» و${ul} ${t?.unit || "—"}، لكنها تختفي من كشف الوحدة.\n\nإن كان المستأجر خرج وسيحلّ غيره، فاستعمل «إعادة التأجير» لا الحذف — تحفظ دينه وسجلّه.\nوإن كنت تحذف صفًّا مكرّرًا فاحذف الصفّ الذي لا دفعات عليه.\n\nمتابعة الحذف؟`
      : `حذف «${t?.name || "الوحدة"}» — ${ul} ${t?.unit || "—"}؟\n\nلا دفعات مسجّلة عليها.`;
    if (!confirm(msg)) return;
    if (n > 0 && t) {
      /* اسم الدافع ووحدته على دفعاته قبل الحذف — وإلا تظهر «—» في التقارير */
      const { error: se } = await supabase.from("payments")
        .update({ payer_name: t.name || null, unit_label: t.unit || null })
        .eq("tenant_id", id).is("payer_name", null);
      if (se && !/payer_name|unit_label|column/i.test(se.message)) {
        return notify("err", `لم يُحذف شيء: تعذّر حفظ اسم المستأجر على دفعاته (${se.message}).`);
      }
    }
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

  async function doRenew(t: Tenant, opts: { periods: number; newAmount: number | null; newFrequency: Frequency; arrears?: "carry" }) {
    if (!active) return;
    /**
     * متأخرات المدة المنتهية: ثلاثة مصائر لا اثنان.
     *
     * كان «إلغاء = سُدّدت بالكامل ولا تُرحَّل» يمحوها بلا أثر: إن استُلمت نقدًا
     * لم تدخل الدفتر ولا تقرير المالك، وإن تُنوزل عنها ضاع أنها كانت دينًا —
     * العطل نفسه الذي أُصلح في إعادة التأجير. الآن تُرحَّل دائمًا أولًا (فلا
     * تضيع مهما حدث بعدها)، ثم: تبقى، أو «استلمتُها» (سداد نقدي في الدفتر)، أو
     * «تنازلتُ عنها» (شطب جزئي بسببه — schema-v48).
     */
    /* الرقم المعروض في السؤال هو ما سيُرحَّل فعلًا — من الدالة نفسها، لا
       حسابٌ موازٍ. كان يعرض متأخر اليوم (contractState) بينما يُرحَّل رصيد
       المدة كاملة، فيختلف الرقمان عند التجديد المبكر أو داخل مهلة السماح. */
    /**
     * التجديد من بيانات طازجة وبحارس (30 سبتمبر 2026).
     *
     * كان يحسب من نسخة الشاشة: دفعة سجّلها زميل قبل دقيقة لا تدخل الرصيد
     * المرحَّل (فيُرحَّل دين دُفع)، ونقرتان على «تأكيد التجديد» أو موظفان معًا
     * يجدّدان مرتين — سنتان بدل سنة ورصيد مرحَّل مضاعف. الآن نقرأ الصفّ من
     * القاعدة، ونكتب بشرط أن تكون نهاية المدة ما زالت كما قرأناها.
     */
    const { data: freshRows, error: fErr } = await supabase.from("tenants").select("*").eq("id", t.id).limit(1);
    if (fErr) return notify("err", `تعذّر قراءة العقد قبل التجديد — لم يُجدَّد (${fErr.message}).`);
    const fresh: Tenant | null = Array.isArray(freshRows) && freshRows[0] ? { ...t, ...freshRows[0] } : null;
    if (!fresh) return notify("err", "لم يعد هذا العقد موجودًا — حدّث الصفحة.");
    if (String(fresh.contract_end || "") !== String(t.contract_end || "") || String(fresh.contract_start || "") !== String(t.contract_start || "")) {
      setItems(items.map((pp) => pp.id === active.id ? { ...pp, tenants: pp.tenants.map((x) => (x.id === t.id ? fresh : x)) } : pp));
      setRenewing(null);
      return notify("err", `جُدّد عقد ${t.name} أو عُدّلت مدته للتو من جهاز آخر (ينتهي الآن ${fresh.contract_end || "—"}) — لم يُجدَّد مرة ثانية. راجع الوحدة ثم جدّد إن لزم.`);
    }
    /* خارج نافذة التجديد: غالبًا ضغطة على الوحدة الخطأ — نسأل ولا نمنع */
    if (!needsRenewal(fresh) && renewAcked.current !== t.id && !confirm(`عقد ${t.name} لا ينتهي قبل ${contractState(fresh).endDate || "—"} — خارج نافذة التجديد.\n\nالتجديد الآن يبدأ المدة الجديدة من نهاية الحالية ويُرحّل ما لم يُدفع منها دينًا.\n\nالمتابعة على أي حال؟`)) return;
    /* vat: الرصيد المرحَّل بضريبة الوحدة (lib/contracts يقبله حين يدعمه؛ any ليبني في الحالين) */
    const renewOpts: any = { periods: opts.periods, newAmount: opts.newAmount, newFrequency: opts.newFrequency, arrears: "carry", vat: unitVat(fresh, active) };
    const fields = renewContract(fresh, renewOpts);
    t = fresh;
    const toSettle = Math.round(((Number((fields as any).carried_debt) || 0) - (Number(t.carried_debt) || 0)) * 100) / 100;
    let fate: "carry" | "paid" | "forgiven" = "carry";
    if (toSettle > 0 && opts.arrears !== "carry") {
      const keep = confirm(`على ${t.name} ${sar(toSettle)} ريال متبقية من المدة المنتهية (متأخرة أو لم تحلّ بعد).\n\n`
        + `موافق = تبقى دينًا مرحَّلًا على العقد الجديد حتى تُسدَّد.\n`
        + `إلغاء = سُوّيت (ستُسأل: استلمتَها أم تنازلتَ عنها).`);
      if (!keep) fate = confirm(`كيف سُوّي المتبقي على ${t.name} (${sar(toSettle)} ريال)؟\n\n`
        + `موافق = استلمتُه — يُسجَّل في الدفتر ويظهر في تقرير المالك.\n`
        + `إلغاء = تنازلتُ عنه — يُشطب ويُحفظ أثره.`) ? "paid" : "forgiven";
    }
    let rq: any = supabase.from("tenants").update(fields).eq("id", t.id);
    rq = t.contract_end ? rq.eq("contract_end", t.contract_end) : rq.is("contract_end", null);
    rq = t.contract_start ? rq.eq("contract_start", t.contract_start) : rq.is("contract_start", null);
    const { data: _u3, error } = await rq.select("id");
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    if (!_u3 || _u3.length === 0) {
      /* صفر صفوف: جدّده غيرنا بين القراءة والكتابة، أو لا صلاحية */
      const { data: again } = await supabase.from("tenants").select("contract_end").eq("id", t.id).limit(1);
      if (Array.isArray(again) && again[0] && String(again[0].contract_end || "") !== String(t.contract_end || "")) {
        setRenewing(null); router.refresh();
        return notify("err", `جُدّد عقد ${t.name} من جهاز آخر في اللحظة نفسها — لم يُجدَّد مرة ثانية.`);
      }
      return notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.");
    }
    /* ما رحّله التجديد فعلًا — هو ما يُسدَّد أو يُشطب، لا رقمٌ محسوب منفصلًا */
    const carriedNow = Number((fields as any).carried_debt) || 0;
    const moved = Math.round((carriedNow - (Number(t.carried_debt) || 0)) * 100) / 100;
    let carriedAfter = carriedNow;
    if (moved > 0 && fate !== "carry") {
      const { error: fe } = fate === "paid"
        ? await supabase.rpc("watheq_record_carried_payment", { p_tenant: t.id, p_amount: moved, p_paid_on: today() })
        : await supabase.rpc("watheq_write_off_carried", { p_tenant: t.id, p_amount: moved, p_note: "تنازل عن متأخرات المدة المنتهية عند التجديد" });
      if (fe) notify("err", `جُدّد العقد، لكن تعذّرت تسوية المتأخرات (${/p_amount|does not exist|function/i.test(fe.message)
        ? "تحتاج تحديث قاعدة البيانات — شغّل schema-v48" : fe.message}). هي محفوظة دينًا مرحَّلًا — سوِّها من «الديون المرحَّلة».`);
      else {
        carriedAfter = Math.round((carriedNow - moved) * 100) / 100;
        notify("ok", fate === "paid" ? `جُدّد العقد — وسُجّل استلام المتأخرات (${sar(moved)} ريال) في الدفتر.`
          : `جُدّد العقد — وشُطبت المتأخرات (${sar(moved)} ريال) وحُفظ أثرها.`);
      }
    } else if (carriedNow > 0) notify("ok", `جُدّد العقد — ورُحّل دين ${sar(carriedNow)} ريال يظهر على الوحدة حتى يُسدَّد.`);
    // توثيق التجديد في سجل العقار
    /* الملاحظة توثيق لا شرط: إن رفضتها الصلاحيات نُكمل ونُعلم بلا إفشال العملية */
    const noteRes = await supabase.from("property_notes").insert({
      property_id: active.id, note_date: today(),
      text: `تجديد عقد ${t.name} (${unitLabel(active.property_type)} ${t.unit || "—"}) — من ${fields.contract_start} إلى ${fields.contract_end} بقيمة ${sar(fields.rent_amount)} ريال / ${freqShort(fields.payment_frequency)}`,
    });
    setItems(items.map((pp) => pp.id === active.id ? {
      ...pp,
      tenants: pp.tenants.map((x) => (x.id === t.id ? { ...x, ...fields, carried_debt: carriedAfter } as Tenant : x)),
    } : pp));
    setRenewing(null);
    if (noteRes.error) notify("err", "جُدّد العقد، لكن تعذّرت كتابة الملاحظة في سجل العقار.");
    router.refresh();
  }

  async function openStatement(t: Tenant, mode: "brief" | "full" = "full") {
    if (!active) return;
    // نجلب سجل المدفوعات الموثّق ليظهر في الكشف بتواريخه وطرقه
    /* دفعات المدة الحالية وحدها (schema-v44): بعد التجديد أو إعادة التأجير
       كان الكشف يجمع دفعات المدة السابقة — أو دفعات مستأجر سابق — مع قيمة
       عقد المدة الحالية، فيقول «المسدَّد 60,000 من 30,000». */
    let q = supabase.from("payments")
      .select("*")
      .eq("tenant_id", t.id);
    const since = (t as any).term_started_at;
    if (since && /^\d{4}-\d{2}-\d{2}T/.test(String(since))) q = q.gte("created_at", since);
    const { data, error } = await q.order("paid_on", { ascending: true }).limit(500);
    if (error) console.error("Watheq statement payments error:", error);
    openDoc(statementHTML(t as any, active as any, issuer || {}, (data || []) as any, mode));
  }

  const [stmtOpen, setStmtOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [debtOpen, setDebtOpen] = useState(false);
  /* سجلّ فواتير الوحدة: الجدول كان يُكتب فيه ولا يُقرأ — فالمكتب يُصدر
     ثلاث فواتير لوحدة ولا يستطيع رؤيتها ولا إعادة طباعة واحدة طلبها المستأجر. */
  const [invoicesFor, setInvoicesFor] = useState<Tenant | null>(null);
  const [collOpen, setCollOpen] = useState(false);
  /* خطأ الحفظ يُعرض داخل النموذج لا إشعارًا عائمًا في أعلى الصفحة: على
     الجوال يكون المستخدم منزلًا داخل نموذج طويل، فيضغط «حفظ» ويظهر الإشعار
     خارج نظره — فيقول «ضغطت ولا صار شي». */
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fail = (m: string) => { setSaveErr(m); notify("err", m); setSaving(false); };
  const hasDemo = items.some((p) => (p as any).is_demo);
  /* إجمالي الديون المرحَّلة — رقم يتراكم بصمت ولا يظهر في أي شاشة */
  const carriedTotal = items.reduce((a, p) => a + (p.tenants || []).reduce((b, t) => b + Math.max(0, Number((t as any).carried_debt) || 0), 0), 0)
    + pastOwed();

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

  /** دعوة التسجيل في التجربة العامة — DemoClient يستمع لهذا الحدث */
  const demoJoin = () => window.dispatchEvent(new CustomEvent("watheq:demo-join"));

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
    /* على دفعات — Supabase يقصّ عند 1000 صف بصمت */
    const [pay, exp] = await Promise.all([
      fetchAllRows(supabase as any, "payments", "*",
        (q) => q.eq("property_id", active.id).gte("paid_on", period.from).lte("paid_on", period.to))
        .then((data) => ({ data, error: null as any })).catch((e) => ({ data: null as any, error: { message: e.message } })),
      /* كل الحقول: «على من» (billable) و«من دفع» (paid_by) يحدّدان صافي المالك */
      fetchAllRows(supabase as any, "expenses", "*",
        (q) => q.eq("property_id", active.id).gte("spent_on", period.from).lte("spent_on", period.to))
        .then((data) => ({ data, error: null as any })).catch((e) => ({ data: null as any, error: { message: e.message } })),
    ]);
    if (pay.error) return notify("err", pay.error.message);
    const nameOf: Record<string, { name: string; unit: string | null }> = {};
    (active.tenants || []).forEach((t) => { nameOf[t.id] = { name: t.name, unit: t.unit }; });
    const rowsP = (pay.data || []).map((x: any) => ({
      /* الساكن الحالي باسمه الحيّ (يسري عليه أي تصحيح)؛ ودفعات من سبقه بالاسم المحفوظ فيها */
      ...x, tenant_name: (x.tenant_id && nameOf[x.tenant_id]?.name) || x.payer_name || "—", unit: (x.tenant_id && nameOf[x.tenant_id]?.unit) || x.unit_label || null,
    }));
    /* إعدادات الضريبة للمستأجرين السابقين — لضريبة دفعاتهم (بإعدادات من دفع) */
    const pastQ = await supabase.from("past_tenancies").select("id, snapshot").eq("property_id", active.id).limit(2000);
    openDoc(propertyStatementHTML(active as any, issuer || {}, mode, period, rowsP as any, (exp.data || []) as any,
      pastQ.error ? undefined : pastVatOf(pastQ.data as any)));
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
        t.contract_start || "", st.endDate || "", unitStatusLabel(key as any, st),
        key === "late" || key === "partial" ? dueWithVat(st, t, active) : 0, st.nextDueDate || ""]
        .map(csvCell).join(",");   /* csvCell: يمنع حقن المعادلات في Excel (30 سبتمبر 2026) */
    });
    const csv = "\uFEFF" + [head.map(csvCell).join(","), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const aEl = document.createElement("a");
    aEl.href = url; aEl.download = `${active.name}-${today()}.csv`;
    aEl.click(); URL.revokeObjectURL(url);
  }

  async function openInvoice(t: Tenant) {
    if (!active) return;
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0, ...windowsOf(active) });
    /* فارغ = سنة بدورة العقد (كان 12 لكل الدورات: «الدفعة 3 من 12» لعقد ربع سنوي) */
    const total = t.contract_periods || defaultTermPeriods((t.payment_frequency || "monthly") as Frequency);
    const n = Math.min((t.paid_periods || 0) + 1, total);
    const period = `الدفعة ${n} من ${total}`;
    const amount = Number(t.rent_amount) || 0;
    const dueDate = st.nextDueDate || today();

    /* فاتورة بمبلغ صفر: وُجدت واحدة فعلًا في بيانات الإنتاج (28 سبتمبر 2026).
       تحدث حين يكون إيجار الوحدة صفرًا أو فارغًا — وحدة أُنشئت ولم يُدخَل
       إيجارها بعد. والفاتورة الضريبية بصفر ريال مستند بلا معنى: تحرق رقمًا
       من التسلسل، وتظهر في تصدير الفواتير وفي أي مراجعة ضريبية بلا تفسير.
       نمنعها ونقول أين يُصحَّح، لا نمنع بصمت. */
    if (!(amount > 0)) {
      notify("err", `لا تُصدَر فاتورة بمبلغ صفر — أدخل إيجار ${unitLabel(active.property_type)} ${t.unit || t.name} أولًا من «تعديل البيانات».`);
      return;
    }

    /* فاتورة ثانية لنفس الدفعة تُصدَر بصمت: المكتب يضغط «فاتورة» مرتين فتخرج
       فاتورتان ضريبيتان برقمين مختلفين لنفس المبلغ ونفس الفترة، ولا شيء ينبّه.
       نسأل قبل الإصدار — والقرار يبقى له، فقد يكون الإصدار الثاني مقصودًا. */
    const { data: dup } = await supabase.from("invoices")
      .select("invoice_no,issue_date")
      .eq("tenant_id", t.id).eq("period_label", period).neq("status", "void").limit(3);
    if (dup && dup.length) {
      const list = dup.map((x: any) => `${x.invoice_no}${x.issue_date ? ` (${arDate(x.issue_date)})` : ""}`).join("\n");
      if (!confirm(
        `صدرت فاتورة لنفس الفترة من قبل:\n\n${list}\n\n` +
        `${period} — ${t.name}\n\nتُصدر فاتورة أخرى بنفس الفترة؟\n` +
        `موافق = إصدار فاتورة جديدة برقم جديد\nإلغاء = فتح سجل الفواتير لإعادة طباعة واحدة منها`,
      )) { setInvoicesFor(t); return; }
    }

    // ترقيم متسلسل من قاعدة البيانات
    /* رقم الفاتورة الضريبية من القاعدة وحدها. كان الفشل يُسقط إلى «INV-السنة-0001»
       بصمت — فاتورة ضريبية برقم مكرَّر. الآن الفشل يوقف الإصدار ويقول لماذا. */
    /* المنتهي: الإدراج سيُرفض (v67) بعد حجز رقم — فجوة في تسلسل الفواتير الضريبية */
    if (limits?.readOnly) return notify("err", LIMIT_MSG.readOnly);
    const { data, error: invErr } = await supabase.rpc("next_invoice_no", { p_user: await officeId(supabase) });
    if (invErr || typeof data !== "string") {
      notify("err", /not authorized/i.test(invErr?.message || "")
        ? "لا تملك صلاحية إصدار الفواتير في هذا المكتب"
        : `تعذّر الحصول على رقم فاتورة — لم تُصدر${invErr?.message ? ` (${invErr.message})` : ""}`);
      return;
    }
    const invoiceNo = data;

    /* سجلّ الفاتورة قبل طباعتها: فاتورة ضريبية صدرت بلا سجلّ لا تظهر في التصدير */
    const { error: insErr } = await supabase.from("invoices").insert({
      user_id: await officeId(supabase),
      tenant_id: t.id, property_id: active.id,
      invoice_no: invoiceNo, due_date: dueDate, period_label: period, amount,
      issue_date: today(), status: "issued",
      /* إعدادات الضريبة يوم الإصدار — لتُطبع النسخة المعادة كما صدرت (schema-v56) */
      ...(() => { const v = unitVat(t, active); return { vat_enabled: !!v.enabled, vat_rate: Number(v.rate) || 15, vat_inclusive: v.inclusive !== false }; })(),
    });
    if (insErr) return notify("err", `تعذّر حفظ الفاتورة ${invoiceNo} — لم تُصدر (${insErr.message})`);

    openDoc(invoiceHTML(t as any, active as any, { invoice_no: invoiceNo, amount, due_date: dueDate, period_label: period }, issuer || {}));
  }

  /** تذكير ودّي — يوضّح تفاصيل المطالبة وتاريخ استحقاقها */
  function remindLink(t: Tenant) {
    if (!active) return "#";
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0, ...windowsOf(active) });
    /* الموقِّع: المكتب لا «مدير العقار» (مراجعة 29 سبتمبر 2026) — ذاك الحقل
       تكتب فيه مكاتب اسم المالك، فتصل مطالبة المكتب موقّعة باسم المالك.
       البوت أُصلح بهذا سابقًا (lib/reports.ts: signer) وبقيت هذه الرسالة. */
    const who = (issuer as any)?.billing_name || orgName || active.manager || "إدارة الأملاك";
    const ul = unitLabel(active.property_type);
    const unit = `${ul} (${t.unit || "—"})`;
    const v = { enabled: !!active.vat_enabled, rate: Number(active.vat_rate) || 15, inclusive: active.vat_inclusive !== false };
    const vUnit = active && unitVatApplies(t, active) ? v : { ...v, enabled: false };
    const one = splitVat(Number(t.rent_amount) || 0, vUnit);
    /* المطلوب كما في كشف المستأجر: متأخر المدة شاملًا الضريبة المضافة + الدين
       المرحَّل. كانت الرسالة تذكر «قيمة الدفعة 11,500» ثم «المتبقّي 20,000»
       لدفعتين متأخرتين، والمطلوب 23,000 — ولا تذكر الدين المرحَّل أبدًا. */
    const rentOwed = vUnit.enabled ? splitVat(st.amountDue, vUnit).total : st.amountDue;
    const carried = Math.max(0, Number((t as any).carried_debt) || 0);

    const L: string[] = [`السلام عليكم ورحمة الله، ${t.name}`, ""];

    if (st.unpaid === 0) {
      /* المستأجر يقرأ عقده بالتقويم المكتوب فيه: نضيف الهجري للعقد الهجري،
         وعدد الأيام لأن «1 ديسمبر» وحدها لا تقول إن أمامه شهرين. */
      const dueTxt = `${arDate(st.nextDueDate)}${t.calendar === "hijri" && st.nextDueDate ? ` (${hijriText(st.nextDueDate)})` : ""}`;
      const inDays = st.daysToNextDue;
      /* صف ناقص البيانات بلا تاريخ استحقاق: كانت الرسالة تقول «تستحق بتاريخ —» */
      if (!st.nextDueDate) L.push(`نودّ التواصل معكم بخصوص عقد ${unit} بعقار ${active.name}.`);
      else L.push(`تذكير ودّي بأن الدفعة القادمة عن ${unit} بعقار ${active.name} تستحق بتاريخ ${dueTxt}${
        inDays !== null && inDays > 0 ? ` — بعد ${inDays === 1 ? "يوم واحد" : inDays === 2 ? "يومين" : inDays <= 10 ? `${inDays} أيام` : `${inDays} يومًا`}` : inDays === 0 ? " — اليوم" : ""}.`);
      if (one.total) L.push(`• قيمة الدفعة: ${sar(one.total)} ريال${one.vat > 0 ? ` (منها ${sar(one.vat)} ريال ضريبة قيمة مضافة)` : ""}`);
      if (carried > 0) L.push(`• ويتبقّى عليكم دين مرحَّل من مدة سابقة: ${sar(carried)} ريال`);
    } else {
      L.push(`نودّ تذكيركم بوجود مستحقّات غير مسدَّدة عن ${unit} بعقار ${active.name}، وبيانها:`);
      L.push(`• عدد الدفعات المتأخرة: ${st.unpaid}`);
      if (one.total) L.push(`• قيمة الدفعة: ${sar(one.total)} ريال`);
      if (st.hasPartial) L.push(`• المسدَّد جزئيًّا: ${sar(st.partial)} ريال`);
      L.push(`• المبلغ المتبقّي${vUnit.enabled ? " (شامل الضريبة)" : ""}: ${sar(rentOwed)} ريال`);
      if (carried > 0) {
        L.push(`• دين مرحَّل من مدة سابقة: ${sar(carried)} ريال`);
        L.push(`• الإجمالي المطلوب: ${sar(Math.round((rentOwed + carried) * 100) / 100)} ريال`);
      }
      /* «أقرب دفعة مستحقة» كانت تُطلق على تاريخ مضى — والمستأجر يقرؤها
         موعدًا قادمًا. نسمّي الماضي «مستحقّة منذ» والقادم «القادمة». */
      if (st.nextDueDate) L.push(`• مستحقّة منذ: ${arDate(st.nextDueDate)}${t.calendar === "hijri" ? ` (${hijriText(st.nextDueDate)})` : ""}`);
      if (st.upcomingDate) L.push(`• والدفعة القادمة تستحق بتاريخ: ${arDate(st.upcomingDate)}${t.calendar === "hijri" ? ` (${hijriText(st.upcomingDate)})` : ""}`);
    }
    /* العقد منتهٍ أو قريب الانتهاء: يُذكر في رسالة السداد نفسها حتى لا تُرسل مطالبة
       كأن العقد ممتدّ وهو ينتهي بعد أيام */
    if (st.endDate && st.daysToEnd !== null && (st.daysToEnd < 0 || st.expiringSoon)) {
      L.push(`• علمًا بأن العقد ${st.daysToEnd < 0 ? "انتهى" : "ينتهي"} بتاريخ ${arDate(st.endDate)}${t.calendar === "hijri" ? ` (${hijriText(st.endDate)})` : ""}`);
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

  /** هل يظهر «إشعار انتهاء العقد»؟ عقد منتهٍ أو داخل نافذة «ينتهي قريبًا» للمكتب */
  function endNoticeDue(t: Tenant, st: ReturnType<typeof contractState>) {
    return !isVacant(t) && !t.litigation && !!st.endDate && st.daysToEnd !== null
      && (st.daysToEnd < 0 || st.expiringSoon) && may("send_reminders");
  }

  /** واتساب: إشعار بانتهاء العقد (أو قربه) مع حالة المستحقات صريحة — lib/tenant-messages */
  function endNoticeLink(t: Tenant) {
    if (!active) return "#";
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0, ...windowsOf(active) });
    const who = (issuer as any)?.billing_name || orgName || active.manager || "إدارة الأملاك";
    const v = { enabled: !!active.vat_enabled, rate: Number(active.vat_rate) || 15, inclusive: active.vat_inclusive !== false };
    const vUnit = unitVatApplies(t, active) ? v : { ...v, enabled: false };
    const one = splitVat(Number(t.rent_amount) || 0, vUnit);
    return waLink(t.phone, endNoticeText({
      mode: "end",
      tenantName: t.name || "",
      unitText: `${unitLabel(active.property_type)} (${t.unit || "—"})`,
      propertyName: active.name,
      endDate: st.endDate, daysToEnd: st.daysToEnd,
      hijri: t.calendar === "hijri",
      overdue: vUnit.enabled ? splitVat(st.amountDue, vUnit).total : st.amountDue,
      overdueVat: vUnit.enabled, unpaid: st.unpaid,
      carried: Math.max(0, Number((t as any).carried_debt) || 0),
      upcomingDate: st.unpaid === 0 ? st.nextDueDate : st.upcomingDate,
      upcomingAmount: one.total,
      signer: who,
    }));
  }

  /** ⚡ إشعار تسجيل عداد الكهرباء باسم المستأجر (v74) — للوحدة المؤجّرة ولها رقم حساب وجوال */
  function meterNoticeDue(t: Tenant) {
    return !isVacant(t) && !t.litigation && !!String(t.elec_account || "").trim() && !!t.phone && may("send_reminders");
  }
  async function sendMeterNotice(t: Tenant) {
    if (!active) return;
    const who = (issuer as any)?.billing_name || orgName || active.manager || "إدارة الأملاك";
    /* يُفتح واتساب أولًا وبنقرة المستخدم نفسها — بعد انتظار الشبكة يحجبه المتصفح */
    openExternal(waLink(t.phone, meterNoticeText({
      tenantName: t.name || "",
      unitText: `${unitLabel(active.property_type)} (${t.unit || "—"})`,
      propertyName: active.name,
      account: String(t.elec_account || "").trim(),
      days: 7, signer: who,
    })));
    /* ثم يُحفظ تاريخ الإرسال على الوحدة — هو الإثبات في اللوحة إن احتجّ المستأجر لاحقًا */
    const { data, error } = await supabase.rpc("watheq_log_meter_notice", { p_tenant: t.id });
    if (error) {
      const m = String(error.message || "");
      return notify("err", /watheq_log_meter_notice|function|schema cache/i.test(m)
        ? "فُتحت الرسالة، لكن حفظ تاريخ الإرسال يحتاج تشغيل schema-v74 في Supabase."
        : `فُتحت الرسالة، ولم يُحفظ تاريخ الإرسال: ${m}`);
    }
    const at = String(data || new Date().toISOString());
    setItems((list) => list.map((p) => p.id === active.id ? {
      ...p, tenants: p.tenants.map((x) => (x.id === t.id ? { ...x, elec_notice_at: at,
        elec_notice_count: meterNoticeValid(x) ? (Number(x.elec_notice_count) || 0) + 1 : 1,
        elec_notice_name: String(x.name || "").trim(), elec_notice_account: String(x.elec_account || "").trim() } : x)),
    } : p));
    notify("ok", `حُفظ تاريخ إشعار العداد لـ${t.name || "المستأجر"} — أرسل الرسالة من واتساب.`);
  }

  /** إشعار مكتوب — يوضّح المطالبة والمسار النظامي عبر «إيجار» و«ناجز» */
  function makeNotice(t: Tenant) {
    if (!active) return;
    const st = contractState(t, { graceDays: Number(active?.grace_days) || 0, ...windowsOf(active) });
    const who = (issuer as any)?.billing_name || orgName || active.manager || "إدارة الأملاك";
    const ul = unitLabel(active.property_type);
    const v = { enabled: !!active.vat_enabled, rate: Number(active.vat_rate) || 15, inclusive: active.vat_inclusive !== false };
    const one = splitVat(Number(t.rent_amount) || 0, active && unitVatApplies(t, active) ? v : { ...v, enabled: false });
    const totalDue = splitVat(st.amountDue, active && unitVatApplies(t, active) ? v : { ...v, enabled: false });
    /* (مراجعة 29 سبتمبر 2026) المبلغ في الإشعار = totalDue.total لا amountDue.
       في «مضافة فوق الإيجار» كان يطالب بـ20,000 ثم يقول «ويشمل المبلغ المذكور
       ضريبة 3,000» — جملة غير صحيحة في مطالبة رسمية، ومبلغ أقل من الحق. */
    const carriedN = Math.max(0, Number((t as any).carried_debt) || 0);

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
      `نفيدكم بأنه قد ترصَّد بذمّتكم مبلغ (${sar(totalDue.total)}) ريال، قيمة (${st.unpaid}) دفعة مستحقة عن الفترة من (${arDate(fromDate)}) إلى (${arDate(toDate)})${st.hasPartial ? `، بعد خصم مبلغ (${sar(st.partial)}) ريال مسدَّد جزئيًّا` : ""}، ولم يُسدَّد حتى تاريخ هذا الإشعار.`,
      ...(totalDue.vat > 0 ? ["", `ويشمل المبلغ المذكور ضريبة قيمة مضافة قدرها (${sar(totalDue.vat)}) ريال بنسبة (${v.rate}%).`] : []),
      ...(carriedN > 0 ? ["", `يُضاف إلى ذلك دينٌ مرحَّل من مدة سابقة قدره (${sar(carriedN)}) ريال، ليكون إجمالي المطلوب (${sar(Math.round((totalDue.total + carriedN) * 100) / 100)}) ريال.`] : []),
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
      if (st.vacant) { acc.vacant++; acc.legacy += withVat(st.legacyArrears, t, prop); return; }
      /* التنفيذ القضائي خارج «المتأخر» (قاعدة arrearsOf) ويُعرض مستقلًّا —
         كان الشريط يجمعه فيخالف بطاقة العقار أسفله على الصفحة نفسها */
      if (t.litigation) { if (st.amountDue > 0) { acc.litigation++; acc.litigationOwed += dueWithVat(st, t, prop); } }
      else if (st.status === "late") { acc.late++; acc.overdue += dueWithVat(st, t, prop); }
      if (st.incomplete) acc.incomplete++;
      if (st.status === "soon") { if (st.soonTier === "near") acc.soon++; else acc.due++; }
      /* القاعدة نفسها لشريحة «تجديد» في صفحة العقار (unitStatus = expiring: يقترب أو انتهى
         ولا متأخر ولا تنفيذ) — كان الشريط يعدّ expiringSoon وحده فيختلف الرقمان (30 سبتمبر 2026) */
      if (rowKey(t, st) === "expiring") acc.expiring++;
      acc.monthly += (Number(t.rent_amount) || 0) * PERIODS_PER_MONTH[(t.payment_frequency || "monthly") as Frequency];
    });
    return acc;
  }, { units: 0, late: 0, soon: 0, due: 0, overdue: 0, expiring: 0, monthly: 0, vacant: 0, legacy: 0, incomplete: 0, litigation: 0, litigationOwed: 0 }),
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
              <div className="text-xs font-bold text-goldInk mb-0.5">{n}</div>
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
          <button className="btn btn-ghost" onClick={openNewProperty}>+ إضافة عقار</button>
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

  /* العدّادات كانت تُحسب من كل الصفوف فتبقى «الكل 2 · مستحق 2» بينما
     البحث لا يُرجع شيئًا — فتبدو الشرائح كاذبة. تُحسب الآن مما يطابق
     البحث، ويبقى الفلتر نفسه خارج الحساب حتى لا تختفي بقية الشرائح. */
  /* الحقول والتوحيد نفسها التي تصفّي الصفوف — كانت الشرائح تعدّ بحقول أقل وبلا توحيد (30 سبتمبر 2026) */
  const qNeedle = normalizeSearch(q);
  const searched = qNeedle.length >= 1
    ? allRows.filter(({ t }) => [t.name, t.unit, t.phone, t.national_id, t.contract_no, t.elec_account, t.water_account]
        .some((v) => v && normalizeSearch(v).includes(qNeedle)))
    : allRows;
  const counts = searched.reduce((acc, r) => { acc[r.key] = (acc[r.key] || 0) + 1; return acc; },
    {} as Record<RowKey, number>);
  const lateRows = allRows.filter((r) => r.key === "late" || r.key === "partial");
  /* مصدر واحد لكل أرقام المتأخر على هذه الصفحة وفي المستندات */
  const arrears = arrearsOf(allRows.map((r) => ({ ...r, p })) as any[]);
  const lateCount = arrears.currentCount;
  // الدخل الشهري المتوقع من الوحدات المؤجّرة فقط — الشاغرة كانت تُحسب فيه كأن فيها ساكنًا
  const overdue = arrears.current;
  /**
   * متأخرات الوحدات الشاغرة.
   *
   * تُصنَّف «شاغرة» فلا تدخل عدّاد المتأخر — ومالٌ حقيقي على مستأجر سابق
   * كان يختفي من كل مؤشر: شريط المحفظة، وفلتر «متأخر»، وعمود «ريال متأخر».
   * لا نخلطه بالمتأخر الجاري (يُطالَب به بطريقة أخرى) بل نعرضه بجانبه.
   */
  const pastHere = past.filter((x) => x.property_id === activeId
    && (Number(x.debt_amount) || 0) - (Number(x.debt_paid) || 0) > 0.005);
  const vacantArrears = allRows
    .filter((r) => r.key === "vacant")
    .reduce((s, r) => s + (r.st.totalOwed || 0), 0) + pastOwed(activeId || undefined);
  const vacantArrearsCount = allRows.filter((r) => r.key === "vacant" && (r.st.totalOwed || 0) > 0).length + pastHere.length;
  /**
   * الدخل السنوي للعقار = مجموع إيجارات الوحدات المشغولة مُقيَّسًا على سنة
   * (شهري ×12، ربع سنوي ×4...). و«المحصَّل منه» يُقرأ من سجل الدفعات
   * للفترة التي يختارها المكتب — هذه السنة أو آخر 12 شهرًا أو هذا الشهر.
   */
  /* من جدول الدفعات الفعلي لا من «الإيجار × دفعات السنة»: عقد ثلاثة أشهر
     بتسعة آلاف كان يُعرض 36,000 — أربعة أضعاف. الآن يُجمع ما يستحق فعلًا
     خلال الاثني عشر شهرًا القادمة، فينتهي القصير عند نهايته. */
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
    /* «سداد جزئي» و«منتظم» كانتا شارتين في الجدول بلا فلتر — فمن أراد
       «أرني من سدّد جزئيًّا» لا يجد طريقًا. تظهران حين توجدان فقط. */
    ...(counts.partial ? [{ k: "partial" as const, label: `سداد جزئي ${counts.partial}` }] : []),
    ...(counts.ok ? [{ k: "ok" as const, label: `منتظم ${counts.ok}` }] : []),
  ];

  return (
    <div>
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[70] rounded-xl px-4 py-3 text-sm font-semibold shadow-lg border flex items-center ${
          toast.k === "ok" ? "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]" : "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]"}`}>
          <span>{toast.m}</span>
          {toast.undo && (
            <button type="button" onClick={() => { const u = toast.undo!; setToast(null); u(); }}
              className="ms-3 underline underline-offset-4 font-bold">تراجع</button>
          )}
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

      <TenantPortalInbox db={supabase} enabled={!demo} reloadKey={inboxKey} notify={notify}
        propertyName={(id) => items.find((x) => x.id === id)?.name || "—"}
        canDecide={may("record_payments")} canEditReq={may("edit_units") || may("record_payments")}
        onApprove={startClaimApprove} />

      {items.length > 1 && (

        <div className="bg-deep text-[#EAF1EE] rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="font-display font-bold text-sm text-goldSoft">محفظتك · {plural(items.length, "عقار واحد", "عقاران", "عقارات", "عقارًا")}</div>
          <PortfolioStat v={String(portfolio.units)} l={portfolio.units === 1 ? "وحدة" : portfolio.units === 2 ? "وحدتان" : portfolio.units <= 10 ? "وحدات" : "وحدة"} />
          {/* ستة مؤشرات أربعة منها أصفار، ومؤشران يكرران المعنى نفسه
              («0 متأخرة» و«0 ريال متأخر»). نُبقي الحيّ بارزًا ونطوي الصفري
              في سطر ثانوي — فالعين تجد ما يحتاج إجراءً في نظرة. */}
          {portfolio.overdue > 0 && (
            <PortfolioStat v={sar(portfolio.overdue)}
              l={`ريال متأخر · ${plural(portfolio.late, "وحدة واحدة", "وحدتان", "وحدات", "وحدة")}`} tone="warn" />
          )}
          {portfolio.litigationOwed > 0 && (
            <PortfolioStat v={sar(portfolio.litigationOwed)}
              l={`تحت التنفيذ · ${plural(portfolio.litigation, "وحدة واحدة", "وحدتان", "وحدات", "وحدة")}`} tone="warn" />
          )}
          {(portfolio.due + portfolio.soon) > 0 && (
            <PortfolioStat v={String(portfolio.due + portfolio.soon)} l={`تستحق خلال ${plural(officeSoon, "يوم واحد", "يومين", "أيام", "يومًا")}`} />
          )}
          {portfolio.expiring > 0 && <PortfolioStat v={String(portfolio.expiring)} l="عقود للتجديد أو الإخلاء" />}
          {portfolio.overdue === 0 && (portfolio.due + portfolio.soon) === 0 && portfolio.expiring === 0 && (
            <div className="text-xs text-[#9FB8B3]">لا متأخرات ولا استحقاقات قريبة ✓</div>
          )}
          <PortfolioStat v={`${occupancyPct}%`} l={`إشغال (${portfolio.vacant === 0 ? "لا شاغر" : plural(portfolio.vacant, "وحدة شاغرة", "وحدتان شاغرتان", "شاغرة", "شاغرة")})`} tone={portfolio.vacant ? "warn" : undefined} />
            {/* «دخل شهري تقريبي» للمكتب كله أزيل من صفحة العمارة: نطاق آخر يُقرأ مناقضًا — مكانه «نظرة عامة» */}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0 basis-full sm:basis-auto">
          {/* كان ينهار إلى كلمة في كل سطر بجوار قائمة اختيار العقار على
              الجوال — لأن الحاوية تتقاسم السطر معها بلا حدّ أدنى للعرض. */}
          <h1 className="font-display font-bold text-deep text-lg sm:text-xl flex items-center gap-2 truncate">
            <span className="shrink-0">{typeIcon(p.property_type)}</span> <span className="truncate">{p.name}</span>
          </h1>
          <div className="text-xs sm:text-sm text-muted truncate">{typeLabel(p.property_type)}{p.city ? ` · ${p.city}` : ""} · {tenants.length} {ul}</div>
        </div>
{/* مكتب بمئة عقار: قائمة منسدلة بمئة خيار لا يُبحث فيها — وعلى الجوال
            عجلة طويلة. فوق 12 عقارًا نعرض حقل بحث يصفّي القائمة. */}
        {items.length > 12 && (
          /* (30 سبتمبر 2026) نص قصير ووسم للقارئ الآلي — «ابحث في 14 عقارًا…» كان يُقصّ على 390px */
          <input className="fld flex-1 min-w-[120px] max-w-full sm:max-w-[170px] text-xs" value={propQ} onChange={(e) => setPropQ(e.target.value)}
            aria-label={`بحث في ${items.length} عقارًا`} title={`ابحث في ${items.length} عقارًا بالاسم أو المدينة أو المالك`}
            placeholder="بحث عقار…" />
        )}
        {/* كان max-w-[220px] يقصّ عدد الوحدات من آخر الخيار على 390px — يأخذ الآن ما بقي من السطر (30 سبتمبر 2026) */}
        <select value={p.id} onChange={(e) => setActiveId(e.target.value)} aria-label="اختيار العقار"
          className="fld flex-1 min-w-[170px] max-w-full sm:flex-none sm:max-w-[300px] font-semibold text-deep">
          {(() => {
            const q = normalizeSearch(propQ);
            const list = [...items].sort((a, b) => a.name.localeCompare(b.name, "ar"))
              .filter((x) => !q || normalizeSearch(`${x.name} ${x.city || ""} ${x.owner_name || ""}`).includes(q) || x.id === p.id);
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
        {/* التجربة العامة بلا جلسة: الروابط إلى صفحات اللوحة تنتهي في /login —
            نفتح دعوة التسجيل بدلها كبقية الأفعال المحجوبة في التجربة (30 سبتمبر 2026) */}
        {items.length > 1 && <Link href="/dashboard/property/overview" className="btn btn-ghost text-sm" title="كل العقارات في صفحة واحدة"
          onClick={(e) => { if (demo) { e.preventDefault(); demoJoin(); } }}>🗂️ نظرة عامة</Link>}
        {isManager && <button className="btn btn-ghost text-sm" onClick={openNewProperty}>+ عقار</button>}
      </div>

      {expiringSoon && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl p-3.5 mb-4 border text-sm ${
          (expiringSoon.st.daysToEnd || 0) <= 30 ? "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]" : "bg-[#FBF1DF] border-[#EBD9AA] text-[#8a5a11]"}`}>
          <span>عقد {expiringSoon.t.name} ({ul} {expiringSoon.t.unit || "—"}) ينتهي خلال <b>{plural(expiringSoon.st.daysToEnd ?? 0, "يوم واحد", "يومين", "أيام", "يومًا")}</b> (<bdi dir="ltr" className="whitespace-nowrap">{expiringSoon.st.endDate}</bdi>). جهّز التجديد أو الإخلاء.</span>
          <button className="btn btn-ghost text-xs mr-auto" onClick={() => askRenew(expiringSoon.t)}>تجديد الآن</button>
        </div>
      )}

      {/**
        * ثلاث خلايا لثلاثة أسئلة لا يكرر أحدها الآخر (طلب مكتب).
        *
        * كانت الصفحة تعرض سبعة أرقام مالية، أربعة منها صيغٌ لرقم واحد (الإيجار
        * شهريًّا، وسنويًّا، وما بقي منه خلال 12 شهرًا، و«التعاقدي شهريًّا»
        * مكرّرًا) وواحد لنطاق آخر (دخل المكتب كله في شريط المحفظة) — فتبدو
        * متناقضة. ومن يدفع سنويًّا يدفع مرة واحدة، فيبدو المحصَّل أضعاف
        * «المتوقع» الشهري. الآن: كم استلمنا · كم تُدخل · كم صرفنا.
        */}
      {tenants.length > 0 && (() => {
        const rr = annualRentRoll(tenants as any[]);
        const mLabel = arDate(`${today().slice(0, 7)}-01`).replace(/^\S+\s+/, "");
        const units = (n: number) => (n === 1 ? "وحدة" : n === 2 ? "وحدتين" : n <= 10 ? "وحدات" : "وحدة");
        const Cell = ({ t, v, sub, tone }: { t: string; v: string; sub: React.ReactNode; tone: string }) => (
          <div className="bg-white border border-line rounded-xl px-4 py-3">
            <div className="text-[12px] text-muted">{t}</div>
            <div className={`text-2xl font-bold tabular-nums mt-0.5 ${tone}`}>{v} <span className="text-xs font-normal text-muted">ريال</span></div>
            <div className="text-[11px] text-muted mt-1 leading-relaxed">{sub}</div>
          </div>
        );
        return (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <Cell t="المحصَّل فعليًّا هذا الشهر" tone="text-[#137a50]"
              v={collectedThisMonth === null ? "…" : sar(Math.round(collectedThisMonth))}
              sub={<>ما قُبض في {mLabel} حتى اليوم</>} />
            {/* «دخل العمارة» كان يُكتب لفيلا ومعرض ومستودع — الاسم من نوع العقار (30 سبتمبر 2026) */}
            <Cell t={`دخل ${({ residential: "العمارة", showroom: "المعرض", office: "المبنى", warehouse: "المستودع", villa: "الفيلا", land: "الأرض" } as Record<string, string>)[p.property_type || "residential"] || "العقار"} السنوي`} tone="text-deep" v={sar(Math.round(rr.annual))}
              sub={<>إيجار سنة لـ{rr.occupied} {units(rr.occupied)} بعقد سارٍ
                {rr.vacant ? <> · <span className="text-[#9A4B00]">شاغرة {rr.vacant}</span></> : null}
                {rr.expired ? <> · <span className="text-late">{rr.expired === 1 ? "عقد انتهى ولم يُجدَّد" : `${rr.expired} عقود انتهت ولم تُجدَّد`} ({sar(Math.round(rr.expiredAnnual))} خارج المجموع)</span></> : null}</>} />
            <Cell t="مصروفات هذا الشهر" tone="text-ink"
              v={expThisMonth === null ? "…" : sar(Math.round(expThisMonth.owner))}
              sub={<>على المالك في {mLabel}{expThisMonth && expThisMonth.office > 0 ? <> · و{sar(Math.round(expThisMonth.office))} على المكتب</> : null}</>} />
          </div>
        );
      })()}

      {/* ما يحتاج إجراءً اليوم — أزرار تصفية لا أرقام دخل */}
      {(overdue > 0 || arrears.litigation > 0 || arrears.carried > 0 || vacantArrears > 0 || ((counts.due || 0) + (counts.soon || 0)) > 0 || (counts.expiring || 0) > 0) && (
        <div className="flex flex-wrap gap-2 mb-5">
          {(lateCount > 0 || overdue > 0) && (
            <button type="button" onClick={() => setFilter("late")}
              className={`text-xs px-3 py-2 rounded-full border ${filter === "late" ? "bg-[#FBE9E7] border-[#F5C6C2]" : "bg-white border-line"} text-late`}>
              متأخر <b className="tabular-nums">{sar(overdue)}</b> · {plural(lateCount, "وحدة واحدة", "وحدتان", "وحدات", "وحدة")}</button>
          )}
          {arrears.litigation > 0 && (
            <button type="button" onClick={() => setFilter("litigation")}
              className={`text-xs px-3 py-2 rounded-full border ${filter === "litigation" ? "bg-[#EEF2F6] border-[#CBD5E1]" : "bg-white border-line"} text-[#475569]`}>
              تحت التنفيذ <b className="tabular-nums">{sar(arrears.litigation)}</b> · {plural(arrears.litigationCount, "وحدة واحدة", "وحدتان", "وحدات", "وحدة")}</button>
          )}
          {arrears.carried > 0 && (
            <button type="button" onClick={() => setDebtOpen(true)}
              className="text-xs px-3 py-2 rounded-full border bg-white border-line text-[#9A4B00]">
              دين مُرحَّل <b className="tabular-nums">{sar(arrears.carried)}</b> · {plural(arrears.carriedCount, "وحدة واحدة", "وحدتان", "وحدات", "وحدة")}</button>
          )}
          {vacantArrears > 0 && (
            <button type="button" onClick={() => setFilter("vacant")}
              className={`text-xs px-3 py-2 rounded-full border ${filter === "vacant" ? "bg-[#FFF6E5] border-[#F2D49B]" : "bg-white border-line"} text-[#9A4B00]`}>
              على مستأجرين سابقين <b className="tabular-nums">{sar(vacantArrears)}</b></button>
          )}
          {((counts.due || 0) + (counts.soon || 0)) > 0 && (
            <button type="button" onClick={() => setFilter("soon")}
              className={`text-xs px-3 py-2 rounded-full border ${filter === "soon" ? "bg-paper2 border-line" : "bg-white border-line"} text-ink`}>
              تستحق خلال {plural(windowsOf(active).soonDays, "يوم واحد", "يومين", "أيام", "يومًا")}: <b>{(counts.due || 0) + (counts.soon || 0)}</b></button>
          )}
          {(counts.expiring || 0) > 0 && (
            <button type="button" onClick={() => setFilter("expiring")}
              className={`text-xs px-3 py-2 rounded-full border ${filter === "expiring" ? "bg-paper2 border-line" : "bg-white border-line"} text-ink`}>
              عقود للتجديد أو الإخلاء: <b>{counts.expiring}</b></button>
          )}
        </div>
      )}

      {/* الوحدات تأخذ العرض كاملًا: مكتب بمئات الوحدات يحتاج كل بكسل للجدول،
          وسجل العقار (ملاحظات نصية) ينتقل أسفلها — يُقرأ حين يُطلب لا دائمًا. */}
      {/* التحصيل شهرًا بشهر والدخل المتوقع انتقلا إلى «نظرة عامة».
          صفحة العقار للعمل اليومي: من تأخّر ومن أُحصّل منه. وتلك أرقامٌ
          تُراجَع آخر الشهر — وجودها هنا كان يزاحم الجدول بلا داعٍ. */}

      {/* عدادات العقار الرئيسية فوق جدول الوحدات (طلب مكتب عمرو، 2 أكتوبر 2026):
          المحصّل أو الموظف يحتاج رقم حساب عداد المصعد أو الخزان وهو يتابع العمارة،
          لا أن يفتح الإعدادات كل مرة. لا يظهر شيء لعقار بلا عدادات. */}
      {active && (active.meters || []).length > 0 && (
        <div className="bg-white border border-line rounded-2xl shadow-sm px-4 py-3 mb-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="text-sm font-semibold text-deep">
              ⚡ عدادات العقار الرئيسية <span className="text-xs text-muted font-normal">— {metersCountLine(active.meters)}</span>
            </div>
            {isManager && <button type="button" className="text-xs text-muted hover:text-deep underline" onClick={() => setModal({ kind: "editProp" })}>تعديل</button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {(active.meters || []).map((m, i) => (
              <div key={i} className="text-xs border border-line rounded-lg px-2.5 py-1.5 bg-paper">
                <span className="text-muted">{METER_TYPE_AR[m.type === "water" ? "water" : "elec"]}{m.label ? ` — ${m.label}` : ""}:</span>{" "}
                <b dir="ltr" className="select-all tabular-nums">{m.account}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 items-start">
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 gap-2 flex-wrap">
            {/* كان مخفيًّا تحت 1024px: من حفظ «جدول» مرة يبقى حبيسه بلا مخرج،
                والجدول على 400px يحتاج تمريرًا أفقيًّا بثلاثة أضعاف العرض. */}
            <div className="inline-flex items-center gap-0.5 border border-line rounded-lg p-0.5 me-2 align-middle text-[11px]">
              <button type="button" onClick={() => pickView("table")} className={`px-3 py-2 sm:py-1 rounded-md ${view === "table" ? "bg-deep text-goldSoft" : "text-muted hover:text-deep"}`} title="جدول: صف لكل وحدة">☰ جدول</button>
              <button type="button" onClick={() => pickView("cards")} className={`px-3 py-2 sm:py-1 rounded-md ${view === "cards" ? "bg-deep text-goldSoft" : "text-muted hover:text-deep"}`} title="بطاقات">▦ بطاقات</button>
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
              <MenuBtn label={<><Icon name="doc" className="me-1.5" />مستندات</>} items={[
                { label: "كشف حساب العقار", run: () => setStmtOpen(true) },
                { label: "عرض سعر لمستأجر محتمل", run: () => setQuoteOpen(true) },
                /* «التزامات المكتب» انتقلت إلى «نظرة عامة» — للمكتب كله لا لعقار */
              ]} />

              {may("view_financials") && <MenuBtn label={<><Icon name="owner" className="me-1.5" />المالك</>} items={[
                { sep: "تُرسل للمالك" },
                { label: "تقرير المالك", run: () => setReporting(true) },
                { label: "كشف مالك مجمّع", run: () => setOwnerStmtOpen(true) },
                { label: "رابط المالك", run: () => setOwnerLinkOpen(true) },
                { sep: "متابعة المال" },
                { label: "كشف التحصيل", run: () => setCollOpen(true) },
                ...(may("manage_expenses") ? [{ label: "المصروفات", run: () => setExpensesOpen(true) }] : []),
                { label: `الديون المرحَّلة${carriedTotal > 0 ? ` (${sar(carriedTotal)})` : ""}`, run: () => setDebtOpen(true) },
              ]} />}

              <MenuBtn label={<><Icon name="data" className="me-1.5" />البيانات</>} items={[
                ...(may("edit_tenants") ? [demo ? { label: "رفع من Excel", run: demoJoin } : { label: "رفع من Excel", href: "/dashboard/property/import" }] : []),
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
              {/* النص الطويل كان يُقصّ على الجوال فلا يُعرف ما يُبحث به — قصير هنا، والكامل في title (30 سبتمبر 2026) */}
              <input className="fld flex-1 min-w-[150px] basis-full sm:basis-auto" value={q} onChange={(e) => setQ(e.target.value)} type="search"
                aria-label={`بحث في الوحدات: الاسم أو رقم ${ul} أو الجوال أو الهوية أو رقم العقد أو حساب الكهرباء`}
                title={`ابحث بالاسم أو رقم ${ul} أو الجوال أو الهوية أو رقم العقد أو حساب الكهرباء`}
                placeholder={`ابحث: اسم، ${ul}، جوال، هوية…`} />
              <select className="fld flex-1 sm:flex-none sm:max-w-[170px]" aria-label="ترتيب الوحدات" value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="urgent">الأهم أولًا</option>
                <option value="due">الأقرب استحقاقًا</option>
                <option value="amount">الأكبر متأخرًا</option>
                <option value="name">الاسم</option>
              </select>
              <div className="flex flex-wrap gap-1.5 w-full">
                {chips.map((c) => (
                  <button key={c.k} onClick={() => setFilter(c.k)}
                    /* كانت 26px — أصغر من الحد الموصى به للمس (44px)، فيخطئ
                       الإبهام على الجوال. 40px مع الحشو الرأسي كافية. */
                    className={`text-xs font-semibold rounded-lg px-3 py-2.5 sm:py-1 min-h-[40px] sm:min-h-0 border transition ${
                      filter === c.k ? "bg-deep text-[#F6F1E4] border-deep" : "bg-white text-deep border-line hover:border-goldSoft"}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* عمود واحد — جُرّب العمودان فكانا أسوأ: البطاقة تنضغط فتلتفّ
              أسطرها، والعين تقفز يمينًا ويسارًا بين صفَّين بدل مسح عمود
              واحد. الفراغ الأفقي عُولج داخل البطاقة نفسها بدل تقسيم الصف. */}
          <div className="p-4 flex flex-col gap-2">
            {!tenants.length ? (
              <div className="text-center text-muted py-8 text-sm">
                لا توجد وحدات بعد.
                <div className="mt-3 flex gap-2 justify-center">
                  <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "tenant" })}>+ أضف {ul}</button>
                  <Link href="/dashboard/property/import" className="btn btn-ghost text-xs" onClick={(e) => { if (demo) { e.preventDefault(); demoJoin(); } }}>رفع Excel</Link>
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
              const totalDue = rows.reduce((a, r) => a + dueWithVat(r.st, r.t, active), 0);
              /* (30 سبتمبر 2026) رقم التذييل يجمع كل المستحق (والتنفيذ والسابقين) بينما شريحة
                 «متأخر» أعلى الصفحة تستبعدهما (arrearsOf) — رقمان مختلفان بالاسم نفسه. نسمّيه
                 «إجمالي المستحق» ونُظهر ما فيه زيادةً على شريحة المتأخر. */
              const dueLit = rows.filter((r) => r.key === "litigation").reduce((a, r) => a + dueWithVat(r.st, r.t, active), 0);
              const dueVac = rows.filter((r) => r.key === "vacant").reduce((a, r) => a + dueWithVat(r.st, r.t, active), 0);
              /* «أقرب استحقاق» كان أقدم تاريخ غير مسدَّد — فيُعرض تاريخ مضى
                 عليه سنتان أحيانًا. الآن: أقرب دفعة قادمة فعلًا. */
              const nearest = rows.map((r) => r.st.upcomingDate).filter(Boolean).sort()[0];
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
              /* من lib/contract-state لا خريطة محلية: النسخة المحلية كانت تتجاهل
                 حالة «انتهى العقد»، فالوحدة نفسها تُعرض «ينتهي قريبًا» في الجدول
                 و«انتهى العقد» في البطاقة — تناقض يراه المكتب بتبديل الترتيب. */
              const label = (key: RowKey, st: { daysToEnd?: number | null }) => unitStatusLabel(key as any, st);
              return (
                <div className="border border-line rounded-xl overflow-hidden">
                  {/* كان تمريرًا داخل تمرير الصفحة: مع 60–90 وحدة يصير
                      التنقل متعبًا خصوصًا على اللمس. الآن صفحات من 25 صفًّا،
                      ويبقى رأس الجدول لاصقًا داخل كل صفحة. */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      {/* الترويسة تثبت عند التمرير: مع 300 وحدة لا تعرف أي عمود تقرأ بدونها */}
                      <thead className="bg-paper sticky top-0 z-10 shadow-[0_1px_0_var(--tw-shadow-color)] shadow-line">
                        <tr>
                          <Th k="unit" label={ul} cls="w-14" />
                          <Th k="name" label="المستأجر" cls="w-[30%]" />
                          <th className="px-3 py-2.5 text-right font-semibold text-xs text-muted whitespace-nowrap w-[15%]">الإيجار</th>
                          <Th k="due" label="الاستحقاق القادم" cls="w-[16%]" />
                          <Th k="urgent" label="الحالة" cls="w-[11%]" />
                          <Th k="amount" label="المبلغ" cls="text-left w-[12%]" />
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
                              {key !== "vacant" && <MeterLine t={t} onSend={meterNoticeDue(t) ? () => { void sendMeterNotice(t); } : undefined} />}
                            </td>
                            <td className={`px-3 ${cellY} whitespace-nowrap tabular-nums ${key === "vacant" ? "text-muted/70" : "text-muted"}`}>{sar(t.rent_amount)} / {freqShort(t.payment_frequency)}{key === "vacant" && <div className="text-[10px]">الإيجار المطلوب</div>}</td>
                            <td className={`px-3 ${cellY} whitespace-nowrap tabular-nums`}>
                              {key === "vacant" ? <span className="text-muted">—</span>
                              : st.fullyPaid && st.endDate ? (<>
                                {/* الأخضر و«ينتهي» لعقد انتهى فعلًا يقرأه المكتب
                                    على أنه سليم — والحقيقة أنه يحتاج قرارًا اليوم. */}
                                {(st.daysToEnd ?? 0) < 0 ? (<>
                                  <div className="text-late font-semibold">انتهى {arDate(st.endDate)}</div>
                                  <div className="text-[11px] text-muted">{hijriShort(st.endDate)} · جدّده أو سجّل الإخلاء</div>
                                </>) : (<>
                                  <div className="text-[#137a50]">ينتهي {arDate(st.endDate)}</div>
                                  <div className="text-[11px] text-muted">{hijriShort(st.endDate)} · القادم مع التجديد</div>
                                </>)}
                              </>)
                              /* المتأخر: أقدم غير مسدَّد في الماضي — نُسمّيه «متأخر منذ»
                                 ونُظهر القادم الحقيقي تحته. كان التاريخ الماضي يُعرض
                                 وحده تحت عنوان «الاستحقاق القادم» فيُربك المكتب. */
                              : st.nextDueDate && (st.daysToNextDue ?? 0) < 0 ? (<>
                                <div className="text-late text-xs font-semibold">متأخر منذ {arDate(st.nextDueDate)}</div>
                                {st.upcomingDate
                                  ? <div className="text-[11px] text-muted"><UpcomingLine st={st} rent={rentWithVat(t, active)} due={dueWithVat(st, t, active)} imminentDays={windowsOf(active).imminentDays} /></div>
                                  : st.upcomingDate === null ? <div className="text-[11px] text-muted">{renewalNote(st)}</div> : null}
                              </>)
                              : st.nextDueDate ? (<>
                                <div>{arDate(st.nextDueDate)}</div>
                                <div className="text-[11px] text-muted">{hijriShort(st.nextDueDate)}</div>
                              </>) : <span className="text-muted">—</span>}
                            </td>
                            <td className={`px-3 ${cellY}`}><span className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${badge(key)}`}>{key === "ok" && st.fullyPaid ? `✓ مسدَّد ${st.paid}/${t.contract_periods || st.paid}` : label(key, st)}</span></td>
                            <td className={`px-3 ${cellY} text-left tabular-nums whitespace-nowrap ${st.totalOwed > 0 ? "font-bold text-late" : "text-muted"}`}>
                              {st.totalOwed > 0 ? (<>
                                {sar(dueWithVat(st, t, active))}
                                {st.carriedDebt > 0 && <div className="text-[10px] font-normal text-[#9A4B00]">+ {sar(st.carriedDebt)} دين مرحَّل</div>}
                                {/* الوحدة فارغة والمبلغ على من سكنها قبل الإخلاء — تسميته «المستحق» توهم أن الشاغرة مدينة */}
                                {key === "vacant" && <div className="text-[10px] font-normal text-muted">على المستأجر السابق</div>}
                              </>)
                                /* الشارة تقول «مستحق خلال 4 أيام» والعمود فارغ — فيسأل المكتب:
                                   مستحق كم؟ نعرض قيمة الدفعة القادمة بلون خافت حتى لا تختلط
                                   بالمتأخرات الحمراء، ولا تُجمع معها في إجمالي المتأخر. */
                                : (!st.vacant && !st.incomplete && st.nextDueDate && Number(t.rent_amount) > 0) ? (
                                  <span className="font-normal text-muted">
                                    {sar(Number(t.rent_amount))}
                                    <div className="text-[10px]">قادمة</div>
                                  </span>
                                ) : "—"}
                            </td>
                            <td className={`px-2 ${dense ? "py-1" : "py-1.5"} text-left whitespace-nowrap`}>
                              <div className="inline-flex items-center gap-1">
                                {key === "vacant" ? (
                                  <button type="button" className="btn btn-primary text-xs whitespace-nowrap" onClick={() => reLet(t)}>🔑 تأجير</button>
                                ) : key === "litigation" ? (
                                  <button className="btn btn-ghost text-xs" onClick={() => setEnforcing(t)}>متابعة التنفيذ</button>
                                ) : (<>
                                  {canCollect && !st.fullyPaid && !((st.daysToEnd ?? 0) < 0 && st.unpaid === 0) && <QuickBtn title={isBusy(`pay:${t.id}`) ? "جارٍ التسجيل…" : st.hasPartial ? "تأكيد استلام باقي الدفعة" : "تأكيد استلام الدفعة كاملة"} cls={`btn-primary ${isBusy(`pay:${t.id}`) ? "opacity-50 pointer-events-none" : ""}`} onClick={() => quickPay(t, st)}>&#10004;</QuickBtn>}
                                  {canCollect && <QuickBtn title="سداد جزئي" cls="btn-ghost" onClick={() => setPaying(t)}>&#189;</QuickBtn>}
                                  {may("send_reminders") && !st.fullyPaid && !((st.daysToEnd ?? 0) < 0 && st.unpaid === 0) && <a href={remindLink(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs px-2.5" title="إرسال تذكير واتساب" onClick={(e) => { e.preventDefault(); openExternal(remindLink(t)); }}>&#128172;</a>}
                                  {endNoticeDue(t, st) && <a href={endNoticeLink(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs px-2.5" title="إشعار انتهاء العقد (واتساب)" onClick={(e) => { e.preventDefault(); openExternal(endNoticeLink(t)); }}>&#128197;</a>}
                                </>)}
                                <RowMenu items={[
                                  /* ثلاث مجموعات بترتيب الاستعمال لا بترتيب البناء:
                                     ما يُطبع · ما يُرسل · ما يغيّر العقد. */
                                  { sep: "📄 مستندات" } as any,
                                  { label: "كشف حساب شامل", run: () => openStatement(t, "full") },
                                  { label: "كشف حساب مختصر", run: () => openStatement(t, "brief") },
                                  ...(may("issue_invoices") ? [{ label: "فاتورة", run: () => openInvoice(t) }] : []),
                                  { label: "سجل الفواتير", run: () => setInvoicesFor(t) },
                                  { label: "جدول الدفعات", run: () => setSchedule(t) },
                                  { label: "سجل المدفوعات", run: () => openHistory(t) },
                                  ...(isVacant(t) ? [{ label: "مخالصة الإخلاء", run: () => openSettlement(t) }] : []),

                                  { sep: "✉️ مراسلة" } as any,
                                  ...(endNoticeDue(t, st) ? [{ label: "📅 إشعار انتهاء العقد (واتساب)", run: () => openExternal(endNoticeLink(t)) }] : []),
                                  ...(meterNoticeDue(t) ? [{ label: "⚡ إشعار تسجيل عداد الكهرباء (واتساب)", run: () => { void sendMeterNotice(t); } }] : []),
                                  ...(!isVacant(t) && !String(t.elec_account || "").trim() && may("edit_tenants") ? [{ label: "⚡ أضف رقم عداد الكهرباء", run: () => setModal({ kind: "tenant", id: t.id }) }] : []),
                                  ...(st.unpaid > 0 && may("send_reminders") ? [{ label: "خطاب إشعار رسمي", run: () => makeNotice(t) }] : []),
                                  ...(!isVacant(t) && may("record_payments") ? [{ label: "🔑 رابط المستأجر", run: () => setTenantLinkFor(t) }] : []),
                                  { label: "ناقش مع الفريق", run: () => window.dispatchEvent(new CustomEvent("watheq:chat", { detail: { propertyId: active?.id, propertyName: active?.name, tenantId: t.id, tenantName: t.name, unit: t.unit } })) },

                                  ...(may("edit_tenants") || may("renew_contracts") || may("move_out") || may("undo_actions") || isManager
                                    ? [{ sep: "🔧 العقد" } as any] : []),
                                  ...(may("edit_tenants") ? [{ label: "تعديل البيانات", run: () => setModal({ kind: "tenant", id: t.id }) }] : []),
                                  ...(needsRenewal(t) && may("renew_contracts") ? [{ label: "تجديد العقد", run: () => askRenew(t) }] : []),
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
                          {/* رقمان مختلفان كانا يُعرضان كأنهما واحد: «المتوقع سنويًّا» هو المتبقي
     من جداول العقود خلال 12 شهرًا (فالعقد الذي أوشك ينتهي يساهم بما بقي
     منه)، و«شهريًّا» هو معدَّل الإيجار التعاقدي. جمعهما بفاصلة أوحى بأن
     الأول = الثاني × 12 — وهو ليس كذلك. نفصلهما بمسمّييهما. */}
                          <td className="px-3 py-2 whitespace-nowrap">
                            {/* «المتبقي خلال 12 شهرًا» و«التعاقدي شهريًّا» أزيلا: صيغتان أخريان لدخل العمارة تُقرآن مناقضتين له */}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" colSpan={2}>{nearest ? <>أقرب استحقاق: <bdi dir="ltr" className="whitespace-nowrap">{nearest}</bdi></> : "—"}</td>
                          <td className={`px-3 py-2 text-left font-bold ${totalDue > 0 ? "text-late" : ""}`}>{totalDue > 0 ? <>{sar(totalDue)}<div className="text-[10px] font-normal text-muted">إجمالي المستحق</div>
                            {dueLit > 0 && <div className="text-[10px] font-normal text-muted whitespace-nowrap">منه تحت التنفيذ {sar(dueLit)}</div>}
                            {dueVac > 0 && <div className="text-[10px] font-normal text-muted whitespace-nowrap">منه على سابقين {sar(dueVac)}</div>}</> : "—"}</td>
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
                  {/* الاسم كان يتمدّد إلى عرض البطاقة كاملًا فينفتح فراغ
                      يقارب 700px قبل الأزرار. حدّ أقصى للكتلة يُبقي المعلومة
                      وحالتها متجاورتين، ويُدفع الباقي إلى اليسار بـms-auto. */}
                  <div className="flex items-center gap-3 min-w-0 flex-1 sm:max-w-[540px]">
                    <span className="w-9 h-9 rounded-lg bg-paper2 grid place-items-center font-semibold text-deep shrink-0">{(t.name || "?").charAt(0)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{t.name}</div>
                      <div className="text-xs text-muted">
                        {/* الجوال يرى ما يميّز الوحدة؛ والتفاصيل الثانوية (الغرف
                            ورقم العقد) تظهر على الشاشة الأوسع. سطر واحد مكتظّ
                            بسبعة أرقام لا يُقرأ على الجوال — فلا يُقرأ منه شيء. */}
                        {t.unit_type ? UNIT_TYPES[t.unit_type] || ul : ul} {t.unit || "—"} · {sar(t.rent_amount)} ريال / {freqShort(t.payment_frequency)}
                        {(t.rooms || t.baths || t.acs) ? <span className="text-[11px] hidden sm:inline"> · {[t.rooms ? `${t.rooms} غرف` : "", t.baths ? `${t.baths} دورات مياه` : "", t.acs ? `${t.acs} مكيف` : ""].filter(Boolean).join(" · ")}</span> : null}
                        {t.contract_no && <span className="hidden sm:inline"> · عقد <span dir="ltr">{t.contract_no}</span></span>}
                        {msgCount[t.id] > 0 && <span className="ms-1 text-[10px] bg-deep text-goldSoft rounded-full px-1.5 py-0.5" title="رسائل الفريق على هذه الوحدة">💬 {msgCount[t.id]}</span>}
                      </div>
                      {key !== "vacant" && <MeterLine t={t} onSend={meterNoticeDue(t) ? () => { void sendMeterNotice(t); } : undefined} />}
                      {active && unitVatApplies(t, active) && (() => { const v = splitVat(Number(t.rent_amount) || 0, vat); return (
                        <div className="text-[.7rem] text-muted mt-0.5 hidden sm:block">
                          أساسي {sar(v.base)} + ضريبة {sar(v.vat)} = <b className="text-deep">{sar(v.total)}</b>
                        </div>
                      ); })()}
                    </div>
                  </div>
                  {/* الحالة + الرقم المهم — تنتقل لسطر مستقل على الجوال */}
                  {/* الشارة والمبلغ في صفّ واحد على الجوال، وتحتهما التفصيل.
                      الرقم هو ما يبحث عنه المكتب أولًا — فيكون المرساة البصرية
                      بدل نصّ صغير بجانب الشارة. */}
                  <div className="text-right sm:text-left shrink-0 border-t sm:border-0 border-line/70 pt-2 sm:pt-0 sm:me-auto">
                    <div className="flex sm:block items-center justify-between gap-2">
                      <StatusPill k={key} ended={st.daysToEnd !== null && st.daysToEnd < 0} />
                      {(key === "late" || key === "partial") && st.amountDue > 0 && (
                        <span className={`sm:block sm:mt-1 tabular-nums font-bold leading-none ${key === "late" ? "text-late text-lg" : "text-[#9A5B00] text-base"}`}>
                          {sar(dueWithVat(st, t, active))}<span className="text-[10px] font-normal text-muted"> ريال</span>
                        </span>
                      )}
                    </div>
                    {/* الدين المرحَّل كان يظهر في الجدول وحده — البطاقة تُخفيه فيُطالَب المستأجر بأقل مما عليه (30 سبتمبر 2026) */}
                    {st.carriedDebt > 0 && (
                      <div className="text-[11px] font-semibold text-[#9A4B00] mt-0.5 tabular-nums">+ {sar(st.carriedDebt)} دين مرحَّل</div>
                    )}
                    <div className="text-xs mt-1 tabular-nums">
                      {key === "vacant" ? (() => { const v = vacancyDays(t.move_out_date); return (
                          <span className="text-[#475569] font-semibold">شاغرة{v !== null ? ` منذ ${daysAr(v)}` : ""}</span>
                        ); })()
                        : st.inGrace ? <span className="text-[#8a5a11] font-semibold">فترة سماح — {daysAr(st.graceDaysLeft, true)}</span>
                        /* حالة حسن خليل: متبقٍ من دفعة سابقة، والقادمة بعد أيام —
                           كانت البطاقة تذكر المتبقي ولا تذكر متى الدفعة التالية. */
                        : key === "partial" ? <span className="text-[#9A5B00] font-semibold">
                            متأخر {sar(dueWithVat(st, t, active))} ريال{st.nextDueDate ? <span className="font-normal"> منذ {arDate(st.nextDueDate)}</span> : null}
                            <span className="block font-normal text-muted">دُفع منها {sar(withVat(st.partial, t, active))}</span>
                            <UpcomingLine st={st} rent={rentWithVat(t, active)} due={dueWithVat(st, t, active)} imminentDays={windowsOf(active).imminentDays} />
                          </span>
                        : key === "late" ? <span className="text-late font-semibold">
                            {/* «11 دفعات» — العدّ العربي الصحيح (30 سبتمبر 2026) */}{st.unpaid === 1 ? "دفعة واحدة متأخرة" : st.unpaid === 2 ? "دفعتان متأخرتان" : `${countAr(st.unpaid, "", "", "دفعات", "دفعة")} متأخرة`}{st.nextDueDate ? <span className="font-normal"> منذ {arDate(st.nextDueDate)}</span> : null}
                            <UpcomingLine st={st} rent={rentWithVat(t, active)} due={dueWithVat(st, t, active)} imminentDays={windowsOf(active).imminentDays} />
                          </span>
                        : key === "due" ? <span className="text-[#9A4B00] font-semibold">
                            {st.statusLabel}
                            {/* «مستحق خلال 4 أيام» بلا مبلغ يجعل المكتب يسأل: كم؟ */}
                            {Number(t.rent_amount) > 0 && <span> · {sar(rentWithVat(t, active))} ريال</span>}
                            {st.nextDueDate ? <span className="font-normal text-muted"> · {arDate(st.nextDueDate)}</span> : null}
                          </span>
                        : key === "expiring" && st.daysToEnd !== null ? (
                            /* daysAr تأخذ القيمة المطلقة، فعقد انتهى قبل 723 يومًا
                               كان يُطبع «ينتهي بعد 723 يومًا» — الإشارة معكوسة. */
                            st.daysToEnd < 0
                              ? <span className="text-late font-semibold">انتهى منذ {daysAr(st.daysToEnd)} — يحتاج تجديدًا أو إخلاءً</span>
                              : <span className="text-[#5B21B6] font-semibold">ينتهي بعد {daysAr(st.daysToEnd)}</span>
                          )
                        : key === "litigation" ? <span className="text-[#475569]">{t.enforcement_no ? `طلب ${t.enforcement_no}` : "متابعة نظامية"}</span>
                        : st.fullyPaid ? <span className="text-[#137a50] font-semibold">✓ سدّد كامل العقد ({st.paid} من {t.contract_periods || st.paid}){st.endDate ? <span className="font-normal text-muted"> · ينتهي <bdi dir="ltr" className="whitespace-nowrap">{st.endDate}</bdi>{st.daysToEnd !== null && st.daysToEnd >= 0 ? ` (بعد ${daysAr(st.daysToEnd)})` : ""} — القسط القادم مع التجديد</span> : null}</span>
                        : st.nextDueDate ? <span className="text-muted">
                            {/* bdi: التاريخ اللاتيني وسط سطر عربي ينقلب ترتيبه عند الالتفاف (30 سبتمبر 2026) */}
                            القادمة <bdi dir="ltr" className="whitespace-nowrap">{st.upcomingDate || st.nextDueDate}</bdi>{` · ${hijriShort(st.upcomingDate || st.nextDueDate || "")}`}
                            {Number(t.rent_amount) > 0 && <span> · {sar(rentWithVat(t, active))} ريال</span>}
                          </span> : null}
                    </div>
                  </div>
                </div>

                {/**
                  * إجراء رئيسي واحد + قائمة المزيد (30 سبتمبر 2026).
                  *
                  * كانت بطاقة الجوال تحمل ستة أزرار (كامل · جزئي · تذكير · اتصال ·
                  * فاتورة · إشعار · تجديد) لكل وحدة — حتى المنتظمة ومن سدّد عقده كله —
                  * فتلتفّ في ثلاثة أسطر ويُضغط «كامل» لمن لا يدين بشيء. الآن: زرّ واحد
                  * بحسب الحالة (متأخر ← ✔ استلام · مستحق ← ✔ · منتظم ← لا شيء)، والبقية
                  * في ⋯ على الجوال وظاهرة على الشاشة الأوسع. وكل زرّ بصلاحية الجدول نفسها.
                  */}
                {(() => {
                  const closed = st.fullyPaid || ((st.daysToEnd ?? 0) < 0 && st.unpaid === 0);
                  const canPay = canCollect && !closed;
                  const canRemind = may("send_reminders") && !closed;
                  const primaryPay = canPay && (key === "late" || key === "partial" || key === "due");
                  const primaryRenew = !primaryPay && key === "expiring" && needsRenewal(t) && may("renew_contracts");
                  const primaryEdit = key === "incomplete" && may("edit_tenants");
                  const wide = "max-sm:!hidden";   // ثانوي: ظاهر على الشاشة الأوسع، وفي ⋯ على الجوال (! لأن .btn يفرض inline-flex فيغلب hidden)
                  const tel = t.phone ? `tel:${String(t.phone).replace(/[^0-9+]/g, "")}` : null;
                  return (
                <div className="flex flex-wrap gap-1.5 justify-stretch sm:justify-end mt-2.5 items-center [&>*]:flex-1 sm:[&>*]:flex-none [&>*]:justify-center">
                  {key === "vacant" ? (
                    <>
                      {may("edit_tenants") && <button type="button" className="btn btn-primary text-xs" onClick={() => reLet(t)}>🔑 تأجير جديد</button>}
                      <button type="button" className={`btn btn-ghost text-xs ${wide}`} onClick={() => openSettlement(t)}>📄 مخالصة الإخلاء</button>
                      {may("move_out") && <button type="button" className={`btn btn-ghost text-xs ${wide}`} onClick={() => setTurnover(t)}>تعديل بيانات الإخلاء</button>}
                    </>
                  ) : key === "litigation" ? (
                    <>
                      <button className="btn btn-ghost text-xs" onClick={() => setEnforcing(t)}>متابعة التنفيذ</button>
                      {isManager && <button className={`btn btn-ghost text-xs ${wide}`} onClick={() => { if (confirm("إلغاء رفع العقد للتنفيذ؟ ستعود الإشعارات الودية.")) patchTenant(t.id, { litigation: false }); }}>إلغاء الرفع</button>}
                    </>
                  ) : (
                    <>
                      {primaryPay && (
                        <QuickBtn title={st.hasPartial ? "تأكيد استلام باقي الدفعة" : "تأكيد استلام الدفعة"} cls={`btn-primary ${isBusy(`pay:${t.id}`) ? "opacity-50 pointer-events-none" : ""}`}
                          onClick={() => quickPay(t, st)}>
                          <span className="whitespace-nowrap">&#10004; {key === "due" ? "استلام" : st.hasPartial ? "استلام الباقي" : "استلام"}</span>
                        </QuickBtn>
                      )}
                      {primaryRenew && <button className="btn text-xs" style={{ background: "#0E3A37", color: "#F6F1E4" }} onClick={() => askRenew(t)}>تجديد</button>}
                      {/* إشعار انتهاء العقد: ظاهر على الجوال أيضًا حين لا زر سداد — هو الإجراء الطبيعي لعقد منتهٍ */}
                      {endNoticeDue(t, st) && <a href={endNoticeLink(t)} target="_blank" rel="noreferrer" className={`btn btn-wa text-xs px-2.5 ${primaryPay ? wide : ""}`} title="إشعار انتهاء العقد (واتساب)" onClick={(e) => { e.preventDefault(); openExternal(endNoticeLink(t)); }}><span className="whitespace-nowrap">&#128197; إشعار الانتهاء</span></a>}
                      {primaryEdit && <button className="btn btn-gold text-xs" onClick={() => setModal({ kind: "tenant", id: t.id })}>إكمال البيانات</button>}
                      {/* الثانوي — على الشاشة الأوسع فقط؛ على الجوال كله في ⋯ */}
                      {canPay && !primaryPay && (
                        <QuickBtn title="تأكيد استلام الدفعة" cls={`btn-primary ${wide}`} onClick={() => quickPay(t, st)}><span className="whitespace-nowrap">&#10004; استلام</span></QuickBtn>
                      )}
                      {canCollect && <span className={wide}><QuickBtn title="سداد جزئي" cls="btn-ghost" onClick={() => setPaying(t)}><span className="whitespace-nowrap">&#189; جزئي</span></QuickBtn></span>}
                      {canRemind && <a href={remindLink(t)} target="_blank" rel="noreferrer" className={`btn btn-wa text-xs px-2.5 ${wide}`} title="إرسال تذكير واتساب" onClick={(e) => { e.preventDefault(); openExternal(remindLink(t)); }}><span className="whitespace-nowrap">&#128172; تذكير</span></a>}
                      {/* كان 📄 أبيضَ على خلفية بيضاء فيكاد يختفي — الأيقونة ترث لون النص. */}
                      {may("issue_invoices") && <span className={wide}><QuickBtn title="إصدار فاتورة" cls="btn-ghost" onClick={() => openInvoice(t)}>
                        <span className="whitespace-nowrap"><Icon name="doc" /> فاتورة</span>
                      </QuickBtn></span>}
                      {st.unpaid > 0 && may("send_reminders") && <button className={`btn btn-gold text-xs ${wide}`} onClick={() => makeNotice(t)}>نموذج إشعار</button>}
                      {!primaryRenew && needsRenewal(t) && may("renew_contracts") && <button className={`btn text-xs ${wide}`} style={{ background: "#0E3A37", color: "#F6F1E4" }} onClick={() => askRenew(t)}>تجديد</button>}
                    </>
                  )}
                  <RowMenu
                    items={[
                      /* على الجوال: ما خرج من البطاقة يعيش هنا أولًا — لا يضيع إجراء */
                      ...(key !== "vacant" && key !== "litigation" && (canPay || canCollect || canRemind || tel) ? [{ sep: "💰 تحصيل" } as any] : []),
                      ...(key !== "vacant" && key !== "litigation" && canPay && !primaryPay ? [{ label: "✔ تأكيد استلام الدفعة", run: () => quickPay(t, st) }] : []),
                      ...(key !== "vacant" && key !== "litigation" && canCollect ? [{ label: "½ تسجيل مبلغ (جزئي أو بتاريخ آخر)", run: () => setPaying(t) }] : []),
                      ...(key !== "vacant" && key !== "litigation" && canRemind ? [{ label: "💬 تذكير واتساب", run: () => openExternal(remindLink(t)) }] : []),
                      ...(tel && key !== "vacant" ? [{ label: "📞 اتصال", run: () => { window.location.href = tel; } }] : []),
/* نفس ترتيب الجدول حرفيًّا: المستخدم لا يتعلّم قائمتين */
                      { sep: "📄 مستندات" } as any,
                      { label: "كشف حساب شامل", run: () => openStatement(t, "full") },
                      { label: "كشف حساب مختصر", run: () => openStatement(t, "brief") },
                      ...(may("issue_invoices") ? [{ label: "فاتورة", run: () => openInvoice(t) }] : []),
                      { label: "سجل الفواتير", run: () => setInvoicesFor(t) },
                      { label: "جدول الدفعات", run: () => setSchedule(t) },
                      { label: "سجل المدفوعات", run: () => openHistory(t) },
                      ...(isVacant(t) ? [{ label: "مخالصة الإخلاء", run: () => openSettlement(t) }] : []),

                      { sep: "✉️ مراسلة" } as any,
                      ...(endNoticeDue(t, st) ? [{ label: "📅 إشعار انتهاء العقد (واتساب)", run: () => openExternal(endNoticeLink(t)) }] : []),
                      ...(meterNoticeDue(t) ? [{ label: "⚡ إشعار تسجيل عداد الكهرباء (واتساب)", run: () => { void sendMeterNotice(t); } }] : []),
                      ...(!isVacant(t) && !String(t.elec_account || "").trim() && may("edit_tenants") ? [{ label: "⚡ أضف رقم عداد الكهرباء", run: () => setModal({ kind: "tenant", id: t.id }) }] : []),
                      ...(st.unpaid > 0 && may("send_reminders") ? [{ label: "خطاب إشعار رسمي", run: () => makeNotice(t) }] : []),
                      ...(!isVacant(t) && may("record_payments") ? [{ label: "🔑 رابط المستأجر", run: () => setTenantLinkFor(t) }] : []),
                      { label: "ناقش مع الفريق", run: () => window.dispatchEvent(new CustomEvent("watheq:chat", { detail: { propertyId: active?.id, propertyName: active?.name, tenantId: t.id, tenantName: t.name, unit: t.unit } })) },

                      ...(may("edit_tenants") || may("renew_contracts") || may("move_out") || may("undo_actions") || isManager
                        ? [{ sep: "🔧 العقد" } as any] : []),
                      ...(may("edit_tenants") ? [{ label: "تعديل البيانات", run: () => setModal({ kind: "tenant", id: t.id }) }] : []),
                      ...(needsRenewal(t) && may("renew_contracts") ? [{ label: "تجديد العقد", run: () => askRenew(t) }] : []),
                      ...(may("move_out") && !isVacant(t) ? [{ label: "إنهاء العقد وإخلاء", run: () => setTurnover(t) }] : []),
                      ...(may("move_out") && isVacant(t) ? [{ label: "تعديل بيانات الإخلاء", run: () => setTurnover(t) }] : []),
                      ...(isManager && t.litigation ? [{ label: "إلغاء الرفع للتنفيذ", run: () => { if (confirm("إلغاء رفع العقد للتنفيذ؟ ستعود الإشعارات الودية.")) patchTenant(t.id, { litigation: false }); } }] : []),
                      ...(isManager && !t.litigation && st.unpaid > 0 ? [{ label: "رفع للتنفيذ القضائي", run: () => setEnforcing(t) }] : []),
                      ...(may("undo_actions") && (t.paid_periods || 0) > 0 ? [{ label: "↩︎ تراجع عن آخر دفعة", run: () => undoPayment(t), danger: true }] : []),
                      ...(may("undo_actions") ? [{ label: "🗑 حذف الوحدة", run: () => deleteTenant(t.id), danger: true }] : []),
                    ]}
                  />
                </div>
                  );
                })()}
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
                    {/* مساحة لمس 44px حول المربع الصغير (30 سبتمبر 2026) */}
                    <button className="-m-3 p-3 shrink-0 grid place-items-center" aria-label={n.done_at ? "إعادة فتح المهمة" : "تعليم المهمة كمنجزة"}
                      title={n.done_at ? "إعادة فتح" : "تمّت"} onClick={() => toggleNote(n)}>
                      <span className={`mt-0.5 w-4 h-4 rounded border grid place-items-center text-[10px] ${n.done_at ? "bg-[#137a50] border-[#137a50] text-white" : "border-line hover:border-deep"}`}>{n.done_at ? "✓" : ""}</span>
                    </button>
                    <span className="text-xs font-semibold w-24 shrink-0 tabular-nums">
                      {/* التاريخ في bdi باتجاه يساري: «متأخرة · 2026-09-28» كان ينقلب ترتيبه عند الالتفاف */}
                      {n.due_date ? (
                        <span className={late ? "text-late" : soon ? "text-[#9A4B00]" : "text-[#8a5a11]"}>
                          {late ? "متأخرة · " : soon ? "اليوم · " : ""}<bdi dir="ltr" className="whitespace-nowrap">{n.due_date}</bdi>
                        </span>
                      ) : <span className="text-muted"><bdi dir="ltr" className="whitespace-nowrap">{n.note_date}</bdi></span>}
                    </span>
                    <span className={`flex-1 text-[#33413d] ${n.done_at ? "line-through" : ""}`}>
                      {n.kind && n.kind !== "other" && <span className="me-1">{NOTE_KINDS[n.kind]?.icon}</span>}
                      {n.text}
                    </span>
                    {/* كان «حذف» نصًّا صغيرًا يحذف بنقرة بلا سؤال — ملاصق للنص فيُلمس خطأً (30 سبتمبر 2026) */}
                    <button className="text-muted opacity-70 hover:opacity-100 hover:text-late text-xs min-h-[44px] min-w-[44px] -my-2.5 px-2 shrink-0"
                      aria-label={`حذف الملاحظة: ${n.text.slice(0, 40)}`}
                      onClick={() => { if (confirm(`حذف هذه الملاحظة نهائيًّا؟\n\n«${n.text.slice(0, 120)}»`)) deleteNote(n.id); }}>حذف</button>
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
        <TenantModal open initial={editing} unitWord={ul} error={saveErr} saving={saving} vatEnabled={!!active?.vat_enabled} property={active} payInfo={editPayInfo}
          onClose={() => setModal(null)} onSubmit={(d) => saveTenant(d, editing?.id)} />
      )}

      {quoteOpen && active && (
        <QuoteModal property={active} unitWord={ul} issuer={issuer || {}} onClose={() => setQuoteOpen(false)} />
      )}

      {ownerStmtOpen && <OwnerStatementModal properties={items} issuer={issuer} db={db} onClose={() => setOwnerStmtOpen(false)} />}
      {logOpen && <ActivityLog properties={items} db={db} onClose={() => setLogOpen(false)} />}
      {/* الصفحة العامة ترسم دليلها بنفسها — لا نكرّره هنا */}
      {collOpen && <CollectionStatementModal properties={items as any /* كاملة: نسبة الأتعاب وإعدادات الضريبة تحدّد صافي المالك */} issuer={issuer} db={db} onClose={() => setCollOpen(false)} />}
      {debtOpen && <DebtFollowUp properties={items.map((p) => ({ id: p.id, name: p.name }))} orgName={orgName} db={db} onClose={() => setDebtOpen(false)} />}
      {invoicesFor && active && <UnitInvoicesModal tenant={invoicesFor} property={active} issuer={issuer} db={db}
        canIssue={may("issue_invoices")} onClose={() => setInvoicesFor(null)} />}
      {hasDemo && !demo && <DemoGuide onEvent={onGuideEvent} />}
      {stmtOpen && active && <PropertyStatementModal propertyName={active.name} onClose={() => setStmtOpen(false)} onIssue={openPropertyStatement} />}

      {reporting && active && (
        <OwnerReportModal property={active} unitWord={ul} issuer={issuer || {}} db={db} onClose={() => setReporting(false)} />
      )}
      {expensesOpen && active && (
        <ExpensesModal propertyId={active.id} propertyName={active.name} unitWord={ul} db={db}
          issuer={issuer} propertyType={active.property_type} ownerName={active.owner_name}
          payeeHints={[...(active.tenants || []).filter((x) => !isVacant(x) && x.name).map((x) => String(x.name)), ...(active.owner_name ? [String(active.owner_name)] : [])]}
          onClose={() => { setExpensesOpen(false); setExpKey((k) => k + 1); }} />
      )}
      {ownerLinkOpen && active && (
        <OwnerLinkModal propertyId={active.id} propertyName={active.name} ownerName={active.owner_name} db={db} demo={demo}
          properties={items.map((p) => ({ id: p.id, name: p.name, owner_name: (p as any).owner_name }))}
          onClose={() => setOwnerLinkOpen(false)} />
      )}

      {schedule && <ScheduleModal tenant={schedule} unitWord={ul} onClose={() => setSchedule(null)} />}
      {renewing && <RenewModal key={renewing.id} tenant={renewing} unitWord={ul} onClose={() => setRenewing(null)} onRenew={(o) => doRenew(renewing, o)} />}
      {enforcing && <EnforcementModal tenant={enforcing} unitWord={ul}
        onClose={() => setEnforcing(null)}
        onSubmit={async (no, order) => {   /* تُغلق بعد نجاح الحفظ — كانت تُغلق فورًا فيضيع ما كُتب إن فشل */
          if (await patchTenant(enforcing.id, { litigation: true, enforcement_no: no || null, enforcement_order: order || null })) setEnforcing(null); }} />}
      {paying && <PaymentModal tenant={paying} unitWord={ul} onClose={() => { setPaying(null); setPayInit(null); setPayClaim(null); }}
        st={contractState(paying, { graceDays: Number(active?.grace_days) || 0, ...windowsOf(active) })}
        recent={payRecent} vat={active ? unitVat(paying, active) : null} init={payInit}
        onSubmit={(amt, method, note, paidOn, reference, guarded) => {
          if (payClaim) approveClaimPayment(paying, payClaim, amt, method, note, paidOn, reference);
          else recordPayment(paying, amt, method, note, paidOn, reference, guarded);
          setPaying(null); setPayInit(null); setPayClaim(null); }} />}
      {tenantLinkFor && active && (
        <TenantLinkModal tenant={tenantLinkFor} propertyName={active.name} unitWord={ul}
          orgName={(issuer as any)?.billing_name || orgName || null} db={supabase} demo={demo}
          onClose={() => setTenantLinkFor(null)} />
      )}
      {renewAsk && (() => {
        const end = contractState(renewAsk).endDate;
        return (
          <Shell onClose={() => setRenewAsk(null)}>
            <div role="alertdialog" aria-labelledby="renew-early-h">
              <h3 id="renew-early-h" className="font-display font-bold text-deep text-lg mb-2">التجديد قبل موعده</h3>
              <p className="text-sm leading-relaxed text-[#33413d]">
                العقد ينتهي <b>{end ? `${hijriText(end)} (${gregorianAr(end)})` : "—"}</b>. التجديد الآن يبدأ مدة جديدة ويصفّر عدّاد الدفعات. هل تقصد تعديل بيانات العقد؟
              </p>
              <p className="text-xs text-muted mt-2">{renewAsk.name} — {ul} {renewAsk.unit || "—"}</p>
              <div className="flex gap-2 mt-5">
                {may("edit_tenants") && <button type="button" className="btn btn-gold flex-1 justify-center" autoFocus
                  onClick={() => { const t = renewAsk; setRenewAsk(null); setModal({ kind: "tenant", id: t.id }); }}>تعديل البيانات</button>}
                <button type="button" className="btn btn-ghost flex-1 justify-center"
                  onClick={() => { const t = renewAsk; renewAcked.current = t.id; setRenewAsk(null); setRenewing(t); }}>متابعة التجديد</button>
              </div>
            </div>
          </Shell>
        );
      })()}
      {turnover && <TurnoverModal key={turnover.id} tenant={turnover} unitWord={ul} onClose={() => setTurnover(null)}
        vat={active ? { enabled: unitVatApplies(turnover, active), rate: Number(active.vat_rate) || 15, inclusive: active.vat_inclusive !== false } : undefined}
        onSubmit={(d) => saveTurnover(turnover, d)} />}
      {history && <HistoryModal data={history} unitWord={ul} db={db} canEdit={may("undo_actions")} onChanged={() => { setInboxKey((k) => k + 1); router.refresh(); }} onClose={() => setHistory(null)} />}
      {remindAll && <RemindAllModal rows={lateRows} unitWord={ul} linkOf={remindLink} demo={demo} dueOf={(r) => dueWithVat(r.st, r.t, active)}
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
/**
 * ⚡ سطر عداد الكهرباء في خانة الوحدة (طلب مكتب، 6 أكتوبر 2026): رقم الحساب
 * ظاهرًا، وزرّ إشعار المستأجر بتسجيله باسمه، وتاريخ آخر إشعار — الإثبات أنه بُلِّغ.
 */
/** الإشعار يخصّ المستأجر الحالي وعداده؟ (السجلات قبل v74b بلا اسم تُقبل) */
function meterNoticeValid(t: Tenant): boolean {
  if (!t.elec_notice_at) return false;
  const nm = t.elec_notice_name, ac = t.elec_notice_account;
  if (nm != null && nm !== String(t.name || "").trim()) return false;
  if (ac != null && ac !== String(t.elec_account || "").trim()) return false;
  return true;
}
function MeterLine({ t, onSend }: { t: Tenant; onSend?: () => void }) {
  const acc = String(t.elec_account || "").trim();
  if (!acc) return null;
  const sent = meterNoticeValid(t) ? String(t.elec_notice_at).slice(0, 10) : null;
  return (
    <div className="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span>⚡ عداد <bdi dir="ltr" className="tabular-nums">{acc}</bdi></span>
      {sent
        ? <span className="text-[#137a50]">· أُشعر بالتسجيل {arDate(sent)}{Number(t.elec_notice_count) === 2 ? " (مرتان)" : Number(t.elec_notice_count) > 2 ? ` (${t.elec_notice_count} مرات)` : ""}</span>
        : <span className="text-[#9A4B00]">· لم يُشعَر بتسجيله</span>}
      {onSend && (
        <button type="button" className="underline text-deep font-semibold hover:text-gold" onClick={onSend}
          title="رسالة واتساب للمستأجر برقم الحساب وطلب تسجيل العداد باسمه لدى شركة الكهرباء">
          {sent ? "أعد الإشعار" : "أرسل إشعار التسجيل"}
        </button>
      )}
    </div>
  );
}

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

function PaymentModal({ tenant, unitWord, onClose, onSubmit, st, recent = null, vat = null, init = null }: {
  tenant: Tenant; unitWord: string; onClose: () => void;
  /** حالة العقد — لتقول المعاينة على أي دفعة يقع المبلغ (30 سبتمبر 2026) */
  st?: ReturnType<typeof contractState>;
  /** (جولة 4) دفعات المستأجر الأخيرة — لحارس «دفعة مشابهة» */
  recent?: any[] | null;
  /** ضريبة الوحدة — لعرض المتبقي شاملًا الضريبة حين تكون مضافة */
  vat?: any;
  /** مبلغ مقترح وسبب حين حوّل زرّ ✔ إلى هنا */
  init?: { amount: number; why: string; paidOn?: string; reference?: string | null } | null;
  onSubmit: (amount: number, method: string, note?: string, paidOn?: string, reference?: string, guarded?: boolean) => void;
}) {
  const rent = Number(tenant.rent_amount) || 0;
  const already = Number(tenant.partial_amount) || 0;
  const remaining = Math.max(0, rent - already);
  /* (جولة 4) المتبقي من قيمة العقد كله بوحدة التسجيل — حادثة 8,299 بدل 1,700 على عقد 10,000 */
  const rem = contractRemaining(tenant, vat);
  /* عقد مسدَّد بالكامل: لا نقترح مبلغًا — كان الحقل يُملأ بدفعة كاملة لا وجود لها */
  const [amount, setAmount] = useState<string>(init?.amount ? String(init.amount) : rem.remaining <= 0 ? "" : String(Math.min(remaining || rent, rem.remaining)));
  const [ask, setAsk] = useState<null | { kind: "excess" | "dup"; text: string }>(null);
  const [acked, setAcked] = useState<{ excess?: string; dup?: string }>({});
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");
  /* تاريخ وصول المال ومرجع الحوالة — أساس مطابقة كشف البنك */
  const [paidOn, setPaidOn] = useState(init?.paidOn || today());
  const [reference, setReference] = useState(init?.reference || "");
  const amt = Number(amount) || 0;
  const pool = already + amt;
  const completed = rent > 0 ? Math.floor(pool / rent) : 0;
  const leftover = rent > 0 ? +(pool - completed * rent).toFixed(2) : 0;
  /* المبلغ يقع على أقدم دفعة غير مسدَّدة أولًا — كانت المعاينة تقول «ستكتمل دفعة»
     و«جزئي على الدفعة التالية» كأن المستأجر منتظم، وعليه ثلاث متأخرة. */
  const lateN = Math.max(0, Number(st?.unpaid) || 0);
  const lateDue = Math.max(0, Number(st?.amountDue) || 0);
  /** الحارسان بالترتيب: يزيد على المتبقي ← يشبه دفعة قريبة؛ كل تأكيد مرتبط بالمبلغ والتاريخ نفسيهما */
  function submit(ok: { excess?: string; dup?: string }) {
    if (!amt) return;
    const key = `${amt}|${paidOn}`;
    const over = excessOverRemaining(amt, rem.remaining);
    if (over > 0 && ok.excess !== key) {
      /* (F3) «مضافة فوق الإيجار»: المبلغ = المتبقي شاملًا الضريبة (±1) ⇒ غالبًا أُدخل شاملًا والتسجيل بدونها */
      const slip = vatInclusiveSlip(amt, rem.remaining, vat);
      setAsk({ kind: "excess", text: slip !== null
        ? `يبدو أنك أدخلت المبلغ شاملًا الضريبة — المتبقي بدون الضريبة ${sar(slip)}`
        : `المبلغ يزيد على المتبقي من العقد (${sar(Math.max(0, rem.remaining))}) بـ${sar(over)} — متأكد؟` });
      return;
    }
    const near = nearDuplicatePayment(amt, paidOn, recent || []);
    if (near && ok.dup !== key) {
      setAsk({ kind: "dup", text: `يشبه دفعة ${sar(Number(near.amount))} بتاريخ ${String(near.paid_on).slice(0, 10)} — دفعة جديدة فعلًا؟` });
      return;
    }
    /* (F2) covered = قائمة الدفعات القريبة مكتملة لتاريخ هذا السداد: قُرئت بلا خطأ، وإمّا أقل من سقف
       القراءة (60) أو التاريخ لا يسبق أقدم دفعة فيها. عندها فقط لا يعيد recordPayment سؤال «اليوم نفسه». */
    const covered = recentCovers(recent, paidOn, 60);
    onSubmit(amt, method, note.trim() || undefined, paidOn, reference.trim() || undefined, covered);
  }

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
        {lateN > 0 && (
          <div className="flex justify-between mt-1"><span className="text-muted">متأخر الآن: {countAr(lateN, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")}</span>
            <b className="tabular-nums text-late">{sar(lateDue)} ريال</b></div>
        )}
      </div>

      <div className={`flex justify-between text-sm rounded-xl px-3 py-2 mb-3 border ${rem.remaining < 0 ? "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]" : "bg-white border-line"}`} data-testid="contract-remaining">
        <span className="text-muted">المتبقي من العقد</span>
        <b className="tabular-nums">{rem.remaining < 0 ? <>مدفوع زيادةً <bdi dir="ltr">{sar(-rem.remaining)}</bdi></> : <>{sar(rem.remaining)} ريال</>}
          {rem.remaining > 0 && rem.remainingWithVat !== rem.remaining ? <span className="text-xs text-muted font-normal"> (شاملًا الضريبة {sar(rem.remainingWithVat)})</span> : null}</b>
      </div>
      {init?.why && <div className="text-xs rounded-lg border border-[#EBD9AA] bg-[#FDF0DC] text-[#7A4800] p-2.5 mb-3">راجع قبل التسجيل: {init.why}.</div>}

      <Field label="المبلغ المستلم (ريال)">
        <input className="fld" type="number" autoFocus value={amount} onChange={(e) => { setAmount(e.target.value); setAsk(null); }} />
      </Field>
      <div className="flex gap-2 mt-2 flex-wrap">
        {remaining > 0 && remaining !== rent && (
          <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(remaining))}>إكمال الدفعة ({sar(remaining)})</button>
        )}
        <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(rent))}>دفعة كاملة ({sar(rent)})</button>
        {lateN > 1 && lateDue > 0 && <button className="btn btn-ghost text-xs" onClick={() => setAmount(String(lateDue))}>كل المتأخر ({sar(lateDue)})</button>}
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
          <DateField value={paidOn} onChange={(v) => { if (v) { setPaidOn(v); setAsk(null); } }} />
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

      {amt > 0 && (() => {
        /* الزيادة على المتبقي من العقد كله. إن وُجدت فلا «دفعة قادمة» ولا «جزئي منها»
           يُقال — كانت المعاينة توحي بأن الزيادة سداد طبيعي (حادثة 8,299 بدل 1,700) */
        const overAll = excessOverRemaining(amt, rem.remaining);
        const settled = rem.remaining <= 0;
        return (
        <div className={`rounded-xl p-3 mt-4 text-xs leading-relaxed border ${overAll > 0 ? "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]" : "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]"}`}>
          {settled ? (
            <div>العقد مسدَّد بالكامل — المبلغ كله (<b>{sar(amt)} ريال</b>) زيادة على قيمة العقد.</div>
          ) : (<>
          {lateN > 0 && <div>يُطبَّق على أقدم دفعة متأخرة أولًا{st?.nextDueDate ? <> (المستحقة <bdi dir="ltr" className="whitespace-nowrap">{st.nextDueDate}</bdi>)</> : null}.</div>}
          {completed > 0 && <div>ستكتمل <b>{countAr(completed, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")}</b>{lateN > 0 ? (completed >= lateN ? " — وتُغطّى كل المتأخرات" : ` — ويبقى متأخرًا ${countAr(lateN - completed, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")}`) : ""}.</div>}
          {overAll > 0
            ? <div>ويزيد <b>{sar(overAll)} ريال</b> على المتبقي من العقد كله ({sar(rem.remaining)}) — لا دفعة بعدها في هذا العقد.</div>
            : <>
              {completed > 0 && leftover > 0 && <div>ويتبقّى <b>{sar(leftover)} ريال</b> مسجّلة كسداد جزئي على {lateN > completed ? "الدفعة المتأخرة التالية" : "الدفعة القادمة"}.</div>}
              {/* لا دفعة تكتمل: المبلغ جزء من الدفعة نفسها — كانت المعاينة تقول «على الدفعة التالية» */}
              {completed === 0 && leftover > 0 && <div>لن تكتمل الدفعة — يُسجَّل سدادًا جزئيًّا منها، ويبقى عليها <b>{sar(+(rent - leftover).toFixed(2))} ريال</b>.</div>}
            </>}
          </>)}
        </div>);
      })()}

      {ask ? (
        /* (جولة 4) سؤال داخل النافذة — لا نافذة المتصفح. يسأل ولا يمنع. */
        <div role="alertdialog" aria-labelledby="pay-ask" className="mt-5 rounded-xl border border-[#F5C6C2] bg-[#FBE9E7] p-3 text-[#8f2b26]">
          <div id="pay-ask" className="text-sm font-semibold leading-relaxed">⚠️ {ask.text}</div>
          <div className="flex gap-2 mt-3">
            <button type="button" className="btn btn-ghost flex-1 justify-center" autoFocus onClick={() => setAsk(null)}>{ask.kind === "dup" ? "لا، سأراجع" : "مراجعة المبلغ"}</button>
            <button type="button" className="btn flex-1 justify-center bg-late text-white"
              onClick={() => { const key = `${amt}|${paidOn}`; const next = { ...acked, [ask.kind]: key }; setAcked(next); setAsk(null); submit(next); }}>
              {ask.kind === "dup" ? "نعم، دفعة جديدة" : "نعم، سجّله"}</button>
          </div>
        </div>
      ) : (
      <div className="flex gap-2 mt-5">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!amt} onClick={() => submit(acked)}>تسجيل</button>
      </div>
      )}
    </Shell>
  );
}

/** إنهاء العقد والإخلاء — قائمة تحقّق وتسوية تأمين وقراءات عدادات */
function TurnoverModal({ tenant, unitWord, onClose, onSubmit, vat }: {
  /** ضريبة الوحدة — المتأخر يُخصم من التأمين كما يُطالَب به، شاملًا الضريبة المضافة */
  vat?: { enabled: boolean; rate: number; inclusive: boolean };
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
  /* (30 سبتمبر 2026) المتأخر حتى تاريخ الإخلاء المكتوب لا حتى اليوم: كان
     contractState(tenant, {}) — فإخلاء بأثر رجعي (خرج قبل شهرين ويُسجَّل اليوم)
     يخصم من التأمين أقساطًا بعد خروجه. نحسب الوحدة كأنها أُخليت في ذلك اليوم
     (الحساب نفسه يسقط مهلة السماح للمُخلي ولا يتجاوز اليوم). */
  const st = contractState({ ...tenant, status: "vacated", move_out_date: d.move_out_date || today() } as any, {});
  /* ما يُخصم من التأمين = كل ما على المستأجر (مراجعة 29 سبتمبر 2026): متأخر
     المدة شاملًا الضريبة المضافة + الدين المرحَّل. كان يُخصم متأخر المدة وحده
     قبل الضريبة، فمستأجرٌ عليه دين مرحَّل 5,000 وتأمينه 3,000 تخرج مخالصته
     «يُردّ له 3,000». */
  const rentOwed = vat?.enabled ? splitVat(st.amountDue, vat).total : st.amountDue;
  const carriedOwed = Math.max(0, Number((tenant as any).carried_debt) || 0);
  const s = settleDeposit(
    { deposit_amount: Number(d.deposit_amount) || 0, deposit_deductions: Number(d.deposit_deductions) || 0 },
    Math.round((rentOwed + carriedOwed) * 100) / 100
  );
  const doneCount = list.filter((x) => x.done).length;

  return (
    <Shell onClose={onClose} wide>
      <h3 className="font-display font-bold text-deep text-xl mb-1">إنهاء العقد وإخلاء {unitWord}</h3>
      <p className="text-sm text-muted mb-4">{tenant.name} · {unitWord} {tenant.unit || "—"}</p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="تاريخ إبلاغ المستأجر بالإخلاء" hint="اختياري">
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
          <div>يُخصم إيجار متأخر حتى <bdi dir="ltr" className="whitespace-nowrap">{d.move_out_date || today()}</bdi>{vat?.enabled ? " (شامل الضريبة)" : ""}: <b className="tabular-nums">{sar(rentOwed)}</b> ريال</div>
          {carriedOwed > 0 && <div>ويُخصم دين مرحَّل من مدة سابقة: <b className="tabular-nums">{sar(carriedOwed)}</b> ريال</div>}
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
function HistoryModal({ data, unitWord, onClose, canEdit = true, onChanged, db }: {
  data: { tenant: Tenant; rows: any[] }; unitWord: string; onClose: () => void; canEdit?: boolean; db?: any;
  /** تُستدعى بعد عكس دفعة ليُعاد تحميل أرقام اللوحة */
  onChanged?: () => void;
}) {
  const { tenant } = data;
  const supabase: any = useMemo(() => db || createClient(), [db]);
  const [rows, setRows] = useState<any[]>(data.rows);
  const [editing, setEditing] = useState<string | null>(null);
  const [eDate, setEDate] = useState("");
  const [eRef, setERef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /**
   * عكس دفعة بعينها — لا آخر دفعة فقط.
   *
   * من اكتشف بعد شهرين أن دفعة قديمة سُجّلت بمبلغ أكبر مما استُلم، كان
   * عليه التراجع عن كل ما بعدها. الآن يعكس الخاطئة وحدها، ثم يسجّل المبلغ
   * الصحيح دفعةً عادية. الصفّان يبقيان في السجل للتدقيق.
   */
  async function reverseOne(r: any) {
    if (!confirm(
      `عكس هذه الدفعة؟\n\n${sar(Number(r.amount))} ريال بتاريخ ${r.paid_on}\n\n`
      + `سيُضاف صفّ سالب مطابق، ويُنقص عدّاد الدفعات المسدَّدة، ويعود المبلغ مستحقًّا.\n`
      + `الدفعة الأصلية تبقى في السجل للتدقيق.\n\n`
      + `إن كان المستأجر سدّد مبلغًا أقل، اعكسها ثم سجّل المبلغ الصحيح بزر ½.`
    )) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("watheq_reverse_payment", { p_payment: r.id });
    setBusy(false);
    if (error) { setErr(/does not exist|function/i.test(error.message) ? "شغّل schema-v35 في قاعدة البيانات أولًا." : error.message); return; }
    const res = data as any;
    setRows((cur) => [{ id: res?.payment_id || `rev_${r.id}`, tenant_id: r.tenant_id, paid_on: r.paid_on,
      amount: -Number(r.amount), method: "other", periods_covered: -1,
      note: `عكس دفعة ${r.paid_on}`, created_at: new Date().toISOString() }, ...cur]);
    onChanged?.();
  }

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
                  {/* العكس يبقى ظاهرًا هنا (سجلّ تدقيق للمكتب) — بلا المعرّف الخام */}
                  <td className="p-2 text-muted text-xs">{r.note ? String(r.note).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "").replace(/\s*—\s*$/, "") : "—"}</td>
                  {canEdit && (
                    <td className="p-2 whitespace-nowrap">
                      {editing === r.id ? (
                        <span className="flex gap-1">
                          <button className="btn btn-primary text-[10px] px-2 py-0.5" disabled={busy} onClick={() => saveEdit(r.id)}>حفظ</button>
                          <button className="btn btn-ghost text-[10px] px-2 py-0.5" onClick={() => setEditing(null)}>إلغاء</button>
                        </span>
                      ) : Number(r.amount) < 0 ? (
                        /* صفّ العكس يتبع تاريخ أصله تلقائيًّا (schema-v44) — تعديله وحده
                           يفصله عن شهر الدفعة التي عكسها، والقاعدة ترفضه */
                        <span className="text-[10px] text-muted">يتبع الأصل</span>
                      ) : (
                        <button className="btn btn-ghost text-[10px] px-2 py-0.5"
                          onClick={() => { setEditing(r.id); setEDate(String(r.paid_on || "").slice(0, 10)); setERef(r.reference || ""); }}
                          title="تصحيح تاريخ وصول الحوالة أو مرجعها — المبلغ لا يُعدَّل، وعكسها إن وُجد يتبعها">✎ تاريخ/مرجع</button>
                      )}
                      {canEdit && editing !== r.id && Number(r.amount) > 0 && (
                        <button className="btn btn-ghost text-[10px] px-2 py-0.5 ms-1 text-late" disabled={busy}
                          onClick={() => reverseOne(r)}
                          title="يُعيد مبلغ هذه الدفعة مستحقًّا — للدفعة المسجّلة بمبلغ خاطئ">↩︎ اعكسها</button>
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
function StatusPill({ k, ended = false }: { k: RowKey; ended?: boolean }) {
  const m = ROW_META[k];
  const label = ended && k === "expiring" ? "انتهى العقد" : m.label;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1 ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} /> {label}
    </span>
  );
}

/** قائمة إجراءات منسدلة — تُخفي الأزرار الثانوية */
/**
 * زر بقائمة — لتجميع الأدوات بدل نشرها في شريط طويل.
 * مثبّت بإحداثيات الشاشة كقائمة الصف، فلا يقصّه أي إطار متمرّر.
 */
function MenuBtn({ label, items, badge = 0 }: {
  label: React.ReactNode;
  /* «sep» عنوان قسم لا بند: قائمة بعشرة بنود متساوية تجعل العين تقرأ
     الكل لتجد واحدًا. والعناوين تقسّمها إلى ثلاث وظائف تُمسح بنظرة. */
  items: { label?: string; run?: () => void; href?: string; sep?: string }[];
  badge?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  /* القياس الفعلي والانقلاب والتمرير الداخلي — كقائمة الصف (30 سبتمبر 2026) */
  const { menuRef, style } = useFloatingMenu(open, setOpen, ref, 210);
  if (!items.length) return null;
  return (
    <>
      <button ref={ref} type="button" className="btn btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>
        {label} <span className="opacity-60">▾</span>
        {badge > 0 && <span className="mr-1 inline-grid place-items-center min-w-[18px] h-4 px-1 rounded-full bg-[#FBE9E7] text-[#a5322c] text-[.62rem] font-bold">{badge}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={menuRef} style={style} role="menu"
            className="fixed z-50 min-w-[210px] max-w-[calc(100vw-16px)] bg-white border border-line rounded-xl shadow-lg py-1">
            {items.map((it, i) => it.sep ? (
              <div key={i} className="px-3.5 pt-2.5 pb-1 text-[10px] font-bold text-muted tracking-wide border-t border-line/70 first:border-0 first:pt-1">{it.sep}</div>
            ) : it.href ? (
              <Link key={i} href={it.href} role="menuitem" className="block px-3.5 py-2 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:py-3 text-xs font-semibold text-deep hover:bg-paper2">{it.label}</Link>
            ) : (
              <button key={i} type="button" role="menuitem" onClick={() => { setOpen(false); it.run?.(); }}
                className="block w-full text-right px-3.5 py-2 [@media(pointer:coarse)]:min-h-[44px] text-xs font-semibold text-deep hover:bg-paper2">{it.label}</button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * موضع القائمة المنبثقة من ارتفاعها الفعلي لا من تقدير (30 سبتمبر 2026).
 *
 * كان الارتفاع يُقدَّر «عدد البنود × 30» بسقف 320 — وقائمة الوحدة فيها ثلاثة
 * عناوين وأحد عشر بندًا، فتخرج عن شاشة الجوال (844px) من أسفلها ولا يُوصل
 * لـ«حذف الوحدة» ولا «التراجع». الآن: تُرسم مخفية، يُقاس ارتفاعها، ثم تُفتح
 * تحت الزر أو فوقه حيث تتّسع، وإن لم تتّسع في أيٍّ منهما تأخذ الشاشة ناقص
 * الهوامش وتُمرَّر داخلها. التمرير داخل القائمة لا يغلقها — كان يغلقها.
 */
function useFloatingMenu(open: boolean, setOpen: (v: boolean) => void, anchor: React.RefObject<HTMLElement>, minW: number) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  function place() {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const M = 8;
    const vh = window.visualViewport?.height || window.innerHeight;
    const vw = window.innerWidth;
    const m = menuRef.current;
    const natural = m ? m.scrollHeight : 320;
    const W = Math.max(minW, m?.offsetWidth || minW);
    const below = vh - r.bottom - M - 4, above = r.top - M - 4;
    let top: number, maxH: number;
    if (natural <= below) { top = r.bottom + 4; maxH = below; }
    else if (natural <= above) { top = r.top - 4 - natural; maxH = above; }
    else { maxH = vh - 2 * M; top = Math.max(M, vh - M - Math.min(natural, maxH)); }
    const left = Math.min(Math.max(M, r.right - W), vw - W - M);
    setPos({ top, left: Math.max(M, left), maxH });
  }
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      /* تمرير داخل القائمة نفسها ليس سببًا لإغلاقها */
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => place();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); anchor.current?.focus(); } };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onResize); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* قبل القياس: مرسومة خارج النظر لتُقاس — لا وميض في موضع خاطئ */
  const style: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left, maxHeight: pos.maxH, overflowY: "auto", overscrollBehavior: "contain" }
    : { top: 0, left: 0, visibility: "hidden" };
  return { menuRef, style };
}

function RowMenu({ items }: { items: { label?: string; run?: () => void; danger?: boolean; sep?: string }[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const { menuRef, style } = useFloatingMenu(open, setOpen, btnRef, 190);

  if (!items.length) return null;
  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={() => setOpen((v) => !v)} aria-label="إجراءات أخرى" aria-haspopup="menu" aria-expanded={open}
        className="btn btn-ghost text-xs px-2.5" title="المزيد">⋯</button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={menuRef} role="menu" style={style}
            className="fixed z-50 min-w-[190px] max-w-[calc(100vw-16px)] bg-white border border-line rounded-xl shadow-lg py-1">
            {items.map((it, i) => it.sep ? (
              /* لا نعرض عنوان قسم لا عناصر بعده — يحدث مع الموظف محدود الصلاحيات */
              items.slice(i + 1).findIndex((x) => !x.sep) === -1 || items[i + 1]?.sep ? null : (
              /* عنوان قسم: تسع خيارات متساوية تُقرأ ببطء — التقسيم يجعل العين تقفز */
              <div key={i} className="px-3.5 pt-2 pb-1 text-[10px] font-bold text-muted border-t border-line first:border-0 first:pt-1">{it.sep}</div>
              )
            ) : (
              /* 44px على شاشات اللمس — كانت 28px فيلمس الإبهام البند المجاور (30 سبتمبر 2026) */
              <button key={i} type="button" role="menuitem"
                onClick={() => { setOpen(false); it.run?.(); }}
                className={`block w-full text-right px-3.5 py-1.5 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:py-2.5 text-xs font-semibold hover:bg-paper2 transition ${it.danger ? "text-late" : "text-deep"}`}>
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
        <input className="fld" value={t} onChange={(e) => setT(e.target.value)} aria-label="نص الملاحظة أو المهمة"
          placeholder={`ما الذي حدث أو يجب عمله؟ (تسريب في ${unitWord} 12 · تجديد رخصة · دهان السلالم)`}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <button className="btn btn-primary text-sm shrink-0" onClick={submit}>حفظ</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {Object.entries(NOTE_KINDS).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`text-[11px] px-2 py-1 rounded-full border whitespace-nowrap ${kind === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
        {/* كان حقل تاريخ خامًا يعرض dd/mm/yyyy بالإنجليزية وسط واجهة عربية
            تعرض التواريخ بالهجري. DateField يعطي التقويمين بمسمّياتهما. */}
        {/* كان <label> يلفّ الحقل كله فيرتبط بزرّ «ميلادي» (أول عنصر فيه) لا بخانة التاريخ —
            الآن يرتبط بالخانة نفسها بمعرّفها (30 سبتمبر 2026) */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted ms-auto">
          <label htmlFor="note-due">ذكّرني في</label>
          <span className="w-44"><DateField id="note-due" value={due} onChange={(v) => setDue(v)} /></span>
        </div>
      </div>
      <p className="text-[10px] text-muted mt-1.5">
        بموعد: تصير مهمة تظهر على العقار وفي ملخّص تليجرام حتى تُغلق · بلا موعد: ملاحظة في السجل فقط.
      </p>
    </div>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      {/* كان العنوان والشرح في سطر واحد وبحجم واحد، فيصير النموذج جدارًا
          من النص. الشرح الآن سطر أصغر وأفتح تحت العنوان. */}
      <span className="block text-sm font-semibold mb-0.5">{label}</span>
      {hint && <span className="block text-[11px] text-muted font-normal mb-1 leading-relaxed">{hint}</span>}
      {children}
    </label>
  );
}

/**
 * إطار النوافذ (30 سبتمبر 2026).
 *
 * كانت لمسة على الخلفية تُغلق النافذة — ونموذج الوحدة خمسة عشر حقلًا على
 * الجوال، فلمسة بجانب الحقل تمحو كل ما كُتب بلا سؤال. الآن:
 *  • تتبّع «متّسخ» عامّ: أي كتابة أو اختيار داخل النافذة (input/change) يعلّمها.
 *  • الخلفية تُغلق النافذة النظيفة وحدها؛ والمتّسخة تسأل أولًا.
 *  • زرّ ✕ ظاهر في الزاوية، وEscape يُغلق — وكلاهما يسأل إن كان فيها إدخال.
 * أزرار «إلغاء» داخل النماذج قرار صريح فتبقى كما هي.
 */
function Shell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const dirty = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tryClose = () => {
    if (dirty.current && !confirm("لديك إدخال لم يُحفظ في هذه النافذة.\n\nإغلاقها وتجاهل ما أدخلته؟")) return;
    closeRef.current();
  };
  const tryCloseRef = useRef(tryClose);
  tryCloseRef.current = tryClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); tryCloseRef.current(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) tryClose(); }}>
      <div role="dialog" aria-modal="true"
        className={`relative w-full ${wide ? "max-w-2xl" : "max-w-md"} bg-white rounded-2xl shadow-xl p-6 pt-11 max-h-[90vh] overflow-auto`}
        onInput={() => { dirty.current = true; }} onChange={() => { dirty.current = true; }}>
        {/* لاصق أعلى النافذة: في نموذج طويل يبقى ظاهرًا بعد التمرير */}
        <div className="sticky -top-9 h-0 -mt-9 mb-9 z-10">
          <button type="button" onClick={tryClose} aria-label="إغلاق" title="إغلاق (Esc)"
            className="absolute top-0 -left-4 w-11 h-11 grid place-items-center rounded-full bg-white/90 text-muted hover:text-deep hover:bg-paper2 text-lg leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * عدادات العقار الرئيسية (schema-v68): المصعد والخدمات والماء — غير عدادات الشقق.
 * مطويّة افتراضيًّا لعقار بلا عدادات: أغلب العقارات لا تحتاجها، والنموذج طويل.
 */
function MetersEditor({ value, onChange }: { value: PropertyMeter[] | null | undefined; onChange: (m: PropertyMeter[]) => void }) {
  const list: PropertyMeter[] = Array.isArray(value) ? value : [];
  const saved = cleanMeters(list);
  const set = (i: number, patch: Partial<PropertyMeter>) => onChange(list.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = (type: "elec" | "water") => list.length < MAX_METERS && onChange([...list, { type, label: "", account: "" }]);
  return (
    <details open={list.length > 0} className="border border-line rounded-xl p-3 bg-paper">
      <summary className="cursor-pointer text-sm font-semibold text-deep">
        عدادات العقار الرئيسية{" "}
        <span className="text-xs text-muted font-normal">— {saved ? metersCountLine(saved) : "المصعد، الخدمات، الماء… تظهر في تقرير المالك"}</span>
      </summary>
      <div className="space-y-2 mt-3">
        <p className="text-xs text-muted leading-relaxed">
          عدادات العمارة المشتركة فقط. عدادا كل شقة يُكتبان في بيانات الوحدة نفسها.
        </p>
        {list.map((m, i) => (
          <div key={i} className="grid grid-cols-[96px_1fr_36px] gap-2 items-center pb-2 border-b border-line last:border-b-0">
            <select className="fld text-sm" value={m.type} aria-label="نوع العداد"
              onChange={(e) => set(i, { type: e.target.value === "water" ? "water" : "elec" })}>
              <option value="elec">{METER_TYPE_AR.elec}</option>
              <option value="water">{METER_TYPE_AR.water}</option>
            </select>
            <input className="fld text-sm" value={m.label || ""} maxLength={40} aria-label="وصف العداد"
              onChange={(e) => set(i, { label: e.target.value })} placeholder={m.type === "water" ? "مثال: الخزان الرئيسي" : "مثال: المصعد"} />
            <input className="fld text-sm col-span-3 order-last" dir="ltr" inputMode="numeric" value={m.account || ""} maxLength={40} aria-label="رقم الحساب"
              onChange={(e) => set(i, { account: e.target.value })} placeholder="رقم الحساب" />
            <button type="button" className="w-9 h-9 grid place-items-center rounded-lg text-muted hover:text-late hover:bg-[#FBE9E7]"
              aria-label="حذف العداد" title="حذف العداد" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {list.some((m) => !String(m.account || "").trim()) && (
          <p className="text-xs text-[#9A5B00]">العداد بلا رقم حساب لا يُحفظ.</p>
        )}
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn btn-ghost text-xs" onClick={() => add("elec")} disabled={list.length >= MAX_METERS}>+ عداد كهرباء</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => add("water")} disabled={list.length >= MAX_METERS}>+ عداد ماء</button>
        </div>
      </div>
    </details>
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
        <Field label="المالك" hint="يجمع عقاراته في كشف حساب واحد — اختر اسمًا موجودًا أو اكتب جديدًا">
          <input className="fld" list="watheq-owner-names" value={d.owner_name || ""} onChange={(e) => setD({ ...d, owner_name: e.target.value })} placeholder="مثال: عبدالله بن سعد" />
          <datalist id="watheq-owner-names">{ownerNames.map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
        {/* «اسم المالك أو المكتب» أزيل: هو في الكود «مدير العقار» ولا يظهر في مستند إلا
            إن فرغ اسم المُصدِر في الإعدادات، وقيمته اسم المكتب أصلًا — لكن تسميته جعلت
            المكتب يكتب فيه اسم المالك مرتين (أو هنا لا في «المالك» فلا يُجمَّع كشفه).
            يبقى محفوظًا كما هو (اسم المكتب افتراضيًّا عند الحفظ). */}
        {/* الاستخدام (عوائل/عزّاب) للعمارة والفيلا فقط — لا معنى له لمعرض أو مستودع */}
        {(["residential", "villa"].includes(d.property_type || "residential") || d.usage) && (
          <Field label="استخدام العقار" hint="يظهر في المستندات والإعلانات">
            <select className="fld" value={d.usage || ""} onChange={(e) => setD({ ...d, usage: e.target.value })}>
              <option value="">— غير محدد —</option>
              {Object.entries(PROPERTY_USAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        )}
        <MetersEditor value={d.meters} onChange={(m) => setD({ ...d, meters: m })} />
        {/* نوافذ التنبيه لهذا العقار: الافتراضي من إعدادات المكتب — تُغيَّر نادرًا */}
        <details open={d.expiring_days != null || d.soon_days != null || d.imminent_days != null} className="border border-line rounded-xl p-3 bg-paper">
          <summary className="cursor-pointer text-sm font-semibold text-deep">إعدادات التنبيه لهذا العقار <span className="text-xs text-muted font-normal">— اختيارية، الافتراضي من إعدادات المكتب</span></summary>
          <div className="space-y-3 mt-3">
            <Field label="تنبيه انتهاء العقد قبله بـ (يوم)" hint={`فارغ = افتراضي المكتب (${daysAr(officeExpiring)}) — يظهر باللون الأحمر ضمن «ينتهي قريبًا»`}>
              <input className="fld" type="number" min={1} max={180} value={d.expiring_days ?? ""} onChange={(e) => setD({ ...d, expiring_days: e.target.value === "" ? null : Number(e.target.value) })} placeholder={String(officeExpiring)} />
            </Field>
            <Field label="«قريب» — قبل الاستحقاق بـ (يوم)" hint={`فارغ = إعداد المكتب (${daysAr(officeSoon)})`}>
              <input className="fld" type="number" min={1} max={60} value={d.soon_days ?? ""} onChange={(e) => setD({ ...d, soon_days: e.target.value === "" ? null : Number(e.target.value) })} placeholder={`افتراضي المكتب: ${officeSoon}`} />
            </Field>
            <Field label="«مستحق» — قبل الاستحقاق بـ (يوم)" hint={`فارغ = إعداد المكتب (${daysAr(officeImminent)}) — أقل من «قريب»`}>
              <input className="fld" type="number" min={1} max={60} value={d.imminent_days ?? ""} onChange={(e) => setD({ ...d, imminent_days: e.target.value === "" ? null : Number(e.target.value) })} placeholder={`افتراضي المكتب: ${officeImminent}`} />
            </Field>
          </div>
        </details>

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
              <Field label="نسبة الضريبة %">
                <input className="fld" type="number" value={d.vat_rate ?? 15} onChange={(e) => setD({ ...d, vat_rate: e.target.value })} />
              </Field>
              {/* «غير شاملة» لا يُعرض للإعداد الجديد: يجعل المسجَّل غير المقبوض
                  (العدّاد بالأساس والمستأجر يدفع الضريبة فوقه) وهو أكثر وضع ظهرت فيه
                  أخطاء. العقار المضبوط عليه أصلًا يبقى كما هو ويعمل صحيحًا. */}
              {initial?.vat_inclusive === false ? (
                <Field label="الإيجار الذي تكتبه في الوحدات">
                  <select className="fld" value={d.vat_inclusive === false ? "ex" : "in"}
                    onChange={(e) => setD({ ...d, vat_inclusive: e.target.value === "in" })}>
                    <option value="in">شاملة الضريبة</option>
                    <option value="ex">غير شاملة (تُضاف فوقها)</option>
                  </select>
                </Field>
              ) : (
                <Field label="الإيجار الذي تكتبه في الوحدات">
                  <div className="fld bg-paper text-muted text-sm">شاملة الضريبة — أدخل الإيجار كما يدفعه المستأجر</div>
                </Field>
              )}
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
      {/* كان رابطًا أحمر ملاصقًا لزرّي حفظ وإلغاء بلا فاصل — وحذف العقار
          يأخذ وحداته وعقوده ودفعاته. نفس معالجة «حذف الحساب» في الإعدادات:
          قسم مستقلّ بإطار وتحذير وتوجيه لتصدير نسخة أولًا. */}
      {onDelete && (
        <div className="mt-6 border border-[#F5C6C2] bg-[#FFF5F4] rounded-xl p-3.5">
          <div className="text-sm font-bold text-[#a5322c] mb-1">⚠️ منطقة خطرة</div>
          <p className="text-xs text-[#7a3b36] leading-relaxed mb-3">
            حذف العقار يأخذ معه كل وحداته وعقودها ودفعاتها ومصروفاتها وملاحظاتها — بلا رجعة.
            إن أردت نسخة، صدّرها أولًا من الإعدادات.
          </p>
          <button type="button" className="btn text-xs" style={{ background: "#a5322c", color: "#fff" }} onClick={onDelete}>
            حذف العقار نهائيًّا
          </button>
        </div>
      )}
    </Shell>
  );
}

function TenantModal({ open, initial, unitWord, error, saving, onClose, onSubmit, vatEnabled = false, property = null, payInfo = null }: {
  open: boolean; initial?: Tenant; unitWord: string; onClose: () => void; onSubmit: (d: any) => void;
  /** (جولة 4 · F1b) دفعات الوحدة: الكل، وما في المدة الحالية — null = لم تُقرأ */
  payInfo?: { any: number; inTerm: number } | null;
  /** العقار — ليُعرض المتأخر المستنتَج شاملًا الضريبة في وضع «مضافة فوق الإيجار» */
  property?: any;
  /** حقل ضريبة الوحدة يظهر فقط لعقار مفعّلة ضريبته — كان يظهر لكل عمارة سكنية */
  vatEnabled?: boolean;
  /** سبب فشل الحفظ — يُعرض بجانب الزر لا في أعلى الصفحة */
  error?: string | null;
  saving?: boolean;
}) {
  const [d, setD] = useState<any>(initial || { payment_frequency: "monthly", contract_start: today() });
  /* لقطة العدّادات لحظة الفتح — يقارن بها الحفظ ويحرس بها التزامن (30 سبتمبر 2026) */
  const [init0] = useState(() => initial ? { paid_periods: initial.paid_periods ?? null, carried_debt: (initial as any).carried_debt ?? null } : null);
  /* «عقد جديد يبدأ لاحقًا» — يؤكّده المكتب مرة فيختفي التنبيه */
  const [startIsNew, setStartIsNew] = useState(false);
  /**
   * «المستأجر ساكن الآن؟» — أول سؤال عند الإضافة، قبل التواريخ.
   *
   * مكتب عمرو باعبدالله أدخل «موعد الدفعة القادمة» في «بداية العقد» 33 مرة
   * رغم الشريط الأصفر وتأكيد الحفظ: كلاهما يأتي بعد أن اقتنع أن التاريخ صحيح،
   * و«موافق» هو الافتراضي. فالسؤال الآن قبل التاريخ، و«ساكن الآن» يرفض بداية
   * بعد اليوم بلا طريق للتجاوز — ويعرض له الدفعة القادمة محسوبة ليرى التاريخ
   * الذي كان سيكتبه في مكانه الصحيح. (15 من الـ33 كتبوا التاريخ نفسه في «البداية»
   * و«أول استحقاق» — فهموهما سؤالًا واحدًا.) التعديل لا يمرّ بهذا: حمايته v49.
   */
  /* «fresh»: ساكن من قبل، والقديم مسوّى خارج وثيق (عمارة ورثة بلا عقد إيجار مثلًا) —
     المتابعة من دفعته القادمة. كان المكتب مضطرًّا لاختيار «لم يسكن بعد» وهو ساكن. */
  const [occ, setOcc] = useState<"" | "current" | "new" | "fresh">("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [extraOpen] = useState(() => !!(initial && ((initial as any).first_due || (initial as any).national_id || Number((initial as any).carried_debt) > 0
    || (initial as any).contract_no || (initial as any).elec_account || (initial as any).water_account || (initial as any).meter_elec_in
    || (initial as any).meter_water_in || ((initial as any).vat_mode && (initial as any).vat_mode !== "auto"))));
  if (!open) return null;
  const preview = d.contract_start && d.rent_amount ? contractState({ ...d, paid_periods: d.paid_periods || 0 }) : null;
  /**
   * بداية في المستقبل بلا دفعات: في بيانات المكاتب الحقيقية 25 عقدًا من 216
   * (11%) — مكتب يبدأ مع وثيق في منتصف سنة العقد فيُدخل «موعد الدفعة
   * القادمة» في «بداية العقد» بعدّاد صفر. الأقساط القادمة تصحّ، لكن نهاية
   * العقد تُحسب سنة من الدفعة القادمة (فيطالب بأقساط بعد انتهائه الحقيقي)،
   * والكشف يقول «المسدَّد 0» لمستأجر منتظم منذ أشهر.
   */
  const startISO = String(d.contract_start || "").slice(0, 10);
  const askOcc = !initial && String(d.status) !== "vacated";
  const futureStartQ = !!startISO && startISO > today() && !(Number(d.paid_periods) > 0)
    && String(d.status) !== "vacated" && !startIsNew && !askOcc;
  const startTooLate = askOcc && occ === "current" && !!startISO && startISO > today();
  const dueGap = String(d.status) !== "vacated" ? firstDueGap(startISO, d.first_due ? String(d.first_due).slice(0, 10) : null) : null;
  /* جدول الأقساط بالبيانات الحالية — لقائمة «مسدَّد حتى» والمعاينة */
  const sched: { n: number; date: string; status: string }[] = d.contract_start && Number(d.rent_amount) > 0
    ? buildSchedule({ ...d, paid_periods: Number(d.paid_periods) || 0 } as any) : [];
  /* فارغ = سنة بدورة العقد، كما يقول شرح الخانة (كان 12 لكل الدورات: عقد ربع سنوي
     فارغ يُعرض إجماليه ثلاث سنوات) */
  const defPeriods = defaultTermPeriods((d.payment_frequency || "monthly") as Frequency) || 12;
  const totalValue = (Number(d.rent_amount) || 0) * (Number(d.contract_periods) || defPeriods);
  return (
    <Shell onClose={onClose}>
      <h2 className="font-display font-bold text-deep text-xl mb-1">{initial ? "تعديل الوحدة" : `${unitWord} جديدة`}</h2>
      {/**
        * وحدة شاغرة بلا مستأجر.
        *
        * كان النموذج يشترط اسم مستأجر، فمكتب يُدخل عمارة جديدة نصفها فارغ
        * لا يستطيع تسجيل الشواغر إلا باسم وهمي — فتختلط ببيانات حقيقية
        * ويُحسب لها إيجار. المفتاح يُسقط ما لا معنى له في الشاغرة ويُبقي
        * «الإيجار المطلوب» لأنه يفيد في عرض السعر وحساب الشغور.
        */}
      <label className="flex items-center gap-2.5 bg-paper border border-line rounded-xl p-3 mb-4 cursor-pointer">
        <input type="checkbox" className="w-4 h-4" checked={String(d.status) === "vacated"}
          onChange={(e) => setD({
            ...d,
            status: e.target.checked ? "vacated" : "active",
            ...(e.target.checked ? { paid_periods: 0, partial_amount: 0 }
              /* (جولة 4 · F1b) إلغاء علامة وُضعت بالخطأ في هذا النموذج نفسه يُعيد العدّادات كما فُتح —
                 كانت تبقى صفرًا فيُحفظ المستأجر المنتظم «لم يدفع شيئًا» */
              : initial && String(initial.status || "active") !== "vacated" ? { paid_periods: initial.paid_periods ?? 0, partial_amount: initial.partial_amount ?? 0 } : {}),
          })} />
        <span className="text-sm">
          <b className="text-deep">الوحدة شاغرة</b>
          <span className="text-muted"> — بلا مستأجر حاليًّا. سجّلها الآن وأجّرها لاحقًا بزر «تأجير».</span>
        </span>
      </label>
      {initial && String(initial.status || "active") === "vacated" && String(d.status) !== "vacated" && !!payInfo && payInfo.any > 0 && (
        /* (جولة 4 · F1b) شاغرة ← مؤجّرة من المربّع: مدة إيجار جديدة — تنبيه داخل النافذة لا منع */
        <div role="status" data-testid="unvacate-notice" className="-mt-2 mb-4 rounded-xl border border-[#EBD9AA] bg-[#FDF0DC] p-3 text-[12.5px] leading-relaxed text-[#7A4800]">
          <b>إلغاء «شاغرة» يبدأ مدة إيجار جديدة لهذه الوحدة:</b> عدّاد الدفعات يبدأ من الصفر، والدفعات المسجّلة سابقًا ({payInfo.any}) تبقى للمدة السابقة.
          {payInfo.inTerm > 0
            ? <> على المدة الحالية {payInfo.inTerm === 1 ? "دفعة مسجّلة" : `${payInfo.inTerm} دفعات مسجّلة`} — إن كان المقصود تصحيح بيانات العقد فأبقِ الوحدة كما هي وعدّل الحقول من «تعديل البيانات».</>
            : <> لمستأجر جديد استعمل «إعادة تأجير» من قائمة الوحدة — تحفظ المستأجر السابق ودينه.</>}
          <div className="mt-2"><button type="button" className="btn btn-ghost text-xs" onClick={() => setD({ ...d, status: "vacated" })}>أبقِها شاغرة</button></div>
        </div>
      )}
      <p className="text-sm text-muted mb-4">أدخل تاريخ البداية والدورة والقيمة — والنظام يستنتج بقية التواريخ والدفعات تلقائيًّا.</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={<>اسم المستأجر <span className="text-late" title="حقل مطلوب">*</span></>}>
            <input id="tenant-name" className={`fld ${String(d.status) !== "vacated" && !(d.name || "").trim() ? "border-late" : ""}`}
              value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <Field label={`رقم ${unitWord}`}><input className="fld" value={d.unit || ""} onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="101" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="قيمة الدفعة (ريال)" hint={(() => {
            const st = ({ monthly: 1, quarterly: 3, trimester: 4, semiannual: 6, annual: 12 } as any)[d.payment_frequency || "monthly"];
            const r = Number(d.rent_amount) || 0;
            return r > 0 && st ? `= ${sar(Math.round(r * 12 / st))} سنويًّا` : undefined;
          })()}><input className="fld" type="number" value={d.rent_amount || ""} onChange={(e) => setD({ ...d, rent_amount: e.target.value })} placeholder="2500" /></Field>
          <Field label="جوال المستأجر"><input className="fld" value={d.phone || ""} onChange={(e) => setD({ ...d, phone: e.target.value })} placeholder="05xxxxxxxx" /></Field>
        </div>
        <Field label="دورة السداد">
          <div className="grid grid-cols-3 gap-2">
            {FREQUENCIES.map((f) => (
              <button key={f.value} type="button" onClick={() => {
                const MO: Record<string, number> = { monthly: 1, quarterly: 3, trimester: 4, semiannual: 6, annual: 12 };
                const oldM = (Number(d.contract_periods) || 0) * (MO[d.payment_frequency || "monthly"] || 0);
                setD({ ...d, payment_frequency: f.value,
                  ...(oldM && MO[f.value] && oldM % MO[f.value] === 0 ? { contract_periods: oldM / MO[f.value] } : {}) });
              }}
                className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                  d.payment_frequency === f.value ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </Field>
        {askOcc && (
          <div className={`rounded-xl border p-3 ${occ ? "border-line bg-paper" : "border-[#F2D49B] bg-[#FFF6E5]"}`}>
            <div className="text-sm font-semibold text-deep mb-2">المستأجر ساكن في الوحدة الآن؟</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([["current", "نعم — أنقل وضعه", "ساكن، وأسجّل ما دفعه من عقده"],
                 ["fresh", "نعم — بداية جديدة", "ساكن، والقديم مسوّى عندي — أبدأ من دفعته القادمة"],
                 ["new", "لا — عقد جديد", "لم يسكن بعد، يبدأ لاحقًا"]] as const).map(([v, t, sub]) => (
                <button key={v} type="button" onClick={() => { setOcc(v); setLocalErr(null); if (v === "new" || v === "fresh") setD({ ...d, paid_periods: 0, partial_amount: 0 }); }}
                  className={`text-start rounded-lg border px-3 py-2 min-h-[44px] ${occ === v ? "border-gold bg-[#FBF1DF]" : "border-line bg-white hover:border-goldSoft"}`}>
                  <div className="text-sm font-semibold text-deep">{t}</div>
                  <div className="text-[11px] text-muted">{sub}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={askOcc && occ === "current" ? "بداية العقد في إيجار — قبل اليوم" : askOcc && occ === "fresh" ? "موعد دفعته القادمة" : "بداية العقد"}
            hint={askOcc && occ === "current" ? "من عقد إيجار نفسه — ليس موعد الدفعة القادمة"
              : askOcc && occ === "fresh" ? "من هنا يبدأ وثيق متابعته، وتنتهي المدة بعد «مدة العقد» منه" : undefined}>
          <DateField value={d.contract_start || ""} onChange={(v, mode) => setD({ ...d, contract_start: v,
            /* أدخل التاريخ بالهجري؟ إذن عقده هجري وأقساطه تُحسب بالأشهر الهجرية —
               كان يجب عليه تغيير خانة ثانية بنفسه، فينسى وتخرج الاستحقاقات منحرفة أيامًا */
            ...(mode ? { calendar: mode === "h" ? "hijri" : "gregorian", _calAuto: true } : {}) })} />
            {startTooLate && (
              <div className="text-[11.5px] text-late mt-1 leading-relaxed">
                هذا بعد اليوم — والمستأجر ساكن الآن، فعقده بدأ قبل اليوم. إن كان هذا <b>موعد الدفعة القادمة</b> فلا يُكتب هنا:
                اكتب بداية العقد من إيجار، ثم اختر من «مسدَّد حتى» آخر دفعة دفعها — والقادمة تُحسب تلقائيًّا.
              </div>
            )}</Field>
        <Field label="تُحسب الأقساط بالتقويم" hint={d._calAuto ? `ضُبط تلقائيًّا لأنك أدخلت البداية بالتقويم ${d.calendar === "hijri" ? "الهجري" : "الميلادي"} — غيّره إن كان العقد مكتوبًا بالتقويم الآخر` : "عقد مكتوب بالهجري (كل 6 أشهر هجرية) اختر هجري — وإلا يزحف الاستحقاق أيامًا كل قسط"}>
          <select className="fld" value={d.calendar || "gregorian"} onChange={(e) => setD({ ...d, calendar: e.target.value, _calAuto: false })}>
            <option value="gregorian">ميلادي — الأشهر الميلادية</option>
            <option value="hijri">هجري — الأشهر الهجرية (أم القرى)</option>
          </select>
        </Field>
          {/* «مدة العقد» لا «عدد الدفعات»: المكتب يعرف المدة من العقد، والعدد يُحسب منها —
              عقد سنة بدفع نصف سنوي = دفعتان حتمًا. «أخرى» للمدد غير المعتادة. */}
          {(() => {
            const MO: Record<string, number> = { monthly: 1, quarterly: 3, trimester: 4, semiannual: 6, annual: 12 };
            const f = (d.payment_frequency || "monthly") as Frequency; const st = MO[f] || 0;
            const n = Number(d.contract_periods) || 0;
            if (!st) return (   /* يومي/أسبوعي: المدة بالأشهر لا تنطبق — العدد مباشرة */
              <Field label="عدد الدفعات"><input className="fld" type="number" min={1} value={d.contract_periods || ""}
                onChange={(e) => setD({ ...d, contract_periods: e.target.value })} placeholder={String(defPeriods)} /></Field>);
            const months = (n || defPeriods) * st;
            const PRESETS = [6, 12, 24, 36].filter((m) => m % st === 0);
            const custom = d._durCustom || !PRESETS.includes(months);
            const dur = (m: number) => m % 12 === 0 ? plural(m / 12, "سنة", "سنتان", "سنوات", "سنة")
              : m < 12 ? plural(m, "شهر واحد", "شهران", "أشهر", "شهرًا")
              : `${plural(Math.floor(m / 12), "سنة", "سنتان", "سنوات", "سنة")} و${plural(m % 12, "شهر", "شهران", "أشهر", "شهرًا")}`;
            const cnt = n || defPeriods;
            const FW: Record<string, string> = { monthly: "شهرية", quarterly: "ربع سنوية", trimester: "كل 4 أشهر", semiannual: "نصف سنوية", annual: "سنوية" };
            const end = d.contract_start ? derivedEndDate(d.contract_start, f, cnt, null, d.calendar === "hijri" ? "hijri" : "gregorian") : null;
            return (
              <Field label="مدة العقد" hint={`= ${plural(cnt, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")} ${FW[f]}${end ? ` · ينتهي ${arDate(end)} (${end < startISO ? "⚠️ " : ""}${dateDistanceAr(startISO, end)})` : ""}`}>
                <select className="fld" value={custom ? "custom" : String(months)}
                  onChange={(e) => e.target.value === "custom" ? setD({ ...d, _durCustom: true })
                    : setD({ ...d, _durCustom: false, contract_periods: Number(e.target.value) / st })}>
                  {PRESETS.map((m) => <option key={m} value={m}>{dur(m)}</option>)}
                  <option value="custom">مدة أخرى…</option>
                </select>
                {custom && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <input className="fld" type="number" min={st} step={st} value={months}
                      onChange={(e) => { const m = Number(e.target.value) || 0; if (m > 0 && m % st === 0) setD({ ...d, _durCustom: true, contract_periods: m / st }); }} />
                    <span className="text-xs text-muted whitespace-nowrap">شهرًا{st > 1 ? ` (مضاعفات ${st})` : ""}</span>
                  </div>
                )}
              </Field>
            );
          })()}
        </div>
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
        {/* كان يظهر عند الإضافة فقط، فمن أخطأ في الرقم — أو استورده خطأً من
            إكسل — لا يستطيع تصحيحه من اللوحة إطلاقًا، وتبقى الوحدة تشير إلى
            دفعة خاطئة أبدًا. الآن يظهر في الحالتين بنصّ يناسب كلًّا منهما. */}
        {/* «مسدَّد حتى» بكلمات الموظف. كان العنوان «دفعات سُدّدت حتى اليوم» يسأل عن
            عدد والقائمة تحته تواريخ، والخيارات «الدفعة 3 — 2026-07-01» (مكتب: «قريتها
            وما فهمت»). وعقد جديد لم يُدفع فيه شيء لا يُسأل أصلًا. */}
        {askOcc && (occ === "new" || occ === "fresh") ? (
          <div className="text-[12px] text-muted rounded-lg bg-paper border border-line px-3 py-2">
            {occ === "fresh" ? "بداية جديدة — لا دفعات سابقة في وثيق؛ القديم يبقى في دفاترك." : "عقد جديد — لا دفعات سابقة."} إن استلمت دفعة عند التوقيع أو اليوم فسجّلها بعد الحفظ بزر ✔ «استلام».
          </div>
        ) : (
        <Field label="مسدَّد حتى: آخر دفعة دفعها المستأجر"
          hint={initial
            ? "لتصحيح خطأ فقط. الدفعة الجديدة تُسجَّل بزر ✔ «استلام» وتظهر هنا تلقائيًّا"
            : "اختر تاريخ آخر دفعة دفعها، ولو كانت قبل أن تبدأ مع وثيق — ووثيق يحسب منها القادمة والمتأخرة"}>
          {sched.length > 0 ? (
            <select className="fld" value={String(Number(d.paid_periods) || 0)}
              onChange={(e) => setD({ ...d, paid_periods: Number(e.target.value) })}>
              <option value="0">لم يدفع أي دفعة من هذا العقد</option>
              {sched.map((x) => {
                const ORD = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة", "الحادية عشرة", "الثانية عشرة"];
                const ord = ORD[x.n - 1] ? `${ORD[x.n - 1]} من ${sched.length}` : `${x.n} من ${sched.length}`;
                return (
                  <option key={x.n} value={x.n}>
                    {`دفعة ${arDate(x.date)}${d.calendar === "hijri" ? ` (${hijriShort(x.date)})` : ""} — ${ord}${x.date > today() ? " · مقدَّمًا" : ""}`}
                  </option>
                );
              })}
              {Number(d.paid_periods) > sched.length && (
                <option value={String(Number(d.paid_periods))}>{`${d.paid_periods} دفعات — أكثر من مدة العقد`}</option>
              )}
            </select>
          ) : initial ? (
            <input className="fld" type="number" min={0} value={d.paid_periods ?? ""}
              onChange={(e) => setD({ ...d, paid_periods: e.target.value })} placeholder="0" />
          ) : (
            <div className="text-[12px] text-muted rounded-lg bg-paper border border-line px-3 py-2">
              تظهر هنا تواريخ الدفعات بعد إدخال «بداية العقد» و«قيمة الدفعة» — اختر منها آخر دفعة دفعها.
            </div>
          )}
          {askOcc && occ === "current" && !startTooLate && preview && preview.nextDueDate && (
            <div className="text-[12px] mt-1.5 rounded-lg bg-paper border border-line px-3 py-2">
              الدفعة القادمة بحسب ما أدخلت: <b className="text-deep">{arDate(preview.nextDueDate)}</b>
              {(preview.daysToNextDue ?? 0) < 0 ? <span className="text-late"> (متأخرة)</span> : null}
              <span className="text-muted"> — إن لم يكن الموعد الذي تعرفه، راجع البداية أو «مسدَّد حتى».</span>
            </div>
          )}
          {futureStartQ && (
            <div className="bg-[#FFF6E5] border border-[#F2D49B] rounded-xl p-3 text-[12.5px] leading-relaxed mt-2">
              <b className="text-deep">بداية العقد بعد اليوم ({arDate(startISO)}).</b> هل هو عقد جديد يبدأ في هذا التاريخ، أم عقد ساري من قبل؟
              <div className="mt-1.5">
                <b>عقد ساري:</b> اكتب في «بداية العقد» تاريخ بدايته الفعلي من العقد نفسه — <b>لا موعد الدفعة القادمة</b> —
                ثم اختر هنا آخر دفعة سدّدها. الدفعة القادمة ونهاية العقد تُحسبان تلقائيًّا.
              </div>
              <button type="button" className="btn btn-ghost text-xs mt-2" onClick={() => setStartIsNew(true)}>
                نعم، عقد جديد يبدأ في هذا التاريخ</button>
            </div>
          )}
          {Number(d.paid_periods) > 0 && Number(d.contract_periods) > 0 && (
            <span className="block text-[11px] text-muted mt-1">
              {Number(d.paid_periods) > Number(d.contract_periods)
                ? `⚠️ أكبر من مدة العقد (${d.contract_periods} دفعة) — سداد مقدَّم لمدة قادمة؟`
                : `المتبقي ${Number(d.contract_periods) - Number(d.paid_periods)} دفعة من ${d.contract_periods}`}
            </span>
          )}
        </Field>
        )}
        {/* «تفاصيل إضافية» مطويّة: ما لا يُملأ عادةً عند الإدخال الأول — كان النموذج
            عشرين حقلًا دفعة واحدة. تنفتح وحدها إن كان فيها بيانات، فلا يُخفى شيء. */}
        <details open={extraOpen} className="mt-3 border border-line rounded-xl p-3 bg-paper">
          <summary className="cursor-pointer text-sm font-semibold text-deep">تفاصيل إضافية
            <span className="text-xs text-muted font-normal"> — اختيارية: رقم العقد، الهوية، دين سابق{vatEnabled ? "، الضريبة" : ""}، الكهرباء والماء</span></summary>
          <div className="space-y-3 mt-3">
          <Field label="رقم العقد" hint="رقمه لديكم أو في «إيجار» — يظهر في كشوف الحساب والخطابات"><input className="fld" dir="ltr" value={d.contract_no || ""} onChange={(e) => setD({ ...d, contract_no: e.target.value })} /></Field>
          <Field label="رقم الهوية / السجل" hint="للخطابات"><input className="fld" value={d.national_id || ""} onChange={(e) => setD({ ...d, national_id: e.target.value })} /></Field>
          <Field label="دين مرحَّل (ريال)" hint="متأخرات من عقد سابق أو مستأجر سابق — تظهر في الكشوف ولا تدخل في دفعات العقد الجاري">
            <input className="fld" type="number" min={0} value={d.carried_debt ?? ""} onChange={(e) => setD({ ...d, carried_debt: e.target.value })} placeholder="0" />
          </Field>
            <Field label="أول تاريخ استحقاق" hint="اتركه فارغًا إن كان المستأجر يدفع يوم بداية العقد — وهذا أغلب العقود. املأه فقط إن كانت أول دفعة في يوم آخر (يبدأ 1/1 والدفعة الأولى 5/1)">
              <DateField value={d.first_due || ""} onChange={(v) => setD({ ...d, first_due: v })}
                relative={{ from: startISO, warn: firstDueOutOfRange(startISO, d.first_due, d.payment_frequency, d.calendar) }} />
              {dueGap && (
                /* (30 سبتمبر 2026) مكتبان كتبا هنا تاريخًا لمستأجر يدفع يوم بداية العقد،
                   فانزاح يوم الدفع الشهري كله. نقول الأثر بالأرقام قبل الحفظ. */
                <div className="mt-2 rounded-lg border border-[#F2D49B] bg-[#FFF6E5] p-2.5 text-[12.5px] leading-relaxed">
                  <b>انتبه:</b> أول دفعة {dueGap.days > 0 ? `بعد ${daysAr(dueGap.days)}` : `قبل ${daysAr(-dueGap.days)}`} من بداية العقد
                  {dueGap.months >= 2 ? <> (قرابة <b>{plural(dueGap.months, "شهر واحد", "شهرين", "أشهر", "شهرًا")}</b>)</> : null}
                  {dueGap.dueDay !== dueGap.startDay ? <>، ويوم الدفع الشهري سيصير <b>{dueGap.dueDay}</b> بدل {dueGap.startDay}</> : null}.
                  <div className="mt-1">إن كان المستأجر يدفع يوم بداية العقد:
                    <button type="button" className="underline underline-offset-4 font-semibold ms-1" onClick={() => setD({ ...d, first_due: "" })}>امسح هذا التاريخ</button>
                  </div>
                </div>
              )}
            </Field>
            {vatEnabled && (
          <Field label="ضريبة القيمة المضافة لهذه الوحدة" hint="العمارة المختلطة: السكني معفى والتجاري خاضع — «تلقائي» يقرّر بحسب نوع الوحدة">
            <select className="fld" value={d.vat_mode || "auto"} onChange={(e) => setD({ ...d, vat_mode: e.target.value })}>
              <option value="auto">تلقائي — بحسب نوع الوحدة</option>
              <option value="on">تُطبَّق دائمًا</option>
              <option value="off">معفاة</option>
            </select>
          </Field>
            )}
          </div>
          <div className="text-[11px] font-semibold text-muted mt-3">⚡ المرافق</div>
          <div className="grid sm:grid-cols-2 gap-3 mt-1.5">
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
              {(preview.daysToNextDue ?? 0) < 0 && preview.amountDue > 0 && (
                <div>متأخر منذ: <b className="text-late">{arDate(preview.nextDueDate)}</b> · {sar(withVat(preview.amountDue, d, property))} ريال</div>
              )}
              <div>الدفعة القادمة: <b className="text-ink">{preview.upcomingDate
                ?? (preview.upcomingDate === null ? "لا دفعات قادمة" : preview.nextDueDate)}</b></div>
              <div>نهاية العقد: <b className="text-ink">{arDate(preview.endDate)}</b></div>
              <div>إجمالي قيمة العقد: <b className="text-ink">{sar(totalValue)} ريال</b></div>
            </div>
            {sched.length > 0 && (() => {
              /* جدول الأقساط كما سيحسبه وثيق — صاحب المكتب يحكم عليه بالنظر قبل الحفظ */
              const paidN = Math.min(Number(d.paid_periods) || 0, sched.length);
              const lateN = sched.filter((x) => x.status === "late").length;
              const ICON: Record<string, [string, string]> = {
                paid: ["✓", "bg-[#E6F4EC] border-[#BFE3CD] text-[#137a50]"], partial: ["◐", "bg-[#FFF6E5] border-[#F2D49B] text-[#8a5a11]"],
                late: ["⚠", "bg-[#FBE9E7] border-[#F5C6C2] text-[#a5322c]"], upcoming: ["○", "bg-white border-line text-muted"] };
              return (
                <div className="mt-2.5 border-t border-line pt-2">
                  <div className="text-xs text-ink leading-relaxed">
                    <b>بهذه البيانات:</b>{" "}
                    {paidN > 0 ? `مسدَّد حتى دفعة ${sched[paidN - 1].date}` : "لم يُسدَّد شيء من هذا العقد"}
                    {lateN > 0 ? ` · حلّ ولم يُسدَّد ${lateN} ${lateN === 1 ? "دفعة" : lateN === 2 ? "دفعتان" : "دفعات"}` : " · لا متأخرات"}
                    {preview.upcomingDate ? ` · القادمة ${arDate(preview.upcomingDate)}` : ""}
                    {` · ينتهي العقد ${arDate(preview.endDate)}`}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {sched.slice(0, 24).map((x) => (
                      <span key={x.n} className={`text-[10.5px] px-1.5 py-0.5 rounded border tabular-nums ${ICON[x.status]?.[1] || ""}`}
                        title={`الدفعة ${x.n} — ${x.date}`}>{ICON[x.status]?.[0]} {x.date.slice(2)}</span>
                    ))}
                    {sched.length > 24 && <span className="text-[10.5px] text-muted">… {sched.length - 24} أخرى</span>}
                  </div>
                  <div className="text-[10.5px] text-muted mt-1">✓ مسدَّد · ◐ جزئي · ⚠ حلّ ولم يُسدَّد · ○ قادم</div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
      {/* سبب الفشل بجانب الزر: الإشعار العائم في أعلى الصفحة لا يراه من كان
          منزلًا داخل النموذج على الجوال، فيظن أن الزر لا يعمل. */}
      {(localErr || error) && (
        <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mt-4 leading-relaxed">
          <b>لم يُحفظ:</b> {localErr || error}
        </div>
      )}
      <div className="flex gap-2 mt-6">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={(String(d.status) !== "vacated" && !(d.name || "").trim()) || !!saving}
          title={String(d.status) !== "vacated" && !(d.name || "").trim() ? "أدخل اسم المستأجر أولًا" : "حفظ"}
          /* كان يتجاهل الشاغرة: الزرّ يعمل (disabled صحيح) لكنه يبدو
             معطّلًا بشفافية 50% ومؤشر «ممنوع» — فلا يضغطه أحد. المظهر
             يتبع الشرط نفسه الذي يتبعه التعطيل. */
          style={String(d.status) !== "vacated" && !(d.name || "").trim()
            ? { opacity: .5, cursor: "not-allowed" } : undefined}
          onClick={() => {
            if (askOcc && !occ) { setLocalErr("اختر أولًا: المستأجر ساكن في الوحدة الآن، أم عقد جديد لم يبدأ؟"); return; }
            if (startTooLate) { setLocalErr(`بداية العقد ${arDate(startISO)} بعد اليوم، والمستأجر ساكن الآن. اكتب تاريخ بداية العقد من إيجار — لا موعد الدفعة القادمة.`); return; }
            setLocalErr(null);
            /* أول استحقاق يختلف عن البداية: سؤال عند إدخاله أو تغييره فقط — لا في كل
               حفظ لبيانات راجعها المكتب من قبل. */
            if (dueGap && d.first_due !== (initial as any)?.first_due && !confirm(
              `أول استحقاق ${arDate(d.first_due)} يختلف عن بداية العقد ${arDate(d.contract_start)}`
              + (dueGap.dueDay !== dueGap.startDay ? `، فيصير يوم الدفع الشهري ${dueGap.dueDay} بدل ${dueGap.startDay}` : "") + `.\n\n`
              + `موافق = نعم، أول دفعة فعلًا في هذا التاريخ.\n`
              + `إلغاء = سأراجع (إن كان يدفع يوم بداية العقد فامسح «أول استحقاق»).`)) return;
            if (futureStartQ && !confirm(`بداية العقد ${arDate(startISO)} بعد اليوم، ولا دفعات مسدَّدة.\n\n`
              + `موافق = عقد جديد يبدأ في هذا التاريخ — احفظ.\n`
              + `إلغاء = عقد ساري من قبل — سأكتب بدايته الفعلية وآخر دفعة سُدّدت.`)) return;
            onSubmit(init0 ? { ...d, _init: init0 } : d);
          }}>حفظ</button>
      </div>
      {String(d.status) !== "vacated" && !(d.name || "").trim() && (
        /* الزر في أسفل نموذج من خمسة عشر حقلًا والحقل في أعلاه — فمن يصل
           للأسفل ويجده رماديًّا لا يعرف السبب. الآن ينقله السطر إليه. */
        <p className="text-xs text-late mt-3 text-center">
          <button type="button" className="underline underline-offset-4 font-semibold"
            onClick={() => { const el = document.getElementById("tenant-name"); el?.scrollIntoView({ behavior: "smooth", block: "center" }); (el as HTMLInputElement)?.focus(); }}>
            اسم المستأجر مطلوب — اضغط للانتقال إليه
          </button>
        </p>
      )}
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

function OwnerReportModal({ property, unitWord, issuer, onClose, db }: {
  property: Property; unitWord: string; issuer: any; onClose: () => void; db?: any;
}) {
  const supabase: any = db || createClient();
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
    /* على دفعات: Supabase يقصّ عند 1000 صف بصمت (limit(5000) لا يتجاوزه) — فعقار
       بسنتين من الدفعات كان تقريره «كامل الفترة» ناقصًا. ورابط المالك العام كان
       مصحَّحًا من قبل، فيرى المالك رقمًا والمكتب رقمًا آخر للتقرير نفسه. */
    let data: any[] = [], expenses: ExpenseRow[] = [], allPaysRows: any[] = [];
    try {
      [data, expenses, allPaysRows] = await Promise.all([
        fetchAllRows(supabase as any, "payments", "*",
          (q) => q.eq("property_id", property.id).gte("paid_on", from).lte("paid_on", to).order("paid_on", { ascending: true })),
        /* المصروفات تفشل بصوت: كان فشلها يُصدر التقرير بلا خصومات — صافٍ أعلى من الحقيقة للمالك */
        fetchAllRows<ExpenseRow>(supabase as any, "expenses", "*",
          (q) => q.eq("property_id", property.id).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: true })),
        fetchAllRows(supabase as any, "payments", "*", (q) => q.eq("property_id", property.id).not("tenant_id", "is", null)),
      ]);
    } catch (e: any) { setLoading(false); setErr(e?.message || "تعذّر تحميل بيانات التقرير"); return; }
    setLoading(false);

    const byId: Record<string, Tenant> = {};
    (property.tenants || []).forEach((t) => { byId[t.id] = t; });
    const payments: OwnerReportPayment[] = data.map((x: any) => ({
      id: x.id, paid_on: x.paid_on, amount: x.amount, method: x.method, reference: x.reference, created_at: x.created_at,
      periods_covered: x.periods_covered, note: x.note, tenant_id: x.tenant_id, past_tenancy_id: x.past_tenancy_id,
      tenant_name: (x.tenant_id && byId[x.tenant_id]?.name) || x.payer_name || null,
      unit: (x.tenant_id && byId[x.tenant_id]?.unit) || x.unit_label || null,
    }));


    /* أقساط كل ساكن في مدته (كل الأوقات) — لملاحظة الرصيد الافتتاحي؛ وإعدادات
       ضريبة المستأجرين السابقين — لضريبة دفعاتهم. بخطأ جلبٍ يُصدَر التقرير
       بلا الملاحظة وبالإعدادات الحالية (لا برقم خاطئ في الملاحظة). */
    const pastQ = await supabase.from("past_tenancies").select("id, snapshot").eq("property_id", property.id).limit(1000);
    const termRentPaid = termRentPaidOf(property.tenants as any, allPaysRows as any);
    const pastVat = pastQ.error ? undefined : pastVatOf(pastQ.data as any);
    openDoc(ownerReportHTML(property as any, { label, from, to }, payments, issuer || {},
      { expenses, fee_pct: (property as any).mgmt_fee_pct, termRentPaid, pastVat }, mode));
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
              const perYear = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, trimester: 3, semiannual: 2, annual: 1 }[
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

        {/* «الدفعات المسدَّدة» أزيلت من عرض السعر: مستأجر محتمل لم يوقّع لم يدفع شيئًا، والمستند لا يستعملها — كانت منسوخة من نموذج الوحدة. */}

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
  onRenew: (o: { periods: number; newAmount: number | null; newFrequency: Frequency }) => void | Promise<unknown>;
}) {
  const cur = contractState(tenant);
  const curFreq = (tenant.payment_frequency || "monthly") as Frequency;
  const [freq, setFreq] = useState<Frequency>(curFreq);
  const [periods, setPeriods] = useState<string>(String(tenant.contract_periods || defaultTermPeriods(curFreq)));
  const [durCustom, setDurCustom] = useState(false);   // «مدة أخرى…» اختيار يُحفظ، لا يُستنتج من المدة
  /* تغيير الدورة يحفظ المدة لا العدد: شهري ×12 ← سنوي كان يبقى 12 = اثنتا عشرة سنة */
  const MONTHS_PER: Record<string, number> = { monthly: 1, quarterly: 3, trimester: 4, semiannual: 6, annual: 12 };
  function changeFreq(f: Frequency) {
    const oldM = (Number(periods) || defaultTermPeriods(freq)) * (MONTHS_PER[freq] || 0);
    if (oldM && MONTHS_PER[f]) setPeriods(String(Math.max(1, Math.round(oldM / MONTHS_PER[f]))));
    setFreq(f);
  }
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
          {" "}{cur.daysToEnd !== null && cur.daysToEnd >= 0 ? `متبقٍ ${plural(cur.daysToEnd, "يوم واحد", "يومان", "أيام", "يومًا")}` : "منتهية"}
        </div>
      </div>

      <div className="space-y-3">
        <Field label="دورة السداد للمدة الجديدة">
          <div className="grid grid-cols-3 gap-2">
            {FREQUENCIES.map((f) => (
              <button key={f.value} type="button" onClick={() => changeFreq(f.value)}
                className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                  freq === f.value ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {/* «مدة العقد الجديد» لا «عدد الدفعات» — كنموذج الوحدة: المكتب يعرف المدة،
              والعدد يُحسب منها. «مدة أخرى» للمدد غير المعتادة. */}
          {(() => {
            const st = MONTHS_PER[freq] || 0;
            const n = Number(periods) || defaultTermPeriods(freq);
            if (!st) return <Field label="عدد الدفعات"><input className="fld" type="number" value={periods} onChange={(e) => setPeriods(e.target.value)} /></Field>;
            const months = n * st;
            const PRESETS = [6, 12, 24, 36].filter((m) => m % st === 0);
            const custom = durCustom || !PRESETS.includes(months);
            const dur = (m: number) => m % 12 === 0 ? plural(m / 12, "سنة", "سنتان", "سنوات", "سنة") : plural(m, "شهر واحد", "شهران", "أشهر", "شهرًا");
            return (
              <Field label="مدة العقد الجديد" hint={`= ${plural(n, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")}`}>
                <select className="fld" value={custom ? "custom" : String(months)}
                  onChange={(e) => { if (e.target.value === "custom") { setDurCustom(true); return; } setDurCustom(false); setPeriods(String(Number(e.target.value) / st)); }}>
                  {PRESETS.map((m) => <option key={m} value={m}>{dur(m)}</option>)}
                  <option value="custom">{custom ? `مدة أخرى: ${dur(months)}` : "مدة أخرى…"}</option>
                </select>
                {custom && (
                  <input className="fld mt-1.5" type="number" min={st} step={st} value={months}
                    onChange={(e) => { const m = Number(e.target.value) || 0; if (m > 0 && m % st === 0) setPeriods(String(m / st)); }} />
                )}
              </Field>
            );
          })()}
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
          /* يعود الزرّ إن توقّف التجديد (إلغاء سؤال أو خطأ) — كان يبقى «...» معطّلًا */
          onClick={() => { setBusy(true); Promise.resolve(onRenew({ periods: Number(periods), newAmount: Number(amount) || null, newFrequency: freq })).finally(() => setBusy(false)); }}>
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
function RemindAllModal({ rows, unitWord, linkOf, onClose, demo = false, dueOf = (r) => r.st.amountDue }: {
  rows: Row[]; unitWord: string; linkOf: (t: Tenant) => string; onClose: () => void;
  /** المتأخر كما في الرسالة نفسها (شاملًا الضريبة) — كانت القائمة تقول 30,000 والرسالة 34,500 */
  dueOf?: (r: Row) => number;
  /** التجربة: مستأجروها بلا أرقام (عمدًا — لا رقم حقيقي يُراسَل بالخطأ)، فنعرض الرسالة الجاهزة نفسها */
  demo?: boolean;
}) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<string | null>(null);
  const textOf = (t: Tenant) => { try { return new URL(linkOf(t)).searchParams.get("text") || ""; } catch { return ""; } };
  if (demo) return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">💬 تذكير جماعي بالسداد</h3>
        <p className="text-sm text-muted mb-4">
          لكل متأخر رسالة جاهزة بمبلغه ودفعاته وتواريخها. في حسابك يفتح كل زر محادثة واتساب مع المستأجر
          والرسالة مكتوبة — ترسلها بضغطة وتنتقل للتالي. في التجربة المستأجرون بلا أرقام، فاعرض الرسالة كما ستصله:
        </p>
        <div className="flex flex-col gap-2">
          {rows.map(({ t, st }) => (
            <div key={t.id} className="rounded-xl border border-line bg-paper p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate text-sm">{t.name}</div>
                  <div className="text-xs text-muted">{unitWord} {t.unit || "—"} · {countAr(st.unpaid, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")} · {sar(dueOf({ t, st } as Row))} ريال</div>
                </div>
                <button type="button" className="btn btn-wa text-xs" onClick={() => setShown(shown === t.id ? null : t.id)}>
                  {shown === t.id ? "إخفاء" : "عرض الرسالة"}
                </button>
              </div>
              {shown === t.id && (
                <div className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed rounded-lg bg-[#E7F7EE] border border-[#B7DFC7] p-3">{textOf(t)}</div>
              )}
            </div>
          ))}
          {!rows.length && <div className="text-center text-muted text-sm py-6">لا متأخرين في هذا العقار الآن.</div>}
        </div>
        <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
      </div>
    </div>
  );
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
                <div className="text-xs text-muted">{unitWord} {t.unit || "—"} · {countAr(st.unpaid, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")} · {sar(dueOf({ t, st } as Row))} ريال</div>
              </div>
              {sent[t.id] && <span className="text-xs font-bold text-paid">✓ أُرسل</span>}
              <a href={linkOf(t)} target="_blank" rel="noreferrer" className="btn btn-wa text-xs"
                /* openExternal كأزرار الصفوف — رابط عادي داخل تطبيق تليجرام يُفسد العربية بترميز مزدوج */
                onClick={(e) => { e.preventDefault(); openExternal(linkOf(t)); setSent((s) => ({ ...s, [t.id]: true })); }}>فتح واتساب</a>
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
