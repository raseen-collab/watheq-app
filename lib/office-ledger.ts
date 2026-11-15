// ============================================================
// وثيق — دفتر حسابات المكتب (schema-v84)
//
// سؤال المكتب: «كم دخل مكتبي وكم صرفت؟» — وهو غير سؤال المالك «كم صافي لي؟».
// الدفتر يجمع ثلاثة مصادر ولا يكتب في أيٍّ منها:
//   1) أتعاب الإدارة المحتسبة من المحصَّل (معادلة تقرير المالك نفسها — لا تُسجَّل يدويًّا)
//   2) قيود المكتب اليدوية (office_ledger): سعي، رسوم توثيق، دخل آخر · إيجار المكتب، رواتب…
//   3) مصروفات العقارات الموسومة «على المكتب» (expenses.billable = false)
// دوال نقية بلا شبكة — تُستعمل في الصفحة وتختبرها tests/office-ledger.js.
// ============================================================

export type LedgerKind = "income" | "expense";

export type LedgerEntry = {
  id?: string;
  user_id?: string;
  kind: LedgerKind;
  category: string;
  amount: number;
  entry_on: string;
  property_id?: string | null;
  unit?: string | null;
  party?: string | null;
  note?: string | null;
  reference?: string | null;
  created_at?: string;
};

export const INCOME_CATS: Record<string, { label: string; icon: string; hint: string }> = {
  brokerage:     { label: "سعي",          icon: "🤝", hint: "عمولة تأجير أو بيع" },
  documentation: { label: "رسوم توثيق",   icon: "📝", hint: "توثيق عقد في إيجار أو ما شابه" },
  management_fee:{ label: "أتعاب إدارة",  icon: "📊", hint: "يدويًّا فقط لعقار لم تحدد له نسبة أتعاب — وإلا تُحتسب تلقائيًّا من المحصَّل" },
  other_income:  { label: "دخل آخر",      icon: "💼", hint: "استشارة، تقدير، خدمة" },
};

export const EXPENSE_CATS_OFFICE: Record<string, { label: string; icon: string; hint: string }> = {
  office_rent:   { label: "إيجار المكتب",   icon: "🏢", hint: "" },
  salaries:      { label: "رواتب موظفين",   icon: "👥", hint: "موظفو المكتب — لا حارس العمارة (ذاك مصروف عقار)" },
  subscriptions: { label: "اشتراكات",       icon: "💳", hint: "برامج، إنترنت، جوال" },
  marketing:     { label: "تسويق",          icon: "📣", hint: "إعلانات، لوحات، منصات" },
  government:    { label: "رسوم حكومية",    icon: "🏛️", hint: "رخص المكتب، فال، غرفة تجارية" },
  other_expense: { label: "أخرى",           icon: "📦", hint: "" },
};

export const ledgerCatLabel = (kind: LedgerKind, c: string) =>
  (kind === "income" ? INCOME_CATS : EXPENSE_CATS_OFFICE)[c]?.label || (kind === "income" ? "دخل آخر" : "أخرى");
export const ledgerCatIcon = (kind: LedgerKind, c: string) =>
  (kind === "income" ? INCOME_CATS : EXPENSE_CATS_OFFICE)[c]?.icon || (kind === "income" ? "💼" : "📦");

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** هل القيد صالح للحفظ؟ يُرجع رسالة الخطأ أو null */
export function validateEntry(e: Partial<LedgerEntry>): string | null {
  if (e.kind !== "income" && e.kind !== "expense") return "نوع القيد غير محدد";
  const cats = e.kind === "income" ? INCOME_CATS : EXPENSE_CATS_OFFICE;
  if (!e.category || !cats[e.category]) return "اختر التصنيف";
  if (!(Number(e.amount) > 0)) return "المبلغ مطلوب وأكبر من صفر";
  if (!e.entry_on || !/^\d{4}-\d{2}-\d{2}$/.test(e.entry_on)) return "التاريخ مطلوب";
  if (e.note && e.note.length > 300) return "البيان طويل (300 حرف كحد أقصى)";
  if (e.party && e.party.length > 160) return "اسم الطرف طويل";
  return null;
}

