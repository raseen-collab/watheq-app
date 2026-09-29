// ============================================================
// وثيق — محلّل ملفات رفع الوحدات (Excel/CSV) — دوال نقية بلا React ولا Supabase
//
// فُصل عن ImportView (30 سبتمبر 2026) ليُختبر مباشرة، ولتقرأه ورقة «قالب الرفع»
// في التصدير من المصدر نفسه — فلا يعود ترتيب الأعمدة يختلف بين الطرفين.
// ============================================================
import { firstDueGap, type Frequency } from "./contracts";
import { parseHijriInput } from "./hijri";

// العمود التاسع «الدفعات المسدّدة» اختياري: بدونه يُعدّ العقد لم يُسدَّد منه شيء —
// وهذا كارثة لمكتب ينقل عقودًا قائمة (عقد من يناير يُرفع في سبتمبر = 8 «متأخرات» وهمية).
// القوالب القديمة بثمانية أعمدة تبقى تعمل: الغائب = 0.
export const HEADERS = ["اسم المستأجر", "رقم الوحدة", "قيمة الدفعة", "دورة السداد", "بداية العقد", "عدد الدفعات", "الجوال", "رقم الهوية", "الدفعات المسدّدة", "العقار", "حساب الكهرباء", "حساب الماء", "رقم العقد", "نوع الوحدة", "الغرف", "دورات المياه", "المكيفات", "أول استحقاق", "الضريبة", "التقويم", "مدة العقد (أشهر)", "دين مرحَّل"];
// عمود عاشر اختياري «العقار»: ملف واحد لكل المحفظة بدل ملف لكل عقار — مكتب بـ40
// عقارًا لا يرفع 40 مرة. الاسم يجب أن يطابق عقارًا موجودًا؛ الصف الفارغ يذهب للعقار المختار.

/** مفاتيح الحقول بترتيب HEADERS نفسه — الترتيب هو القراءة الموضعية للقوالب القديمة */
export const FIELDS = ["name", "unit", "rent", "freq", "start", "periods", "phone", "nid", "paid", "prop", "elec", "water", "contract_no", "unit_type", "rooms", "baths", "acs", "first_due", "vat", "calendar", "months", "carried"] as const;
export type Field = typeof FIELDS[number];

/** عمود الملاحظة في القالب — يحمل علامة «مثال» ولا يُستورد */
export const NOTE_HEADER = "ملاحظة (لا تُستورد)";
export const EXAMPLE_MARK = "مثال — احذف هذا الصف";

export type Prop = { id: string; name: string; property_type: string | null };
export type Row = {
  name: string; unit: string; rent_amount: number; phone: string; national_id: string;
  contract_start: string; payment_frequency: Frequency; contract_periods: number | null;
  paid_periods: number;
  elec_account?: string; water_account?: string; contract_no?: string; calendar?: string;
  unit_type?: string; rooms?: number; baths?: number; acs?: number; first_due?: string; vat_mode?: string; carried_debt?: number;
  prop_name?: string;
  prop_id?: string;
  _error?: string;
  /** تنبيه لا يمنع الرفع: بداية مستقبلية بلا دفعات — غالبًا موعد الدفعة القادمة لا بداية العقد */
  _warn?: string;
  /** «أول استحقاق» يختلف عن بداية العقد — يُسأل عنه المكتب قبل الحفظ (30 سبتمبر 2026) */
  _due?: string;
  /** الوحدة موجودة أصلًا في العقار الهدف — تُعامل كخطأ ولا تُرفع (30 سبتمبر 2026) */
  _exists?: string;
};

const FREQ_MAP: Record<string, Frequency> = {
  "يومي": "daily", "اسبوعي": "weekly", "شهري": "monthly",
  "ربع سنوي": "quarterly", "كل 3 اشهر": "quarterly", "ربعي": "quarterly", "كل ثلاثة اشهر": "quarterly",
  /* الثلث السنوي: المكتب يكتبها بصيغ كثيرة — نقبلها كلها */
  "كل 4 اشهر": "trimester", "كل اربعة اشهر": "trimester", "ثلث سنوي": "trimester",
  "ثلاث دفعات": "trimester", "3 دفعات": "trimester", "كل ٤ اشهر": "trimester",
  "نصف سنوي": "semiannual", "كل 6 اشهر": "semiannual", "نصفي": "semiannual", "كل ستة اشهر": "semiannual",
  "سنوي": "annual", "سنويا": "annual",
  daily: "daily", weekly: "weekly", monthly: "monthly",
  quarterly: "quarterly", trimester: "trimester", semiannual: "semiannual", annual: "annual", yearly: "annual",
};

