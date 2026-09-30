/** ============================================================
 *  وثيق — طبقة بيانات البوت (تقارير + أفعال)
 *  ★ يحسب بنفس منطق لوحة التحكّم عبر lib/contracts.ts (contractState + paid_periods)
 *    فتتطابق أرقام تليجرام مع الشاشة تمامًا. مسار الجمعيات يبقى على months_late.
 *  ============================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import { statusWindows } from "./contract-state";
import { contractState, renewContract as renewFields, freqShort, applyPayment, defaultTermPeriods, splitVat, unitVatApplies, withVat, type Frequency } from "@/lib/contracts";
import { today as riyadhToday, waNumber, daysAr } from "@/lib/utils";
import { annualRentRoll } from "@/lib/income";
import { fetchAllRows } from "@/lib/fetch-all";
import { createHash } from "crypto";
import { arDate } from "@/lib/documents";
import { deriveState, STATE_ORDER, stateMeta, stateLabel, type StateKey } from "./contract-state";

type DB = SupabaseClient<any, any, any>;
type Track = "properties" | "associations";

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/* «اليوم» بتوقيت الرياض — كانت iso(new Date()) بساعة الخادم (غرينتش)، فدفعة تُسجَّل من
   البوت بين منتصف الليل و3 فجرًا تُؤرَّخ بالأمس، وقد تقع في الشهر السابق بتقرير المالك */
const todayISO = () => riyadhToday();
export const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");

/** جمع عربي صحيح في رسائل البوت: 1 دفعة · 2 دفعتان · 3–10 دفعات · 11+ دفعة */
function arPlural(n: number, one: string, two: string, few: string, many = one): string {
  const x = Math.abs(Math.round(Number(n) || 0));
  if (x === 1) return one;
  if (x === 2) return two;
  if (x >= 3 && x <= 10) return `${x} ${few}`;
  return `${x} ${many}`;
}
/**
 * حد تليجرام 4096 حرفًا — والرسالة الأطول تُرفض بالكامل فلا يصل شيء.
 * مكتب فيه 226 متأخرًا كان ينتج 18,846 حرفًا: أي أن `/late` لا يعمل عند
 * من يحتاجه أكثر. نقصّ القائمة ونذكر المتبقي، ثم حارس أخير على الطول.
 */
const TG_MAX = 3900;                       // هامش أمان تحت 4096
const TOP_N = 25;                          // أطول قائمة معقولة للقراءة على الجوال
function capList(lines: string[], total: number, unit: string): string {
  const shown = lines.slice(0, TOP_N).join("\n");
  const rest = total - Math.min(TOP_N, lines.length);
  return rest > 0 ? `${shown}\n\n<i>و${rest} ${unit} أخرى — افتح اللوحة لرؤيتها كلها.</i>` : shown;
}
export function tgClip(text: string): string {
  if (text.length <= TG_MAX) return text;
  const cut = text.slice(0, TG_MAX);
  const nl = cut.lastIndexOf("\n");
  return (nl > TG_MAX * 0.6 ? cut.slice(0, nl) : cut) + "\n\n<i>… القائمة أطول من حد تليجرام — افتح اللوحة.</i>";
}

const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* دالة الموقع نفسها (waNumber): كانت هنا نسخة لا تفهم الأرقام العربية (٠٥٥…) فتصنع
   رابط واتساب بلا رقم. ويُتحقق من الناتج قبل صنع الرابط. */
function normalizeSaudi(raw: string): string { return waNumber(raw); }
function phoneOk(d: string): boolean { return /^9665\d{8}$/.test(d) || (!d.startsWith("966") && /^\d{10,15}$/.test(d)); }

// ======================= اكتشاف نوع الحساب =======================

async function detectTrack(db: DB, profile: any): Promise<Track> {
  /* 30 سبتمبر 2026: الحساب المزدوج («both») كان يُقرأ «عقارات» دائمًا (كلمة both لا تطابق شيئًا
     ثم يُفحص وجود عقارات). الآن: اختيار المستخدم في البوت (_track) ثم آخر لوحة فتحها. */
  if (String(profile.account_type || "").toLowerCase() === "both") {
    if (profile._track === "associations" || profile._track === "properties") return profile._track;
    const last = String(profile.last_dashboard || "").toLowerCase();
    if (/assoc/.test(last)) return "associations";
    if (/prop/.test(last)) return "properties";
  }
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
  p?: any;                // العقار — لحساب المتأخر شاملًا الضريبة (dueOf)
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
      /* العتبات من lib/contract-state: النسخة السابقة هنا أغفلت expiringDays
         فاختلف «ينتهي قريبًا» بين التقارير والشاشة عند من غيّر الإعداد */
      const st = contractState(t, statusWindows(p, profile));
      rows.push({ t, p, propId: p.id, propName: p.name || "عقار", st, key: deriveState(st, t) });
    });
  });
  return { properties, rows };
}

/** المتأخر كما يُطالَب به (شاملًا الضريبة في «مضافة فوق الإيجار») — للعرض فقط.
 *  التسجيل (markPaid) يبقى بوحدة الإيجار المخزَّن لأنها وحدة سجل الدفعات. */
const dueOf = (r: Enriched) => withVat(r.st.amountDue || 0, r.t, r.p);

