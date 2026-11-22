/**
 * وثيق — «تصدير الفواتير للمحاسب» (22 نوفمبر 2026).
 *
 * لماذا: من 1 فبراير 2027 (الموجة 25 من الربط مع «فاتورة») كل منشأة إيراداتها
 * الخاضعة للضريبة فوق 187,500 ريال تصدر فواتيرها من نظام مربوط بالهيئة.
 * وثيق ليس نظامًا محاسبيًّا ولا مربوطًا بالهيئة — فبدل أن يعيد المكتب كتابة
 * فواتير الإيجار التجاري يدويًّا في برنامجه المحاسبي، يأخذها من هنا ملفًّا
 * جاهزًا للاستيراد: صف لكل فاتورة بالمبلغ قبل الضريبة والضريبة والإجمالي.
 *
 * المبالغ من الفاتورة كما صدرت: إعدادات الضريبة المحفوظة عليها يوم الإصدار
 * (schema-v56)، وللفواتير الأقدم بلا لقطة: إعدادات الوحدة والعقار الحالية.
 * الحساب نفسه splitVat المستعمل في الفاتورة المطبوعة — رقم واحد في المكانين.
 */
import { splitVat, unitVat, type VatSettings } from "@/lib/contracts";
import { isValidVatNo } from "@/lib/einvoice";

export type InvRow = {
  id: string; invoice_no: string; issue_date: string | null; due_date: string | null; created_at?: string | null;
  period_label: string | null; amount: number | string | null; status: string | null;
  tenant_id: string | null; property_id: string | null;
  vat_enabled?: boolean | null; vat_rate?: number | string | null; vat_inclusive?: boolean | null; legacy_dup?: boolean | null;
  /** (v95) الإشعار الدائن ولقطة البائع لحظة الإصدار */
  doc_type?: string | null; ref_invoice_id?: string | null; reason?: string | null;
  seller_name?: string | null; seller_vat?: string | null; buyer_name?: string | null; unit_label?: string | null; property_name?: string | null;
  /** (v96) قياسية/مبسطة ورقم المشتري الضريبي */
  invoice_kind?: string | null; buyer_vat?: string | null;
};
export type ExportTenant = { id: string; name?: string | null; unit?: string | null; unit_type?: string | null; vat_mode?: string | null };
export type ExportProp = { id: string; name?: string | null; owner_name?: string | null; property_type?: string | null;
  vat_enabled?: boolean | null; vat_rate?: number | string | null; vat_inclusive?: boolean | null };
export type Issuer = { billing_name?: string | null; org_name?: string | null; vat_number?: string | null; cr_number?: string | null };

