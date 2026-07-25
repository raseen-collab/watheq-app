/** ============================================================
 *  وثيق — طبقة بيانات البوت (تقارير + أفعال)  —  مبنية على المخطّط الفعلي
 *  تدعم المسارين:  العقارات (properties/tenants/invoices)  و  الجمعيات (associations/owners)
 *  وتكتشف نوع الحساب تلقائيًا لكل مستخدم.
 *  ============================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyContract, STATE_ORDER, stateMeta, stateLabel } from "./contract-state";

type DB = SupabaseClient<any, any, any>;
type Track = "properties" | "associations";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayISO = () => iso(new Date());
const addDaysISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const monthStartISO = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const monthEndISO = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
export const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** حالات الفاتورة الرسمية (يفرضها CHECK في قاعدة البيانات): issued | paid | void
 *  غير المسدّد = issued فقط (paid مدفوعة، void ملغاة). */
function invoiceUnpaid(status: any): boolean {
  const s = String(status ?? "issued").trim().toLowerCase();
  return s === "issued";
}

/** تطبيع رقم سعودي إلى صيغة دولية بدون + (للـ wa.me) */
function normalizeSaudi(raw: string): string {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (d.startsWith("966")) return d;
  if (d.startsWith("0")) return "966" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) return "966" + d;
  return d;
}

// ======================= اكتشاف نوع الحساب =======================

async function detectTrack(db: DB, profile: any): Promise<Track> {
  const hint = String(profile.account_type || profile.last_dashboard || profile.role || "").toLowerCase();
  if (/(assoc|hoa|جمع|owner|ملاك|ملّاك)/.test(hint)) return "associations";
  if (/(prop|real|عقار|ايجار|إيجار|مؤجر|مؤجّر)/.test(hint)) return "properties";
  // استدلال بالبيانات
  const { count: assocN } = await db.from("associations").select("*", { count: "exact", head: true }).eq("user_id", profile.id);
  if (assocN && assocN > 0) {
    const { count: propN } = await db.from("properties").select("*", { count: "exact", head: true }).eq("user_id", profile.id);
    if (!propN) return "associations";
  }
  return "properties";
}

// ======================= مسار العقارات =======================

async function propContext(db: DB, profile: any) {
  const { data: props } = await db.from("properties").select("*").eq("user_id", profile.id);
  const propName: Record<string, string> = {};
  (props || []).forEach((p: any) => (propName[p.id] = p.name || "عقار"));
  const propIds = (props || []).map((p: any) => p.id);

  let tenants: any[] = [];
  if (propIds.length) {
    const { data } = await db.from("tenants").select("*").in("property_id", propIds);
    tenants = data || [];
  }
  const tenantById: Record<string, any> = {};
  tenants.forEach((t: any) => (tenantById[t.id] = t));

  const { data: invoices } = await db.from("invoices").select("*").eq("user_id", profile.id);
  return { props: props || [], propName, tenants, tenantById, invoices: invoices || [] };
}

function invWho(inv: any, tenantById: Record<string, any>, propName: Record<string, string>) {
  const t = tenantById[inv.tenant_id];
  const unit = t?.unit ? `وحدة ${t.unit}` : "";
  const place = propName[inv.property_id] || "";
  const label = [place, unit].filter(Boolean).join(" · ") || "فاتورة";
  return { label, tenant: t?.name || "—", phone: t?.phone || "", tenantId: inv.tenant_id || "" };
}

/** الفواتير غير المسدّدة (اختياريًا ضمن نطاق تواريخ) */
function unpaidInvoices(invoices: any[], fromISO?: string, toISO?: string) {
  return invoices
    .filter((inv) => invoiceUnpaid(inv.status))
    .filter((inv) => {
      if (!fromISO && !toISO) return true;
      const d = String(inv.due_date || "");
      if (!d) return false;
      if (fromISO && d < fromISO) return false;
      if (toISO && d > toISO) return false;
      return true;
    })
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}

// ======================= مسار الجمعيات =======================

async function assocContext(db: DB, profile: any) {
  const { data: assocs } = await db.from("associations").select("*").eq("user_id", profile.id);
  const assocById: Record<string, any> = {};
  (assocs || []).forEach((a: any) => (assocById[a.id] = a));
  const assocIds = (assocs || []).map((a: any) => a.id);

  let owners: any[] = [];
  if (assocIds.length) {
    const { data } = await db.from("owners").select("*").in("association_id", assocIds);
    owners = data || [];
  }
  return { assocs: assocs || [], assocById, owners };
}

const ownerOwed = (o: any, assocById: Record<string, any>) =>
  (Number(o.months_late) || 0) * (Number(assocById[o.association_id]?.fee) || 0);

