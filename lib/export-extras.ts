// ============================================================
// وثيق — مساعدات التصدير (24 نوفمبر 2026)
// دوال صافية لتُختبر: وقت الرياض، فرق «قبل ← بعد» لتعديل الدفعة، ومسار الصورة داخل ZIP.
// ============================================================

/** ‎2026-11-23T15:40:00Z ← «2026-11-23 18:40» بتوقيت الرياض، أرقام لاتينية */
export function atRiyadh(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const EDIT_LABEL: Record<string, string> = {
  amount: "المبلغ", paid_on: "التاريخ", method: "الطريقة", reference: "مرجع الحوالة", note: "الملاحظة",
  periods_covered: "الدفعات المغطاة", applies_to: "تسدّد",
};
const show = (k: string, v: any, methods: Record<string, string>) => {
  if (v === null || v === undefined || v === "") return "—";
  if (k === "method") return methods[String(v)] || String(v);
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

/** «المبلغ: 1000 ← 1200 · الطريقة: نقدًا ← تحويل بنكي» — الحقول التي تغيّرت فقط */
export function diffEdit(before: any, after: any, methods: Record<string, string> = {}): string {
  const b = before || {}, a = after || {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(b[k] ?? null) === JSON.stringify(a[k] ?? null)) continue;
    out.push(`${EDIT_LABEL[k] || k}: ${show(k, b[k], methods)} ← ${show(k, a[k], methods)}`);
  }
  return out.join(" · ") || "بلا تغيير ظاهر";
}

/** جزء مسار آمن لكل أنظمة الملفات: بلا / \ : * ? " < > | وبلا مسافات طرفية */
const seg = (s: string) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "—";

/** «برج النخيل/وحدة 12 — 2026-11-20 — 1a2b3c4d/قبل-before-1.jpg» */
export function zipPath(property: string, unit: string | null | undefined, day: string, requestId: string, file: string): string {
  const folder = `${unit ? `وحدة ${seg(unit)} — ` : ""}${seg(day)} — ${String(requestId).slice(0, 8)}`;
  const side = /^after-/.test(file) ? "بعد" : "قبل";
  return `${seg(property)}/${seg(folder)}/${side}-${seg(file)}`;
}

/** (v103) أسماء جداول «سجل التغييرات» بلغة المكتب */
export const AUDIT_TABLE_AR: Record<string, string> = {
  properties: "العقارات", tenants: "الوحدات والمستأجرون", property_notes: "سجل العقار", payments: "الدفعات",
  expenses: "المصروفات", expense_templates: "المصروفات المتكررة", ledger_adjustments: "التصحيحات", past_tenancies: "المستأجرون السابقون",
  trust_ledger: "الضمان والعدادات", office_ledger: "دفتر المكتب", tenant_requests: "طلبات الصيانة", tenant_payment_claims: "بلاغات الحوالات",
  maintenance_vendors: "دليل الفنيين", office_messages: "الرسائل الداخلية", compliance_items: "التزامات المكتب",
  listings: "المعروضات", listing_shows: "عرض على", seeker_requests: "طلبات الباحثين",
  associations: "الجمعيات", owners: "ملاك الجمعيات", association_notes: "سجل الجمعيات", association_expenses: "مصروفات الجمعيات",
  association_budgets: "ميزانيات الجمعيات", hoa_documents: "مستندات الجمعيات", hoa_requests: "طلبات الملاك", hoa_payment_claims: "بلاغات حوالات الملاك",
};

/** وصف قصير للسطر المتأثر: «برج النخيل — شقة 12 — محمد» أو «سند RC-00012 — 1,200» */
export function auditSubject(a: { old_row?: any; new_row?: any }, propName: Record<string, string> = {}): string {
  const r = { ...(a.old_row || {}), ...(a.new_row || {}) };
  const parts = [
    r.property_id && propName[r.property_id], r.unit ? `وحدة ${r.unit}` : "", r.name || r.tenant_name || r.payer_name || r.title || r.customer_name || "",
    r.receipt_no || r.voucher_no || r.doc_no || r.code || "", r.amount != null && r.amount !== "" ? `${Number(r.amount).toLocaleString("en-US")} ريال` : "",
    !r.name && r.text ? String(r.text).slice(0, 60) : "",
  ].filter(Boolean);
  return parts.join(" — ") || String(r.id || "").slice(0, 8);
}