export type ExportLine = {
  invoice_no: string; issue_date: string; due_date: string; kind: "ضريبية" | "غير ضريبية" | "إشعار دائن";
  customer: string; property: string; owner: string; unit: string; description: string;
  base: number; vat_rate: number; vat: number; total: number; status: string; voided: boolean;
  seller: string; seller_vat: string;
  /** (v96) «قياسية» للمستأجر المسجَّل، «مبسطة» لغيره، فارغ لغير الضريبية */
  tax_type: string; buyer_vat: string;
  /** (v95) إشعار دائن: مبالغه سالبة، ويُحتسب في شهر إصداره */
  credit?: boolean;
  /** (v95) فاتورة ملغاة بإشعار دائن: تبقى في شهرها والإشعار يطرحها في شهره */
  cancelledByNote?: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const STATUS_AR: Record<string, string> = { issued: "صادرة", paid: "مدفوعة", void: "ملغاة" };

/** إعدادات الضريبة كما صدرت الفاتورة — اللقطة المحفوظة أولًا */
export function invoiceVat(inv: InvRow, t?: ExportTenant | null, p?: ExportProp | null): VatSettings {
  if (inv.vat_enabled === true || inv.vat_enabled === false) {
    return { enabled: inv.vat_enabled, rate: Number(inv.vat_rate) || 15, inclusive: inv.vat_inclusive !== false };
  }
  return unitVat(t || {}, p || null);
}

export function exportLines(input: {
  invoices: InvRow[]; tenants: ExportTenant[]; props: ExportProp[]; issuer: Issuer;
  holderOf?: (inv: InvRow) => { name?: string | null; unit?: string | null } | null;
  from?: string; to?: string;  // تاريخ الإصدار ضمن [from, to] شاملًا
}): ExportLine[] {
  const tById = new Map(input.tenants.map((t) => [t.id, t]));
  const pById = new Map(input.props.map((p) => [p.id, p]));
  const seller = input.issuer.billing_name || input.issuer.org_name || "";
  const sellerVat = (input.issuer.vat_number || "").trim();
  const invById = new Map(input.invoices.map((i) => [i.id, i]));
  /* الفواتير التي ألغاها إشعار دائن — قبل فلتر الفترة: الإشعار قد يقع في شهر لاحق */
  const noted = new Set(input.invoices.filter((i) => i.doc_type === "credit_note" && i.ref_invoice_id).map((i) => i.ref_invoice_id!));
  const out: ExportLine[] = [];
  for (const inv of input.invoices) {
    if (inv.legacy_dup) continue;                       // نسخة مكرّرة قديمة صُحّحت — ليست فاتورة
    const day = (inv.issue_date || (inv.created_at || "").slice(0, 10)) || "";
    if (input.from && day < input.from) continue;
    if (input.to && day > input.to) continue;
    const t = inv.tenant_id ? tById.get(inv.tenant_id) || null : null;
    const p = inv.property_id ? pById.get(inv.property_id) || null : null;
    const holder = input.holderOf?.(inv) || null;
    const v = invoiceVat(inv, t, p);
    const x = splitVat(Number(inv.amount) || 0, v);
    const unit = inv.unit_label || holder?.unit || t?.unit || "";
    /* البائع: لقطة الفاتورة (v95 — قد يكون المالك) وإلا المكتب كما كان */
    const sName = (inv.seller_name || "").trim() || seller;
    const sVat = inv.seller_name != null || inv.seller_vat != null ? (inv.seller_vat || "").trim() : sellerVat;
    const isTax = x.enabled && isValidVatNo(sVat);
    const cn = inv.doc_type === "credit_note";
    const ref = cn && inv.ref_invoice_id ? invById.get(inv.ref_invoice_id) : null;
    const sign = cn ? -1 : 1;
    const propName = inv.property_name || p?.name || "";
    out.push({
      invoice_no: inv.invoice_no, issue_date: day, due_date: cn ? "" : inv.due_date || "",
      kind: cn ? "إشعار دائن" : isTax ? "ضريبية" : "غير ضريبية",
      customer: inv.buyer_name || holder?.name || t?.name || "", property: propName, owner: p?.owner_name || "", unit,
      description: cn
        ? `إشعار دائن يلغي ${ref?.invoice_no || "فاتورة"}${inv.reason ? ` — ${inv.reason}` : ""}`
        : (inv as any).subject === "mgmt_fee"
          ? `أتعاب إدارة الأملاك على المالك${propName ? ` — ${propName}` : ""}${inv.period_label ? ` عن ${inv.period_label}` : ""}`
          : `إيجار${unit ? ` وحدة ${unit}` : ""}${propName ? ` — ${propName}` : ""}${inv.period_label ? ` عن ${inv.period_label}` : ""}`,
      base: r2(sign * x.base), vat_rate: x.enabled ? x.rate : 0, vat: r2(sign * x.vat), total: r2(sign * x.total),
      status: cn ? "صادر" : STATUS_AR[inv.status || ""] || inv.status || "", voided: !cn && inv.status === "void",
      seller: sName, seller_vat: sVat,
      tax_type: isTax ? (inv.invoice_kind === "standard" ? "قياسية" : "مبسطة") : "",
      buyer_vat: inv.invoice_kind === "standard" ? (inv.buyer_vat || "") : "",
      credit: cn, cancelledByNote: !cn && noted.has(inv.id),
    });
  }
  return out.sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.invoice_no.localeCompare(b.invoice_no));
}

/**
 * ملخّص شهري لإقرار الضريبة.
 * - فاتورة ألغاها إشعار دائن (v95): تبقى في شهر إصدارها، والإشعار يطرحها في شهر إصداره —
 *   فإن أُلغيت فاتورة يناير في فبراير بعد تقديم إقرار يناير، يظهر التصحيح في فبراير.
 * - فاتورة ملغاة قبل v95 (بلا إشعار): خارج المجاميع كما كانت.
 */
export function monthlySummary(lines: ExportLine[]) {
  const m = new Map<string, { month: string; count: number; base: number; vat: number; total: number; taxableBase: number }>();
  for (const l of lines) {
    if (l.voided && !l.cancelledByNote) continue;
    const k = l.issue_date.slice(0, 7) || "—";
    const s = m.get(k) || { month: k, count: 0, base: 0, vat: 0, total: 0, taxableBase: 0 };
    s.count++; s.base = r2(s.base + l.base); s.vat = r2(s.vat + l.vat); s.total = r2(s.total + l.total);
    if (l.vat !== 0) s.taxableBase = r2(s.taxableBase + l.base);
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export const EXPORT_HEAD = ["رقم الفاتورة", "تاريخ الإصدار", "تاريخ الاستحقاق", "نوع الفاتورة", "العميل (المستأجر)", "العقار", "المالك", "الوحدة", "البيان",
  "المبلغ قبل الضريبة", "نسبة الضريبة %", "مبلغ الضريبة", "الإجمالي", "الحالة", "البائع", "الرقم الضريبي للبائع",
  "قياسية / مبسطة", "الرقم الضريبي للعميل"] as const;

export const lineCells = (l: ExportLine) => [l.invoice_no, l.issue_date, l.due_date, l.kind, l.customer, l.property, l.owner, l.unit, l.description,
  l.base, l.vat_rate, l.vat, l.total, l.status, l.seller, l.seller_vat, l.tax_type, l.buyer_vat];

/** CSV بترميز UTF-8 مع BOM — يفتحه Excel عربيًّا ويقبله أغلب البرامج المحاسبية في الاستيراد */
export function exportCSV(lines: ExportLine[]): string {
  const esc = (v: any) => { const s = String(v ?? "").replace(/"/g, '""'); return /[",\n\r]/.test(s) ? `"${s}"` : s; };
  return "﻿" + [EXPORT_HEAD as readonly string[], ...lines.map(lineCells)].map((r) => r.map(esc).join(",")).join("\r\n");
}
