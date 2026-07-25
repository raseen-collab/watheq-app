/** ============================================================
 *  وثيق — طبقة بيانات البوت (تقارير + أفعال)
 *  ★ يحسب بنفس منطق لوحة التحكّم عبر lib/contracts.ts (contractState + paid_periods)
 *    فتتطابق أرقام تليجرام مع الشاشة تمامًا. مسار الجمعيات يبقى على months_late.
 *  ============================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import { contractState, renewContract as renewFields, freqShort, type Frequency } from "@/lib/contracts";
import { deriveState, STATE_ORDER, stateMeta, stateLabel, type StateKey } from "./contract-state";

type DB = SupabaseClient<any, any, any>;
type Track = "properties" | "associations";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayISO = () => iso(new Date());
export const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  const { count: assocN } = await db.from("associations").select("*", { count: "exact", head: true }).eq("user_id", profile.id);
  if (assocN && assocN > 0) {
    const { count: propN } = await db.from("properties").select("*", { count: "exact", head: true }).eq("user_id", profile.id);
    if (!propN) return "associations";
  }
  return "properties";
}

// ======================= مسار العقارات (contractState) =======================

type Enriched = {
  t: any;                 // صفّ المستأجر
  propId: string;
  propName: string;
  st: ReturnType<typeof contractState>;
  key: StateKey;
};

/** يجلب كل مستأجري المالك مع حالتهم المحسوبة بنفس منطق اللوحة */
async function enrichedTenants(db: DB, profile: any): Promise<{ properties: any[]; rows: Enriched[] }> {
  const { data: props } = await db.from("properties").select("*, tenants(*)").eq("user_id", profile.id);
  const properties = props || [];
  const rows: Enriched[] = [];
  properties.forEach((p: any) => {
    (p.tenants || []).forEach((t: any) => {
      const st = contractState(t);
      rows.push({ t, propId: p.id, propName: p.name || "عقار", st, key: deriveState(st, t) });
    });
  });
  return { properties, rows };
}

const rowLabel = (r: Enriched) => {
  const unit = r.t.unit ? `وحدة ${r.t.unit}` : "";
  return [r.propName, unit].filter(Boolean).join(" · ") || (r.t.name || "عقد");
};

const cardOf = (r: Enriched): ContractCard => ({
  tenantId: r.t.id,
  label: rowLabel(r),
  tenant: r.t.name || "—",
  phone: r.t.phone || "",
  state: {
    key: r.key, label: stateMeta(r.key).label, dot: stateMeta(r.key).dot,
    owed: r.st.amountDue || 0, nextDue: r.st.nextDueDate, daysToEnd: r.st.daysToEnd, endDate: r.st.endDate,
  },
});

// ======================= مسار الجمعيات (months_late) =======================

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
    if (track === "properties") {
      const { rows } = await enrichedTenants(db, profile);
      const soon = rows.filter((r) => r.key === "due_soon")
        .sort((a, b) => (a.st.daysToNextDue || 0) - (b.st.daysToNextDue || 0));
      if (!soon.length) return `📅 <b>استحقاقات قريبة</b>\n\nلا توجد دفعات مستحقة خلال ٧ أيام ✅`;
      const total = soon.reduce((s, r) => s + (Number(r.t.rent_amount) || 0), 0);
      const lines = soon.map((r) =>
        `• <b>${esc(rowLabel(r))}</b> — ${esc(r.t.name)} — <b>${sar(r.t.rent_amount)}</b> ﷼ — ${esc(r.st.nextDueDate)}`
      ).join("\n");
      return `📅 <b>استحقاقات قريبة</b> (خلال ٧ أيام)\n\n${lines}\n\n— الإجمالي: <b>${sar(total)}</b> ﷼ · ${soon.length} دفعة`;
    }
    const { assocs, owners } = await assocContext(db, profile);
    const soon = assocs.filter((a: any) => a.cert_expiry && a.cert_expiry >= todayISO());
    const lateCount = owners.filter((o: any) => (Number(o.months_late) || 0) > 0).length;
    const certLines = soon.length ? soon.map((a: any) => `• <b>${esc(a.name)}</b> — شهادة تنتهي ${esc(a.cert_expiry)}`).join("\n") : "لا شهادات قريبة ✅";
    return `📅 <b>تنبيهات قريبة</b>\n\n🪪 الشهادات:\n${certLines}\n\n⚠️ ملّاك متأخرون: <b>${lateCount}</b>`;
  } catch (e: any) { return `تعذّر جلب الاستحقاقات.\n<code>${esc(e.message)}</code>`; }
}

