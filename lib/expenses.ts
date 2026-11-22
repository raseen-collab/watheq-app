import { isValidVatNo } from "./einvoice";
// ============================================================
// وثيق — المصروفات وحساب «صافي المالك»
// المبدأ: تقرير يعرض التحصيل وحده نصف الحقيقة؛ سؤال المالك الفعلي
// «كم صافي لي؟» = المحصَّل − المصروفات − أتعاب الإدارة.
// دوال نقية بلا شبكة — تُستعمل في اللوحة والمستند وصفحة رابط المالك.
// ============================================================

export type ExpenseCategory = "maintenance" | "utilities" | "government" | "cleaning" | "salaries" | "contracts" | "other";

export type ExpenseRow = {
  id?: string;
  property_id?: string;
  unit?: string | null;
  category: ExpenseCategory | string;
  amount: number;
  spent_on: string;
  note?: string | null;
  /** تُخصم من صافي المالك؟ false = مصروف على المكتب لا يتحمّله المالك */
  billable?: boolean | null;
  /** collections: من تحصيل العقار · office: من المكتب ويُستردّ · owner: دفعها المالك */
  paid_by?: "collections" | "office" | "owner" | string | null;
  /** paid: مدفوعة · due: مستحقة لم تُدفع */
  status?: "paid" | "due" | string | null;
  vendor?: string | null;
  invoice_no?: string | null;
};

export const PAID_BY: Record<string, string> = {
  collections: "من تحصيل العقار",
  office: "من المكتب (يُستردّ)",
  owner: "دفعها المالك مباشرة",
};

/** المصروف يُخصم من صافي المالك؟ الافتراضي نعم — إلا ما وُسم على المكتب */
export const isBillable = (e: ExpenseRow) => e.billable !== false;
/** ويؤثّر في نقد المكتب؟ ما دفعه المالك بنفسه لا يمسّ صندوق المكتب */
export const hitsOfficeCash = (e: ExpenseRow) => e.paid_by !== "owner";

export const EXPENSE_CATS: Record<ExpenseCategory, { label: string; icon: string }> = {
  maintenance: { label: "صيانة",        icon: "🔧" },
  utilities:   { label: "فواتير خدمات", icon: "💡" },
  government:  { label: "رسوم حكومية",  icon: "🏛️" },
  cleaning:    { label: "نظافة",        icon: "🧹" },
  /* (14 نوفمبر 2026 — مكتب الأولى) راتب الحارس وعقد المصاعد ليسا «صيانة» ولا «أخرى» */
  salaries:    { label: "رواتب وأجور",  icon: "👷" },
  contracts:   { label: "عقود دورية",   icon: "📄" },
  other:       { label: "أخرى",         icon: "📦" },
};

/** (schema-v81) قالب مصروف شهري متكرر — يُرحَّل مصروفًا عاديًّا كل شهر في يومه */
export type ExpenseTemplate = {
  id: string; property_id: string; unit?: string | null; category: ExpenseCategory | string; amount: number;
  note?: string | null; vendor?: string | null; billable: boolean; paid_by: string; post_status: "paid" | "due";
  day_of_month: number; start_month: string; end_month?: string | null; active: boolean; last_posted?: string | null;
};

export const catLabel = (c?: string | null) =>
  EXPENSE_CATS[(c || "other") as ExpenseCategory]?.label || "أخرى";
export const catIcon = (c?: string | null) =>
  EXPENSE_CATS[(c || "other") as ExpenseCategory]?.icon || "📦";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * مجموع ما يُخصم من المالك.
 *
 * كان يجمع كل شيء — فمصروف على المكتب (تسويق، أدوات مكتبية) كان ينقص
 * صافي المالك بلا وجه حق. الآن القابل للخصم وحده، وما عداه يُعرض منفصلًا.
 */
export function sumExpenses(rows: ExpenseRow[]): number {
  return r2((rows || []).filter(isBillable).reduce((s, x) => s + (Number(x.amount) || 0), 0));
}