const rowLabel = (r: Enriched) => {
  const unit = r.t.unit ? `وحدة ${r.t.unit}` : "";
  return [r.propName, unit].filter(Boolean).join(" · ") || (r.t.name || "عقد");
};

const cardOf = (r: Enriched): ContractCard => ({
  tenantId: r.t.id, rent: Number(r.t.rent_amount) || 0,
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
  /* استحقاق الفترة الجديدة قبل أي تقرير (مفتاح الخدمة) — وإلا يرى المكتب في البوت أرقام
     ما قبل أول الشهر حتى يفتح اللوحة. v64 لمكتب واحد، وقبله للكل. الفشل لا يوقف التقرير. */
  try {
    const r = await db.rpc("watheq_hoa_accrue_office", { p_office: profile.id });
    if (r.error) await db.rpc("watheq_hoa_accrue_all");
  } catch { /* قبل v60 */ }
  const { data: assocsAll } = await db.from("associations").select("*").eq("user_id", profile.id);
  /* المؤرشفة (v64) خارج التقارير — تصفية هنا لا في الاستعلام حتى يعمل قبل تطبيق v64 */
  const assocs = (assocsAll || []).filter((a: any) => !a.archived_at);
  const assocById: Record<string, any> = {};
  (assocs || []).forEach((a: any) => (assocById[a.id] = a));
  const assocIds = (assocs || []).map((a: any) => a.id);
  let owners: any[] = [];
  if (assocIds.length) {
    /* بلا قصّ عند 1000 صف: مدير بعدة عمارات قد يتجاوزها */
    owners = await fetchAllRows<any>(db as any, "owners", "*", (q) => q.in("association_id", assocIds));
  }
  return { assocs: assocs || [], assocById, owners };
}
/* 30 سبتمبر 2026: يُطرح المسدَّد جزئيًّا كما تفعل اللوحة (ownerDue) — كان البوت
   يعرض المتأخر كاملًا فيختلف رقمه عن الشاشة عند من سدّد جزءًا. */
/* v63: الرسم الفعلي للمالك (من حصته إن وُزّعت الرسوم بالحصص) وإلا رسم الجمعية */
const ownerFeeOf = (o: any, a: any) => (Number(o?.fee_override) > 0 ? Number(o.fee_override) : Number(a?.fee) || 0);
const periodWord = (a: any) => (a?.fee_period === "annual" ? "سنة" : "شهر");
const ownerOwed = (o: any, assocById: Record<string, any>) =>
  Math.max(0, Math.round(((Number(o.months_late) || 0) * ownerFeeOf(o, assocById[o.association_id]) - (Number(o.partial_amount) || 0)) * 100) / 100);

// ======================= التقارير (نص) =======================

export async function todayReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);
    if (track === "properties") {
      const { rows } = await enrichedTenants(db, profile);
      const soon = rows.filter((r) => r.key === "due_soon")
        .sort((a, b) => (a.st.daysToNextDue || 0) - (b.st.daysToNextDue || 0));
      const win = Number(profile?.due_soon_days) || 10;   /* نافذة «قريب» الفعلية — كانت «7 أيام» ثابتة */
      if (!soon.length) return tgClip(`📅 <b>استحقاقات قريبة</b>\n\nلا توجد دفعات مستحقة خلال ${daysAr(win)} ✅`);
      const total = soon.reduce((s, r) => s + withVat(Number(r.t.rent_amount) || 0, r.t, r.p), 0);
      const lines = soon.map((r) =>
        `• <b>${esc(rowLabel(r))}</b> — ${esc(r.t.name)} — <b>${sar(withVat(Number(r.t.rent_amount) || 0, r.t, r.p))}</b> ريال — ${arDate(r.st.nextDueDate)}`
      ).join("\n");
      return tgClip(`📅 <b>استحقاقات قريبة</b> (خلال ${daysAr(win)})\n\n${capList(lines.split("\n"), soon.length, "دفعة")}\n\n— الإجمالي: <b>${sar(total)}</b> ريال · ${arPlural(soon.length, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")}`);
    }
    const { assocs, owners } = await assocContext(db, profile);
    /* 30 سبتمبر 2026: الشهادة المنتهية كانت تُخفى (الفلتر ≥ اليوم) — وهي أخطر ما في
       التقرير. تُعرض أولًا بعلامة واضحة، ثم القادمة بالأقرب. */
    const t0 = todayISO();
    const withCert = assocs.filter((a: any) => a.cert_expiry);
    const expired = withCert.filter((a: any) => a.cert_expiry < t0).sort((a: any, b: any) => String(a.cert_expiry).localeCompare(String(b.cert_expiry)));
    const soon = withCert.filter((a: any) => a.cert_expiry >= t0).sort((a: any, b: any) => String(a.cert_expiry).localeCompare(String(b.cert_expiry)));
    const lateCount = owners.filter((o: any) => (Number(o.months_late) || 0) > 0).length;
    const certLines = [
      ...expired.map((a: any) => `⛔ <b>${esc(a.name)}</b> — <b>الشهادة منتهية</b> منذ ${esc(arDate(a.cert_expiry))}`),
      ...soon.map((a: any) => `• <b>${esc(a.name)}</b> — شهادة تنتهي ${esc(arDate(a.cert_expiry))}`),
    ].join("\n") || "لا شهادات مسجّلة ✅";
    return tgClip(`📅 <b>تنبيهات قريبة</b>\n\n🪪 الشهادات:\n${certLines}\n\n⚠️ ملّاك متأخرون: <b>${lateCount}</b>`);
  } catch (e: any) { return `تعذّر جلب الاستحقاقات.\n<code>${esc(e.message)}</code>`; }
}