/** مصروف عقار يُحمَّل على المكتب؟ (لا يُخصم من المالك) */
export const isOfficeBorne = (x: { billable?: boolean | null }) => x.billable === false;

export type LedgerLine = {
  source: "fee" | "ledger" | "property";
  kind: LedgerKind;
  category: string;
  label: string;
  amount: number;
  date: string;
  property?: string | null;
  unit?: string | null;
  party?: string | null;
  note?: string | null;
  id?: string;
};

export type LedgerSummary = {
  income: { fees: number; feeVat: number; manual: number; manualFees: number; total: number; byCat: { category: string; label: string; total: number }[] };
  /** أتعاب محتسبة ويدوية في الفترة نفسها — احتمال احتساب مرتين، يُعرض تنبيهًا */
  feeDoubleRisk: boolean;
  expense: { manual: number; property: number; total: number; byCat: { category: string; label: string; total: number }[] };
  net: number;
  /** سلف دفعها المكتب عن الملّاك وتُستردّ من التحصيل — ليست مصروف مكتب، لكنها نقد خرج منه */
  advances: number;
  lines: LedgerLine[];
};

/**
 * يجمع الدفتر لفترة واحدة.
 * @param fees   أتعاب الإدارة المحتسبة للفترة (من buildCollection: fin.fee = الأساس، fin.feeVat)
 * @param entries قيود office_ledger داخل الفترة
 * @param propertyExpenses مصروفات العقارات داخل الفترة (كل الحقول) — يُؤخذ منها ما على المكتب والسلف
 */
export function ledgerSummary(input: {
  fees: { fee: number; feeVat?: number };
  entries: LedgerEntry[];
  propertyExpenses: { id?: string; amount: number; spent_on: string; category?: string | null; note?: string | null;
                      billable?: boolean | null; paid_by?: string | null; property_id?: string | null; unit?: string | null; vendor?: string | null }[];
  propertyNames?: Record<string, string>;
  /** اسم التصنيف لمصروفات العقار (من lib/expenses) — اختياري لإبقاء الدالة بلا اعتماد */
  propCatLabel?: (c: string) => string;
}): LedgerSummary {
  const pn = input.propertyNames || {};
  const pcl = input.propCatLabel || ((c: string) => c || "أخرى");
  const lines: LedgerLine[] = [];

  const fee = r2(input.fees?.fee || 0);
  const feeVat = r2(input.fees?.feeVat || 0);
  if (fee > 0) lines.push({ source: "fee", kind: "income", category: "management_fee_auto", label: "أتعاب الإدارة (محتسبة من المحصَّل)", amount: fee, date: "" });

  const incomeBy: Record<string, number> = {};
  const expenseBy: Record<string, number> = {};
  let manualIncome = 0, manualExpense = 0, manualFees = 0;
  for (const e of input.entries || []) {
    const amt = r2(e.amount);
    if (!(amt > 0)) continue;
    if (e.kind === "income" && e.category === "management_fee") manualFees += amt;
    const label = ledgerCatLabel(e.kind, e.category);
    lines.push({ source: "ledger", kind: e.kind, category: e.category, label, amount: amt, date: e.entry_on,
      property: e.property_id ? (pn[e.property_id] || null) : null, unit: e.unit || null, party: e.party || null, note: e.note || null, id: e.id });
    if (e.kind === "income") { manualIncome += amt; incomeBy[e.category] = (incomeBy[e.category] || 0) + amt; }
    else { manualExpense += amt; expenseBy[e.category] = (expenseBy[e.category] || 0) + amt; }
  }

  let propertyExpense = 0, advances = 0;
  for (const x of input.propertyExpenses || []) {
    const amt = r2(x.amount);
    if (!(amt > 0)) continue;
    if (isOfficeBorne(x)) {
      propertyExpense += amt;
      const key = `prop:${x.category || "other"}`;
      expenseBy[key] = (expenseBy[key] || 0) + amt;
      lines.push({ source: "property", kind: "expense", category: key, label: `${pcl(String(x.category || "other"))} — مصروف عقار على المكتب`,
        amount: amt, date: x.spent_on, property: x.property_id ? (pn[x.property_id] || null) : null, unit: x.unit || null,
        party: x.vendor || null, note: x.note || null, id: x.id });
    } else if (x.paid_by === "office") {
      advances += amt;
    }
  }

  const incomeTotal = r2(fee + manualIncome);
  const expenseTotal = r2(manualExpense + propertyExpense);
  const byCat = (m: Record<string, number>, kind: LedgerKind) => Object.entries(m)
    .map(([category, total]) => ({ category, total: r2(total),
      label: category.startsWith("prop:") ? `${pcl(category.slice(5))} (عقارات)` : ledgerCatLabel(kind, category) }))
    .sort((a, b) => b.total - a.total);
  if (fee > 0) incomeBy["management_fee_auto"] = fee;
  const incomeCats = byCat(incomeBy, "income").map((c) => c.category === "management_fee_auto" ? { ...c, label: "أتعاب الإدارة (محتسبة)" }
    : c.category === "management_fee" ? { ...c, label: "أتعاب إدارة (مسجَّلة يدويًّا)" } : c);

  lines.sort((a, b) => (b.date || "9999").localeCompare(a.date || "9999"));
  return {
    income: { fees: fee, feeVat, manual: r2(manualIncome), manualFees: r2(manualFees), total: incomeTotal, byCat: incomeCats },
    feeDoubleRisk: fee > 0 && manualFees > 0,
    expense: { manual: r2(manualExpense), property: r2(propertyExpense), total: expenseTotal, byCat: byCat(expenseBy, "expense") },
    net: r2(incomeTotal - expenseTotal),
    advances: r2(advances),
    lines,
  };
}

