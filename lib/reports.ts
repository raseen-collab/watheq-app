/** ============================================================
 *  وثيق — طبقة بيانات البوت (تقارير + أفعال)
 *  تُستخدم من: (١) أوامر البوت التفاعلية  (٢) الملخّص اليومي (الكرون)
 *  كل شيء يلمس قاعدة البيانات هنا، فأسماء الجداول/الأعمدة في مكان واحد.
 *  ============================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";

// ========================================================================
// ⚠️  نقاط الربط بالمخطط — إن اختلفت أسماء الجداول/الأعمدة عندك، عدّلها هنا فقط.
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
  contract_phone: "tenant_phone", // جوال المستأجر (للتذكير عبر واتساب)
  contract_status: "status",   // 'active' وما شابه
  payment_contract: "contract_id",
  payment_due: "due_date",     // تاريخ الاستحقاق (YYYY-MM-DD)
  payment_amount: "amount",
  payment_paid: "paid",        // عمود boolean يكون false للدفعة غير المسدّدة
};

// لو كان تتبّع السداد بعمود تاريخ (paid_at) بدل boolean:
//   - في unpaidPayments: بدّل .eq(paid,false)      بـ  .is("paid_at", null)
//   - في markPaid:       بدّل { [paid]: true }      بـ  { paid_at: new Date().toISOString() }

type DB = SupabaseClient<any, any, any>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayISO = () => iso(new Date());
const addDaysISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const monthStartISO = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
export const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** يجلب وحدات المالك + خريطة الاسم لكل وحدة */
async function ownerUnits(db: DB, profileId: string) {
  const { data, error } = await db.from(TABLE.units).select("*").eq(COL.unit_owner, profileId);
  if (error) throw new Error("units: " + error.message);
  const rows = data || [];
  const label: Record<string, string> = {};
  rows.forEach((u: any) => (label[u.id] = u[COL.unit_label] || "وحدة"));
  return { ids: rows.map((u: any) => u.id), label, count: rows.length };
}

/** يجلب عقود هذه الوحدات + خريطة (عقد → بياناته) */
async function ownerContracts(db: DB, unitIds: string[]) {
  if (!unitIds.length) return { ids: [] as string[], byId: {} as Record<string, any> };
  const { data, error } = await db.from(TABLE.contracts).select("*").in(COL.contract_unit, unitIds);
  if (error) throw new Error("contracts: " + error.message);
  const rows = data || [];
  const byId: Record<string, any> = {};
  rows.forEach((c: any) => (byId[c.id] = c));
  return { ids: rows.map((c: any) => c.id), byId };
}

/** الدفعات غير المسدّدة ضمن نطاق تواريخ */
async function unpaidPayments(db: DB, contractIds: string[], fromISO: string, toISO: string) {
  if (!contractIds.length) return [] as any[];
  const { data, error } = await db
    .from(TABLE.payments).select("*")
    .in(COL.payment_contract, contractIds)
    .eq(COL.payment_paid, false)          // ⇄ paid_at: .is("paid_at", null)
    .gte(COL.payment_due, fromISO)
    .lte(COL.payment_due, toISO)
    .order(COL.payment_due, { ascending: true });
  if (error) throw new Error("payments: " + error.message);
  return data || [];
}

function payLine(p: any, contracts: Record<string, any>, unitLabel: Record<string, string>) {
  const c = contracts[p[COL.payment_contract]] || {};
  const unit = unitLabel[c[COL.contract_unit]] || "—";
  const tenant = c[COL.contract_tenant] || "—";
  return `• <b>${esc(unit)}</b> — ${esc(tenant)} — <b>${sar(p[COL.payment_amount])}</b> ﷼ — ${esc(p[COL.payment_due])}`;
}

// ======================= التقارير (قراءة) =======================

