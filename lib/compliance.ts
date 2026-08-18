// ============================================================
// وثيق — محرّك التزامات المكتب العقاري
// يحسب حالة: عقود الوساطة · تراخيص الإعلانات · رخصة فال
//
// المرجع النظامي (استرشاديًّا): نظام الوساطة العقارية الصادر
// بالمرسوم الملكي رقم (م/130) ولوائحه:
//   • م7:  عقد الوساطة مكتوب وتُودَع نسخة منه لدى الهيئة، وإن لم
//          تُحدَّد مدته عُدَّت (90) يومًا من تاريخ إبرامه.
//   • م8:  يجوز للمالك التعاقد مع أكثر من وسيط ما لم يُنص على غير ذلك.
//   • م14: العمولة (2.5%) من قيمة الصفقة بيعًا، ومن إيجار السنة
//          الأولى فقط إيجارًا، ما لم يُتفق كتابةً على غير ذلك.
//   • م15: يستحق الوسيط العمولة إذا أُتمّت الصفقة أثناء سريان العقد،
//          أو خلال مدة لا تتجاوز (شهرين) من انتهائه بشرط إثبات وساطته.
//   • ترخيص إعلان مستقل لكل إعلان عقاري، ورقم الترخيص إلزامي في
//     المنشور، والإعلان بترخيص منتهٍ أو بدون ترخيص مخالفة.
// كل ما هنا حسابات تنظيمية داخلية، وليس استشارة قانونية.
// ============================================================

import { parseDate, isoDate } from "./contracts";

export type ComplianceKind = "brokerage" | "ad_license" | "fal_license";

export type ComplianceItem = {
  id: string;
  property_id?: string | null;
  kind: ComplianceKind;
  title: string;
  ref_no?: string | null;
  party?: string | null;
  deal_type?: "sale" | "rent" | null;
  exclusive?: boolean | null;
  platform?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  commission_pct?: number | null;
  amount?: number | null;
  status?: string | null; // active | closed
  note?: string | null;
};

export const KIND_META: Record<ComplianceKind, { label: string; icon: string; one: string }> = {
  brokerage:   { label: "عقود الوساطة",     icon: "🤝", one: "عقد وساطة" },
  ad_license:  { label: "تراخيص الإعلانات", icon: "📢", one: "ترخيص إعلان" },
  fal_license: { label: "رخصة فال",          icon: "🪪", one: "رخصة فال" },
};