/** حدود الفترة: شهر "YYYY-MM" أو سنة "YYYY" */
export function periodBounds(key: string): { from: string; to: string; label: string } | null {
  const AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  if (/^\d{4}-\d{2}$/.test(key)) {
    const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
    if (m < 1 || m > 12) return null;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}`, label: `${AR[m - 1]} ${y}` };
  }
  if (/^\d{4}$/.test(key)) return { from: `${key}-01-01`, to: `${key}-12-31`, label: `سنة ${key}` };
  return null;
}

/** صفوف CSV للتصدير (UTF-8 مع BOM يفتحه Excel عربيًّا) */
export function ledgerCSV(lines: LedgerLine[], periodLabel: string): string {
  const esc = (v: any) => { const t = String(v ?? "").replace(/"/g, '""'); return /[",\n]/.test(t) ? `"${t}"` : t; };
  const head = ["الفترة", "التاريخ", "النوع", "التصنيف", "البيان", "العقار", "الوحدة", "الطرف", "المبلغ", "المصدر"];
  const rows = lines.map((l) => [periodLabel, l.date || "الفترة كلها", l.kind === "income" ? "دخل" : "مصروف", l.label, l.note || "", l.property || "", l.unit || "", l.party || "",
    (l.kind === "income" ? 1 : -1) * l.amount, l.source === "fee" ? "محتسب" : l.source === "property" ? "مصروف عقار" : "قيد مكتب"]);
  return "\uFEFF" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

/** تعبئة مسبقة من رابط (مثل «سجّل السعي» من المعروضات): ?add=income&cat=brokerage&amount=6250&note=…&ref=…&property=… */
export function prefillFromQuery(q: URLSearchParams | Record<string, string | null | undefined>): Partial<LedgerEntry> | null {
  const g = (k: string) => (q instanceof URLSearchParams ? q.get(k) : (q as any)[k]) ?? null;
  const kind = g("add");
  if (kind !== "income" && kind !== "expense") return null;
  const cats = kind === "income" ? INCOME_CATS : EXPENSE_CATS_OFFICE;
  const cat = g("cat");
  const amount = Number(g("amount"));
  return {
    kind, category: cat && cats[cat] ? cat : Object.keys(cats)[0],
    amount: amount > 0 ? Math.round(amount * 100) / 100 : undefined,
    note: (g("note") || "").slice(0, 300) || null, reference: (g("ref") || "").slice(0, 80) || null,
    property_id: g("property") || null, unit: (g("unit") || "").slice(0, 40) || null, party: (g("party") || "").slice(0, 160) || null,
  };
}
