// ============================================================
// وثيق — محلّل ملفات رفع الوحدات (Excel/CSV) — دوال نقية بلا React ولا Supabase
//
// فُصل عن ImportView (30 سبتمبر 2026) ليُختبر مباشرة، ولتقرأه ورقة «قالب الرفع»
// في التصدير من المصدر نفسه — فلا يعود ترتيب الأعمدة يختلف بين الطرفين.
// ============================================================
import { firstDueGap, contractState, defaultTermPeriods, type Frequency } from "./contracts";
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
  /** (20 أكتوبر 2026) جزء مدفوع من الدفعة التالية قبل وثيق — رصيد افتتاحي لا نقد في الدفتر */
  partial_amount?: number;
  prop_name?: string;
  prop_id?: string;
  _error?: string;
  /** تنبيه لا يمنع الرفع: بداية مستقبلية بلا دفعات — غالبًا موعد الدفعة القادمة لا بداية العقد */
  _warn?: string;
  /** «أول استحقاق» يختلف عن بداية العقد — يُسأل عنه المكتب قبل الحفظ (30 سبتمبر 2026) */
  _due?: string;
  /** الوحدة موجودة أصلًا في العقار الهدف — تُعامل كخطأ ولا تُرفع (30 سبتمبر 2026) */
  _exists?: string;
  /** ملاحظة لا تمنع الرفع ولا تحتاج قرارًا: تحويل المبلغ من سنوي/شهري، أو مبلغ جزئي من المسدَّد (9 أكتوبر 2026) */
  _note?: string;
};

