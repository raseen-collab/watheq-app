// ============================================================
// وثيق — المصروفات وحساب «صافي المالك»
// المبدأ: تقرير يعرض التحصيل وحده نصف الحقيقة؛ سؤال المالك الفعلي
// «كم صافي لي؟» = المحصَّل − المصروفات − أتعاب الإدارة.
// دوال نقية بلا شبكة — تُستعمل في اللوحة والمستند وصفحة رابط المالك.
// ============================================================

export type ExpenseCategory = "maintenance" | "utilities" | "government" | "cleaning" | "other";

export type ExpenseRow = {
  id?: string;
  property_id?: string;
  unit?: string | null;
  category: ExpenseCategory | string;
  amount: number;
  spent_on: string;
  note?: string | null;
};

export const EXPENSE_CATS: Record<ExpenseCategory, { label: string; icon: string }> = {
  maintenance: { label: "صيانة",        icon: "🔧" },
  utilities:   { label: "فواتير خدمات", icon: "💡" },
  government:  { label: "رسوم حكومية",  icon: "🏛️" },
  cleaning:    { label: "نظافة",        icon: "🧹" },
  other:       { label: "أخرى",         icon: "📦" },
};

export const catLabel = (c?: string | null) =>
  EXPENSE_CATS[(c || "other") as ExpenseCategory]?.label || "أخرى";
export const catIcon = (c?: string | null) =>
  EXPENSE_CATS[(c || "other") as ExpenseCategory]?.icon || "📦";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function sumExpenses(rows: ExpenseRow[]): number {
  return r2((rows || []).reduce((s, x) => s + (Number(x.amount) || 0), 0));
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

export type OwnerNet = {
  /** إجمالي المقبوض شاملًا الضريبة، والضريبة منه */
  grossCollected?: number; vatCollected?: number;
  /** الأتعاب قبل ضريبتها، وضريبتها إن كان المكتب مسجَّلًا */
  feeBase?: number; feeVat?: number;
  collected: number;      // المحصَّل خلال الفترة
  expenses: number;       // مصروفات الفترة
  feePct: number | null;  // نسبة أتعاب الإدارة المطبَّقة (null = لا أتعاب)
  fee: number;            // قيمة الأتعاب = المحصَّل × النسبة
  net: number;            // الصافي للمالك
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
  collected: number, expenses: ExpenseRow[], feePct?: number | null,
  vatIncluded = 0, feeVatRate = 0,
): OwnerNet {
  const gross = r2(Number(collected) || 0);
  /* الضريبة لا تتجاوز المقبوض منطقيًّا؛ لكن خطأ بيانات (تصحيح دفعة، تراجع،
     أو استيراد ناقص) قد يجعلها أكبر — فتُقصّ هنا بدل أن تُنتج إيرادًا سالبًا
     للمالك وأتعابًا سالبة للمكتب. */
  const vat = r2(Math.min(gross, Math.max(0, Number(vatIncluded) || 0)));
  const c = r2(gross - vat);                       // إيراد المالك الفعلي
  const e = sumExpenses(expenses);
  const pct = Number(feePct);
  const validPct = pct > 0 && pct <= 100 ? pct : null;
  const feeBase = validPct ? r2((c * validPct) / 100) : 0;
  const feeVat = feeBase > 0 && feeVatRate > 0 ? r2((feeBase * feeVatRate) / 100) : 0;
  const fee = r2(feeBase + feeVat);
  return { collected: c, grossCollected: gross, vatCollected: vat, expenses: e,
           feePct: validPct, fee, feeBase, feeVat, net: r2(c - e - fee) };
}
