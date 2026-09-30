"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, daysLeft, waLink, WATHEQ_WA, today, openExternal, daysAr, csvCell, countAr as countWord } from "@/lib/utils";
import { ownerStatementHTML, associationStatementHTML, budgetHTML, foundingMinutesHTML,
  renewalMinutesHTML, DEFAULT_BUDGET_ITEMS, openDoc, hoaQuorum, foundingMinutesPortalHTML, renewalMinutesPortalHTML,
  type BudgetItem, type HoaAttendance } from "@/lib/documents";
import HoaExpensesPanel from "@/components/HoaExpensesPanel";
import { feeOf, periodOf, basisOf, PERIOD_WORDS, periodsAr, ownerDueAt, shareFee, sharesSum, sharesValid,
  sharesFromAreas, MONTHS_AR, r2, ownerBalance, splitBalance, riyalsAr, ownersAr, type FeePeriod } from "@/lib/hoaMoney";
import { hijriText } from "@/lib/hijri";
import { arDate } from "@/lib/documents";
import DateField from "@/components/DateField";
import { MemberLinkButton, HoaDocumentsPanel, type HoaDocPrefill } from "@/components/HoaMemberPanel";
import { renderReceiptPage } from "@/lib/hoaPortal";
import { Overlay, useEscape, InfoTip, Amt, GuideCard, SendLinksModal, ClaimsModal, MullakModal, MullakToggle, RequestsPanel,
  type GuideStep, type Claim, type MullakPay, type HoaRequest, type RequestLog } from "@/components/HoaRound3";
import { moneySigned } from "@/lib/hoaMoney";

type Owner = { opening_set?: boolean | null; id: string; name: string; unit: string | null; phone: string | null; months_late: number; last_paid: string | null; partial_amount?: number | null; prepaid_months?: number | null;
  /** v63: رسم خاص (من الحصة)، الحصة ٪، المساحة م² */
  fee_override?: number | null; share_pct?: number | null; area_m2?: number | null };
type Note = { id: string; note_date: string; text: string };
type Association = {
  id: string; name: string; units: number; fee: number;
  cert_expiry: string | null; fund_balance: number; grace_days?: number | null;
  auto_accrue?: boolean | null;
  bank_name?: string | null; bank_account_name?: string | null; iban?: string | null;
  /** v62/v63/v64 */
  archived_at?: string | null; mullak_reg_no?: string | null; unified_no?: string | null;
  quorum_first_pct?: number | null; quorum_second_pct?: number | null;
  public_token?: string | null; fee_basis?: string | null; fee_period?: string | null;
  total_budget?: number | null; fiscal_start_month?: number | null;
  owners: Owner[]; association_notes: Note[];
};
/** حقول v64 (رقم التسجيل، الرقم الموحّد، النصاب) التي تغيّرت فقط */
function v64Patch(d: any, cur: any): Record<string, any> {
  const out: Record<string, any> = {};
  const txt = (v: any) => (String(v ?? "").trim() || null);
  if (d.mullak_reg_no !== undefined && txt(d.mullak_reg_no) !== txt(cur?.mullak_reg_no)) out.mullak_reg_no = txt(d.mullak_reg_no);
  if (d.unified_no !== undefined && txt(d.unified_no) !== txt(cur?.unified_no)) out.unified_no = txt(d.unified_no);
  if (d.quorum_first_pct !== undefined && d.quorum_first_pct !== "" && Number(d.quorum_first_pct) !== Number(cur?.quorum_first_pct ?? 75)
      && Number(d.quorum_first_pct) > 0 && Number(d.quorum_first_pct) <= 100) out.quorum_first_pct = Number(d.quorum_first_pct);
  if (d.quorum_second_pct !== undefined && (d.quorum_second_pct ?? null) !== (cur?.quorum_second_pct ?? null)) out.quorum_second_pct = d.quorum_second_pct ?? null;
  return out;
}
/** رسالة موحّدة لأخطاء القاعدة */
const dbErr = (m: string, v = "v63") => /not authorized/.test(m) ? "هذا الإجراء لمدير المكتب — اطلبه من صاحب المكتب."
  : /Could not find|does not exist|schema cache/.test(m) ? `قاعدة البيانات تحتاج تحديث (schema-${v}) — لم يُنفَّذ الإجراء.` : m;

/** أخطاء حذف المالك بالعربية — لا تظهر رسالة القاعدة الإنجليزية للموظف */
const ownerDeleteErr = (m: string, code = "") =>
  /not authorized|permission denied/i.test(m) || code === "42501" ? "حذف المالك يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."
  : /payments_has_subject/i.test(m) ? "تعذّر الحذف: قاعدة البيانات تحتاج تحديث (schema-v65). لم يُحذف شيء وبقيت دفعاته."
  : /foreign key|violates|constraint/i.test(m) || code === "23503" || code === "23514" ? "لا يمكن حذف هذا المالك لارتباطه بسجلات أخرى — لم يُحذف شيء."
  : /Failed to fetch|NetworkError|network/i.test(m) ? "تعذّر الاتصال — تحقّق من الإنترنت ثم أعد المحاولة. لم يُحذف شيء."
  : "تعذّر حذف المالك الآن — لم يُحذف شيء. أعد المحاولة بعد قليل.";

/** الآيبان: أرقام عربية ← لاتينية، بلا مسافات، أحرف كبيرة */
const normIban = (v?: string | null) => String(v || "")
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6F0))
  .replace(/[\s-]+/g, "").toUpperCase();
const ibanOk = (v?: string | null) => /^SA[0-9]{22}$/.test(normIban(v));
/** حقول البنك للحفظ — آيبان غير مكتمل لا يُرسل (القاعدة ترفضه) */
const bankFields = (d: any) => ({
  bank_name: String(d.bank_name || "").trim() || null,
  bank_account_name: String(d.bank_account_name || "").trim() || null,
  iban: d.iban && ibanOk(d.iban) ? normIban(d.iban) : null,
});

/** دفعة الإشعار الأخير — لأزرار «تراجع» و«إرسال السند» */
type ToastPay = { payment_id: string; owner: Owner; receipt_no?: string | null; amount: number; paid_on?: string | null };