export async function todayReport(db: DB, profile: any): Promise<string> {
  try {
    const daysBefore = Number(profile.notify_days_before) || 5;
    const { ids: unitIds, label } = await ownerUnits(db, profile.id);
    const { ids: contractIds, byId } = await ownerContracts(db, unitIds);
    const rows = await unpaidPayments(db, contractIds, todayISO(), addDaysISO(daysBefore));
    if (!rows.length) return `📅 <b>استحقاقات اليوم والقريبة</b>\n\nلا توجد استحقاقات خلال ${daysBefore} أيام القادمة ✅`;
    const total = rows.reduce((s: number, p: any) => s + (Number(p[COL.payment_amount]) || 0), 0);
    const lines = rows.map((p) => payLine(p, byId, label)).join("\n");
    return `📅 <b>استحقاقات اليوم والقريبة</b> (خلال ${daysBefore} أيام)\n\n${lines}\n\n— الإجمالي: <b>${sar(total)}</b> ﷼ · ${rows.length} دفعة`;
  } catch (e: any) { return `تعذّر جلب استحقاقات اليوم.\n<code>${esc(e.message)}</code>`; }
}

export async function lateReport(db: DB, profile: any): Promise<string> {
  try {
    const { ids: unitIds, label } = await ownerUnits(db, profile.id);
    const { ids: contractIds, byId } = await ownerContracts(db, unitIds);
    const rows = await unpaidPayments(db, contractIds, "2000-01-01", addDaysISO(-1));
    if (!rows.length) return `⚠️ <b>المتأخرات</b>\n\nلا توجد متأخرات — ممتاز 👏`;
    const total = rows.reduce((s: number, p: any) => s + (Number(p[COL.payment_amount]) || 0), 0);
    const lines = rows.map((p) => payLine(p, byId, label)).join("\n");
    return `⚠️ <b>المتأخرات</b>\n\n${lines}\n\n— إجمالي المتأخر: <b>${sar(total)}</b> ﷼ · ${rows.length} دفعة`;
  } catch (e: any) { return `تعذّر جلب المتأخرات.\n<code>${esc(e.message)}</code>`; }
}

export async function summaryReport(db: DB, profile: any): Promise<string> {
  try {
    const { ids: unitIds, count: unitCount } = await ownerUnits(db, profile.id);
    const { ids: contractIds, byId } = await ownerContracts(db, unitIds);
    const activeContracts = Object.values(byId).filter((c: any) => (c[COL.contract_status] || "active") === "active").length;
    const overdue = await unpaidPayments(db, contractIds, "2000-01-01", addDaysISO(-1));
    const dueThisMonth = await unpaidPayments(db, contractIds, monthStartISO(), addDaysISO(31));
    const overdueTotal = overdue.reduce((s: number, p: any) => s + (Number(p[COL.payment_amount]) || 0), 0);
    const dueTotal = dueThisMonth.reduce((s: number, p: any) => s + (Number(p[COL.payment_amount]) || 0), 0);
    return [
      `📊 <b>ملخّص وثيق</b>`, ``,
      `• الوحدات: <b>${unitCount}</b>`,
      `• العقود السارية: <b>${activeContracts}</b>`,
      `• مستحق هذا الشهر (غير مسدّد): <b>${sar(dueTotal)}</b> ﷼`,
      `• إجمالي المتأخرات: <b>${sar(overdueTotal)}</b> ﷼ (${overdue.length} دفعة)`,
    ].join("\n");
  } catch (e: any) { return `تعذّر بناء الملخّص.\n<code>${esc(e.message)}</code>`; }
}

export async function buildReport(db: DB, profile: any, which: string): Promise<string> {
  if (which === "late") return lateReport(db, profile);
  if (which === "summary") return summaryReport(db, profile);
  return todayReport(db, profile);
}

// ======================= بيانات مُنظّمة للأزرار =======================

export type UnpaidRow = {
  id: string; amount: number; due: string;
  unit: string; tenant: string; phone: string; contractId: string;
};

