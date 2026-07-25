/** ============================================================
 *  وثيق — بُناة التقارير المشتركة
 *  تُستخدم من: (١) أوامر البوت التفاعلية  (٢) الملخّص اليومي (الكرون)
 *  كل تقرير يرجّع نصًّا جاهزًا للإرسال في تليجرام (HTML).
 *  ============================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";

// ========================================================================
// ⚠️  نقاط الربط بالمخطط — إن اختلفت أسماء الجداول/الأعمدة عندك، عدّلها هنا فقط.
//     (هذه أفضل تخمين من بنية وثيق؛ طابقها مع مخطّطك الحقيقي أو أرسله لي لأضبطه.)
// ========================================================================
const TABLE = {
  units: "units",
  contracts: "contracts",
  payments: "payments",
};
const COL = {
  unit_owner: "owner_id",      // عمود صاحب الوحدة في جدول units (قد يكون profile_id)
  unit_label: "name",          // اسم/رقم الوحدة للعرض
  contract_unit: "unit_id",
  contract_tenant: "tenant_name",
  contract_status: "status",   // 'active' وما شابه
  payment_contract: "contract_id",
  payment_due: "due_date",     // تاريخ الاستحقاق (YYYY-MM-DD)
  payment_amount: "amount",
  payment_paid: "paid",        // عمود boolean يكون false للدفعة غير المسدّدة
};

// لو كان تتبّع السداد عندك بعمود تاريخ (paid_at) بدل boolean، غيّر السطر المعلّم
// بـ (⇄ paid_at) في دالة unpaidPayments أدناه إلى: .is("paid_at", null)

type DB = SupabaseClient<any, any, any>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayISO = () => iso(new Date());
const addDaysISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const monthStartISO = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};
const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** يجلب معرّفات وحدات المالك + خريطة الاسم لكل وحدة */
async function ownerUnits(db: DB, profileId: string) {
  const { data, error } = await db
    .from(TABLE.units)
    .select("*")
    .eq(COL.unit_owner, profileId);
  if (error) throw new Error("units: " + error.message);
  const rows = data || [];
  const ids = rows.map((u: any) => u.id);
  const label: Record<string, string> = {};
  rows.forEach((u: any) => (label[u.id] = u[COL.unit_label] || "وحدة"));
  return { ids, label, count: rows.length };
}

/** يجلب عقود هذه الوحدات + خريطة (عقد → وحدة/مستأجر) */
async function ownerContracts(db: DB, unitIds: string[]) {
  if (!unitIds.length) return { ids: [] as string[], byId: {} as Record<string, any> };
  const { data, error } = await db
    .from(TABLE.contracts)
    .select("*")
    .in(COL.contract_unit, unitIds);
  if (error) throw new Error("contracts: " + error.message);
  const rows = data || [];
  const byId: Record<string, any> = {};
  rows.forEach((c: any) => (byId[c.id] = c));
  return { ids: rows.map((c: any) => c.id), byId };
}

/** يجلب الدفعات غير المسدّدة ضمن نطاق تواريخ */
async function unpaidPayments(db: DB, contractIds: string[], fromISO: string, toISO: string) {
  if (!contractIds.length) return [] as any[];
  const { data, error } = await db
    .from(TABLE.payments)
    .select("*")
    .in(COL.payment_contract, contractIds)
    .eq(COL.payment_paid, false) // غير مسدّد   (⇄ paid_at: بدّلها بـ .is("paid_at", null))
    .gte(COL.payment_due, fromISO)
    .lte(COL.payment_due, toISO)
    .order(COL.payment_due, { ascending: true });
  if (error) throw new Error("payments: " + error.message);
  return data || [];
}

/** سطر عرض لدفعة واحدة */
function payLine(p: any, contracts: Record<string, any>, unitLabel: Record<string, string>) {
  const c = contracts[p[COL.payment_contract]] || {};
  const unit = unitLabel[c[COL.contract_unit]] || "—";
  const tenant = c[COL.contract_tenant] || "—";
  return `• <b>${esc(unit)}</b> — ${esc(tenant)} — <b>${sar(p[COL.payment_amount])}</b> ﷼ — ${esc(
    p[COL.payment_due]
  )}`;
}