/**
 * توحيد الكتابة العربية قبل المطابقة. المكتب يكتب «كل 3 أشهر» و«نصف سنوى»
 * و«شهرى» — وأي اختلاف بهمزة أو ألف مقصورة كان يسقط إلى «شهري» بصمت،
 * فيتحوّل عقد ربع سنوي بـ18,000 إلى شهري ويظهر المستأجر متأخرًا بعشرات
 * الآلاف. التوحيد يزيل التشكيل والتطويل ويوحّد الهمزات والياء والتاء.
 */
export function arKey(v: string): string {
  return String(v || "")
    .replace(/[ً-ْٰـ]/g, "")   // تشكيل وتطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
const UNIT_TYPE_KEY: Record<string, string> = Object.fromEntries(Object.entries({
  "شقة": "apartment", "شقة ملحق": "annex", "ملحق": "annex", "استديو": "studio", "ستوديو": "studio", "استوديو": "studio",
  "غرفة": "room", "محل": "shop", "مكتب": "office", "مستودع": "warehouse", "أرض": "land", "فيلا": "villa",
  /* «أخرى» يصدّرها التصدير نفسه — كانت تضيع عند إعادة الرفع (30 سبتمبر 2026) */
  "أخرى": "other",
}).map(([k, v]) => [arKey(k), v]));
const FREQ_LOOKUP: Record<string, Frequency> = Object.fromEntries(
  Object.entries(FREQ_MAP).map(([k, v]) => [arKey(k), v]),
) as Record<string, Frequency>;

/** تحويل الأرقام العربية (والفارسية) إلى لاتينية */
export const toEnDigits = (s: string) => String(s ?? "")
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

/* علامات الاتجاه الخفية (RLM/LRM) تلتصق بالتواريخ والجوالات المنسوخة من
   مستند عربي، فيفشل «١٤٤٧/٠٣/١٥» وهو سليم في العين (30 سبتمبر 2026) */
const cleanCell = (v: unknown) => String(v ?? "")
  .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
  .replace(/ /g, " ")
  .trim();

/**
 * قراءة رقم من نص كتبه إنسان: «8 دفعات» = 8، «2,500 ريال» = 2500،
 * «2500٫50» = 2500.5 (الفاصلة العشرية العربية)، «٢٬٥٠٠» = 2500.
 * كان Number("8 دفعات") = NaN يسقط إلى 0 بصمت — فيُرفع عقد مسدَّد 8 دفعات
 * كأنه لم يُسدَّد شيئًا (30 سبتمبر 2026). يعيد NaN إن لم يوجد رقم إطلاقًا.
 */
export function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  let s = toEnDigits(cleanCell(v))
    .replace(/٫/g, ".")            // الفاصلة العشرية العربية
    .replace(/[٬']/g, "")           // فاصل الآلاف العربي
    .replace(/(\d)\s+(?=\d{3}(?!\d))/g, "$1");  // «2 500»
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");  // 2,500 و1,250,000
  s = s.replace(/(\d)[,،](?=\d{1,2}(?!\d))/g, "$1.");  // 2500,50 = عشري
  const m = /\d+(?:\.\d+)?/.exec(s);
  return m ? Number(m[0]) : NaN;
}

/** هل التاريخ حقيقي فعلًا؟ 2026-02-31 و2026-13-45 يمرّان بالشكل ويفشلان هنا */
export function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2100) return false;
  return d <= new Date(y, mo, 0).getDate();
}

