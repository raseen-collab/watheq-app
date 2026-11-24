// ============================================================
// وثيق — النسخة الشهرية الكاملة لصاحب المكتب (24 نوفمبر 2026 — طلب عبيد)
//
// «نكون عند وعدنا»: أول كل شهر يصل صاحب المكتب على تليجرامه ملف ZIP فيه
//   • Excel: ورقة لكل جدول، بكل الأعمدة، وكل صف أدخله أي موظف — بلا استثناء.
//   • JSON: النسخة نفسها حرفًا بحرف (للاسترجاع الكامل، ولما يتجاوز حدّ خلية Excel).
//   • اقرأني.txt
// الجداول هنا كل ما يخص المكتب في القاعدة (قارن بـ components/ExportData BACKUP_TABLES).
// يُستبعد فقط: الرموز (token/token_hash) وعناوين IP — أسرار روابط لا بيانات.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";

/** كيف يُعرف أن الصف يخص المكتب */
export type Scope = "user" | "property" | "association" | "owner" | "template";
export type TableSpec = { table: string; scope: Scope; ar: string };

export const OFFICE_TABLES: TableSpec[] = [
  { table: "properties", scope: "user", ar: "العقارات" },
  { table: "tenants", scope: "property", ar: "الوحدات والمستأجرون" },
  { table: "payments", scope: "user", ar: "الدفعات" },
  { table: "payment_edits", scope: "user", ar: "تعديلات الدفعات" },
  { table: "ledger_adjustments", scope: "user", ar: "سجل التصحيحات" },
  { table: "past_tenancies", scope: "user", ar: "المستأجرون السابقون" },
  { table: "invoices", scope: "user", ar: "الفواتير" },
  { table: "invoice_events", scope: "user", ar: "سجل الفواتير" },
  { table: "expenses", scope: "user", ar: "المصروفات" },
  { table: "expense_templates", scope: "user", ar: "المصروفات المتكررة" },
  { table: "expense_template_skips", scope: "template", ar: "إيقافات المتكرر" },
  { table: "trust_ledger", scope: "user", ar: "الأمانات" },
  { table: "office_ledger", scope: "user", ar: "دفتر المكتب" },
  { table: "property_notes", scope: "property", ar: "سجل العقار" },
  { table: "tenant_requests", scope: "user", ar: "طلبات الصيانة" },
  { table: "maintenance_vendors", scope: "user", ar: "دليل الفنيين" },
  { table: "tenant_payment_claims", scope: "user", ar: "بلاغات الحوالات" },
  { table: "tenant_portal_audit", scope: "user", ar: "سجل روابط المستأجرين" },
  { table: "owner_links", scope: "user", ar: "روابط الملاك" },
  { table: "tenant_portal_links", scope: "user", ar: "روابط المستأجرين" },
  { table: "office_messages", scope: "user", ar: "الرسائل الداخلية" },
  { table: "compliance_items", scope: "user", ar: "التزامات المكتب" },
  { table: "listings", scope: "user", ar: "المعروضات" },
  { table: "listing_shows", scope: "user", ar: "عرض على" },
  { table: "listing_links", scope: "user", ar: "روابط المعروضات" },
  { table: "seeker_requests", scope: "user", ar: "طلبات الباحثين" },
  { table: "associations", scope: "user", ar: "الجمعيات" },
  { table: "owners", scope: "association", ar: "ملاك الجمعيات" },
  { table: "association_notes", scope: "association", ar: "سجل الجمعيات" },
  { table: "association_expenses", scope: "user", ar: "مصروفات الجمعيات" },
  { table: "association_budgets", scope: "user", ar: "ميزانيات الجمعيات" },
  { table: "hoa_documents", scope: "user", ar: "مستندات الجمعيات" },
  { table: "hoa_signatures", scope: "user", ar: "توقيعات الملاك" },
  { table: "hoa_requests", scope: "user", ar: "طلبات الملاك" },
  { table: "hoa_request_log", scope: "user", ar: "سجل طلبات الملاك" },
  { table: "hoa_payment_claims", scope: "user", ar: "بلاغات حوالات الملاك" },
  { table: "hoa_audit", scope: "user", ar: "تدقيق الجمعيات" },
  { table: "hoa_member_links", scope: "user", ar: "روابط ملاك الجمعيات" },
  { table: "subscription_payments", scope: "user", ar: "فواتير اشتراك وثيق" },
  { table: "team_members", scope: "owner", ar: "الفريق" },
  { table: "audit_log", scope: "user", ar: "سجل كل تغيير" },
];

export const SECRET_KEYS = ["token", "token_hash", "ip"];
export const stripSecrets = (r: Record<string, any>) => {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(r || {})) if (!SECRET_KEYS.includes(k)) o[k] = v;
  return o;
};

const missingTable = (e: any) => e?.code === "42P01" || e?.code === "PGRST205" || /does not exist|Could not find the table/i.test(String(e?.message || ""));

