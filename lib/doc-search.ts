// ============================================================
// وثيق — البحث برقم السند ونص الحوالة (24 نوفمبر 2026 — طلب مكتب الأولى)
//
// «عندي رقم سند RC-00034 أو رسالة تحويل من البنك — لمن هذه الدفعة؟»
// خانة البحث في «كل العقارات» صارت تجد:
//   • سند قبض بالرقم: RC-00034 · rc34 · 34 · سند 34 · #34
//   • سند صرف بالرقم: PV-00012 · pv12
//   • نص من المرجع أو الملاحظة أو رقم الفاتورة (مثل آخر أرقام الحوالة أو اسم المحوِّل)
// كل الاستعلامات تمرّ بصلاحيات القاعدة (RLS) — المستخدم يرى سندات مكتبه فقط.
// ============================================================

export type DocQuery = {
  /** رقم السند إن كان البحث رقمًا (34 من RC-00034) */
  n: number | null;
  /** نوع السند إن ذُكرت البادئة: rc قبض · pv صرف · null الاثنان */
  kind: "rc" | "pv" | null;
  /** نص آمن للبحث داخل المرجع والملاحظة (بلا رموز تكسر الاستعلام)، أو "" */
  text: string;
};

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export const toLatinDigits = (s: string) =>
  String(s || "").replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) >= 0 ? AR_DIGITS.indexOf(d) : FA_DIGITS.indexOf(d)));

/**
 * يقرأ ما كتبه المستخدم.
 * رقم وحده (أو ببادئة) ← n. نص ≥ 3 أحرف ← text للبحث في المرجع والملاحظة.
 * الأرقام القصيرة جدًّا (حرف واحد) لا تُعدّ نصًّا حتى لا تطابق كل ملاحظة فيها رقم.
 */
export function parseDocQuery(raw: string): DocQuery {
  const s = toLatinDigits(String(raw || "")).trim();
  let n: number | null = null, kind: DocQuery["kind"] = null;
  const m = s.match(/^(?:(rc|r|pv|سند(?:\s*(?:قبض|صرف))?|#)\s*[-‐–—:]?\s*)?0*(\d{1,7})$/i);
  if (m) {
    const v = Number(m[2]);
    if (v > 0) {
      n = v;
      const p = (m[1] || "").toLowerCase();
      if (p === "rc" || p === "r" || /قبض/.test(p)) kind = "rc";
      else if (p === "pv" || /صرف/.test(p)) kind = "pv";
    }
  }
  /* PostgREST: الفاصلة والأقواس والنجمة و% وشرطة مائلة عكسية تكسر or() — تُحذف.
     المسافات المتعددة تُختصر، والنص يُقصّ عند 60 حرفًا (يكفي لأي مرجع). */
  const text = s.replace(/[,()*%\\"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return { n, kind, text: text.length >= 3 ? text : "" };
}

/** لاحقة الرقم كما تُكتب في القاعدة: RC-00034 · R-00034 · RC-123456 (schema-v80) */
export const numSuffix = (n: number) => (n < 100000 ? String(n).padStart(5, "0") : String(n));

/** شرط or() لجدول الدفعات — null إن لم يكن في البحث ما يُبحث به */
export function paymentsFilter(q: DocQuery): string | null {
  const parts: string[] = [];
  if (q.n && q.kind !== "pv") parts.push(`receipt_no.ilike.*-${numSuffix(q.n)}`);
  if (q.text) parts.push(`reference.ilike.*${q.text}*`, `note.ilike.*${q.text}*`, `payer_name.ilike.*${q.text}*`);
  return parts.length ? parts.join(",") : null;
}

/** شرط or() لجدول المصروفات */
export function expensesFilter(q: DocQuery): string | null {
  const parts: string[] = [];
  if (q.n && q.kind !== "rc") parts.push(`voucher_no.ilike.*-${numSuffix(q.n)}`);
  if (q.text) parts.push(`note.ilike.*${q.text}*`, `payee_ref.ilike.*${q.text}*`, `payee_name.ilike.*${q.text}*`, `invoice_no.ilike.*${q.text}*`);
  return parts.length ? parts.join(",") : null;
}

/** مقتطف قصير حول موضع التطابق — رسالة بنك طويلة لا تُعرض كلها في النتيجة */
export function snippet(full: string | null | undefined, needle: string, width = 70): string {
  const s = String(full || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= width) return s;
  const i = needle ? s.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (i < 0) return s.slice(0, width - 1) + "…";
  const start = Math.max(0, Math.min(i - Math.floor((width - needle.length) / 2), s.length - width));
  return (start > 0 ? "…" : "") + s.slice(start, start + width).trim() + (start + width < s.length ? "…" : "");
}
