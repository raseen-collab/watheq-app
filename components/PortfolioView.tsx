"use client";
// ============================================================
// وثيق — نظرة عامة على المحفظة: كل العقارات في صفحة واحدة
//
// لمكتب بعشرين أو ثلاثين عقارًا: فتح كل عقار على حدة لمعرفة من تأخّر
// ليس عملًا بل عقابًا. هنا: أرقام المحفظة كلها، ثم كل ما يحتاج إجراءً
// من كل العقارات في قوائم واحدة، ثم جدول العقارات بأرقامها، وبحث واحد
// يجد أي مستأجر بالاسم أو الجوال أو الهوية أو رقم العقد أو العداد.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchAllRows } from "@/lib/fetch-all";
import { createClient } from "@/lib/supabase-client";
import { contractState, isVacant, splitVat, unitVatApplies, dueWithVat, type Frequency } from "@/lib/contracts";
import { annualRentRoll } from "@/lib/income";
import { isPartialOnly, renewalDue } from "@/lib/contract-state";
import { sar, waLink, today, daysAr, normalizeSearch } from "@/lib/utils";
import { arDate } from "@/lib/documents";
import { endNoticeText } from "@/lib/tenant-messages";
import { getOffice } from "@/lib/office";
import { alertCount, complianceState, KIND_META, type ComplianceItem } from "@/lib/compliance";
import ComplianceModal from "@/components/ComplianceModal";
import { hijriShort } from "@/lib/hijri";
import ExpensesOverview from "@/components/ExpensesOverview";

type Tenant = any; type Property = any;
const PER_MONTH: Record<string, number> = { daily: 30, weekly: 4.33, monthly: 1, quarterly: 1 / 3, trimester: 1 / 4, semiannual: 1 / 6, annual: 1 / 12 };
const UNIT_AR: Record<string, string> = { residential: "شقة", commercial: "محل", office: "مكتب", warehouse: "مستودع", land: "أرض", villa: "فيلا" };