export async function lateReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);
    if (track === "properties") {
      const { rows } = await enrichedTenants(db, profile);
      const late = rows.filter((r) => r.key === "arrears")
        .sort((a, b) => dueOf(b) - dueOf(a));
      if (!late.length) return tgClip(`⚠️ <b>المتأخرات</b>\n\nلا توجد متأخرات — ممتاز 👏`);
      const total = late.reduce((s, r) => s + dueOf(r), 0);
      const lines = late.map((r) =>
        `• <b>${esc(rowLabel(r))}</b> — ${esc(r.t.name)} — متأخر <b>${arPlural(r.st.unpaid, "دفعة واحدة", "دفعتان", "دفعات", "دفعة")}</b> — <b>${sar(dueOf(r))}</b> ريال`
      ).join("\n");
      return tgClip(`⚠️ <b>المتأخرات</b>\n\n${capList(lines.split("\n"), late.length, "عقد")}\n\n— إجمالي المتأخر: <b>${sar(total)}</b> ريال · ${late.length} عقد`);
    }
    const { assocById, owners } = await assocContext(db, profile);
    const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0)
      .sort((a: any, b: any) => (Number(b.months_late) || 0) - (Number(a.months_late) || 0));
    if (!late.length) return tgClip(`⚠️ <b>المتأخرات</b>\n\nلا يوجد ملّاك متأخرون 👏`);
    const total = late.reduce((s: number, o: any) => s + ownerOwed(o, assocById), 0);
    const lines = late.map((o: any) => `• <b>${esc(o.name)}</b>${o.unit ? " — وحدة " + esc(o.unit) : ""} — متأخر <b>${arPlural(o.months_late, "شهر واحد", "شهران", "أشهر", "شهرًا")}</b> — <b>${sar(ownerOwed(o, assocById))}</b> ريال`).join("\n");
    return tgClip(`⚠️ <b>المتأخرات</b>\n\n${capList(lines.split("\n"), late.length, "مالك")}\n\n— إجمالي المتأخر: <b>${sar(total)}</b> ريال · ${late.length} مالك`);
  } catch (e: any) { return `تعذّر جلب المتأخرات.\n<code>${esc(e.message)}</code>`; }
}

export async function summaryReport(db: DB, profile: any): Promise<string> {
  try {
    const track = await detectTrack(db, profile);
    if (track === "properties") {
      const { properties, rows } = await enrichedTenants(db, profile);
      /* الخلايا الثلاث نفسها في الموقع: كان «محصّل» كل ما قُبض منذ فتح الحساب بلا ذكر
         للفترة، فيُقرأ تحصيلَ الشهر ويناقض الموقع. على دفعات (يتجاوز 1000 صف). */
      const ids = properties.map((p: any) => p.id);
      const to = todayISO(), from = `${to.slice(0, 7)}-01`;
      const [mPays, mExp] = ids.length ? await Promise.all([
        fetchAllRows<any>(db as any, "payments", "id,amount", (q) => q.in("property_id", ids).gte("paid_on", from).lte("paid_on", to)).catch(() => null),
        fetchAllRows<any>(db as any, "expenses", "id,amount,billable", (q) => q.in("property_id", ids).gte("spent_on", from).lte("spent_on", to)).catch(() => null),
      ]) : [[], []];
      const monthCollected = mPays ? mPays.reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0) : null;
      const monthExp = mExp ? mExp.filter((e: any) => e.billable !== false).reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0) : null;
      const rr = annualRentRoll(rows.map((r) => r.t));
      const late = rows.filter((r) => r.key === "arrears");
      const soon = rows.filter((r) => r.key === "due_soon");
      const overdue = late.reduce((s, r) => s + dueOf(r), 0);
      /**
       * الدين المرحَّل لا يظهر في /late: المستأجر الحالي الذي سدّد شهره
       * ليس متأخرًا، والشاغرة لا تُدرج أصلًا — فيبقى مالٌ مستحقّ لا يعرف
       * عنه من يتابع بالبوت وحده شيئًا. سطر واحد في الملخّص يكفي، ولا
       * نُقحمه في المتأخرات لأنه صنف آخر يُطالَب به بطريقة أخرى.
       */
      /* ودين المستأجرين السابقين في الأرشيف (v45) — قبل الترحيل لا جدول */
      let pastOwed = 0, pastN = 0;
      try {
        const { data: pd } = await db.from("past_tenancies")
          .select("debt_amount, debt_paid, debt_status").eq("user_id", profile.id)
          .not("debt_status", "in", "(settled,written_off)").limit(2000);
        for (const x of (pd || []) as any[]) {
          const left = (Number(x.debt_amount) || 0) - (Number(x.debt_paid) || 0);
          if (left > 0.005) { pastOwed += left; pastN++; }
        }
      } catch { /* لا جدول بعد */ }
      const carried = rows.reduce((s, r) => s + (r.st.carriedDebt || 0), 0) + pastOwed;
      const carriedN = rows.filter((r) => (r.st.carriedDebt || 0) > 0).length + pastN;
      return [
        `📊 <b>ملخّص وثيق — العقارات</b>`, ``,
        `• العقارات: <b>${properties.length}</b> · الوحدات: <b>${rows.length}</b> (مؤجّرة ${rr.occupied}${rr.vacant ? ` · شاغرة ${rr.vacant}` : ""})`,
        ``,
        `💰 المحصَّل هذا الشهر: <b>${monthCollected === null ? "—" : sar(Math.round(monthCollected))}</b> ريال`,
        `🏢 دخل العقارات السنوي: <b>${sar(Math.round(rr.annual))}</b> ريال`,
        `🧾 مصروفات هذا الشهر: <b>${monthExp === null ? "—" : sar(Math.round(monthExp))}</b> ريال`,
        ``,
        `🔴 متأخرات: <b>${sar(overdue)}</b> ريال (${late.length} عقد)`,
        ...(carried > 0 ? [`💼 ديون مرحَّلة وسابقة: <b>${sar(carried)}</b> ريال (${carriedN})`] : []),
        `🟡 تستحق قريبًا: <b>${soon.length}</b>`,
        ...(rr.expired ? [`📄 عقود انتهت ولم تُجدَّد: <b>${rr.expired}</b>`] : []),
      ].join("\n");
    }
    const { assocs, assocById, owners } = await assocContext(db, profile);
    const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0);
    const lateTotal = late.reduce((s: number, o: any) => s + ownerOwed(o, assocById), 0);
    const fund = assocs.reduce((s: number, a: any) => s + (Number(a.fund_balance) || 0), 0);
    return [
      `📊 <b>ملخّص وثيق — الجمعيات</b>`, ``,
      `• الجمعيات: <b>${assocs.length}</b> · الملّاك: <b>${owners.length}</b>`,
      `• رصيد الصناديق: <b>${sar(fund)}</b> ريال`,
      `• متأخرون: <b>${late.length}</b> — <b>${sar(lateTotal)}</b> ريال`,
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
  id: string; amount: number; due: string; unit: string; tenant: string; phone: string; contractId: string;
  /** 30 سبتمبر 2026: «owner» لمالك جمعية — لا بطاقة عقد له، والتسجيل اشتراك شهر واحد بقيمة `fee` */
  kind?: "tenant" | "owner"; fee?: number;
  /** v63: «شهر» أو «سنة» — فترة اشتراك الجمعية */
  period?: string;
};