// ======================= التقارير (نص) =======================

export async function todayReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);
    const days = Number(profile.notify_days_before) || 5;

    if (track === "properties") {
      const { invoices, tenantById, propName } = await propContext(db, profile);
      const rows = unpaidInvoices(invoices, todayISO(), addDaysISO(days));
      if (!rows.length) return `📅 <b>استحقاقات اليوم والقريبة</b>\n\nلا توجد فواتير مستحقة خلال ${days} أيام القادمة ✅`;
      const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const lines = rows.map((r) => {
        const w = invWho(r, tenantById, propName);
        return `• <b>${esc(w.label)}</b> — ${esc(w.tenant)} — <b>${sar(r.amount)}</b> ﷼ — ${esc(r.due_date)}`;
      }).join("\n");
      return `📅 <b>استحقاقات اليوم والقريبة</b> (خلال ${days} أيام)\n\n${lines}\n\n— الإجمالي: <b>${sar(total)}</b> ﷼ · ${rows.length} فاتورة`;
    }

    // جمعيات: تنبيه شهادات قاربت على الانتهاء + عدد المتأخرين
    const { assocs, owners } = await assocContext(db, profile);
    const soon = assocs.filter((a: any) => a.cert_expiry && a.cert_expiry >= todayISO() && a.cert_expiry <= addDaysISO(60));
    const lateCount = owners.filter((o: any) => (Number(o.months_late) || 0) > 0).length;
    const certLines = soon.length
      ? soon.map((a: any) => `• <b>${esc(a.name)}</b> — شهادة تنتهي ${esc(a.cert_expiry)}`).join("\n")
      : "لا توجد شهادات قاربت على الانتهاء ✅";
    return `📅 <b>تنبيهات قريبة</b>\n\n🪪 الشهادات:\n${certLines}\n\n⚠️ ملّاك متأخرون: <b>${lateCount}</b>`;
  } catch (e: any) { return `تعذّر جلب استحقاقات اليوم.\n<code>${esc(e.message)}</code>`; }
}

export async function lateReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);

    if (track === "properties") {
      const { invoices, tenantById, propName } = await propContext(db, profile);
      const rows = unpaidInvoices(invoices, undefined, addDaysISO(-1));
      if (!rows.length) return `⚠️ <b>المتأخرات</b>\n\nلا توجد فواتير متأخرة — ممتاز 👏`;
      const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const lines = rows.map((r) => {
        const w = invWho(r, tenantById, propName);
        return `• <b>${esc(w.label)}</b> — ${esc(w.tenant)} — <b>${sar(r.amount)}</b> ﷼ — ${esc(r.due_date)}`;
      }).join("\n");
      return `⚠️ <b>المتأخرات</b>\n\n${lines}\n\n— إجمالي المتأخر: <b>${sar(total)}</b> ﷼ · ${rows.length} فاتورة`;
    }

    const { assocById, owners } = await assocContext(db, profile);
    const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0)
      .sort((a: any, b: any) => (Number(b.months_late) || 0) - (Number(a.months_late) || 0));
    if (!late.length) return `⚠️ <b>المتأخرات</b>\n\nلا يوجد ملّاك متأخرون — ممتاز 👏`;
    const total = late.reduce((s: number, o: any) => s + ownerOwed(o, assocById), 0);
    const lines = late.map((o: any) =>
      `• <b>${esc(o.name)}</b>${o.unit ? " — وحدة " + esc(o.unit) : ""} — متأخر <b>${o.months_late}</b> شهر — <b>${sar(ownerOwed(o, assocById))}</b> ﷼`
    ).join("\n");
    return `⚠️ <b>المتأخرات</b>\n\n${lines}\n\n— إجمالي المتأخر: <b>${sar(total)}</b> ﷼ · ${late.length} مالك`;
  } catch (e: any) { return `تعذّر جلب المتأخرات.\n<code>${esc(e.message)}</code>`; }
}