export default function PortfolioView({ properties, windows, compliance, orgName = "", issuer = {} }: {
  properties: Property[];
  windows: { soon: number; imminent: number; expiring: number };
  /** التزامات المكتب — انتقلت من قائمة «مستندات» في صفحة العقار: للمكتب كله لا لعقار */
  compliance?: ComplianceItem[]; orgName?: string; issuer?: any;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [comp, setComp] = useState<ComplianceItem[]>(compliance || []);
  const [compOpen, setCompOpen] = useState(false);
  /* صلاحية إدارة الالتزامات — كما في صفحة العقار (الحماية الحقيقية في القاعدة) */
  const [canComp, setCanComp] = useState(true);
  useEffect(() => { getOffice(supabase).then((o) => setCanComp(o?.isOwner !== false || (o?.perms || {}).manage_compliance !== false)); }, [supabase]);
  /* مصروفات الشهر لكل العقارات: على المالك، وعلى المكتب */
  const [expMonth, setExpMonth] = useState<{ owner: number; office: number } | null>(null);
  const [q, setQ] = useState("");
  /**
   * «يحتاج إجراء» كان يقصّ عند ١٢ ويقول «افتح كل عقار لرؤيتهم» — وهذا
   * يُبطل الغرض من الشاشة: صاحب المكتب جاء ليرى كل شيء في مكان واحد لا
   * ليفتح عشرين عقارًا. والأسوأ أن «مستحق» و«تنتهي قريبًا» كانتا تُقصّان
   * بلا أي تنبيه، فلا يعلم أن هناك المزيد.
   *
   * الآن: يُعرض اثنا عشر أولًا (حتى تبقى الشاشة قابلة للمسح بالعين)،
   * وزرّ واحد يفتح البقية في مكانها.
   */
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const CAP = 12;
  const More = ({ k, n }: { k: string; n: number }) =>
    n <= CAP ? null : (
      <button type="button" onClick={() => setShowAll((s) => ({ ...s, [k]: !s[k] }))}
        className="text-[11px] underline underline-offset-4 opacity-90 hover:opacity-100 mt-1">
        {showAll[k] ? "إخفاء" : `عرض الباقي (${n - CAP})`}
      </button>
    );
  const cut = <T,>(k: string, arr: T[]) => (showAll[k] ? arr : arr.slice(0, CAP));
  const [monthCollected, setMonthCollected] = useState<Record<string, number> | null>(null);
  /* تحصيل اليوم وأمس (10 أكتوبر 2026 — طلب مكتب التميز: «صاحب المكتب يبغى يشوف تحصيل
     اليوم أو أمس»). من الاستعلام نفسه، بتاريخ الدفع (paid_on) كما في «المحصَّل هذا الشهر»،
     والتراجعات (مبالغ سالبة) تُطرح فيساوي الرقمُ ما بقي فعلًا. */
  const [dayPays, setDayPays] = useState<{ today: any[]; yesterday: any[] } | null>(null);
  const [dayOpen, setDayOpen] = useState<null | "today" | "yesterday" | "custom">(null);
  /* أي يوم يختاره المكتب — استعلام مستقل لذلك اليوم وحده */
  const [pickDate, setPickDate] = useState("");
  const [pickPays, setPickPays] = useState<any[] | null>(null);
  const [pickErr, setPickErr] = useState("");
  useEffect(() => {
    if (!pickDate) { setPickPays(null); return; }
    const ids = properties.map((p) => p.id);
    if (!ids.length) { setPickPays([]); return; }
    let live = true;
    setPickPays(null); setPickErr("");
    fetchAllRows(supabase as any, "payments", "id, property_id, tenant_id, amount, paid_on, method, created_at", (q) => q.in("property_id", ids).eq("paid_on", pickDate))
      .then((data) => { if (live) setPickPays([...data].sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))); })
      .catch((e) => { if (live) setPickErr(e?.message || "تعذّر التحميل"); });
    return () => { live = false; };
  }, [pickDate, properties, supabase]);
  const [expOpen, setExpOpen] = useState(false);
  /* جدول العقارات بلا ترقيم: مكتب بمئة عقار يرسم 100 صف دفعة واحدة ويطيل
     الصفحة بلا فائدة — الأهم أعلاها (مرتّبة بالأكثر متأخرات). */
  const [propsShown, setPropsShown] = useState(25);

  // المحصَّل هذا الشهر لكل عقار — استعلام واحد لكل المحفظة
  useEffect(() => {
    /* حدود الشهر بتوقيت الرياض، حتى اليوم — كصفحة العقار، فيساوي المجموعُ مجموعَ خلاياها */
    const to = today(), from = `${to.slice(0, 7)}-01`;
    /* أمس بتوقيت الرياض: حساب على التاريخ نفسه (UTC) فلا ينزاح يومًا مع فرق التوقيت */
    const yd = new Date(`${to}T00:00:00Z`); yd.setUTCDate(yd.getUTCDate() - 1);
    const yesterday = yd.toISOString().slice(0, 10);
    const qFrom = yesterday < from ? yesterday : from;
    const ids = properties.map((p) => p.id);
    if (!ids.length) { setMonthCollected({}); setExpMonth({ owner: 0, office: 0 }); setDayPays({ today: [], yesterday: [] }); return; }
    fetchAllRows(supabase as any, "expenses", "id, amount, billable", (q) => q.in("property_id", ids).gte("spent_on", from).lte("spent_on", to))
      .then((data) => { let owner = 0, office = 0;
        data.forEach((e: any) => { if (e.billable === false) office += Number(e.amount) || 0; else owner += Number(e.amount) || 0; });
        setExpMonth({ owner, office }); })
      .catch((e) => console.error("month expenses", e?.message));
    /* على دفعات، والفشل يُبقي «…» — كان يعرض «0 محصَّل» رقمًا خاطئًا */
    fetchAllRows(supabase as any, "payments", "id, property_id, tenant_id, amount, paid_on, method, created_at", (q) => q.in("property_id", ids).gte("paid_on", qFrom).lte("paid_on", to))
      .then((data) => {
        const m: Record<string, number> = {};
        const td: any[] = [], yy: any[] = [];
        data.forEach((x: any) => {
          const d = String(x.paid_on || "").slice(0, 10);
          if (d >= from) m[x.property_id] = (m[x.property_id] || 0) + (Number(x.amount) || 0);
          if (d === to) td.push(x); else if (d === yesterday) yy.push(x);
        });
        const byTime = (a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || ""));
        setMonthCollected(m);
        setDayPays({ today: td.sort(byTime), yesterday: yy.sort(byTime) });
      })
      .catch((e) => console.error("month collected", e?.message));
  }, [properties, supabase]);

  const rows = useMemo(() => {
    const out: { p: Property; t: Tenant; st: ReturnType<typeof contractState> }[] = [];
    properties.forEach((p) => (p.tenants || []).forEach((t: Tenant) => {
      const st = contractState(t, {
        graceDays: Number(p.grace_days) || 0,
        soonDays: Number(p.soon_days) || windows.soon,
        imminentDays: Number(p.imminent_days) || windows.imminent,
        expiringDays: Number(p.expiring_days) || windows.expiring,
      });
      out.push({ p, t, st });
    }));
    return out;
  }, [properties, windows]);

  const totals = useMemo(() => {
    const T = { units: 0, vacant: 0, late: 0, overdue: 0, due: 0, soon: 0, expiring: 0, partial: 0, monthly: 0, litigation: 0 };
    rows.forEach(({ p, t, st }) => {
      T.units++;
      if (isVacant(t)) { T.vacant++; return; }
      if (t.litigation) T.litigation++;
      else if (st.status === "late") { isPartialOnly(st) ? T.partial++ : T.late++; T.overdue += dueWithVat(st, t, p); }
      else if (st.status === "soon") { st.soonTier === "near" ? T.soon++ : T.due++; }
      if (renewalDue(t, st)) T.expiring++;
      T.monthly += (Number(t.rent_amount) || 0) * (PER_MONTH[t.payment_frequency || "monthly"] || 1);
    });
    return T;
  }, [rows]);
  const collectedTotal = monthCollected ? Object.values(monthCollected).reduce((a, b) => a + b, 0) : null;

  // ---------- البحث الشامل ----------
  /* توحيد الطرفين (30 سبتمبر 2026): كانت الأرقام العربية تُحوَّل في النص المبحوث وحده،
     و«مني/منى» و«فاطمه/فاطمة» و«احمد/أحمد» لا تتطابق — نفس توحيد صفحة العقار */
  const needle = normalizeSearch(q);
  const hits = needle.length >= 2 ? rows.filter(({ p, t }) =>
    [t.name, t.unit, t.phone, t.national_id, t.contract_no, t.elec_account, t.water_account, p.name]
      .some((v) => v && normalizeSearch(v).includes(needle))) : [];

  const late = rows.filter(({ t, st }) => !isVacant(t) && !t.litigation && st.status === "late").sort((a, b) => dueWithVat(b.st, b.t, b.p) - dueWithVat(a.st, a.t, a.p));
  const due = rows.filter(({ t, st }) => !isVacant(t) && st.status === "soon" && st.soonTier !== "near").sort((a, b) => (a.st.daysToNextDue ?? 0) - (b.st.daysToNextDue ?? 0));
  /* المنتهي (أيام سالبة) أولًا ثم الأقرب انتهاءً */
  const expiring = rows.filter(({ t, st }) => renewalDue(t, st)).sort((a, b) => (a.st.daysToEnd ?? 0) - (b.st.daysToEnd ?? 0));
  const vacant = rows.filter(({ t }) => isVacant(t));

  const perProperty = properties.map((p) => {
    const mine = rows.filter((r) => r.p.id === p.id);
    const occ = mine.filter((r) => !isVacant(r.t));
    return {
      p, units: mine.length, occupied: occ.length,
      late: occ.filter((r) => r.st.status === "late" && !r.t.litigation).length,
      /* نفس قاعدة arrearsOf التي تحسب بها إجماليات الأعلى — كان العمود
         يضمّ وحدات التنفيذ فيخالف الإجمالي فوقه في الصفحة نفسها */
      overdue: occ.reduce((a, r) => a + (!r.t.litigation && r.st.status === "late" ? dueWithVat(r.st, r.t, r.p) : 0), 0),
      due: occ.filter((r) => r.st.status === "soon").length,
      expiring: occ.filter((r) => renewalDue(r.t, r.st)).length,
      monthly: occ.reduce((a, r) => a + (Number(r.t.rent_amount) || 0) * (PER_MONTH[r.t.payment_frequency || "monthly"] || 1), 0),
      collected: monthCollected?.[p.id] ?? null,
    };
  }).sort((a, b) => b.overdue - a.overdue || b.late - a.late || a.p.name.localeCompare(b.p.name, "ar"));

  const remind = (p: Property, t: Tenant, st: any) =>
    /* (مراجعة 29 سبتمبر 2026) كانت: «الدفعة المستحقة … بمبلغ amountDue» — مفردًا
       ولو تأخّرت ثلاث دفعات، وبلا الضريبة المضافة فوق الإيجار، وبلا الدين
       المرحَّل، وبلا توقيع. الآن كتذكير لوحة العقار. */
    (() => {
      const v = { enabled: unitVatApplies(t, p), rate: Number((p as any).vat_rate) || 15, inclusive: (p as any).vat_inclusive !== false };
      const rentOwed = v.enabled ? splitVat(Number(st.amountDue) || 0, v).total : (Number(st.amountDue) || 0);
      const carried = Math.max(0, Number((t as any).carried_debt) || 0);
      const n = Number(st.unpaid) || 0;
      const what = n > 1 ? `${n} دفعات مستحقة` : "الدفعة المستحقة";
      const who = issuer?.billing_name || orgName || (p as any).manager || "إدارة الأملاك";
      const unitTxt = `${UNIT_AR[p.property_type] || "الوحدة"} ${t.unit || ""}`;
      /* قائمة «مستحق قريبًا»: لا متأخر بعد — كانت الرسالة تقول «الدفعة المستحقة
         بمبلغ 0 ريال لم تصلنا بعد». الآن: الدفعة القادمة بتاريخها وقيمتها. */
      if (n === 0) {
        const one = splitVat(Number(t.rent_amount) || 0, v);
        const U = [
          `السلام عليكم ${t.name}`, "",
          `تذكير ودّي بأن الدفعة القادمة عن ${unitTxt} بعقار ${p.name} تستحق بتاريخ ${arDate(st.nextDueDate)}${one.total ? ` بمبلغ ${sar(one.total)} ريال${v.enabled ? " (شامل الضريبة)" : ""}` : ""}.`,
          ...(carried > 0 ? [`ويتبقّى عليكم دين مرحَّل من مدة سابقة: ${sar(carried)} ريال.`] : []),
          "وإن كان السداد قد تم فنعتذر ونرجو إرسال ما يثبته.", "",
          "شكرًا لتعاونكم،", who,
        ];
        return waLink(t.phone, U.join("\n"));
      }
      const L = [
        `السلام عليكم ${t.name}`, "",
        `تذكير ودّي بأن ${what} عن ${unitTxt} بعقار ${p.name} بمبلغ ${sar(rentOwed)} ريال${v.enabled ? " (شامل الضريبة)" : ""} لم تصلنا بعد.`,
        ...(carried > 0 ? [`ويتبقّى عليكم دين مرحَّل من مدة سابقة: ${sar(carried)} ريال — الإجمالي ${sar(Math.round((rentOwed + carried) * 100) / 100)} ريال.`] : []),
        "نرجو السداد في أقرب وقت، وإن كان السداد قد تم فنعتذر ونرجو إرسال ما يثبته.", "",
        "شكرًا لتعاونكم،", who,
      ];
      return waLink(t.phone, L.join("\n"));
    })();

  const endNotice = (p: Property, t: Tenant, st: any) => {
    const v = { enabled: unitVatApplies(t, p), rate: Number((p as any).vat_rate) || 15, inclusive: (p as any).vat_inclusive !== false };
    const one = splitVat(Number(t.rent_amount) || 0, v);
    return waLink(t.phone, endNoticeText({
      mode: "end", tenantName: t.name || "",
      unitText: `${UNIT_AR[p.property_type] || "الوحدة"} (${t.unit || "—"})`, propertyName: p.name,
      endDate: st.endDate, daysToEnd: st.daysToEnd, hijri: (t as any).calendar === "hijri",
      overdue: v.enabled ? splitVat(Number(st.amountDue) || 0, v).total : (Number(st.amountDue) || 0), overdueVat: v.enabled,
      unpaid: Number(st.unpaid) || 0, carried: Math.max(0, Number((t as any).carried_debt) || 0),
      upcomingDate: st.unpaid === 0 ? st.nextDueDate : st.upcomingDate, upcomingAmount: one.total,
      signer: issuer?.billing_name || orgName || (p as any).manager || "إدارة الأملاك",
    }));
  };

  const Item = ({ p, t, st, note, tone }: { p: Property; t: Tenant; st: any; note: string; tone?: "late" | "due" | "exp" }) => (
    <div className="flex items-center justify-between gap-3 bg-white text-deep border border-line rounded-lg px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-semibold truncate text-deep">{t.name || <span className="text-muted font-normal">(بلا اسم مستأجر)</span>} <span className="text-muted font-normal text-xs">· {UNIT_AR[p.property_type] || "وحدة"} {t.unit || "—"} · {p.name}</span></div>
        <div className={`text-[11px] ${tone === "late" ? "text-late font-semibold" : tone === "due" ? "text-[#9A4B00]" : tone === "exp" ? "text-[#991B1B]" : "text-muted"}`}>{note}</div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {tone !== "exp" && t.phone && <a className="btn btn-wa text-xs px-2.5" href={remind(p, t, st)} target="_blank" rel="noreferrer" title="تذكير واتساب">💬</a>}
        {/* عقود تنتهي: إشعار بانتهاء العقد مع حالة المستحقات (lib/tenant-messages) */}
        {tone === "exp" && t.phone && <a className="btn btn-wa text-xs px-2.5" href={endNotice(p, t, st)} target="_blank" rel="noreferrer" title="إشعار انتهاء العقد (واتساب)">📅</a>}
        <Link className="btn btn-ghost text-xs" href={`/dashboard/property?p=${p.id}&q=${encodeURIComponent(t.unit || t.name)}`}>فتح</Link>
      </div>
    </div>
  );

  return (
    <div>
      {/* ═══ البحث الشامل ═══ */}
      <div className="flex justify-end mb-3">
        <button className="btn btn-ghost text-sm" onClick={() => setExpOpen(true)}
          title="كل مصروفات المكتب بفلترة على المالك والفترة — جاهزة للطباعة">💸 مصروفات كل العقارات</button>
      </div>
      {/**
        * الخلايا الثلاث نفسها في صفحة كل عقار، لكل العقارات — فمجموع خلايا
        * العقارات يساوي هذه حتمًا (الدوال والحدود نفسها). كان هنا «المتبقي من
        * عقودك خلال 12 شهرًا»: صيغة أخرى للدخل تُقرأ مناقضة له.
        */}
      {(() => {
        const rr = annualRentRoll(rows.map((r: any) => r.t));
        const mLabel = arDate(`${today().slice(0, 7)}-01`).replace(/^\S+\s+/, "");
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
              v={collectedTotal === null ? "…" : sar(Math.round(collectedTotal))}
              sub={<>كل العقارات · ما قُبض في {mLabel} حتى اليوم</>} />
            <Cell t="دخل العقارات السنوي" tone="text-deep" v={sar(Math.round(rr.annual))}
              sub={<>إيجار سنة لـ{rr.occupied} وحدة بعقد سارٍ
                {rr.vacant ? <> · <span className="text-[#9A4B00]">شاغرة {rr.vacant}</span></> : null}
                {rr.expired ? <> · <span className="text-late">{rr.expired} {rr.expired === 1 ? "عقد انتهى" : "عقود انتهت"} ولم {rr.expired === 1 ? "يُجدَّد" : "تُجدَّد"} ({sar(Math.round(rr.expiredAnnual))} خارج المجموع)</span></> : null}</>} />
            <Cell t="مصروفات هذا الشهر" tone="text-ink"
              v={expMonth === null ? "…" : sar(Math.round(expMonth.owner))}
              sub={<>على الملّاك في {mLabel}{expMonth && expMonth.office > 0 ? <> · و{sar(Math.round(expMonth.office))} على المكتب</> : null}</>} />
          </div>
        );
      })()}
      {/* ═══ تحصيل اليوم وأمس — بالأسماء عند الضغط ═══ */}
      {(() => {
        const sum = (a: any[]) => a.reduce((s, x) => s + (Number(x.amount) || 0), 0);
        const cnt = (a: any[]) => a.filter((x) => (Number(x.amount) || 0) > 0).length;
        const who: Record<string, { t: Tenant; p: Property }> = {};
        rows.forEach(({ p, t }) => { who[t.id] = { t, p }; });
        const METHOD: Record<string, string> = { cash: "نقدًا", transfer: "تحويل بنكي", ejar: "منصة إيجار", card: "بطاقة", pos: "شبكة", cheque: "شيك" };
        const listOf = (k: "today" | "yesterday" | "custom") => k === "custom" ? pickPays : dayPays ? dayPays[k] : null;
        const Btn = ({ k, label }: { k: "today" | "yesterday"; label: string }) => {
          const list = dayPays?.[k] || [];
          const on = dayOpen === k;
          return (
            <button type="button" onClick={() => setDayOpen(on ? null : k)} aria-expanded={on}
              className={`flex-1 min-w-[150px] text-start bg-white border rounded-xl px-4 py-3 transition ${on ? "border-[#137a50]" : "border-line hover:border-[#137a50]/50"}`}>
              <div className="text-[12px] text-muted">{label}</div>
              <div className="text-xl font-bold tabular-nums mt-0.5 text-[#137a50]">
                {dayPays === null ? "…" : sar(Math.round(sum(list)))} <span className="text-xs font-normal text-muted">ريال</span></div>
              <div className="text-[11px] text-muted mt-0.5">{dayPays === null ? "" : cnt(list) ? `${cnt(list)} ${cnt(list) === 1 ? "دفعة" : "دفعات"} · ${on ? "إخفاء" : "اضغط للتفاصيل"}` : "لا دفعات مسجّلة"}</div>
            </button>
          );
        };
        const open = (dayOpen && listOf(dayOpen)) || [];
        const loading = dayOpen ? listOf(dayOpen) === null : false;
        const pickOn = dayOpen === "custom";
        const dayWord = dayOpen === "today" ? "اليوم" : dayOpen === "yesterday" ? "أمس" : pickDate ? `يوم ${arDate(pickDate)}` : "";
        return (
          <div className="mb-3">
            <div className="flex flex-wrap gap-3">
              <Btn k="today" label="تحصيل اليوم" />
              <Btn k="yesterday" label="تحصيل أمس" />
              <div className={`flex-1 min-w-[150px] bg-white border rounded-xl px-4 py-3 ${pickOn ? "border-[#137a50]" : "border-line"}`}>
                <label htmlFor="pickDay" className="text-[12px] text-muted block">تحصيل يوم معيّن</label>
                <input id="pickDay" type="date" className="fld !py-1 mt-1 text-sm" max={today()} value={pickDate}
                  onChange={(e) => { setPickDate(e.target.value); setDayOpen(e.target.value ? "custom" : null); }} />
                {pickDate && <div className="text-[11px] text-muted mt-1">{pickPays === null ? (pickErr ? <span className="text-late">{pickErr}</span> : "…")
                  : <button type="button" className="underline underline-offset-2" onClick={() => setDayOpen(pickOn ? null : "custom")}>
                      <b className="text-[#137a50] tabular-nums">{sar(Math.round(sum(pickPays)))} ريال</b> · {cnt(pickPays) ? `${cnt(pickPays)} ${cnt(pickPays) === 1 ? "دفعة" : "دفعات"}` : "لا دفعات"} · {hijriShort(pickDate)}</button>}</div>}
              </div>
            </div>
            {dayOpen && !loading && (
              <div className="bg-white border border-line rounded-xl mt-2 overflow-hidden">
                {open.length === 0 ? <p className="text-sm text-muted p-3">لا دفعات مسجّلة {dayWord}.</p> : (
                  <div className="divide-y divide-line">
                    {open.map((x: any) => {
                      const w = who[x.tenant_id];
                      const amt = Number(x.amount) || 0;
                      return (
                        <div key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{w ? w.t.name : "مستأجر سابق"}</div>
                            <div className="text-[11px] text-muted truncate">{w ? `${w.p.name} · ${UNIT_AR[w.p.property_type] || "وحدة"} ${w.t.unit || "—"}` : ""}{x.method && METHOD[x.method] ? ` · ${METHOD[x.method]}` : ""}</div>
                          </div>
                          <div className={`tabular-nums font-semibold whitespace-nowrap ${amt < 0 ? "text-late" : "text-[#137a50]"}`}>
                            {amt < 0 ? `تراجع ${sar(Math.round(-amt))}` : sar(Math.round(amt))}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-muted px-3 py-2 border-t border-line">بتاريخ الدفع المسجَّل. من سجّل كل دفعة ومتى: «سجل العمليات».</p>
              </div>
            )}
          </div>
        );
      })()}
      {/* «التحصيل شهرًا بشهر» أُزيل: عند مكتب انتقل حديثًا تبدو أشهره السابقة فارغة
          فيُقرأ الرسم ارتفاعًا لا حقيقة له، ومن يدفع سنويًّا يظهر شهره عمودًا ضخمًا
          وبقية أشهره أصفارًا. وكان أثقل استعلام هنا (دفعات المكتب كله لسنة).
          أي فترة بتفصيلها: كشف التحصيل وتقرير المالك. */}

      {/* ═══ التزامات المكتب — عقود الوساطة وتراخيص الإعلانات ورخصة فال ═══ */}
      {canComp && (() => {
        const withState = comp.map((it) => ({ it, st: complianceState(it) }))
          .filter(({ it, st }) => it.status !== "closed" && st.phase !== "closed")
          .sort((a, b) => Number(b.st.alert) - Number(a.st.alert) || (a.st.daysToEnd ?? 1e9) - (b.st.daysToEnd ?? 1e9));
        const alerts = alertCount(comp);
        const TONE: Record<string, string> = { bad: "text-late", warn: "text-[#9A4B00]", ok: "text-[#137a50]", muted: "text-muted" };
        return (
          <div className="bg-white border border-line rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="font-semibold text-deep text-sm">التزامات المكتب
                {alerts > 0 && <span className="ms-2 text-[11px] px-2 py-0.5 rounded-full bg-[#FBE9E7] text-late">{alerts} تحتاج انتباهًا</span>}</div>
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setCompOpen(true)}>إدارة الالتزامات</button>
            </div>
            {withState.length === 0 ? (
              <p className="text-xs text-muted">لا التزامات مسجّلة — عقود الوساطة وتراخيص الإعلانات ورخصة فال تُتابَع هنا بمواعيد انتهائها.</p>
            ) : (
              <div className="space-y-1.5">
                {withState.slice(0, 5).map(({ it, st }) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 text-sm border-t border-line pt-1.5">
                    <span className="truncate">{KIND_META[it.kind]?.icon} {it.title}
                      <span className="text-[11px] text-muted"> · {KIND_META[it.kind]?.one}</span></span>
                    <span className={`text-xs whitespace-nowrap ${TONE[st.tone] || "text-muted"}`}>{st.label}</span>
                  </div>
                ))}
                {withState.length > 5 && <button type="button" className="text-[11px] text-goldInk underline underline-offset-4" onClick={() => setCompOpen(true)}>و{withState.length - 5} أخرى</button>}
              </div>
            )}
          </div>
        );
      })()}
      {compOpen && (
        <ComplianceModal initial={comp} orgName={orgName} issuer={issuer || {}}
          properties={properties.map((x: any) => ({ id: x.id, name: x.name }))}
          onChanged={setComp} onClose={() => { setCompOpen(false); router.refresh(); }} />
      )}

      {expOpen && <ExpensesOverview properties={properties as any} onClose={() => setExpOpen(false)} />}
      <div className="bg-white border border-line rounded-2xl p-4 mb-4">
        <input className="fld text-base" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder="ابحث في كل العقارات: اسم المستأجر · الجوال · رقم الهوية · رقم العقد · رقم الوحدة · حساب الكهرباء أو الماء" />
        {needle.length >= 2 && (
          <div className="mt-3">
            {hits.length === 0 ? <p className="text-sm text-muted">لا نتائج لـ«{q}».</p> : (
              <div className="space-y-1.5">
                {cut("hits", hits).map(({ p, t, st }) => (
                  <Item key={t.id} p={p} t={t} st={st}
                    note={`${st.statusLabel}${t.phone ? ` · ${t.phone}` : ""}${t.national_id ? ` · هوية ${t.national_id}` : ""}${t.contract_no ? ` · عقد ${t.contract_no}` : ""}`}
                    tone={st.status === "late" ? "late" : undefined} />
                ))}
                <More k="hits" n={hits.length} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ أرقام المحفظة ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { v: `${properties.length}`, l: "عقار", s: `${totals.units} وحدة · ${totals.units ? Math.round(((totals.units - totals.vacant) / totals.units) * 100) : 0}% إشغال` },
          { v: sar(totals.overdue), l: "ريال متأخر", s: `${totals.late} متأخر · ${totals.partial} جزئي`, tone: totals.overdue ? "bad" : "" },
          { v: `${totals.due + totals.soon}`, l: `تستحق خلال ${daysAr(windows.soon)}`, s: `${totals.due} مستحق · ${totals.soon} قريب`, tone: totals.due ? "warn" : "" },
          { v: collectedTotal === null ? "…" : sar(Math.round(collectedTotal)), l: "محصَّل هذا الشهر", s: `المتوقع شهريًّا ${sar(Math.round(totals.monthly))}`, tone: "good" },
        ].map((c) => (
          <div key={c.l} className="bg-white border border-line rounded-2xl p-4">
            <div className={`text-2xl font-bold tabular-nums ${c.tone === "bad" ? "text-late" : c.tone === "warn" ? "text-[#9A4B00]" : c.tone === "good" ? "text-[#137a50]" : "text-deep"}`}>{c.v}</div>
            <div className="text-xs text-muted">{c.l}</div>
            <div className="text-[11px] text-muted mt-0.5">{c.s}</div>
          </div>
        ))}
      </div>

      {/* ═══ يحتاج إجراء ═══ */}
      <div className="bg-deep text-[#EAF1EE] rounded-2xl p-5 mb-4">
        <div className="font-display font-bold text-goldSoft mb-3">يحتاج إجراء — من كل العقارات</div>
        {!late.length && !due.length && !expiring.length && !vacant.length ? <p className="text-sm opacity-80">لا شيء عاجل في المحفظة كلها.</p> : (
          <div className="grid lg:grid-cols-2 gap-4">
            {late.length > 0 && <div><div className="text-xs opacity-80 mb-1.5">🔴 متأخرون ({late.length}) — {sar(totals.overdue)} ريال</div><div className="space-y-1.5">{cut("late", late).map(({ p, t, st }) => <Item key={t.id} p={p} t={t} st={st} tone="late" note={`${st.statusLabel} · ${sar(dueWithVat(st, t, p))} ريال`} />)}<More k="late" n={late.length} /></div></div>}
            {due.length > 0 && <div><div className="text-xs opacity-80 mb-1.5">🟠 مستحق خلال {daysAr(windows.imminent)} ({due.length})</div><div className="space-y-1.5">{cut("due", due).map(({ p, t, st }) => <Item key={t.id} p={p} t={t} st={st} tone="due" note={`${st.statusLabel} · ${st.nextDueDate} (${hijriShort(st.nextDueDate || "")})`} />)}<More k="due" n={due.length} /></div></div>}
            {expiring.length > 0 && <div><div className="text-xs opacity-80 mb-1.5">⏳ عقود انتهت أو تنتهي خلال {daysAr(windows.expiring)} — جدّدها أو سجّل الإخلاء ({expiring.length})</div><div className="space-y-1.5">{cut("exp", expiring).map(({ p, t, st }) => <Item key={t.id} p={p} t={t} st={st} tone="exp" note={(st.daysToEnd ?? 0) < 0 ? `انتهى ${st.endDate} (منذ ${daysAr(-(st.daysToEnd ?? 0))}) ولم يُجدَّد` : `ينتهي ${st.endDate} (بعد ${daysAr(st.daysToEnd)})`} />)}<More k="exp" n={expiring.length} /></div></div>}
            {vacant.length > 0 && <div><div className="text-xs opacity-80 mb-1.5">⚪ شاغرة ({vacant.length})</div><div className="space-y-1.5">{cut("vac", vacant).map(({ p, t, st }) => <Item key={t.id} p={p} t={t} st={st} note={t.move_out_date ? `شاغرة منذ ${t.move_out_date}` : "شاغرة"} />)}<More k="vac" n={vacant.length} /></div></div>}
          </div>
        )}
      </div>

      {/* ═══ جدول العقارات ═══ */}
      <div className="bg-white border border-line rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-line font-semibold text-deep">العقارات — الأعلى متأخرات أولًا</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs text-muted">
              <tr><th className="text-right px-3 py-2">العقار</th><th className="px-3 py-2">الوحدات</th><th className="px-3 py-2">متأخر</th><th className="px-3 py-2">ريال متأخر</th><th className="px-3 py-2">تستحق</th><th className="px-3 py-2">تنتهي</th><th className="px-3 py-2">محصَّل الشهر</th><th className="px-3 py-2">المتوقع شهريًّا</th><th></th></tr>
            </thead>
            <tbody>
              {perProperty.slice(0, propsShown).map((r) => (
                <tr key={r.p.id} className={`border-t border-line ${r.overdue > 0 ? "bg-[#FFF5F4]" : ""}`}>
                  <td className="px-3 py-2 font-semibold">{r.p.name}<div className="text-[11px] text-muted font-normal">{r.p.city || ""}{r.p.owner_name ? ` · ${r.p.owner_name}` : ""}</div></td>
                  <td className="px-3 py-2 text-center tabular-nums">{r.occupied}/{r.units}</td>
                  <td className={`px-3 py-2 text-center tabular-nums ${r.late ? "text-late font-bold" : "text-muted"}`}>{r.late || "—"}</td>
                  <td className={`px-3 py-2 text-center tabular-nums ${r.overdue ? "text-late font-bold" : "text-muted"}`}>{r.overdue ? sar(r.overdue) : "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{r.due || "—"}</td>
                  <td className={`px-3 py-2 text-center tabular-nums ${r.expiring ? "text-[#991B1B] font-semibold" : "text-muted"}`}>{r.expiring || "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-[#137a50] font-semibold">{r.collected === null ? "…" : sar(Math.round(r.collected))}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-muted">{sar(Math.round(r.monthly))}</td>
                  <td className="px-3 py-2"><Link className="btn btn-ghost text-xs" href={`/dashboard/property?p=${r.p.id}`}>فتح</Link></td>
                </tr>
              ))}
            </tbody>
            {perProperty.length > propsShown && (
              <tbody><tr><td colSpan={9} className="p-2 text-center">
                <button className="btn btn-ghost text-xs" onClick={() => setPropsShown((n) => n + 25)}>
                  عرض 25 عقارًا إضافيًّا — بقي {perProperty.length - propsShown}
                </button>
              </td></tr></tbody>
            )}
            <tfoot className="bg-paper text-xs">
              <tr><td className="px-3 py-2 font-semibold">الإجمالي</td><td className="px-3 py-2 text-center tabular-nums">{totals.units - totals.vacant}/{totals.units}</td><td className="px-3 py-2 text-center tabular-nums text-late font-bold">{totals.late || "—"}</td><td className="px-3 py-2 text-center tabular-nums text-late font-bold">{totals.overdue ? sar(totals.overdue) : "—"}</td><td className="px-3 py-2 text-center tabular-nums">{totals.due + totals.soon || "—"}</td><td className="px-3 py-2 text-center tabular-nums">{totals.expiring || "—"}</td><td className="px-3 py-2 text-center tabular-nums text-[#137a50] font-bold">{collectedTotal === null ? "…" : sar(Math.round(collectedTotal))}</td><td className="px-3 py-2 text-center tabular-nums">{sar(Math.round(totals.monthly))}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