/** حالة المالك المعروضة */
type OwnerKey = "critical" | "late" | "partial" | "ok";
const OWNER_META: Record<OwnerKey, { label: string; dot: string; cls: string }> = {
  critical: { label: "متأخر 3+", dot: "bg-late", cls: "bg-[#F7DAD7] text-[#8f2b26]" },
  late:     { label: "متأخر", dot: "bg-late", cls: "bg-[#FBE9E7] text-[#a5322c]" },
  partial:  { label: "دفع جزءًا", dot: "bg-[#EA8C00]", cls: "bg-[#FDF0DC] text-[#9A5B00]" },
  ok:       { label: "لا متأخرات", dot: "bg-paid", cls: "bg-[#E6F4EC] text-[#137a50]" },
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
  const [activeId, setActiveId] = useState<string | null>((initial.find((x) => !x.archived_at) || initial[0])?.id || null);
  const [modal, setModal] = useState<null | "new" | "edit">(null);
  const [busy, setBusy] = useTransition();

  // ---------- أدوات العرض: بحث / تصفية / فرز / إشعار ----------
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "due" | OwnerKey>("all");
  const [sort, setSort] = useState<"urgent" | "amount" | "name" | "unit">("urgent");
  const [paying, setPaying] = useState<Owner | null>(null);
  const [doc, setDoc] = useState<null | { title: string; body: string; kind?: "notice" | "final" | "file"; owner?: Owner; label?: string }>(null);
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
  const [toast, setToast] = useState<null | { k: "ok" | "err"; m: string; pay?: ToastPay; confirmUndo?: boolean }>(null);
  /** قفل متزامن لكل مالك: ضغطتان متتاليتان قبل إعادة الرسم لا تسجّلان دفعتين */
  const payLock = useRef<Set<string>>(new Set());
  const [payBusy, setPayBusy] = useState<Record<string, boolean>>({});
  /** تبويبات الجمعية (جولة 3): الملاك · المستندات · الصندوق · طلبات الصيانة · سجل العمارة — لا شيء يدفع قائمة الملاك لأسفل */
  type Tab = "owners" | "docs" | "fund" | "requests" | "log";
  const [tab, setTab] = useState<Tab>("owners");
  const setDocsOpen = (v: boolean) => setTab(v ? "docs" : "owners");
  /** v66: الحوالات المُبلَّغ عنها · طلبات الصيانة · روابط الملاك · علامة «ملاك» */
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [reqRows, setReqRows] = useState<HoaRequest[] | null>(null);
  const [reqLogs, setReqLogs] = useState<RequestLog[]>([]);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqExpenses, setReqExpenses] = useState<{ id: string; label: string }[]>([]);
  const [linkCounts, setLinkCounts] = useState<null | { owners: number; linked: number; seen: number }>(null);
  /** F4: هل طُبّق schema-v66؟ (null = لم يُعرف بعد). قبل تطبيقه تُخفى الحوالات وطلبات الصيانة وعلامة «ملاك» */
  const [v66, setV66] = useState<boolean | null>(null);
  const [sendLinks, setSendLinks] = useState(false);
  const [mullak, setMullak] = useState<null | { rows: MullakPay[] | null; loading: boolean }>(null);
  const addOwnerRef = useRef<HTMLInputElement>(null);
  const [sharesOpen, setSharesOpen] = useState(false);
  /** v64: المؤرشفة مخفية افتراضيًّا */
  const [showArchived, setShowArchived] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [noteAsk, setNoteAsk] = useState<string | null>(null);
  const [docPrefill, setDocPrefill] = useState<HoaDocPrefill | null>(null);
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
  /* الإشعار: 3.6 ثانية عادةً، و8 ثوانٍ لإشعار الدفعة (فيه «تراجع» و«إرسال السند») */
  const toastTimer = useRef<any>(null);
  function notify(k: "ok" | "err", m: string, pay?: ToastPay) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ k, m, pay });
    toastTimer.current = setTimeout(() => setToast(null), pay ? 8000 : 3600);
  }
  const holdToast = () => { if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 12000); };
  /** آخر رصيد بعد كل دفعة كما أعادته القاعدة — لسطر «الرصيد بعد هذه الدفعة» في السند فقط حين يُعرف */
  const afterPay = useRef<Record<string, { late: number; partial: number; prepaid: number; fee: number }>>({});

  const visibleItems = useMemo(() => items.filter((x) => showArchived || !x.archived_at || x.id === activeId), [items, showArchived, activeId]);
  const archivedCount = items.filter((x) => x.archived_at).length;
  const liveItems = useMemo(() => items.filter((x) => !x.archived_at), [items]);
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
      if (filter === "due") { if (!(o.months_late > 0)) return false; }
      else if (filter !== "all" && ownerKey(o) !== filter) return false;
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


  /**
   * تسجيل مبلغ مستلم من مالك — عملية واحدة في القاعدة (schema-v60):
   * تحدّث المتأخرات/الجزئي/المقدَّم والصندوق، وتُصدر سند قبض مرقَّمًا.
   * amount = null ⇒ «سدّد الكل»: القاعدة تحسب المستحق بالضبط وقت التنفيذ.
   * p_request يمنع تكرار الدفعة إن أُعيد إرسال الطلب نفسه.
   */
  async function recordOwnerPayment(o: Owner, amount: number | null,
    opts: { method?: string; note?: string; paidOn?: string; reference?: string; request?: string } = {}): Promise<boolean> {
    if (!active) return false;
    if (!(feeOf(o, active) > 0)) { notify("err", "حدّد قيمة الاشتراك في إعدادات الجمعية أولًا."); return false; }
    const amt = amount == null ? null : Math.round((Number(amount) || 0) * 100) / 100;
    if (amt !== null && !(amt > 0)) return false;
    if (payLock.current.has(o.id)) return false;
    payLock.current.add(o.id);
    setPayBusy((b) => ({ ...b, [o.id]: true }));
    const assocId = active.id;
    const req = opts.request || (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function" ? (crypto as any).randomUUID() : null);
    try {
      const { data, error } = await supabase.rpc("watheq_record_owner_payment", {
        p_owner: o.id, p_amount: amt, p_method: opts.method || "transfer", p_note: opts.note || null,
        p_paid_on: opts.paidOn || null, p_reference: opts.reference || null, p_request: req,
      });
      if (error) {
        const m = String(error.message || "");
        notify("err", /not authorized/.test(m) ? "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."
          : /Could not find|does not exist|schema cache/.test(m) ? "قاعدة البيانات تحتاج تحديث (schema-v60) — لم تُسجَّل الدفعة." : m);
        return false;
      }
      const r = data as { months_late: number; partial_amount: number; prepaid_months?: number; months: number;
        fund_balance?: number; amount?: number; receipt_no?: string; paid_on?: string; duplicate?: boolean };
      const paid = Number(r.amount ?? amt ?? 0);
      setItems((list) => list.map((x) => x.id === assocId ? {
        ...x,
        fund_balance: r.fund_balance != null ? Number(r.fund_balance) : (x.fund_balance || 0) + paid,
        owners: x.owners.map((y) => (y.id === o.id
          ? { ...y, months_late: r.months_late, partial_amount: r.partial_amount, prepaid_months: r.prepaid_months ?? 0,
              ...(r.months > 0 ? { last_paid: String(r.paid_on || today()).slice(0, 10) } : {}) }
          : y)),
      } : x));
      const rc = r.receipt_no ? ` · سند ${r.receipt_no}` : "";
      const pid = (r as any).payment_id as string | undefined;
      if (pid && !r.duplicate) afterPay.current[pid] = { late: r.months_late, partial: Number(r.partial_amount) || 0, prepaid: r.prepaid_months ?? 0, fee: feeOf(o, active) };
      notify("ok", r.duplicate ? `هذه الدفعة مسجّلة سابقًا${rc}`
        : r.months > 0 ? `سُجّل ${riyalsAr(paid, sar)} عن ${periodsAr(r.months, periodOf(active), true)}${rc}`
        : `سُجّل ${riyalsAr(paid, sar)} كسداد جزئي${rc}`,
        pid ? { payment_id: pid, owner: o, receipt_no: r.receipt_no, amount: paid, paid_on: r.paid_on } : undefined);
      return true;
    } finally {
      payLock.current.delete(o.id);
      setPayBusy((b) => { const n = { ...b }; delete n[o.id]; return n; });
    }
  }

  /** عكس دفعة بمعرّفها — مشترك بين «تراجع» في الإشعار وسجل المدفوعات */
  async function reversePaymentById(paymentId: string, ownerId: string | null): Promise<boolean> {
    if (!active) return false;
    const { data, error } = await supabase.rpc("watheq_reverse_owner_payment", { p_payment: paymentId });
    if (error) {
      const m = String(error.message || "");
      notify("err", /not authorized/.test(m) ? "العكس يحتاج صلاحية «التراجع والحذف» — اطلبه من صاحب المكتب." : m);
      return false;
    }
    const r = data as { months_late?: number; partial_amount?: number; prepaid_months?: number; fund_balance?: number };
    const assocId = active.id;
    /* v66: لو كانت الدفعة من حوالة مُبلَّغ عنها عادت الحوالة «بانتظار المراجعة» — نحدّث الشارة */
    if (v66) loadClaims(assocId);
    setItems((list) => list.map((x) => x.id === assocId ? {
      ...x,
      fund_balance: r.fund_balance != null ? Number(r.fund_balance) : x.fund_balance,
      owners: x.owners.map((y) => y.id === ownerId && r.months_late != null
        ? { ...y, months_late: r.months_late, partial_amount: r.partial_amount ?? 0, prepaid_months: r.prepaid_months ?? 0 } : y),
    } : x));
    return true;
  }
  /** «إرسال السند» — واتساب للمالك برابط سنده في صفحته الخاصة */
  async function sendReceiptLink(t: ToastPay) {
    try {
      const url = await ownerPortalUrl(t.owner.id);
      const msg = [`السلام عليكم ${t.owner.name}،`, `استلمنا ${riyalsAr(t.amount, sar)}${t.receipt_no ? ` — سند قبض رقم ${t.receipt_no}` : ""}.`,
        `سند القبض: ${url}/p/${t.payment_id}`, "", `شاكرين لكم، إدارة ${active?.name || "الجمعية"}`].join("\n");
      openExternal(waLink(t.owner.phone, msg));
    } catch (e: any) { notify("err", e?.message || "تعذّر تجهيز رابط السند"); }
  }
  /** رابط صفحة المالك الخاصة (يُنشأ إن لم يوجد) — للتذكير والسند والمستندات */
  async function ownerPortalUrl(ownerId: string): Promise<string> {
    const r = await fetch("/api/hoa/member-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner_id: ownerId, action: "get" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.error || "تعذّر إنشاء رابط المالك");
    return `${window.location.origin}${j.path}`;
  }

  /** «سدّد الكل» — بتأكيد يذكر المبلغ، والقاعدة تحسبه من جديد لحظة التنفيذ */
  function settleAll(o: Owner) {
    const due = ownerDue(o);
    if (!(due > 0)) return notify("err", "لا مستحقات على هذا المالك.");
    if (!confirm(`تسجيل استلام ${sar(due)} ريال من ${o.name} وإصدار سند قبض؟`)) return;
    recordOwnerPayment(o, null);
  }

  /** عكس دفعة مالك (خطأ في التسجيل) — سطر عكس موثَّق، لا حذف */
  async function reverseOwnerPayment(row: any) {
    if (!active || !history) return;
    if (!confirm(`عكس دفعة ${sar(row.amount)} ريال بتاريخ ${row.paid_on}؟ يبقى السطران في السجل.`)) return;
    if (!(await reversePaymentById(row.id, history.owner.id))) return;
    notify("ok", "عُكست الدفعة وبقي أثرها في السجل.");
    openHistory(history.owner);
    router.refresh();   /* تاريخ آخر سداد يعيد القاعدة حسابه بعد العكس */
  }

  /** سند القبض من جهة الإدارة — نفس قالب صفحة المالك */
  function printReceipt(o: Owner, row: any) {
    if (!active) return;
    /* المستلِم = المكتب (اسم الفوترة ثم المنشأة) لا وثيق؛ «الرصيد بعد» فقط إن عُرف من ردّ التسجيل */
    openDoc(renderReceiptPage(
      { association: { name: active.name, fee_period: active.fee_period, mullak_reg_no: active.mullak_reg_no, unified_no: active.unified_no },
        owner: { name: row.payer_name || o.name, unit: row.unit_label ?? o.unit },
        office: { org_name: issuer?.org_name || null, billing_name: issuer?.billing_name || null } } as any,
      row, { nonce: "watheq", base: "", balanceAfter: afterPay.current[row.id] || null }));
  }

  /** حفظ بيانات مالك (تعديل) — لم يكن ممكنًا قبل الآن */
  async function saveOwner(id: string, d: any) {
    const patch = {
      name: (d.name || "").trim(),
      unit: (d.unit || "").trim() || null,
      phone: (d.phone || "").trim() || null,
    };
    if (!patch.name) return notify("err", "اسم المالك مطلوب.");
    const cur = active?.owners.find((o) => o.id === id);
    if (!(await ownerPatch(id, patch))) return;
    /* الأشهر لا تُكتب رقمًا مطلقًا (يمحو دفعة سُجّلت والشاشة مفتوحة):
       فرق فقط، والقاعدة ترفض إن تغيّر الرقم منذ فتح النموذج */
    const want = Math.max(0, Math.floor(Number(d.months_late) || 0));
    if (cur && want !== cur.months_late) {
      if (!(await adjustOwnerMonths(cur, want - cur.months_late))) return;
    }
    /* الحصة والمساحة: بدالة المدير (v63) — لا تغيّر الرسم حتى يُعاد التوزيع */
    const sh = String(d.share_pct ?? "").trim() === "" ? null : Number(d.share_pct);
    const ar = String(d.area_m2 ?? "").trim() === "" ? null : Number(d.area_m2);
    if (cur && ((sh ?? null) !== (cur.share_pct == null ? null : Number(cur.share_pct)) || (ar ?? null) !== (cur.area_m2 == null ? null : Number(cur.area_m2)))) {
      if (!(await setOwnerShare(cur, sh, ar))) return;
    }
    setOwnerModal(null);
    notify("ok", "حُدّثت بيانات المالك.");
  }

  /** حصة المالك ومساحته — دالة المدير (v63) */
  async function setOwnerShare(o: Owner, share: number | null, area: number | null): Promise<boolean> {
    if (!active) return false;
    const assocId = active.id;
    const { data, error } = await supabase.rpc("watheq_owner_set_share", { p_owner: o.id, p_share: share, p_area: area });
    if (error) { notify("err", dbErr(String(error.message || ""))); return false; }
    const r = data as { share_pct: number | null; area_m2: number | null };
    setItems((list) => list.map((x) => x.id === assocId ? {
      ...x, owners: x.owners.map((y) => y.id === o.id ? { ...y, share_pct: r.share_pct, area_m2: r.area_m2 } : y),
    } : x));
    return true;
  }

  /** تعديل يدوي لأشهر المالك (استحقاق يدوي أو تصحيح رصيد افتتاحي) — للمدير، ويُوثَّق */
  async function adjustOwnerMonths(o: Owner, months: number): Promise<boolean> {
    if (!active || !months) return false;
    const assocId = active.id;
    const { data, error } = await supabase.rpc("watheq_owner_adjust", { p_owner: o.id, p_months: months, p_expected_late: o.months_late });
    if (error) {
      const m = String(error.message || "");
      notify("err", /not authorized/.test(m) ? "تعديل الرصيد يدويًا لمدير المكتب فقط." : m);
      return false;
    }
    const r = data as { months_late: number; partial_amount: number; prepaid_months: number };
    setItems((list) => list.map((x) => x.id === assocId ? {
      ...x, owners: x.owners.map((y) => y.id === o.id ? { ...y, ...r } : y),
    } : x));
    return true;
  }

  /** كشف حساب مالك — مع سجل مدفوعاته الموثّق */
  async function openOwnerStatement(o: Owner) {
    if (!active) return;
    const { data, error } = await supabase.from("payments")
      .select("id,paid_on,amount,method,periods_covered,reference,receipt_no,reverses")
      .eq("owner_id", o.id).order("paid_on", { ascending: true }).limit(1000);
    if (error) { console.error("Watheq statement payments error:", error); return notify("err", "تعذّر تحميل المدفوعات — لم يُصدر الكشف."); }
    /* الكشف للمالك: صافي فقط — الدفعة المعكوسة وسطر عكسها لا يظهران، والملاحظات الداخلية لا تُطبع */
    const rows = (data || []) as any[];
    const rev = new Set(rows.filter((r) => r.reverses).map((r) => String(r.reverses)));
    const net = rows.filter((r) => !r.reverses && !rev.has(String(r.id)) && Number(r.amount) > 0)
      .map((r) => ({ ...r, note: [r.receipt_no ? `سند ${r.receipt_no}` : "", r.reference ? `مرجع ${r.reference}` : ""].filter(Boolean).join(" · ") || null }));
    openDoc(ownerStatementHTML(o as any, active as any, issuer || {}, net as any));
  }

  /** يفتح الموازنة: يجلب المحفوظة أو يبدأ بالبنود النموذجية */
  async function openBudget() {
    if (!active) return;
    const year = Number(today().slice(0, 4));   /* سنة الرياض لا الجهاز */
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
    const nextYear = Number(today().slice(0, 4)) + 1;
    const annualBudget = (await savedAnnualBudget(nextYear)) ?? (await savedAnnualBudget(nextYear - 1));
    setRenewal({ annualBudget });
  }

  /** طباعة الموازنة المحفوظة مباشرة — يفضّل موازنة العام القادم ثم الحالي */
  async function printSavedBudget() {
    if (!active) return;
    const nextYear = Number(today().slice(0, 4)) + 1;
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
  async function addOwnersBulk(rows: { name: string; unit: string | null; phone: string | null; months?: number | null }[]) {
    if (!active || !rows.length) return;
    const assocId = active.id;
    const { data, error } = await supabase.from("owners").insert(
      rows.map((r) => ({ association_id: assocId, name: r.name, unit: r.unit, phone: r.phone, months_late: 0 }))
    ).select("*");
    if (error) { console.error("Watheq bulk owners error:", error); return notify("err", error.message); }
    let added = (data || []) as Owner[];
    setItems((list) => list.map((a) => a.id === assocId ? { ...a, owners: [...a.owners, ...added] } : a));
    setBulk(false);
    /* العمود الرابع (المتأخر الافتتاحي بالأشهر): يؤكَّد بدالة المدير مباشرة لمن أُدخل له */
    let confirmed = 0;
    for (let i = 0; i < added.length; i++) {
      const m = rows[i]?.months;
      if (m != null && Number.isFinite(m)) { if (await confirmOpening(added[i], Number(m))) confirmed++; }
    }
    notify("ok", `أُضيف ${ownersAr(rows.length)} دفعة واحدة${confirmed ? ` · حُدّد الرصيد الافتتاحي لـ ${ownersAr(confirmed)}` : ""}.`);
    if (confirmed < added.length) setOpeningOpen(true);
  }

  /** تأكيد الرصيد الافتتاحي لمالك جديد (v64): المتأخر بالفترات، وصفر = لا متأخرات */
  async function confirmOpening(o: Owner, months: number): Promise<boolean> {
    if (!active) return false;
    const assocId = active.id;
    const { data, error } = await supabase.rpc("watheq_owner_confirm_opening", { p_owner: o.id, p_months: Math.max(0, Math.floor(months)), p_expected_late: o.months_late || 0 });
    if (error) { notify("err", `${o.name}: ${dbErr(String(error.message || ""), "v64")}`); return false; }
    const r = data as any;
    setItems((list) => list.map((x) => x.id === assocId ? {
      ...x, owners: x.owners.map((y) => y.id === o.id ? { ...y, opening_set: true, months_late: r.months_late, partial_amount: r.partial_amount, prepaid_months: r.prepaid_months } : y),
    } : x));
    return true;
  }

  /** تصدير الملّاك CSV — يفتح مباشرة في Excel بترميز عربي سليم */
  function exportOwnersCSV() {
    if (!active) return;
    const pw = periodOf(active) === "annual" ? "سنوات" : "أشهر";
    const head = ["الاسم", "الوحدة", "الجوال", `${pw} متأخرة`, "المتأخر (ريال)", "الجزئي أو الرصيد (ريال)", `${pw} مقدَّمة`, "آخر سداد", "الحالة",
      `${PERIOD_WORDS[periodOf(active)].label} (ريال)`, "الحصة ٪", "المساحة م²"];
    const lines = (active.owners || []).map((o) => {
      const k = ownerKey(o);
      const fee = feeOf(o, active);
      return [o.name, o.unit || "", o.phone || "", o.months_late,
        ownerDueAt(o, fee),
        Number(o.partial_amount) || 0, Number(o.prepaid_months) || 0, o.last_paid || "", OWNER_META[k].label,
        fee, o.share_pct ?? "", o.area_m2 ?? ""]
        .map(csvCell).join(",");   /* csvCell: يمنع حقن المعادلات في Excel (30 سبتمبر 2026) */
    });
    const csv = "\uFEFF" + [head.map(csvCell).join(","), ...lines].join("\r\n");
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
  // ---------- v66: الحوالات · طلبات الصيانة · روابط الملاك · علامة «ملاك» ----------
  /* قبل تطبيق schema-v66 ترجع هذه القراءات خطأً فتبقى الأقسام فارغة بهدوء (لا رسالة مزعجة) */
  async function loadClaims(assocId: string) {
    const { data, error } = await supabase.from("hoa_payment_claims")
      .select("id,owner_id,owner_name,unit,amount,transfer_date,bank_ref,note,status,reject_reason,approved_payment_id,created_at,decided_at")
      .eq("association_id", assocId).order("created_at", { ascending: false }).limit(200);
    setClaims(error ? [] : ((data || []) as Claim[]));
    if (error && /does not exist|schema cache|Could not find|relation/i.test(String(error.message))) setV66(false);
    else if (!error) setV66(true);
  }
  async function loadRequests(assocId: string) {
    const { data, error } = await supabase.from("hoa_requests")
      .select("id,owner_id,owner_name,unit,category,location,description,status,manager_note,expense_id,created_at,updated_at,closed_at")
      .eq("association_id", assocId).order("created_at", { ascending: false }).limit(300);
    if (error) { setReqRows([]); setReqErr(/does not exist|schema cache|Could not find/.test(String(error.message)) ? "طلبات الصيانة تحتاج تحديث قاعدة البيانات (schema-v66)." : "تعذّر تحميل الطلبات."); return; }
    setReqErr(null);
    const rows = (data || []) as HoaRequest[];
    setReqRows(rows);
    if (rows.length) {
      const { data: lg } = await supabase.from("hoa_request_log").select("id,request_id,status_from,status_to,note,created_at")
        .in("request_id", rows.map((r) => r.id)).order("id", { ascending: true }).limit(2000);
      setReqLogs((lg || []) as RequestLog[]);
    } else setReqLogs([]);
  }
  async function loadReqExpenses(assocId: string) {
    const { data } = await supabase.from("association_expenses").select("id,voucher_no,description,amount,spent_on,reverses")
      .eq("association_id", assocId).is("reverses", null).order("spent_on", { ascending: false }).limit(40);
    setReqExpenses(((data || []) as any[]).map((e) => ({ id: e.id, label: `${e.voucher_no || ""} · ${String(e.description || "").slice(0, 40)} · ${sar(Number(e.amount))} ريال` })));
  }
  async function loadLinkCounts(assocId: string) {
    const { data, error } = await supabase.rpc("watheq_assoc_link_counts", { p_assoc: assocId });
    setLinkCounts(error || !data ? null : (data as any));
  }
  const loadId = active?.id || null;
  useEffect(() => {
    if (!loadId) return;
    setClaims([]); setReqRows(null); setReqLogs([]); setLinkCounts(null);
    loadClaims(loadId); loadRequests(loadId); loadLinkCounts(loadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadId]);
  useEffect(() => { if (tab === "requests" && loadId) loadReqExpenses(loadId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, loadId]);

  /** اعتماد حوالة: القاعدة تسجّل الدفعة (p_request = معرّف الحوالة) وتصدر السند — لا تتكرر */
  /** يرجع "near_dup" حين تجد القاعدة دفعة بالمبلغ نفسه قرب تاريخ الحوالة — فيعرض الشاشة تأكيدًا داخل التطبيق ثم يعيد بـp_force */
  async function approveClaim(c: Claim, force = false): Promise<boolean | "near_dup"> {
    if (!active) return false;
    const assocId = active.id;
    const { data, error } = await supabase.rpc("watheq_hoa_claim_approve", { p_claim: c.id, p_force: force });
    if (error) {
      const m = String(error.message || "");
      if (!force && /بالمبلغ نفسه قريبًا من تاريخ الحوالة/.test(m)) return "near_dup";
      notify("err", /تعارض في معرّف الحوالة/.test(m) ? "تعارض في معرّف الحوالة — لم تُسجَّل دفعة. راجع سجل مدفوعات المالك وأبلغ الدعم." : dbErr(m, "v66"));
      return false;
    }
    const r = data as any;
    const o = active.owners.find((x) => x.id === c.owner_id);
    if (r && !r.duplicate && r.months_late != null) {
      setItems((list) => list.map((x) => x.id === assocId ? {
        ...x, fund_balance: r.fund_balance != null ? Number(r.fund_balance) : x.fund_balance,
        owners: x.owners.map((y) => y.id === c.owner_id ? { ...y, months_late: r.months_late, partial_amount: r.partial_amount, prepaid_months: r.prepaid_months ?? 0,
          ...(r.months > 0 ? { last_paid: String(r.paid_on || c.transfer_date).slice(0, 10) } : {}) } : y),
      } : x));
    }
    await loadClaims(assocId);
    const rc = r?.receipt_no ? ` · سند ${r.receipt_no}` : "";
    notify("ok", r?.duplicate ? `هذه الحوالة معتمدة سابقًا${rc}` : `اعتُمدت حوالة ${c.owner_name || ""} (${riyalsAr(Number(c.amount), sar)})${rc}`,
      o && r?.payment_id ? { payment_id: r.payment_id, owner: o, receipt_no: r.receipt_no, amount: Number(c.amount), paid_on: c.transfer_date } : undefined);
    return true;
  }
  async function rejectClaim(c: Claim, reason: string): Promise<boolean> {
    if (!active) return false;
    const { error } = await supabase.rpc("watheq_hoa_claim_reject", { p_claim: c.id, p_reason: reason });
    if (error) { notify("err", dbErr(String(error.message || ""), "v66")); return false; }
    await loadClaims(active.id);
    notify("ok", "رُفضت الحوالة — يرى المالك السبب في صفحته.");
    return true;
  }
  /** علامة «مسجّلة في ملاك» — بالدالة فقط (v66) وتُوثَّق */
  async function setMullakFlag(p: MullakPay, on: boolean, inv: string | null): Promise<boolean> {
    const { data, error } = await supabase.rpc("watheq_payment_set_mullak", { p_payment: p.id, p_registered: on, p_invoice: inv });
    if (error) { notify("err", dbErr(String(error.message || ""), "v66")); return false; }
    const r = data as any;
    const patch = (x: any) => x.id === p.id ? { ...x, mullak_registered: r.mullak_registered, mullak_invoice_no: r.mullak_invoice_no } : x;
    setMullak((m) => m && { ...m, rows: (m.rows || []).map(patch) });
    setHistory((h) => h && { ...h, rows: h.rows.map(patch) });
    notify("ok", on ? "عُلّمت الدفعة: مسجّلة في ملاك ✓" : "أُزيلت علامة «ملاك» عن الدفعة.");
    return true;
  }
  async function openMullak() {
    if (!active) return;
    setMullak({ rows: null, loading: true });
    /* صفحات من 1000 صف (سقف PostgREST) حتى تكتمل الدفعات مهما كثرت */
    const all: MullakPay[] = [];
    for (let from = 0; from < 100000; from += 1000) {
      const { data, error } = await supabase.from("payments")
        .select("id,amount,paid_on,receipt_no,payer_name,unit_label,mullak_registered,mullak_invoice_no,reverses")
        .eq("association_id", active.id).order("paid_on", { ascending: false }).order("id", { ascending: true }).range(from, from + 999);
      if (error) { setMullak(null); return notify("err", dbErr(String(error.message || ""), "v66")); }
      all.push(...((data || []) as MullakPay[]));
      if (!data || data.length < 1000) break;
    }
    const rev = new Set(all.filter((x) => x.reverses).map((x) => String(x.reverses)));
    setMullak({ rows: all.filter((x) => !x.reverses && !rev.has(x.id) && Number(x.amount) > 0), loading: false });
  }
  /** حالة طلب الصيانة — كل تغيير يُسجَّل في القاعدة ويراه المالك */
  async function setRequestStatus(r: HoaRequest, status: HoaRequest["status"], note: string | null, expense: string | null): Promise<boolean> {
    if (!active) return false;
    const { error } = await supabase.rpc("watheq_hoa_request_set_status", { p_request: r.id, p_status: status, p_note: note, p_expense: expense });
    if (error) { notify("err", dbErr(String(error.message || ""), "v66")); return false; }
    await loadRequests(active.id);
    notify("ok", `حُدّثت حالة الطلب: ${({ new: "جديد", in_progress: "قيد التنفيذ", done: "أُنجز", rejected: "مرفوض" } as any)[status]}.`);
    return true;
  }
  /** إرسال رابط الصفحة لمالك (دليل البداية) — واتساب برسالة ترحيب، ويُوثَّق في سجل التواصل */
  async function sendOwnerLink(ownerId: string): Promise<boolean> {
    const o = active?.owners.find((x) => x.id === ownerId);
    if (!o || !active) return false;
    const tg = (globalThis as any)?.Telegram?.WebApp;
    const w = !tg && typeof window !== "undefined" ? window.open("", "_blank") : null;
    let url = "";
    try { url = await ownerPortalUrl(o.id); } catch (e: any) { if (w) w.close(); notify("err", e?.message || "تعذّر إنشاء رابط المالك"); return false; }
    const msg = [`السلام عليكم ${o.name}،`, "",
      `هذه صفحتك الخاصة في ${active.name}: حالة اشتراكك وسنداتك ومستندات الجمعية، ومنها تبلّغ عن حوالتك أو عن عطل في العمارة.`,
      url, "", "الرابط خاص بك — لا تشاركه.", `إدارة ${active.name}`].join("\n");
    const href = waLink(o.phone, msg);
    if (w) { try { w.location.href = href; } catch { openExternal(href); } } else openExternal(href);
    await logContact(o, "إرسال رابط الصفحة");
    loadLinkCounts(active.id);
    return true;
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
      ...(typeof data.auto_accrue === "boolean" ? { auto_accrue: data.auto_accrue } : {}),
      /* السنوي فقط يُرسل (الافتراضي شهري) — فلا يتعطّل الإنشاء قبل تطبيق v63 */
      ...(periodOf(data) === "annual" ? { fee_period: "annual", fiscal_start_month: Math.min(12, Math.max(1, Number(data.fiscal_start_month) || 1)) } : {}),
      ...bankFields(data),
      user_id: uid,
    }).select("*").single();
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    const next = { ...(row as any), owners: [], association_notes: [] } as Association;
    setItems([next, ...items]); setActiveId(next.id); setModal(null);
  }
  async function updateAssociation(data: Partial<Association>) {
    if (!active) return;
    /* الرصيد لا يُكتب فوق قيمته: لو سُجّلت دفعة والنموذج مفتوح لضاعت.
       نرسل الفرق فقط، بعملية ذرّية، ويُحفظ في سجل التدقيق. */
    /* H2: لا يُرسل اشتراك صفر أبدًا حين يُفرَّغ الحقل — يبقى القديم وتظهر رسالة */
    if (!(Number(data.fee) > 0) && Number(active.fee) > 0) {
      return notify("err", `قيمة الاشتراك لا تكون صفرًا أو فارغة — بقيت ${sar(Number(active.fee))} ريال. أدخل القيمة الجديدة ثم احفظ.`);
    }
    const fundDelta = Math.round(((Number(data.fund_balance) || 0) - (Number(active.fund_balance) || 0)) * 100) / 100;
    /* خطة الرسوم (الرسم، الأساس، الفترة، الموازنة، السنة المالية): دالة واحدة ذرّية (v63)
       تُبقي رصيد كل مالك بالريال ثابتًا. التحديث المباشر للرسم فقط إن لم تتغيّر الخطة. */
    const plan = {
      fee: r2(Number(data.fee) || 0), basis: basisOf(data), period: periodOf(data),
      total: data.total_budget === null || (data.total_budget as any) === "" || data.total_budget === undefined ? null : r2(Number(data.total_budget) || 0),
      fiscal: Math.min(12, Math.max(1, Number(data.fiscal_start_month) || 1)),
    };
    const planChanged = plan.basis !== basisOf(active) || plan.period !== periodOf(active)
      || (plan.total ?? null) !== (active.total_budget == null ? null : r2(Number(active.total_budget)))
      || plan.fiscal !== (Number(active.fiscal_start_month) || 1);
    const { error } = await supabase.from("associations").update({
      name: data.name, units: data.units || 0, ...(planChanged ? {} : { fee: data.fee || 0 }),
      cert_expiry: data.cert_expiry || null,
      grace_days: Math.max(0, Math.min(30, Number(data.grace_days) || 0)),
      ...(typeof data.auto_accrue === "boolean" ? { auto_accrue: data.auto_accrue } : {}),
      ...bankFields(data),
      /* v64: تُرسل فقط إن تغيّرت — فلا يتعطّل الحفظ قبل تطبيق v64 */
      ...v64Patch(data, active),
    }).eq("id", active.id);
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    let planPatch: Partial<Association> = {};
    let ownersPatch: Record<string, Partial<Owner>> = {};
    if (planChanged) {
      const { data: pr, error: pe } = await supabase.rpc("watheq_assoc_set_fee_plan", {
        p_assoc: active.id, p_fee: plan.fee, p_basis: plan.basis, p_period: plan.period,
        p_total_budget: plan.total, p_fiscal_start: plan.fiscal,
      });
      if (pe) return notify("err", "حُفظت البيانات الأخرى، لكن خطة الرسوم لم تتغيّر: " + dbErr(String(pe.message || "")));
      const r = pr as any;
      planPatch = { fee: Number(r.fee), fee_basis: r.fee_basis, fee_period: r.fee_period, total_budget: r.total_budget, fiscal_start_month: r.fiscal_start_month };
      (r.owners || []).forEach((o: any) => { ownersPatch[o.id] = { fee_override: o.fee_override, months_late: o.months_late, partial_amount: o.partial_amount, prepaid_months: o.prepaid_months }; });
    }
    let fund = active.fund_balance;
    if (fundDelta) {
      const { data: nb, error: fe } = await supabase.rpc("watheq_adjust_fund", { p_assoc: active.id, p_delta: fundDelta });
      if (fe) { notify("err", "حُفظت الإعدادات، لكن تعذّر تعديل رصيد الصندوق: " + fe.message); }
      else fund = Number(nb);
    }
    const { fund_balance: _f, fee_basis: _b, fee_period: _p, total_budget: _t, fiscal_start_month: _m, ...rest } = data as any;
    if (planChanged) delete rest.fee;
    setItems(items.map((a) => a.id === active.id ? {
      ...a, ...rest, ...bankFields(data), ...planPatch, fund_balance: fund,
      owners: a.owners.map((o) => ownersPatch[o.id] ? { ...o, ...ownersPatch[o.id] } : o),
    } as any : a));
    setModal(null);
    if (planChanged) notify("ok", "حُدّثت خطة الرسوم — رصيد كل مالك بالريال كما هو.");
  }
  async function deleteAssociation() {
    if (!active || !confirm("حذف الجمعية وكل بياناتها؟")) return;
    const { data: _del, error } = await supabase.from("associations").delete().eq("id", active.id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) {
      console.error("Watheq save error:", error);
      /* v64: جمعية لها دفعات أو مصروفات لا تُحذف — نعرض الأرشفة بدلها */
      if (/أرشفها|payments|expenses|foreign key/i.test(String(error.message))) {
        return notify("err", "لا يمكن حذف جمعية لها دفعات أو مصروفات مسجّلة — استعمل «أرشفة الجمعية» فيبقى سجلها المالي محفوظًا وتختفي من القائمة.");
      }
      return notify("err", error.message);
    }
    const rest = items.filter((a) => a.id !== active.id);
    setItems(rest); setActiveId(rest[0]?.id || null); setModal(null);
  }
  /** أرشفة الجمعية أو إرجاعها (v64) — المؤرشفة تختفي من القائمة افتراضيًّا وسجلّها باقٍ */
  async function archiveAssociation(archive: boolean) {
    if (!active) return;
    if (archive && !confirm(`أرشفة «${active.name}»؟ تختفي من القائمة ويبقى سجلّها المالي كاملًا، ويمكن إرجاعها لاحقًا.`)) return;
    const { data, error } = await supabase.rpc("watheq_assoc_archive", { p_assoc: active.id, p_archive: archive });
    if (error) return notify("err", dbErr(String(error.message || ""), "v64"));
    const id = active.id;
    setItems((list) => list.map((x) => x.id === id ? { ...x, archived_at: (data as any) || null } : x));
    if (!archive) router.refresh();   /* الإرجاع يعيد ضبط بداية الاستحقاق في القاعدة */
    setModal(null);
    if (archive) { const next = items.find((x) => x.id !== id && !x.archived_at); if (next) setActiveId(next.id); }
    notify("ok", archive ? "أُرشفت الجمعية — تجدها من «عرض المؤرشفة»." : "أُرجعت الجمعية إلى القائمة.");
  }

  // ---------- ملّاك ----------
  async function addOwner(name: string, unit: string, phone: string) {
    if (!active || !name.trim()) return;
    const { data, error } = await supabase.from("owners").insert({
      association_id: active.id, name: name.trim(), unit: unit || null, phone: phone || null, months_late: 0,
    }).select("*").single();
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((a) => a.id === active.id ? { ...a, owners: [...a.owners, data as Owner] } : a));
    if ((data as Owner)?.opening_set === false) setOpeningOpen(true);
  }
  /** بيانات المالك الوصفية فقط (الاسم/الوحدة/الجوال) — الأرقام عبر الدوال */
  async function ownerPatch(id: string, patch: { name?: string; unit?: string | null; phone?: string | null }): Promise<boolean> {
    if (!active) return false;
    const assocId = active.id;
    const { data: _u, error } = await supabase.from("owners").update(patch).eq("id", id).select("id");
    if (error) { console.error("Watheq save error:", error); notify("err", error.message); return false; }
    if (!_u?.length) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return false; }
    setItems((list) => list.map((a) => a.id === assocId ? {
      ...a, owners: a.owners.map((o) => o.id === id ? { ...o, ...patch } : o),
    } : a));
    return true;
  }
  async function deleteOwner(id: string) {
    const who = active?.owners.find((o) => o.id === id);
    if (!active || !confirm(`حذف المالك${who ? ` «${who.name}»` : ""}؟ سجل دفعاته وسنداته يبقى محفوظًا.`)) return;
    const assocId = active.id;
    const { data: _del, error } = await supabase.from("owners").delete().eq("id", id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { notify("err", "حذف المالك يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) { console.error("Watheq owner delete error:", error); return notify("err", ownerDeleteErr(String(error.message || ""), String((error as any).code || ""))); }
    setItems((list) => list.map((a) => a.id === assocId ? { ...a, owners: a.owners.filter((o) => o.id !== id) } : a));
    notify("ok", "حُذف المالك — بقي سجل دفعاته وسنداته.");
    loadLinkCounts(assocId);
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
    const { data: _del, error } = await supabase.from("association_notes").delete().eq("id", id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { notify("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) { console.error("Watheq save error:", error); return notify("err", error.message); }
    setItems(items.map((a) => a.id === active.id ? { ...a, association_notes: a.association_notes.filter((n) => n.id !== id) } : a));
  }

  // ---------- إجراءات واتساب ----------
  /** تذكير ودّي — يحفظ حسن الجوار ويوضّح تفاصيل المطالبة */
  function ownerRemindLink(o: Owner) { return waLink(o.phone, ownerRemindText(o)); }
  /** يرسل تذكيرًا برابط صفحة المالك الخاصة، ويوثّقه في السجل «[تواصل] تذكير واتساب — …» */
  async function sendReminder(o: Owner) {
    /* تُفتح النافذة فورًا (داخل النقرة) ثم يُضبط عنوانها بعد جلب الرابط — وإلا يحجبها المتصفح */
    const tg = (globalThis as any)?.Telegram?.WebApp;
    const w = !tg && typeof window !== "undefined" ? window.open("", "_blank") : null;
    let url = "";
    try { url = await ownerPortalUrl(o.id); } catch { /* بلا رابط: يُرسل النص وحده */ }
    const href = waLink(o.phone, ownerRemindText(o, url));
    if (w) { try { w.location.href = href; } catch { openExternal(href); } } else openExternal(href);
    await logContact(o, "تذكير واتساب");
  }
  /** سجل التواصل: لا يُحذف (سياسة v64) ويُبنى منه «آخر تذكير» و«أُرسل» في التذكير الجماعي */
  async function logContact(o: Owner, label: string) {
    if (!active) return;
    const text = `${CONTACT_TAG} ${label} — ${o.name}${o.unit ? ` (${o.unit})` : ""} — ${riyalsAr(ownerDue(o), sar)}`;
    const assocId = active.id;
    const { data, error } = await supabase.from("association_notes").insert({ association_id: assocId, text, note_date: today() }).select("*").single();
    if (error) { console.error("Watheq contact log error:", error); return; }
    setItems((prev) => prev.map((x) => x.id === assocId ? { ...x, association_notes: [data as Note, ...(x.association_notes || [])] } : x));
  }
  const contactLog = (o: Owner): Note[] => (active?.association_notes || [])
    .filter((n) => String(n.text || "").startsWith(CONTACT_TAG) && String(n.text).includes(`— ${o.name}${o.unit ? ` (${o.unit})` : ""} —`))
    .sort((x, y) => String(y.note_date).localeCompare(String(x.note_date)));
  const lastReminder = (o: Owner) => contactLog(o)[0]?.note_date || null;

  function ownerRemindText(o: Owner, portalUrl = "") {
    if (!active) return "";
    const fee = feeOf(o, active);
    const per = periodOf(active);
    const partial = Number(o.partial_amount) || 0;
    const due = ownerDueAt(o, fee);
    const unit = o.unit ? `الوحدة (${o.unit})` : "وحدتكم";
    const assoc = active.name;

    const lines: string[] = [`السلام عليكم ورحمة الله، ${o.name}`, ""];

    if (o.months_late <= 0 && ((Number(o.prepaid_months) || 0) > 0 || partial > 0)) {
      lines.push(`نشكركم على السداد — اشتراك الصيانة عن ${unit} في ${assoc} مسدَّد${(Number(o.prepaid_months) || 0) > 0 ? ` مقدَّمًا لـ ${periodsAr(Number(o.prepaid_months), per, true)}` : ""}، ولا مستحقات عليكم حاليًّا.`);
    } else if (o.months_late <= 0) {
      lines.push(`تذكير ودّي بأن اشتراك الصيانة عن ${unit} في ${assoc}${fee ? ` وقدره ${sar(fee)} ريال ${PERIOD_WORDS[per].every}` : ""} يُستحق مع بداية ${per === "annual" ? "السنة المالية للجمعية" : "الشهر"}.`);
    } else {
      lines.push(`نودّ تذكيركم بأن اشتراك الصيانة عن ${unit} في ${assoc} لا يزال غير مسدَّد، وبيانه:`);
      lines.push(`• ${per === "annual" ? "السنوات" : "الأشهر"} المتأخرة: ${o.months_late}`);
      if (fee) lines.push(`• ${PERIOD_WORDS[per].label}: ${sar(fee)} ريال`);
      if (partial > 0) lines.push(`• المسدَّد جزئيًّا: ${sar(partial)} ريال`);
      if (due) lines.push(`• المبلغ المتبقّي: ${sar(due)} ريال`);
      if (due && active.iban) {
        lines.push("", "للسداد بالتحويل إلى حساب الجمعية:");
        if (active.bank_name) lines.push(`• البنك: ${active.bank_name}`);
        if (active.bank_account_name) lines.push(`• اسم الحساب: ${active.bank_account_name}`);
        lines.push(`• الآيبان: ${active.iban}`);
      }
    }

    lines.push("");
    lines.push("وتُصرف هذه الاشتراكات على صيانة الأجزاء المشتركة وخدماتها بما يحفظ قيمة العقار للجميع، ويُسدَّد المبلغ في الحساب البنكي للجمعية.");
    lines.push("");
    lines.push("فإن كان السداد قد تم فنعتذر عن التذكير، ونرجو تزويدنا بما يفيد لتحديث السجل.");
    lines.push("");
    if (portalUrl) { lines.push("", "صفحتك الخاصة (حالة اشتراكك وسنداتك ومستندات الجمعية):", portalUrl); }
    lines.push("");
    lines.push("شاكرين لكم حسن تعاونكم،");
    lines.push(`إدارة ${assoc}`);
    return lines.join("\n");
  }

  /** إشعار مكتوب — مستند إلى الأساس النظامي والمسار الصحيح للتحصيل */
  function makeOwnerNotice(o: Owner) {
    if (!active) return;
    const fee = feeOf(o, active);
    const partial = Number(o.partial_amount) || 0;
    const due = ownerDueAt(o, fee);
    const unit = o.unit || "—";
    const body = [
      ...trialBanner(),
      "إشعار بسداد اشتراكات الصيانة المتأخرة",
      `التاريخ: ${today()}`,
      "",
      `من: إدارة ${active.name} (جمعية الملاك)${regText()}`,
      `إلى: المكرَّم ${o.name}، مالك الوحدة العقارية رقم (${unit}).`,
      "",
      "الموضوع: مطالبة بسداد اشتراكات الصيانة المستحقة.",
      "",
      "السلام عليكم ورحمة الله وبركاته،",
      "",
      "بالإشارة إلى نظام ملكية الوحدات العقارية وفرزها وإدارتها، الصادر بالمرسوم الملكي رقم (م/85) وتاريخ 02/07/1441هـ، وإلى النظام الأساسي للجمعية وقرار الجمعية العامة المعتمد بتحديد مبلغ الاشتراك؛",
      "",
      `نفيدكم بأنه قد ترصَّد بذمّتكم مبلغ (${sar(due)}) ريال، قيمة (${o.months_late}) فترة اشتراك ${periodOf(active) === "annual" ? "سنوية" : "شهرية"} مستحقة عن الوحدة رقم (${unit})${fee ? `، بواقع (${sar(fee)}) ريال للفترة` : ""}${partial > 0 ? `، بعد خصم مبلغ (${sar(partial)}) ريال مسدَّد جزئيًّا` : ""}، ولم يُسدَّد حتى تاريخ هذا الإشعار.`,
      "",
      "وتُخصَّص هذه الاشتراكات لصيانة الأجزاء المشتركة وتشغيلها وفق الموازنة المعتمدة، ويؤثّر التأخّر في سدادها على حقوق بقية الملاك وعلى استدامة خدمات العقار.",
      "",
      "لذا نأمل المبادرة بسداد المبلغ المذكور خلال (10) أيام من تاريخ استلامكم هذا الإشعار، إيداعًا في الحساب البنكي للجمعية، وتزويد إدارة الجمعية بما يفيد السداد.",
      "",
      "وفي حال عدم السداد خلال المدة المذكورة، فللجمعية اتخاذ ما يتيحه النظام من إجراءات، ومنها — متى صدرت الرسوم وفواتيرها عبر منصة «ملاك» — طلب السند التنفيذي من خلالها.",
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
    /* لا يُوثَّق عند الفتح: التوثيق حين يؤكد المدير التسليم أو يرسله واتساب (DocModal) */
    setDoc({ title: `إشعار سداد اشتراكات — ${o.name}`, body, kind: "notice", owner: o, label: "خطاب مطالبة" });
  }

  // ════════════════════════════════════════════════════════════
  //  ملف التحصيل — سلّم تصعيد موثّق ينتهي بمستندات السند التنفيذي.
  //  الحدّ النظامي: وثيق يُجهّز المستندات فقط؛ ورفع طلب السند التنفيذي
  //  في منصة «ملاك» واستكماله عبر «ناجز» يتم من مدير العقار نفسه.
  // ════════════════════════════════════════════════════════════

  /** المبلغ الصافي المتأخر على مالك */
  const ownerDue = (o: Owner) => ownerDueAt(o, feeOf(o, active));

  /** وسم يميّز خطابات التحصيل داخل سجل العمارة */
  const NOTICE_TAG = "[تحصيل]";
  const CONTACT_TAG = "[تواصل]";
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

  /** رقم التسجيل في «ملاك» والرقم الموحّد — النظام يشترطهما مع اسم الجمعية في المراسلات */
  const regText = () => {
    const x = [active?.mullak_reg_no ? `رقم التسجيل في «ملاك»: ${active.mullak_reg_no}` : "", active?.unified_no ? `الرقم الموحّد: ${active.unified_no}` : ""].filter(Boolean);
    return x.length ? ` — ${x.join(" · ")}` : "";
  };

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
    const fee = feeOf(o, active);
    const partial = Number(o.partial_amount) || 0;
    const due = ownerDue(o);
    const unit = o.unit || "—";
    const prev = noticeLog(o);
    const body = [
      ...trialBanner(),
      "إنذار نهائي بسداد اشتراكات الصيانة المتأخرة",
      `التاريخ: ${today()}`,
      "",
      `من: إدارة ${active.name} (جمعية الملاك)${regText()}`,
      `إلى: المكرَّم ${o.name}، مالك الوحدة العقارية رقم (${unit}).`,
      "",
      "الموضوع: إنذار نهائي قبل اتخاذ الإجراءات النظامية.",
      "",
      "السلام عليكم ورحمة الله وبركاته،",
      "",
      `إلحاقًا بمطالباتنا السابقة${prev.length ? ` (${prev.map((n) => n.note_date).join("، ")})` : ""}، وبالإشارة إلى نظام ملكية الوحدات العقارية وفرزها وإدارتها الصادر بالمرسوم الملكي رقم (م/85) وتاريخ 02/07/1441هـ ولائحته التنفيذية، وإلى النظام الأساسي لجمعية الملاك${feeApprovedOn ? ` وقرار الجمعية العامة بتحديد مبلغ الاشتراك الصادر بتاريخ ${feeApprovedOn}` : ""}؛`,
      "",
      `نُنذركم إنذارًا نهائيًّا بسداد مبلغ (${sar(due)}) ريال، قيمة (${o.months_late}) فترة اشتراك ${periodOf(active) === "annual" ? "سنوية" : "شهرية"} مستحقة عن الوحدة رقم (${unit})${fee ? `، بواقع (${sar(fee)}) ريال للفترة` : ""}${partial > 0 ? `، بعد خصم مبلغ (${sar(partial)}) ريال مسدَّد جزئيًّا` : ""}.`,
      "",
      "ويكون السداد — وفق المادة السادسة من النظام الأساسي — بتحويل بنكي من حسابكم إلى الحساب البنكي لجمعية الملاك، مع تزويد رئيس الجمعية بما يفيد التحويل فور إتمامه، وذلك خلال (15) يومًا من تاريخ استلامكم هذا الإنذار.",
      "",
      "ونذكّركم بأن النظام الأساسي لا يجيز التخلّي عن الالتزام تجاه الجمعية بأي مسوّغ، ولو أبديتم رغبتكم بعدم الانتفاع بالأجزاء المشتركة (المادة الثلاثون)، وأن التزامكم يبقى قائمًا حتى لو كانت الوحدة مؤجَّرة (المادة الحادية والثلاثون).",
      "",
      "وفي حال عدم السداد خلال المدة المذكورة، سيتّخذ مدير العقار ما يقرّره النظام الأساسي من إجراءات، بما فيها — إن كان قرار تحديد الاشتراكات معتمدًا من الهيئة العامة للعقار — طلب السند التنفيذي واستكمال التنفيذ لدى الجهة المختصة.",
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
    setDoc({ title: `إنذار نهائي — ${o.name}`, body, kind: "final", owner: o, label: "إنذار نهائي" });
  }


  function ownerNoticeLink(o: Owner) {
    if (!active) return "#";
    const total = ownerDue(o);
    return waLink(WATHEQ_WA, `مرحبًا، أرغب بتجهيز نموذج خطاب تذكير بالسداد عبر وثيق.\nالجمعية: ${active.name}\nمالك الوحدة: ${o.unit || "—"} (${o.name})\nالمتأخرات: ${periodsAr(o.months_late, periodOf(active))}${total ? ` بمبلغ ${sar(total)} ريال` : ""}.`);
  }
  function renewLink() {
    if (!active) return "#";
    const dl = daysLeft(active.cert_expiry);
    return waLink(WATHEQ_WA, `مرحبًا، أرغب بمساعدتكم في تجهيز موازنة جمعيتنا وأرقام الاشتراك.\nالجمعية: ${active.name}\nانتهاء الشهادة: ${active.cert_expiry || "غير محدد"}${dl !== null ? ` (خلال ${daysAr(dl)})` : ""}\nالمطلوب: الموازنة وبنود رسوم الاشتراك.`);
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
  const dl = daysLeft(a.cert_expiry);
  const per: FeePeriod = periodOf(a);
  const W = PERIOD_WORDS[per];
  const shareBasis = basisOf(a) === "share";
  const feeFor = (o: Owner) => feeOf(o, a);
  const owedTotal = r2(late.reduce((s, o) => s + ownerDueAt(o, feeFor(o)), 0));
  const expectedMonthly = r2(owners.reduce((s, o) => s + feeFor(o), 0));
  const noShare = shareBasis ? owners.filter((o) => o.fee_override == null).length : 0;


  const chips: { k: "all" | "due" | OwnerKey; label: string }[] = [
    { k: "all", label: `الكل ${total}` },
    { k: "due", label: `عليهم متأخرات ${late.length}` },
    { k: "critical", label: `${per === "annual" ? "3 سنوات" : "3 أشهر"} فأكثر ${critical.length}` },
    { k: "partial", label: `دفعوا جزءًا ${owners.filter((o) => ownerKey(o) === "partial").length}` },
    { k: "ok", label: `لا متأخرات ${total - late.length}` },
  ];
  const pendingOpening = owners.filter((o) => o.opening_set === false);
  const pendingClaims = claims.filter((c) => c.status === "pending");
  const openRequests = (reqRows || []).filter((r) => r.status === "new" || r.status === "in_progress").length;
  const focusAddOwner = () => { setTab("owners"); setTimeout(() => { addOwnerRef.current?.scrollIntoView({ block: "center" }); addOwnerRef.current?.focus(); }, 60); };
  /** «المزيد ▾»: على الجوال كل الأزرار الثانوية؛ على الشاشة الواسعة ما لا زرّ له (desk) */
  const moreItems: { label: string; run: () => void; desk?: boolean }[] = [
    { label: "🧾 كشف حساب الجمعية", run: openAssocStatement },
    { label: "⬇️ تنزيل الملاك CSV", run: exportOwnersCSV },
    { label: "🧾 الصندوق والمصروفات", run: () => setTab("fund") },
    { label: "⚖️ توزيع الرسوم حسب الحصص", run: () => setSharesOpen(true) },
    { label: "📊 الموازنة", run: openBudget },
    { label: "📄 محضر تأسيسي", run: () => setMinutes(true) },
    { label: "🗂 الاجتماع السنوي", run: openRenewal },
    ...(v66 ? [{ label: "🏛 الدفعات و«ملاك»", run: openMullak },
      { label: `💳 الحوالات المُبلَّغ عنها${pendingClaims.length ? ` (${pendingClaims.length})` : ""}`, run: () => setClaimsOpen(true), desk: true }] : []),
    { label: "🔗 أرسل للملاك روابطهم", run: () => (total ? setSendLinks(true) : focusAddOwner()), desk: true },
  ];
  const linkedN = linkCounts ? Math.min(Number(linkCounts.linked) || 0, total) : 0;
  const guideSteps: GuideStep[] = [
    { key: "owners", label: "أضف الملاك", hint: total ? `المضافون: ${ownersAr(total)}` : "اسم كل مالك ووحدته وجواله — أو الصق قائمتك كاملة مرة واحدة.",
      done: total > 0, action: { label: "📋 الصق قائمة الملاك", run: () => setBulk(true) }, extra: { label: "+ مالك واحد", run: focusAddOwner } },
    { key: "opening", label: "حدّد المتأخرات الافتتاحية", term: "الرصيد الافتتاحي",
      hint: pendingOpening.length ? `${ownersAr(pendingOpening.length)} بلا رصيد افتتاحي — صفحاتهم «قيد المراجعة» حتى تحدّده.` : "ما على كل مالك قبل بدء الاستخدام.",
      done: total > 0 && pendingOpening.length === 0, action: { label: "حدّد المتأخرات الافتتاحية", run: () => (pendingOpening.length ? setOpeningOpen(true) : focusAddOwner()) } },
    { key: "iban", label: "أدخل حساب الجمعية البنكي", hint: "يظهر الآيبان للمالك في صفحته وفي رسائل التذكير.",
      done: ibanOk(a.iban), action: { label: "⚙︎ أدخل الآيبان", run: () => setModal("edit") } },
    /* F6: بلا عدّاد الروابط (قبل v66) تصير الخطوة اختيارية فلا يعلق الدليل */
    { key: "links", label: "أرسل لكل مالك رابطه", optional: !linkCounts, hint: linkCounts ? `${linkedN} من ${total} لهم رابط فعّال.` : "صفحة خاصة لكل مالك: رصيده وسنداته، ومنها يبلّغ عن حوالته.",
      done: total > 0 && !!linkCounts && linkedN >= total, action: { label: "🔗 أرسل الروابط", run: () => (total ? setSendLinks(true) : focusAddOwner()) } },
    { key: "accrue", label: "فعّل الاستحقاق التلقائي", optional: true, term: "استحقاق تلقائي", hint: "يُضاف اشتراك كل فترة على الملاك دون تدخّل منك.",
      done: !!a.auto_accrue, action: { label: "⚙︎ فعّله من الإعدادات", run: () => setModal("edit") } },
    { key: "mullak", label: "أدخل رقم التسجيل في «ملاك»", optional: true, hint: "يُطبع في السندات والخطابات.",
      done: !!a.mullak_reg_no, action: { label: "⚙︎ الإعدادات", run: () => setModal("edit") } },
  ];

  return (
    <div className="pb-24 hoa">{/* مساحة أسفل حتى لا تغطي الأزرار العائمة آخر المحتوى · .hoa: أهداف لمس ≥44px */}
      {toast && (
        <div role="status" className={`fixed top-5 left-1/2 -translate-x-1/2 z-[70] w-[min(92vw,420px)] rounded-xl px-4 py-3 text-sm font-semibold shadow-lg border ${
          toast.k === "ok" ? "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]" : "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]"}`}>
          <div>{toast.m}</div>
          {toast.pay && !toast.confirmUndo && (
            <div className="flex gap-2 mt-2">
              <button type="button" className="btn btn-ghost text-xs flex-1 justify-center py-2"
                onClick={() => { holdToast(); setToast((t) => t && { ...t, confirmUndo: true }); }}>↶ تراجع</button>
              <button type="button" className="btn btn-wa text-xs flex-1 justify-center py-2"
                onClick={() => { const t = toast.pay!; setToast(null); sendReceiptLink(t); }}>إرسال السند</button>
            </div>
          )}
          {toast.pay && toast.confirmUndo && (
            <div className="mt-2">
              <div className="text-xs text-[#8f2b26]">عكس هذه الدفعة؟ يبقى السطران في السجل.</div>
              <div className="flex gap-2 mt-1.5">
                <button type="button" className="btn btn-ghost text-xs flex-1 justify-center py-2" onClick={() => setToast((t) => t && { ...t, confirmUndo: false })}>لا</button>
                <button type="button" className="btn text-xs flex-1 justify-center py-2 bg-late text-white"
                  onClick={async () => { const t = toast.pay!; setToast(null); if (await reversePaymentById(t.payment_id, t.owner.id)) notify("ok", "عُكست الدفعة وبقي أثرها في السجل."); }}>نعم، اعكسها</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ملخّص كل الجمعيات */}
      {/* المحفظة بلا المؤرشفة دائمًا — حتى لو عُرضت في القائمة (كتقارير البوت والملخص اليومي) */}
      {liveItems.length > 1 && (() => {
        const p = liveItems.reduce((acc, x) => {
          const ow = Array.isArray(x.owners) ? x.owners : [];
          const f = Number(x.fee) || 0;
          ow.forEach((o) => {
            acc.owners++;
            const d = ownerDueAt(o, feeOf(o, x));
            if ((Number(o.months_late) || 0) > 0) { acc.late++; acc.owed += d; }
            /* السنوي يُحسب بحصته الشهرية (÷12) حتى يُجمع مع الشهري */
            acc.expected += feeOf(o, x) / (periodOf(x) === "annual" ? 12 : 1);
          });
          void f;
          acc.fund += Number(x.fund_balance) || 0;
          const dd = daysLeft(x.cert_expiry);
          if (dd !== null && dd <= 60) acc.certs++;
          return acc;
        }, { owners: 0, late: 0, owed: 0, expected: 0, fund: 0, certs: 0 });
        return (
          <div className="bg-deep text-[#EAF1EE] rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="font-display font-bold text-sm text-goldSoft">محفظتك · {countWord(liveItems.length, "جمعية واحدة", "جمعيتان", "جمعيات", "جمعية")}</div>
            <PortfolioStat v={String(p.owners)} l="مالك" />
            <PortfolioStat v={String(p.late)} l="متأخر" tone={p.late ? "warn" : undefined} />
            <PortfolioStat v={sar(p.owed)} l="ريال متأخر" tone={p.owed ? "warn" : undefined} />
            <PortfolioStat v={sar(Math.round(p.expected))} l="إيراد الشهر المتوقّع" />
            <PortfolioStat v={moneySigned(p.fund)} l="رصيد الصناديق" />
            <PortfolioStat v={String(p.certs)} l="شهادات تنتهي قريبًا" tone={p.certs ? "warn" : undefined} />
          </div>
        );
      })()}

      {/* شريط اختيار الجمعية — على الجوال: العنوان في سطره، والأزرار الثانوية في قائمة مختصرة */}
      <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_auto] gap-2 mb-5 items-center">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-deep text-xl leading-snug break-words">
            <span aria-hidden>🏗️ </span>{a.name}{a.archived_at ? <span className="text-xs font-semibold text-muted mr-2">(مؤرشفة)</span> : null}
          </h1>
          <div className="text-sm text-muted">إدارة جمعية الملاك · {total} من {a.units || total} وحدة</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(visibleItems.length > 1 || archivedCount > 0) && (
            <select value={a.id} onChange={(e) => setActiveId(e.target.value)} className="fld min-w-0 max-w-[220px] flex-1 sm:flex-none font-semibold text-deep" aria-label="اختر الجمعية">
              {visibleItems.map((x) => <option key={x.id} value={x.id}>{x.name}{x.archived_at ? " (مؤرشفة)" : ""}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-ghost text-sm" onClick={() => setModal("edit")}>⚙︎ إعدادات</button>
          {/* .btn يفرض display — فالإخفاء على غلاف لا على الزر */}
          <span className="hidden sm:inline-flex gap-2">
            <button type="button" className="btn btn-ghost text-sm" onClick={refreshNow} disabled={refreshing}
              title="تحديث البيانات من السيرفر">{refreshing ? "…" : "↻ تحديث"}</button>
            <button className="btn btn-gold text-sm" onClick={() => setModal("new")}>+ جمعية</button>
          </span>
          <div className="sm:hidden">
            <RowMenu label="⋯ المزيد" items={[
              { label: refreshing ? "… جارٍ التحديث" : "↻ تحديث البيانات", run: refreshNow },
              { label: "+ جمعية جديدة", run: () => setModal("new") },
              ...(archivedCount > 0 ? [{ label: showArchived ? "إخفاء المؤرشفة" : `عرض المؤرشفة (${archivedCount})`, run: () => setShowArchived((v) => !v) }] : []),
            ]} />
          </div>
          {archivedCount > 0 && (
            <span className="hidden sm:inline-flex"><button type="button" className="btn btn-ghost text-xs" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "إخفاء المؤرشفة" : `عرض المؤرشفة (${archivedCount})`}</button></span>
          )}
        </div>
      </div>

      {!a.archived_at && <GuideCard assocId={a.id} steps={guideSteps} />}

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
          <span><b>تنتهي شهادة الجمعية خلال {daysAr(dl)}</b> ({a.cert_expiry}{a.cert_expiry && hijriText(a.cert_expiry) ? ` — ${hijriText(a.cert_expiry)}` : ""}). إصدارها من «ملاك» إجراء مباشر ويشترط الرقم الموحّد 700 أولًا.</span>
          <div className="flex gap-2 mr-auto">
            <button type="button" className="btn btn-gold text-sm" onClick={openRenewal}>🗂 جهّز الاجتماع السنوي</button>
            <a href={renewLink()} target="_blank" rel="noreferrer" className="btn btn-ghost text-sm">اطلبها جاهزة</a>
          </div>
        </div>
      )}

      {/* إحصاءات — قابلة للنقر للتصفية */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <div className="col-span-2 md:col-span-1">
          <Stat v={moneySigned(Number(a.fund_balance) || 0)} l="رصيد الصندوق (ريال) — المصروفات" kpi={(Number(a.fund_balance) || 0) < 0 ? "overdue" : "plain"} icon="﷼"
            onClick={() => setTab("fund")} active={tab === "fund"} />
        </div>
        <Stat v={sar(expectedMonthly)} l={`الدخل ${per === "annual" ? "السنوي" : "الشهري"} المتوقّع`} kpi="income" icon="↑" onClick={() => setFilter("all")} active={filter === "all"} />
        <Stat v={sar(owedTotal)} l={`المتأخر (${ownersAr(late.length)})`} kpi="overdue" icon="!" onClick={() => { setFilter("due"); setSort("amount"); }} active={filter === "due"} />
        <Stat v={`${total - late.length} من ${total}`} l="ملّاك بلا متأخرات" kpi="soon" icon="●" onClick={() => setFilter("ok")} active={filter === "ok"} />
        <Stat v={dl === null ? "—" : String(dl)} l="يوم حتى انتهاء الشهادة" kpi={dl !== null && dl <= 30 ? "overdue" : "expiring"} icon="↻" />
      </div>

      {/* v66: حوالات أبلغ عنها الملاك من صفحاتهم */}
      {v66 && pendingClaims.length > 0 && (
        <button type="button" onClick={() => setClaimsOpen(true)}
          className="w-full grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl p-3 mb-4 bg-[#FDF0DC] border border-[#EBD9AA] text-[#7A4800] text-right min-h-[44px]">
          <span aria-hidden className="w-8 h-8 rounded-lg bg-white grid place-items-center">💳</span>
          <span className="min-w-0"><b>حوالات بانتظار المراجعة ({pendingClaims.length})</b>
            <span className="block text-xs">أبلغ عنها الملاك من صفحاتهم — طابقها مع البنك ثم اعتمدها ليصدر السند.</span></span>
          <span className="text-sm font-bold">راجِع ←</span>
        </button>
      )}

      {/* التبويبات: لا شيء يدفع قائمة الملاك لأسفل */}
      <div className="bg-white border border-line rounded-xl p-1 mb-4">
        <div className="hoa-tabs" role="tablist" aria-label="أقسام الجمعية">
          {([["owners", "الملاك"], ["docs", "المستندات"], ["fund", "الصندوق والمصروفات"],
             ...(v66 ? [["requests", `طلبات الصيانة${openRequests ? ` (${openRequests})` : ""}`]] : []), ["log", "سجل العمارة"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" id={`hoa-tab-${k}`} aria-selected={tab === k} aria-controls="hoa-tabpanel"
              className="hoa-tab" onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div id="hoa-tabpanel" role="tabpanel" aria-labelledby={`hoa-tab-${tab}`}>
      {tab === "fund" && (
        <div className="mb-5">
          <HoaExpensesPanel association={{ id: a.id, name: a.name, fund_balance: Number(a.fund_balance) || 0, public_token: a.public_token }}
            orgName={issuer?.billing_name || null} notify={notify}
            onFund={(b) => { if (Number.isFinite(b)) setItems((list) => list.map((x) => x.id === a.id ? { ...x, fund_balance: b } : x)); }} />
        </div>
      )}

      {tab === "docs" && (
        <div className="mb-5">
          <HoaDocumentsPanel association={{ id: a.id, name: a.name }}
            owners={owners.map((o) => ({ id: o.id, name: o.name, unit: o.unit, phone: o.phone }))}
            prefill={docPrefill} onPrefillUsed={() => setDocPrefill(null)} />
        </div>
      )}

      {tab === "requests" && v66 && (
        <div className="mb-5">
          <RequestsPanel rows={reqRows} logs={reqLogs} expenses={reqExpenses} error={reqErr} onSet={setRequestStatus}
            onReload={() => { loadRequests(a.id); loadReqExpenses(a.id); }} />
        </div>
      )}

      {(tab === "owners" || tab === "log") && (
      <div className={`grid grid-cols-[minmax(0,1fr)] ${tab === "owners" ? "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : ""} gap-5 items-start`}>
        {/* الملّاك */}
        {tab === "owners" && (
        <div className="bg-white border border-line rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 gap-2 flex-wrap">
            <h2 className="font-semibold">الملّاك وحالة السداد</h2>
            <div className="flex flex-wrap gap-2 items-center">
              {(a.fee > 0 || shareBasis) && <span className="text-xs text-muted w-full sm:w-auto">
                {shareBasis ? `الاشتراك ${W.every} حسب حصة كل وحدة` : `الاشتراك ${sar(a.fee)} ريال${W.per}`}
                {a.auto_accrue ? <>{per === "annual" ? ` · يُستحق تلقائيًا أول ${MONTHS_AR[(Number(a.fiscal_start_month) || 1) - 1]} من كل سنة` : " · يُستحق تلقائيًا أول كل شهر"}<InfoTip term="استحقاق تلقائي" /></> : ""}</span>}
              {/* ظاهران دائمًا: التحصيل ومستندات الملاك — والبقية في «المزيد ▾» على الجوال */}
              {late.length > 0 && (
                <button type="button" className="btn btn-ghost text-xs" onClick={() => setCollect({})}
                  title="سلّم التحصيل: تذكير ← خطاب مطالبة ← إنذار نهائي، وجاهزية السند التنفيذي">⚖️ التحصيل ({late.length})</button>
              )}
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setTab("docs")}
                title="محاضر وإشعارات تصل كل مالك في رابطه، مع من اطّلع ومن اعتمد">📨 مستندات الملاك</button>
              <span className="sm:hidden"><RowMenu label="المزيد ▾" items={moreItems} /></span>
              <span className="hidden sm:inline-flex flex-wrap gap-2 items-center">
                <button type="button" className="btn btn-ghost text-xs" onClick={openAssocStatement}>كشف حساب</button>
                <button type="button" className="btn btn-ghost text-xs" onClick={exportOwnersCSV} title="تنزيل ملف Excel/CSV بكل الملّاك وحالتهم">⬇️ CSV</button>
                <button type="button" className="btn btn-ghost text-xs" onClick={() => setSharesOpen(true)}
                  title="حصة كل وحدة ومساحتها، وتوزيع الموازنة عليها">⚖️ توزيع الرسوم حسب الحصص</button>
                <button type="button" className="btn btn-ghost text-xs" onClick={openBudget}>📊 الموازنة</button>
                <button type="button" className="btn btn-ghost text-xs" onClick={() => setMinutes(true)}>📄 محضر تأسيسي</button>
                {v66 && <button type="button" className="btn btn-ghost text-xs" onClick={openMullak} title="علّم الدفعات التي سجّلتها في منصة «ملاك» الرسمية">🏛 الدفعات و«ملاك»</button>}
                <RowMenu label="المزيد ▾" items={moreItems.filter((x) => x.desk)} />
                <button type="button" className="btn btn-gold text-xs" onClick={openRenewal} title="موازنة العام القادم + محضر الاجتماع السنوي، وأرقامهما جاهزة لقرار الرسوم في المنصة">🗂 الاجتماع السنوي</button>
              </span>
            </div>
          </div>

          <div className="p-4">
            {noShare > 0 && (
              <div className="text-xs rounded-lg p-2.5 mb-3 bg-[#FBF1DF] border border-[#EBD9AA] text-[#8a5a11]">
                {ownersAr(noShare)} بلا حصة موزّعة — يُحسب عليه رسم الجمعية العام ({sar(a.fee)} ريال) حتى تعيد «توزيع الرسوم حسب الحصص».
              </div>
            )}
            {pendingOpening.length > 0 && (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs rounded-lg p-2.5 mb-3 bg-[#FDF0DC] border border-[#EBD9AA] text-[#9A5B00]">
                <span>{ownersAr(pendingOpening.length)} بلا رصيد افتتاحي — تظهر صفحاتهم «قيد المراجعة» حتى تحدّده.</span>
                <button type="button" className="btn btn-gold text-xs" onClick={() => setOpeningOpen(true)}>حدّد المتأخرات الافتتاحية</button>
              </div>
            )}
            <AddOwner onAdd={addOwner} inputRef={addOwnerRef} />
            <div className="flex justify-end -mt-1 mb-3">
              <button type="button" className="inline-flex items-center min-h-[44px] text-xs font-semibold text-goldInk hover:underline" onClick={() => setBulk(true)}>
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
                    <button key={c.k} type="button" onClick={() => setFilter(c.k)} aria-pressed={filter === c.k}
                      className={`hoa-chip ${filter === c.k ? "hoa-chip-on" : ""}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-muted flex flex-wrap items-center gap-x-3 w-full">
                  <span>المصطلحات:</span>
                  <span className="inline-flex items-center">متأخر<InfoTip term="متأخر" /></span>
                  <span className="inline-flex items-center">سداد جزئي<InfoTip term="سداد جزئي" /></span>
                  <span className="inline-flex items-center">مقدَّم<InfoTip term="مقدَّم" /></span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {!total ? (
                <div className="text-center rounded-xl border border-dashed border-line bg-paper px-4 py-8">
                  <div className="text-3xl mb-2" aria-hidden>🏢</div>
                  <div className="font-display font-bold text-deep">لا ملّاك بعد في هذه الجمعية</div>
                  <p className="text-sm text-muted mt-1 mb-4">أسرع طريقة: انسخ قائمة الملاك من Excel أو واتساب والصقها — سطر لكل مالك.</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button type="button" className="btn btn-gold text-sm" onClick={() => setBulk(true)}>📋 الصق قائمة الملاك</button>
                    <button type="button" className="btn btn-ghost text-sm" onClick={focusAddOwner}>+ أضف مالكًا واحدًا</button>
                  </div>
                </div>
              ) : !rows.length ? (
                <div className="text-center text-muted py-6 text-sm">
                  لا نتائج مطابقة.
                  <button className="btn btn-ghost text-xs mt-3 mx-auto" onClick={() => { setQ(""); setFilter("all"); }}>مسح البحث والتصفية</button>
                </div>
              ) : rows.map((o) => {
                const k = ownerKey(o);
                const owed = ownerDue(o);
                const prepaid = Number(o.prepaid_months) || 0;
                const credit = o.months_late > 0 ? 0 : Number(o.partial_amount) || 0;
                const busyRow = !!payBusy[o.id];
                return (
                  <div key={o.id} className={`rounded-xl border p-3 ${k === "critical" ? "border-[#F5C6C2] bg-[#FEF7F6]" : "border-line bg-paper"}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="w-9 h-9 rounded-lg bg-paper2 grid place-items-center font-semibold text-deep shrink-0">{(o.name || "?").charAt(0)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate">{o.name}</div>
                          <div className="text-xs text-muted">
                            {o.unit ? `وحدة ${o.unit}` : "—"}{o.last_paid ? ` · آخر سداد ${arDate(o.last_paid)}` : ""}
                            {o.share_pct != null ? ` · حصة ${Number(o.share_pct)}٪` : ""}{o.area_m2 != null ? ` · ${Number(o.area_m2)} م²` : ""}
                            {o.fee_override != null ? ` · رسمه ${sar(Number(o.fee_override))}${W.per}` : ""}
                          </div>
                          {lastReminder(o) && <div className="text-[.7rem] text-muted">آخر تذكير: {arDate(lastReminder(o))}</div>}
                        </div>
                      </div>
                      <div className="text-right sm:text-left shrink-0">
                        {o.opening_set === false
                          ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1 bg-[#FDF0DC] text-[#9A5B00]">لم يُحدَّد الرصيد</span>
                          : <StatusPill k={k} />}
                        <div className="text-xs mt-1 tabular-nums">
                          {o.months_late > 0
                            ? (Number(o.partial_amount) || 0) > 0
                              ? <span className="text-[#9A5B00] font-semibold">دُفع {sar(Number(o.partial_amount) || 0)} · متبقٍ {sar(owed)}</span>
                              : <span className="text-late font-bold">{periodsAr(o.months_late, per)} · {sar(owed)} ريال</span>
                            : prepaid > 0 ? <span className="text-paid font-semibold">مقدَّم {periodsAr(prepaid, per)}{credit > 0 ? ` + ${sar(credit)}` : ""}</span>
                            : credit > 0 ? <span className="text-paid font-semibold">رصيد له {sar(credit)} ريال</span>
                            : <span className="text-muted">لا مستحقات</span>}
                        </div>
                      </div>
                    </div>

                    {/* إجراء رئيسي + قائمة المزيد */}
                    <div className="flex flex-wrap gap-1.5 justify-stretch sm:justify-end mt-2.5 items-center [&>*]:flex-1 sm:[&>*]:flex-none [&>*]:justify-center">
                      {feeFor(o) > 0 && (
                        <QuickBtn title={o.months_late > 0 ? `تأكيد استلام اشتراك ${W.one}` : `استلام اشتراك ${W.one} مقدَّمًا`} cls={o.months_late > 0 ? "btn-primary" : "btn-ghost"}
                          disabled={busyRow} onClick={() => recordOwnerPayment(o, feeFor(o))}>{busyRow ? "…" : "\u2714"}</QuickBtn>
                      )}
                      <QuickBtn title="تسجيل مبلغ (جزئي أو بتاريخ ومرجع)" cls="btn-ghost" disabled={busyRow} onClick={() => setPaying(o)}>&#189;</QuickBtn>
                      {o.months_late > 0 && <button type="button" onClick={() => sendReminder(o)} className="btn btn-wa text-xs px-2.5" title="إرسال تذكير واتساب برابط صفحته" aria-label="إرسال تذكير واتساب">&#128172;</button>}
                      {o.phone && <a href={`tel:${String(o.phone).replace(/[^0-9+]/g, "")}`} className="btn btn-ghost text-xs px-2.5 sm:hidden" title="اتصال مباشر">&#128222;</a>}
                      {o.months_late >= 2 && <button type="button" className="btn btn-gold text-xs" onClick={() => makeOwnerNotice(o)}>نموذج إشعار</button>}
                      <MemberLinkButton owner={{ id: o.id, name: o.name, unit: o.unit, phone: o.phone }} associationName={a.name}
                        className="btn btn-ghost text-xs px-2.5" onChange={() => loadLinkCounts(a.id)} />
                      <RowMenu
                        items={[
                          { label: "🧾 كشف حساب", run: () => openOwnerStatement(o) },
                          { label: "🧮 سجل المدفوعات", run: () => openHistory(o) },
                          { label: "✎ تعديل البيانات", run: () => setOwnerModal({ owner: o }) },
                          { label: "➕ إضافة استحقاق يدوي", run: async () => { if (await adjustOwnerMonths(o, 1)) notify("ok", `أُضيف استحقاق ${W.one}.`); } },
                          ...(o.months_late === 0 ? [{ label: "💬 رسالة للمالك", run: () => sendReminder(o) }] : []),
                          ...(o.months_late > 0 ? [{ label: "⚖️ ملف التحصيل والتصعيد", run: () => setCollect({ owner: o }) }] : []),
                          ...(o.months_late > 0 ? [{ label: "✅ سدّد الكل (بسند قبض)", run: () => settleAll(o) }] : []),
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

        )}
        {/* ملاحظات — على الجوال في تبويب «سجل العمارة»، وعلى الشاشة الواسعة بجانب الملاك */}
        <div className={`bg-white border border-line rounded-2xl shadow-sm ${tab === "log" ? "" : "hidden md:block"}`}>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold">سجل العمارة</h2></div>
          <div className="p-4">
            <AddNote onAdd={addNote} placeholder="أضف ملاحظة (صيانة، تغيّر مالك…)" />
            {notes.length ? notes.map((n) => {
              /* سجل المطالبات والتواصل لا يُحذف (يُفرض في القاعدة أيضًا — v64) */
              const locked = /^\s*[\[［]\s*(تحصيل|تواصل)/.test(String(n.text || ""));
              return (
                <div key={n.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 items-start py-2.5 border-b border-dashed border-line last:border-0 text-sm">
                  <span className="text-xs font-semibold text-[#8a5a11] w-20 shrink-0 pt-0.5">{arDate(n.note_date)}</span>
                  <span className="text-[#33413d] break-words">{n.text}</span>
                  {locked ? <span className="w-11 h-11 grid place-items-center text-muted text-xs" title="سجل موثَّق — لا يُحذف" aria-label="سجل موثَّق">🔒</span>
                    : noteAsk === n.id ? (
                      <span className="flex gap-1">
                        <button type="button" className="btn btn-ghost text-xs px-2 py-1.5" onClick={() => setNoteAsk(null)}>لا</button>
                        <button type="button" className="btn text-xs px-2 py-1.5 bg-late text-white" onClick={() => { setNoteAsk(null); deleteNote(n.id); }}>احذف</button>
                      </span>
                    ) : <button type="button" className="w-11 h-11 grid place-items-center rounded-lg text-muted hover:text-late hover:bg-paper2" aria-label="حذف الملاحظة" onClick={() => setNoteAsk(n.id)}>✕</button>}
                </div>
              );
            }) : <div className="text-center text-muted py-6 text-sm">لا ملاحظات بعد.</div>}
          </div>
        </div>
      </div>
      )}
      </div>

      {budget && <BudgetModal assoc={a} budget={budget} onClose={() => setBudget(null)}
        onSave={(b) => { saveBudget(b); setBudget(b); }}
        onPrint={(b) => openDoc(budgetHTML(a as any, b as any, issuer || {}))} />}
      {sharesOpen && <SharesModal assoc={a} onClose={() => setSharesOpen(false)} notify={notify}
        onShare={setOwnerShare}
        onApplied={(r) => setItems((list) => list.map((x) => x.id === a.id ? {
          ...x, fee_basis: r.fee_basis, fee_period: r.fee_period, total_budget: r.total_budget, fee: Number(r.fee),
          owners: x.owners.map((o) => { const n = (r.owners || []).find((y: any) => y.id === o.id); return n ? { ...o, ...n } : o; }),
        } : x))} />}
      {minutes && <MinutesModal assoc={a} onClose={() => setMinutes(false)}
        onPrint={(d) => openDoc(foundingMinutesHTML(a as any, d as any, issuer || {}))}
        onSend={(d) => { const m = foundingMinutesPortalHTML(a as any, d); setDocPrefill({ title: `${m.title} — ${a.name}`, kind: "minutes", body_html: m.html }); setMinutes(false); setDocsOpen(true); }} />}
      {renewal && <RenewalModal assoc={a} annualBudget={renewal.annualBudget}
        onClose={() => setRenewal(null)}
        onEditBudget={() => { setRenewal(null); openBudget(); }}
        onPrintBudget={printSavedBudget}
        onPrintMinutes={(d) => openDoc(renewalMinutesHTML(a as any, d as any, issuer || {}))}
        onSendMinutes={(d) => { const m = renewalMinutesPortalHTML(a as any, d); setDocPrefill({ title: `${m.title} — ${a.name}`, kind: "minutes", body_html: m.html }); setRenewal(null); setDocsOpen(true); }} />}
      {bulk && <BulkOwnersModal onClose={() => setBulk(false)} onSubmit={addOwnersBulk} />}
      {claimsOpen && <ClaimsModal claims={claims} onApprove={approveClaim} onReject={rejectClaim} onClose={() => setClaimsOpen(false)} />}
      {mullak && <MullakModal rows={mullak.rows} loading={mullak.loading} onSet={setMullakFlag} onClose={() => setMullak(null)} />}
      {sendLinks && <SendLinksModal owners={owners.map((o) => ({ id: o.id, name: o.name, unit: o.unit, phone: o.phone }))}
        onSend={sendOwnerLink} onClose={() => setSendLinks(false)} />}
      {openingOpen && pendingOpening.length > 0 && <OpeningModal owners={pendingOpening} period={per}
        onClose={() => setOpeningOpen(false)}
        onSave={async (vals) => {
          let n = 0;
          for (const o of pendingOpening) { if (vals[o.id] !== undefined && await confirmOpening(o, vals[o.id])) n++; }
          if (n) notify("ok", `حُدّد الرصيد الافتتاحي لـ ${ownersAr(n)}.`);
          if (n === pendingOpening.length) setOpeningOpen(false);
        }} />}
      {remindAll && <RemindAllOwnersModal owners={late} dueOf={ownerDue} period={per} onSend={sendReminder}
        sentToday={(o) => contactLog(o).some((n) => n.note_date === today())}
        onClose={() => setRemindAll(false)} />}
      {collect && <CollectionsModal assoc={a} owners={late} only={collect.owner}
        fee={shareBasis ? Math.max(a.fee || 0, 1) : a.fee || 0} period={per} stageOf={escalation} logOf={noticeLog} dueOf={ownerDue}
        onClose={() => setCollect(null)}
        onRemind={(o) => sendReminder(o)}
        onNotice={(o) => makeOwnerNotice(o)}
        onFinal={(o, d) => makeFinalNotice(o, d)} />}
      {ownerModal?.owner && <OwnerModal owner={ownerModal.owner} period={per} onClose={() => setOwnerModal(null)}
        onSubmit={(d) => saveOwner(ownerModal.owner!.id, d)} />}
      {history && <HistoryModal data={history} period={per} onClose={() => setHistory(null)}
        onReverse={reverseOwnerPayment} onReceipt={(row) => printReceipt(history.owner, row)} onMullak={setMullakFlag} />}
      {doc && <DocModal doc={doc} onClose={() => setDoc(null)}
        onDelivered={doc.owner && doc.label ? async (via) => { await logNotice(doc.owner!, via === "wa" ? `${doc.label} (أُرسل واتساب)` : `${doc.label} (سُلِّم)`); } : undefined} />}
      {paying && <OwnerPaymentModal owner={paying} fee={feeFor(paying)} period={per} busy={!!payBusy[paying.id]} onClose={() => setPaying(null)}
        onSubmit={async (amt, o2) => { const ok = await recordOwnerPayment(paying, amt, o2); if (ok) setPaying(null); }} />}
      {/* عرض شرطي: التفكيك عند الإغلاق هو ما يمحو الحقول */}
      {modal === "new" && <FormModal open title="جمعية جديدة" onClose={() => setModal(null)} onSubmit={createAssociation} />}
      {modal === "edit" && active && (
        <FormModal open title="إعدادات الجمعية" initial={active} onClose={() => setModal(null)} onSubmit={updateAssociation} onDelete={deleteAssociation}
          onArchive={() => archiveAssociation(!active.archived_at)} />
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
function QuickBtn({ children, title, cls, onClick, disabled }: { children: React.ReactNode; title: string; cls: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`btn ${cls} text-xs px-2.5 disabled:opacity-60`}>{children}</button>
  );
}

/** نافذة تسجيل مبلغ مستلم من مالك — كامل أو جزئي */
const METHODS: { v: string; l: string }[] = [
  { v: "transfer", l: "تحويل بنكي" }, { v: "cash", l: "نقدًا" },
  { v: "pos", l: "شبكة" }, { v: "cheque", l: "شيك" }, { v: "other", l: "أخرى" },
];
const methodLabel = (v?: string | null) => METHODS.find((m) => m.v === v)?.l || "أخرى";

function OwnerPaymentModal({ owner, fee, period = "monthly", busy, onClose, onSubmit }: {
  owner: Owner; fee: number; period?: FeePeriod; busy?: boolean; onClose: () => void;
  onSubmit: (amount: number, opts: { method: string; note?: string; paidOn?: string; reference?: string; request?: string }) => void;
}) {
  /* معرّف واحد لهذه النافذة: إعادة الضغط بعد انقطاع الشبكة لا تسجّل دفعة ثانية.
     يتجدّد إن تغيّر المبلغ (دفعة مختلفة فعلًا). */
  const reqRef = useRef<{ key: string; id: string } | null>(null);
  const requestFor = (key: string) => {
    if (!reqRef.current || reqRef.current.key !== key) {
      const id = typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function" ? (crypto as any).randomUUID() : "";
      reqRef.current = { key, id };
    }
    return reqRef.current.id || undefined;
  };
  const already = Number(owner.partial_amount) || 0;
  const prepaid0 = Number(owner.prepaid_months) || 0;
  const due = Math.max(0, Math.round((owner.months_late * fee - already) * 100) / 100);
  const remaining = owner.months_late > 0 ? Math.max(0, Math.round((fee - already) * 100) / 100) : fee;
  const [amount, setAmount] = useState<string>(String(remaining || fee));
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState<string>(today());
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  /* نفس نموذج القاعدة: الرصيد = مقدَّم×الرسم + الجزئي − متأخر×الرسم */
  /* نفس نموذج القاعدة وتقسيمها بالهللات (lib/hoaMoney) — المعاينة = ما تسجّله القاعدة */
  const bal = r2(ownerBalance(owner, fee) + amt);
  const after = fee > 0 ? splitBalance(bal, fee) : { late: owner.months_late, prepaid: prepaid0, partial: already };
  const covered = (owner.months_late - after.late) + (after.prepaid - prepaid0);
  const W = PERIOD_WORDS[period];
  const future = paidOn > today();

  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-display font-bold text-deep text-xl mb-1">تسجيل مبلغ مستلم</h3>
      <p className="text-sm text-muted mb-1">{owner.name} · {owner.unit ? `وحدة ${owner.unit}` : "—"}</p>
      <p className="text-xs text-muted mb-3 flex flex-wrap items-center gap-x-3"><span className="inline-flex items-center">مقدَّم<InfoTip term="مقدَّم" /></span>
        <span className="inline-flex items-center">سداد جزئي<InfoTip term="سداد جزئي" /></span><span className="inline-flex items-center">سند قبض<InfoTip term="سند قبض" /></span></p>

      <div className="bg-paper2 border border-line rounded-xl p-3 mb-4 text-sm">
        <div className="flex justify-between"><span className="text-muted">{W.label}{owner.fee_override != null ? " (حسب الحصة)" : ""}</span><b className="tabular-nums">{sar(fee)} ريال</b></div>
        <div className="flex justify-between mt-1"><span className="text-muted">{period === "annual" ? "سنوات متأخرة" : "أشهر متأخرة"}</span><b className="tabular-nums text-late">{owner.months_late}</b></div>
        {already > 0 && (
          <div className="flex justify-between mt-1"><span className="text-muted">{owner.months_late > 0 ? "مدفوع جزئيًّا سابقًا" : "رصيد له"}</span>
            <b className="tabular-nums text-[#9A5B00]">{sar(already)} ريال</b></div>
        )}
        {prepaid0 > 0 && <div className="flex justify-between mt-1"><span className="text-muted">مدفوع مقدَّمًا</span><b className="tabular-nums text-paid">{periodsAr(prepaid0, period)}</b></div>}
        <div className="flex justify-between mt-1 border-t border-line pt-1"><span className="text-muted">المستحق الآن</span><b className="tabular-nums">{sar(due)} ريال</b></div>
      </div>

      <Field label="المبلغ المستلم (ريال)">
        <input className="fld" type="number" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="flex gap-2 mt-2 flex-wrap">
        {owner.months_late > 0 && remaining > 0 && remaining !== fee && (
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setAmount(String(remaining))}>إكمال {period === "annual" ? "السنة" : "الشهر"} ({sar(remaining)})</button>
        )}
        <button type="button" className="btn btn-ghost text-xs" onClick={() => setAmount(String(fee))}>{period === "annual" ? "سنة كاملة" : "شهر كامل"} ({sar(fee)})</button>
        {due > 0 && due !== fee && (
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setAmount(String(due))}>كل المستحق ({sar(due)})</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="طريقة السداد">
          <select className="fld" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </Field>
        <Field label="تاريخ الاستلام">
          <DateField value={paidOn} onChange={(v) => setPaidOn(v || today())} />
        </Field>
        <Field label="رقم الحوالة/المرجع">
          <input className="fld" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="ملاحظة (اختياري)">
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      {amt > 0 && fee > 0 && (
        <div className="bg-[#E6F4EC] border border-[#B7DFC7] rounded-xl p-3 mt-4 text-xs text-[#137a50] leading-relaxed">
          {covered > 0 && (() => { const adv = Math.max(0, after.prepaid - prepaid0); return <div>يغطّي <b>{periodsAr(covered, period, true)}</b>{adv <= 0 ? "" : adv >= covered ? " — كلها مقدَّمًا" : ` — منها ${periodsAr(adv, period)} مقدَّمًا`}.</div>; })()}
          {after.late > 0 && <div>يبقى عليه <b>{periodsAr(after.late, period)}</b>{after.partial > 0 ? ` (دفع من آخرها ${sar(after.partial)} ريال)` : ""}.</div>}
          {after.late === 0 && after.partial > 0 && <div>ويبقى له رصيد <b>{sar(after.partial)} ريال</b> يُخصم من {period === "annual" ? "السنة القادمة" : "الشهر القادم"}.</div>}
          {covered === 0 && <div>لن يكتمل {W.one} — يُسجَّل المبلغ جزئيًّا.</div>}
          <div className="mt-1">يصدر سند قبض مرقَّم تلقائيًا.</div>
        </div>
      )}
      {future && <p className="text-xs text-late mt-2">تاريخ الاستلام لا يكون بعد اليوم.</p>}

      <div className="flex gap-2 mt-5">
        <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!(amt > 0) || busy || future}
          onClick={() => onSubmit(amt, { method, note: note.trim() || undefined, paidOn, reference: reference.trim() || undefined,
            request: requestFor([amt, method, paidOn, reference.trim(), note.trim()].join("|")) })}>
          {busy ? "جارٍ التسجيل…" : "تسجيل"}</button>
      </div>
      </div>
    </Overlay>
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
function RowMenu({ items, label }: { items: { label: string; run: () => void; danger?: boolean }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open);
  if (!items.length) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={label ? undefined : "إجراءات أخرى"} aria-haspopup="menu" aria-expanded={open}
        className={`btn btn-ghost px-2.5 ${label ? "text-sm" : "text-xs"}`} title="المزيد">{label || "⋯"}</button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute z-50 top-full mt-1 left-0 min-w-[210px] max-w-[calc(100vw-2rem)] bg-white border border-line rounded-xl shadow-lg overflow-hidden py-1">
            {items.map((it, i) => (
              <button key={i} type="button" role="menuitem" onClick={() => { setOpen(false); it.run(); }}
                className={`block w-full text-right px-3.5 min-h-[44px] text-xs font-semibold hover:bg-paper2 transition ${it.danger ? "text-late" : "text-deep"}`}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function AddOwner({ onAdd, inputRef }: { onAdd: (n: string, u: string, p: string) => void; inputRef?: React.Ref<HTMLInputElement> }) {
  const [n, setN] = useState(""); const [u, setU] = useState(""); const [p, setP] = useState("");
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
      <input ref={inputRef} aria-label="اسم المالك" className="fld" value={n} onChange={(e) => setN(e.target.value)} placeholder="اسم المالك" />
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

function FormModal({ open, title, initial, onClose, onSubmit, onDelete, onArchive }: {
  open: boolean; title: string; initial?: Association;
  onClose: () => void; onSubmit: (d: Partial<Association>) => void; onDelete?: () => void; onArchive?: () => void;
}) {
  const [d, setD] = useState<any>(initial || {});
  if (!open) return null;
  return (
    <Overlay onClose={onClose}>
      {/* max-h + overflow: على جوال 390×844 كانت أزرار الحفظ تخرج عن الشاشة بلا تمرير */}
      <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-bold text-deep text-xl mb-4">{title}</h2>
        <div className="space-y-3">
          <Field label="اسم الجمعية"><input className="fld" value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="عدد الوحدات"><input className="fld" type="number" value={d.units || ""} onChange={(e) => setD({ ...d, units: +e.target.value })} /></Field>
            <Field label={`${PERIOD_WORDS[periodOf(d)].label} للوحدة (ريال)`}><input className="fld" type="number" value={d.fee || ""} onChange={(e) => setD({ ...d, fee: +e.target.value })} /></Field>
          </div>
          {/* خطة الرسوم (v63): الفترة وأساس التوزيع — تُطبَّق بدالة تُبقي رصيد كل مالك بالريال ثابتًا */}
          <div className="rounded-xl border border-line p-3 space-y-3">
            <div className="text-sm font-semibold">خطة الرسوم</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="فترة الاشتراك">
                <select className="fld" value={periodOf(d)} onChange={(e) => setD({ ...d, fee_period: e.target.value })}>
                  <option value="monthly">شهري</option>
                  <option value="annual">سنوي</option>
                </select>
              </Field>
              {periodOf(d) === "annual" ? (
                <Field label="بداية السنة المالية">
                  <select className="fld" value={Number(d.fiscal_start_month) || 1} onChange={(e) => setD({ ...d, fiscal_start_month: +e.target.value })}>
                    {MONTHS_AR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </Field>
              ) : <div />}
            </div>
            {initial && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="أساس التوزيع">
                  <select className="fld" value={basisOf(d)} onChange={(e) => setD({ ...d, fee_basis: e.target.value })}>
                    <option value="equal">متساوٍ لكل وحدة</option>
                    <option value="share">حسب حصة الوحدة</option>
                  </select>
                </Field>
                <Field label="الموازنة السنوية (ريال)">
                  <input className="fld" type="number" min={0} value={d.total_budget ?? ""} placeholder={basisOf(d) === "share" ? "مطلوبة للحصص" : "اختياري"}
                    onChange={(e) => setD({ ...d, total_budget: e.target.value === "" ? null : +e.target.value })} />
                </Field>
              </div>
            )}
            {initial && basisOf(d) === "share" && !(Number(d.total_budget) > 0) && <p className="text-xs text-late">التوزيع بالحصص يحتاج إجمالي الموازنة السنوية.</p>}
            {initial && (periodOf(d) !== periodOf(initial) || basisOf(d) !== basisOf(initial) || (periodOf(d) === "annual" && (Number(d.fiscal_start_month) || 1) !== (Number(initial.fiscal_start_month) || 1))) && (
              <p className="text-xs text-[#8a5a11] bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2 leading-relaxed">
                يُستحق ما فات بالخطة الحالية أولًا، ثم تبدأ الخطة الجديدة من {periodOf(d) === "annual" ? "السنة المالية الحالية" : "الشهر الحالي"} بلا أثر رجعي. رصيد كل مالك بالريال يبقى كما هو ويُعاد تقسيمه على رسمه الجديد.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="انتهاء الشهادة"><DateField value={d.cert_expiry || ""} onChange={(v) => setD({ ...d, cert_expiry: v })} /></Field>
            <Field label={initial ? "رصيد الصندوق (تعديل يدوي يُوثَّق)" : "رصيد الصندوق الافتتاحي (ريال)"}><input className="fld" type="number" value={d.fund_balance ?? ""} onChange={(e) => setD({ ...d, fund_balance: +e.target.value })} /></Field>
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
        <div className="mt-4 rounded-xl border border-line p-3">
          <div className="text-sm font-semibold mb-2">حساب الجمعية البنكي <span className="text-xs text-muted font-normal">(يظهر للمالك في رابطه ورسالة التذكير)</span></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="البنك"><input className="fld" value={d.bank_name || ""} onChange={(e) => setD({ ...d, bank_name: e.target.value })} /></Field>
            <Field label="اسم الحساب"><input className="fld" value={d.bank_account_name || ""} onChange={(e) => setD({ ...d, bank_account_name: e.target.value })} /></Field>
          </div>
          <Field label="الآيبان (SA + 22 رقمًا)"><input className="fld" dir="ltr" value={d.iban || ""} placeholder="SA0000000000000000000000"
            onChange={(e) => setD({ ...d, iban: e.target.value })} /></Field>
          {d.iban && !ibanOk(d.iban) && <p className="text-xs text-late mt-1">الآيبان غير مكتمل — يبدأ بـ SA ويليه 22 رقمًا.</p>}
        </div>
        <div className="mt-4 rounded-xl border border-line p-3 space-y-3">
          <div className="text-sm font-semibold">بيانات الجمعية الرسمية <span className="text-xs text-muted font-normal">(تُطبع في السندات والخطابات)</span></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم التسجيل في «ملاك»"><input className="fld" dir="ltr" maxLength={40} value={d.mullak_reg_no || ""} onChange={(e) => setD({ ...d, mullak_reg_no: e.target.value })} /></Field>
            <Field label="الرقم الموحّد (700)"><input className="fld" dir="ltr" maxLength={40} value={d.unified_no || ""} onChange={(e) => setD({ ...d, unified_no: e.target.value })} /></Field>
          </div>
          <div className="text-sm font-semibold flex items-center">النصاب — حسب النظام الأساسي للجمعية<InfoTip term="النصاب" /></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الاجتماع الأول (٪ من الحصص)"><input className="fld" type="number" min={1} max={100} value={d.quorum_first_pct ?? 75}
              onChange={(e) => setD({ ...d, quorum_first_pct: e.target.value === "" ? "" : +e.target.value })} /></Field>
            <Field label="الاجتماع الثاني"><select className="fld" value={d.quorum_second_pct == null || d.quorum_second_pct === "" ? "" : String(d.quorum_second_pct)}
              onChange={(e) => setD({ ...d, quorum_second_pct: e.target.value === "" ? null : +e.target.value })}>
              <option value="">أي عدد من الحاضرين</option>
              {[25, 50].map((x) => <option key={x} value={x}>{x}٪ من الحصص</option>)}
            </select></Field>
          </div>
          <p className="text-xs text-muted">القيم الافتراضية من النظام الأساسي النموذجي — عدّلها لتطابق نظام جمعيتك المعتمد.</p>
        </div>
        <label className="flex items-start gap-2 mt-4 text-sm cursor-pointer">
          <input type="checkbox" className="mt-1" checked={d.auto_accrue ?? !initial} onChange={(e) => setD({ ...d, auto_accrue: e.target.checked })} />
          <span><b>استحقاق تلقائي {periodOf(d) === "annual" ? "أول كل سنة مالية" : "أول كل شهر"}</b><InfoTip term="استحقاق تلقائي" />
            <span className="block text-xs text-muted">يُضاف اشتراك {periodOf(d) === "annual" ? "السنة" : "الشهر"} على كل مالك تلقائيًا (ويُخصم من المقدَّم إن وُجد). عند التفعيل يبدأ من {periodOf(d) === "annual" ? "السنة المالية القادمة" : "الشهر القادم"}، ولا يُضاف شيء بأثر رجعي.</span></span>
        </label>
        {!(d.name || "").trim() && (
          <p className="text-xs text-late mt-3">اسم الجمعية مطلوب لتفعيل الحفظ.</p>
        )}
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!(d.name || "").trim() || (!!d.iban && !ibanOk(d.iban)) || (!!initial && basisOf(d) === "share" && !(Number(d.total_budget) > 0))}
            title={!(d.name || "").trim() ? "أدخل اسم الجمعية أولًا" : "حفظ"}
            style={!(d.name || "").trim() ? { opacity: .5, cursor: "not-allowed" } : undefined}
            onClick={() => onSubmit(d)}>حفظ</button>
        </div>
        {onArchive && <div className="text-center mt-3"><button type="button" className="text-deep text-sm font-semibold underline" onClick={onArchive}>
          {initial?.archived_at ? "إرجاع الجمعية من الأرشيف" : "أرشفة الجمعية (يبقى سجلّها المالي)"}</button></div>}
        {onDelete && <div className="text-center mt-2"><button className="text-late text-sm font-semibold underline" onClick={onDelete}>حذف الجمعية نهائيًّا</button>
          <div className="text-[.7rem] text-muted">الحذف متاح فقط لجمعية بلا دفعات ولا مصروفات.</div></div>}
      </div>
    </Overlay>
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
  /* الإيراد الحالي سنويًّا بالرسم الفعلي لكل مالك وبفترته (السنوي لا يُضرب في 12) */
  const ownersArr = Array.isArray(assoc.owners) ? assoc.owners : [];
  const ppy = periodOf(assoc) === "annual" ? 1 : 12;
  const currentAnnual = ownersArr.length ? r2(ownersArr.reduce((sm, o) => sm + feeOf(o, assoc), 0) * ppy) : currentFee * ppy * units;
  const gap = total - currentAnnual;

  const payload = { year: budget.year, items, reserve_pct: rp, notes };
  const setItem = (n: number, patch: Partial<BudgetItem>) =>
    setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));

  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
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
            {currentFee > 0 && <> والاشتراك الحالي المعتمد <b>{basisOf(assoc) === "share" ? "حسب حصة كل وحدة" : `${sar(currentFee)} ريال ${PERIOD_WORDS[periodOf(assoc)].every}`}</b>.</>}
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
    </Overlay>
  );
}

/** محضر الجمعية العمومية التأسيسية */
function MinutesModal({ assoc, onClose, onPrint, onSend }: {
  assoc: Association; onClose: () => void; onPrint: (d: any) => void; onSend?: (d: any) => void;
}) {
  const units = Number(assoc.units) || (Array.isArray(assoc.owners) ? assoc.owners.length : 0);
  const per = periodOf(assoc);
  const [d, setD] = useState<any>({
    meeting_date: today(), mode: "حضوري", place: "", attendees: "",
    total_units: units || "", president: "", manager: "", fee: assoc.fee || "",
    due_day: per === "annual" ? `في أول ${MONTHS_AR[(Number(assoc.fiscal_start_month) || 1) - 1]} من كل سنة` : "في الخامس من كل شهر",
    bank: "", year: Number(today().slice(0, 4)), annual_budget: assoc.total_budget || "",
  });
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  const att = useAttendance(assoc);
  const out = () => ({ ...d, ...att.payload(d) });

  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">محضر الجمعية العمومية التأسيسية</h3>
        <p className="text-sm text-muted mb-4">{assoc.name} — املأ ما تعرفه، واترك الباقي فراغات تُملأ بخطّ اليد.</p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاريخ الاجتماع">
              <DateField value={d.meeting_date} onChange={(v) => set("meeting_date", v)} />
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
              <input className="fld" type="number" min={0} max={Number(d.total_units) || undefined} disabled={att.track}
                value={att.track ? "" : d.attendees} placeholder={att.track ? "من قائمة الحضور" : "اتركه فارغًا قبل الاجتماع"}
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
            <Field label={basisOf(assoc) === "share" ? "الرسوم حسب حصة كل وحدة" : `${PERIOD_WORDS[per].label} للوحدة (ريال)`}>
              <input className="fld" type="number" min={0} value={d.fee} disabled={basisOf(assoc) === "share"} onChange={(e) => set("fee", e.target.value)} />
            </Field>
            <Field label="موعد السداد">
              <input className="fld" value={d.due_day} onChange={(e) => set("due_day", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="إجمالي الموازنة السنوية (ريال)">
              <input className="fld" type="number" min={0} value={d.annual_budget} onChange={(e) => set("annual_budget", e.target.value)} placeholder="من نافذة الموازنة" />
            </Field>
            <Field label="البنك">
              <input className="fld" value={d.bank} onChange={(e) => set("bank", e.target.value)} placeholder="اسم البنك" />
            </Field>
          </div>
          <AttendanceBlock att={att} d={d} items={["تأسيس الجمعية واعتماد النظام الأساسي", "انتخاب رئيس الجمعية", "تعيين مدير العقار", "اعتماد الموازنة التقديرية", "تحديد اشتراك الصيانة", "فتح الحساب البنكي", "التسجيل في «ملاك»"]} />
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
          <button type="button" className="btn btn-gold flex-1 justify-center" onClick={() => onPrint(out())}>إنشاء المحضر</button>
          {onSend && <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={() => onSend(out())}
            title="يظهر في رابط كل مالك ليطّلع ويعتمد">📨 للملاك للاعتماد</button>}
        </div>
      </div>
    </Overlay>
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
function OwnerModal({ owner, period = "monthly", onClose, onSubmit }: {
  owner: Owner; period?: FeePeriod; onClose: () => void; onSubmit: (d: any) => void;
}) {
  const [d, setD] = useState<any>({
    name: owner.name || "", unit: owner.unit || "",
    phone: owner.phone || "", months_late: owner.months_late || 0,
    share_pct: owner.share_pct ?? "", area_m2: owner.area_m2 ?? "",
  });
  const shareBad = String(d.share_pct) !== "" && !(Number(d.share_pct) >= 0 && Number(d.share_pct) <= 100);
  const areaBad = String(d.area_m2) !== "" && !(Number(d.area_m2) > 0);
  const ready = String(d.name || "").trim().length > 0;
  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="الحصة ٪">
              <input className="fld" type="number" inputMode="decimal" min={0} max={100} step="0.0001" value={d.share_pct}
                onChange={(e) => setD({ ...d, share_pct: e.target.value })} placeholder="مثال 12.5" />
            </Field>
            <Field label="المساحة م²">
              <input className="fld" type="number" inputMode="decimal" min={0} value={d.area_m2}
                onChange={(e) => setD({ ...d, area_m2: e.target.value })} placeholder="اختياري" />
            </Field>
          </div>
          {(shareBad || areaBad) && <p className="text-xs text-late">{shareBad ? "الحصة بين 0 و100٪. " : ""}{areaBad ? "المساحة أكبر من صفر." : ""}</p>}
          <p className="text-xs text-muted -mt-1">الحصة لا تغيّر رسم المالك حتى تضغط «توزيع الرسوم حسب الحصص».</p>
          <Field label={period === "annual" ? "السنوات المتأخرة" : "الأشهر المتأخرة"} hint={period === "annual" ? "اشتراكات سنوية لم تُدفع حتى اليوم" : "اشتراكات شهرية لم تُدفع حتى اليوم"}>
            <input className="fld" type="number" min={0} value={d.months_late}
              onChange={(e) => setD({ ...d, months_late: e.target.value })} />
          </Field>
          <p className="text-xs text-muted leading-relaxed">
            تعديل الفترات المتأخرة يدويًّا للتصحيح فقط؛ الأفضل تسجيل السداد من زرّ ✔ أو ½ ليُحفظ في سجل المدفوعات.
          </p>
        </div>

        <div className="flex gap-2 mt-6">
          <button type="button" className="btn btn-ghost flex-1 justify-center" onClick={onClose}>إلغاء</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!ready || shareBad || areaBad}
            style={!ready ? { opacity: .5, cursor: "not-allowed" } : undefined}
            onClick={() => onSubmit(d)}>حفظ</button>
        </div>
        {!ready && <p className="text-xs text-late mt-3 text-center">اسم المالك مطلوب لتفعيل الحفظ.</p>}
      </div>
    </Overlay>
  );
}

/** سجل المدفوعات — مع رقم السند، وعكس الدفعة الخاطئة (سطر عكس لا حذف) */
function HistoryModal({ data, period = "monthly", onClose, onReverse, onReceipt, onMullak }: {
  data: { owner: Owner; rows: any[] }; period?: FeePeriod; onClose: () => void;
  onReverse: (row: any) => void; onReceipt: (row: any) => void;
  onMullak?: (p: MullakPay, on: boolean, inv: string | null) => Promise<boolean>;
}) {
  const { owner, rows } = data;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const reversed = new Set(rows.filter((r) => r.reverses).map((r) => String(r.reverses)));
  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-lg mb-1">سجل المدفوعات — {owner.name}</h3>
        <p className="text-sm text-muted mb-1">{owner.unit ? `وحدة ${owner.unit}` : "—"} · {countWord(rows.length, "عملية واحدة", "عمليتان", "عمليات", "عملية")} · الصافي {r2(total) < 0 ? <Amt n={r2(total)} /> : riyalsAr(r2(total), sar)}</p>
        <p className="text-xs text-muted mb-4 flex flex-wrap items-center gap-x-3"><span className="inline-flex items-center">سند قبض<InfoTip term="سند قبض" /></span>
          <span className="inline-flex items-center">عكس الدفعة<InfoTip term="عكس الدفعة" /></span></p>
        {!rows.length ? (
          <div className="text-center text-muted py-10 text-sm">
            لا مدفوعات مسجّلة بعد.
            <div className="text-xs mt-2">الدفعات التي تُسجّلها من الآن ستُحفظ هنا بتاريخها وطريقتها ورقم سندها.</div>
          </div>
        ) : (
          /* بطاقات بدل جدول بعرض أدنى (كان يُمرَّر أفقيًّا على الجوال) */
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-auto">
            {rows.map((r) => {
              const isRev = !!r.reverses;
              const wasRev = reversed.has(String(r.id));
              const pc = Math.abs(Number(r.periods_covered) || 0);
              return (
                <div key={r.id} className={`rounded-xl border p-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 ${isRev || wasRev ? "border-line bg-paper2 text-muted" : "border-line bg-paper"}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <b className={`tabular-nums ${wasRev ? "line-through" : ""}`}>{isRev ? <Amt n={Number(r.amount) || 0} /> : riyalsAr(Math.abs(Number(r.amount) || 0), sar)}</b>
                      {isRev && <span className="text-[.7rem] font-semibold rounded-md px-1.5 py-0.5 bg-[#FBE9E7] text-[#a5322c]">عكس</span>}
                      {wasRev && <span className="text-[.7rem] font-semibold rounded-md px-1.5 py-0.5 bg-[#FBE9E7] text-[#a5322c]">معكوسة</span>}
                    </div>
                    <div className="text-xs text-muted">
                      {arDate(r.paid_on)}{r.receipt_no ? <> · <span dir="ltr">{r.receipt_no}</span></> : ""} · {isRev ? "سطر عكس" : methodLabel(r.method)}
                      {pc ? ` · ${isRev ? "يُلغي " : ""}${periodsAr(pc, period, isRev)}` : ""}
                    </div>
                    {[r.reference, r.note].filter(Boolean).length > 0 && <div className="text-xs text-muted break-words">{[r.reference, r.note].filter(Boolean).join(" · ")}</div>}
                  </div>
                  {!isRev && !wasRev && Number(r.amount) > 0 && (
                    <div className="flex flex-col gap-1">
                      <button type="button" className="btn btn-ghost text-xs px-2.5" onClick={() => onReceipt(r)}>سند</button>
                      <button type="button" className="btn btn-ghost text-xs px-2.5 text-late" onClick={() => onReverse(r)}>عكس</button>
                    </div>
                  )}
                  {!isRev && !wasRev && Number(r.amount) > 0 && onMullak && r.mullak_registered !== undefined && (
                    <div className="col-span-2"><MullakToggle p={r} onSet={onMullak} /></div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
      </div>
    </Overlay>
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

function CollectionsModal({ assoc, owners, only, fee, period = "monthly", stageOf, logOf, dueOf, onClose, onRemind, onNotice, onFinal }: {
  assoc: Association;
  owners: Owner[];
  only?: Owner;
  fee: number;
  period?: FeePeriod;
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
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
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
              <div className="w-full sm:w-64"><DateField value={feeApprovedOn} onChange={(v) => setFeeApprovedOn(v)} /></div>
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
                  <span className="text-sm font-bold text-late mr-auto">{sar(dueOf(o))} ريال · {periodsAr(o.months_late, period)}</span>
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
    </Overlay>
  );
}

function DocModal({ doc, onClose, onDelivered }: {
  doc: { title: string; body: string; kind?: "notice" | "final" | "file"; owner?: Owner };
  onClose: () => void;
  /** يُوثَّق الخطاب في «سجل المطالبات» فقط حين يُسلَّم فعلًا (لا عند فتحه) */
  onDelivered?: (via: "hand" | "wa") => Promise<void>;
}) {
  const [logged, setLogged] = useState<null | "hand" | "wa">(null);
  const deliver = async (via: "hand" | "wa") => {
    if (via === "wa" && doc.owner) openExternal(waLink(doc.owner.phone, doc.body));
    if (!logged && onDelivered) { await onDelivered(via); setLogged(via); }
  };
  const kind = doc.kind || "notice";
  const banner = kind === "file"
    ? <>هذا <b>ملف إداري مُجهَّز من بيانات لوحتك</b> ليستخدمه مدير العقار. رفع طلب السند التنفيذي في منصة «ملاك» واعتماده من الهيئة العامة للعقار ثم استكماله عبر «ناجز» — إجراءات يقوم بها <b>مدير العقار</b> نفسه. وثيق لا يرفع نيابةً عنك ولا يمثّلك أمام أي جهة ولا يستلم أي مبالغ.</>
    : kind === "final"
      ? <>هذا <b>إنذار إداري</b> تصدره إدارة الجمعية، وليس إنذارًا قضائيًّا ذا حجية تنفيذية. المسار النظامي يمرّ عبر منصة «ملاك» ثم محكمة التنفيذ أو الجهة المختصة. راجع النص مع مختص مرخّص قبل أي استخدام رسمي.</>
      : <>هذا <b>خطاب تذكير إداري</b> تستخدمه إدارة الجمعية، وليس إنذارًا نظاميًّا ذا حجية. المسار النظامي للتحصيل يمرّ عبر منصة «ملاك» ثم محكمة التنفيذ أو الجهة المختصة. وثيق لا يقدّم خدمات قانونية ولا يستلم أي مبالغ — راجع النص مع مختص مرخّص قبل أي استخدام رسمي.</>;
  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-lg mb-1">{doc.title}</h3>
        <p className="text-xs text-[#8a5a11] mb-4 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5 leading-relaxed">
          {banner}
        </p>
        <pre className="whitespace-pre-wrap bg-paper border border-line rounded-xl p-4 text-sm leading-8 text-ink" style={{ fontFamily: "inherit" }}>{doc.body}</pre>
        {onDelivered && (
          <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-2 mt-4">
            <button type="button" className="btn btn-gold justify-center" disabled={!!logged} onClick={() => deliver("hand")}>
              {logged ? "وُثّق في سجل المطالبات ✓" : "✓ سلّمته للمالك — وثّق التاريخ"}</button>
            <button type="button" className="btn btn-wa justify-center" onClick={() => deliver("wa")}>إرسال للمالك عبر واتساب{logged ? "" : " وتوثيقه"}</button>
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => navigator.clipboard?.writeText(doc.body)} className="btn btn-primary flex-1 justify-center">نسخ النص</button>
          <button type="button" onClick={() => openDoc('<!doctype html><html dir="rtl"><meta charset="utf-8"><body><pre style="font-family:sans-serif;white-space:pre-wrap;padding:24px;line-height:1.9">' + doc.body.replace(/</g, "&lt;") + "</pre></body></html>")} className="btn btn-ghost flex-1 justify-center">طباعة</button>
          <button type="button" onClick={onClose} className="btn text-muted">إغلاق</button>
        </div>
      </div>
    </Overlay>
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
function RenewalModal({ assoc, annualBudget, onClose, onEditBudget, onPrintBudget, onPrintMinutes, onSendMinutes }: {
  assoc: Association; annualBudget: number | null; onClose: () => void;
  onEditBudget: () => void; onPrintBudget: () => void; onPrintMinutes: (d: any) => void; onSendMinutes?: (d: any) => void;
}) {
  const units = Number(assoc.units) || (Array.isArray(assoc.owners) ? assoc.owners.length : 0);
  const nextYear = Number(today().slice(0, 4)) + 1;   /* سنة الرياض لا الجهاز */
  const per = periodOf(assoc);
  const att = useAttendance(assoc);
  const [d, setD] = useState<any>({
    meeting_date: today(), mode: "حضوري", place: "",
    attendees: "", total_units: units || "",
    president: "", manager: "", fee: assoc.fee || "",
    year: nextYear, annual_budget: annualBudget ?? "",
    collected: "", spent: "", fund_balance: assoc.fund_balance ?? "", notes: "",
  });
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  const out = () => ({ ...d, ...att.payload(d) });

  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
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
                <DateField value={d.meeting_date} onChange={(v) => set("meeting_date", v)} />
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
                <input className="fld" type="number" min={0} disabled={att.track} value={att.track ? "" : d.attendees}
                  placeholder={att.track ? "من قائمة الحضور" : ""} onChange={(e) => set("attendees", e.target.value)} />
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
              <Field label={basisOf(assoc) === "share" ? "الرسوم حسب حصة كل وحدة" : `${PERIOD_WORDS[per].label} للوحدة (ريال)`}>
                <input className="fld" type="number" min={0} value={d.fee} disabled={basisOf(assoc) === "share"} onChange={(e) => set("fee", e.target.value)} />
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
            <AttendanceBlock att={att} d={d} items={["تقرير أعمال العام", "الموقف المالي", "اعتماد الموازنة التقديرية", "اشتراك الصيانة", "مدير العقار", "قرار الرسوم في «ملاك»", ...(d.notes ? ["البنود الإضافية"] : [])]} />
          </div>
          <p className="text-xs text-[#8a5a11] mt-3 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5 leading-relaxed">
            <b>لا تُثبت وقائع لم تقع.</b> اترك الحضور والأسماء فراغات إن لم يُعقد الاجتماع بعد، ولا تعلّم «أُقرّ البند» إلا لما صُوّت عليه فعلًا.
            المحضر مستند يُرفع لجهة رسمية، وإثبات ما لم يحصل يُعرّض مُصدِره للمساءلة. وثيق لا يقدّم خدمات قانونية — طابقه مع النظام الأساسي المعتمد.
          </p>

          <button type="button" className="btn btn-gold text-sm w-full justify-center mt-3" onClick={() => onPrintMinutes(out())}>
            🖨 إنشاء محضر الاجتماع السنوي
          </button>
          {onSendMinutes && <button type="button" className="btn btn-ghost text-sm w-full justify-center mt-2" onClick={() => onSendMinutes(out())}>
            📨 إرساله للملاك للاطّلاع والاعتماد
          </button>}
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
    </Overlay>
  );
}

/** حضور الاجتماع بالأسماء والحصص — يُحتسب منه النصاب (lib/documents: hoaQuorum) */
function useAttendance(assoc: Association) {
  const owners = Array.isArray(assoc.owners) ? assoc.owners : [];
  const [track, setTrack] = useState(false);
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [round, setRound] = useState<1 | 2>(1);
  /** «عُقد الاجتماع وأُقرّ البند» لكل بند — بلا علامة يُطبع القرار فراغًا */
  const [approved, setApproved] = useState<boolean[]>([]);
  const list: HoaAttendance[] = owners.map((o) => ({ name: o.name, unit: o.unit, share_pct: o.share_pct ?? null, present: !!present[o.id] }));
  const quorum = (d: any) => hoaQuorum({ attendance: track ? list : null, attendees: d.attendees, total_units: d.total_units, round,
    first_pct: assoc.quorum_first_pct, second_pct: assoc.quorum_second_pct });
  return {
    owners, track, setTrack, present, setPresent, round, setRound, list, approved, setApproved, quorum,
    firstPct: Number(assoc.quorum_first_pct) > 0 ? Number(assoc.quorum_first_pct) : 75,
    secondPct: Number(assoc.quorum_second_pct) > 0 ? Number(assoc.quorum_second_pct) : null,
    payload: (d: any) => ({
      attendance: track ? list : undefined, round, attendees: track ? String(list.filter((x) => x.present).length) : d.attendees,
      approved: quorum(d).met === true ? approved : [],
      fee_period: assoc.fee_period || "monthly", fee_basis: assoc.fee_basis || "equal",
    }),
  };
}

function AttendanceBlock({ att, d, items }: { att: ReturnType<typeof useAttendance>; d: any; items?: string[] }) {
  const q = att.quorum(d);
  const hasShares = att.owners.length > 0 && att.owners.every((o) => Number(o.share_pct) > 0);
  const pct = q.pct === null ? "—" : `${q.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}٪`;
  return (
    <div className="rounded-xl border border-line p-3 space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="الاجتماع">
          <select className="fld" value={att.round} onChange={(e) => att.setRound(Number(e.target.value) === 2 ? 2 : 1)}>
            <option value={1}>الأول — {att.firstPct}٪ من الحصص</option>
            <option value={2}>الثاني — {att.secondPct ? `${att.secondPct}٪ من الحصص` : "أي عدد"}</option>
          </select>
        </Field>
        {att.owners.length > 0 ? (
          <label className="flex items-center gap-2 text-sm font-semibold self-end pb-2 cursor-pointer">
            <input type="checkbox" checked={att.track} onChange={(e) => att.setTrack(e.target.checked)} />
            تسجيل الحضور بالأسماء
          </label>
        ) : <div />}
      </div>
      {att.track && (
        <div className="max-h-56 overflow-auto border border-line rounded-lg divide-y divide-line">
          {att.owners.map((o) => (
            <label key={o.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={!!att.present[o.id]} onChange={(e) => att.setPresent({ ...att.present, [o.id]: e.target.checked })} />
              <span className="truncate">{o.name}{o.unit ? ` · ${o.unit}` : ""}</span>
              <span className="text-xs text-muted tabular-nums">{o.share_pct != null ? `${Number(o.share_pct)}٪` : "—"}</span>
            </label>
          ))}
        </div>
      )}
      {att.track && !hasShares && <p className="text-xs text-[#8a5a11]">لم تُدخل حصص كل الملاك — يُحتسب النصاب بعدد الوحدات ويُذكر ذلك في المحضر.</p>}
      <div className={`text-xs rounded-lg p-2 font-semibold ${q.met === true ? "bg-[#E6F4EC] text-[#137a50]" : q.met === false ? "bg-[#FBE9E7] text-[#a5322c]" : "bg-paper2 text-muted"}`}>
        {q.met === true ? `النصاب متحقق ✓ — ${q.basis === "shares" ? `الحاضرون يملكون ${pct} من الحصص` : `حضر ${q.present} من ${q.total} (${pct})`}`
          : q.met === false ? `النصاب غير متحقق ✗ — ${q.basis === "shares" ? `${pct} من الحصص` : `${q.present} من ${q.total} (${pct})`}. لن تُطبع القرارات كمعتمدة، ويُدعى لاجتماع ثانٍ.`
          : "النصاب يُحتسب عند إدخال الحضور — قبل الاجتماع تُطبع القرارات فراغات تُدوَّن بعد التصويت."}
      </div>
      <p className="text-[.7rem] text-muted">النسب حسب النظام الأساسي للجمعية (من الإعدادات).</p>
      {items && items.length > 0 && (
        <div className="rounded-lg border border-line p-2.5">
          <div className="text-xs font-semibold mb-1.5">البنود المُقرّة فعلًا {q.met === true ? "" : <span className="text-muted font-normal">(تُفعَّل بعد تحقق النصاب)</span>}</div>
          {items.map((label, i) => (
            <label key={i} className={`flex items-start gap-2 text-xs py-1 ${q.met === true ? "cursor-pointer" : "opacity-50"}`}>
              <input type="checkbox" className="mt-0.5" disabled={q.met !== true} checked={!!att.approved[i + 1]}
                onChange={(e) => { const x = [...att.approved]; x[i + 1] = e.target.checked; att.setApproved(x); }} />
              <span>عُقد الاجتماع وأُقرّ البند: {label}</span>
            </label>
          ))}
          <p className="text-[.7rem] text-muted mt-1">ما لم تُعلَّم يُطبع قراره فراغًا يُدوَّن بعد التصويت — لا يُثبت المحضر ما لم يقع.</p>
        </div>
      )}
    </div>
  );
}

/** توزيع الرسوم حسب الحصص — معاينة كاملة قبل التطبيق (نفس حساب القاعدة بالهللة) */
function SharesModal({ assoc, onClose, onShare, onApplied, notify }: {
  assoc: Association; onClose: () => void;
  onShare: (o: Owner, share: number | null, area: number | null) => Promise<boolean>;
  onApplied: (r: any) => void; notify: (k: "ok" | "err", m: string) => void;
}) {
  const supabase = createClient();
  const owners = Array.isArray(assoc.owners) ? assoc.owners : [];
  const per = periodOf(assoc);
  const W = PERIOD_WORDS[per];
  const [total, setTotal] = useState<string>(assoc.total_budget != null ? String(assoc.total_budget) : "");
  const [rows, setRows] = useState(() => owners.map((o) => ({ id: o.id, share: o.share_pct != null ? String(o.share_pct) : "", area: o.area_m2 != null ? String(o.area_m2) : "" })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tot = r2(Number(total) || 0);
  const sum = sharesSum(rows.map((r) => r.share));
  const allHave = rows.length > 0 && rows.every((r) => Number(r.share) > 0);
  const ok = allHave && sharesValid(sum) && tot > 0;
  const newFee = (r: { share: string }) => shareFee(tot, Number(r.share) || 0, per);
  const totalFees = r2(rows.reduce((s, r) => s + newFee(r), 0));
  const setRow = (i: number, patch: Partial<{ share: string; area: string }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const fromAreas = () => {
    const sh = sharesFromAreas(rows.map((r) => Number(r.area) || 0));
    if (!sh.some((x) => x > 0)) return setErr("أدخل مساحة كل وحدة أولًا.");
    setErr(null); setRows(rows.map((r, i) => ({ ...r, share: sh[i] ? String(sh[i]) : "" })));
  };
  const saveShares = async (): Promise<boolean> => {
    for (let i = 0; i < rows.length; i++) {
      const o = owners[i], r = rows[i];
      const sh = r.share.trim() === "" ? null : Math.round(Number(r.share) * 10000) / 10000;
      const ar = r.area.trim() === "" ? null : r2(Number(r.area));
      if ((sh ?? null) !== (o.share_pct == null ? null : Number(o.share_pct)) || (ar ?? null) !== (o.area_m2 == null ? null : Number(o.area_m2))) {
        if (!(await onShare(o, sh, ar))) return false;
      }
    }
    return true;
  };
  const apply = async () => {
    if (!ok || busy) return;
    if (!confirm(`تطبيق رسوم الحصص على ${owners.length} مالك (إجمالي ${sar(totalFees)} ريال ${W.every})؟ يبقى رصيد كل مالك بالريال كما هو.`)) return;
    setBusy(true); setErr(null);
    try {
      if (!(await saveShares())) return;
      const { data, error } = await supabase.rpc("watheq_assoc_apply_shares", { p_assoc: assoc.id, p_total_budget: tot });
      if (error) { setErr(dbErr(String(error.message || ""))); return; }
      onApplied(data); notify("ok", "وُزّعت الرسوم حسب الحصص — رصيد كل مالك بالريال كما هو."); onClose();
    } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-5 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1 flex items-center">⚖️ توزيع الرسوم حسب الحصص<InfoTip term="الحصة" /></h3>
        <p className="text-sm text-muted mb-3">رسم الوحدة {W.every} = الموازنة السنوية × حصتها ÷ {per === "annual" ? "100" : "100 ÷ 12"}. مجموع الحصص يجب أن يساوي 100٪. رصيد كل مالك بالريال لا يتغيّر.</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="الموازنة السنوية (ريال)">
            <input className="fld" type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} />
          </Field>
          <div className={`rounded-xl p-2.5 text-center self-end ${sharesValid(sum) && allHave ? "bg-[#E6F4EC] text-[#137a50]" : "bg-[#FBE9E7] text-[#a5322c]"}`}>
            <div className="font-display font-bold tabular-nums">{sum.toLocaleString("en-US", { maximumFractionDigits: 4 })}٪</div>
            <div className="text-[.7rem]">مجموع الحصص</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          <button type="button" className="btn btn-ghost text-xs" onClick={fromAreas}>احسب الحصص من المساحات</button>
        </div>
        <div className="flex flex-col gap-2">
          {owners.map((o, i) => {
            const cur = feeOf(o, assoc), nf = newFee(rows[i]);
            return (
              <div key={o.id} className="rounded-xl border border-line p-2.5 grid grid-cols-[minmax(0,1fr)_76px_76px] gap-2 items-end">
                <div className="min-w-0 self-center">
                  <div className="font-semibold text-sm truncate">{o.name}</div>
                  <div className="text-xs text-muted tabular-nums">{o.unit ? `وحدة ${o.unit} · ` : ""}الآن {sar(cur)} ← <b className={nf !== cur ? "text-deep" : ""}>{tot > 0 && Number(rows[i].share) > 0 ? sar(nf) : "—"}</b>{W.per}</div>
                </div>
                <label className="block min-w-0"><span className="block text-[.7rem] text-muted">م²</span>
                  <input className="fld text-xs px-2" type="number" inputMode="decimal" min={0} value={rows[i].area} onChange={(e) => setRow(i, { area: e.target.value })} /></label>
                <label className="block min-w-0"><span className="block text-[.7rem] text-muted">الحصة ٪</span>
                  <input className="fld text-xs px-2" type="number" inputMode="decimal" min={0} max={100} step="0.0001" value={rows[i].share} onChange={(e) => setRow(i, { share: e.target.value })} /></label>
              </div>
            );
          })}
          {!owners.length && <div className="text-center text-muted text-sm py-6">أضف الملاك أولًا.</div>}
        </div>
        {tot > 0 && allHave && (
          <p className="text-xs text-muted mt-3">مجموع رسوم الوحدات {sar(totalFees)} ريال {W.every} ({sar(r2(totalFees * (per === "annual" ? 1 : 12)))} ريال سنويًّا مقابل موازنة {sar(tot)}) — الفرق هللات تقريب لكل وحدة.</p>
        )}
        {!allHave && owners.length > 0 && <p className="text-xs text-late mt-3">أدخل حصة أكبر من صفر لكل مالك.</p>}
        {allHave && !sharesValid(sum) && <p className="text-xs text-late mt-3">مجموع الحصص {sum}٪ — يجب أن يساوي 100٪ (بفارق لا يتجاوز 0.01).</p>}
        {err && <p className="text-sm text-late mt-3">{err}</p>}
        <div className="flex gap-2 mt-5 flex-wrap">
          <button type="button" className="btn btn-ghost flex-1 justify-center" disabled={busy} onClick={onClose}>إغلاق</button>
          <button type="button" className="btn btn-primary flex-1 justify-center" disabled={busy}
            onClick={async () => { setBusy(true); setErr(null); try { if (await saveShares()) notify("ok", "حُفظت الحصص والمساحات (لم تتغيّر الرسوم بعد)."); } finally { setBusy(false); } }}>حفظ الحصص فقط</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!ok || busy} onClick={apply}>{busy ? "جارٍ التطبيق…" : "تطبيق التوزيع"}</button>
        </div>
      </div>
    </Overlay>
  );
}

/** «حدّد المتأخرات الافتتاحية» — شاشة واحدة لكل الملاك الجدد (v64) */
function OpeningModal({ owners, period, onClose, onSave }: {
  owners: Owner[]; period: FeePeriod; onClose: () => void; onSave: (vals: Record<string, number>) => Promise<void>;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const parsed: Record<string, number> = {};
  owners.forEach((o) => {
    const v = String(vals[o.id] ?? "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).trim();
    if (v !== "" && /^\d{1,3}$/.test(v) && Number(v) <= 120) parsed[o.id] = Number(v);
  });
  const n = Object.keys(parsed).length;
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-5 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1 flex items-center">حدّد المتأخرات الافتتاحية<InfoTip term="الرصيد الافتتاحي" /></h3>
        <p className="text-sm text-muted mb-3">كم {period === "annual" ? "سنة" : "شهرًا"} على كل مالك قبل بدء التسجيل هنا؟ اكتب <b>0</b> لمن لا متأخرات عليه.
          لا يُحفظ إلا ما تكتبه، ويُوثَّق كتعديل يدوي. حتى يُحدَّد، تُظهر صفحة المالك «رصيدك قيد المراجعة».</p>
        <div className="flex flex-col gap-2">
          {owners.map((o) => (
            <label key={o.id} className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-2 rounded-xl border border-line p-2.5">
              <span className="min-w-0"><span className="block font-semibold text-sm truncate">{o.name}</span>
                <span className="block text-xs text-muted">{o.unit ? `وحدة ${o.unit}` : "—"}</span></span>
              <input className="fld text-center" type="number" inputMode="numeric" min={0} max={120} placeholder="—"
                aria-label={`المتأخر الافتتاحي — ${o.name}`} value={vals[o.id] ?? ""} onChange={(e) => setVals({ ...vals, [o.id]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          <button type="button" className="btn btn-ghost flex-1 justify-center" disabled={busy} onClick={onClose}>لاحقًا</button>
          <button type="button" className="btn btn-ghost flex-1 justify-center" disabled={busy}
            onClick={() => { const z: Record<string, string> = { ...vals }; owners.forEach((o) => { if (!String(z[o.id] ?? "").trim()) z[o.id] = "0"; }); setVals(z); }}>البقية بلا متأخرات (0)</button>
          <button type="button" className="btn btn-gold flex-1 justify-center" disabled={busy || !n}
            onClick={async () => { setBusy(true); try { await onSave(parsed); } finally { setBusy(false); } }}>{busy ? "جارٍ الحفظ…" : `حفظ (${n})`}</button>
        </div>
      </div>
    </Overlay>
  );
}

/** لصق قائمة ملّاك — سطر لكل مالك: «الاسم، الوحدة، الجوال» بأي فاصل شائع */
function BulkOwnersModal({ onClose, onSubmit }: {
  onClose: () => void; onSubmit: (rows: { name: string; unit: string | null; phone: string | null; months?: number | null }[]) => void;
}) {
  const [text, setText] = useState("");

  /** يحلّل كل سطر: يقبل الفاصلة العربية/الإنجليزية أو Tab أو الشرطة */
  const rows = text.split(/\n+/).map((line) => {
    const raw = line.split(/[،,\t]| - /).map((s) => s.trim());
    /* العمود الرابع اختياري: «المتأخر بالأشهر» — عدد صحيح 0–120 في الخانة الرابعة */
    let months: number | null = null;
    if (raw.length >= 4) {
      const m4 = String(raw[3]).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
      if (/^\d{1,3}$/.test(m4) && Number(m4) <= 120) { months = Number(m4); raw.splice(3, 1); }
    }
    const parts = raw.filter(Boolean);
    if (!parts.length) return null;
    // يلتقط الجوال (أرقام 9+) والوحدة (رقم/رمز قصير) أينما وُضعا
    let name = "", unit: string | null = null, phone: string | null = null;
    for (const p of parts) {
      const digits = p.replace(/[^0-9+]/g, "");
      if (!phone && digits.length >= 9 && digits.length >= p.length - 3) phone = p;
      else if (!unit && p.length <= 6 && /[0-9]/.test(p)) unit = p;
      else name = name ? `${name} ${p}` : p;
    }
    return name ? { name, unit, phone, months } : null;
  }).filter(Boolean) as { name: string; unit: string | null; phone: string | null; months: number | null }[];

  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">📋 إضافة ملّاك دفعة واحدة</h3>
        <p className="text-sm text-muted mb-3">
          الصق قائمتك — سطر لكل مالك بصيغة: <b>الاسم، الوحدة، الجوال، المتأخر بالأشهر</b> (كلها اختيارية بعد الاسم؛ المتأخر رقم في الخانة الرابعة).
        </p>
        <textarea className="fld min-h-[180px] font-mono text-sm leading-relaxed" dir="rtl"
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"محمد العتيبي، 101، 05XXXXXXXX، 2\nسارة القحطاني، 102، ، 0\nخالد الشمري"} />

        {rows.length > 0 && (
          <div className="bg-paper2 border border-line rounded-xl p-3 mt-3 text-xs max-h-[160px] overflow-auto">
            <div className="font-semibold text-deep mb-1.5">معاينة — سيُضاف {rows.length} مالكًا:</div>
            {rows.slice(0, 30).map((r, i) => (
              <div key={i} className="flex gap-2 py-0.5 border-b border-dashed border-line last:border-0">
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-muted">{r.unit ? `وحدة ${r.unit}` : "—"}</span>
                <span className="text-muted tabular-nums">{r.phone || "—"}</span>
                <span className="text-muted tabular-nums">{r.months != null ? `متأخر ${r.months}` : "رصيد لاحقًا"}</span>
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
    </Overlay>
  );
}

/** تذكير جماعي — يفتح واتساب لكل متأخر واحدًا تلو الآخر مع تتبّع من أُرسل له */
function RemindAllOwnersModal({ owners, dueOf, period, onSend, sentToday, onClose }: {
  owners: Owner[]; dueOf: (o: Owner) => number; period: FeePeriod; onSend: (o: Owner) => Promise<void>;
  /** «أُرسل» من سجل التواصل (تذكير موثَّق اليوم) — لا من حالة محلية تضيع عند الإغلاق */
  sentToday: (o: Owner) => boolean; onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const withPhone = owners.filter((o) => o.phone);
  const sentCount = withPhone.filter(sentToday).length;
  const noPhone = owners.length - withPhone.length;

  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-xl mb-1">💬 تذكير جماعي بالسداد</h3>
        <p className="text-sm text-muted mb-4">
          واتساب لا يسمح بالإرسال الجماعي الآلي — كل زر يفتح محادثة برسالة جاهزة بتفاصيل المالك ورابط صفحته،
          ويُوثَّق التذكير في سجل العمارة. أُرسل اليوم {sentCount} من {withPhone.length}.
        </p>
        <div className="flex flex-col gap-2">
          {withPhone.map((o) => {
            const sent = sentToday(o);
            return (
              <div key={o.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-3 ${sent ? "border-[#B7DFC7] bg-[#F2FAF5]" : "border-line bg-paper"}`}>
                <div className="min-w-0">
                  <div className="font-semibold truncate text-sm">{o.name}</div>
                  <div className="text-xs text-muted">{o.unit ? `وحدة ${o.unit} · ` : ""}{periodsAr(o.months_late, period)} · {sar(dueOf(o))} ريال{sent ? " · ✓ أُرسل اليوم" : ""}</div>
                </div>
                <button type="button" className="btn btn-wa text-xs" disabled={busy === o.id}
                  onClick={async () => { setBusy(o.id); try { await onSend(o); } finally { setBusy(null); } }}>{sent ? "إعادة" : "فتح واتساب"}</button>
              </div>
            );
          })}
          {!withPhone.length && <div className="text-center text-muted text-sm py-6">لا يوجد متأخرون لديهم أرقام جوال مسجّلة.</div>}
        </div>
        {noPhone > 0 && (
          <p className="text-xs text-[#8a5a11] mt-3 bg-[#FBF1DF] border border-[#EBD9AA] rounded-lg p-2.5">
            {ownersAr(noPhone)} متأخرون بلا رقم جوال — أضف أرقامهم من «تعديل البيانات» ليظهروا هنا.
          </p>
        )}
        <button type="button" className="btn btn-ghost w-full justify-center mt-4" onClick={onClose}>إغلاق</button>
      </div>
    </Overlay>
  );
}
