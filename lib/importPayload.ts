/**
 * حمولة حفظ رفع الإكسل (16 نوفمبر 2026) — كانت مبنية داخل ImportView فلا يختبرها شيء،
 * وهناك وقع عطل 14 نوفمبر (صف شاغر واحد ⇒ status = null لكل الدفعة ⇒ فشل الملف كله).
 *
 * قاعدة الإدراج الجماعي في PostgREST: أعمدة الطلب = اتحاد مفاتيح الصفوف، والمفتاح
 * الغائب عن صف (أو قيمته undefined) يُحفظ NULL — لا القيمة الافتراضية. لذلك:
 *   • كل صف في الدفعة الواحدة بالمفاتيح نفسها تمامًا (importPayloadProblems يتحقق).
 *   • لا NULL في عمود NOT NULL (status/calendar/vat_mode/carried_debt/name/property_id).
 *   • قيم القيود: calendar، vat_mode، status، 0–50 للغرف، carried_debt ≥ 0، phone2 ≤ 30.
 */
import { derivedEndDate, parseDate } from "./contracts";
import { PHONE2_MAX, type Row } from "./importParse";

/** عدد الغرف/دورات المياه/المكيفات كما تقبله القاعدة: صحيح بين 0 و50، وإلا فارغ */
export const clampCount = (n: any): number | null => {
  const v = Number(n);
  return n == null || n === "" || !isFinite(v) ? null : Math.max(0, Math.min(50, Math.round(v)));
};

export type ImportOpts = { dueChoice: string | null; today: string };
export type TenantInsert = Record<string, any>;
export type CoveredInsert = TenantInsert & { _cover: string };

/** صف ملف ⇒ صف tenants. المفاتيح ثابتة لكل الصفوف (شاغرة أو مؤجَّرة أو ضمن عقد). */
export function tenantInsertRow(r: Row, pid: string, o: ImportOpts): TenantInsert {
  const dropDue = !!r._due && o.dueChoice === "drop";
  const debt = r.carried_debt && r.carried_debt > 0 ? r.carried_debt : 0;
  const phone2 = (r.phone2 || "").trim().slice(0, PHONE2_MAX) || null;   // حزام أمان — splitPhones يعالجه قبلها
  const row: TenantInsert = {
    property_id: pid,
    name: r.name, unit: r.unit || null, phone: r.phone || null, phone2, national_id: r.national_id || null,
    rent_amount: r.rent_amount, contract_start: r.contract_start || null,
    payment_frequency: r.payment_frequency, contract_periods: r.contract_periods ?? null,
    /* بتقويم العقد لا ميلاديًّا دائمًا: عقد هجري كان يُحفظ بنهاية متأخرة 11 يومًا */
    contract_end: r.contract_start
      ? derivedEndDate(r.contract_start, r.payment_frequency, r.contract_periods, null, r.calendar === "hijri" ? "hijri" : "gregorian")
      : null,
    paid_periods: r.paid_periods || 0,
    /* (20 أكتوبر 2026) الجزئي المدفوع قبل وثيق رصيد افتتاحي — لا يُسجَّل نقدًا بتاريخ اليوم */
    partial_amount: r.partial_amount && r.partial_amount > 0 ? r.partial_amount : 0,
    /* يوم المرساة كالإدخال اليدوي: من «أول استحقاق» إن وُجد، وإلا من البداية */
    billing_anchor_day: (r.first_due && !dropDue) ? parseDate(r.first_due).getDate()
      : r.contract_start ? parseDate(r.contract_start).getDate() : null,
    calendar: r.calendar === "hijri" ? "hijri" : "gregorian",
    carried_debt: debt,
    /* (16 نوفمبر 2026) كان المفتاح يُضاف للصف ذي الدين وحده — يصير NULL لبقية الدفعة.
       لا ضرر اليوم (العمود يقبل NULL) لكنه النمط نفسه الذي أسقط الملف في 14 نوفمبر. */
    carried_debt_note: debt > 0 ? "رصيد سابق من ملف الرفع" : null,
    first_due: dropDue ? null : (r.first_due || null),
    /* vat_mode NOT NULL افتراضه 'auto' (11 أكتوبر 2026) */
    unit_type: r.unit_type || null, vat_mode: r.vat_mode === "on" || r.vat_mode === "off" ? r.vat_mode : "auto",
    contract_no: r.contract_no || null, elec_account: r.elec_account || null, water_account: r.water_account || null,
    rooms: clampCount(r.rooms), baths: clampCount(r.baths), acs: clampCount(r.acs),
    /* (14 نوفمبر 2026) status وmove_out_date في كل صف لا في الشاغر وحده */
    status: "active", move_out_date: null,
  };
  /* (13 نوفمبر 2026) صف بلا مستأجر ⇒ وحدة شاغرة كما يُنشئها «إضافة وحدات شاغرة» —
     يُكتب فوق المفاتيح نفسها، لا يضيف مفتاحًا جديدًا */
  if (r._vacant) Object.assign(row, {
    name: "شاغرة", status: "vacated", move_out_date: o.today, contract_start: null, contract_end: null,
    payment_frequency: "monthly", billing_anchor_day: null, rent_amount: 0, paid_periods: 0, partial_amount: 0,
    first_due: null, contract_periods: null,
    /* الدين المرحَّل يبقى كما في الملف: دين مستأجر سابق على وحدة صارت شاغرة لا يُمسح بصمت */
  });
  return row;
}