const FREQ_MAP: Record<string, Frequency> = {
  "يومي": "daily", "اسبوعي": "weekly", "شهري": "monthly",
  "ربع سنوي": "quarterly", "كل 3 اشهر": "quarterly", "ربعي": "quarterly", "كل ثلاثة اشهر": "quarterly",
  /* الثلث السنوي: المكتب يكتبها بصيغ كثيرة — نقبلها كلها */
  "كل 4 اشهر": "trimester", "كل اربعة اشهر": "trimester", "ثلث سنوي": "trimester",
  "ثلاث دفعات": "trimester", "3 دفعات": "trimester", "كل ٤ اشهر": "trimester",
  "نصف سنوي": "semiannual", "كل 6 اشهر": "semiannual", "نصفي": "semiannual", "كل ستة اشهر": "semiannual",
  "سنوي": "annual", "سنويا": "annual",
  /* (7 نوفمبر 2026) صيغ شائعة في ملفات المكاتب كانت تُرفض «دورة غير معروفة» */
  "شهريا": "monthly", "كل شهر": "monthly", "دفعه شهريه": "monthly", "شهريه": "monthly", "12 دفعه": "monthly", "12 دفعات": "monthly",
  "ربع سنويا": "quarterly", "كل 3 شهور": "quarterly", "كل ثلاث شهور": "quarterly", "كل ثلاثه شهور": "quarterly",
  "4 دفعات": "quarterly", "اربع دفعات": "quarterly", "اربعه دفعات": "quarterly", "ربع سنويه": "quarterly",
  "كل 4 شهور": "trimester", "كل اربع شهور": "trimester",
  "نصف سنويا": "semiannual", "كل 6 شهور": "semiannual", "كل ست شهور": "semiannual", "كل سته شهور": "semiannual",
  "دفعتين": "semiannual", "دفعتان": "semiannual", "2 دفعات": "semiannual", "دفعتين في السنه": "semiannual", "نصف سنويه": "semiannual",
  "سنويه": "annual", "دفعه واحده": "annual", "دفعه سنويه": "annual", "كل سنه": "annual", "مره في السنه": "annual", "1 دفعه": "annual",
  "semi-annual": "semiannual", "semi annual": "semiannual", "quarter": "quarterly",
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
  /* (7 نوفمبر 2026) تاريخ إكسل وصل رقمًا (45658 = 2025-01-01): خلية تاريخ نُسخت كقيمة أو عمود
     بتنسيق «عام» أو CSV صُدّر من إكسل. النطاق 30000–60000 = 1982–2064 فلا يلتبس بمبلغ أو عدد */
  const ser = /^\d{5}(\.\d+)?$/.test(toEnDigits(c)) ? Number(toEnDigits(c)) : NaN;
  if (ser >= 30000 && ser <= 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(ser) * 86400000);
    return { iso: d.toISOString().slice(0, 10), hijri: false };
  }
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
    if (c instanceof Date && !isNaN(c.getTime())) {
      /* SheetJS 0.18 يُخرج تاريخ إكسل في توقيت الرياض «23:59:08 من اليوم السابق»
         (فرق التوقيت المحلي التاريخي 52 ثانية) — فكان كل تاريخ حقيقي في ملف إكسل
         يُرفع قبل يومه بيوم: بداية العقد ويوم الدفع كلاهما (9 أكتوبر 2026).
         نضيف ساعة قبل أخذ اليوم: منتصف الليل يبقى يومه، و23:59 تعود لليوم الصحيح. */
      const d = new Date(c.getTime() + 3600000);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
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
  name: ["اسم المستأجر", "المستأجر", "الاسم", "اسم", "اسم العميل", "الساكن", "اسم الساكن", "name", "tenant", "tenant name",
    /* (7 نوفمبر 2026 — اختبار 600 ملف) */
    "المستأجر/ة", "اسم المستأجر/ة", "المستأجرة", "اسم المستأجرة"],
  unit: ["رقم الوحدة", "الوحدة", "رقم الشقة", "الشقة", "unit", "unit no", "رقم المحل", "المحل", "رقم المكتب", "رقم الفيلا",
    "شقة رقم", "وحدة رقم", "محل رقم", "رقم العين", "العين"],
  rent: ["قيمة الدفعة", "الدفعة", "مبلغ الدفعة", "الإيجار", "قيمة الإيجار", "مبلغ الإيجار", "rent", "amount",
    /* أسماء تحمل أساس المبلغ في عنوانها — تُقرأ ويُحوَّل المبلغ إلى قيمة الدفعة (9 أكتوبر 2026) */
    "الإيجار السنوي", "قيمة الإيجار السنوي", "الإيجار الشهري", "قيمة الإيجار الشهري",
    "القسط", "قيمة القسط", "مبلغ القسط", "annual rent", "monthly rent",
    "مبلغ الإيجار السنوي", "الإيجار سنويا", "قيمة العقد السنوية", "قيمة العقد السنوي", "الإيجار السنوي (ريال)",
    "مبلغ الإيجار الشهري", "الإيجار شهريا", "قيمة الإيجار الشهرية", "الإيجار الشهري (ريال)"],
  freq: ["دورة السداد", "الدورة", "دورية السداد", "طريقة السداد", "نظام السداد", "frequency",
    /* (7 نوفمبر 2026) «طريقة الدفع» أشهر عنوان في ملفات المكاتب — كان يُتجاهل فيُطلب تحديده يدويًّا */
    "طريقة الدفع", "نظام الدفع", "دورية الدفع", "آلية السداد", "آلية الدفع", "نوع الدفع", "السداد", "payment", "payment method"],
  start: ["بداية العقد", "تاريخ البداية", "تاريخ بداية العقد", "تاريخ العقد", "تاريخ بدء العقد", "بداية الإيجار", "البداية", "بداية", "start", "start date", "contract start",
    "تاريخ بداية الإيجار", "بداية التعاقد", "تاريخ التعاقد", "تاريخ بدء الإيجار", "من تاريخ", "من", "تاريخ الدخول", "بداية المدة"],
  periods: ["عدد الدفعات", "الدفعات", "periods", "عدد الأقساط", "الأقساط", "عدد دفعات العقد"],
  phone: ["الجوال", "جوال", "رقم الجوال", "الهاتف", "رقم الهاتف", "جوال المستأجر", "phone", "mobile", "رقم التواصل", "التواصل", "الواتساب", "واتساب"],
  nid: ["رقم الهوية", "الهوية", "رقم الهوية/السجل", "رقم السجل", "national id", "id"],
  paid: ["الدفعات المسدّدة", "المسدد", "دفعات مسددة", "عدد الدفعات المسددة", "المسدد دفعات", "paid", "paid periods",
    "المبلغ المسدد", "المبلغ المدفوع", "المدفوع", "إجمالي المدفوع", "إجمالي المسدد", "paid amount",
    "المحصل", "المبلغ المحصل", "المستلم", "المبلغ المستلم",
    "الدفعات المدفوعة", "عدد الدفعات المدفوعة", "الأقساط المسددة", "الأقساط المدفوعة"],
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
  months: ["مدة العقد (أشهر)", "مدة العقد بالأشهر", "مدة العقد", "المدة بالأشهر", "عدد الأشهر", "عدد الشهور", "مدة الإيجار", "مدة العقد بالشهور"],
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
  /** manual = طابقها المكتب بنفسه في خطوة «طابق أعمدتك» */
  mode: "headers" | "position" | "manual";
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
/* أسماء أمثلة القالبين (Excel وCSV) — الصف يُعدّ مثالًا فقط إن بقي فيه اسم المثال نفسه */
const EXAMPLE_NAMES = new Set(["عبدالله الحربي", "مؤسسة النور التجارية", "خالد القحطاني"].map((n) => arKey(n)));
function hasExampleMark(r: string[]): boolean {
  return r.some((c) => {
    const k = arKey(cleanCell(c)).replace(/[—–-]/g, " ").replace(/\s+/g, " ").trim();
    return k === EX_KEY || (/^مثال\b/.test(k) && k.includes("احذف"));
  });
}
/** (7 نوفمبر 2026) المكتب يكتب مستأجريه فوق صفوف الأمثلة وينسى عمود «مثال — احذف هذا الصف»:
    كانت أول ثلاثة مستأجرين تُتجاهل بصمت. الآن: علامة المثال + اسم المثال الأصلي (أو صف بلا اسم) = مثال؛
    علامة المثال مع اسم آخر = صف حقيقي كتبه المكتب فوق المثال. */
export function isExampleRow(r: string[]): boolean {
  if (!hasExampleMark(r)) return false;
  const names = r.filter((c) => !hasExampleMark([c])).map((c) => arKey(cleanCell(c))).filter(Boolean);
  if (names.some((n) => EXAMPLE_NAMES.has(n) || /^مثال/.test(n))) return true;
  /* صف ليس فيه إلا العلامة (والباقي فارغ أو أرقام المثال) يبقى مثالًا */
  return !r.some((c) => { const v = cleanCell(c); return v && !hasExampleMark([v]) && /[\u0600-\u06FFa-zA-Z]{2,}/.test(v) && !/^(شهري|سنوي|كل 3 اشهر|شقه|هجري|ميلادي)$/.test(arKey(v)); });
}

const PER_YEAR: Record<string, number> = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, trimester: 3, semiannual: 2, annual: 1 };

/* ============================================================
   «طابق أعمدتك» (9 أكتوبر 2026)
   ملف المكتب لا يشبه قالبنا: أعمدة بأسماء أخرى، «الإيجار» سنوي لا قيمة الدفعة،
   و«المسدَّد» مبلغ بالريال لا عدد دفعات. التخمين الصامت هنا يصنع متأخرات وهمية
   بعشرات الآلاف. فالقاعدة: ما نعرفه بيقين يُقرأ وحده، وما فيه لبس يُسأل عنه المكتب
   مرة واحدة قبل المعاينة — والملف كله يبقى في متصفحه لا يُرسل لأي مكان.
   ============================================================ */

/** أساس مبلغ عمود «الإيجار»: قيمة كل دفعة (القسط) أو الإيجار السنوي أو الشهري */
export type RentBasis = "payment" | "annual" | "monthly";
/** أساس عمود «المسدَّد»: عدد الدفعات المسدَّدة أو المبلغ المسدَّد بالريال */
export type PaidBasis = "count" | "amount";
export type ColumnMap = Partial<Record<Field, number>>;
export type ParseOptions = {
  /** خريطة صريحة (من خطوة المطابقة) تتقدّم على الاكتشاف */
  map?: ColumnMap;
  headerRow?: boolean;
  rentBasis?: RentBasis;
  paidBasis?: PaidBasis;
  /** قيمة ثابتة لكل صف خانته فارغة — لملف بلا عمود دورة سداد أو تقويم */
  defaults?: { freq?: Frequency; calendar?: "hijri" | "gregorian" };
};