/** يرجّع الدفعات غير المسدّدة كصفوف منظّمة (لبناء أزرار الاختيار) */
export async function getUnpaid(db: DB, profile: any, scope: string): Promise<UnpaidRow[]> {
  const { ids: unitIds, label } = await ownerUnits(db, profile.id);
  const { byId } = await ownerContracts(db, unitIds);
  const contractIds = Object.keys(byId);
  const rows = scope === "late"
    ? await unpaidPayments(db, contractIds, "2000-01-01", addDaysISO(-1))
    : await unpaidPayments(db, contractIds, todayISO(), addDaysISO(Number(profile.notify_days_before) || 5));
  return rows.map((p: any) => {
    const c = byId[p[COL.payment_contract]] || {};
    return {
      id: p.id,
      amount: Number(p[COL.payment_amount]) || 0,
      due: p[COL.payment_due],
      unit: label[c[COL.contract_unit]] || "وحدة",
      tenant: c[COL.contract_tenant] || "—",
      phone: c[COL.contract_phone] || "",
      contractId: p[COL.payment_contract],
    };
  });
}

/** مجموعة معرّفات العقود المملوكة (للتحقق من الصلاحية قبل أي تعديل) */
async function ownedContractIds(db: DB, profile: any): Promise<Set<string>> {
  const { ids: unitIds } = await ownerUnits(db, profile.id);
  const { ids } = await ownerContracts(db, unitIds);
  return new Set(ids);
}

/** معلومات عقد واحد (للتذكير) */
async function contractInfo(db: DB, profile: any, contractId: string) {
  const { ids: unitIds, label } = await ownerUnits(db, profile.id);
  const { byId } = await ownerContracts(db, unitIds);
  const c = byId[contractId];
  if (!c) return null;
  return {
    unit: label[c[COL.contract_unit]] || "وحدة",
    tenant: c[COL.contract_tenant] || "—",
    phone: c[COL.contract_phone] || "",
  };
}

// ======================= الأفعال (كتابة) =======================

/** تسجيل دفعة كمدفوعة — مع تحقّق من ملكية المالك للدفعة */
export async function markPaid(db: DB, profile: any, paymentId: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const { data: pay } = await db.from(TABLE.payments).select("*").eq("id", paymentId).maybeSingle();
    if (!pay) return { ok: false, msg: "الدفعة غير موجودة." };
    const owned = await ownedContractIds(db, profile);
    if (!owned.has(pay[COL.payment_contract])) return { ok: false, msg: "غير مصرّح لك بهذه الدفعة." };
    if (pay[COL.payment_paid] === true) return { ok: true, msg: "الدفعة مسدّدة أصلًا." };
    const { error } = await db.from(TABLE.payments)
      .update({ [COL.payment_paid]: true })   // ⇄ paid_at: { paid_at: new Date().toISOString() }
      .eq("id", paymentId);
    if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
    return { ok: true, msg: "سُجّلت الدفعة كمدفوعة." };
  } catch (e: any) { return { ok: false, msg: e.message }; }
}

/** تطبيع رقم سعودي إلى صيغة دولية بدون + (للـ wa.me) */
function normalizeSaudi(raw: string): string {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (d.startsWith("966")) return d;
  if (d.startsWith("0")) return "966" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) return "966" + d;
  return d;
}

/** يبني رابط واتساب جاهز برسالة تذكير للمستأجر */
export async function buildReminder(db: DB, profile: any, contractId: string): Promise<{ ok: boolean; text: string; url?: string }> {
  try {
    const info = await contractInfo(db, profile, contractId);
    if (!info) return { ok: false, text: "العقد غير موجود أو غير مصرّح." };
    if (!info.phone) return { ok: false, text: `لا يوجد رقم جوال مسجّل للمستأجر (${esc(info.tenant)}).` };
    const digits = normalizeSaudi(info.phone);
    const msg = `السلام عليكم ${info.tenant}،\nتذكير ودّي بسداد إيجار «${info.unit}». شاكرين لكم تعاونكم.`;
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    return { ok: true, text: `جاهز لتذكير <b>${esc(info.tenant)}</b> — ${esc(info.unit)} عبر واتساب:`, url };
  } catch (e: any) { return { ok: false, text: "تعذّر تجهيز التذكير: " + e.message }; }
}