/**
 * صفوف عقار واحد ⇒ { main: تُدرَج أولًا، covered: «ضمن عقد» تُدرَج بعدها بـcovered_by }.
 * covered تحمل _cover (رقم الوحدة الرئيسية) ليُستبدل بمعرّفها بعد إدراج main.
 */
export function buildImportPayload(fresh: Row[], pid: string, o: ImportOpts): { main: TenantInsert[]; covered: CoveredInsert[] } {
  const main: TenantInsert[] = [], covered: CoveredInsert[] = [];
  for (const r of fresh) {
    const row = tenantInsertRow(r, pid, o);
    if (r._cover) covered.push({ ...row, _cover: r._cover }); else main.push(row);
  }
  return { main, covered };
}

/** «ضمن عقد» بعد إدراج الرئيسية: _cover ⇒ covered_by (كل الصفوف بالمفاتيح نفسها) */
export function resolveCovered(covered: CoveredInsert[], leadIdByUnitKey: (unit: string) => string | undefined): { rows: TenantInsert[]; missing: number } {
  const rows = covered.map(({ _cover, ...rest }) => ({ ...rest, covered_by: leadIdByUnitKey(_cover) || null }));
  return { rows, missing: rows.filter((x) => !x.covered_by).length };
}

export const NOT_NULL_COLS = ["property_id", "name", "status", "calendar", "vat_mode", "carried_debt"] as const;

/**
 * فحص ما سيرفضه Postgres قبل الإرسال — يُستدعى في الاختبار، وفي الواجهة قبل كل دفعة
 * فيظهر للمكتب سطر واضح بدل «null value in column …» بعد نصف ملف.
 */
export function importPayloadProblems(batch: TenantInsert[]): string[] {
  const out: string[] = [];
  if (!batch.length) return out;
  const sig = (o: TenantInsert) => Object.keys(o).sort().join(",");
  const s0 = sig(batch[0]);
  batch.forEach((r, i) => {
    const where = `الصف ${i + 1}${r.unit ? ` (${r.unit})` : ""}`;
    if (sig(r) !== s0) out.push(`${where}: مفاتيح مختلفة عن بقية الدفعة`);
    for (const c of NOT_NULL_COLS) if (r[c] === null || r[c] === undefined || r[c] === "") out.push(`${where}: ${c} فارغ`);
    Object.entries(r).forEach(([k, v]) => { if (v === undefined) out.push(`${where}: ${k} = undefined (يُحفظ NULL)`); });
    if (!["active", "vacated"].includes(r.status)) out.push(`${where}: status غير صالح «${r.status}»`);
    if (!["gregorian", "hijri"].includes(r.calendar)) out.push(`${where}: calendar غير صالح «${r.calendar}»`);
    if (!["auto", "on", "off"].includes(r.vat_mode)) out.push(`${where}: vat_mode غير صالح «${r.vat_mode}»`);
    if (!(Number(r.carried_debt) >= 0)) out.push(`${where}: carried_debt سالب`);
    for (const c of ["rooms", "baths", "acs"]) {
      const v = r[c];
      if (v !== null && v !== undefined && !(Number.isInteger(v) && v >= 0 && v <= 50)) out.push(`${where}: ${c} خارج 0–50`);
    }
    if (r.phone2 && String(r.phone2).length > PHONE2_MAX) out.push(`${where}: phone2 أطول من ${PHONE2_MAX}`);
    if (r.status === "vacated" && (r.contract_start || r.contract_end)) out.push(`${where}: شاغرة بتواريخ عقد`);
    if ("covered_by" in r && r.covered_by && Number(r.rent_amount) !== 0) out.push(`${where}: ضمن عقد بإيجار غير صفري`);
    if (r.contract_start && r.contract_end && r.contract_end < r.contract_start) out.push(`${where}: نهاية العقد قبل بدايته`);
  });
  return out;
}