/** تسمية الحقل للمكتب — هي عناوين القالب نفسها */
export const FIELD_LABEL: Record<Field, string> = Object.fromEntries(FIELDS.map((f, i) => [f, HEADERS[i]])) as Record<Field, string>;
/** بدونها لا يُفهم العقد: الاسم والمبلغ والدورة (الدورة تقبل قيمة ثابتة بدل العمود) */
export const REQUIRED_FIELDS: Field[] = ["name", "rent", "freq"];

/** أساس الإيجار من عنوان العمود — null = العنوان لا يحسم («الإيجار»، «rent») */
export function rentBasisFromHeader(h: string): RentBasis | null {
  const k = arKey(cleanCell(h));   // لا headerKey: «الإيجار (سنوي)» يحمل الأساس بين القوسين
  if (!k) return null;
  if (/سنوي|سنه|annual|year/.test(k)) return "annual";
  if (/شهري|monthly/.test(k)) return "monthly";
  if (/دفعه|قسط|installment|payment/.test(k)) return "payment";
  return null;
}

/** أساس المسدَّد من عنوان العمود — null = العنوان لا يحسم («المسدد»، «paid») */
export function paidBasisFromHeader(h: string): PaidBasis | null {
  const k = arKey(cleanCell(h));   // لا headerKey: «الإيجار (سنوي)» يحمل الأساس بين القوسين
  if (!k) return null;
  /* (7 نوفمبر 2026) «الدفعات المدفوعة» عدد لا مبلغ — كانت «مدفوع» تُفحص أولًا فيُقرأ 3 دفعات = 3 ريالات */
  if (/مبلغ|ريال|قيمه|اجمالي|amount|sar/.test(k)) return "amount";
  if (/عدد|دفعات|اقساط|periods|count/.test(k)) return "count";
  if (/مدفوع/.test(k)) return "amount";
  return null;
}