export async function summaryReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);

    if (track === "properties") {
      const { props, tenants, invoices } = await propContext(db, profile);
      const overdue = unpaidInvoices(invoices, undefined, addDaysISO(-1));
      const dueMonth = unpaidInvoices(invoices, monthStartISO(), monthEndISO());
      const collected = props.reduce((s: number, p: any) => s + (Number(p.collected) || 0), 0);
      const overdueTotal = overdue.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const dueTotal = dueMonth.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return [
        `📊 <b>ملخّص وثيق — العقارات</b>`, ``,
        `• العقارات: <b>${props.length}</b>`,
        `• المستأجرون: <b>${tenants.length}</b>`,
        `• محصّل: <b>${sar(collected)}</b> ﷼`,
        `• مستحق هذا الشهر (غير مسدّد): <b>${sar(dueTotal)}</b> ﷼`,
        `• إجمالي المتأخرات: <b>${sar(overdueTotal)}</b> ﷼ (${overdue.length} فاتورة)`,
      ].join("\n");
    }

    const { assocs, assocById, owners } = await assocContext(db, profile);
    const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0);
    const lateTotal = late.reduce((s: number, o: any) => s + ownerOwed(o, assocById), 0);
    const fund = assocs.reduce((s: number, a: any) => s + (Number(a.fund_balance) || 0), 0);
    return [
      `📊 <b>ملخّص وثيق — الجمعيات</b>`, ``,
      `• الجمعيات: <b>${assocs.length}</b>`,
      `• الملّاك: <b>${owners.length}</b>`,
      `• رصيد الصناديق: <b>${sar(fund)}</b> ﷼`,
      `• متأخرون: <b>${late.length}</b> مالك`,
      `• إجمالي المتأخر: <b>${sar(lateTotal)}</b> ﷼`,
    ].join("\n");
  } catch (e: any) { return `تعذّر بناء الملخّص.\n<code>${esc(e.message)}</code>`; }
}

export async function buildReport(db: DB, profile: any, which: string): Promise<string> {
  if (which === "late") return lateReport(db, profile);
  if (which === "summary") return summaryReport(db, profile);
  return todayReport(db, profile);
}

// ======================= بيانات منظّمة للأزرار =======================

export type UnpaidRow = {
  id: string;          // العنصر القابل للتسجيل (فاتورة أو مالك)
  amount: number;
  due: string;
  unit: string;
  tenant: string;
  phone: string;
  contractId: string;  // للتذكير/التجميع (مستأجر أو مالك)
};

export async function getUnpaid(db: DB, profile: any, scope: string): Promise<UnpaidRow[]> {
  const track = await detectTrack(db, profile);

  if (track === "properties") {
    const { invoices, tenantById, propName } = await propContext(db, profile);
    const rows = scope === "late"
      ? unpaidInvoices(invoices, undefined, addDaysISO(-1))
      : unpaidInvoices(invoices, todayISO(), addDaysISO(Number(profile.notify_days_before) || 5));
    return rows.map((r) => {
      const w = invWho(r, tenantById, propName);
      return { id: r.id, amount: Number(r.amount) || 0, due: r.due_date || "", unit: w.label, tenant: w.tenant, phone: w.phone, contractId: w.tenantId };
    });
  }

  const { assocById, owners } = await assocContext(db, profile);
  const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0);
  return late.map((o: any) => ({
    id: o.id, amount: ownerOwed(o, assocById), due: "", unit: o.unit ? `وحدة ${o.unit}` : (assocById[o.association_id]?.name || ""),
    tenant: o.name || "—", phone: o.phone || "", contractId: o.id,
  }));
}

// ======================= الأفعال (كتابة) =======================