export async function getUnpaid(db: DB, profile: any, scope: string): Promise<UnpaidRow[]> {
  const track = await detectTrack(db, profile);
  if (track === "properties") {
    const { rows } = await enrichedTenants(db, profile);
    const sel = rows.filter((r) => (scope === "late" ? r.key === "arrears" : r.key === "due_soon"));
    return sel.map((r) => ({
      id: r.t.id,
      amount: scope === "late" ? (r.st.amountDue || 0) : (Number(r.t.rent_amount) || 0),
      due: r.st.nextDueDate || "",
      unit: rowLabel(r), tenant: r.t.name || "—", phone: r.t.phone || "", contractId: r.t.id, kind: "tenant" as const,
    }));
  }
  const { assocById, owners } = await assocContext(db, profile);
  const late = owners.filter((o: any) => (Number(o.months_late) || 0) > 0);
  return late.map((o: any) => ({
    id: o.id, amount: ownerOwed(o, assocById), due: "",
    unit: o.unit ? `وحدة ${o.unit}` : (assocById[o.association_id]?.name || ""),
    tenant: o.name || "—", phone: o.phone || "", contractId: o.id,
    kind: "owner" as const, fee: ownerFeeOf(o, assocById[o.association_id]),
    period: periodWord(assocById[o.association_id]),
  }));
}

// ======================= آلة حالات العقد (بطاقات) =======================

export type ContractCard = {
  tenantId: string; label: string; tenant: string; phone: string; rent?: number;
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
      const extra = r.key === "arrears" ? ` — ${sar(dueOf(r))} ريال`
        : r.key === "expiring" && r.st.daysToEnd != null ? ` — ينتهي خلال ${r.st.daysToEnd} يوم`
        : (r.key === "due_soon" && r.st.nextDueDate) ? ` — ${arDate(r.st.nextDueDate)}` : "";
      return `${stateMeta(r.key).dot} <b>${esc(rowLabel(r))}</b> — ${esc(r.t.name)}${extra}`;
    }).join("\n");
    return `📋 <b>حالة العقود</b>\n\n${head}\n\n${lines || "كل العقود منتظمة ✅"}`;
  } catch (e: any) { return `تعذّر بناء حالة العقود.\n<code>${esc(e.message)}</code>`; }
}

export async function contractsInState(db: DB, profile: any, key: string): Promise<ContractCard[]> {
  const { rows } = await enrichedTenants(db, profile);
  return rows.filter((r) => r.key === key).map(cardOf);
}

/**
 * البحث الحر من تليجرام.
 *
 * أكثر سؤال يواجه صاحب المكتب وهو خارج مكتبه: «فلان دفع أو لا؟». قبل هذا
 * كان يفتح اللوحة لأجله. الآن يكتب الاسم أو آخر أربعة أرقام من الجوال
 * فيصله جواب فوري. البحث يشمل: الاسم · الجوال · رقم الوحدة · الهوية ·
 * رقم العقد — نفس حقول بحث اللوحة، فلا يجد شيئًا هنا ويعجز عنه هناك.
 */