/** حرف عمود إكسل: 0 → A، 26 → AA */
export function columnLetter(i: number): string {
  let s = "", n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* (7 نوفمبر 2026) «ملاحظات/ملاحظة/notes» في ملفات المكاتب أعمدة كلام حر لا تُستورد — كانت توقف الملف عند المطابقة */
const NOTE_KEYS = new Set(["ملاحظه", "ملاحظات", "الملاحظات", "notes", "note", "تعليق", "تعليقات", "remarks"].map((h) => headerKey(h)));
/* أعمدة شائعة في ملفات المكاتب لا يحتاجها وثيق (أو يحسبها بنفسه): تُتجاهل بلا سؤال وتُذكر في «المتجاهلة».
   المتأخر/المتبقي/المستحق/الحالة يحسبها وثيق من الدفعات المسدّدة؛ استيرادها كان سيكرّرها أو يناقضها. */
const IGNORE_KEYS = new Set(["الجنسيه", "البريد الالكتروني", "الايميل", "البريد", "email", "العموله", "عموله المكتب", "قيمه التامين",
  "التامين", "مبلغ التامين", "المساحه", "الدور", "الطابق", "المتاخر", "المبلغ المتاخر", "المتبقي", "المبلغ المتبقي", "الحاله",
  "حاله الدفع", "تاريخ اخر دفعه", "اخر دفعه", "الرصيد", "المستحق", "المبلغ المستحق", "الوسيط", "المسوق", "اسم المالك", "المالك",
  "الحي", "المدينه", "العنوان", "ملاحظات المكتب"].map((h) => headerKey(h)));
const isNoteHeader = (h: string) => !!h && (headerKey(h) === headerKey(NOTE_HEADER) || NOTE_KEYS.has(headerKey(h)) || IGNORE_KEYS.has(headerKey(h)));
const nonEmptyRows = (grid: string[][]) => grid.filter((r) => (r || []).some((c) => cleanCell(c)));

/** أول n قيم غير فارغة لكل عمود من صفوف البيانات (بلا صف العناوين ولا صفوف «مثال») */
export function columnSamples(grid: string[][], headerRow: boolean, width: number, n = 3): string[][] {
  const out: string[][] = Array.from({ length: width }, () => []);
  const rows = nonEmptyRows(grid).slice(headerRow ? 1 : 0);
  let left = width;
  for (const r of rows) {
    if (!left) break;
    if (isExampleRow(r)) continue;
    for (let i = 0; i < width; i++) {
      if (out[i].length >= n) continue;
      const v = cleanCell(r[i]);
      if (v) { out[i].push(v); if (out[i].length === n) left--; }
    }
  }
  return out;
}

export type ColumnAnalysis = {
  mode: "headers" | "position";
  headerRow: boolean;
  width: number;
  /** نص الصف الأول لكل عمود (فارغ إن لم يكن صف عناوين) */
  headers: string[];
  /** الحقل المقترح لكل عمود — null = تجاهل */
  fields: (Field | null)[];
  rentHint: RentBasis | null;
  paidHint: PaidBasis | null;
  /** اقتراح من القيم حين لا يحسم العنوان — يُعرض «الأرجح» ولا يُختار نيابةً عن المكتب */
  paidSuggest: PaidBasis | null;
  /** هل يغيّر أساس الإيجار شيئًا؟ لا، إن كانت كل العقود سنوية (الدفعة = السنوي) */
  rentMatters: boolean;
  /** لماذا نعرض خطوة المطابقة (فارغة = الملف مفهوم بيقين) */
  reasons: string[];
};

export type MapConfig = {
  fields: (Field | null)[];
  headerRow: boolean;
  rentBasis: RentBasis | null;
  paidBasis: PaidBasis | null;
  defFreq: Frequency | null;
  defCal: "hijri" | "gregorian" | null;
};

/** قراءة الملف قبل التحليل: ماذا فهمنا من كل عمود، وأين اللبس */
export function analyzeColumns(grid: string[][]): ColumnAnalysis {
  const rows = nonEmptyRows(grid);
  const width = rows.slice(0, 500).reduce((m, r) => Math.max(m, (r || []).length), 0);
  const first = rows.length ? rows[0].map((c) => cleanCell(c)) : [];
  const { map, headerRow, info } = detectColumns(first.map(String));
  const fields: (Field | null)[] = Array.from({ length: width }, () => null);
  (Object.keys(map) as Field[]).forEach((f) => { const i = map[f]!; if (i < width) fields[i] = f; });
  const headers = Array.from({ length: width }, (_, i) => headerRow ? (first[i] || "") : "");
  const samples = columnSamples(rows, headerRow, width, 12);

  const rentI = fields.indexOf("rent"), paidI = fields.indexOf("paid"), freqI = fields.indexOf("freq");
  const rentHint = rentI >= 0 && headerRow ? rentBasisFromHeader(headers[rentI]) : null;
  const paidHint = paidI >= 0 && headerRow ? paidBasisFromHeader(headers[paidI]) : null;
  let paidSuggest: PaidBasis | null = null;
  /* (7 نوفمبر 2026) يُحسم من القيم حين لا لبس: كل قيمة غير صفرية ≥ 500 مبلغٌ بالريال
     (لا عقد فيه 500 دفعة)، وكلها أصفار = لا فرق. غير ذلك يُسأل المكتب كما كان. */
  let paidAuto: PaidBasis | null = null;
  if (paidI >= 0 && !paidHint) {
    const vals = samples[paidI].map(parseNum).filter((n) => !isNaN(n));
    if (vals.length) paidSuggest = vals.some((n) => n > 120 || !Number.isInteger(n)) ? "amount" : "count";
    const nz = vals.filter((n) => n !== 0);
    if (vals.length && !nz.length) paidAuto = "count";
    else if (nz.length && nz.every((n) => n >= 500)) paidAuto = "amount";
  }
  const freqVals = freqI >= 0 ? samples[freqI] : [];
  const rentMatters = !(freqVals.length > 0 && freqVals.every((v) => FREQ_LOOKUP[arKey(v)] === "annual"));

  const reasons: string[] = [];
  if (info.mode === "position") reasons.push("لم نجد عناوين أعمدة نعرفها — حدّد ماذا يحوي كل عمود");
  else {
    const unknown = fields.map((f, i) => (!f && samples[i].length && !isNoteHeader(headers[i])) ? (headers[i] || `العمود ${columnLetter(i)}`) : "").filter(Boolean);
    if (unknown.length) reasons.push(`أعمدة فيها بيانات لم نتعرّف عليها: ${unknown.join("، ")}`);
  }
  return { mode: info.mode as "headers" | "position", headerRow, width, headers, fields, rentHint, paidHint: paidHint ?? paidAuto, paidSuggest, rentMatters, reasons };
}

/** الإعداد الأوّلي من التحليل: ما لا يحسمه العنوان يبقى null حتى يختاره المكتب */
export function initialConfig(a: ColumnAnalysis): MapConfig {
  return {
    fields: [...a.fields], headerRow: a.headerRow,
    rentBasis: a.rentHint ?? (a.rentMatters ? null : "payment"),
    paidBasis: a.paidHint,
    defFreq: null, defCal: null,
  };
}

/** ما يمنع المعاينة — نفس القائمة تُعرض للمكتب وتُختبر */
export function mappingProblems(cfg: MapConfig): string[] {
  const out: string[] = [];
  const count = new Map<Field, number>();
  cfg.fields.forEach((f) => { if (f) count.set(f, (count.get(f) || 0) + 1); });
  count.forEach((n, f) => { if (n > 1) out.push(`«${FIELD_LABEL[f]}» مختار لأكثر من عمود — اختره لعمود واحد`); });
  if (!count.has("name")) out.push("حدّد عمود «اسم المستأجر»");
  if (!count.has("rent")) out.push("حدّد عمود المبلغ («قيمة الدفعة» أو الإيجار)");
  if (!count.has("freq") && !cfg.defFreq) out.push("حدّد عمود «دورة السداد» — أو اختر دورة واحدة لكل الصفوف");
  if (count.has("rent") && !cfg.rentBasis) out.push("حدّد: مبلغ الإيجار في ملفك قيمة كل دفعة أم سنوي أم شهري؟");
  if (count.has("paid") && !cfg.paidBasis) out.push("حدّد: عمود المسدَّد عدد دفعات أم مبلغ بالريال؟");
  return out;
}

/** الإعداد → خيارات parseGrid */
export function configToOptions(cfg: MapConfig): ParseOptions {
  const map: ColumnMap = {};
  cfg.fields.forEach((f, i) => { if (f && map[f] === undefined) map[f] = i; });
  return {
    map, headerRow: cfg.headerRow,
    rentBasis: cfg.rentBasis || "payment", paidBasis: cfg.paidBasis || "count",
    defaults: { freq: cfg.defFreq || undefined, calendar: cfg.defCal || undefined },
  };
}

/** بصمة عناوين الملف — لتذكّر مطابقة المكتب لملفه نفسه في المرة القادمة */
export function headerSignature(a: ColumnAnalysis): string {
  return a.headerRow ? `${a.width}:` + a.headers.map(headerKey).join("|") : "";
}

/** المطابقة المحفوظة صالحة لهذا الملف؟ (العرض نفسه، والحقول معروفة) */
export function validSavedConfig(a: ColumnAnalysis, saved: unknown): MapConfig | null {
  const c = saved as MapConfig;
  if (!c || !Array.isArray(c.fields) || c.fields.length !== a.width) return null;
  if (!c.fields.every((f) => f === null || (FIELDS as readonly string[]).includes(f))) return null;
  const okR = c.rentBasis === null || ["payment", "annual", "monthly"].includes(c.rentBasis as string);
  const okP = c.paidBasis === null || ["count", "amount"].includes(c.paidBasis as string);
  const okF = c.defFreq === null || c.defFreq in PER_YEAR;
  const okC = c.defCal === null || c.defCal === "hijri" || c.defCal === "gregorian";
  if (!okR || !okP || !okF || !okC) return null;
  return { fields: c.fields, headerRow: !!c.headerRow, rentBasis: c.rentBasis, paidBasis: c.paidBasis, defFreq: c.defFreq, defCal: c.defCal };
}

const fmtN = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/** مفتاح رقم الوحدة للمقارنة: «١٠١» = «101» و«شقة 1» = «شقه 1» */
export const unitKey = (u: string) => arKey(cleanCell(u));

/**
 * تحليل الشبكة كاملة إلى صفوف جاهزة للمعاينة. O(n) — ملف 2000 صف لا يتباطأ:
 * العقارات في Map، والتكرار في Map.
 */
export function parseGrid(grid: string[][], properties: Prop[], todayIso: string, opts: ParseOptions = {}): { rows: Row[]; info: ColumnInfo } {
  const nonEmpty = grid.filter((r) => (r || []).some((c) => cleanCell(c)));
  if (!nonEmpty.length) return { rows: [], info: { mode: opts.map ? "manual" : "position", recognized: [], ignored: [], examples: 0 } };
  const detected = detectColumns(nonEmpty[0].map(String));
  let map: ColumnMap, headerRow: boolean, info: Omit<ColumnInfo, "examples">;
  if (opts.map) {
    /* مطابقة المكتب الصريحة: لا اكتشاف ولا موضع — ما اختاره هو ما يُقرأ */
    map = opts.map; headerRow = opts.headerRow ?? detected.headerRow;
    const first = nonEmpty[0].map((c) => cleanCell(c));
    const used = new Set(Object.values(map));
    const label = (i: number) => (headerRow && first[i]) || `العمود ${columnLetter(i)}`;
    info = {
      mode: "manual",
      recognized: (Object.keys(map) as Field[]).sort((a, b) => map[a]! - map[b]!).map((f) => `${label(map[f]!)} ← ${
        f === "rent" && opts.rentBasis === "annual" ? "الإيجار السنوي (يُقسم على الدفعات)"
        : f === "rent" && opts.rentBasis === "monthly" ? "الإيجار الشهري (يُحوَّل للدفعة)"
        : f === "paid" && opts.paidBasis === "amount" ? "المبلغ المسدَّد (يُحوَّل لدفعات)"
        : FIELD_LABEL[f]}`),
      /* «ملاحظات» المكتب تُذكر «متجاهَلة» ليعرف أنها لا تُستورد؛ عمود ملاحظة قالبنا وحده يُخفى */
      ignored: headerRow ? first.map((h, i) => (h && !used.has(i) && headerKey(h) !== headerKey(NOTE_HEADER)) ? h : "").filter(Boolean) : [],
    };
  } else {
    ({ map, headerRow, info } = detected);
    if (opts.headerRow !== undefined) headerRow = opts.headerRow;
  }
  /* أساس المبلغ والمسدَّد: الصريح أولًا، ثم ما يحسمه عنوان العمود («الإيجار السنوي»)،
     وإلا السلوك القديم (قيمة الدفعة، وعدد دفعات) — فلا يتغيّر شيء على القوالب القائمة */
  const hdr = (f: Field) => headerRow && map[f] !== undefined ? cleanCell(nonEmpty[0][map[f]!]) : "";
  const rentBasis: RentBasis = opts.rentBasis || rentBasisFromHeader(hdr("rent")) || "payment";
  const paidBasis: PaidBasis = opts.paidBasis || paidBasisFromHeader(hdr("paid")) || "count";
  const defFreq = opts.defaults?.freq, defCal = opts.defaults?.calendar;
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  const propByName = new Map<string, Prop>();
  properties.forEach((p) => { if (!propByName.has(norm(p.name))) propByName.set(norm(p.name), p); });

  let examples = 0;
  const rows: Row[] = [];
  for (const r of nonEmpty.slice(headerRow ? 1 : 0)) {
    if (isExampleRow(r)) { examples++; continue; }
    const g = (f: Field) => { const i = map[f]; return i === undefined ? "" : cleanCell(r[i]); };
    const [name, unit, rent, freq, startDate, periods, phoneRaw, nid, paid, propName] =
      [g("name"), g("unit"), g("rent"), g("freq") || defFreq || "", g("start"), g("periods"), g("phone"), g("nid"), g("paid"), g("prop")];
    const [elecAcc, waterAcc, contractNo, unitTypeTxt, roomsTxt, bathsTxt, acsTxt, firstDueTxt, vatTxt, calTxt, monthsTxt, carriedTxt] =
      [g("elec"), g("water"), g("contract_no"), g("unit_type"), g("rooms"), g("baths"), g("acs"), g("first_due"), g("vat"), g("calendar") || defCal || "", g("months"), g("carried")];

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
    /* (5 نوفمبر 2026) العمودان معًا ومتعارضان: «عدد الدفعات» يغلب — كان «مدة العقد» يُهمَل بصمت */
    const monthsConflict = prN > 0 && prFromMonths !== null && Math.round(prN) !== prFromMonths;
    /* المبلغ المكتوب → قيمة الدفعة. السنوي ÷ عدد الدفعات في السنة، والشهري × 12 ÷ عددها.
       الناتج يظهر في المعاينة بحسبته — المكتب يرى «سنوي 30,000 ÷ 4 = 7,500» قبل الحفظ. */
    const notes: string[] = [];
    let rentPay = rentN;
    if (rentN > 0 && rentBasis !== "payment" && FREQ_LOOKUP[fk]) {
      const per = PER_YEAR[frequency] || 12;
      const exact = (rentBasis === "annual" ? rentN : rentN * 12) / per;
      rentPay = round2(exact);
      /* (29 أكتوبر 2026) أثر تقريب المكتب نفسه: «الشهري 666.67» لعقد سنوي 8,000
         كان يُخرج الدفعة 8,000.04، فمن سدّد 8,000 كاملة يُحسب «جزئيًّا» ويظهر
         متأخرًا بأربع هللات لا وجود لها. الدفعة على بعد ≤ 5 هللات من ريال صحيح
         هي ذلك الريال — لا مكتب يسعّر إيجاره بالهللة. */
      const snapped = Math.round(rentPay);
      if (snapped > 0 && Math.abs(rentPay - snapped) <= 0.05) rentPay = snapped;
      if (rentPay !== rentN || rentBasis === "monthly" && per !== 12)
        notes.push(rentBasis === "annual"
          ? `الدفعة = السنوي ${fmtN(rentN)} ÷ ${per} = ${fmtN(rentPay)}`
          : `الدفعة = الشهري ${fmtN(rentN)} × 12 ÷ ${per} = ${fmtN(rentPay)}`);
      if (Math.abs(exact - rentPay) > 1e-9) notes.push("مقرَّبة لأقرب ريال");
    }
    const paidN = paid ? parseNum(paid) : 0;
    /* المسدَّد مبلغًا: الدفعات الكاملة تُعدّ، والباقي جزئي يُنبَّه عليه — لا يُقرَّب لدفعة كاملة
       (التقريب للأعلى يخفي متأخرات حقيقية، وللأسفل يُسقط مالًا دُفع) */
    let pd: number, paidRem = 0;
    if (paidBasis === "amount") {
      const amt = isNaN(paidN) ? 0 : Math.max(0, paidN);
      pd = rentPay > 0 ? Math.floor(amt / rentPay + 1e-9) : 0;
      paidRem = rentPay > 0 ? round2(amt - pd * rentPay) : 0;
      if (paidRem < 0.01) paidRem = 0;
      if (amt > 0 && rentPay > 0)
        notes.push(`المسدَّد ${fmtN(amt)} = ${pd} ${pd === 1 ? "دفعة كاملة" : "دفعات كاملة"}`
          + (paidRem ? ` + ${fmtN(paidRem)} جزئي — يُحفظ مدفوعًا من الدفعة التالية (رصيد افتتاحي، لا يدخل محصَّل هذا الشهر)` : ""));
    } else pd = isNaN(paidN) ? 0 : Math.max(0, Math.floor(paidN));
    const carriedN = carriedTxt ? parseNum(carriedTxt) : NaN;
    const fd = firstDueTxt ? parseAnyDate(firstDueTxt).iso : "";
    const intOk = (n: number) => !isNaN(n) && Number.isInteger(n);

    let err = "";
    if (!name) err = "الاسم مفقود";
    else if (!rent) err = "قيمة الدفعة مفقودة";
    else if (isNaN(rentN0)) err = `قيمة الدفعة غير مفهومة: «${rent}» — اكتب رقمًا مثل 2500`;
    else if (!rentN) err = "قيمة الدفعة مفقودة";
    else if (rentPay < 0.01) err = `قيمة الدفعة بعد التحويل أقل من هللة: «${rent}»`;
    else if (startDate && !cs) err = "تاريخ غير مفهوم";
    // لا نمرّر تاريخًا مستحيلًا (2026-13-45): كان يُحفظ كما هو ويفسد كل الحسابات
    else if (cs && !isRealDate(cs)) err = `تاريخ غير صحيح: ${startDate}`;
    else if (freqUnknown) err = `دورة سداد غير معروفة: «${freq}» — استخدم القائمة المنسدلة في القالب`;
    else if (!freq) err = "دورة السداد مفقودة";
    /* خانة غير فارغة لا رقم فيها = خطأ صريح، لا صفر صامت (30 سبتمبر 2026) */
    else if (periods && !intOk(prN)) err = `«عدد الدفعات» غير مفهوم: «${periods}» — اكتب رقمًا صحيحًا مثل 12`;
    else if (paid && paidBasis === "amount" && isNaN(paidN)) err = `المبلغ المسدَّد غير مفهوم: «${paid}» — اكتب المبلغ رقمًا مثل 15000`;
    else if (paid && paidBasis === "count" && !intOk(paidN)) err = `«الدفعات المسدّدة» غير مفهومة: «${paid}» — اكتب رقمًا صحيحًا مثل 8`;
    else if (monthsTxt && isNaN(monthsN)) err = `«مدة العقد» غير مفهومة: «${monthsTxt}» — اكتب عدد الأشهر مثل 12`;
    else if (carriedTxt && isNaN(carriedN)) err = `«دين مرحَّل» غير مفهوم: «${carriedTxt}» — اكتب المبلغ رقمًا`;
    else if (firstDueTxt && !(fd && isRealDate(fd))) err = `«أول استحقاق» غير مفهوم: ${firstDueTxt}`;
    else if (pr && paidBasis === "amount" && (pd > pr || (pd === pr && paidRem > 0)))
      err = `المبلغ المسدَّد ${fmtN(paidN)} أكثر من قيمة العقد كله (${pr} × ${fmtN(rentPay)}) — تأكّد من عمود المبلغ وأساسه`;
    else if (pr && pd > pr) err = "الدفعات المسدّدة أكثر من عدد دفعات العقد";
    /* (20 أكتوبر 2026) بلا «عدد الدفعات» تُفترض سنة بالدورة — مسدَّد أكثر منها كان يُقبل
       («مسدَّد 15000 من 12»: مبلغ كُتب في عمود العدد) */
    else if (!pr && FREQ_LOOKUP[fk] && pd > defaultTermPeriods(frequency))
      err = `الدفعات المسدّدة (${pd}) أكثر من دفعات سنة بهذه الدورة (${defaultTermPeriods(frequency)}) — اكتب «عدد الدفعات» للعقد، أو تأكّد أن العمود عدد لا مبلغ`;
    /* مسدَّد أكثر مما استحق حتى اليوم بدفعتين فأكثر: غالبًا خطأ — يُنبَّه ولا يُمنع (قد يدفع سنة مقدّمًا) */
    if (!err && cs && pd > 0) {
      try {
        const due0 = Number(contractState({ contract_start: cs, payment_frequency: frequency, rent_amount: rentPay || 1,
          paid_periods: 0, contract_periods: pr || null, calendar, first_due: fd || null } as any).unpaid) || 0;
        if (pd > due0 + 1) notes.push(`⚠️ مسدَّد ${pd} والمستحق حتى اليوم ${due0} — أي ${pd - due0} مقدّمًا. تأكّد من العدد`);
      } catch { /* تاريخ غير صالح يُلتقط في مكان آخر */ }
    }
    if (!err && monthsConflict)
      notes.push(`⚠️ «عدد الدفعات» ${prN} لا يوافق «مدة العقد» ${fmtN(monthsN)} شهرًا بدورة «${freq}» (= ${prFromMonths} دفعة) — اعتمدنا عدد الدفعات`);
    const target = propName ? propByName.get(norm(propName)) : undefined;
    if (propName && !target && !err) err = `العقار «${propName}» غير موجود — أنشئه أولًا أو صحّح الاسم`;

    /* جوال حُفظ رقمًا في إكسل (سقط صفره) يُعاد صفره — أشهر تلف يصيب الجوالات */
    let phone = toEnDigits(phoneRaw);
    /* (7 نوفمبر 2026) «055 123 4567» / «055-123-4567» ← 0551234567 */
    if (/^05\d{8}$/.test(phone.replace(/[\s\-().]/g, ""))) phone = phone.replace(/[\s\-().]/g, "");
    else if (/^5\d{8}$/.test(phone.replace(/\D/g, ""))) phone = "0" + phone.replace(/\D/g, "");
    /* (7 نوفمبر 2026) +966 5x / 00966 5x / 966 5x ← 05x: صيغة واحدة للمطابقة وروابط واتساب */
    else if (/^(\+|00)?9665\d{8}$/.test(phone.replace(/[\s\-()]/g, ""))) phone = "0" + phone.replace(/\D/g, "").replace(/^(00)?966/, "");
    const optInt = (t: string) => { if (!t) return undefined; const n = parseNum(t); return isNaN(n) ? 0 : n; };
    const vatK = arKey(vatTxt);
    /* كانت /on/ تطابق «none» و«إلكتروني» — الآن قيم صريحة فقط (30 سبتمبر 2026) */
    const vat_mode = !vatK ? undefined
      : /معف|بدون|(^|\s)لا(\s|$)|^(off|no|exempt)$/.test(vatK) ? "off"
      : /تطبق|خاضع|^نعم$|^(on|yes)$/.test(vatK) ? "on" : undefined;

    rows.push({
      name, unit, rent_amount: rentPay, phone, national_id: toEnDigits(nid),
      contract_start: cs, payment_frequency: frequency, contract_periods: pr, paid_periods: pd,
      elec_account: toEnDigits(elecAcc) || undefined, water_account: toEnDigits(waterAcc) || undefined,
      contract_no: contractNo || undefined, calendar,
      unit_type: UNIT_TYPE_KEY[arKey(unitTypeTxt)] || undefined,
      rooms: optInt(roomsTxt), baths: optInt(bathsTxt), acs: optInt(acsTxt),
      first_due: fd || undefined,
      vat_mode,
      carried_debt: carriedTxt ? Math.max(0, isNaN(carriedN) ? 0 : carriedN) : undefined,
      partial_amount: paidRem > 0 ? paidRem : undefined,
      prop_name: propName || undefined, prop_id: target?.id,
      _error: err || undefined,
      /* بيانات المكاتب: 11% من العقود أُدخلت ببداية مستقبلية وعدّاد صفر — «موعد
         الدفعة القادمة» في خانة «بداية العقد». لا يُمنع (العقد الجديد مشروع)
         لكن يُنبَّه قبل الرفع، حين يكون التصحيح في الملف نفسه أسهل. */
      _warn: !err && cs && cs > todayIso && !(pd > 0)
        ? "البداية بعد اليوم ولا دفعات — إن كان العقد ساريًا من قبل فاكتب بدايته الفعلية من العقد وعدد الدفعات المسدَّدة، لا موعد الدفعة القادمة"
        : undefined,
      _note: !err && notes.length ? notes.join(" · ") : undefined,
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

/* ============================================================
   (6 نوفمبر 2026) «جدول تحصيل الإيجارات» المجاني من الموقع
   أعلى صفحة يدخل منها الناس من قوقل تعطي هذا الملف — ثم كان رفعه في وثيق
   يفتح ورقة «الدفعات»، ولا يفهم «نهاية العقد»، ويسأل عن تسعة أعمدة محسوبة،
   فيقف الزائر عند شاشة المطابقة. هنا نتعرّف على الملف بعناوينه ونحوّل ورقة
   «الإيجارات» إلى ما يقرؤه المحلّل مباشرة: المدة بالأشهر من التاريخين،
   والمدفوع مبلغًا بالريال، وتُحذف الأعمدة المحسوبة وأسطر «مستأجر تجريبي».
   ============================================================ */
export const RENT_SHEET_NAME = "الإيجارات";
const RC_SIGNATURE = ["الإيجار السنوي (ريال)", "نهاية العقد", "الدفعات المستحقة حتى اليوم", "أيام لنهاية العقد"];

/** هل هذه ورقة «الإيجارات» من جدول التحصيل المجاني؟ */
export function isRentCollectionSheet(grid: string[][]): boolean {
  const first = (nonEmptyRows(grid)[0] || []).map((c) => cleanCell(c));
  return RC_SIGNATURE.every((h) => first.includes(h));
}

/** عدد أشهر العقد من بدايته ونهايته (النهاية شاملة: 1 يناير–31 ديسمبر = 12) */
export function monthsBetween(startIso: string, endIso: string): number | null {
  const s = parseAnyDate(startIso).iso, e = parseAnyDate(endIso).iso;
  if (!isRealDate(s) || !isRealDate(e)) return null;
  const a = new Date(s + "T00:00:00Z"), b = new Date(e + "T00:00:00Z");
  b.setUTCDate(b.getUTCDate() + 1);
  const m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() - a.getUTCDate()) / 30;
  const r = Math.round(m);
  return r > 0 ? r : null;
}

/** يحوّل ورقة «الإيجارات» إلى شبكة بعناوين وثيق — وإن لم تكن هي يُرجعها كما هي */
export function adaptRentCollectionSheet(grid: string[][]): { grid: string[][]; adapted: boolean; dropped: number } {
  if (!isRentCollectionSheet(grid)) return { grid, adapted: false, dropped: 0 };
  const rows = nonEmptyRows(grid);
  const h = rows[0].map((c) => cleanCell(c));
  const at = (name: string) => h.indexOf(name);
  const iUnit = at("رقم الوحدة"), iName = at("المستأجر"), iPhone = at("الجوال"), iRent = at("الإيجار السنوي (ريال)");
  const iFreq = at("دورة السداد"), iStart = at("بداية العقد"), iEnd = at("نهاية العقد"), iPaid = at("المدفوع");
  const cell = (r: string[], i: number) => (i >= 0 ? cleanCell(r[i]) : "");
  const out: string[][] = [["رقم الوحدة", "اسم المستأجر", "الجوال", "الإيجار السنوي", "دورة السداد", "بداية العقد", "مدة العقد (أشهر)", "المبلغ المدفوع"]];
  let dropped = 0;
  for (const r of rows.slice(1)) {
    const name = cell(r, iName);
    /* أسطر الأمثلة في الملف: «مستأجر تجريبي ١…» بجوال 05xxxxxxxx */
    if (!name || /^مستأجر تجريبي/.test(name)) { if (name) dropped++; continue; }
    const months = monthsBetween(cell(r, iStart), cell(r, iEnd));
    out.push([cell(r, iUnit), name, cell(r, iPhone), cell(r, iRent), cell(r, iFreq), cell(r, iStart), months ? String(months) : "", cell(r, iPaid) || "0"]);
  }
  return { grid: out, adapted: true, dropped };
}

/* ============================================================
   (7 نوفمبر 2026) تجهيز ملف المكتب قبل التحليل — مرة واحدة لكل ورقة
   ملف مكتب نموذجي: عنوان «كشف مستأجري عمارة…» فوق الجدول، عمود «م»،
   «تاريخ نهاية العقد» بدل المدة، وصف «الإجمالي» تحته. كان كل ذلك يُسقط
   الملف في «لم نجد عناوين أعمدة نعرفها» فيطابق المكتب كل عمود بيده.
   ============================================================ */
const END_HEADERS = ["نهاية العقد", "تاريخ نهاية العقد", "تاريخ الانتهاء", "انتهاء العقد", "تاريخ انتهاء العقد",
  "نهاية الإيجار", "تاريخ النهاية", "النهاية", "end", "end date", "contract end",
  "إلى تاريخ", "الى تاريخ", "إلى", "الى", "ينتهي في", "تاريخ انتهاء الإيجار", "نهاية المدة"].map((h) => headerKey(h));
const SERIAL_HEADERS = ["م", "#", "ت", "مسلسل", "تسلسل", "الرقم التسلسلي", "رقم تسلسلي", "no", "sn", "s/n"].map((h) => headerKey(h));
const TOTAL_RE = /^(ال)?(اجمالي|مجموع|المجموع الكلي|الاجمالي العام)$|^total$/;

/** عدد العناوين المفهومة في صف — لاختيار صف العناوين الحقيقي */
function recognizedCount(row: string[]): number {
  const seen = new Set<Field>();
  for (const c of row) { const f = HEADER_LOOKUP[headerKey(String(c))]; if (f) seen.add(f); }
  return seen.size;
}

export type PreparedGrid = { grid: string[][]; notes: string[]; rentCollection: boolean };

/** يُطبَّق على كل ورقة قبل analyzeColumns/parseGrid؛ الملف المفهوم أصلًا يمرّ كما هو */
export function prepareGrid(grid0: string[][]): PreparedGrid {
  const notes: string[] = [];
  const rc = adaptRentCollectionSheet(grid0);
  if (rc.adapted) return { grid: rc.grid, notes: [], rentCollection: true };
  let rows = nonEmptyRows(grid0).map((r) => (r || []).map((c) => cleanCell(c)));
  if (!rows.length) return { grid: grid0, notes, rentCollection: false };

  /* ١) صف العناوين: الأكثر عناوين مفهومة في أول 10 صفوف (3 على الأقل) */
  let best = 0, bestN = recognizedCount(rows[0]);
  for (let i = 1; i < Math.min(10, rows.length); i++) {
    const n = recognizedCount(rows[i]);
    if (n > bestN) { best = i; bestN = n; }
  }
  if (best > 0 && bestN >= 3) {
    notes.push(`تجاوزنا ${best === 1 ? "سطر العنوان" : `${best} أسطر عنوان`} فوق الجدول`);
    rows = rows.slice(best);
  }
  if (recognizedCount(rows[0]) < 3) return { grid: rows, notes, rentCollection: false };
  let head = rows[0].map((c) => headerKey(c));
  const fieldAt = (i: number) => HEADER_LOOKUP[head[i]];

  /* ٢) عمود الترقيم «م»: يُحذف (أرقامه المتسلسلة كانت تُعدّ عمودًا مجهولًا) */
  const serial = head.findIndex((h) => SERIAL_HEADERS.includes(h));
  if (serial >= 0 && !fieldAt(serial)) {
    rows = rows.map((r) => r.filter((_, i) => i !== serial));
    head = rows[0].map((c) => headerKey(c));
    notes.push("تجاهلنا عمود الترقيم");
  }

  /* ٣) «تاريخ نهاية العقد» ← «مدة العقد (أشهر)» إن لم يوجد عدد دفعات ولا مدة */
  const has = (f: Field) => head.some((h, i) => fieldAt(i) === f);
  const endI = head.findIndex((h) => END_HEADERS.includes(h));
  const startI = head.findIndex((_, i) => fieldAt(i) === "start");
  if (endI >= 0 && startI >= 0 && !has("periods") && !has("months")) {
    let ok = 0;
    rows = rows.map((r, k) => {
      const out = [...r];
      if (k === 0) { out[endI] = "مدة العقد (أشهر)"; return out; }
      const m = monthsBetween(r[startI] || "", r[endI] || "");
      if (m) ok++;
      out[endI] = m ? String(m) : "";
      return out;
    });
    head = rows[0].map((c) => headerKey(c));
    if (ok) notes.push("حسبنا مدة العقد من «تاريخ نهاية العقد»");
  }

  /* ٤) صفوف «الإجمالي/المجموع» تحت الجدول */
  const nameI = head.findIndex((_, i) => fieldAt(i) === "name");
  const unitI = head.findIndex((_, i) => fieldAt(i) === "unit");
  const before = rows.length;
  rows = [rows[0], ...rows.slice(1).filter((r) => {
    const cells = [nameI, unitI, 0, 1].filter((i) => i >= 0).map((i) => arKey(String(r[i] || "")));
    return !cells.some((c) => TOTAL_RE.test(c));
  })];
  if (rows.length < before) notes.push(`تجاهلنا ${before - rows.length === 1 ? "صف المجموع" : `${before - rows.length} صفوف مجاميع`}`);

  return { grid: rows, notes, rentCollection: false };
}
