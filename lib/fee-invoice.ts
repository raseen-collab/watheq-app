/* ============================================================
 * وثيق — فاتورة أتعاب الإدارة من المكتب على المالك (schema-v99) — 23 نوفمبر 2026
 *
 * المرجع: دليل الوكلاء العقاريين (هيئة الزكاة والضريبة والجمارك) §5.2 — عمولة/أتعاب
 * الوكيل توريد مستقل خاضع للنسبة الأساسية 15%، حتى لو كان الإيجار نفسه سكنيًّا معفى.
 *
 * مصدر الرقم واحد: نفس ما يحسبه تقرير المالك (ownerNet في lib/expenses) — تُمرَّر
 * نتيجته هنا كما هي، فلا تخالف الفاتورة التقرير الذي استلمه المالك.
 * ============================================================ */
import { isValidVatNo } from "./einvoice";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type FeeInvoiceInput = {
  /** صافي المحصَّل الذي حُسبت عليه النسبة (بعد استبعاد ضريبة الإيجار للتجاري) */
  basis: number;
  /** النسبة (٪) أو المبلغ الثابت × مرات الاستحقاق — أحدهما */
  pct?: number | null;
  fixed?: number | null;
  times?: number | null;
  /** للمكتب رقم ضريبي صحيح؟ (الضريبة على الأتعاب تُفرض به فقط) */
  officeVatValid: boolean;
  vatRate?: number | null;
  /** «أتعابي شاملة الضريبة» (إعداد العقار) */
  inclusive?: boolean | null;
};

export type FeeInvoiceCalc = {
  /** الأتعاب كما يحددها المكتب (قبل الضريبة إن غير شاملة، وشاملة إن شاملة) — يُحفظ في invoices.amount */
  amount: number;
  base: number;
  vat: number;
  total: number;
  vatEnabled: boolean;
  rate: number;
  inclusive: boolean;
  /** صافي ما يتبقى للمالك من المحصَّل بعد خصم إجمالي الفاتورة */
  ownerAfter: number;
  mode: "pct" | "fixed";
  pct: number | null;
  fixed: number | null;
  times: number;
};

/**
 * حساب فاتورة الأتعاب. أمثلة يدوية:
 *  - سكني 5% غير شامل: 50,000 → 2,500 + 375 = 2,875 → للمالك 47,125
 *  - سكني 10% شامل: 50,000 → 5,000 شاملة = 4,347.83 + 652.17 → للمالك 45,000
 *  - ثابت 1,500 × شهرين: 3,000 + 450 = 3,450
 *  - مكتب غير مسجَّل: 5% من 50,000 = 2,500 بلا ضريبة
 */
export function feeInvoiceCalc(i: FeeInvoiceInput): FeeInvoiceCalc {
  const basis = r2(Math.max(0, i.basis));
  const fixed = Number(i.fixed) > 0 ? r2(Number(i.fixed)) : null;
  const times = fixed ? Math.max(0, Math.round(Number(i.times ?? 1) || 0)) : 1;
  const pct = !fixed && Number(i.pct) > 0 && Number(i.pct) <= 100 ? Number(i.pct) : null;
  const amount = fixed ? r2(fixed * times) : pct ? r2((basis * pct) / 100) : 0;
  const vatEnabled = !!i.officeVatValid;
  const rate = vatEnabled ? (Number(i.vatRate) > 0 ? Number(i.vatRate) : 15) : 0;
  const inclusive = vatEnabled && !!i.inclusive;
  let base = amount, vat = 0, total = amount;
  if (vatEnabled) {
    if (inclusive) { base = r2(amount / (1 + rate / 100)); vat = r2(amount - base); total = amount; }
    else { vat = r2((amount * rate) / 100); total = r2(amount + vat); }
  }
  return { amount, base, vat, total, vatEnabled, rate, inclusive, ownerAfter: r2(basis - total),
           mode: fixed ? "fixed" : "pct", pct, fixed, times };
}