export async function lateReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);
    if (track === "properties") {
      const { rows } = await enrichedTenants(db, profile);
      const late = rows.filter((r) => r.key === "arrears")
        .sort((a, b) => (b.st.amountDue || 0) - (a.st.amountDue || 0));
      if (!late.length) return `⚠️ <b>المتأخرات</b>\n\nلا توجد متأخرات — ممتاز 👏`;
      const total = late.reduce((s, r) => s + (r.st.amountDue || 0), 0);
      const lines = late.map((r) =>
        `• <b>${esc(rowLabel(r))}</b> — ${esc(r.t.name)} — متأخر <b>${r.st.unpaid}</b> دفعة — <b>${sar(r.st.amountDue)}</b> ﷼`
      ).join("\n");
      return `⚠️ <b>المتأخرات</b>\n\n${lines}\n\n— إجمالي المتأخر: <b>${sar(total)}</b> ﷼ · ${late.length} عقد`;
    }
    const { assocById, owners } = await assocContext(db, profile);
    const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0)
      .sort((a: any, b: any) => (Number(b.months_late) || 0) - (Number(a.months_late) || 0));
    if (!late.length) return `⚠️ <b>المتأخرات</b>\n\nلا يوجد ملّاك متأخرون 👏`;
    const total = late.reduce((s: number, o: any) => s + ownerOwed(o, assocById), 0);
    const lines = late.map((o: any) => `• <b>${esc(o.name)}</b>${o.unit ? " — وحدة " + esc(o.unit) : ""} — متأخر <b>${o.months_late}</b> شهر — <b>${sar(ownerOwed(o, assocById))}</b> ﷼`).join("\n");
    return `⚠️ <b>المتأخرات</b>\n\n${lines}\n\n— إجمالي المتأخر: <b>${sar(total)}</b> ﷼ · ${late.length} مالك`;
  } catch (e: any) { return `تعذّر جلب المتأخرات.\n<code>${esc(e.message)}</code>`; }
}

export async function summaryReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);
    if (track === "properties") {
      const { properties, rows } = await enrichedTenants(db, profile);
      const collected = properties.reduce((s: number, p: any) => s + (Number(p.collected) || 0), 0);
      const late = rows.filter((r) => r.key === "arrears");
      const soon = rows.filter((r) => r.key === "due_soon");
      const overdue = late.reduce((s, r) => s + (r.st.amountDue || 0), 0);
      const pct = rows.length ? Math.round(((rows.length - late.length) / rows.length) * 100) : 100;
      return [
        `📊 <b>ملخّص وثيق — العقارات</b>`, ``,
        `• العقارات: <b>${properties.length}</b> · الوحدات: <b>${rows.length}</b>`,
        `• نسبة الانتظام: <b>${pct}٪</b>`,
        `• محصّل: <b>${sar(collected)}</b> ﷼`,
        `• متأخرات: <b>${sar(overdue)}</b> ﷼ (${late.length} عقد)`,
        `• تستحق خلال ٧ أيام: <b>${soon.length}</b>`,
      ].join("\n");
    }
    const { assocs, assocById, owners } = await assocContext(db, profile);
    const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0);
    const lateTotal = late.reduce((s: number, o: any) => s + ownerOwed(o, assocById), 0);
    const fund = assocs.reduce((s: number, a: any) => s + (Number(a.fund_balance) || 0), 0);
    return [
      `📊 <b>ملخّص وثيق — الجمعيات</b>`, ``,
      `• الجمعيات: <b>${assocs.length}</b> · الملّاك: <b>${owners.length}</b>`,
      `• رصيد الصناديق: <b>${sar(fund)}</b> ﷼`,
      `• متأخرون: <b>${late.length}</b> — <b>${sar(lateTotal)}</b> ﷼`,
    ].join("\n");
  } catch (e: any) { return `تعذّر بناء الملخّص.\n<code>${esc(e.message)}</code>`; }
}

export async function buildReport(db: DB, profile: any, which: string): Promise<string> {
  if (which === "late") return lateReport(db, profile);
  if (which === "summary") return summaryReport(db, profile);
  return todayReport(db, profile);
}

// ======================= بيانات منظّمة للأزرار =======================

export type UnpaidRow = { id: string; amount: number; due: string; unit: string; tenant: string; phone: string; contractId: string; };