export async function searchTenants(db: DB, profile: any, query: string): Promise<{ cards: ContractCard[]; total: number }> {
  const q = String(query || "").trim().toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));   // أرقام عربية
  /* رقم واحد مقبول لأن أرقام الوحدات غالبًا خانة واحدة («3»)، أما الحرف
     الواحد فيُرفض لأنه يطابق نصف المستأجرين ولا يفيد. */
  if (!q || (q.length < 2 && !/^\d$/.test(q))) return { cards: [], total: 0 };
  const { rows } = await enrichedTenants(db, profile);
  const exactUnit = /^\d{1,4}$/.test(q)
    ? rows.filter((r) => String((r.t as any).unit || "").toLowerCase() === q) : [];
  const hits = exactUnit.length ? exactUnit : rows.filter((r) => {
    const t: any = r.t;
    return [t.name, t.unit, t.phone, t.national_id, t.contract_no]
      .some((v) => v && String(v).toLowerCase().includes(q));
  });
  return { cards: hits.slice(0, 8).map((r) => cardOf(r)), total: hits.length };
}

export async function contractCard(db: DB, profile: any, tenantId: string): Promise<ContractCard | null> {
  const { rows } = await enrichedTenants(db, profile);
  const r = rows.find((x) => x.t.id === tenantId);
  return r ? cardOf(r) : null;
}

// ======================= الأفعال (كتابة) =======================

const BOT_NOTE = "سُجّلت عبر بوت تليجرام";

/** تسجيل دفعة كاملة لمستأجر — نفس الدالة الذرّية التي تستخدمها اللوحة (schema-v12) */
async function payTenant(db: DB, profile: any, tenantId: string, mode: "one" | "all" = "one"): Promise<{ ok: boolean; msg: string }> {
  const { data: t } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
  if (!t) return { ok: false, msg: "العقد غير موجود." };
  const { data: prop } = await db.from("properties").select("id,user_id,grace_days").eq("id", t.property_id).maybeSingle();
  if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح." };
  const rent = Number(t.rent_amount) || 0;
  if (rent <= 0) return { ok: false, msg: "قيمة الدفعة غير محدّدة لهذا العقد." };
  /* حارس التكرار في القاعدة لا في الذاكرة: Vercel يشغّل نسخًا متعددة لا تتشارك الذاكرة،
     فنقرتان على «سجّل» قد تصلان لنسختين فتُسجَّلان. نرفض دفعة ثانية من البوت للمستأجر
     نفسه خلال 90 ثانية. (الموقع عرف المشكلة نفسها: ثماني ضغطات على ✔.) */
  const since = new Date(Date.now() - 90_000).toISOString();
  const { data: recent } = await db.from("payments").select("id").eq("tenant_id", tenantId)
    .eq("note", BOT_NOTE).gte("created_at", since).limit(1);
  if (recent && recent.length) return { ok: false, msg: "سُجّلت دفعة لهذا المستأجر قبل لحظات — لم تُسجَّل ثانية. إن كانت دفعة أخرى فعلًا، سجّلها من اللوحة." };
  /* «كامل المتأخر» يسجّل ما عُرض في القائمة، لا قسطًا واحدًا (كان يُعرض 7,500 ويُسجَّل 2,500) */
  const st = contractState(t, statusWindows(prop, profile));
  const amount = mode === "all" && (st.amountDue || 0) > 0 ? Math.round((st.amountDue || 0) * 100) / 100 : rent;
  const { data, error } = await db.rpc("watheq_record_payment", {
    p_tenant: tenantId, p_amount: amount, p_method: "other", p_note: BOT_NOTE,
    p_paid_on: todayISO(), p_actor: profile.id,
  });
  if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
  const r = (data || {}) as { completed?: number };
  return { ok: true, msg: `سُجّلت ${mode === "all" ? "كامل المتأخرات" : "دفعة"} (${sar(amount)} ريال)${(r.completed || 0) > 1 ? ` — اكتملت ${r.completed} دفعات` : ""}.` };
}

/**
 * تسجيل اشتراك شهر واحد لمالك في جمعية — بالدالة الذرّية نفسها التي تستعملها اللوحة.
 *
 * 30 سبتمبر 2026: كان يكتب في owners مباشرة ثم يُدرج سطر payments منفصلًا —
 * فلا يتحرّك رصيد الصندوق (fund_balance)، ولا قفل على صف المالك، ولا حارس تكرار
 * في القاعدة. الآن: watheq_record_owner_payment تقفل وتحدّث المالك والصندوق والسجل
 * معًا أو لا شيء، ونرفض دفعة ثانية من البوت للمالك نفسه خلال 90 ثانية (كمسار العقارات).
 */