/** =========== تقرير: اليوم والقريب =========== */
export async function todayReport(db: DB, profile: any): Promise<string> {
  try {
    const daysBefore = Number(profile.notify_days_before) || 5;
    const { ids: unitIds, label } = await ownerUnits(db, profile.id);
    const { ids: contractIds, byId } = await ownerContracts(db, unitIds);
    const rows = await unpaidPayments(db, contractIds, todayISO(), addDaysISO(daysBefore));

    if (!rows.length)
      return `📅 <b>استحقاقات اليوم والقريبة</b>\n\nلا توجد استحقاقات خلال ${daysBefore} أيام القادمة ✅`;

    const total = rows.reduce((s: number, p: any) => s + (Number(p[COL.payment_amount]) || 0), 0);
    const lines = rows.map((p) => payLine(p, byId, label)).join("\n");
    return `📅 <b>استحقاقات اليوم والقريبة</b> (خلال ${daysBefore} أيام)\n\n${lines}\n\n— الإجمالي: <b>${sar(
      total
    )}</b> ﷼ · ${rows.length} دفعة`;
  } catch (e: any) {
    return `تعذّر جلب استحقاقات اليوم.\n<code>${esc(e.message)}</code>`;
  }
}

/** =========== تقرير: المتأخرات =========== */
export async function lateReport(db: DB, profile: any): Promise<string> {
  try {
    const { ids: unitIds, label } = await ownerUnits(db, profile.id);
    const { ids: contractIds, byId } = await ownerContracts(db, unitIds);
    // كل ما استحق قبل اليوم ولم يُسدّد
    const rows = await unpaidPayments(db, contractIds, "2000-01-01", addDaysISO(-1));

    if (!rows.length) return `⚠️ <b>المتأخرات</b>\n\nلا توجد متأخرات — ممتاز 👏`;

    const total = rows.reduce((s: number, p: any) => s + (Number(p[COL.payment_amount]) || 0), 0);
    const lines = rows.map((p) => payLine(p, byId, label)).join("\n");
    return `⚠️ <b>المتأخرات</b>\n\n${lines}\n\n— إجمالي المتأخر: <b>${sar(total)}</b> ﷼ · ${rows.length} دفعة`;
  } catch (e: any) {
    return `تعذّر جلب المتأخرات.\n<code>${esc(e.message)}</code>`;
  }
}

/** =========== تقرير: ملخّص شامل =========== */
export async function summaryReport(db: DB, profile: any): Promise<string> {
  try {
    const { ids: unitIds, count: unitCount, label } = await ownerUnits(db, profile.id);
    const { ids: contractIds, byId } = await ownerContracts(db, unitIds);

    const activeContracts = Object.values(byId).filter(
      (c: any) => (c[COL.contract_status] || "active") === "active"
    ).length;

    const overdue = await unpaidPayments(db, contractIds, "2000-01-01", addDaysISO(-1));
    const dueThisMonth = await unpaidPayments(db, contractIds, monthStartISO(), addDaysISO(31));

    const overdueTotal = overdue.reduce((s: number, p: any) => s + (Number(p[COL.payment_amount]) || 0), 0);
    const dueTotal = dueThisMonth.reduce((s: number, p: any) => s + (Number(p[COL.payment_amount]) || 0), 0);

    return [
      `📊 <b>ملخّص وثيق</b>`,
      ``,
      `• الوحدات: <b>${unitCount}</b>`,
      `• العقود السارية: <b>${activeContracts}</b>`,
      `• مستحق هذا الشهر (غير مسدّد): <b>${sar(dueTotal)}</b> ﷼`,
      `• إجمالي المتأخرات: <b>${sar(overdueTotal)}</b> ﷼ (${overdue.length} دفعة)`,
    ].join("\n");
  } catch (e: any) {
    return `تعذّر بناء الملخّص.\n<code>${esc(e.message)}</code>`;
  }
}

/** موجّه واحد يستدعيه البوت */
export async function buildReport(db: DB, profile: any, which: string): Promise<string> {
  if (which === "late") return lateReport(db, profile);
  if (which === "summary") return summaryReport(db, profile);
  return todayReport(db, profile);
}