/** مجموع كل المصروفات مهما كان تحمّلها — لتقرير المكتب لا لتقرير المالك */
export function sumAllExpenses(rows: ExpenseRow[]): number {
  return r2((rows || []).reduce((s, x) => s + (Number(x.amount) || 0), 0));
}

/** المستحقة غير المدفوعة — تُعرض تنبيهًا ولا تُخصم من نقد اليوم */
export function sumDue(rows: ExpenseRow[]): number {
  return r2((rows || []).filter((x) => x.status === "due").reduce((s, x) => s + (Number(x.amount) || 0), 0));
}

/** مجاميع كل تصنيف — لسطر «صيانة 1,200 · فواتير 300» في التقرير */
export function sumByCategory(rows: ExpenseRow[]): { category: string; label: string; total: number }[] {
  const acc: Record<string, number> = {};
  for (const x of rows || []) {
    const c = String(x.category || "other");
    acc[c] = (acc[c] || 0) + (Number(x.amount) || 0);
  }
  return Object.entries(acc)
    .map(([category, total]) => ({ category, label: catLabel(category), total: r2(total) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * (v86) أتعاب الإدارة: نسبة من المحصَّل، أو مبلغ ثابت بدورية:
 *   month = كل شهر (× أشهر الفترة) · half = كل ٦ أشهر · year = كل سنة · once = مرة واحدة فقط.
 * للدوريات غير الشهرية يلزم تاريخ استحقاق (mgmt_fee_on): يُخصم المبلغ في كل فترة يقع فيها
 * استحقاق (الاستحقاق ثم كل ٦/١٢ شهرًا بعده؛ «مرة واحدة» = التاريخ نفسه فقط).
 * times = عدد مرات الخصم في الفترة.
 */
export type FeeSpec = { pct?: number | null; fixed?: number | null; times?: number; /** (v99) «أتعابي شاملة الضريبة» */ inclusive?: boolean | null };
export type FeePeriod = "month" | "half" | "year" | "once";
export const FEE_PERIODS: { v: FeePeriod; label: string; adv: string }[] = [
  { v: "month", label: "شهري", adv: "شهريًّا" },
  { v: "half", label: "كل ٦ أشهر", adv: "كل ٦ أشهر" },
  { v: "year", label: "سنوي", adv: "سنويًّا" },
  { v: "once", label: "مرة واحدة", adv: "مرة واحدة" },
];
type FeeProp = { mgmt_fee_pct?: number | null; mgmt_fee_mode?: string | null; mgmt_fee_amount?: number | null; mgmt_fee_period?: string | null; mgmt_fee_on?: string | null; fee_vat_inclusive?: boolean | null } | null | undefined;

/**
 * (v99) نسبة الضريبة على أتعاب الإدارة: تُفرض فقط إن كان للمكتب رقم ضريبي *صحيح* — دليل الوكلاء §5.2
 * (الأتعاب خاضعة حتى للسكني). كانت تُفرض بمجرد وجود أي نص في خانة الرقم، فمكتب برقم خاطئ
 * كان يخصم ضريبة من المالك دون أن يكون مسجَّلًا.
 */
export function feeVatRateOf(issuer: { vat_number?: string | null } | null | undefined, p: { vat_rate?: number | null } | null | undefined): number {
  return isValidVatNo(issuer?.vat_number) ? (Number(p?.vat_rate) || 15) : 0;
}

export function feePeriodOf(p: FeeProp): FeePeriod {
  const v = p?.mgmt_fee_period;
  return v === "half" || v === "year" || v === "once" ? v : "month";
}

/** مواصفة الأتعاب من صف العقار كما في القاعدة؛ times = مرات الخصم (افتراضيًّا 1) */
export function feeSpecOf(p: FeeProp, times = 1): FeeSpec {
  if (!p) return { pct: null, fixed: null, times };
  if (p.mgmt_fee_mode === "fixed") return { pct: null, fixed: Number(p.mgmt_fee_amount) > 0 ? Number(p.mgmt_fee_amount) : null, times, inclusive: !!p.fee_vat_inclusive };
  return { pct: p.mgmt_fee_pct ?? null, fixed: null, times, inclusive: !!p.fee_vat_inclusive };
}

/** عدد الأشهر التقويمية التي تلمسها الفترة (1–15 نوفمبر = 1 · نوفمبر–ديسمبر = 2) */
export function monthsInPeriod(from?: string | null, to?: string | null): number {
  if (!from || !to || !/^\d{4}-\d{2}/.test(from) || !/^\d{4}-\d{2}/.test(to)) return 1;
  const n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1;
  return n >= 1 ? n : 1;
}

const D10 = /^\d{4}-\d{2}-\d{2}/;
function addMonths(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n, d = Number(iso.slice(8, 10));
  const dt = new Date(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
}

/**
 * مرات خصم الأتعاب الثابتة في الفترة [from, to]:
 *   شهري → أشهر الفترة · ٦ أشهر/سنوي → عدد الاستحقاقات الواقعة في الفترة · مرة واحدة → 1 إن وقع التاريخ فيها.
 * بلا تاريخ استحقاق للدوريات غير الشهرية، أو بلا فترة محددة: تُخصم مرة واحدة (أسلم من الصفر الصامت).
 */
export function feeTimes(p: FeeProp, from?: string | null, to?: string | null): number {
  if (!p || p.mgmt_fee_mode !== "fixed") return 1;
  const per = feePeriodOf(p);
  if (per === "month") return monthsInPeriod(from, to);
  const on = p.mgmt_fee_on && D10.test(p.mgmt_fee_on) ? p.mgmt_fee_on.slice(0, 10) : null;
  if (!on || !from || !to || !D10.test(from) || !D10.test(to)) return 1;
  const f = from.slice(0, 10), t = to.slice(0, 10);
  if (per === "once") return on >= f && on <= t ? 1 : 0;
  const step = per === "half" ? 6 : 12;
  let n = 0;
  for (let k = 0, d = on; d <= t && k < 600; k++, d = addMonths(on, k * step)) if (d >= f) n++;
  return n;
}

/** نص الأتعاب للمستندات: «5%» أو «1,500 ريال شهريًّا / كل ٦ أشهر / سنويًّا / مرة واحدة» — null إن لم تُحدَّد */
export function feeLabel(p: FeeProp): string | null {
  const f = feeSpecOf(p);
  if (f.fixed) return `${f.fixed.toLocaleString("en-US")} ريال ${FEE_PERIODS.find((x) => x.v === feePeriodOf(p))!.adv}`;
  if (f.pct) return `${f.pct}%`;
  return null;
}

export type OwnerNet = {
  /** إجمالي المقبوض شاملًا الضريبة، والضريبة منه */
  grossCollected?: number; vatCollected?: number;
  /** الأتعاب قبل ضريبتها، وضريبتها إن كان المكتب مسجَّلًا */
  feeBase?: number; feeVat?: number;
  collected: number;      // المحصَّل خلال الفترة
  expenses: number;       // مصروفات الفترة
  feePct: number | null;  // نسبة أتعاب الإدارة المطبَّقة (null = لا أتعاب أو أتعاب ثابتة)
  /** (v86) المبلغ الشهري الثابت وعدد الأشهر المطبَّق — إن كانت الأتعاب ثابتة */
  feeFixed?: number | null; feeTimes?: number;
  fee: number;            // قيمة الأتعاب = المحصَّل × النسبة، أو الثابت × الأشهر
  net: number;            // الصافي للمالك
  /** الأتعاب + ضريبتها تتجاوز ما حُصّل — خطأ إدخال شبه مؤكّد في النسبة */
  feeExceedsCollected: boolean;
};

/**
 * حساب الصافي. الأتعاب تُحتسب من المحصَّل فعليًّا (لا من المستحق) —
 * فالمكتب يأخذ نسبته مما دخل، وهذا هو العرف في عقود إدارة الأملاك.
 */
/**
 * صافي المالك.
 *
 * تصحيح محاسبي مهم: ضريبة القيمة المضافة المحصَّلة مع إيجار الوحدات
 * التجارية ليست إيرادًا للمالك — هي أمانة تُورَّد لهيئة الزكاة والضريبة.
 * لذلك تُستبعد قبل حساب أتعاب الإدارة وقبل الصافي. وبدون هذا الاستبعاد
 * يتقاضى المكتب أتعابًا على ضريبة ليست له، ويظهر للمالك دخل أكبر مما قبض.
 *
 * @param collected  إجمالي المقبوض (شامل الضريبة إن وُجدت)
 * @param vatIncluded الضريبة داخل المبلغ أعلاه (0 للسكني)
 * @param feeVatRate  نسبة ضريبة على أتعاب الإدارة نفسها إن كان المكتب
 *                    مسجَّلًا ضريبيًّا (إدارة الأملاك خدمة خاضعة 15%)
 */
export function ownerNet(
  collected: number, expenses: ExpenseRow[], feeIn?: number | FeeSpec | null,
  vatIncluded = 0, feeVatRate = 0,
): OwnerNet {
  /* (v86) رقم = نسبة (توافق خلفي)؛ كائن = نسبة أو مبلغ ثابت × مرات الخصم (0 = لا استحقاق في الفترة) */
  const spec: FeeSpec = feeIn && typeof feeIn === "object" ? feeIn : { pct: feeIn as number | null | undefined };
  const feePct = spec.pct;
  const fixed = Number(spec.fixed) > 0 ? Number(spec.fixed) : null;
  const times = spec.times === undefined || spec.times === null ? 1 : Math.max(0, Math.round(Number(spec.times) || 0));
  const gross = r2(Number(collected) || 0);
  /* الضريبة لا تتجاوز المقبوض منطقيًّا؛ لكن خطأ بيانات (تصحيح دفعة، تراجع،
     أو استيراد ناقص) قد يجعلها أكبر — فتُقصّ هنا بدل أن تُنتج إيرادًا سالبًا
     للمالك وأتعابًا سالبة للمكتب. */
  const vat = r2(Math.min(gross, Math.max(0, Number(vatIncluded) || 0)));
  const c = r2(gross - vat);                       // إيراد المالك الفعلي
  const e = sumExpenses(expenses);
  const pct = Number(feePct);
  const validPct = !fixed && pct > 0 && pct <= 100 ? pct : null;
  /* (v99) «شاملة الضريبة»: المبلغ/النسبة التي حددها المكتب هي الإجمالي، وتُستخرج منها الضريبة */
  const feeAmt = fixed ? r2(fixed * times) : validPct ? r2((c * validPct) / 100) : 0;
  const incl = !!spec.inclusive && feeVatRate > 0;
  const feeBase = incl ? r2(feeAmt / (1 + feeVatRate / 100)) : feeAmt;
  const feeVat = feeAmt > 0 && feeVatRate > 0 ? (incl ? r2(feeAmt - feeBase) : r2((feeBase * feeVatRate) / 100)) : 0;
  const fee = r2(feeBase + feeVat);
  /**
   * الأتعاب تتجاوز المحصَّل؟ لا نُخفيها ولا نقصّها.
   *
   * نسبة 100% (وهي في الواقع خطأ إدخال: من كتب «100» يقصد ريالات لا نسبة)
   * تُنتج أتعابًا 115% بعد الضريبة، فيقرأ المالك أنه مدين للمكتب. القصّ
   * الصامت يُخفي خطأ البيانات ويُنتج رقمًا جميلًا كاذبًا؛ والصواب أن يبقى
   * الحساب صادقًا وأن يُرفع علم صريح يراه المكتب في التقرير.
   */
  const feeExceedsCollected = fee > c + 0.01;
  return { collected: c, grossCollected: gross, vatCollected: vat, expenses: e,
           feePct: validPct, feeFixed: fixed, feeTimes: fixed ? times : undefined,
           fee, feeBase, feeVat, feeExceedsCollected, net: r2(c - e - fee) };
}