/** كل صفوف جدول بشرط — صفحات 1000 بترتيب ثابت (id، أو بلا ترتيب لجداول المفتاح المركّب) */
async function pageAll(db: SupabaseClient, table: string, apply: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  let ordered = true;
  for (let from = 0; ; from += 1000) {
    let q = apply(db.from(table).select("*"));
    if (ordered) q = q.order("id", { ascending: true });
    const { data, error } = await q.range(from, from + 999);
    if (error) {
      if (from === 0 && ordered && /column .*id.* does not exist|42703/i.test(`${error.code} ${error.message}`)) { ordered = false; from -= 1000; continue; }
      throw error;
    }
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    if (out.length >= 300000) throw new Error(`${table}: أكثر من 300,000 صف`);
  }
  return out;
}

export type OfficeCopy = { tables: Record<string, any[]>; counts: Record<string, number>; failed: string[] };

/** يجمع كل بيانات مكتب واحد بمفتاح الخادم — التصفية بالمكتب في كل استعلام */
export async function collectOffice(db: SupabaseClient, office: string): Promise<OfficeCopy> {
  const tables: Record<string, any[]> = {}, counts: Record<string, number> = {}, failed: string[] = [];
  let propIds: string[] = [], assocIds: string[] = [], tplIds: string[] = [];
  for (const spec of OFFICE_TABLES) {
    try {
      let rows: any[] = [];
      const inChunks = async (col: string, vals: string[]) => {
        const acc: any[] = [];
        for (let i = 0; i < vals.length; i += 150) acc.push(...await pageAll(db, spec.table, (q) => q.in(col, vals.slice(i, i + 150))));
        return acc;
      };
      if (spec.scope === "user") rows = await pageAll(db, spec.table, (q) => q.eq("user_id", office));
      else if (spec.scope === "owner") rows = await pageAll(db, spec.table, (q) => q.eq("owner_id", office));
      else if (spec.scope === "property") rows = propIds.length ? await inChunks("property_id", propIds) : [];
      else if (spec.scope === "association") rows = assocIds.length ? await inChunks("association_id", assocIds) : [];
      else if (spec.scope === "template") rows = tplIds.length ? await inChunks("template_id", tplIds) : [];
      rows = rows.map(stripSecrets);
      tables[spec.table] = rows; counts[spec.table] = rows.length;
      if (spec.table === "properties") propIds = rows.map((r) => r.id);
      if (spec.table === "associations") assocIds = rows.map((r) => r.id);
      if (spec.table === "expense_templates") tplIds = rows.map((r) => r.id);
    } catch (e: any) {
      if (missingTable(e)) { tables[spec.table] = []; counts[spec.table] = 0; continue; }
      failed.push(`${spec.table}: ${String(e?.message || e).slice(0, 160)}`);
    }
  }
  return { tables, counts, failed };
}

/** قيمة خلية Excel: الكائنات JSON، والنص يُقصّ عند حد الخلية (32,767) مع إشارة — الكامل في JSON */
export function cellValue(v: any): any {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") v = JSON.stringify(v);
  if (typeof v === "string" && v.length > 32000) return v.slice(0, 32000) + " …[مقطوع — الكامل في ملف JSON]";
  return v;
}

/** شهر التقرير بصيغة 2026-11 (بتوقيت الرياض) */
export const riyadhMonth = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);

/** هل حان دور هذا المكتب؟ لم يستلم نسخة هذا الشهر بعد */
export function copyDue(lastAt: string | null | undefined, now = new Date()): boolean {
  if (!lastAt) return true;
  const t = new Date(lastAt);
  if (isNaN(t.getTime())) return true;
  return riyadhMonth(t) !== riyadhMonth(now);
}

export function readmeText(org: string, month: string, counts: Record<string, number>, failed: string[]): string {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const lines = [
    `نسخة ${org || "مكتبك"} الشهرية من وثيق — ${month}`,
    "",
    "في هذا الملف كل ما أُدخل في حسابك، من كل الموظفين، حتى تاريخ النسخة:",
    "• watheq-copy.xlsx — ورقة لكل جدول بكل الأعمدة. يُفتح في Excel أو Google Sheets.",
    "• watheq-copy.json — النسخة نفسها كاملة حرفًا بحرف، تُستعمل للاسترجاع.",
    "",
    `المجموع: ${total.toLocaleString("en-US")} سطر في ${Object.values(counts).filter((n) => n > 0).length} جدول.`,
    ...OFFICE_TABLES.filter((s) => counts[s.table]).map((s) => `  - ${s.ar}: ${counts[s.table].toLocaleString("en-US")}`),
    "",
    "صور الصيانة تُنزَّل من الإعدادات ← تصدير بياناتي ← «صور الصيانة (ZIP)».",
    "لو احتجت استرجاع بياناتك من هذه النسخة أرسلها لنا على واتساب 0550165210.",
    "احفظ الملف في مكان آمن — فيه بيانات مستأجريك.",
  ];
  if (failed.length) lines.push("", "⚠ تعذّر جمع هذه الجداول هذه المرة (نعيد المحاولة غدًا):", ...failed.map((f) => "  - " + f));
  return lines.join("\n");
}