/** تسجيل دفعة كمدفوعة — مع تحقّق من الملكية */
export async function markPaid(db: DB, profile: any, id: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const track = await detectTrack(db, profile);

    if (track === "properties") {
      const { data: inv } = await db.from("invoices").select("*").eq("id", id).maybeSingle();
      if (!inv) return { ok: false, msg: "الفاتورة غير موجودة." };
      if (String(inv.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح لك بهذه الفاتورة." };
      if (!invoiceUnpaid(inv.status)) return { ok: true, msg: "الفاتورة مسدّدة أصلًا." };
      const { error } = await db.from("invoices").update({ status: "paid" }).eq("id", id);
      if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
      return { ok: true, msg: "سُجّلت الفاتورة كمدفوعة." };
    }

    // جمعيات: تصفير تأخّر المالك
    const { data: owner } = await db.from("owners").select("*").eq("id", id).maybeSingle();
    if (!owner) return { ok: false, msg: "المالك غير موجود." };
    const { data: assoc } = await db.from("associations").select("id,user_id").eq("id", owner.association_id).maybeSingle();
    if (!assoc || String(assoc.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح." };
    const { error } = await db.from("owners").update({ months_late: 0, last_paid: todayISO() }).eq("id", id);
    if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
    return { ok: true, msg: "سُجّل سداد المالك." };
  } catch (e: any) { return { ok: false, msg: e.message }; }
}

/** يبني رابط واتساب جاهز برسالة تذكير */
export async function buildReminder(db: DB, profile: any, contractId: string): Promise<{ ok: boolean; text: string; url?: string }> {
  try {
    const track = await detectTrack(db, profile);
    let name = "", phone = "", unit = "";

    if (track === "properties") {
      const { data: t } = await db.from("tenants").select("*").eq("id", contractId).maybeSingle();
      if (!t) return { ok: false, text: "المستأجر غير موجود أو غير مصرّح." };
      // تحقّق الملكية عبر العقار
      const { data: prop } = await db.from("properties").select("id,user_id").eq("id", t.property_id).maybeSingle();
      if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
      name = t.name || "المستأجر"; phone = t.phone || ""; unit = t.unit ? `وحدة ${t.unit}` : "";
    } else {
      const { data: o } = await db.from("owners").select("*").eq("id", contractId).maybeSingle();
      if (!o) return { ok: false, text: "المالك غير موجود." };
      const { data: assoc } = await db.from("associations").select("id,user_id").eq("id", o.association_id).maybeSingle();
      if (!assoc || String(assoc.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
      name = o.name || "المالك"; phone = o.phone || ""; unit = o.unit ? `وحدة ${o.unit}` : "";
    }

    if (!phone) return { ok: false, text: `لا يوجد رقم جوال مسجّل لـ ${esc(name)}.` };
    const digits = normalizeSaudi(phone);
    const label = track === "properties" ? "إيجار" : "رسوم";
    const msg = `السلام عليكم ${name}،\nتذكير ودّي بسداد ${label}${unit ? " «" + unit + "»" : ""}. شاكرين لكم تعاونكم.`;
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    return { ok: true, text: `جاهز لتذكير <b>${esc(name)}</b>${unit ? " — " + esc(unit) : ""} عبر واتساب:`, url };
  } catch (e: any) { return { ok: false, text: "تعذّر تجهيز التذكير: " + e.message }; }
}

// ======================= آلة حالات العقد =======================

export type ContractCard = {
  tenantId: string;
  label: string;
  tenant: string;
  phone: string;
  state: ReturnType<typeof classifyContract>;
};

/** يصنّف كل عقود المالك (مسار العقارات) */
async function propContractCards(db: DB, profile: any): Promise<ContractCard[]> {
  const { propName, tenants, invoices } = await propContext(db, profile);
  const byTenant: Record<string, any[]> = {};
  invoices.forEach((inv: any) => {
    const k = inv.tenant_id; if (!k) return;
    (byTenant[k] = byTenant[k] || []).push(inv);
  });
  return tenants.map((t: any) => {
    const st = classifyContract(t, byTenant[t.id] || [], todayISO());
    const place = propName[t.property_id] || "";
    const unit = t.unit ? `وحدة ${t.unit}` : "";
    const label = [place, unit].filter(Boolean).join(" · ") || (t.name || "عقد");
    return { tenantId: t.id, label, tenant: t.name || "—", phone: t.phone || "", state: st };
  });
}

/** تقرير حالة العقود (نص) */
export async function statusReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);
    if (track !== "properties") {
      const { owners } = await assocContext(db, profile);
      const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0).length;
      return `📋 <b>حالة الحسابات</b>\n\n🟢 منتظم: <b>${owners.length - late}</b>\n🔴 متأخر: <b>${late}</b>`;
    }
    const cards = await propContractCards(db, profile);
    if (!cards.length) return "📋 <b>حالة العقود</b>\n\nلا توجد عقود مسجّلة بعد.";
    const counts: Record<string, number> = {};
    cards.forEach((c) => (counts[c.state.key] = (counts[c.state.key] || 0) + 1));
    const head = STATE_ORDER.filter((k) => counts[k])
      .map((k) => `${stateMeta(k).dot} ${stateMeta(k).label}: <b>${counts[k]}</b>`).join("  ·  ");
    const flagged = cards.filter((c) => c.state.key !== "active")
      .sort((a, b) => STATE_ORDER.indexOf(a.state.key) - STATE_ORDER.indexOf(b.state.key)).slice(0, 8);
    const lines = flagged.map((c) => {
      const s = c.state;
      const extra = s.key === "arrears" ? ` — ${sar(s.owed)} ﷼`
        : s.key === "expiring" && s.daysToEnd != null ? ` — ينتهي خلال ${s.daysToEnd} يوم`
        : (s.key === "due_soon" && s.nextDue) ? ` — ${s.nextDue}` : "";
      return `${s.dot} <b>${esc(c.label)}</b> — ${esc(c.tenant)}${extra}`;
    }).join("\n");
    return `📋 <b>حالة العقود</b>\n\n${head}\n\n${lines || "كل العقود منتظمة ✅"}`;
  } catch (e: any) { return `تعذّر بناء حالة العقود.\n<code>${esc(e.message)}</code>`; }
}

/** العقود ضمن حالة معيّنة (لأزرار الاختيار) */
export async function contractsInState(db: DB, profile: any, key: string): Promise<ContractCard[]> {
  const cards = await propContractCards(db, profile);
  return cards.filter((c) => c.state.key === key);
}

/** بطاقة عقد واحد */
export async function contractCard(db: DB, profile: any, tenantId: string): Promise<ContractCard | null> {
  const cards = await propContractCards(db, profile);
  return cards.find((c) => c.tenantId === tenantId) || null;
}

/** تسجيل أقدم فاتورة متأخرة لهذا المستأجر كمدفوعة */
export async function payTenantOldest(db: DB, profile: any, tenantId: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const { data: t } = await db.from("tenants").select("id,property_id").eq("id", tenantId).maybeSingle();
    if (!t) return { ok: false, msg: "العقد غير موجود." };
    const { data: prop } = await db.from("properties").select("id,user_id").eq("id", t.property_id).maybeSingle();
    if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح." };
    const { data: invs } = await db.from("invoices").select("*").eq("tenant_id", tenantId).eq("user_id", profile.id);
    const unpaid = (invs || []).filter((i: any) => invoiceUnpaid(i.status))
      .sort((a: any, b: any) => String(a.due_date).localeCompare(String(b.due_date)));
    if (!unpaid.length) return { ok: true, msg: "لا توجد فواتير غير مسدّدة." };
    const { error } = await db.from("invoices").update({ status: "paid" }).eq("id", unpaid[0].id);
    if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
    return { ok: true, msg: `سُجّلت دفعة (${sar(unpaid[0].amount)} ﷼) كمدفوعة.` };
  } catch (e: any) { return { ok: false, msg: e.message }; }
}