export async function getUnpaid(db: DB, profile: any, scope: string): Promise<UnpaidRow[]> {
  const track = await detectTrack(db, profile);
  if (track === "properties") {
    const { rows } = await enrichedTenants(db, profile);
    const sel = rows.filter((r) => (scope === "late" ? r.key === "arrears" : r.key === "due_soon"));
    return sel.map((r) => ({
      id: r.t.id,
      amount: scope === "late" ? (r.st.amountDue || 0) : (Number(r.t.rent_amount) || 0),
      due: r.st.nextDueDate || "",
      unit: rowLabel(r), tenant: r.t.name || "—", phone: r.t.phone || "", contractId: r.t.id,
    }));
  }
  const { assocById, owners } = await assocContext(db, profile);
  const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0);
  return late.map((o: any) => ({
    id: o.id, amount: ownerOwed(o, assocById), due: "",
    unit: o.unit ? `وحدة ${o.unit}` : (assocById[o.association_id]?.name || ""),
    tenant: o.name || "—", phone: o.phone || "", contractId: o.id,
  }));
}

// ======================= آلة حالات العقد (بطاقات) =======================

export type ContractCard = {
  tenantId: string; label: string; tenant: string; phone: string;
  state: { key: StateKey; label: string; dot: string; owed: number; nextDue: string | null; daysToEnd: number | null; endDate: string | null; };
};

export async function statusReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);
    if (track !== "properties") {
      const { owners } = await assocContext(db, profile);
      const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0).length;
      return `📋 <b>حالة الحسابات</b>\n\n🟢 منتظم: <b>${owners.length - late}</b>\n🔴 متأخر: <b>${late}</b>`;
    }
    const { rows } = await enrichedTenants(db, profile);
    if (!rows.length) return "📋 <b>حالة العقود</b>\n\nلا توجد عقود مسجّلة بعد.";
    const counts: Record<string, number> = {};
    rows.forEach((r) => (counts[r.key] = (counts[r.key] || 0) + 1));
    const head = STATE_ORDER.filter((k) => counts[k]).map((k) => `${stateMeta(k).dot} ${stateMeta(k).label}: <b>${counts[k]}</b>`).join("  ·  ");
    const flagged = rows.filter((r) => r.key !== "active")
      .sort((a, b) => STATE_ORDER.indexOf(a.key) - STATE_ORDER.indexOf(b.key)).slice(0, 8);
    const lines = flagged.map((r) => {
      const extra = r.key === "arrears" ? ` — ${sar(r.st.amountDue)} ﷼`
        : r.key === "expiring" && r.st.daysToEnd != null ? ` — ينتهي خلال ${r.st.daysToEnd} يوم`
        : (r.key === "due_soon" && r.st.nextDueDate) ? ` — ${r.st.nextDueDate}` : "";
      return `${stateMeta(r.key).dot} <b>${esc(rowLabel(r))}</b> — ${esc(r.t.name)}${extra}`;
    }).join("\n");
    return `📋 <b>حالة العقود</b>\n\n${head}\n\n${lines || "كل العقود منتظمة ✅"}`;
  } catch (e: any) { return `تعذّر بناء حالة العقود.\n<code>${esc(e.message)}</code>`; }
}

export async function contractsInState(db: DB, profile: any, key: string): Promise<ContractCard[]> {
  const { rows } = await enrichedTenants(db, profile);
  return rows.filter((r) => r.key === key).map(cardOf);
}

export async function contractCard(db: DB, profile: any, tenantId: string): Promise<ContractCard | null> {
  const { rows } = await enrichedTenants(db, profile);
  const r = rows.find((x) => x.t.id === tenantId);
  return r ? cardOf(r) : null;
}

// ======================= الأفعال (كتابة) =======================

/** تسجيل دفعة = رفع paid_periods (نفس زرّ «سجّل دفعة» في اللوحة) + تحديث المحصّل */
async function recordPayment(db: DB, profile: any, tenantId: string): Promise<{ ok: boolean; msg: string }> {
  const { data: t } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
  if (!t) return { ok: false, msg: "العقد غير موجود." };
  const { data: prop } = await db.from("properties").select("id,user_id,collected").eq("id", t.property_id).maybeSingle();
  if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح." };
  const rent = Number(t.rent_amount) || 0;
  const { error } = await db.from("tenants").update({ paid_periods: (Number(t.paid_periods) || 0) + 1 }).eq("id", tenantId);
  if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
  await db.from("properties").update({ collected: (Number(prop.collected) || 0) + rent }).eq("id", prop.id);
  return { ok: true, msg: `سُجّلت دفعة (${sar(rent)} ﷼).` };
}
export const markPaid = (db: DB, profile: any, id: string) => recordPayment(db, profile, id);
export const payTenantOldest = (db: DB, profile: any, tenantId: string) => recordPayment(db, profile, tenantId);

