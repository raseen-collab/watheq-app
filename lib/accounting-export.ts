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

export type InvRow = {
  id: string; invoice_no: string; issue_date: string | null; due_date: string | null; created_at?: string | null;
  period_label: string | null; amount: number | string | null; status: string | null;
  tenant_id: string | null; property_id: string | null;
  vat_enabled?: boolean | null; vat_rate?: number | string | null; vat_inclusive?: boolean | null; legacy_dup?: boolean | null;
};
export type ExportTenant = { id: string; name?: string | null; unit?: string | null; unit_type?: string | null; vat_mode?: string | null };
export type ExportProp = { id: string; name?: string | null; owner_name?: string | null; property_type?: string | null;
  vat_enabled?: boolean | null; vat_rate?: number | string | null; vat_inclusive?: boolean | null };
export type Issuer = { billing_name?: string | null; org_name?: string | null; vat_number?: string | null; cr_number?: string | null };

export type ExportLine = {
  invoice_no: string; issue_date: string; due_date: string; kind: "ضريبية" | "غير ضريبية";
  customer: string; property: string; owner: string; unit: string; description: string;
  base: number; vat_rate: number; vat: number; total: number; status: string; voided: boolean;
  seller: string; seller_vat: string;
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
    const unit = holder?.unit || t?.unit || "";
    const isTax = x.enabled && !!sellerVat;
    out.push({
      invoice_no: inv.invoice_no, issue_date: day, due_date: inv.due_date || "",
      kind: isTax ? "ضريبية" : "غير ضريبية",
      customer: holder?.name || t?.name || "", property: p?.name || "", owner: p?.owner_name || "", unit,
      description: `إيجار${unit ? ` وحدة ${unit}` : ""}${p?.name ? ` — ${p.name}` : ""}${inv.period_label ? ` عن ${inv.period_label}` : ""}`,
      base: x.base, vat_rate: x.enabled ? x.rate : 0, vat: x.vat, total: x.total,
      status: STATUS_AR[inv.status || ""] || inv.status || "", voided: inv.status === "void",
      seller, seller_vat: sellerVat,
    });
  }
  return out.sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.invoice_no.localeCompare(b.invoice_no));
}

/** ملخّص شهري لإقرار الضريبة — الملغاة خارج المجاميع */
export function monthlySummary(lines: ExportLine[]) {
  const m = new Map<string, { month: string; count: number; base: number; vat: number; total: number; taxableBase: number }>();
  for (const l of lines) {
    if (l.voided) continue;
    const k = l.issue_date.slice(0, 7) || "—";
    const s = m.get(k) || { month: k, count: 0, base: 0, vat: 0, total: 0, taxableBase: 0 };
    s.count++; s.base = r2(s.base + l.base); s.vat = r2(s.vat + l.vat); s.total = r2(s.total + l.total);
    if (l.vat > 0) s.taxableBase = r2(s.taxableBase + l.base);
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export const EXPORT_HEAD = ["رقم الفاتورة", "تاريخ الإصدار", "تاريخ الاستحقاق", "نوع الفاتورة", "العميل (المستأجر)", "العقار", "المالك", "الوحدة", "البيان",
  "المبلغ قبل الضريبة", "نسبة الضريبة %", "مبلغ الضريبة", "الإجمالي", "الحالة", "البائع", "الرقم الضريبي للبائع"] as const;

export const lineCells = (l: ExportLine) => [l.invoice_no, l.issue_date, l.due_date, l.kind, l.customer, l.property, l.owner, l.unit, l.description,
  l.base, l.vat_rate, l.vat, l.total, l.status, l.seller, l.seller_vat];

/** CSV بترميز UTF-8 مع BOM — يفتحه Excel عربيًّا ويقبله أغلب البرامج المحاسبية في الاستيراد */
export function exportCSV(lines: ExportLine[]): string {
  const esc = (v: any) => { const s = String(v ?? "").replace(/"/g, '""'); return /[",\n\r]/.test(s) ? `"${s}"` : s; };
  return "﻿" + [EXPORT_HEAD as readonly string[], ...lines.map(lineCells)].map((r) => r.map(esc).join(",")).join("\r\n");
}