/** تجديد العقد سنة (يمدّد contract_end) */
export async function renewContract(db: DB, profile: any, tenantId: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const { data: t } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (!t) return { ok: false, msg: "العقد غير موجود." };
    const { data: prop } = await db.from("properties").select("id,user_id").eq("id", t.property_id).maybeSingle();
    if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح." };
    const base = t.contract_end && String(t.contract_end) >= todayISO() ? new Date(t.contract_end) : new Date();
    base.setFullYear(base.getFullYear() + 1);
    const newEnd = iso(base);
    const { error } = await db.from("tenants").update({ contract_end: newEnd }).eq("id", tenantId);
    if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
    return { ok: true, msg: `تم تجديد العقد حتى ${newEnd}.` };
  } catch (e: any) { return { ok: false, msg: e.message }; }
}

/** إشعار رسمي عبر واتساب: مطالبة سداد أو عدم تجديد */
export async function buildNotice(
  db: DB, profile: any, tenantId: string, kind: "claim" | "nonrenewal"
): Promise<{ ok: boolean; text: string; url?: string }> {
  try {
    const { data: t } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (!t) return { ok: false, text: "العقد غير موجود." };
    const { data: prop } = await db.from("properties").select("id,user_id").eq("id", t.property_id).maybeSingle();
    if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
    if (!t.phone) return { ok: false, text: `لا يوجد رقم جوال مسجّل لـ ${esc(t.name || "المستأجر")}.` };

    const unit = t.unit ? `وحدة ${t.unit}` : "العقار";
    const digits = normalizeSaudi(t.phone);
    let msg: string, title: string;
    if (kind === "claim") {
      const amount = (Number(t.months_late) || 0) * (Number(t.rent_amount) || 0);
      title = "مطالبة رسمية";
      msg = `السلام عليكم ${t.name || ""}،\nنفيدكم بوجود مبلغ متأخر${amount ? ` قدره ${sar(amount)} ﷼` : ""} عن إيجار «${unit}». نأمل سرعة السداد تفاديًا للإجراءات النظامية.\nإدارة وثيق`;
    } else {
      title = "إشعار عدم تجديد";
      msg = `السلام عليكم ${t.name || ""}،\nنفيدكم برغبتنا بعدم تجديد عقد إيجار «${unit}»${t.contract_end ? ` المنتهي بتاريخ ${t.contract_end}` : ""}. شاكرين لكم حسن التعامل.\nإدارة وثيق`;
    }
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    return { ok: true, text: `جاهز لإرسال <b>${title}</b> إلى <b>${esc(t.name || "المستأجر")}</b> — ${esc(unit)}:`, url };
  } catch (e: any) { return { ok: false, text: "تعذّر تجهيز الإشعار: " + e.message }; }
}

export { stateLabel };