export function normalizeDate(v: string): string {
  const s = toEnDigits(cleanCell(v)).replace(/\s*(م|ميلادي)$/, "");
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const p = (n: string | number) => String(n).padStart(2, "0");
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return `${m[1]}-${p(m[2])}-${p(m[3])}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${p(m[2])}-${p(m[1])}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** تاريخ هجري أولًا (السنة 1300–1600 تحسمه) ثم ميلادي */
function parseAnyDate(v: string): { iso: string; hijri: boolean } {
  const c = cleanCell(v);
  const h = parseHijriInput(c);
  if (h) return { iso: h, hijri: true };
  return { iso: normalizeDate(c), hijri: false };
}

/** قارئ CSV بسيط يدعم علامات الاقتباس */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

/**
 * صفوف SheetJS الخام (raw:true) → نصوص. كائن التاريخ يُحوَّل بالمكوّنات المحلية
 * لا toISOString حتى لا ينزاح يومًا مع فارق التوقيت.
 */
export function gridFromSheetRows(rows: any[][]): string[][] {
  const pad = (n: number) => String(n).padStart(2, "0");
  return rows.map((r) => (r || []).map((c) => {
    if (c instanceof Date && !isNaN(c.getTime()))
      return `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())}`;
    return String(c ?? "").trim();
  }));
}

/* ---------- مطابقة الأعمدة بالاسم ---------- */

/**
 * مفتاح عنوان العمود: توحيد عربي + حذف ما بين الأقواس «(اختياري)» ونحوه،
 * وحذف «ال» التعريف من أول كل كلمة — فـ«الجوال» = «جوال» و«رقم الوحدة» = «رقم وحده».
 */
export function headerKey(v: string): string {
  return arKey(cleanCell(v))
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/اختياري|مطلوب|optional|required/g, " ")
    .replace(/[*:：\-_.،,؟?]/g, " ")
    .split(/\s+/).filter(Boolean)
    .map((w) => w.length > 3 ? w.replace(/^ال/, "") : w)
    .join(" ");
}

/* مرادفات العناوين: المكاتب تعيد تسمية الأعمدة، وملفات أنظمة أخرى تأتي بأسمائها */
const SYNONYMS: Record<Field, string[]> = {
  name: ["اسم المستأجر", "المستأجر", "الاسم", "اسم", "اسم العميل", "name", "tenant", "tenant name"],
  unit: ["رقم الوحدة", "الوحدة", "رقم الشقة", "الشقة", "unit", "unit no"],
  rent: ["قيمة الدفعة", "الدفعة", "مبلغ الدفعة", "الإيجار", "قيمة الإيجار", "مبلغ الإيجار", "rent", "amount"],
  freq: ["دورة السداد", "الدورة", "دورية السداد", "طريقة السداد", "نظام السداد", "frequency"],
  start: ["بداية العقد", "تاريخ البداية", "تاريخ بداية العقد", "البداية", "بداية", "start", "start date", "contract start"],
  periods: ["عدد الدفعات", "الدفعات", "periods"],
  phone: ["الجوال", "جوال", "رقم الجوال", "الهاتف", "رقم الهاتف", "جوال المستأجر", "phone", "mobile"],
  nid: ["رقم الهوية", "الهوية", "رقم الهوية/السجل", "رقم السجل", "national id", "id"],
  paid: ["الدفعات المسدّدة", "المسدد", "دفعات مسددة", "عدد الدفعات المسددة", "المسدد دفعات", "paid", "paid periods"],
  prop: ["العقار", "اسم العقار", "العمارة", "property"],
  elec: ["حساب الكهرباء", "رقم حساب الكهرباء", "الكهرباء", "عداد الكهرباء"],
  water: ["حساب الماء", "حساب المياه", "رقم حساب الماء", "الماء", "المياه", "عداد الماء"],
  contract_no: ["رقم العقد", "contract no"],
  unit_type: ["نوع الوحدة", "النوع"],
  rooms: ["الغرف", "عدد الغرف"],
  baths: ["دورات المياه", "عدد دورات المياه", "الحمامات"],
  acs: ["المكيفات", "عدد المكيفات"],
  first_due: ["أول استحقاق", "تاريخ أول استحقاق", "أول دفعة"],
  vat: ["الضريبة", "ضريبة القيمة المضافة", "vat"],
  calendar: ["التقويم", "calendar"],
  months: ["مدة العقد (أشهر)", "مدة العقد بالأشهر", "مدة العقد", "المدة بالأشهر"],
  carried: ["دين مرحَّل", "الدين المرحل", "رصيد سابق", "متأخرات سابقة"],
};
export const HEADER_LOOKUP: Record<string, Field> = (() => {
  const out: Record<string, Field> = {};
  (Object.keys(SYNONYMS) as Field[]).forEach((f) => {
    for (const s of SYNONYMS[f]) out[headerKey(s)] = f;
  });
  FIELDS.forEach((f, i) => { out[headerKey(HEADERS[i])] = f; });
  return out;
})();

export type ColumnInfo = {
  mode: "headers" | "position";
  /** العناوين التي فُهمت (كما كُتبت في الملف) */
  recognized: string[];
  /** عناوين موجودة لم تُفهم فتُجوهلت */
  ignored: string[];
  /** صفوف «مثال» من القالب تُجوهلت */
  examples: number;
};

/**
 * خريطة الأعمدة: بالاسم إن كان الصف الأول عناوين نعرفها (3 على الأقل)، وإلا
 * بالموضع كالقوالب القديمة. القراءة بالموضع وحدها كانت تُلبس القيم أعمدة
 * غيرها متى أعاد المكتب ترتيب الأعمدة أو رفع ملفًّا من برنامج آخر (30 سبتمبر 2026).
 */
export function detectColumns(first: string[]): { map: Partial<Record<Field, number>>; headerRow: boolean; info: Omit<ColumnInfo, "examples"> } {
  const map: Partial<Record<Field, number>> = {};
  const recognized: string[] = [], ignored: string[] = [];
  first.forEach((c, i) => {
    const raw = cleanCell(c);
    if (!raw) return;
    const f = HEADER_LOOKUP[headerKey(raw)];
    if (f && map[f] === undefined) { map[f] = i; recognized.push(raw); }
    else ignored.push(raw);
  });
  if (Object.keys(map).length >= 3) return { map, headerRow: true, info: { mode: "headers", recognized, ignored } };
  // بالموضع: صف العناوين (إن وُجد) يُتخطّى كما كان
  const pos: Partial<Record<Field, number>> = {};
  FIELDS.forEach((f, i) => { pos[f] = i; });
  const headerRow = first.some((c) => String(c).includes("اسم") || String(c).toLowerCase().includes("name"));
  return { map: pos, headerRow, info: { mode: "position", recognized: [], ignored: [] } };
}

/** صف أمثلة القالب: خلية فيها «مثال — احذف هذا الصف» (أو ما يطابقها بعد التوحيد) */
const EX_KEY = arKey(EXAMPLE_MARK).replace(/[—–-]/g, " ").replace(/\s+/g, " ");
export function isExampleRow(r: string[]): boolean {
  return r.some((c) => {
    const k = arKey(cleanCell(c)).replace(/[—–-]/g, " ").replace(/\s+/g, " ").trim();
    return k === EX_KEY || (/^مثال\b/.test(k) && k.includes("احذف"));
  });
}

const PER_YEAR: Record<string, number> = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, trimester: 3, semiannual: 2, annual: 1 };

/** مفتاح رقم الوحدة للمقارنة: «١٠١» = «101» و«شقة 1» = «شقه 1» */
export const unitKey = (u: string) => arKey(cleanCell(u));

/**
 * تحليل الشبكة كاملة إلى صفوف جاهزة للمعاينة. O(n) — ملف 2000 صف لا يتباطأ:
 * العقارات في Map، والتكرار في Map.
 */
export function parseGrid(grid: string[][], properties: Prop[], todayIso: string): { rows: Row[]; info: ColumnInfo } {
  const nonEmpty = grid.filter((r) => (r || []).some((c) => cleanCell(c)));
  if (!nonEmpty.length) return { rows: [], info: { mode: "position", recognized: [], ignored: [], examples: 0 } };
  const { map, headerRow, info } = detectColumns(nonEmpty[0].map(String));
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  const propByName = new Map<string, Prop>();
  properties.forEach((p) => { if (!propByName.has(norm(p.name))) propByName.set(norm(p.name), p); });

  let examples = 0;
  const rows: Row[] = [];
  for (const r of nonEmpty.slice(headerRow ? 1 : 0)) {
    if (isExampleRow(r)) { examples++; continue; }
    const g = (f: Field) => { const i = map[f]; return i === undefined ? "" : cleanCell(r[i]); };
    const [name, unit, rent, freq, startDate, periods, phoneRaw, nid, paid, propName] =
      [g("name"), g("unit"), g("rent"), g("freq"), g("start"), g("periods"), g("phone"), g("nid"), g("paid"), g("prop")];
    const [elecAcc, waterAcc, contractNo, unitTypeTxt, roomsTxt, bathsTxt, acsTxt, firstDueTxt, vatTxt, calTxt, monthsTxt, carriedTxt] =
      [g("elec"), g("water"), g("contract_no"), g("unit_type"), g("rooms"), g("baths"), g("acs"), g("first_due"), g("vat"), g("calendar"), g("months"), g("carried")];

    const rentN0 = parseNum(rent);
    const rentN = isNaN(rentN0) ? 0 : rentN0;
    const fk = arKey(freq);
    const frequency: Frequency = FREQ_LOOKUP[fk] || "monthly";
    const freqUnknown = !!freq && !FREQ_LOOKUP[fk];
    /* المكاتب السعودية تكتب العقود بالهجري. نجرّب الهجري أولًا (السنة
       1300–1600 تحسمه بلا لبس) ثم الميلادي — فيقبل الملف الصيغتين معًا. */
    const st = parseAnyDate(startDate);
    const cs = st.iso;
    /* التقويم: العمود الصريح يتقدّم على الاكتشاف — مكتب قد يكتب تواريخه
       ميلادية بينما عقوده هجرية، فيحدّده هنا ولا نخمّن نيابةً عنه. */
    const calTxtN = arKey(calTxt);
    const calendar = /هجري|hijri/i.test(calTxtN) ? "hijri"
      : /ميلادي|gregorian/i.test(calTxtN) ? "gregorian"
      : st.hijri ? "hijri" : "gregorian";
    /* «مدة العقد بالأشهر» بديل مريح عن «عدد الدفعات»: عقد سنتين نصف سنوي
       = 4 دفعات، وحسابها بيد المكتب مصدر خطأ. العمود الصريح يتقدّم. */
    const monthsN = monthsTxt ? parseNum(monthsTxt) : 0;
    const prFromMonths = monthsN > 0 ? Math.max(1, Math.round(monthsN * (PER_YEAR[frequency] || 12) / 12)) : null;
    const prN = periods ? parseNum(periods) : NaN;
    const pr = (prN > 0 ? prN : null) || prFromMonths;
    const paidN = paid ? parseNum(paid) : 0;
    const pd = isNaN(paidN) ? 0 : Math.max(0, Math.floor(paidN));
    const carriedN = carriedTxt ? parseNum(carriedTxt) : NaN;
    const fd = firstDueTxt ? parseAnyDate(firstDueTxt).iso : "";
    const intOk = (n: number) => !isNaN(n) && Number.isInteger(n);

    let err = "";
    if (!name) err = "الاسم مفقود";
    else if (!rent) err = "قيمة الدفعة مفقودة";
    else if (isNaN(rentN0)) err = `قيمة الدفعة غير مفهومة: «${rent}» — اكتب رقمًا مثل 2500`;
    else if (!rentN) err = "قيمة الدفعة مفقودة";
    else if (startDate && !cs) err = "تاريخ غير مفهوم";
    // لا نمرّر تاريخًا مستحيلًا (2026-13-45): كان يُحفظ كما هو ويفسد كل الحسابات
    else if (cs && !isRealDate(cs)) err = `تاريخ غير صحيح: ${startDate}`;
    else if (freqUnknown) err = `دورة سداد غير معروفة: «${freq}» — استخدم القائمة المنسدلة في القالب`;
    else if (!freq) err = "دورة السداد مفقودة";
    /* خانة غير فارغة لا رقم فيها = خطأ صريح، لا صفر صامت (30 سبتمبر 2026) */
    else if (periods && !intOk(prN)) err = `«عدد الدفعات» غير مفهوم: «${periods}» — اكتب رقمًا صحيحًا مثل 12`;
    else if (paid && !intOk(paidN)) err = `«الدفعات المسدّدة» غير مفهومة: «${paid}» — اكتب رقمًا صحيحًا مثل 8`;
    else if (monthsTxt && isNaN(monthsN)) err = `«مدة العقد» غير مفهومة: «${monthsTxt}» — اكتب عدد الأشهر مثل 12`;
    else if (carriedTxt && isNaN(carriedN)) err = `«دين مرحَّل» غير مفهوم: «${carriedTxt}» — اكتب المبلغ رقمًا`;
    else if (firstDueTxt && !(fd && isRealDate(fd))) err = `«أول استحقاق» غير مفهوم: ${firstDueTxt}`;
    else if (pr && pd > pr) err = "الدفعات المسدّدة أكثر من عدد دفعات العقد";
    const target = propName ? propByName.get(norm(propName)) : undefined;
    if (propName && !target && !err) err = `العقار «${propName}» غير موجود — أنشئه أولًا أو صحّح الاسم`;

    /* جوال حُفظ رقمًا في إكسل (سقط صفره) يُعاد صفره — أشهر تلف يصيب الجوالات */
    let phone = toEnDigits(phoneRaw);
    if (/^5\d{8}$/.test(phone.replace(/\D/g, ""))) phone = "0" + phone.replace(/\D/g, "");
    const optInt = (t: string) => { if (!t) return undefined; const n = parseNum(t); return isNaN(n) ? 0 : n; };
    const vatK = arKey(vatTxt);
    /* كانت /on/ تطابق «none» و«إلكتروني» — الآن قيم صريحة فقط (30 سبتمبر 2026) */
    const vat_mode = !vatK ? undefined
      : /معف|بدون|(^|\s)لا(\s|$)|^(off|no|exempt)$/.test(vatK) ? "off"
      : /تطبق|خاضع|^نعم$|^(on|yes)$/.test(vatK) ? "on" : undefined;

    rows.push({
      name, unit, rent_amount: rentN, phone, national_id: toEnDigits(nid),
      contract_start: cs, payment_frequency: frequency, contract_periods: pr, paid_periods: pd,
      elec_account: toEnDigits(elecAcc) || undefined, water_account: toEnDigits(waterAcc) || undefined,
      contract_no: contractNo || undefined, calendar,
      unit_type: UNIT_TYPE_KEY[arKey(unitTypeTxt)] || undefined,
      rooms: optInt(roomsTxt), baths: optInt(bathsTxt), acs: optInt(acsTxt),
      first_due: fd || undefined,
      vat_mode,
      carried_debt: carriedTxt ? Math.max(0, isNaN(carriedN) ? 0 : carriedN) : undefined,
      prop_name: propName || undefined, prop_id: target?.id,
      _error: err || undefined,
      /* بيانات المكاتب: 11% من العقود أُدخلت ببداية مستقبلية وعدّاد صفر — «موعد
         الدفعة القادمة» في خانة «بداية العقد». لا يُمنع (العقد الجديد مشروع)
         لكن يُنبَّه قبل الرفع، حين يكون التصحيح في الملف نفسه أسهل. */
      _warn: !err && cs && cs > todayIso && !(pd > 0)
        ? "البداية بعد اليوم ولا دفعات — إن كان العقد ساريًا من قبل فاكتب بدايته الفعلية من العقد وعدد الدفعات المسدَّدة، لا موعد الدفعة القادمة"
        : undefined,
    });
  }

  /* «أول استحقاق» يختلف عن البداية: مكتبان كتباه لمستأجرين يدفعون يوم بداية العقد،
     فانزاح يوم الدفع الشهري. نصف الأثر لكل صفّ ونطلب قرارًا صريحًا قبل الحفظ. */
  rows.forEach((r) => {
    if (r._error) return;
    const g = firstDueGap(r.contract_start, r.first_due);
    if (!g) return;
    r._due = `أول استحقاق ${r.first_due} — ${g.days > 0 ? `بعد ${g.days} يومًا` : `قبل ${-g.days} يومًا`} من البداية`
      + (g.dueDay !== g.startDay ? `، يوم الدفع ${g.dueDay} بدل ${g.startDay}` : "");
  });

  /**
   * تكرار داخل الملف نفسه: 160 صفًّا مكتوبة يدويًّا فيها عادةً وحدة مكرّرة.
   * نعلّمها قبل الحفظ لا بعده — الاكتشاف بعد الرفع يعني بحثًا يدويًّا في اللوحة.
   */
  const k = (r: Row) => `${r.prop_id || (r.prop_name || "").trim()}|${unitKey(r.unit)}`;
  const seenInFile = new Map<string, number>();
  rows.forEach((r) => { if (r.unit) seenInFile.set(k(r), (seenInFile.get(k(r)) || 0) + 1); });
  rows.forEach((r) => {
    if (r._error || !r.unit) return;
    if ((seenInFile.get(k(r)) || 0) > 1) r._error = `رقم الوحدة «${r.unit}» مكرّر في الملف`;
  });

  return { rows, info: { ...info, examples } };
}

/**
 * الوحدات الموجودة أصلًا في العقار الهدف تُعلَّم قبل الحفظ. المطابقة كانت
 * (الوحدة + الاسم) فقط، فمن صحّح إملاء اسم وأعاد الرفع ضاعف الوحدة (30 سبتمبر 2026).
 * existing: مفاتيح `${property_id}|${unitKey(unit)}`.
 */
export function markExisting(rows: Row[], selectedPropId: string, existing: Set<string>, propName: (id: string) => string): Row[] {
  return rows.map((r) => {
    const { _exists: _old, ...base } = r;
    if (base._error || !base.unit) return base;
    const pid = base.prop_id || selectedPropId;
    if (pid && existing.has(`${pid}|${unitKey(base.unit)}`))
      return { ...base, _exists: `الوحدة «${base.unit}» موجودة أصلًا في «${propName(pid)}» — لن تُرفع مرة ثانية؛ عدّلها من اللوحة` };
    return base;
  });
}

/** صفوف قالب الرفع بترتيب HEADERS تمامًا — يستعملها التصدير (ورقة «قالب الرفع») */
export function templateRow(cells: Partial<Record<Field, string | number>>): (string | number)[] {
  return FIELDS.map((f) => cells[f] ?? "");
}

const EXPORT_FREQ_AR: Record<string, string> = {
  daily: "يومي", weekly: "اسبوعي", monthly: "شهري", quarterly: "كل 3 اشهر", trimester: "كل 4 اشهر",
  semiannual: "نصف سنوي", annual: "سنوي", yearly: "سنوي",
};
const EXPORT_UNIT_AR: Record<string, string> = { apartment: "شقة", annex: "شقة ملحق", studio: "استديو", room: "غرفة", shop: "محل", office: "مكتب", warehouse: "مستودع", land: "أرض", villa: "فيلا", other: "أخرى" };

/**
 * صف مستأجر من القاعدة → خانات قالب الرفع. هنا لا في التصدير: الطرفان (التصدير
 * والرفع) يقرآن التعريف نفسه، والاختبار يمرّ عليه ذهابًا وإيابًا (30 سبتمبر 2026).
 */
export function tenantTemplateCells(t: any, propName: string): Partial<Record<Field, string | number>> {
  return {
    name: t.name, unit: t.unit || "", rent: t.rent_amount,
    freq: EXPORT_FREQ_AR[t.payment_frequency] || t.payment_frequency || "شهري",
    start: t.contract_start || "", periods: t.contract_periods || "",
    phone: t.phone || "", nid: t.national_id || "",
    paid: t.paid_periods || 0, prop: propName,
    elec: t.elec_account || "", water: t.water_account || "",
    contract_no: t.contract_no || "", unit_type: EXPORT_UNIT_AR[t.unit_type] || "",
    rooms: t.rooms ?? "", baths: t.baths ?? "", acs: t.acs ?? "",
    first_due: t.first_due || "",
    vat: t.vat_mode === "on" ? "تُطبَّق" : t.vat_mode === "off" ? "معفاة" : "تلقائي",
    /* التقويم والدين المرحَّل: بدونهما تعود العقود الهجرية ميلادية وتختفي ديون سابقة */
    calendar: t.calendar === "hijri" ? "هجري" : "ميلادي",
    months: "",
    carried: Number(t.carried_debt) || 0,
  };
}