/** UUID حتمي من مفتاح (نمط UUIDv5: sha1 ثم بتات الإصدار والمتغيّر) — نفس زرّ تليجرام ⇒ نفس الطلب */
export function uuidFromKey(key: string): string {
  const h = createHash("sha1").update("watheq:" + key).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

async function payOwner(db: DB, profile: any, ownerId: string, requestKey?: string | null): Promise<{ ok: boolean; msg: string }> {
  /* select("*"): يعمل قبل v63 وبعدها (fee_override / fee_period قد لا يوجدان بعد) */
  const { data: o } = await db.from("owners").select("*").eq("id", ownerId).maybeSingle();
  if (!o) return { ok: false, msg: "المالك غير موجود." };
  const { data: assoc } = await db.from("associations").select("*").eq("id", o.association_id).maybeSingle();
  if (!assoc || String(assoc.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح." };

  const fee = ownerFeeOf(o, assoc);
  if (fee <= 0) return { ok: false, msg: "قيمة الاشتراك غير محدّدة لهذه الجمعية." };

  const since = new Date(Date.now() - 90_000).toISOString();
  const { data: recent } = await db.from("payments").select("id").eq("owner_id", ownerId)
    .eq("note", BOT_NOTE).gte("created_at", since).limit(1);
  if (recent && recent.length) return { ok: false, msg: "سُجّلت دفعة لهذا المالك قبل لحظات — لم تُسجَّل ثانية. إن كانت دفعة أخرى فعلًا، سجّلها من اللوحة." };

  const { data, error } = await db.rpc("watheq_record_owner_payment", {
    p_owner: ownerId, p_amount: fee, p_method: "other", p_note: BOT_NOTE, p_actor: profile.id,
    /* M4: معرّف الضغطة من تليجرام ⇒ إعادة تسليم الاستدعاء نفسه لا تسجّل دفعة ثانية (القاعدة تُرجع الأولى) */
    ...(requestKey ? { p_request: uuidFromKey(`tg:${requestKey}:${ownerId}`) } : {}),
  });
  if (error) {
    const m = String(error.message || "");
    return { ok: false, msg: /monthly_fee/.test(m)
      ? "تعذّر الحفظ: دالة سداد الجمعيات تحتاج تحديث قاعدة البيانات (schema-v59)."
      : "تعذّر الحفظ: " + m };
  }
  const r = (data || {}) as { months?: number; fund_balance?: number; duplicate?: boolean; receipt_no?: string };
  if (r.duplicate) return { ok: true, msg: `هذه الدفعة مسجّلة سابقًا${r.receipt_no ? ` (سند ${r.receipt_no})` : ""} — لم تُسجَّل مرة ثانية.` };
  const months = Number(r.months) || 0;
  const covered = assoc.fee_period === "annual" ? arPlural(months, "سنة واحدة", "سنتان", "سنوات", "سنة") : arPlural(months, "شهر واحد", "شهران", "أشهر", "شهرًا");
  return { ok: true, msg: `سُجّل اشتراك (${sar(fee)} ريال) — ${months > 0 ? `سُدّد ${covered}` : "سداد جزئي"}${r.fund_balance != null ? ` · رصيد الصندوق ${sar(Number(r.fund_balance))} ريال` : ""}.` };
}

/** موجّه واحد: يختار المسار الصحيح تلقائيًّا (كان يفشل للجمعيات) */
async function recordPayment(db: DB, profile: any, id: string, mode: "one" | "all" = "one", requestKey?: string | null): Promise<{ ok: boolean; msg: string }> {
  const track = await detectTrack(db, profile);
  return track === "properties" ? payTenant(db, profile, id, mode) : payOwner(db, profile, id, requestKey);
}
export const markPaid = (db: DB, profile: any, id: string, mode: "one" | "all" = "one", requestKey?: string | null) => recordPayment(db, profile, id, mode, requestKey);
export const payTenantOldest = (db: DB, profile: any, tenantId: string, mode: "one" | "all" = "one") => recordPayment(db, profile, tenantId, mode);

/** تجديد العقد بنفس منطق اللوحة (renewContract في contracts.ts) + توثيق في السجل */
export async function renewContract(db: DB, profile: any, tenantId: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const { data: t } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (!t) return { ok: false, msg: "العقد غير موجود." };
    const { data: prop } = await db.from("properties").select("id,user_id,property_type,name").eq("id", t.property_id).maybeSingle();
    if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, msg: "غير مصرّح." };
    /* «جدّد سنة» سنةً فعلًا: كانت بمدة العقد السابق (عقد سنتين يُجدَّد سنتين) */
    const fields = renewFields(t, { periods: defaultTermPeriods((t.payment_frequency || "monthly") as Frequency) });
    const moved = Math.round(((Number((fields as any).carried_debt) || 0) - (Number(t.carried_debt) || 0)) * 100) / 100;
    const { error } = await db.from("tenants").update(fields).eq("id", tenantId);
    if (error) return { ok: false, msg: "تعذّر الحفظ: " + error.message };
    await db.from("property_notes").insert({
      property_id: prop.id, note_date: todayISO(),
      text: `تجديد عقد ${t.name} (وحدة ${t.unit || "—"}) — إلى ${fields.contract_end} بقيمة ${sar(fields.rent_amount)} ريال / ${freqShort(fields.payment_frequency as Frequency)} — عبر البوت`,
    });
    return { ok: true, msg: `تم تجديد العقد حتى ${fields.contract_end}.${moved > 0 ? ` ورُحّلت متأخرات المدة المنتهية (${sar(moved)} ريال) دينًا عليه — تسويتها من اللوحة.` : ""}` };
  } catch (e: any) { return { ok: false, msg: e.message }; }
}

/** إشعار رسمي عبر واتساب (مطالبة / عدم تجديد) */
/**
 * ما على المستأجر كما يراه في كشفه: متأخر المدة الحالية + الدين المرحَّل، شاملَين
 * الضريبة حيث تُضاف فوق الإيجار. كانت المطالبة والتذكير يذكران متأخر المدة الحالية
 * وحده: من رُحّلت عليه 8,000 عند التجديد تصله مطالبة «المبلغ المتبقي: 0».
 */
function owedFor(t: any, prop: any, st: any) {
  const v = { enabled: !!prop.vat_enabled && unitVatApplies(t, prop), rate: Number(prop.vat_rate) || 15, inclusive: prop.vat_inclusive !== false };
  const due = v.enabled ? splitVat(st.amountDue || 0, v).total : (st.amountDue || 0);
  const carried = Math.max(0, Number(t.carried_debt) || 0);
  return { due: Math.round(due * 100) / 100, carried, total: Math.round((due + carried) * 100) / 100, vat: v.enabled };
}
/* الموقِّع: المكتب لا «مدير العقار» — ذاك الحقل كان المكاتب تكتب فيه اسم المالك،
   فتصل مطالبة من المكتب موقّعة باسم المالك. كالمستندات: اسم المُصدِر أولًا. */
const signer = (profile: any, prop: any) => profile?.billing_name || profile?.org_name || prop?.manager || "إدارة الأملاك";

export async function buildNotice(db: DB, profile: any, tenantId: string, kind: "claim" | "nonrenewal"): Promise<{ ok: boolean; text: string; url?: string }> {
  try {
    const { data: t } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (!t) return { ok: false, text: "العقد غير موجود." };
    const { data: prop } = await db.from("properties")
      .select("id,user_id,name,manager,grace_days,property_type,vat_enabled,vat_rate,vat_inclusive").eq("id", t.property_id).maybeSingle();
    if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
    if (!t.phone) return { ok: false, text: `لا يوجد رقم جوال مسجّل لـ ${esc(t.name || "المستأجر")}.` };
    if (!phoneOk(normalizeSaudi(t.phone))) return { ok: false, text: `رقم جوال ${esc(t.name || "المستأجر")} غير صالح (${esc(t.phone)}) — صحّحه من اللوحة ثم أعد المحاولة.` };

    const st = contractState(t, statusWindows(prop, profile));
    const unit = t.unit ? `الوحدة (${t.unit})` : "الوحدة";
    const who = signer(profile, prop);
    const digits = normalizeSaudi(t.phone);
    const ow = owedFor(t, prop, st);
    let msg: string, title: string;

    if (kind === "claim") {
      title = "مطالبة بالسداد";
      const L = [
        `السلام عليكم ورحمة الله، ${t.name || ""}`,
        "",
        `نفيدكم بوجود مستحقّات غير مسدَّدة عن ${unit} بعقار ${prop.name || ""}:`,
        st.unpaid > 0 ? `• عدد الدفعات المتأخرة: ${st.unpaid}` : "",
        st.hasPartial ? `• المسدَّد جزئيًّا: ${sar(st.partial)} ريال` : "",
        ow.due > 0 ? `• متأخر العقد الحالي: ${sar(ow.due)} ريال${ow.vat ? " (شامل الضريبة)" : ""}` : "",
        ow.carried > 0 ? `• مستحقّات من عقد سابق: ${sar(ow.carried)} ريال` : "",
        `• إجمالي المطلوب: ${sar(ow.total)} ريال`,
        "",
        "نأمل المبادرة بالسداد خلال (5) أيام بالوسيلة المتفق عليها في العقد.",
        "وفي حال عدم السداد، سيتّخذ المؤجّر الإجراءات النظامية، ومنها إنذار رسمي عبر منصة «إيجار» ثم طلب تنفيذ عبر «ناجز».",
        "",
        "شاكرين لكم تعاونكم،",
        who,
      ].filter(Boolean);
      msg = L.join("\n");
    } else {
      title = "إشعار عدم تجديد";
      msg = [
        `السلام عليكم ورحمة الله، ${t.name || ""}`,
        "",
        `نفيدكم برغبتنا بعدم تجديد عقد إيجار ${unit} بعقار ${prop.name || ""}${st.endDate ? `، المنتهي بتاريخ ${arDate(st.endDate)}` : ""}.`,
        "ونأمل ترتيب الإخلاء وتسوية أي مستحقّات قبل ذلك التاريخ.",
        "",
        "شاكرين لكم حسن التعامل،",
        who,
      ].join("\n");
    }

    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    return { ok: true, text: `جاهز لإرسال <b>${title}</b> إلى <b>${esc(t.name || "المستأجر")}</b> — ${esc(unit)}:\n<i>خطاب إداري ودّي؛ الإنذار النظامي يُرسل عبر «إيجار».</i>`, url };
  } catch (e: any) { return { ok: false, text: "تعذّر تجهيز الإشعار: " + esc(e.message) }; }
}

/** تذكير ودّي عبر واتساب — يوضّح تفاصيل المطالبة وتاريخها */
export async function buildReminder(db: DB, profile: any, contractId: string): Promise<{ ok: boolean; text: string; url?: string }> {
  try {
    const track = await detectTrack(db, profile);
    let name = "", phone = "", unit = "", who = "", lines: string[] = [];

    if (track === "properties") {
      const { data: t } = await db.from("tenants").select("*").eq("id", contractId).maybeSingle();
      if (!t) return { ok: false, text: "المستأجر غير موجود." };
      const { data: prop } = await db.from("properties")
        .select("id,user_id,name,manager,grace_days,property_type,vat_enabled,vat_rate,vat_inclusive").eq("id", t.property_id).maybeSingle();
      if (!prop || String(prop.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
      const st = contractState(t, statusWindows(prop, profile));
      const ow = owedFor(t, prop, st);
      name = t.name || "المستأجر"; phone = t.phone || "";
      unit = t.unit ? `الوحدة (${t.unit})` : "الوحدة";
      who = signer(profile, prop);
      if (ow.total <= 0) {
        lines = [`تذكير ودّي بأن الدفعة القادمة عن ${unit} بعقار ${prop.name || ""} تستحق بتاريخ ${arDate(st.nextDueDate)}.`];
      } else {
        lines = [
          `نودّ تذكيركم بوجود مستحقّات عن ${unit} بعقار ${prop.name || ""}:`,
          st.unpaid > 0 ? `• الدفعات المتأخرة: ${st.unpaid}` : "",
          st.hasPartial ? `• المسدَّد جزئيًّا: ${sar(st.partial)} ريال` : "",
          ow.due > 0 ? `• متأخر العقد الحالي: ${sar(ow.due)} ريال${ow.vat ? " (شامل الضريبة)" : ""}` : "",
          ow.carried > 0 ? `• مستحقّات من عقد سابق: ${sar(ow.carried)} ريال` : "",
          `• إجمالي المطلوب: ${sar(ow.total)} ريال`,
          /* يعرف المستأجر متى الدفعة التالية أيضًا — فيسدّد المتبقي قبلها */
          st.upcomingDate ? `• الدفعة القادمة تستحق بتاريخ ${arDate(st.upcomingDate)}` : "",
        ].filter(Boolean);
      }
    } else {
      const { data: o } = await db.from("owners").select("*").eq("id", contractId).maybeSingle();
      if (!o) return { ok: false, text: "المالك غير موجود." };
      const { data: assoc } = await db.from("associations")
        .select("*").eq("id", o.association_id).maybeSingle();   /* * : يشمل حقول البنك (v60) إن وُجدت */
      if (!assoc || String(assoc.user_id) !== String(profile.id)) return { ok: false, text: "غير مصرّح." };
      const fee = ownerFeeOf(o, assoc);
      const partial = Number(o.partial_amount) || 0;
      const due = Math.max(0, Math.round(((Number(o.months_late) || 0) * fee - partial) * 100) / 100);
      const annual = assoc.fee_period === "annual";
      name = o.name || "المالك"; phone = o.phone || "";
      unit = o.unit ? `الوحدة (${o.unit})` : "وحدتكم";
      who = `إدارة ${assoc.name || "الجمعية"}`;
      lines = (Number(o.months_late) || 0) > 0
        ? [
            `نودّ تذكيركم بأن اشتراك الصيانة عن ${unit} لا يزال غير مسدَّد:`,
            `• الفترات المتأخرة: ${o.months_late}`,
            partial > 0 ? `• المسدَّد جزئيًّا: ${sar(partial)} ريال` : "",
            `• المبلغ المتبقّي: ${sar(due)} ريال`,
            "",
            assoc.iban
              ? `ويُسدَّد بالتحويل إلى حساب الجمعية${assoc.bank_name ? ` في ${assoc.bank_name}` : ""}${assoc.bank_account_name ? ` باسم ${assoc.bank_account_name}` : ""}:\n${assoc.iban}`
              : "ويُسدَّد المبلغ في الحساب البنكي للجمعية.",
          ].filter(Boolean)
        : (Number(o.prepaid_months) || 0) > 0 || partial > 0
          ? [`نشكركم على السداد — اشتراك الصيانة عن ${unit} مسدَّد${(Number(o.prepaid_months) || 0) > 0 ? ` مقدَّمًا لـ ${annual ? arPlural(Number(o.prepaid_months), "سنة واحدة", "سنتين", "سنوات", "سنة") : arPlural(Number(o.prepaid_months), "شهر واحد", "شهرين", "أشهر", "شهرًا")}` : ""}، ولا مستحقات عليكم حاليًّا.`]
          : [`تذكير ودّي بأن اشتراك الصيانة عن ${unit}${fee ? ` وقدره ${sar(fee)} ريال ${annual ? "سنويًّا" : "شهريًّا"}` : ""} يُستحق مع بداية ${annual ? "السنة المالية للجمعية" : "الشهر"}.`];
    }

    if (!phone) return { ok: false, text: `لا يوجد رقم جوال مسجّل لـ ${esc(name)}.` };
    const digits = normalizeSaudi(phone);
    if (!phoneOk(digits)) return { ok: false, text: `رقم جوال ${esc(name)} غير صالح (${esc(phone)}) — صحّحه من اللوحة ثم أعد المحاولة.` };
    const msg = [
      `السلام عليكم ورحمة الله، ${name}`, "",
      ...lines, "",
      "فإن كان السداد قد تم فنعتذر عن التذكير، ونرجو تزويدنا بما يفيد.",
      "", "شاكرين لكم حسن تعاونكم،", who,
    ].join("\n");
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    return { ok: true, text: `جاهز لتذكير <b>${esc(name)}</b> — ${esc(unit)} عبر واتساب:`, url };
  } catch (e: any) { return { ok: false, text: "تعذّر تجهيز التذكير: " + esc(e.message) }; }
}

export { stateLabel, esc };