/** المدة النظامية الافتراضية لعقد الوساطة إن لم تُحدَّد (م7) */
export const BROKERAGE_DEFAULT_DAYS = 90;
/** نافذة استحقاق العمولة بعد انتهاء العقد: شهران (م15) */
export const COMMISSION_WINDOW_MONTHS = 2;
/** نسبة العمولة النظامية الافتراضية (م14) */
export const DEFAULT_COMMISSION_PCT = 2.5;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a: Date, b: Date) =>
  Math.ceil((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);

/** إضافة أيام لتاريخ */
function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** إضافة أشهر بأمان (31 يناير + شهرين → 31 مارس، و31 → 30/28 عند اللزوم) */
function addMonths(d: Date, n: number): Date {
  const day = d.getDate();
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
}

/**
 * نهاية عقد الوساطة: المُدخلة، وإلا تُستنتج (90) يومًا من البداية.
 * derived=true تعني أن النهاية مستنتجة نظامًا لا مُدخلة.
 */
export function brokerageEnd(it: Pick<ComplianceItem, "start_date" | "end_date">): { end: string | null; derived: boolean } {
  if (it.end_date) return { end: isoDate(parseDate(it.end_date)), derived: false };
  if (!it.start_date) return { end: null, derived: false };
  return { end: isoDate(addDays(parseDate(it.start_date), BROKERAGE_DEFAULT_DAYS)), derived: true };
}

/** آخر يوم في نافذة استحقاق العمولة: نهاية العقد + شهران (م15) */
export function commissionWindowEnd(endISO: string): string {
  return isoDate(addMonths(parseDate(endISO), COMMISSION_WINDOW_MONTHS));
}

/** العمولة المتوقعة من قيمة الصفقة/إيجار السنة الأولى × النسبة */
export function expectedCommission(it: Pick<ComplianceItem, "amount" | "commission_pct">): number {
  const amount = Number(it.amount) || 0;
  const pct = Number(it.commission_pct);
  const rate = pct > 0 ? pct : DEFAULT_COMMISSION_PCT;
  return Math.round(amount * rate) / 100; // amount × pct ÷ 100 مع تقريب لريالين عشريين
}

/** مراحل البند المحسوبة */
export type CompliancePhase =
  | "missing"   // بلا تواريخ كافية
  | "active"    // ساري
  | "ending"    // يقترب من الانتهاء
  | "window"    // (وساطة فقط) انتهى العقد ونافذة الشهرين مفتوحة
  | "expired"   // انتهى (وللوساطة: أُغلقت النافذة أيضًا)
  | "closed";   // أُغلق يدويًّا

export type ComplianceState = {
  phase: CompliancePhase;
  label: string;               // نص جاهز للعرض
  tone: "ok" | "warn" | "bad" | "muted"; // للتلوين
  endDate: string | null;      // نهاية المدة (المستنتجة للوساطة إن لزم)
  endDerived: boolean;         // هل النهاية مستنتجة (90 يومًا)؟
  daysToEnd: number | null;
  windowEnd: string | null;    // للوساطة: نهاية نافذة الشهرين
  daysToWindowEnd: number | null;
  alert: boolean;              // يستحق الظهور في التنبيهات
};

/** عتبات التنبيه لكل نوع (بالأيام قبل الانتهاء) */
export const ALERT_BEFORE: Record<ComplianceKind, number> = {
  brokerage: 14,
  ad_license: 7,
  fal_license: 30,
};

/** الحالة الكاملة لبند التزام — دالة نقية تصلح للوحة والبوت والمستندات */
export function complianceState(it: ComplianceItem, asOf?: Date): ComplianceState {
  const today = startOfDay(asOf || new Date());
  const closed = String(it.status || "active") === "closed";

  const isBrokerage = it.kind === "brokerage";
  const be = isBrokerage
    ? brokerageEnd(it)
    : { end: it.end_date ? isoDate(parseDate(it.end_date)) : null, derived: false };

  const endDate = be.end;
  const daysToEnd = endDate ? daysBetween(parseDate(endDate), today) : null;

  const windowEnd = isBrokerage && endDate ? commissionWindowEnd(endDate) : null;
  const daysToWindowEnd = windowEnd ? daysBetween(parseDate(windowEnd), today) : null;

  if (closed) {
    return { phase: "closed", label: "مُغلق", tone: "muted", endDate, endDerived: be.derived, daysToEnd, windowEnd, daysToWindowEnd, alert: false };
  }

  if (!endDate || daysToEnd === null) {
    return {
      phase: "missing", label: "أكمل التواريخ", tone: "muted",
      endDate, endDerived: be.derived, daysToEnd, windowEnd, daysToWindowEnd, alert: false,
    };
  }

  const before = ALERT_BEFORE[it.kind];

  // ساري
  if (daysToEnd > 0) {
    if (daysToEnd <= before) {
      return {
        phase: "ending",
        label: `ينتهي خلال ${daysToEnd} يوم`,
        tone: "warn", endDate, endDerived: be.derived, daysToEnd, windowEnd, daysToWindowEnd, alert: true,
      };
    }
    return {
      phase: "active",
      label: `ساري — يتبقّى ${daysToEnd} يوم`,
      tone: "ok", endDate, endDerived: be.derived, daysToEnd, windowEnd, daysToWindowEnd, alert: false,
    };
  }

  // انتهت المدة
  if (isBrokerage && daysToWindowEnd !== null && daysToWindowEnd >= 0) {
    return {
      phase: "window",
      label: `انتهى العقد — نافذة إثبات الوساطة ${daysToWindowEnd} يوم`,
      tone: "warn", endDate, endDerived: be.derived, daysToEnd, windowEnd, daysToWindowEnd, alert: true,
    };
  }

  return {
    phase: "expired",
    label: it.kind === "ad_license" ? "منتهٍ — أوقف الإعلان أو جدّد ترخيصه"
      : it.kind === "fal_license" ? "منتهية — جدّدها قبل أي ممارسة"
      : "انتهى العقد والنافذة معًا",
    tone: "bad", endDate, endDerived: be.derived, daysToEnd, windowEnd, daysToWindowEnd, alert: true,
  };
}

/** عدد البنود التي تستحق تنبيهًا الآن (لشارة الزر في اللوحة) */
export function alertCount(items: ComplianceItem[], asOf?: Date): number {
  return (items || []).reduce((n, it) => n + (complianceState(it, asOf).alert ? 1 : 0), 0);
}

/**
 * أسطر التنبيهات للملخّص اليومي (تليجرام).
 * تعيد [] إن لا شيء يستحق — فلا يُضاف قسم فارغ للرسالة.
 */
export function complianceDigestLines(items: ComplianceItem[], asOf?: Date): string[] {
  const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines: string[] = [];
  for (const it of items || []) {
    const st = complianceState(it, asOf);
    if (!st.alert) continue;
    const icon = KIND_META[it.kind]?.icon || "•";
    lines.push(`${icon} ${esc(it.title)} — ${esc(st.label)}${st.endDate ? ` (${st.endDate})` : ""}`);
  }
  return lines;
}

/**
 * الحدود النظامية كما تظهر للمستخدم — صياغة استرشادية واحدة
 * تُستعمل في اللوحة وفي المستند المطبوع حتى لا تتضارب النسخ.
 */
export const UI_LEGAL: { ref: string; text: string }[] = [
  { ref: "م7",  text: "عقد الوساطة مكتوب وتُودَع نسخة منه لدى الهيئة العامة للعقار ولا يُحتج به إلا بذلك، وإن لم تُحدَّد مدته عُدَّت 90 يومًا من إبرامه." },
  { ref: "م8",  text: "للمالك التعاقد مع أكثر من وسيط للعقار نفسه ما لم يُنص في العقد على الحصرية." },
  { ref: "م14", text: "العمولة 2.5% من قيمة الصفقة بيعًا، ومن إيجار السنة الأولى فقط إيجارًا، ما لم يُتفق كتابةً على غير ذلك." },
  { ref: "م15", text: "تُستحق العمولة عن صفقة أُتمّت أثناء سريان العقد، أو خلال شهرين من انتهائه بشرط إثبات الوساطة — لذا وثّق تواصلك ومعايناتك قبل انتهاء المدة." },
  { ref: "الإعلانات", text: "لكل إعلان عقاري ترخيص مستقل من الهيئة، ويُذكر رقم الترخيص في المنشور، والإعلان بترخيص منتهٍ أو بدونه مخالفة." },
  { ref: "العربون", text: "لا يتجاوز العربون 5% من قيمة الصفقة، ولا يجوز للوسيط الاحتفاظ به ضمانًا لعمولته." },
];

export const LEGAL_DISCLAIMER =
  "سجل تنظيمي داخلي استرشادي. المرجع عند أي اختلاف هو نظام الوساطة العقارية ولوائحه ومنصات الهيئة العامة للعقار، وهذا ليس استشارة قانونية.";