/** تجديد العقد بنفس منطق اللوحة (renewContract في contracts.ts) + توثيق في السجل */
export async function renewContract(db: DB, profile: any, tenantId: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const { data: t } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (!t) return { ok: false, msg: "العقد غير موجود." };
    const { data: prop } = await db.from("properties").select("id,user_id,property_type,name").eq("id", t.property_id).maybeSingle();
    if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح." };
    const fields = renewFields(t, {});
    const { error } = await db.from("tenants").update(fields).eq("id", tenantId);
    if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
    await db.from("property_notes").insert({
      property_id: prop.id, note_date: todayISO(),
      text: `تجديد عقد ${t.name} (وحدة ${t.unit || "—"}) — إلى ${fields.contract_end} بقيمة ${sar(fields.rent_amount)} ريال / ${freqShort(fields.payment_frequency as Frequency)} — عبر البوت`,
    });
    return { ok: true, msg: `تم تجديد العقد حتى ${fields.contract_end}.` };
  } catch (e: any) { return { ok: false, msg: e.message }; }
}

/** إشعار رسمي عبر واتساب (مطالبة / عدم تجديد) */
export async function buildNotice(db: DB, profile: any, tenantId: string, kind: "claim" | "nonrenewal"): Promise<{ ok: boolean; text: string; url?: string }> {
  try {
    const { data: t } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (!t) return { ok: false, text: "العقد غير موجود." };
    const { data: prop } = await db.from("properties").select("id,user_id").eq("id", t.property_id).maybeSingle();
    if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
    if (!t.phone) return { ok: false, text: `لا يوجد رقم جوال مسجّل لـ ${esc(t.name || "المستأجر")}.` };
    const st = contractState(t);
    const unit = t.unit ? `وحدة ${t.unit}` : "العقار";
    const digits = normalizeSaudi(t.phone);
    let msg: string, title: string;
    if (kind === "claim") {
      title = "مطالبة رسمية";
      msg = `السلام عليكم ${t.name || ""}،\nنفيدكم بوجود مبلغ متأخر${st.amountDue ? ` قدره ${sar(st.amountDue)} ﷼` : ""} (${st.unpaid} دفعة) عن إيجار «${unit}». نأمل سرعة السداد تفاديًا للإجراءات النظامية.\nإدارة وثيق`;
    } else {
      title = "إشعار عدم تجديد";
      msg = `السلام عليكم ${t.name || ""}،\nنفيدكم برغبتنا بعدم تجديد عقد إيجار «${unit}»${st.endDate ? ` المنتهي بتاريخ ${st.endDate}` : ""}. شاكرين لكم حسن التعامل.\nإدارة وثيق`;
    }
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    return { ok: true, text: `جاهز لإرسال <b>${title}</b> إلى <b>${esc(t.name || "المستأجر")}</b> — ${esc(unit)}:`, url };
  } catch (e: any) { return { ok: false, text: "تعذّر تجهيز الإشعار: " + e.message }; }
}

/** تذكير ودّي عبر واتساب */
export async function buildReminder(db: DB, profile: any, contractId: string): Promise<{ ok: boolean; text: string; url?: string }> {
  try {
    const track = await detectTrack(db, profile);
    let name = "", phone = "", unit = "", extra = "";
    if (track === "properties") {
      const { data: t } = await db.from("tenants").select("*").eq("id", contractId).maybeSingle();
      if (!t) return { ok: false, text: "المستأجر غير موجود." };
      const { data: prop } = await db.from("properties").select("id,user_id").eq("id", t.property_id).maybeSingle();
      if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
      const st = contractState(t);
      name = t.name || "المستأجر"; phone = t.phone || ""; unit = t.unit ? `وحدة ${t.unit}` : "";
      extra = st.amountDue ? ` بمبلغ ${sar(st.amountDue)} ﷼` : (st.nextDueDate ? ` بتاريخ ${st.nextDueDate}` : "");
    } else {
      const { data: o } = await db.from("owners").select("*").eq("id", contractId).maybeSingle();
      if (!o) return { ok: false, text: "المالك غير موجود." };
      const { data: assoc } = await db.from("associations").select("id,user_id").eq("id", o.association_id).maybeSingle();
      if (!assoc || String(assoc.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
      name = o.name || "المالك"; phone = o.phone || ""; unit = o.unit ? `وحدة ${o.unit}` : "";
    }
    if (!phone) return { ok: false, text: `لا يوجد رقم جوال مسجّل لـ ${esc(name)}.` };
    const digits = normalizeSaudi(phone);
    const msg = `السلام عليكم ${name}،\nتذكير ودّي بسداد المستحق${unit ? " «" + unit + "»" : ""}${extra}. شاكرين لكم تعاونكم.`;
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    return { ok: true, text: `جاهز لتذكير <b>${esc(name)}</b>${unit ? " — " + esc(unit) : ""} عبر واتساب:`, url };
  } catch (e: any) { return { ok: false, text: "تعذّر تجهيز التذكير: " + e.message }; }
}

export { stateLabel };