/** ما يمنع الإصدار (فارغ = يجوز) */
export function feeInvoiceGaps(c: FeeInvoiceCalc, p: { owner_name?: string | null; owner_vat_number?: string | null; owner_address?: string | null },
                               office: { vat_number?: string | null; billing_address?: string | null; billing_name?: string | null; org_name?: string | null }): string[] {
  const g: string[] = [];
  if (!(c.amount > 0)) g.push(c.mode === "pct" ? "لا أتعاب لهذه الفترة: المحصَّل صفر أو النسبة غير محددة" : "لا أتعاب لهذه الفترة: لا استحقاق للمبلغ الثابت فيها");
  if (!String(p.owner_name || "").trim()) g.push("اسم المالك في بيانات العقار");
  if (c.vatEnabled) {
    if (!String(office.billing_address || "").trim()) g.push("عنوان المكتب (الإعدادات ← بيانات الفوترة)");
    if (!String(office.billing_name || office.org_name || "").trim()) g.push("اسم المكتب في الإعدادات");
    /* مالك مسجَّل في الضريبة = قياسية: يلزم عنوانه */
    if (isValidVatNo(p.owner_vat_number) && !String(p.owner_address || "").trim()) g.push("عنوان المالك (للفاتورة القياسية)");
  } else if (String(office.vat_number || "").trim()) {
    g.push("الرقم الضريبي للمكتب غير صحيح (١٥ رقمًا يبدأ وينتهي بـ3) — صحّحه أو احذفه لتصدر فاتورة بلا ضريبة");
  }
  return g;
}

/** نص «كيف حُسبت» — نفس الأرقام بلغة عادية للمكتب والمالك */
export function feeInvoiceExplain(c: FeeInvoiceCalc, basisLabel = "صافي المحصَّل في الفترة"): string[] {
  const f = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const L: string[] = [];
  if (c.mode === "pct") L.push(`الأتعاب = ${c.pct}% من ${basisLabel}`);
  else L.push(`الأتعاب = مبلغ ثابت ${f(c.fixed || 0)} ريال × ${c.times} ${c.times === 1 ? "مرة" : c.times === 2 ? "مرتين" : "مرات"}`);
  if (!c.vatEnabled) L.push(`بلا ضريبة قيمة مضافة: المكتب غير مسجَّل في الضريبة — الإجمالي ${f(c.total)} ريال`);
  else if (c.inclusive) L.push(`الأتعاب شاملة الضريبة ${c.rate}%: ${f(c.amount)} = ${f(c.base)} قبل الضريبة + ${f(c.vat)} ضريبة`);
  else L.push(`ضريبة القيمة المضافة ${c.rate}% على الأتعاب = ${f(c.vat)} — الإجمالي ${f(c.total)} ريال`);
  L.push("الضريبة على أتعاب الإدارة واجبة ولو كان الإيجار سكنيًّا معفى (دليل الوكلاء العقاريين §5.2).");
  return L;
}

/** تسمية الفترة في الفاتورة: «نوفمبر 2026» أو «1 – 15 نوفمبر 2026» */
export function feePeriodLabel(from: string, to: string): string {
  const M = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const f = from.slice(0, 10), t = to.slice(0, 10);
  const fy = f.slice(0, 4), fm = Number(f.slice(5, 7)), fd = Number(f.slice(8, 10));
  const ty = t.slice(0, 4), tm = Number(t.slice(5, 7)), td = Number(t.slice(8, 10));
  const lastDay = new Date(Number(ty), tm, 0).getDate();
  if (fy === ty && fm === tm && fd === 1 && td === lastDay) return `${M[fm - 1]} ${fy}`;
  if (fy === ty && fd === 1 && td === lastDay) return `${M[fm - 1]} – ${M[tm - 1]} ${fy}`;
  return `${fd} ${M[fm - 1]} ${fy} – ${td} ${M[tm - 1]} ${ty}`;
}

export const FEE_PAYMENT_MEANS: Record<string, string> = { deduction: "خصم من المحصَّل", transfer: "تحويل بنكي", cash: "نقدًا", cheque: "شيك", card: "بطاقة", sadad: "سداد", other: "أخرى" };
export const FEE_PAYMENT_MEANS_EN: Record<string, string> = { deduction: "Deducted from collections", transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", sadad: "SADAD", other: "Other" };
