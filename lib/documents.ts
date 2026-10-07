import { contractState, buildSchedule, freqLabel, splitVat, settleDeposit, vacancyDays, isVacant, unitVatApplies, expectedNext12 } from "./contracts";
import { complianceState, brokerageEnd, expectedCommission, UI_LEGAL, LEGAL_DISCLAIMER, DEFAULT_COMMISSION_PCT, type ComplianceItem } from "./compliance";
import { KIND_META as L_KIND, OFFER_LABEL, STATUS_META, freshness, pricePerMeter, shortDesc, sortListings, summarize, STALE_DAYS, type Listing } from "./listings";
import { ownerNet, sumByCategory, catLabel, sumAllExpenses, sumDue, isBillable, PAID_BY, type ExpenseRow } from "./expenses";
import { unitLabel, typeLabel, unitWordFor } from "./domain";
import { hijriText, hijriShort } from "@/lib/hijri";
import { annualRentRoll } from "./income";
import { defaultTermPeriods } from "./contracts";
import { unitStatus, unitStatusLabel, arrearsOf, statusWindows, isPartialOnly } from "./contract-state";
import { daysAr, monthsAr, today as riyadhTodayISO } from "./utils";
import { moneySigned } from "./hoaMoney";
import { metersCountLine, METER_TYPE_AR, type PropertyMeter } from "./meters";
import { riyalsInWords } from "./tafqit";

const sar = (n: number) => {
  const v = Number(n) || 0;
  // الكسور بمنزلتين دائمًا (2,608.70 لا 2,608.7) — والصحيح بلا كسور. والسالب بعلامة طرح حقيقية
  const abs = Math.abs(v);
  const txt = Number.isInteger(abs) ? abs.toLocaleString("en-US") : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `−${txt}` : txt;
};

/**
 * تعقيم المدخلات قبل بناء أي مستند HTML. الأسماء والملاحظات يكتبها
 * موظفون، والمستند قد يُفتح في نافذة طباعة أو يُقدَّم علنًا عبر رابط
 * المالك — فأي وسم في اسم مستأجر يصير سكربتًا يعمل عند من يفتح الصفحة.
 * نُهرّب < > & " في كل حقل نصي (عميقًا) ونترك الأرقام والتواريخ كما هي.
 */
/* (30 سبتمبر 2026) لا يُهرِّب مرتين: كانت & تُهرَّب دائمًا، فالنصّ الذي يمرّ على
   scrub مرتين (دالة تعقّم ثم تستدعي أخرى تعقّم، أو esc محلي بعده) يخرج
   «شركة أ &amp;amp; ب». & التي تبدأ كيانًا مكتملًا تُترك كما هي. والفاصلة
   العليا تُهرَّب أيضًا لأن بعض القيم تدخل سمات HTML. */
function scrub<T>(v: T): T {
  if (typeof v === "string") return escH(v) as any;
  if (Array.isArray(v)) return v.map(scrub) as any;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o: any = {};
    for (const k of Object.keys(v as any)) o[k] = scrub((v as any)[k]);
    return o;
  }
  return v;
}

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو",
                   "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

/**
 * 5 مارس 2026 — ميلادي بأسماء عربية.
 * لا يُستعمل Intl مع "ar-SA" لأنه يُخرج التاريخ **هجريًّا** على كثير من
 * الأجهزة، فيقرأ المستأجر تاريخًا لا يطابق عقده.
 */
export function arDate(v?: string | null): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return String(v);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return String(v);
  return `${Number(m[3])} ${MONTHS_AR[mo]} ${m[1]}`;
}
/** التاريخ بالميلادي والهجري معًا — كما يقرأه المكتب السعودي في عقوده */
export function arDateH(v?: string | null): string {
  const g = arDate(v);
  if (!g || g === "—") return g;
  const h = hijriText(String(v).slice(0, 10));
  return h ? `${g} (${h})` : g;
}


/* (30 سبتمبر 2026) «اليوم» بتوقيت الرياض: كان بتوقيت الجهاز/الخادم، فرابط المالك
   (خادم UTC) بين منتصف الليل والثالثة فجرًا يطبع تاريخ الأمس في الترويسة. */
const today = () => riyadhTodayISO();

/** وقت لحظةٍ ما بتوقيت الرياض «14:05» — لوقت إصدار الفاتورة */
const riyadhTime = (v?: string | Date | null): string => {
  const d = v ? new Date(v) : new Date();
  if (isNaN(d.getTime())) return "";
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false }).format(d); }
  catch { return ""; }
};

/**
 * العدد مع المعدود بالعربية (30 سبتمبر 2026): كانت المستندات تكتب «5 شقة»
 * و«1 غرف · 2 دورات مياه · 1 مكيف» و«3 عملية» — أول ما تقع عليه عين المالك.
 * 1 → «شقة واحدة» · 2 → «شقتان» · 3–10 → «3 شقق» · 11–99 → «11 شقة / 11 محلًا» · 100 → «100 شقة».
 */
const NOUNS: Record<string, [one: string, two: string, few: string, many: string]> = {
  "شقة": ["شقة واحدة", "شقتان", "شقق", "شقة"],
  "شقة ملحق": ["شقة ملحق واحدة", "شقتا ملحق", "شقق ملحق", "شقة ملحق"],
  "وحدة": ["وحدة واحدة", "وحدتان", "وحدات", "وحدة"],
  "محل": ["محل واحد", "محلان", "محلات", "محلًا"],
  "معرض": ["معرض واحد", "معرضان", "معارض", "معرضًا"],
  "فيلا": ["فيلا واحدة", "فيلتان", "فلل", "فيلا"],
  "مكتب": ["مكتب واحد", "مكتبان", "مكاتب", "مكتبًا"],
  "مستودع": ["مستودع واحد", "مستودعان", "مستودعات", "مستودعًا"],
  "استديو": ["استديو واحد", "استديوهان", "استديوهات", "استديو"],
  "غرفة": ["غرفة واحدة", "غرفتان", "غرف", "غرفة"],
  "أرض": ["أرض واحدة", "أرضان", "أراضٍ", "أرضًا"],
  "قطعة": ["قطعة واحدة", "قطعتان", "قطع", "قطعة"],
  "دورة مياه": ["دورة مياه واحدة", "دورتا مياه", "دورات مياه", "دورة مياه"],
  "مكيف": ["مكيف واحد", "مكيفان", "مكيفات", "مكيفًا"],
  "عملية": ["عملية واحدة", "عمليتان", "عمليات", "عملية"],
  "دفعة": ["دفعة واحدة", "دفعتان", "دفعات", "دفعة"],
  "عقار": ["عقار واحد", "عقاران", "عقارات", "عقارًا"],
  "عقد": ["عقد واحد", "عقدان", "عقود", "عقدًا"],
  "مالك": ["مالك واحد", "مالكان", "ملّاك", "مالكًا"],
  "بند": ["بند واحد", "بندان", "بنود", "بندًا"],
  "قيد": ["قيد واحد", "قيدان", "قيود", "قيدًا"],
  "معروض": ["معروض واحد", "معروضان", "معروضات", "معروضًا"],
};
/** genitive: بعد حرف جر («على وحدتين» لا «على وحدتان») */
function countAr(n: number | null | undefined, noun: string, genitive = false): string {
  const f = NOUNS[noun];
  const x = Math.abs(Math.round(Number(n) || 0));
  if (!f) return `${x} ${noun}`;
  if (x === 1) return f[0];
  if (x === 2) return genitive ? f[1].replace(/تان$/, "تين").replace(/ان$/, "ين").replace(/^(\S+)تا /, "$1تي ") : f[1];
  const r = x % 100;
  if (r >= 3 && r <= 10) return `${x} ${f[2]}`;
  if (r >= 11) return `${x} ${f[3]}`;
  /* 0 و100 و101…: تمييز مجرور مفرد بلا تنوين النصب */
  return `${x} ${f[3].replace(/ًا$/, "")}`;
}
/** «منذ/خلال N يوم» بلا «0 يوم»: الصفر هو «اليوم» */
const daysOrToday = (n: number | null | undefined, nominative = false) =>
  Math.round(Math.abs(Number(n) || 0)) === 0 ? "اليوم" : daysAr(n, nominative);

type Tenant = {
  status?: string | null;
  id: string; name: string; unit: string | null; phone: string | null; national_id: string | null;
  rent_amount: number; contract_start: string | null; contract_end: string | null;
  payment_frequency: string | null; paid_periods: number | null; contract_periods: number | null;
  partial_amount?: number | null; contract_no?: string | null;
  unit_type?: string | null; vat_mode?: string | null; carried_debt?: number | null; rooms?: number | null; baths?: number | null; acs?: number | null; first_due?: string | null;
};
type Property = {
  usage?: string | null;
  name: string; address: string | null; city: string | null; manager: string | null; property_type: string | null;
  grace_days?: number | null;
  vat_enabled?: boolean | null; vat_rate?: number | null; vat_inclusive?: boolean | null;
};
export type PaymentRow = {
  id?: string; paid_on: string; amount: number;
  method?: string | null; periods_covered?: number | null; note?: string | null;
};
const METHOD_AR: Record<string, string> = {
  transfer: "تحويل بنكي", ejar: "منصة إيجار", cash: "نقدًا", pos: "شبكة", cheque: "شيك", other: "أخرى",
};
const methodAr = (m?: string | null) => METHOD_AR[String(m || "")] || "—";
/** صف السجل: الدفعة السالبة تراجعٌ موثّق — تُسمّى باسمها لا «أخرى» */
/**
 * الدخل السنوي المتوقع للعقار: إيجارات الوحدات المشغولة مُقيَّسة على سنة.
 * يجيب سؤال المالك الأول — «كم يُدخل هذا العقار في السنة؟» — ويجعل المحصَّل
 * خلال الفترة رقمًا له مرجع بدل أن يكون معلّقًا في الهواء.
 */
const UNIT_TYPE_AR: Record<string, string> = { apartment: "شقة", annex: "شقة ملحق", studio: "استديو", room: "غرفة", shop: "محل", office: "مكتب", warehouse: "مستودع", land: "أرض", villa: "فيلا", other: "وحدة" };
const USAGE_AR: Record<string, string> = { families: "سكني — عوائل", singles: "سكني — عزّاب", mixed: "سكني تجاري", commercial: "تجاري" };
/** وصف الوحدة في المستندات: «شقة ملحق رقم 3 — 2 غرف · 1 دورة مياه · 2 مكيف» */
function unitDesc(t: any, p: any): string {
  const type = t.unit_type ? (UNIT_TYPE_AR[t.unit_type] || "وحدة") : unitLabel(p?.property_type);
  return `${type} رقم (${t.unit || "—"})${unitSpecs(t) ? ` — ${unitSpecs(t)}` : ""}`;
}
/**
 * عدادات العقار الرئيسية (schema-v68) — جدول بعددها ونوعها ووصفها ورقم حسابها.
 * يصل العقار هنا معقَّمًا (scrub)، فلا يُعاد تنظيف النص (القصّ قد يقطع كيانًا).
 * عقار بلا عدادات = لا شيء، فلا يتغيّر مستنده عمّا كان.
 */
function propertyMetersHTML(p: any, heading: (t: string) => string): string {
  const list: PropertyMeter[] = (Array.isArray(p?.meters) ? p.meters : [])
    .filter((m: any) => m && String(m.account || "").trim());
  if (!list.length) return "";
  return `
${heading("عدادات العقار الرئيسية")}
<div class="sub" style="margin-bottom:6px">${metersCountLine(list)} — العدادات المشتركة للعقار، غير عدادات الوحدات.</div>
<table>
  <thead><tr><th>النوع</th><th>الوصف</th><th>رقم الحساب</th></tr></thead>
  <tbody>
    ${list.map((m) => `<tr><td>${METER_TYPE_AR[m.type === "water" ? "water" : "elec"]}</td><td>${m.label || "—"}</td><td dir="ltr"><b>${m.account}</b></td></tr>`).join("")}
  </tbody>
</table>`;
}

/** المواصفات بالعدد الصحيح: «غرفتان · دورة مياه واحدة · 3 مكيفات» (كانت «2 غرف · 1 دورات مياه · 1 مكيف») */
function unitSpecs(t: any): string {
  return [Number(t?.rooms) > 0 ? countAr(t.rooms, "غرفة") : "", Number(t?.baths) > 0 ? countAr(t.baths, "دورة مياه") : "",
    Number(t?.acs) > 0 ? countAr(t.acs, "مكيف") : ""].filter(Boolean).join(" · ");
}

/**
 * الدخل المتوقع خلال اثني عشر شهرًا — من جدول الدفعات الفعلي.
 *
 * كان «الإيجار × دفعات السنة»، فيفترض أن كل عقد يدوم سنة: عقد ثلاثة أشهر
 * بتسعة آلاف يُعرض 36,000 في كشف العقار وتقرير المالك. والمالك يقرأ رقمًا
 * لن يصله.
 */
/**
 * ما يراه المالك من الدفعات — لا سجلّ عمليات المكتب.
 *
 * كان الجدول يعرض كل صفّ كما هو: صفوفًا سالبة بعنوان «تراجع عن دفعة»،
 * وملاحظات داخلية مثل «سُجّلت عبر بوت تليجرام». والمالك يقرأها فيسأل عن
 * سبب التراجع ومن سجّله، ويتحوّل تقرير حساب إلى مراجعة أداء للمكتب.
 *
 * القاعدة: نُسقِط كل عكسٍ مع دفعته المقابلة (فلا يبقى إلا ما استُلم فعلًا
 * ولم يُعكس)، ونحذف الملاحظات التشغيلية. المبلغ النهائي لا يتغيّر — لأن
 * الصفّين كانا يلغيان بعضهما في المجموع أصلًا.
 */
function ownerVisiblePayments<T extends { amount: number; paid_on: string; tenant_name?: string | null; note?: string | null }>(rows: T[]): T[] {
  return visiblePayments(rows);
}

/**
 * ما يراه قارئ أي مستند خارج — مالكًا كان أو مستأجرًا.
 *
 * القاعدة: الدفعة المعكوسة لم تحدث من منظور القارئ، فتسقط هي وعكسها معًا.
 * والمجموع لا يتغيّر لأن الصفّين كانا يلغيان بعضهما أصلًا.
 *
 * الاقتران بالربط أولًا (reverses — schema-v44)، ثم بالمستأجر والمبلغ
 * والتاريخ (العكس يتبع تاريخ أصله)، ثم بالمستأجر والمبلغ وحدهما للبيانات
 * الأقدم.
 *
 * وما لم يُقرن — عكسٌ لدفعة خارج الفترة — يبقى صفًّا بعبارة واضحة. كان
 * يُسقَط بصمت فيصير مجموع صفوف الجدول غير الإجمالي المكتوب تحته، ومن
 * يجمع بيده يجد رقمًا آخر.
 *
 * ولا معرّف خام ولا ملاحظة تشغيلية تخرج في أي مستند.
 */
export function visiblePayments<T extends { amount: number; paid_on: string; tenant_name?: string | null; note?: string | null }>(rows: T[]): T[] {
  const src = [...(rows || [])] as any[];
  const pos = src.map((x, k) => ({ x, k })).filter((o) => Number(o.x.amount) > 0);
  const neg = src.filter((x) => Number(x.amount) < 0);
  const dropped = new Set<number>();
  const who = (x: any) => String(x.tenant_id || x.tenant_name || "");
  const take = (pred: (x: any) => boolean) => {
    const o = pos.find((o) => !dropped.has(o.k) && pred(o.x));
    if (o) { dropped.add(o.k); return true; }
    return false;
  };
  const unmatched: any[] = [];
  for (const r of neg) {
    const amt = Math.abs(Number(r.amount));
    const ok =
      (r.reverses && take((x) => x.id === r.reverses)) ||
      take((x) => who(x) === who(r) && Math.abs(Number(x.amount) - amt) < 0.01 && x.paid_on === r.paid_on) ||
      take((x) => who(x) === who(r) && Math.abs(Number(x.amount) - amt) < 0.01);
    if (!ok) unmatched.push(r);
  }
  const INTERNAL = /تراجع|تليجرام|بوت|عكس دفعة|رصيد افتتاحي|تصحيح عدّاد/i;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const clean = (x: any) => {
    let note = x.note ? String(x.note).replace(UUID, "").trim() : x.note;
    if (note && INTERNAL.test(note)) note = null;
    return { ...x, note };
  };
  const kept = pos.filter((o) => !dropped.has(o.k)).map((o) => clean(o.x));
  const adjustments = unmatched.map((r) => ({ ...clean(r), note: "تصحيح لدفعة مسجَّلة سابقًا", _adjust: true }));
  return [...kept, ...adjustments].sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on))) as T[];
}

function annualExpected(tenants: any[]): number {
  return (tenants || []).reduce((a, t) => a + expectedNext12(t as any), 0);
}

const payMethod = (x: { method?: string | null; amount?: number | null }) =>
  Number(x.amount) < 0 ? "تصحيح" : methodAr(x.method);

type Issuer = { billing_name?: string | null; org_name?: string | null; vat_number?: string | null; cr_number?: string | null; billing_phone?: string | null;
  /** true لأي حساب بلا باقة مدفوعة — يُضاف سطر «أُنشئ عبر وثيق» في التذييل فقط.
   *  المستند صالح للاستعمال كاملًا، بلا علامة مائية ولا تقييد. */
  trial?: boolean | null;
  /** true إذا انتهت التجربة ولم يشترك — هنا فقط تعود العلامة المائية. */
  expired?: boolean | null;
  /* عتبات المكتب من الإعدادات: بدونها تُحسب حالات المستند بالافتراضات
     بينما الشاشة تحسبها بعتبات المكتب — فيقرأ المالك «منتظم» في تقرير
     مطبوع لوحدة يراها المكتب «تنتهي قريبًا». */
  due_soon_days?: number | null;
  due_imminent_days?: number | null;
  expiring_days?: number | null };

/** ثلاث حالات: مشترك = نظيف · تجربة نشطة = سطر المصدر · انتهت بلا اشتراك = علامة مائية */
type Mark = "none" | "brand" | "wm";
const markOf = (i?: Issuer | null): Mark => (i?.expired ? "wm" : i?.trial ? "brand" : "none");

/**
 * سياسة أمان المحتوى داخل المستند نفسه (30 سبتمبر 2026).
 *
 * المستند يُكتب في نافذة من أصل التطبيق نفسه (document.write / srcdoc)،
 * فأي سكربت يتسرّب إليه من اسم مستأجر أو ملاحظة يقرأ جلسة المستخدم. التهريب
 * هو الخط الأول؛ وهذه السياسة الخط الثاني: لا يعمل إلا سكربت يحمل رمز الـnonce
 * العشوائي لهذا المستند (أزرار الطباعة ورسم رمز QR) — والرمز يُولَّد عند
 * الإصدار فلا يعرفه نصّ خُزّن قبله. اخترناها بدل iframe معزول (sandbox):
 * العزل يمنع زرّ الطباعة في الطبقة البديلة على الآيفون من الوصول إلى الإطار.
 * رابط المالك العام يُرسل السياسة نفسها ترويسةً أيضًا (app/r/[token]).
 */
const NONCE_MARK = "__WQ_NONCE__";
const newNonce = (): string => {
  try {
    const b = new Uint8Array(16);
    (globalThis as any).crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
};
export const docCsp = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https://fonts.googleapis.com; ` +
  `img-src data: blob:; font-src data: https://fonts.gstatic.com; form-action 'self'; base-uri 'none'`;

const SHELL = (title: string, inner: string, mark: Mark = "none") => {
  const nonce = newNonce();
  /* السكربتات الثابتة تحمل nonce="__WQ_NONCE__" ويُستبدل هنا. نصّ المستخدم لا
     يستطيع إنتاج هذه السمة: علامة " فيه مُهرَّبة دائمًا. */
  return SHELL_RAW(title, inner, mark).split(`nonce="${NONCE_MARK}"`).join(`nonce="${nonce}"`)
    .replace(`content="${NONCE_MARK}"`, `content="${docCsp(nonce)}"`);
};
const SHELL_RAW = (title: string, inner: string, mark: Mark = "none") => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${NONCE_MARK}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">
<title>${title}</title>
<style>
  @page{size:A4;margin:14mm}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{max-width:100%;overflow-x:hidden}
  /* هوامش الجسم: بدونها يلتصق المحتوى بحافة النافذة ويُقصّ أول سطر في RTL */
  body{font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;color:#0B211F;line-height:1.7;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;word-wrap:break-word;
      padding:16px;max-width:900px;margin:0 auto}
  @media print{body{padding:0;max-width:none;margin:0}}
  *{box-sizing:border-box}
  .hd{background:#0E3A37;color:#EAF1EE;padding:18px 22px;border-radius:12px;display:table;width:100%;box-sizing:border-box}
  /* (30 سبتمبر 2026) اسم مكتب طويل كان يُقصّ على 375px: nowrap + overflow-x:hidden */
  .hd .lg{display:table-cell;vertical-align:middle;text-align:right}
  .hd .lg .seal{display:inline-block;vertical-align:middle;margin-inline-end:11px}
  .hd .lg>div:last-child{display:inline-block;vertical-align:middle}
  .seal{width:40px;height:40px;border-radius:10px;background:#0A2C2A;text-align:center;line-height:40px;color:#E7C877;font-weight:700;font-size:1.3rem;box-shadow:inset 0 0 0 2px rgba(231,200,119,.4)}
  .hd .t{font-weight:700;font-size:1.4rem;overflow-wrap:anywhere}
  .hd .meta{display:table-cell;vertical-align:middle;text-align:left;font-size:.8rem;color:#B9CCC7}
  .hd .meta b{color:#E7C877;display:block;font-size:1rem;overflow-wrap:anywhere}
  h1{font-size:1.25rem;margin:22px 0 4px;color:#0E3A37}
  h2{font-size:.95rem;margin:20px 0 8px;color:#0E3A37;font-weight:700;
      border-bottom:1px solid #E4DDCD;padding-bottom:5px}
  .sub{color:#5C6B67;font-size:.85rem;margin-bottom:16px}
  /* الهوامش السالبة كانت تدفع العنصر خارج النافذة، وoverflow-x:hidden يقصّه بلا تمرير */
  .grid{display:table;width:100%;border-collapse:separate;border-spacing:7px 0;margin:0 0 18px;table-layout:fixed}
  .box{display:table-cell;width:50%;vertical-align:top;border:1px solid #E4DDCD;border-radius:10px;padding:12px 14px;background:#FBF8F1}
  .box h3{font-size:.78rem;color:#8a5a11;margin-bottom:7px;font-weight:700}
  .box .r{display:table;width:100%;font-size:.84rem;padding:3px 0}
  .box .r span{display:table-cell}
  .box .r span:first-child{color:#5C6B67;text-align:right}
  .box .r span:last-child{font-weight:600;text-align:left;padding-inline-start:10px;overflow-wrap:anywhere}
  /* لا يُقسم صندوق أو صفّ بين صفحتين عند الطباعة */
  .box,.due,.note,.tot,.sign,tr{break-inside:avoid;page-break-inside:avoid}
  table{width:100%;border-collapse:collapse;font-size:.83rem;margin-bottom:16px}
  /* جدول أعرض من الشاشة يُمرَّر بدل أن يُقصّ */
  .scrollx{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:16px}
  .scrollx table{margin-bottom:0;min-width:520px}
  @media print{.scrollx{overflow:visible}.scrollx table{min-width:0}}
  th{background:#F3EEE2;padding:8px 10px;text-align:right;font-weight:700;border-bottom:2px solid #E4DDCD;font-size:.78rem}
  td{padding:8px 10px;border-bottom:1px solid #EFE9DA}
  tr:last-child td{border-bottom:0}
  .pill{font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:6px;display:inline-block}
  .pill.p{background:#E6F4EC;color:#137a50}
  .pill.l{background:#FBE9E7;color:#a5322c}
  .pill.u{background:#F3EEE2;color:#5C6B67}
  .tot{display:table;width:100%;border-collapse:separate;border-spacing:5px 0;margin:0 0 18px;table-layout:fixed}
  .tot>div{display:table-cell;vertical-align:top;border:1px solid #E4DDCD;border-radius:10px;padding:11px;text-align:center;background:#FBF8F1}
  .tot .v{font-weight:700;font-size:1.15rem;color:#0E3A37}
  .tot .v.g{color:#1E9E6A}.tot .v.r{color:#D0453F}
  .tot .l{font-size:.7rem;color:#5C6B67;margin-top:3px}
  .due{background:#0E3A37;color:#EAF1EE;border-radius:12px;padding:16px 20px;display:table;width:100%;box-sizing:border-box;margin-bottom:18px}
  .due .l{display:table-cell;vertical-align:middle;text-align:right;font-size:.85rem;color:#B9CCC7}
  .due .v{display:table-cell;vertical-align:middle;text-align:left;font-weight:700;font-size:1.7rem;color:#E7C877;white-space:nowrap;padding-inline-start:14px}
  .note{border-inline-start:3px solid #B8791F;background:#FBF1DF;padding:11px 14px;border-radius:8px;font-size:.78rem;color:#8a5a11;margin-bottom:14px}
  .sign{display:table;width:100%;border-collapse:separate;border-spacing:15px 0;margin:26px 0 0;font-size:.82rem;table-layout:fixed}
  .sign>div{display:table-cell;width:50%;vertical-align:top;border-top:1px solid #E4DDCD;padding-top:8px;color:#5C6B67}
  .ft{margin-top:22px;border-top:1px solid #E4DDCD;padding-top:12px;font-size:.68rem;color:#5C6B67;line-height:1.6;text-align:center}
  .noprint{margin:18px 0;text-align:center}
  .noprint button{margin:0 4px}
  .noprint button{font-family:inherit;font-weight:600;font-size:.9rem;padding:10px 20px;border-radius:9px;border:0;cursor:pointer}
  .noprint .a{background:#0E3A37;color:#F6F1E4}
  .noprint .b{background:#fff;color:#0E3A37;border:1px solid #E4DDCD}
  @media print{.noprint{display:none}}
  /* الجوال (أقل من 480px): الترويسة والصندوقان المتجاوران والمربّعات تتراكب بدل أن تفيض */
  @media screen and (max-width:480px){
    body{padding:10px}
    .hd,.hd .lg,.hd .meta{display:block}
    .hd .meta{text-align:right;margin-top:10px}
    .grid,.sign{display:block}
    .grid .box,.sign>div{display:block;width:100%;margin-bottom:8px}
    .tot{display:flex;flex-wrap:wrap;gap:5px}
    .tot>div{display:block;flex:1 1 42%}
    .due,.due .l,.due .v{display:block;text-align:right}
    .due .v{padding:6px 0 0}
  }
  /* ── سطر المصدر: تجربة نشطة ── */
  .madeby{margin:18px 0 0;padding-top:9px;border-top:1px solid #E4DDCD;
      font-size:.72rem;color:#8C8579;text-align:center;letter-spacing:.2px}
  .madeby b{font-weight:700;color:#6E675C}
  /* ── علامة مائية: انتهت التجربة بلا اشتراك ── */
  .wm{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9999;pointer-events:none;
      display:flex;align-items:center;justify-content:center}
  .wm span{transform:rotate(-32deg);font-size:3.6rem;font-weight:800;letter-spacing:2px;
      color:rgba(208,69,63,.14);border:6px solid rgba(208,69,63,.14);
      padding:16px 46px;border-radius:18px;white-space:nowrap}
  .trialbar{background:#FBE9E7;border:1px solid #F5C6C2;color:#8f2b26;border-radius:10px;
      padding:11px 15px;margin:14px 0 0;font-size:.82rem;font-weight:600;line-height:1.75}
</style></head><body>
<div class="noprint"><button class="a" id="wq-print" type="button">🖨️ طباعة / حفظ PDF</button><button class="b" id="wq-close" type="button">إغلاق</button></div>
<script nonce="${NONCE_MARK}">(function(){var p=document.getElementById("wq-print"),c=document.getElementById("wq-close");if(p)p.addEventListener("click",function(){window.print()});if(c)c.addEventListener("click",function(){window.close()});})();</script>
${mark === "wm" ? `<div class="wm"><span>نسخة تجريبية — غير معتمدة</span></div>` : ""}
${inner}
${mark === "brand" ? `<div class="madeby">أُنشئ عبر <b>وثيق</b> · watheqapp.com</div>` : ""}
${mark === "wm" ? `<div class="trialbar">
  انتهت فترة التجربة المجانية ولم يُفعَّل اشتراك، لذا تخرج المستندات بعلامة «نسخة تجريبية».
  لإصدار نسخة نهائية بلا علامة: فعّل اشتراكك عبر watheqdocs@gmail.com
</div>` : ""}
</body></html>`;

/** إعدادات الضريبة الخاصة بالعقار */
/**
 * رمز QR للفاتورة الضريبية المبسطة — «فاتورة» المرحلة الأولى (إصدار).
 * TLV بخمس خانات: اسم البائع، الرقم الضريبي، وقت الإصدار ISO،
 * الإجمالي شامل الضريبة، مبلغ الضريبة — ثم Base64.
 * بلا btoa: نبني Base64 يدويًّا حتى يعمل في المتصفح وخارجه سواء.
 */
function zatcaTlvBase64(sellerName: string, vatNo: string, isoDateTime: string, total: number, vat: number): string {
  const enc = new TextEncoder();
  const fields = [sellerName, vatNo, isoDateTime, total.toFixed(2), vat.toFixed(2)];
  const parts: number[] = [];
  fields.forEach((val, i) => {
    const b = Array.from(enc.encode(val));
    parts.push(i + 1, b.length, ...b);
  });
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < parts.length; i += 3) {
    const a = parts[i], b = parts[i + 1], c = parts[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
        + (b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)])
        + (c === undefined ? "=" : B64[c & 63]);
  }
  return out;
}

/**
 * صندوق QR داخل الفاتورة. الرسم عبر مكتبة qrcodejs من CDN داخل نافذة
 * الطباعة؛ وإن تعذّرت الشبكة يبقى نص Base64 ظاهرًا — وهو المحتوى
 * النظامي نفسه، فالفاتورة لا تفقد صلاحيتها بغياب الرسم.
 */
function zatcaQrBlock(sellerName: string, vatNo: string, total: number, vat: number, at?: string | null): string {
  /* (مراجعة 29 سبتمبر 2026)
     • الاسم يدخل الرمز كما سُجّل لا مُهرَّبًا: «شركة أ & ب» كان يُرمَّز
       «شركة أ &amp; ب» فلا يطابق الاسم لدى الهيئة.
     • طول الحقل بايت واحد في TLV: اسمٌ فوق 255 بايت (نحو 128 حرفًا عربيًّا)
       يُفسد الرمز كله — يُقصّ على حدّ حرفٍ كامل.
     • الوقت: وقت إصدار الفاتورة الأصلي عند إعادة الطباعة (at)، لا لحظة
       الطباعة؛ وبلا أجزاء الثانية كأمثلة الهيئة. */
  let name = unesc(sellerName);
  const enc = new TextEncoder();
  while (enc.encode(name).length > 255) name = Array.from(name).slice(0, -1).join("");
  const when = at && !isNaN(Date.parse(at)) ? new Date(at) : new Date();
  const tlv = zatcaTlvBase64(name, vatNo, when.toISOString().replace(/\.\d{3}Z$/, "Z"), total, vat);
  return `
<div style="display:flex;justify-content:flex-end;margin-top:14px">
  <div style="text-align:center">
    <div id="zatca-qr" style="width:120px;height:120px;margin-inline-start:auto"></div>
    <div style="font-size:8px;color:#8A8477;max-width:200px;word-break:break-all;margin-top:4px" id="zatca-tlv" title="محتوى رمز الاستجابة السريعة (TLV/Base64) — يُرسم رمزًا عند توفر الاتصال">${tlv}</div>
  </div>
</div>
<script nonce="${NONCE_MARK}" src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
<script nonce="${NONCE_MARK}">(function(){
  /* حمولة زاتكا تبقى مخفية دائمًا: كانت تظهر نصًّا خامًا طويلًا لو تعذّر
     تحميل مكتبة الرمز (شبكة ضعيفة أو حجب CDN)، فتخرج الفاتورة مشوّهة أمام
     المستأجر. الآن إمّا رمز سليم أو سطر يشرح، ولا شيء بينهما. */
  var tlv=document.getElementById("zatca-tlv");
  if(tlv) tlv.style.display="none";
  try{
    new QRCode(document.getElementById("zatca-qr"),{text:tlv.textContent,width:120,height:120,correctLevel:QRCode.CorrectLevel.M});
  }catch(e){
    var box=document.getElementById("zatca-qr");
    if(box) box.innerHTML='<span style="font-size:.62rem;color:#8A8477">رمز الاستجابة السريعة يظهر عند فتح المستند متصلًا بالإنترنت</span>';
  }
})();<\/script>`;
}

/** إعدادات الضريبة — وإن مُرّرت الوحدة تُقرَّر بحسبها (العمارة المختلطة) */
const vatOf = (p: Property, t?: { unit_type?: string | null; vat_mode?: string | null } | null) => ({
  enabled: t ? unitVatApplies(t, p) : !!p.vat_enabled,
  rate: Number(p.vat_rate) || 15, inclusive: p.vat_inclusive !== false,
});
/**
 * المتأخر كما يُطالَب به فعلًا — مصدرٌ واحد لكل المستندات (مراجعة 29 سبتمبر 2026).
 *
 * amountDue يُحسب من الإيجار المخزَّن. في «شاملة» الإيجار المخزَّن فيه الضريبة،
 * وفي «مضافة فوق الإيجار» هو قبل الضريبة. فكانت المستندات تطبع 30,000 على
 * معرضٍ متأخر ثلاث دفعات بـ10,000 والمطالَب به 34,500 — والكشف نفسه يقول في
 * سطرٍ فوقه «المتأخر (شامل الضريبة) 34,500». لا تغيير في «شاملة» ولا بلا ضريبة.
 */
const dueIncl = (st: { amountDue?: number | null }, v: { enabled: boolean; rate: number; inclusive: boolean }) =>
  v.enabled ? splitVat(Number(st.amountDue) || 0, v).total : (Number(st.amountDue) || 0);
/**
 * الضريبة في الدفعات المسجَّلة — داخلها أم فوقها.
 *
 * في وضع «شاملة» الدفعة المسجَّلة فيها الضريبة (11,500 = 10,000 + 1,500).
 * وفي «غير شاملة» يُسجَّل الإيجار قبل الضريبة (زرّ الدفعة الكاملة يسجّل
 * rent_amount، والعدّاد يعدّ به)، والمستأجر دفع الضريبة فوقه. كانت
 * المواضع الثلاثة تعامل الحالتين كأن الضريبة داخل المبلغ، فتطرحها منه:
 * إيراد المالك يظهر 85% من حقيقته، و«إجمالي المقبوض» أقل مما قبضه المكتب.
 */
export type PastVat = Record<string, { unit_type?: string | null; vat_mode?: string | null }>;
/** إعدادات الضريبة للمستأجرين السابقين — من نسخة صفّهم المحفوظة في الأرشيف */
export function pastVatOf(rows: { id: string; snapshot?: any }[] | null | undefined): PastVat {
  const out: PastVat = {};
  for (const r of rows || []) out[r.id] = { unit_type: r.snapshot?.unit_type ?? null, vat_mode: r.snapshot?.vat_mode ?? null };
  return out;
}
function vatOfPayments(p: Property & { tenants?: any[] },
  payments: { amount: number | string; unit?: string | null; tenant_id?: string | null; past_tenancy_id?: string | null }[],
  pastVat?: PastVat): { inside: number; onTop: number } {
  /* ضريبة كل دفعة بإعدادات من دفعها — لا من يسكن الوحدة الآن. كان مستأجر
     سابق معفًى تُحسب على دفعاته ضريبة لأن من خلفه خاضع (والعكس). */
  const byUnit: Record<string, any> = {}, byId: Record<string, any> = {};
  (p.tenants || []).forEach((t: any) => { if (t.unit) byUnit[String(t.unit)] = t; if (t.id) byId[t.id] = t; });
  let inside = 0, onTop = 0;
  for (const x of payments || []) {
    const t = (x.past_tenancy_id && pastVat?.[x.past_tenancy_id])
      || (x.tenant_id && byId[x.tenant_id])
      || (x.unit ? byUnit[String(x.unit)] : null);
    if (!t) continue;
    const v = vatOf(p, t);
    if (!v.enabled) continue;
    const sp = splitVat(Number(x.amount) || 0, v);
    if (v.inclusive) inside += sp.vat; else onTop += sp.vat;
  }
  return { inside: Math.round(inside * 100) / 100, onTop: Math.round(onTop * 100) / 100 };
}

/** للاستعمال خارج هذا الملف (كشف التحصيل) — الضريبة بإعدادات من دفع */
export const vatOfPaymentsFor = (p: Property & { tenants?: any[] }, payments: any[], pastVat?: PastVat) => vatOfPayments(p, payments, pastVat);

/**
 * سجل الوحدات — لكل وحدة بطاقة: نوعها ووصفها، والمستأجر، والإيجار (الدفعة ×
 * الدورة = السنوي)، ومدة العقد، ومسدَّد حتى متى، والقادمة، والمتأخر. والشاغرة:
 * منذ متى وبآخر إيجار. وفوقها ملخّص العمارة بدالة «دخل العمارة» نفسها في صفحة
 * العقار — فلا يرى المالك رقمًا غير الذي يراه المكتب.
 *
 * طلب مكتب: «بعض الملّاك لا يدري الشقة أو المحل، وصفها، وكم إيجارها». كان
 * تقرير العمارة جدولًا بسبعة أعمدة بلا نوع ولا وصف ولا سنوي، والكشف المجمّع
 * جدولًا عريضًا لا يُقرأ على الجوال — والملّاك يفتحون الرابط على الجوال.
 * بطاقات تلتفّ على أي عرض، وتُطبع اثنتين في السطر. لا جوال المستأجر ولا هويته.
 */
function unitsRegisterHTML(p: any, tenants: any[], g: any, issuer: any = {}): string {
  /* نسخة ثالثة من حلّ العتبات كانت هنا — الآن من lib/contract-state وحده.
     و`g` تصل محلولةً أصلًا، فنُبقيها إن جاءت كاملة ونحلّها إن لم تكن. */
  const win = (g && g.soonDays && g.imminentDays && g.expiringDays)
    ? g : statusWindows(p, issuer);
  const rr = annualRentRoll(tenants);
  const kinds: Record<string, number> = {};
  for (const t of tenants) { const k = t.unit_type ? (UNIT_TYPE_AR[String(t.unit_type)] || "وحدة") : unitLabel(p.property_type); kinds[k] = (kinds[k] || 0) + 1; }
  const kindLine = Object.entries(kinds).map(([k, n]) => countAr(n, k)).join(" · ");
  /* (30 سبتمبر 2026) الدخل السنوي بلا ضريبة: الضريبة أمانة للهيئة لا دخل للمالك،
     وannualRentRoll يجمع الإيجار المخزَّن (شاملًا الضريبة في وضع «شاملة»). نفس
     شرط الإدخال: مشغولة بعقد سارٍ. */
  const annualBase = Math.round(tenants.reduce((a, t) => {
    if (isVacant(t)) return a;
    const cs = contractState(t, {});
    if (cs.daysToEnd !== null && cs.daysToEnd < 0) return a;
    const per = defaultTermPeriods((t.payment_frequency || "monthly") as any) || 0;
    return a + splitVat(Number(t.rent_amount) || 0, vatOf(p, t)).base * per;
  }, 0));
  const anyVat = tenants.some((t) => vatOf(p, t).enabled);
  const incomeOf = PROP_THE[String(p.property_type || "")] || "العقار";
  const sorted = [...tenants].sort((a, b) => String(a.unit || "").localeCompare(String(b.unit || ""), "ar", { numeric: true }));
  const KV = (k: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-top:1px dashed #E3E8E6"><span style="color:#5C6B67">${k}</span><span style="text-align:left">${v}</span></div>`;
  const card = (t: any) => {
    const vac = isVacant(t); const st = contractState(t, win);
    const type = t.unit_type ? (UNIT_TYPE_AR[String(t.unit_type)] || "وحدة") : unitLabel(p.property_type);
    /* العدد يطابق المعدود: غرفة واحدة · غرفتان · 3 غرف · 11 غرفة (countAr) */
    const desc = unitSpecs(t);
    const inst = splitVat(Number(t.rent_amount) || 0, vatOf(p, t)).total;
    const perYear = defaultTermPeriods((t.payment_frequency || "monthly") as any) || 0;
    const annual = Math.round(inst * perYear * 100) / 100;
    const hij = (d?: string | null) => (String(t.calendar) === "hijri" && d ? ` <span style="font-size:.7em;color:#5C6B67">(${hijriText(d)})</span>` : "");
    /* الشارة نفسها التي في اللوحة (unitStatus) — والعقد المنتهي يُسمّى باسمه */
    const key = unitStatus(t, st as any);
    const PC: Record<string, string> = { late: "l", partial: "l", due: "u", soon: "u", expiring: "u", incomplete: "u", ok: "p" };
    const pill = `<span class="pill ${PC[key] || ""}">${unitStatusLabel(key, st)}</span>`;
    let body = "";
    if (vac) {
      const vd = vacancyDays(t.move_out_date);
      /* «منذ 3 يومًا» → «منذ 3 أيام»، و«منذ 0 يومًا» → «منذ اليوم» */
      body += KV("شاغرة منذ", vd !== null ? `${daysOrToday(vd)}${t.move_out_date ? ` (${arDate(t.move_out_date)})` : ""}` : "—");
      if (Number(t.rent_amount) > 0) body += KV("آخر إيجار", `${sar(inst)} ${freqLabel(t.payment_frequency)} = <b>${sar(annual)}</b> سنويًّا`);
      const owed = dueIncl({ amountDue: st.legacyArrears || 0 }, vatOf(p, t)) + (Number(t.carried_debt) || 0);
      if (owed > 0) body += KV("على المستأجر السابق", `<b style="color:#a5322c">${sar(owed)}</b>`);
    } else {
      const sched = buildSchedule(t as any);
      const paidN = Math.min(Number(t.paid_periods) || 0, sched.length);
      body += KV("المستأجر", String(t.name || "—"));
      body += KV("الإيجار", `${sar(inst)} ${freqLabel(t.payment_frequency)} = <b>${sar(annual)}</b> سنويًّا`);
      body += KV("العقد", `${arDate(t.contract_start)}${hij(t.contract_start)} ← ${arDate(st.endDate)}${hij(st.endDate)}`);
      body += KV("مسدَّد حتى", paidN > 0 ? `دفعة ${arDate(sched[paidN - 1].date)}${hij(sched[paidN - 1].date)} <span style="color:#5C6B67">(${paidN} من ${sched.length})</span>` : "لم تُسدَّد دفعة من هذا العقد");
      /* «القادمة» لتاريخ حلّ أو مضى تُقرأ «لم تحن بعد» — فتُسمّى «مستحقة» */
      if (st.upcomingDate) body += KV(st.upcomingDate <= today() ? "مستحقة" : "القادمة", `${arDate(st.upcomingDate)}${hij(st.upcomingDate)} · ${sar(inst)}`);
      const due = dueIncl(st, vatOf(p, t)), car = Number(t.carried_debt) || 0;
      /* «المتأخر 0 + 4,000 دين مرحَّل» يُقرأ متناقضًا — الصفر لا يُطبع */
      body += KV("المتأخر", due + car > 0
        ? (due > 0 ? `<b style="color:#a5322c">${sar(due)}</b>${car > 0 ? ` <span style="color:#9A4B00">+ ${sar(car)} دين مرحَّل</span>` : ""}`
          : `<span style="color:#9A4B00"><b>${sar(car)}</b> دين مرحَّل من مدة سابقة</span>`)
        /* في فترة السماح: مستحق لم يتأخر بعد — كما تقول اللوحة، لا «لا شيء» وحدها */
        : st.inGrace ? `<span style="color:#9A4B00">لا شيء بعد — فترة سماح ${st.graceDaysLeft > 0 ? `(${daysAr(st.graceDaysLeft, true)})` : ""}</span>`
        : `<span style="color:#137a50">لا شيء</span>`);
    }
    /* عدادا الوحدة (v15) — للشاغرة والمؤجّرة: الرقم يتبع الوحدة لا المستأجر */
    if (t.elec_account) body += KV("عداد الكهرباء", `<span dir="ltr">${t.elec_account}</span>`);
    if (t.water_account) body += KV("عداد الماء", `<span dir="ltr">${t.water_account}</span>`);
    return `<div style="border:1px solid #D9E2DF;border-radius:10px;padding:8px 10px;break-inside:avoid;page-break-inside:avoid">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><b>${type} ${t.unit || "—"}</b>${pill}</div>
      ${desc ? `<div style="font-size:.78em;color:#5C6B67;margin:2px 0 4px">${desc}</div>` : `<div style="height:4px"></div>`}
      <div style="font-size:.82em">${body}</div></div>`;
  };
  return `<div class="box" style="margin-bottom:8px">
    <div class="r"><span>الوحدات</span><span>${Object.keys(kinds).length > 1 ? `<b>${tenants.length}</b> — ${kindLine}` : `<b>${kindLine || tenants.length}</b>`}</span></div>
    <div class="r"><span>مؤجّرة بعقد سارٍ</span><span>${rr.occupied}${rr.vacant ? ` · شاغرة ${rr.vacant}` : ""}${rr.expired ? ` · انتهى عقدها ولم يُجدَّد ${rr.expired}` : ""}</span></div>
    <div class="r"><span>دخل ${incomeOf} السنوي</span><span><b>${sar(annualBase)}</b> ريال <span style="font-size:.72rem;color:#5C6B67">(إيجار سنة بالعقود السارية${anyVat ? "، قبل الضريبة" : ""})</span></span></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px">${sorted.map(card).join("")}</div>`;
}

/** «دخل العمارة» كان ثابتًا حتى لمعرض أو فيلا — الاسم بنوع العقار */
const PROP_THE: Record<string, string> = { residential: "العمارة", showroom: "المعرض", office: "المبنى", warehouse: "المستودع", villa: "الفيلا", land: "الأرض" };

/** فترة السماح الخاصة بالعقار */
/** عتبات العقار مع عتبات المكتب — التعريف في lib/contract-state */
const winOf = (p: Property, issuer?: Issuer | null) => statusWindows(p as any, issuer as any);

/* لا يُهرِّب مرتين (مراجعة 29 سبتمبر 2026): المدخلات تمرّ على scrub أولًا ثم
   تصل هنا، فكان «شركة أ & ب» يُطبع «شركة أ &amp; ب» في رأس كل مستند وتذييله.
   & التي تبدأ كيانًا مكتملًا تُترك؛ غيرها يُهرَّب كما كان. */
function escH(s: any): string {
  return String(s ?? "").replace(/&(?!(?:amp|lt|gt|quot|#39|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** عكس scrub — للنصّ الذي يدخل رمز QR لا صفحة HTML */
const unesc = (s: any) => String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** اسم المكتب كما سجّله: اسم الفوترة أولًا ثم اسم المنشأة */
const issuerName = (i?: Issuer | null): string =>
  String((i as any)?.billing_name || (i as any)?.org_name || "").trim();

/**
 * ترويسة المستند = هوية **المكتب**، لا هوية وثيق.
 *
 * كانت ثابتة: ختم «و» واسم «وثيق» في صدر كل مستند تُصدره المكاتب — ومنها
 * رابط المالك الذي يفتحه مالك العقار وهو لا يعرف وثيق أصلًا، فيصل المستند
 * وكأن مُصدِره وثيق واسم المكتب سطر في المتن. اشتكى منها مكتب مشترك
 * (28 سبتمبر 2026) وهو محقّ: المُصدِر هو المكتب، ووثيق الأداة التي أعدّته.
 *
 * فإن سجّل المكتب اسمه فهو الترويسة، وأول حرف من اسمه هو الختم. وإن لم
 * يُسجَّل اسم بعد تبقى ترويسة وثيق كما كانت — فلا يخرج مستند بلا هوية.
 * وفاتورة الاشتراك تُستثنى: مُصدِرها وثيق فعلًا (تُستدعى بلا issuer).
 */
const header = (docTitle: string, docNo: string, issuer?: Issuer | null, date?: string | null) => {
  const name = issuerName(issuer);
  /* الختم حرف واحد: «مكتب تميز» → «ت» لا «م» */
  const seal = name ? (name.replace(/^(مكتب|شركة|مؤسسة|وكالة)\s+/, "").trim()[0] || name[0]) : "و";
  return `
<div class="hd">
  <div class="lg"><div class="seal">${escH(seal)}</div><div><div class="t">${escH(name || "وثيق")}</div></div></div>
  <div class="meta">${docTitle}<b>${docNo}</b>التاريخ: ${arDate(date || today())}</div>
</div>`;
};

/**
 * التذييل: بيانات تواصل **المكتب** لا وثيق.
 *
 * كان يضع بريد وثيق ورقمها ورقم وثيقة العمل الحر في مستند يسلّمه المكتب
 * لمالكه أو مستأجره — أي أننا نضع قناة اتصالنا أمام عميل المكتب. يبقى
 * سطر إخلاء المسؤولية لأنه يحمي الطرفين، ويُختصر إلى سطر واحد هادئ.
 * وبلا مكتب (فاتورة اشتراك وثيق) يعود التذييل الأصلي كاملًا.
 */
const footer = (issuer?: Issuer | null) => {
  const name = issuerName(issuer);
  if (!name) return `
<div class="ft">
  صدر هذا المستند عبر منصة وثيق — أداة تنظيمية لإدارة الأملاك.<br>
  وثيق لا يقدّم خدمات قانونية أو محاسبية، ولا يستلم أو يحوّل أي مبالغ. هذا المستند للاستخدام الإداري بين الطرفين، ومسؤولية اعتماده على مُصدِره.<br>
  <b>وثيقة عمل حر رقم FL-763162251</b> — وزارة الموارد البشرية والتنمية الاجتماعية<br>
  watheqdocs@gmail.com · تليجرام: ‎+966550165210
</div>`;
  const phone = String((issuer as any)?.billing_phone || "").trim();
  const cr = String((issuer as any)?.cr_number || "").trim();
  const line = [escH(name), phone ? escH(phone) : "", cr ? `س.ت ${escH(cr)}` : ""].filter(Boolean).join(" · ");
  return `
<div class="ft">
  <b>${line}</b><br>
  مستند إداري صادر عن ${escH(name)} للاستخدام بين الطرفين، ومسؤولية اعتماده على مُصدِره.<br>
  أُعدّ عبر منصة وثيق — أداة تنظيمية لا تقدّم خدمات قانونية أو محاسبية، ولا تستلم ولا تحوّل أي مبالغ.
</div>`;
};

/** كشف حساب مستأجر — كامل الدفعات والأرصدة */
/**
 * كشف حساب المستأجر بنمطين:
 *  - brief  (مختصر): بيانات العقد الأساسية + الملخص المالي + الرصيد + المدفوعات المستلمة.
 *  - full   (شامل): كل ذلك + مواصفات الوحدة والعدادات وحسابات المرافق + جدول كل الدفعات
 *    بحالاتها + استخدام العقار والمالك. بعض الملّاك يريدونه كاملًا للتوثيق، وبعضهم صفحة واحدة.
 */
export function statementHTML(t: Tenant, p: Property, issuer: Issuer = {}, payments: PaymentRow[] = [], mode: "brief" | "full" = "full") {
  // تعقيم المدخلات (انظر scrub أعلاه)
  t = scrub(t);
  p = scrub(p);
  issuer = scrub(issuer);
  payments = scrub(payments);
  /* الكشف يُرسل للمستأجر: الدفعة المعكوسة وعكسها يسقطان معًا، ولا معرّف
     ولا ملاحظة تشغيلية تخرج. والإجمالي يبقى من الدفتر كاملًا — فهو واحد. */
  const shownPays = visiblePayments(payments as any[]);
  const st = contractState(t, winOf(p, issuer));
  const rows = buildSchedule(t);
  const ul = unitWordFor((t as any).unit_type, p.property_type);
  const who = issuer.billing_name || issuer.org_name || p.manager || "إدارة الأملاك";
  const v = vatOf(p, t);
  const unit = splitVat(Number(t.rent_amount) || 0, v);      // تفصيل الدفعة الواحدة
  const totalContract = unit.total * rows.length;
  /* (30 سبتمبر 2026) السداد الجزئي بالضريبة كبقية الأرقام: في «غير شاملة» كان
     يُطبع قبل الضريبة (5,000) بجوار دفعات شاملة (11,500)، و«المسدَّد» لا يشمله
     أصلًا — فالمسدَّد + المتأخر لا يساوي قيمة ما حلّ. */
  const partialIncl = st.hasPartial ? splitVat(Number(st.partial) || 0, v).total : 0;
  const totalPaid = Math.round((st.paid * unit.total + partialIncl) * 100) / 100;
  const dueSplit = splitVat(st.amountDue, v);                 // تفصيل الرصيد المستحق
  /* حالة صفّ الجدول من contractState لا من buildSchedule: الجدول كان يَسِم قسطًا
     حلّ اليوم (داخل فترة السماح) «متأخرة» والمربّع فوقه يقول «0 متأخرة». القسط
     متأخر فقط إن كان ضمن ما حلّ بعد السماح (st.due). */
  const rowStatus = (r: { n: number; status: string }) =>
    r.status === "late" && r.n > (Number(st.due) || 0) ? "grace" : r.status;
  /* الدين المرحَّل من مدة سابقة: كان غائبًا عن الكشف كله، فيستلم المستأجر
     كشفًا لا يذكر 4,500 عليه. الآن سطرٌ ظاهر، ويدخل الرصيد الإجمالي. */
  const carried = Math.max(0, Number((t as any).carried_debt) || 0);
  const balance = Math.round((dueIncl(st, v) + carried) * 100) / 100;

  const body = `
${header(mode === "full" ? "كشف حساب شامل" : "كشف حساب مختصر", `${t.name}`, issuer)}
<h1>كشف حساب ${ul} رقم (${t.unit || "—"})</h1>
<div class="sub">${p.name}${p.address ? ` — ${p.address}` : ""}${p.city ? `، ${p.city}` : ""} · ${typeLabel(p.property_type)}</div>

<div class="grid">
  <div class="box">
    <h3>بيانات المؤجّر</h3>
    <div class="r"><span>الاسم</span><span>${who}</span></div>
    ${issuer.cr_number ? `<div class="r"><span>السجل التجاري</span><span>${issuer.cr_number}</span></div>` : ""}
    ${issuer.vat_number ? `<div class="r"><span>الرقم الضريبي</span><span>${issuer.vat_number}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>بيانات المستأجر</h3>
    <div class="r"><span>الاسم</span><span>${t.name}</span></div>
    ${t.national_id ? `<div class="r"><span>الهوية / السجل</span><span>${t.national_id}</span></div>` : ""}
    ${t.phone ? `<div class="r"><span>الجوال</span><span>${t.phone}</span></div>` : ""}
    <div class="r"><span>${ul}</span><span>${t.unit || "—"}</span></div>
  </div>
</div>

<div class="grid">
  <div class="box">
    <h3>بيانات العقد</h3>
    ${t.contract_no ? `<div class="r"><span>رقم العقد</span><span dir="ltr"><b>${t.contract_no}</b></span></div>` : ""}
    <div class="r"><span>الوحدة</span><span>${unitDesc(t, p)}</span></div>
    ${p.usage ? `<div class="r"><span>استخدام العقار</span><span>${USAGE_AR[String(p.usage)] || p.usage}</span></div>` : ""}
    ${t.first_due ? `<div class="r"><span>أول استحقاق</span><span>${arDateH(t.first_due)}</span></div>` : ""}
    <div class="r"><span>بداية العقد</span><span>${arDateH(t.contract_start)}</span></div>
    <div class="r"><span>نهاية العقد</span><span>${arDateH(st.endDate)}</span></div>
    <div class="r"><span>دورة السداد</span><span>${freqLabel(t.payment_frequency)}</span></div>
    <div class="r"><span>قيمة الدفعة${v.enabled ? " (شاملة الضريبة)" : ""}</span><span>${sar(unit.total)} ريال</span></div>
    ${v.enabled ? `<div class="r"><span>منها إيجار أساسي</span><span>${sar(unit.base)} ريال</span></div>
    <div class="r"><span>ضريبة القيمة المضافة (${v.rate}%)</span><span>${sar(unit.vat)} ريال</span></div>` : ""}
  </div>
  <div class="box">
    <h3>ملخّص مالي</h3>
    <div class="r"><span>إجمالي قيمة العقد</span><span>${sar(totalContract)} ريال</span></div>
    <div class="r"><span>المسدَّد${v.enabled ? " (شامل الضريبة)" : ""}</span><span>${sar(totalPaid)} ريال</span></div>
    ${/* «غير شاملة»: المتأخر المسجَّل قبل الضريبة، والمستأجر مطالَب بها فوقه.
         كان الكشف يقول «المتأخر 10,000 — منه ضريبة 1,500» والمطالَب به 11,500. */ ""}
    <div class="r"><span>المتأخر${v.enabled ? " (شامل الضريبة)" : ""}</span><span>${sar(v.enabled ? dueSplit.total : st.amountDue)} ريال</span></div>
    ${v.enabled && st.amountDue > 0 ? `<div class="r"><span>منه ضريبة</span><span>${sar(dueSplit.vat)} ريال</span></div>` : ""}
    ${st.hasPartial ? `<div class="r"><span>منه سداد جزئي${v.enabled ? " (شامل الضريبة)" : ""}</span><span>${sar(partialIncl)} ريال</span></div>` : ""}
    ${carried > 0 ? `<div class="r"><span>دين مرحَّل من مدة سابقة</span><span>${sar(carried)} ريال</span></div>` : ""}
    ${/* كانت «الدفعة القادمة» تعرض أقدم دفعة غير مسدَّدة — تاريخًا ماضيًا حين
         يكون على المستأجر متبقٍّ من دفعة سابقة. والكشف يُرسل للمستأجر نفسه.
         الآن: المتأخر بتاريخه، والقادمة بتاريخها الحقيقي. */
      st.amountDue > 0 && st.nextDueDate && (st.daysToNextDue ?? 0) < 0
        ? `<div class="r"><span>متأخر منذ</span><span>${arDate(st.nextDueDate)}</span></div>` : ""}
    ${/* غياب الحقل (undefined) غير انعدام الدفعات (null): الأول يعني نسخة أقدم
         من contracts.ts لم تحسبه — فنعود للتاريخ القديم بدل أن نقول للمستأجر
         كذبًا «لا دفعات قادمة». */ ""}
    <div class="r"><span>الدفعة القادمة</span><span>${
      st.upcomingDate ? arDate(st.upcomingDate)
      : st.upcomingDate === null
        ? (st.endDate && (st.daysToEnd ?? -1) >= 0 ? `مع تجديد العقد (ينتهي ${arDate(st.endDate)})` : "لا دفعات قادمة في العقد")
      : arDate(st.nextDueDate)}</span></div>
  </div>
</div>

<div class="tot">
  <div><div class="v">${rows.length}</div><div class="l">إجمالي الدفعات</div></div>
  <div><div class="v g">${st.paid}</div><div class="l">مسدّدة</div></div>
  <div><div class="v r">${st.unpaid}</div><div class="l">متأخرة</div></div>
  ${/* «قادمة» = ما لم يُسدَّد ولم يحلّ. كانت rows − due، فمن سدّد مقدّمًا
       ظهرت مربّعاته «12 إجمالي · 8 مسدّدة · 0 متأخرة · 8 قادمة» = 16 */ ""}
  <div><div class="v">${Math.max(0, rows.length - Math.max(st.paid, st.due))}</div><div class="l">قادمة</div></div>
</div>

${balance > 0 ? `<div class="due"><span class="l">الرصيد المستحق حتى تاريخه${v.enabled ? " (شامل الضريبة)" : ""}</span><span class="v">${sar(balance)} ريال</span></div>` : ""}

${mode === "full" ? `
<h1 style="font-size:1rem">بيانات الوحدة</h1>
<div class="grid">
  <div class="box">
    <div class="r"><span>الوحدة</span><span>${unitDesc(t, p)}</span></div>
    ${(t as any).elec_account ? `<div class="r"><span>حساب الكهرباء</span><span dir="ltr">${(t as any).elec_account}</span></div>` : ""}
    ${(t as any).water_account ? `<div class="r"><span>حساب الماء</span><span dir="ltr">${(t as any).water_account}</span></div>` : ""}
    ${(t as any).meter_elec_in ? `<div class="r"><span>قراءة الكهرباء عند التسليم</span><span dir="ltr">${(t as any).meter_elec_in}</span></div>` : ""}
    ${(t as any).meter_water_in ? `<div class="r"><span>قراءة الماء عند التسليم</span><span dir="ltr">${(t as any).meter_water_in}</span></div>` : ""}
    ${(t as any).deposit_amount ? `<div class="r"><span>مبلغ التأمين</span><span>${sar(Number((t as any).deposit_amount) || 0)} ريال</span></div>` : ""}
  </div>
  <div class="box">
    <div class="r"><span>العقار</span><span>${p.name}${p.city ? ` — ${p.city}` : ""}</span></div>
    ${p.address ? `<div class="r"><span>العنوان</span><span>${p.address}</span></div>` : ""}
    ${(p as any).owner_name ? `<div class="r"><span>المالك</span><span>${(p as any).owner_name}</span></div>` : ""}
    ${p.usage ? `<div class="r"><span>الاستخدام</span><span>${USAGE_AR[String(p.usage)] || p.usage}</span></div>` : ""}
    <div class="r"><span>التقويم المعتمد للأقساط</span><span>${(t as any).calendar === "hijri" ? "هجري (أم القرى)" : "ميلادي"}</span></div>
  </div>
</div>

<h1 style="font-size:1rem">تفصيل الدفعات</h1>
<table>
  <thead><tr><th>#</th><th>تاريخ الاستحقاق</th>${v.enabled ? "<th>الأساس</th><th>الضريبة</th>" : ""}<th>الإجمالي (ريال)</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map((r) => { const x = splitVat(r.amount, v); return `<tr>
      <td>${r.n}</td><td>${arDate(r.date)}</td>
      ${v.enabled ? `<td>${sar(x.base)}</td><td>${sar(x.vat)}</td>` : ""}
      <td>${sar(x.total)}</td>
      <td>${rowStatus(r) === "paid" ? '<span class="pill p">مسدّدة</span>'
          : rowStatus(r) === "partial" ? '<span class="pill u">سداد جزئي</span>'
          : rowStatus(r) === "late" ? '<span class="pill l">متأخرة</span>'
          : rowStatus(r) === "grace" ? `<span class="pill u">${st.inGrace ? "مستحقة — فترة سماح" : "مستحقة — لم تتأخر بعد"}</span>`
          : '<span class="pill u">قادمة</span>'}</td>
    </tr>`; }).join("")}
  </tbody>
</table>` : ""}

${shownPays.length ? `
<h1 style="font-size:1rem">المدفوعات المستلمة</h1>
<table>
  <thead><tr><th>#</th><th>تاريخ الاستلام</th><th>المبلغ (ريال)${v.enabled && !v.inclusive ? " شامل الضريبة" : ""}</th><th>طريقة السداد</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${shownPays.map((r: any, i: number) => `<tr>
      <td>${i + 1}</td>
      <td>${r.paid_on ? arDate(r.paid_on) : "—"}</td>
      <td>${sar(v.enabled && !v.inclusive ? splitVat(Number(r.amount) || 0, v).total : r.amount)}</td>
      <td>${payMethod(r)}</td>
      <td>${r.note ? escH(r.note) : "—"}</td>
    </tr>`).join("")}
    <tr style="background:#F3EEE2;font-weight:700">
      <td colspan="2">إجمالي المستلم</td>
      <td>${sar(payments.reduce((a, r) => a + (v.enabled && !v.inclusive ? splitVat(Number(r.amount) || 0, v).total : (Number(r.amount) || 0)), 0))}</td>
      <td colspan="2">${countAr(shownPays.length, "عملية")}</td>
    </tr>
  </tbody>
</table>
<div class="note" style="border-inline-start-color:#1E9E6A;background:#E6F4EC;color:#137a50">
  هذا الجدول مستخرج من سجل المدفوعات الموثّق في المنصة بتواريخه وطرق سداده، ويصلح للمطابقة مع سجلاتكم.
</div>` : `
<div class="note">لا توجد مدفوعات موثّقة في سجل المنصة لهذا العقد حتى تاريخه. الأرصدة أعلاه مستنتجة من دورة العقد وعدد الدفعات المسجّلة.</div>`}

<div class="note">كشف استرشادي صادر آليًّا من بيانات العقد المسجّلة. يُرجى مطابقته مع سجلاتكم، وإشعارنا بأي فرق.</div>

<div class="sign">
  <div>المؤجّر / الوكيل: ${who}<br><br>التوقيع: ________________</div>
  <div>المستأجر: ${t.name}<br><br>التوقيع: ________________</div>
</div>
${footer(issuer)}`;
  return SHELL(`كشف حساب — ${t.name}`, body, markOf(issuer));
}

/** فاتورة دفعة واحدة */
export function invoiceHTML(
  t: Tenant, p: Property,
  inv: { invoice_no: string; amount: number; due_date: string; period_label: string;
         /** عند إعادة الطباعة: تُطبع الفاتورة بتاريخها وحالتها ووقت إصدارها الأصلي */
         issue_date?: string | null; status?: string | null; created_at?: string | null;
         /** إعادة الطباعة: هل صدرت الفاتورة بضريبة؟ (invoices.vat_enabled المحفوظ) — null للأقدم */
         vat_snapshot?: boolean | null },
  issuer: Issuer = {}
) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  t = scrub(t);
  p = scrub(p);
  inv = scrub(inv);
  issuer = scrub(issuer);
  const ul = unitWordFor((t as any).unit_type, p.property_type);
  const who = issuer.billing_name || issuer.org_name || p.manager || "إدارة الأملاك";
  const v = vatOf(p, t);
  const x = splitVat(Number(inv.amount) || 0, v);
  /* الفاتورة الملغاة تُعرض للأرشيف لا للتداول (مراجعة 29 سبتمبر 2026): كان زرّ
     «عرض» على الملغاة يطبعها فاتورةً ضريبية سليمة برمز QR وبلا أي إشارة. */
  const voided = inv.status === "void";
  /* (30 سبتمبر 2026) إعادة طباعة فاتورة صدرت بلا ضريبة لا تصير «ضريبية» برمز QR
     لأن المكتب سجّل رقمه الضريبي لاحقًا. والعكس: فاتورة صدرت ضريبية والرقم
     الضريبي حُذف من الإعدادات بعدها — لا نطبع تنبيه «الرقم غير مسجَّل» كأنها
     صدرت خطأً، بل نوضّح أنها نسخة لا يُعاد رسم رمزها. (لا لقطة للرقم الضريبي
     ولا لاسم البائع في جدول الفواتير — يُطبعان بقيم المكتب الحالية.) */
  const snapOff = inv.vat_snapshot === false;
  const snapOnNoVatNo = inv.vat_snapshot === true && v.enabled && !issuer.vat_number;
  const isTax = v.enabled && !!issuer.vat_number && !snapOff;
  const reprint = !!inv.issue_date;
  const issueDay = inv.issue_date || today();
  /* وقت الإصدار: من created_at المحفوظ، أو لحظة الإصدار الأولى (بلا issue_date) */
  const issueTime = inv.created_at ? riyadhTime(inv.created_at) : !reprint ? riyadhTime() : "";
  const body = `
${header(voided ? "فاتورة ملغاة" : isTax ? "فاتورة ضريبية مبسطة" : "فاتورة", inv.invoice_no, issuer, issueDay)}
${voided ? `<div style="border:3px solid #a5322c;color:#a5322c;text-align:center;font-weight:800;font-size:1.4rem;padding:10px;margin:10px 0;border-radius:10px;letter-spacing:.5px">ملغاة — لا يُعتدّ بها ولا تُحصَّل</div>` : ""}
<h1>${isTax || snapOnNoVatNo ? "فاتورة ضريبية مبسطة — أجرة" : "فاتورة أجرة"}</h1>
<div class="sub">${inv.period_label} · ${freqLabel(t.payment_frequency)}</div>

<div class="grid">
  <div class="box">
    <h3>المُصدِر</h3>
    <div class="r"><span>الاسم</span><span>${who}</span></div>
    ${issuer.cr_number ? `<div class="r"><span>السجل التجاري</span><span>${issuer.cr_number}</span></div>` : ""}
    ${issuer.vat_number ? `<div class="r"><span>الرقم الضريبي</span><span>${issuer.vat_number}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>إلى</h3>
    <div class="r"><span>الاسم</span><span>${t.name}</span></div>
    ${t.national_id ? `<div class="r"><span>الهوية / السجل</span><span>${t.national_id}</span></div>` : ""}
    <div class="r"><span>${ul}</span><span>${t.unit || "—"}</span></div>
    <div class="r"><span>العقار</span><span>${p.name}</span></div>
  </div>
</div>

<table>
  <thead><tr><th>البيان</th><th>الفترة</th><th>تاريخ الاستحقاق</th><th>المبلغ${v.enabled ? " قبل الضريبة" : ""} (ريال)</th></tr></thead>
  <tbody>
    <tr>
      <td>أجرة ${ul} رقم (${t.unit || "—"}) بعقار ${p.name}</td>
      <td>${inv.period_label}</td>
      <td>${inv.due_date ? arDate(inv.due_date) : "—"}</td>
      <td>${sar(x.base)}</td>
    </tr>
  </tbody>
</table>

${v.enabled ? `<table style="max-width:340px;margin-inline-start:auto">
  <tbody>
    <tr><td>الإجمالي قبل الضريبة</td><td style="text-align:left;font-weight:600">${sar(x.base)}</td></tr>
    <tr><td>ضريبة القيمة المضافة (${v.rate}%)</td><td style="text-align:left;font-weight:600">${sar(x.vat)}</td></tr>
    <tr><td style="font-weight:700">الإجمالي شامل الضريبة</td><td style="text-align:left;font-weight:700">${sar(x.total)}</td></tr>
  </tbody>
</table>` : ""}

<div class="due"><span class="l">الإجمالي المستحق${v.enabled ? " (شامل الضريبة)" : ""}</span><span class="v">${sar(x.total)} ريال</span></div>

${isTax && !voided ? zatcaQrBlock(who, issuer.vat_number!, x.total, x.vat, inv.created_at) : ""}

${snapOnNoVatNo && !voided ? `<div class="note">
  <b>نسخة من فاتورة صدرت ضريبية:</b> الرقم الضريبي غير مسجَّل في إعدادات المكتب حاليًّا، فلا يُعاد رسم رمز الاستجابة السريعة في هذه النسخة.
  أضِف الرقم الضريبي في الإعدادات لإعادة طباعتها كاملة.
</div>` : ""}
${v.enabled && !issuer.vat_number && !snapOnNoVatNo && !voided ? `<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>تنبيه:</b> الضريبة مفعّلة لكن الرقم الضريبي للمُصدِر غير مسجَّل، لذا صدرت الوثيقة بعنوان «فاتورة» لا «فاتورة ضريبية».
  أضِف الرقم الضريبي في الإعدادات لتصدر فاتورة ضريبية مبسطة برمز QR.
</div>` : ""}

<div class="note">
  فاتورة إدارية صادرة عن المؤجّر لغرض التوثيق بين الطرفين. السداد يتم مباشرةً للمؤجّر بالوسيلة المتفق عليها —
  منصة وثيق لا تستلم ولا تحوّل أي مبالغ.
</div>
${isTax && !voided ? `<div class="note">
  <b>عن الفوترة الإلكترونية:</b> هذه فاتورة ضريبية مبسطة تتضمن رمز الاستجابة السريعة وفق متطلبات المرحلة الأولى (الإصدار) من نظام الفاتورة الإلكترونية.
  إن كانت منشأتك مشمولة بالمرحلة الثانية (الربط والتكامل مع منصة «فاتورة»)، فوثيق لا يقوم بهذا الربط — أصدر فواتيرك الضريبية من حلّ فوترة مرتبط، واستخدم هذه للتوثيق الإداري.
</div>` : ""}

<div class="sign">
  <div>المُصدِر: ${who}<br><br>التوقيع: ________________</div>
  <div>تاريخ الإصدار: ${arDate(issueDay)}${issueTime ? ` — الساعة <span dir="ltr">${issueTime}</span>` : ""}<br><br>رقم الفاتورة: ${inv.invoice_no}</div>
</div>
${footer(issuer)}`;
  return SHELL(`${voided ? "فاتورة ملغاة" : "فاتورة"} ${inv.invoice_no} — ${t.name}`, body, markOf(issuer));
}

/* ═══════════════════ عرض سعر تأجير وحدة ═══════════════════ */

export type ChargeRow = { label: string; who: "owner" | "tenant" };

export const DEFAULT_CHARGES: ChargeRow[] = [
  { label: "استهلاك الكهرباء", who: "tenant" },
  { label: "استهلاك المياه", who: "tenant" },
  { label: "الإنترنت والاتصالات", who: "tenant" },
  { label: "النظافة الداخلية للوحدة", who: "tenant" },
  { label: "الصيانة الإنشائية والتمديدات الأساسية", who: "owner" },
  { label: "صيانة المصعد والأجزاء المشتركة", who: "owner" },
  { label: "رسوم جمعية الملاك / الخدمات المشتركة", who: "owner" },
];

export type QuoteInput = {
  quote_no: string;
  tenant_name: string;
  unit: string;
  rent_amount: number;        // إيجار الدفعة الواحدة
  payment_frequency: string;
  contract_periods: number;
  start_date: string;
  deposit: number;
  valid_until: string;
  charges: ChargeRow[];
  notes?: string | null;
  /** لتحديد الضريبة في العمارة المختلطة — كنوع الوحدة في العقد */
  unit_type?: string | null;
  vat_mode?: string | null;
};

/** عرض سعر تأجير — يُرسل لمستأجر محتمل قبل التعاقد */
export function quotationHTML(p: Property, q: QuoteInput, issuer: Issuer = {}) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  p = scrub(p);
  q = scrub(q);
  issuer = scrub(issuer);
  const ul = unitWordFor((q as any).unit_type, p.property_type);
  const who = issuer.billing_name || issuer.org_name || p.manager || "إدارة الأملاك";
  const v = vatOf(p, { unit_type: q.unit_type, vat_mode: q.vat_mode });
  const periods = Math.max(1, Number(q.contract_periods) || 1);
  const perPeriod = Number(q.rent_amount) || 0;
  const gross = perPeriod * periods;
  const x = splitVat(gross, v);
  const xp = splitVat(perPeriod, v);
  const rows = buildSchedule({
    contract_start: q.start_date, payment_frequency: q.payment_frequency,
    rent_amount: perPeriod, contract_periods: periods, paid_periods: 0,
  });
  const tenantRows = q.charges.filter((c) => c.who === "tenant");
  const ownerRows = q.charges.filter((c) => c.who === "owner");

  const body = `
${header("عرض سعر", q.quote_no, issuer)}
<h1>عرض سعر تأجير ${ul}</h1>
<div class="sub">${p.name}${p.city ? ` · ${p.city}` : ""} · ${ul} رقم ${q.unit || "—"}</div>

<div class="grid">
  <div class="box">
    <h3>المُصدِر</h3>
    <div class="r"><span>الاسم</span><span>${who}</span></div>
    ${issuer.cr_number ? `<div class="r"><span>السجل التجاري</span><span>${issuer.cr_number}</span></div>` : ""}
    ${issuer.vat_number ? `<div class="r"><span>الرقم الضريبي</span><span>${issuer.vat_number}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
    ${p.address ? `<div class="r"><span>العنوان</span><span>${p.address}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>العرض مُقدَّم إلى</h3>
    <div class="r"><span>الاسم</span><span>${q.tenant_name || "—"}</span></div>
    <div class="r"><span>${ul}</span><span>${q.unit || "—"}</span></div>
    <div class="r"><span>تاريخ الإصدار</span><span>${arDate(today())}</span></div>
    <div class="r"><span>صالح حتى</span><span>${arDate(q.valid_until)}</span></div>
  </div>
</div>

<h2>شروط العرض</h2>
<table>
  <tbody>
    <tr><td>إيجار الدفعة الواحدة${v.enabled ? " (قبل الضريبة)" : ""}</td><td style="text-align:left;font-weight:600">${sar(xp.base)} ريال</td></tr>
    <tr><td>دورية السداد</td><td style="text-align:left;font-weight:600">${freqLabel(q.payment_frequency)}</td></tr>
    <tr><td>عدد الدفعات</td><td style="text-align:left;font-weight:600">${periods}</td></tr>
    <tr><td>تاريخ بداية العقد المقترح</td><td style="text-align:left;font-weight:600">${arDate(q.start_date)}</td></tr>
    <tr><td>مبلغ التأمين المسترد</td><td style="text-align:left;font-weight:600">${sar(q.deposit)} ريال</td></tr>
  </tbody>
</table>

<h2>إجمالي قيمة العقد</h2>
<table style="max-width:380px;margin-inline-start:auto">
  <tbody>
    <tr><td>الإجمالي قبل الضريبة</td><td style="text-align:left;font-weight:600">${sar(x.base)}</td></tr>
    ${v.enabled ? `<tr><td>ضريبة القيمة المضافة (${v.rate}%)</td><td style="text-align:left;font-weight:600">${sar(x.vat)}</td></tr>` : ""}
    <tr><td style="font-weight:700">الإجمالي${v.enabled ? " شامل الضريبة" : ""}</td><td style="text-align:left;font-weight:700">${sar(x.total)}</td></tr>
    <tr><td>التأمين المسترد</td><td style="text-align:left;font-weight:600">${sar(q.deposit)}</td></tr>
    <tr><td style="font-weight:700">المطلوب عند التعاقد (الدفعة الأولى + التأمين)</td><td style="text-align:left;font-weight:700">${sar(xp.total + (Number(q.deposit) || 0))}</td></tr>
  </tbody>
</table>

<h2>جدول الدفعات المقترح</h2>
<table>
  <thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th>المبلغ${v.enabled ? " (شامل الضريبة)" : ""} (ريال)</th></tr></thead>
  <tbody>
    ${rows.map((r) => `<tr><td>${r.n}</td><td>${arDate(r.date)}</td><td>${sar(splitVat(r.amount, v).total)}</td></tr>`).join("")}
  </tbody>
</table>

<h2>من يتحمّل ماذا</h2>
<div class="grid">
  <div class="box">
    <h3>على المستأجر</h3>
    ${tenantRows.length ? tenantRows.map((c) => `<div class="r"><span>${c.label}</span><span>✔</span></div>`).join("") : `<div class="r"><span>—</span><span></span></div>`}
  </div>
  <div class="box">
    <h3>على المؤجّر</h3>
    ${ownerRows.length ? ownerRows.map((c) => `<div class="r"><span>${c.label}</span><span>✔</span></div>`).join("") : `<div class="r"><span>—</span><span></span></div>`}
  </div>
</div>

${q.notes ? `<h2>ملاحظات إضافية</h2><div class="note">${q.notes}</div>` : ""}

<div class="note">
  هذا <b>عرض سعر مبدئي غير مُلزم</b>، وصلاحيته تنتهي بتاريخ ${arDate(q.valid_until)}. لا يُنشئ هذا المستند
  علاقة إيجارية ولا يقوم مقام العقد.
</div>
<div class="note" style="border-inline-start-color:#8a5a11;background:#FBF1DF;color:#8a5a11">
  <b>التعاقد النهائي:</b> يُوثَّق عقد الإيجار عبر <b>منصة إيجار</b> التابعة للهيئة العامة للعقار، وهي المرجع
  المعتمد لتوثيق العقود ومطالباتها. توثيق العقد وتحصيل مقابله يتمّان بين الطرفين عبر القنوات الرسمية —
  منصة وثيق تُجهّز المستندات فقط ولا تستلم ولا تحوّل أي مبالغ.
</div>

<div class="sign">
  <div>المؤجّر / وكيله: ${who}<br><br>التوقيع: ________________</div>
  <div>اطّلع المستأجر المحتمل<br><br>التوقيع: ________________</div>
</div>
${footer(issuer)}`;
  return SHELL(`عرض سعر ${q.quote_no} — ${q.tenant_name || p.name}`, body, markOf(issuer));
}

/** كشف حساب عقار كامل — كل الوحدات */
/**
 * كشف حساب العقار بنمطين — كنمطَي كشف الوحدة:
 *  - brief (مختصر): الملخص وجدول الوحدات بحالتها. صفحة واحدة للمالك المستعجل.
 *  - full (شامل): يضيف بيانات العقار الكاملة، ومواصفات كل وحدة وعدّاداتها
 *    وعقودها وتواريخها بالتقويمين، والوحدات الشاغرة، وتحليل الدخل السنوي
 *    مقابل المحصَّل، وتوزيع الحالات — للتوثيق ولتسليم المحفظة.
 */
export function propertyStatementHTML(
  p: Property & { tenants: Tenant[] },
  issuer: Issuer = {},
  mode: "brief" | "full" = "brief",
  /** فترة اختيارية: عندها يُضاف المحصَّل والمصروفات وتفصيل الدفعات فيها */
  period?: { from: string; to: string; label: string } | null,
  payments: PaymentRow[] = [],
  expenses: ExpenseRow[] = [],
  /** إعدادات الضريبة للمستأجرين السابقين — لضريبة دفعاتهم */
  pastVat?: PastVat,
) {
  if (period) period = scrub(period);   /* عنوان الفترة يُعرض في المستند */
  /* تعقيم ما يدخل المستند من نصّ مستخدم — كانت هذه الدالة تُدخله خامًا */
  payments = scrub(payments); expenses = scrub(expenses);
  // تعقيم المدخلات (انظر scrub أعلاه)
  p = scrub(p);
  issuer = scrub(issuer);
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || issuer.org_name || p.manager || "إدارة الأملاك";
  const rows = p.tenants.map((t) => ({ t, st: contractState(t, winOf(p, issuer)) }));
  /* العمارة المختلطة: كل وحدة بضريبتها — الشقة السكنية معفاة والمحل خاضع */
  const vFor = (t: any) => vatOf(p, t);
  /* شاملًا الضريبة المضافة — كان يطبع «30,000 (منه ضريبة 4,500)» والدين 34,500 */
  const totalDue = rows.reduce((s, r) => s + dueIncl(r.st, vFor(r.t)), 0);
  const totalPaid = rows.reduce((s, r) => s + r.st.paid * splitVat(Number(r.t.rent_amount) || 0, vFor(r.t)).total, 0);
  const totalVat = rows.reduce((s, r) => s + splitVat(r.st.amountDue, vFor(r.t)).vat, 0);
  // المُخلاة ذات الدين لا تُعدّ «وحدة متأخرة» — دينها على من غادر
  const late = rows.filter((r) => !r.st.vacant && r.st.status === "late").length;
  const vacantCount = rows.filter((r) => isVacant(r.t)).length;
  const occupied = p.tenants.length - vacantCount;
  /**
   * كشف الحساب يذكر ما حدث لا ما يُتوقَّع.
   *
   * كان يعرض «الدخل السنوي المتوقع» — رقمًا تقديريًّا وسط مستند يُسلَّم
   * للمالك كبيان حساب، فيُقرأ كالتزام. والمكتب طلبها صراحةً: «أبغى كشف
   * حساب العمارة بالضبط، ما أحتاج المتوقع».
   *
   * بدلها حقائق: ما تأخّر فعلًا، وما حُصِّل خلال الفترة إن حُدّدت.
   */
  /* رقم واحد مجمَّع كان يخالف تقرير المالك لنفس العقار بلا تفسير
     (40,700 هنا مقابل 36,200 هناك). نعرضه مفصَّلًا بمصدر واحد. */
  const stArr = arrearsOf((p.tenants || []).map((t: any) =>
    ({ t, st: contractState(t, winOf(p, issuer)), p })));
  const arrearsTotal = stArr.grand;
  const soonCount = rows.filter((r) => r.st.status === "soon").length;
  /* أرقام الفترة: تُحسب من الدفعات والمصروفات المسجّلة داخلها فقط —
     لا من الحالة اللحظية، وإلا اختلف الرقم عن تقرير المالك لنفس المدة. */
  const inRange = (d?: string | null) => !!d && !!period && String(d) >= period.from && String(d) <= period.to;
  const periodPayments = period ? payments.filter((x) => inRange(x.paid_on)) : [];
  /* الجدول والعدّ من المرئي: العكوس تسقط مع أصولها. والمجموع من الدفتر
     كاملًا (periodCollected) فلا يتغيّر. */
  const periodShown = visiblePayments(periodPayments as any[]);
  const periodCollected = periodPayments.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const periodExpenses = period ? expenses.filter((x) => inRange((x as any).spent_on)).reduce((a, x) => a + (Number(x.amount) || 0), 0) : 0;
  const byUnitP: Record<string, any> = {};
  (p.tenants || []).forEach((t: any) => { if (t.unit) byUnitP[String(t.unit)] = t; });
  const pvt = vatOfPayments(p, periodPayments as any[], pastVat);
  /**
   * «الصافي» بمعادلة تقرير المالك نفسها.
   *
   * كان المحصَّل − كل المصروفات: يطرح مصروفات المكتب نفسه، ولا يطرح الأتعاب
   * ولا ضريبة الهيئة، ويُخفي السالب بـ max(0). فلعقار واحد في فترة واحدة
   * رقمان باسم «الصافي» في مستندين. الآن رقم واحد: المحصَّل − الضريبة −
   * مصروفات المالك − الأتعاب (وضريبتها) — كتقرير المالك حرفيًّا.
   */
  const periodExpRows = period ? expenses.filter((x) => inRange((x as any).spent_on)) : [];
  const pFin = ownerNet(periodCollected + pvt.onTop, periodExpRows, (p as any).mgmt_fee_pct,
    pvt.inside + pvt.onTop, issuer.vat_number ? (Number(p.vat_rate) || 15) : 0);
  const periodVat = pvt.inside + pvt.onTop;
  const expiringCount = rows.filter((r) => r.st.expiringSoon && !isVacant(r.t)).length;

  const body = `
${header(mode === "full" ? "كشف حساب عقار — شامل" : "كشف حساب عقار", p.name, issuer)}
<h1>كشف حساب ${p.name}${mode === "full" ? " — شامل" : ""}</h1>
<div class="sub">${typeLabel(p.property_type)}${p.address ? ` — ${p.address}` : ""}${p.city ? `، ${p.city}` : ""} · ${countAr(p.tenants.length, ul)}${period ? ` · الفترة: ${period.label}` : ""}</div>

<div class="tot">
  <div><div class="v">${p.tenants.length}</div><div class="l">إجمالي الوحدات</div></div>
  <div><div class="v g">${Math.max(0, occupied - late)}</div><div class="l">منتظمة</div></div>
  <div><div class="v">${vacantCount}</div><div class="l">شاغرة</div></div>
  <div><div class="v r">${late}</div><div class="l">متأخرة</div></div>
  ${/* (30 سبتمبر 2026) ليس «المُحصَّل»: هو الدفعات المسدَّدة × الإيجار للعقود القائمة
       الآن (بلا دفعات المستأجرين السابقين ولا التواريخ) — والاسم نفسه في حركة الفترة
       تحته برقم آخر. */ ""}
  <div><div class="v">${sar(totalPaid)}</div><div class="l">المسدَّد من العقود الحالية (ريال)</div></div>
</div>

${period ? `
<h1 style="font-size:1rem">حركة الفترة — ${period.label}</h1>
<div class="tot">
  <div><div class="v g">${sar(periodCollected)}</div><div class="l">المُحصَّل (ريال)</div></div>
  <div><div class="v">${periodShown.length}</div><div class="l">عدد الدفعات</div></div>
  <div><div class="v r">${sar(pFin.expenses)}</div><div class="l">مصروفات على المالك (ريال)</div></div>
  <div><div class="v">${sar(pFin.net)}</div><div class="l">صافي المالك (ريال)${pFin.feePct !== null || (pFin.vatCollected || 0) > 0 ? " — بعد " + [(pFin.vatCollected || 0) > 0 ? "الضريبة" : "", pFin.feePct !== null ? "الأتعاب" : ""].filter(Boolean).join(" و") : ""}</div></div>
</div>
<div class="sub" style="margin-bottom:10px">من ${arDateH(period.from)} إلى ${arDateH(period.to)}${pvt.inside > 0 ? ` · منه ضريبة قيمة مضافة ${sar(pvt.inside)} ريال` : ""}${pvt.onTop > 0 ? ` · وضريبة قيمة مضافة دُفعت فوقه ${sar(pvt.onTop)} ريال` : ""}</div>` : ""}

${mode === "full" ? `
<h1 style="font-size:1rem">بيانات العقار</h1>
<div class="grid">
  <div class="box">
    <div class="r"><span>النوع</span><span>${typeLabel(p.property_type)}</span></div>
    ${p.usage ? `<div class="r"><span>الاستخدام</span><span>${USAGE_AR[String(p.usage)] || p.usage}</span></div>` : ""}
    ${(p as any).owner_name ? `<div class="r"><span>المالك</span><span>${(p as any).owner_name}</span></div>` : ""}
    ${p.address ? `<div class="r"><span>العنوان</span><span>${p.address}</span></div>` : ""}
    ${p.city ? `<div class="r"><span>المدينة</span><span>${p.city}</span></div>` : ""}
  </div>
  <div class="box">
    <div class="r"><span>الوحدات</span><span>${p.tenants.length} (${occupied} مؤجّرة · ${vacantCount} شاغرة)</span></div>
    <div class="r"><span>نسبة الإشغال</span><span>${p.tenants.length ? Math.round((occupied / p.tenants.length) * 100) : 0}%</span></div>
    <div class="r"><span>إجمالي المستحق على العقار</span><span><b style="color:${arrearsTotal > 0 ? "#a5322c" : "#137a50"}">${sar(arrearsTotal)} ريال</b></span></div>
    ${stArr.current > 0 ? `<div class="r"><span style="padding-inline-start:12px">— قيد المطالبة</span><span>${sar(stArr.current)} ريال</span></div>` : ""}
    ${stArr.litigation > 0 ? `<div class="r"><span style="padding-inline-start:12px">— تحت التنفيذ القضائي</span><span>${sar(stArr.litigation)} ريال</span></div>` : ""}
    ${stArr.carried > 0 ? `<div class="r"><span style="padding-inline-start:12px">— دين مُرحَّل من مدة سابقة</span><span>${sar(stArr.carried)} ريال</span></div>` : ""}
    ${stArr.legacy > 0 ? `<div class="r"><span style="padding-inline-start:12px">— على مستأجرين سابقين (وحدات شاغرة)</span><span>${sar(stArr.legacy)} ريال</span></div>` : ""}
    ${/* الرقم نفسه في مربّع «حركة الفترة» أعلاه (دفعات داخل الفترة فقط) */ ""}
    ${period ? `<div class="r"><span>المحصَّل خلال الفترة</span><span><b>${sar(periodCollected)} ريال</b></span></div>` : ""}
    ${(p as any).mgmt_fee_pct ? `<div class="r"><span>أتعاب الإدارة</span><span>${(p as any).mgmt_fee_pct}%</span></div>` : ""}
    ${Number(p.grace_days) > 0 ? `<div class="r"><span>فترة السماح</span><span>${daysAr(Number(p.grace_days))}</span></div>` : ""}
    ${p.vat_enabled ? `<div class="r"><span>ضريبة القيمة المضافة</span><span>${Number(p.vat_rate) || 15}% على الوحدات التجارية</span></div>` : ""}
  </div>
</div>
${propertyMetersHTML(p, (t) => `<h1 style="font-size:1rem">${t}</h1>`)}` : ""}

${totalDue > 0 ? `<div class="due"><span class="l">إجمالي الإيجار المتأخر${totalVat > 0 ? ` (منه ضريبة ${sar(totalVat)} ريال)` : ""}</span><span class="v">${sar(totalDue)} ريال</span></div>` : ""}
${/* (30 سبتمبر 2026) الدين المرحَّل ودين المستأجرين السابقين كانا يُذكران فقط إن
     وُجد متأخر حالي — عقار كل دينه مرحَّل كان يخرج كشفه بلا أي ذكر له. */
  stArr.carried + stArr.legacy > 0 ? `<div class="note">${totalDue > 0 ? "ويُضاف إليه" : "لا متأخر على العقود الحالية، لكن على العقار"}
  ${[stArr.carried > 0 ? `<b>${sar(stArr.carried)}</b> ريال دينًا مُرحَّلًا من مدد سابقة` : "", stArr.legacy > 0 ? `<b>${sar(stArr.legacy)}</b> ريال على مستأجرين سابقين` : ""].filter(Boolean).join(" و")}
  — إجمالي المستحق على العقار <b>${sar(stArr.grand)}</b> ريال.</div>` : ""}

<table>
  <thead><tr><th>${ul}</th>${mode === "full" ? "<th>النوع والمواصفات</th>" : ""}<th>المستأجر</th>${mode === "full" ? "<th>الجوال</th><th>رقم العقد</th>" : ""}<th>الدفعة</th><th>الدورة</th>${mode === "full" ? "<th>بداية العقد</th><th>نهايته</th>" : ""}<th>القادمة</th><th>المتأخر</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map(({ t, st }) => { const vc = isVacant(t); return `<tr>
      <td><b>${t.unit || "—"}</b></td>
      ${mode === "full" ? `<td>${t.unit_type ? (UNIT_TYPE_AR[String(t.unit_type)] || "—") : unitLabel(p.property_type)}${unitSpecs(t) ? `<div style="font-size:.68rem;color:#5C6B67">${unitSpecs(t)}</div>` : ""}${(t as any).elec_account ? `<div style="font-size:.65rem;color:#5C6B67">كهرباء <span dir="ltr">${(t as any).elec_account}</span></div>` : ""}${(t as any).water_account ? `<div style="font-size:.65rem;color:#5C6B67">ماء <span dir="ltr">${(t as any).water_account}</span></div>` : ""}</td>` : ""}
      <td>${vc ? "<span style='color:#5C6B67'>— شاغرة —</span>" : t.name}</td>
      ${mode === "full" ? `<td dir="ltr">${vc ? "—" : (t.phone || "—")}</td><td dir="ltr">${t.contract_no || "—"}</td>` : ""}
      <td>${vc ? "—" : sar(splitVat(Number(t.rent_amount) || 0, vatOf(p, t)).total)}</td>
      <td>${vc ? "—" : freqLabel(t.payment_frequency)}</td>
      ${mode === "full" ? `<td>${vc ? "—" : arDateH(t.contract_start)}</td><td>${vc ? "—" : arDateH(st.endDate)}</td>` : ""}
      ${/* «القادمة» من upcomingDate: nextDueDate هو أقدم قسط غير مسدَّد — تاريخ ماضٍ للمتأخر */ ""}
      <td>${vc ? "—" : st.upcomingDate ? arDate(st.upcomingDate) : st.upcomingDate === null ? "—" : arDate(st.nextDueDate)}</td>
      <td>${st.totalOwed ? `${(() => { const d = dueIncl(vc ? { amountDue: st.legacyArrears } : st, vatOf(p, t)); return d > 0
        ? `${sar(d)}${st.carriedDebt > 0 ? `<div style="font-size:.62rem;color:#9A4B00">+ ${sar(st.carriedDebt)} دين مرحَّل</div>` : ""}`
        : `${sar(st.carriedDebt)}<div style="font-size:.62rem;color:#9A4B00">دين مرحَّل</div>`; })()}${vc ? '<div style="font-size:.65rem;color:#5C6B67">على المستأجر السابق</div>' : ""}` : "—"}</td>
      <td>${vc ? '<span class="pill">شاغرة</span>'
          : st.inGrace ? '<span class="pill u">فترة سماح</span>'
          : isPartialOnly(st) && st.status === "late" ? '<span class="pill u">سداد جزئي</span>'
          : st.status === "late" ? '<span class="pill l">متأخر</span>'
          : st.status === "soon" ? '<span class="pill u">يستحق قريبًا</span>'
          : '<span class="pill p">منتظم</span>'}</td>
    </tr>`; }).join("")}
  </tbody>
</table>

${period && mode === "full" && periodShown.length ? `
<h1 style="font-size:1rem">تفصيل دفعات الفترة</h1>
<div class="scrollx"><table>
  <thead><tr><th>التاريخ</th><th>${ul}</th><th>المستأجر</th><th>المبلغ</th><th>الطريقة</th><th>المرجع</th></tr></thead>
  <tbody>
    ${periodShown
      /* كان payMethod(x.method) يمرّر نصّ الطريقة لدالة تنتظر الصفّ — فظهرت «—» في كل صفّ */
      .map((x: any) => `<tr><td>${arDate(x.paid_on)}</td><td>${x.unit || "—"}</td><td>${x.tenant_name || "—"}</td><td>${sar(Number(x.amount) || 0)}</td><td>${x._adjust ? "تصحيح" : payMethod(x)}</td><td dir="ltr">${(x as any).reference || "—"}</td></tr>`).join("")}
    <tr><td colspan="3"><b>إجمالي المُحصَّل</b></td><td colspan="2"><b>${sar(periodCollected)}</b></td></tr>
  </tbody>
</table></div>` : ""}

${mode === "full" ? `
<h1 style="font-size:1rem">توزيع الحالات</h1>
<table>
  <thead><tr><th>الحالة</th><th>عدد الوحدات</th><th>النسبة</th></tr></thead>
  <tbody>
    ${[["مؤجّرة ومنتظمة", occupied - late - soonCount], ["تستحق قريبًا", soonCount], ["متأخرة", late], ["عقود تنتهي قريبًا", expiringCount], ["شاغرة", vacantCount]]
      .filter(([, n]) => Number(n) > 0)
      .map(([l, n]) => `<tr><td>${l}</td><td>${n}</td><td>${p.tenants.length ? Math.round((Number(n) / p.tenants.length) * 100) : 0}%</td></tr>`).join("")}
  </tbody>
</table>` : ""}

<div class="note">كشف استرشادي صادر آليًّا من بيانات العقود المسجّلة بتاريخ ${arDate(today())}.${mode === "full" ? " المتأخرات والمحصَّل من السجلات المسجّلة في وثيق." : ""}</div>
<div class="sign"><div>المؤجّر / الوكيل: ${who}<br><br>التوقيع: ________________</div><div>تاريخ الإصدار: ${arDate(today())}</div></div>
${footer(issuer)}`;
  return SHELL(`كشف حساب — ${p.name}`, body, markOf(issuer));
}

/** فتح المستند في نافذة جديدة للطباعة */
/**
 * يعرض المستند للمستخدم.
 *
 * كان يعتمد على window.open وحدها، وسفاري على الآيفون يحجبها افتراضيًّا
 * (وكذلك وضع التطبيق المثبَّت)، فكان المستخدم يرى «اسمح بالنوافذ المنبثقة»
 * ولا يصل إلى مستنده أبدًا — وهو جوهر المنتج.
 *
 * الآن: تُجرَّب النافذة أولًا (أفضل تجربة على الحاسب للطباعة)، وإن حُجبت
 * يُعرض المستند داخل التطبيق نفسه في طبقة ملء الشاشة، فلا يعتمد على إذن.
 */
export function openDoc(html: string) {
  try {
    const w = window.open("", "_blank");
    if (w && w.document) {
      w.document.write(html);
      w.document.close();
      /* المستند لا يحتاج مرجعًا إلى نافذة التطبيق — نقطع الطريق احتياطًا */
      try { (w as any).opener = null; } catch { /* لا شيء */ }
      return;
    }
  } catch {
    /* محجوبة — نكمل إلى البديل */
  }
  showDocInline(html);
}

/** عرض المستند داخل الصفحة في طبقة ملء الشاشة مع أزرار طباعة وإغلاق */
function showDocInline(html: string) {
  const prev = document.getElementById("watheq-doc-overlay");
  if (prev) prev.remove();

  const overlay = document.createElement("div");
  overlay.id = "watheq-doc-overlay";
  overlay.setAttribute("dir", "rtl");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:#F6F1E4;display:flex;flex-direction:column";

  const bar = document.createElement("div");
  bar.style.cssText =
    "flex:0 0 auto;display:flex;gap:8px;padding:10px 12px;background:#0E3A37;" +
    "align-items:center;padding-top:calc(10px + env(safe-area-inset-top))";

  const mkBtn = (label: string, bg: string, color: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      `appearance:none;border:0;border-radius:10px;padding:10px 16px;font-size:15px;` +
      `font-weight:700;cursor:pointer;background:${bg};color:${color};` +
      `font-family:inherit`;
    return b;
  };

  const printBtn = mkBtn("🖨️ طباعة / حفظ PDF", "#E7C877", "#0E3A37");
  const closeBtn = mkBtn("إغلاق", "transparent", "#F6F1E4");
  closeBtn.style.border = "1px solid rgba(246,241,228,.45)";

  const frame = document.createElement("iframe");
  frame.style.cssText = "flex:1 1 auto;width:100%;border:0;background:#fff";
  frame.setAttribute("title", "مستند وثيق");

  printBtn.onclick = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.print();
    }
  };
  closeBtn.onclick = () => overlay.remove();

  bar.appendChild(printBtn);
  bar.appendChild(closeBtn);
  overlay.appendChild(bar);
  overlay.appendChild(frame);
  document.body.appendChild(overlay);

  // srcdoc بدل document.write: يعمل في كل المتصفحات ولا يحتاج إذنًا
  frame.srcdoc = html;
}

// ============================================================
// كشوف حساب جمعيات الملاك — بنفس هوية مستندات الأملاك
// ============================================================

type OwnerRow = {
  id?: string; name: string; unit: string | null; phone: string | null;
  months_late: number; last_paid: string | null; partial_amount?: number | null; prepaid_months?: number | null;
  /** v63: رسم خاص بالمالك (من حصته) وحصته ومساحته */
  fee_override?: number | null; share_pct?: number | null; area_m2?: number | null;
};
type AssociationDoc = {
  name: string; units?: number; fee: number;
  mullak_reg_no?: string | null; unified_no?: string | null;
  quorum_first_pct?: number | null; quorum_second_pct?: number | null;
  cert_expiry?: string | null; fund_balance?: number | null;
  /** v63: فترة الرسم وأساسه — الافتراضي شهري ومتساوٍ كما قبلها */
  fee_period?: string | null; fee_basis?: string | null; total_budget?: number | null;
  owners?: OwnerRow[];
};

/** رسم المالك الفعلي للفترة: الخاص (من حصته) وإلا رسم الجمعية */
const ownerFee = (o: OwnerRow, fee: number) => (Number(o.fee_override) > 0 ? Number(o.fee_override) : fee);
const owed = (o: OwnerRow, fee: number) =>
  Math.max(0, Math.round(((Number(o.months_late) || 0) * ownerFee(o, fee) - (Number(o.partial_amount) || 0)) * 100) / 100);
/** (30 سبتمبر 2026) الرسم يُطبع بفترته: كان الرسم الشهري يظهر في محضر الاجتماع
 *  السنوي تحت «اشتراك الصيانة لعام …» فيُقرأ رسمًا سنويًّا. */
const isAnnual = (a?: { fee_period?: string | null } | null) => a?.fee_period === "annual";
const perWord = (a?: { fee_period?: string | null } | null) => (isAnnual(a) ? "سنويًّا" : "شهريًّا");
const perAdj = (a?: { fee_period?: string | null } | null) => (isAnnual(a) ? "السنوي" : "الشهري");
const periodsWord = (n: number, a?: { fee_period?: string | null } | null) => {
  const x = Math.abs(Math.round(Number(n) || 0)), r = x % 100;
  if (isAnnual(a)) return x === 1 ? "سنة واحدة" : x === 2 ? "سنتان" : r >= 3 && r <= 10 ? `${x} سنوات` : `${x} سنة`;
  return x === 1 ? "شهر واحد" : x === 2 ? "شهران" : r >= 3 && r <= 10 ? `${x} أشهر` : r >= 11 ? `${x} شهرًا` : `${x} شهر`;
};

// ─── نصاب الجمعية العامة ─────────────────────────────────────────
/** حضور الاجتماع: مالك/وحدة وحصته (إن وُزّعت) وهل حضر (أصالةً أو وكالة) */
export type HoaAttendance = { name: string; unit?: string | null; share_pct?: number | null; present: boolean };
export type HoaQuorum = {
  basis: "shares" | "units" | "none"; present: number; total: number; pct: number | null;
  met: boolean | null; round: 1 | 2; threshold: number;
};
/**
 * النصاب (النظام الأساسي الاسترشادي لجمعية الملاك — المرجع المعتمد في وثيق):
 *  • الاجتماع الأول: يصح بحضور ملاك يملكون 75٪ على الأقل من الحصص (نسب الملكية/المساحة).
 *  • الاجتماع الثاني (بعد عدم اكتمال الأول): يصح بأي عدد من الحاضرين.
 * إن أُدخلت الحصص لكل الملاك يُحتسب بها؛ وإلا بعدد الوحدات (تقريب يُذكر صراحةً في المحضر).
 * بلا بيانات حضور ⇒ met = null (لم يُعقد بعد) فلا يُطبع أي قرار كأنه أُقرّ.
 */
export function hoaQuorum(d: { attendance?: HoaAttendance[] | null; attendees?: number | string | null; total_units?: number | string | null; round?: number | string | null;
  /** حسب النظام الأساسي للجمعية: نصاب الاجتماع الأول (افتراضي 75٪) والثاني (null = أي عدد) */
  first_pct?: number | string | null; second_pct?: number | string | null }): HoaQuorum {
  const round: 1 | 2 = Number(d.round) === 2 ? 2 : 1;
  const firstPct = Number(d.first_pct) > 0 && Number(d.first_pct) <= 100 ? Number(d.first_pct) : 75;
  const secondPct = Number(d.second_pct) > 0 && Number(d.second_pct) <= 100 ? Number(d.second_pct) : null;
  const threshold = round === 2 ? (secondPct ?? 0) : firstPct;
  const list = Array.isArray(d.attendance) ? d.attendance : [];
  const mk = (basis: HoaQuorum["basis"], present: number, total: number): HoaQuorum => {
    const pct = total > 0 ? Math.round((present / total) * 10000) / 100 : null;
    const met = basis === "none" ? null : round === 2 && secondPct === null ? present > 0 : pct !== null && pct >= threshold;
    return { basis, present, total, pct, met, round, threshold };
  };
  /* قائمة حضور بلا أي حاضر = لم يُسجَّل الحضور بعد (لا «غير متحقق») */
  if (list.length && !list.some((a) => a.present)) return mk("none", 0, list.length);
  if (list.length) {
    const u = (x: any) => Math.round((Number(x) || 0) * 10000);
    const allShares = list.every((a) => Number(a.share_pct) > 0);
    const sum = list.reduce((s, a) => s + u(a.share_pct), 0);
    if (allShares && Math.abs(sum - 1000000) <= 100) {
      return mk("shares", list.filter((a) => a.present).reduce((s, a) => s + u(a.share_pct), 0) / 10000, sum / 10000);
    }
    const anyPresent = list.some((a) => a.present);
    if (anyPresent || d.attendees === "" || d.attendees == null) {
      return anyPresent ? mk("units", list.filter((a) => a.present).length, list.length) : mk("none", 0, list.length);
    }
  }
  if (d.attendees !== "" && d.attendees != null && Number(d.total_units) > 0) {
    return mk("units", Math.max(0, Number(d.attendees) || 0), Number(d.total_units));
  }
  return mk("none", 0, Number(d.total_units) || list.length || 0);
}

/** سطر النصاب في المحضر */
function quorumBlock(q: HoaQuorum): string {
  const pctTxt = q.pct === null ? "—" : `${q.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}٪`;
  const what = q.basis === "shares" ? `الحاضرون يملكون ${pctTxt} من الحصص`
    : q.basis === "units" ? `حضر ${q.present} من ${q.total} وحدة (${pctTxt}) — احتُسب بعدد الوحدات لعدم إدخال حصص الملكية`
    : "لم تُدخل بيانات الحضور بعد";
  const need = q.round === 2
    ? (q.threshold > 0 ? `المطلوب في الاجتماع الثاني ${q.threshold}٪ حسب النظام الأساسي للجمعية` : "الاجتماع الثاني يصح بأي عدد من الحاضرين حسب النظام الأساسي للجمعية")
    : `المطلوب في الاجتماع الأول ${q.threshold}٪ من الحصص حسب النظام الأساسي للجمعية`;
  const law = "ويُشترط نظامًا لإقرار القرارات موافقة ملاك ثلاثة أرباع المساحة الإجمالية للوحدات (المادة 18/6).";
  if (q.met === true) return `<div class="note" style="border-inline-start-color:#1E9E6A;background:#E6F4EC;color:#137a50"><b>النصاب متحقق ✓</b> — ${what}. (${need}.) ${law}</div>`;
  if (q.met === false) return `<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c"><b>النصاب غير متحقق ✗</b> — ${what}، و${need}.
    لذلك لم يُتّخذ أي قرار في هذا الاجتماع، ويُدعى إلى اجتماع ثانٍ.</div>`;
  return `<div class="note"><b>النصاب: يُحتسب عند الانعقاد</b> — ${need}. تُدوَّن القرارات بعد التحقق من النصاب والتصويت. ${law}</div>`;
}
/** نص القرار: يُطبع «أُقرّ» فقط إن تحقق النصاب */
/* لا يُثبت المحضر وقائع لم تقع: القرار يُطبع «مُقرًّا» فقط إن تحقق النصاب وأكّد المدير
   أن البند أُقرّ فعلًا (approved[n] من «عُقد الاجتماع وأُقرّ البند»). وإلا فراغ يُدوَّن بعد التصويت. */
const decided = (q: HoaQuorum, text: string, ticked?: boolean) =>
  q.met === true && ticked ? text : q.met === false ? `<span style="color:#a5322c">لم يُتّخذ قرار — النصاب غير مكتمل</span>` : "________________________________ <span style=\"color:#5C6B67;font-size:.75rem\">(يُدوَّن بعد التصويت)</span>";

/** جدول الحضور والتوقيعات — بالحصص إن وُجدت */
function attendanceTable(a: AssociationDoc, list: HoaAttendance[] | null | undefined, esc: (s: any) => string): string {
  const rows = Array.isArray(list) && list.length ? list : null;
  const shares = !!rows && rows.some((r) => Number(r.share_pct) > 0);
  if (rows) {
    return `<table>
  <thead><tr><th>#</th><th>اسم المالك</th><th>الوحدة</th>${shares ? "<th>الحصة</th>" : ""}<th>الحضور</th><th>التوقيع</th></tr></thead>
  <tbody>${rows.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.name)}</td><td>${esc(o.unit || "—")}</td>${shares ? `<td>${Number(o.share_pct) > 0 ? `${Number(o.share_pct).toLocaleString("en-US", { maximumFractionDigits: 4 })}٪` : "—"}</td>` : ""}<td>${o.present ? "حاضر" : "غائب"}</td><td>${o.present ? "________________" : ""}</td></tr>`).join("")}</tbody>
</table>`;
  }
  return `<table>
  <thead><tr><th>#</th><th>اسم المالك</th><th>الوحدة</th><th>التوقيع</th></tr></thead>
  <tbody>
    ${(a.owners && a.owners.length
      ? a.owners.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.name)}</td><td>${esc(o.unit || "—")}</td><td>________________</td></tr>`).join("")
      : Array.from({ length: 8 }, (_, i) => `<tr><td>${i + 1}</td><td>________________</td><td>____</td><td>________________</td></tr>`).join(""))}
  </tbody>
</table>`;
}

/**
 * المُصدِر في مستندات الجمعية = المكتب (اسم الفوترة ثم اسم المنشأة) وإلا «إدارة الجمعية».
 * لا تظهر بيانات تواصل وثيق أبدًا كمُصدِر لمستند جمعية (التذييل الأصلي يعود إليها حين لا اسم).
 */
function hoaIssuer(issuer: Issuer, a: { name: string }): Issuer {
  const name = String(issuer?.billing_name || issuer?.org_name || "").trim() || `إدارة ${a.name}`;
  return { ...(issuer || {}), billing_name: name };
}
/** سطر رقم التسجيل في «ملاك» والرقم الموحّد — النظام يشترط اسم الجمعية ورقم تسجيلها في مراسلاتها */
const regLine = (a: any) => {
  const parts = [a?.mullak_reg_no ? `رقم التسجيل في «ملاك»: ${a.mullak_reg_no}` : "", a?.unified_no ? `الرقم الموحّد: ${a.unified_no}` : ""].filter(Boolean);
  return parts.length ? `<div class="sub" style="margin-top:-12px">${parts.join(" · ")}</div>` : "";
};

/** بند الرسوم في المحضر: بفترته، أو حسب الحصص */
const feeClause = (fee: number, a: AssociationDoc, basis?: string | null, dueDay?: string | null) =>
  (basis || a.fee_basis) === "share"
    ? `توزيع رسوم الاشتراك على الوحدات حسب حصة كل وحدة من الموازنة المعتمدة، وتُستحق ${perWord(a)}${dueDay ? `، وتُسدَّد ${dueDay}` : ""}.`
    : fee ? `تحديد الاشتراك بمبلغ <b>${sar(fee)}</b> ريال لكل وحدة ${perWord(a)}${dueDay ? `، يُسدَّد ${dueDay}` : ""}.` : "";

/** كشف حساب مالك واحد في جمعية */
export function ownerStatementHTML(
  o: OwnerRow, a: AssociationDoc, issuer: Issuer = {}, payments: PaymentRow[] = []
) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  o = scrub(o);
  a = scrub(a);
  issuer = scrub(issuer);
  payments = scrub(payments);
  const fee = ownerFee(o, Number(a.fee) || 0);
  issuer = hoaIssuer(issuer, a);
  const who = issuer.billing_name as string;
  const due = owed(o, fee);
  const partial = Number(o.partial_amount) || 0;
  const received = Math.round(payments.reduce((x, r) => x + (Number(r.amount) || 0), 0) * 100) / 100;
  /* الرصيد لكم (مقدَّم + جزئي حين لا متأخرات) — لموازنة «الاستحقاقات = المستلم + المتبقي − الرصيد لكم» */
  const credit = (Number(o.months_late) || 0) > 0 ? 0 : Math.round(((Number(o.prepaid_months) || 0) * fee + partial) * 100) / 100;

  const body = `
${header("كشف حساب مالك", o.name, issuer)}
<h1>كشف حساب الوحدة رقم (${o.unit || "—"})</h1>
<div class="sub">${a.name} · جمعية ملاك${a.units ? ` · ${countAr(a.units, "وحدة")}` : ""}</div>
${regLine(a)}

<div class="grid">
  <div class="box">
    <h3>بيانات الجمعية</h3>
    <div class="r"><span>الاسم</span><span>${a.name}</span></div>
    <div class="r"><span>الاشتراك ${perAdj(a)}${Number(o.fee_override) > 0 ? " للوحدة" : ""}</span><span>${sar(fee)} ريال</span></div>
    ${Number(o.share_pct) > 0 && a.fee_basis === "share" ? `<div class="r"><span>حصة الوحدة</span><span>${Number(o.share_pct).toLocaleString("en-US", { maximumFractionDigits: 4 })}٪</span></div>` : ""}
    ${a.cert_expiry ? `<div class="r"><span>انتهاء الشهادة</span><span>${arDate(a.cert_expiry)}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>بيانات المالك</h3>
    <div class="r"><span>الاسم</span><span>${o.name}</span></div>
    <div class="r"><span>الوحدة</span><span>${o.unit || "—"}</span></div>
    <div class="r"><span>آخر سداد</span><span>${arDate(o.last_paid)}</span></div>
  </div>
</div>

<div class="tot">
  <div><div class="v r">${o.months_late || 0}</div><div class="l">${isAnnual(a) ? "سنوات متأخرة" : "أشهر متأخرة"}</div></div>
  <div><div class="v">${sar(fee)}</div><div class="l">الاشتراك ${perAdj(a)} (ريال)</div></div>
  ${(Number(o.months_late) || 0) === 0 && (Number(o.prepaid_months) || 0) > 0
    ? `<div><div class="v g">${Number(o.prepaid_months) || 0}</div><div class="l">${isAnnual(a) ? "سنوات" : "أشهر"} مسدَّدة مقدَّمًا</div></div>`
    : `<div><div class="v g">${sar(partial)}</div><div class="l">${(Number(o.months_late) || 0) > 0 ? "مدفوع جزئيًّا" : "رصيد لكم"} (ريال)</div></div>`}
  <div><div class="v g">${sar(received)}</div><div class="l">إجمالي المستلم (ريال)</div></div>
</div>

<table><tbody>
  <tr><td>إجمالي الاستحقاقات حتى تاريخه <span style="color:#5C6B67;font-size:.75rem">(المستلم + المتبقي − الرصيد لكم)</span></td><td style="text-align:left;font-weight:600">${sar(Math.round((received + due - credit) * 100) / 100)} ريال</td></tr>
  <tr><td>إجمالي المستلم</td><td style="text-align:left;font-weight:600">${sar(received)} ريال</td></tr>
  <tr style="background:#F3EEE2;font-weight:700"><td>${due > 0 ? "المتبقي عليكم" : "الرصيد لكم"}</td><td style="text-align:left">${sar(due > 0 ? due : credit)} ريال</td></tr>
</tbody></table>
${due > 0 ? `<div class="due"><span class="l">الرصيد المستحق حتى تاريخه</span><span class="v">${sar(due)} ريال</span></div>`
  : `<div class="note">لا مستحقات على الوحدة حتى تاريخه${(Number(o.prepaid_months) || 0) > 0 ? ` — مسدَّد مقدَّمًا لـ ${periodsWord(Number(o.prepaid_months), a)}` : ""}${partial > 0 && !(Number(o.months_late) > 0) ? ` — ورصيد لكم ${sar(partial)} ريال يُخصم من ${isAnnual(a) ? "السنة القادمة" : "الشهر القادم"}` : ""}.</div>`}

${payments.length ? `
<h1 style="font-size:1rem">المدفوعات المستلمة</h1>
<table>
  <thead><tr><th>#</th><th>تاريخ الاستلام</th><th>المبلغ (ريال)</th><th>طريقة السداد</th><th>السند / المرجع</th></tr></thead>
  <tbody>
    ${payments.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${r.paid_on ? arDate(r.paid_on) : "—"}</td><td>${sar(r.amount)}</td>
      <td>${payMethod(r)}</td><td>${r.note ? r.note /* مُعقَّم بـscrub أعلاه — escH هنا كان يهرّب مرتين */ : "—"}</td>
    </tr>`).join("")}
    <tr style="background:#F3EEE2;font-weight:700">
      <td colspan="2">إجمالي المستلم</td><td>${sar(received)}</td><td colspan="2">${countAr(payments.length, "عملية")}</td>
    </tr>
  </tbody>
</table>` : `<div class="note">لا توجد مدفوعات موثّقة في سجل المنصة لهذه الوحدة حتى تاريخه.</div>`}

<div class="note">
  تُخصَّص اشتراكات الصيانة لتشغيل الأجزاء المشتركة وصيانتها وفق الموازنة المعتمدة، ويكون السداد في الحساب البنكي للجمعية.
  هذا كشف استرشادي صادر آليًّا — يُرجى مطابقته مع سجلاتكم وإشعارنا بأي فرق.
</div>

<div class="sign">
  <div>إدارة الجمعية: ${who}<br><br>التوقيع: ________________</div>
  <div>المالك: ${o.name}<br><br>التوقيع: ________________</div>
</div>
${footer(issuer)}`;
  return SHELL(`كشف حساب — ${o.name}`, body, markOf(issuer));
}

/** كشف حساب الجمعية كاملة — كل الملّاك */
export function associationStatementHTML(a: AssociationDoc, issuer: Issuer = {}) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  a = scrub(a);
  issuer = scrub(issuer);
  const fee = Number(a.fee) || 0;
  issuer = hoaIssuer(issuer, a);
  const who = issuer.billing_name as string;
  const rows = a.owners || [];
  const late = rows.filter((o) => (Number(o.months_late) || 0) > 0);
  const totalDue = Math.round(rows.reduce((s, o) => s + owed(o, fee), 0) * 100) / 100;
  const expected = Math.round(rows.reduce((s, o) => s + ownerFee(o, fee), 0) * 100) / 100;
  const pct = rows.length ? Math.round(((rows.length - late.length) / rows.length) * 100) : 0;

  const body = `
${header("كشف حساب جمعية", a.name, issuer)}
<h1>كشف حساب ${a.name}</h1>
${regLine(a)}
<div class="sub">جمعية ملاك · ${countAr(rows.length, "مالك")}${a.units ? ` من ${countAr(a.units, "وحدة")}` : ""} · ${a.fee_basis === "share" ? `الاشتراك ${perAdj(a)} حسب حصة كل وحدة` : `الاشتراك ${perAdj(a)} ${sar(fee)} ريال`}</div>

<div class="tot">
  <div><div class="v">${rows.length}</div><div class="l">إجمالي الملّاك</div></div>
  <div><div class="v g">${rows.length - late.length}</div><div class="l">منتظم</div></div>
  <div><div class="v r">${late.length}</div><div class="l">متأخر</div></div>
  <div><div class="v">${pct}%</div><div class="l">نسبة السداد</div></div>
</div>

<div class="grid">
  <div class="box">
    <h3>الوضع المالي</h3>
    <div class="r"><span>الإيرادات المتوقّعة ${isAnnual(a) ? "للسنة" : "للشهر"}</span><span>${sar(expected)} ريال</span></div>
    <div class="r"><span>إجمالي المتأخر</span><span>${sar(totalDue)} ريال</span></div>
    ${a.fund_balance != null ? `<div class="r"><span>رصيد الصندوق</span><span>${moneySigned(a.fund_balance)} ريال</span></div>` : ""}
  </div>
  <div class="box">
    <h3>الوضع النظامي</h3>
    <div class="r"><span>انتهاء الشهادة</span><span>${arDate(a.cert_expiry)}</span></div>
    ${issuer.cr_number ? `<div class="r"><span>السجل التجاري</span><span>${issuer.cr_number}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
  </div>
</div>

${totalDue > 0 ? `<div class="due"><span class="l">إجمالي المستحق على الملّاك</span><span class="v">${sar(totalDue)} ريال</span></div>` : ""}

<table>
  <thead><tr><th>الوحدة</th><th>المالك</th><th>${isAnnual(a) ? "سنوات" : "أشهر"} متأخرة</th><th>المتأخر (ريال)</th><th>آخر سداد</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map((o) => {
      const d = owed(o, fee); const m = Number(o.months_late) || 0;
      return `<tr>
        <td>${o.unit || "—"}</td>
        <td>${o.name}</td>
        <td>${m || "—"}</td>
        <td>${d ? sar(d) : "—"}</td>
        <td>${arDate(o.last_paid)}</td>
        <td>${m >= 3 ? '<span class="pill l">متأخر 3+</span>'
            : (Number(o.partial_amount) || 0) > 0 && m > 0 ? '<span class="pill u">دفع جزءًا</span>'
            : m > 0 ? '<span class="pill l">متأخر</span>'
            : '<span class="pill p">لا متأخرات</span>'}</td>
      </tr>`;
    }).join("")}
  </tbody>
</table>

<div class="note">كشف استرشادي صادر آليًّا من بيانات الجمعية المسجّلة بتاريخ ${arDate(today())}. يُصرف من الاشتراكات وفق الموازنة المعتمدة من الجمعية العامة.</div>
<div class="sign"><div>إدارة الجمعية: ${who}<br><br>التوقيع: ________________</div><div>تاريخ الإصدار: ${arDate(today())}</div></div>
${footer(issuer)}`;
  return SHELL(`كشف حساب — ${a.name}`, body, markOf(issuer));
}

// ============================================================
// الموازنة التقديرية ومحضر الجمعية العمومية التأسيسية
// ============================================================

export type BudgetItem = { label: string; monthly: number; note?: string | null };

/** بنود مصروفات نموذجية لعقار سكني مشترك — نقطة بداية يعدّلها المستخدم */
export const DEFAULT_BUDGET_ITEMS: BudgetItem[] = [
  { label: "النظافة العامة للأجزاء المشتركة", monthly: 0 },
  { label: "الأمن والحراسة", monthly: 0 },
  { label: "صيانة المصاعد (عقد دوري)", monthly: 0 },
  { label: "صيانة التكييف والتهوية", monthly: 0 },
  { label: "كهرباء ومياه الأجزاء المشتركة", monthly: 0 },
  { label: "صيانة المضخات والخزانات", monthly: 0 },
  { label: "مكافحة الحشرات", monthly: 0 },
  { label: "أعمال سباكة وكهرباء طارئة", monthly: 0 },
  { label: "أجرة مدير العقار", monthly: 0 },
  { label: "مصروفات إدارية وبنكية", monthly: 0 },
];

/** الموازنة التقديرية السنوية — أساس اعتماد الاشتراك من الجمعية العامة */
export function budgetHTML(
  a: AssociationDoc & { units?: number },
  budget: { year: number; items: BudgetItem[]; reserve_pct?: number; notes?: string | null },
  issuer: Issuer = {}
) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  a = scrub(a);
  budget = scrub(budget);
  issuer = scrub(issuer);
  issuer = hoaIssuer(issuer, a);
  const who = issuer.billing_name as string;
  const items = (budget.items || []).filter((i) => i && i.label);
  const monthlyTotal = items.reduce((s, i) => s + (Number(i.monthly) || 0), 0);
  const annualOps = monthlyTotal * 12;
  const reservePct = Number(budget.reserve_pct ?? 10) || 0;
  const reserve = Math.round(annualOps * (reservePct / 100));
  const annualTotal = annualOps + reserve;

  const units = Number(a.units) || (a.owners || []).length || 0;
  const perUnitYear = units ? Math.round(annualTotal / units) : 0;
  const perUnitMonth = units ? Math.round(annualTotal / units / 12) : 0;
  const currentFee = Number(a.fee) || 0;
  /* (30 سبتمبر 2026) الرسم بفترته: السنوي لا يُضرب في 12. وبالحصص: مجموع رسوم الملاك الفعلية */
  const ppy = isAnnual(a) ? 1 : 12;
  const byShares = a.fee_basis === "share" && (a.owners || []).length > 0;
  const currentAnnual = byShares
    ? Math.round((a.owners || []).reduce((s, o) => s + ownerFee(o, currentFee), 0) * ppy * 100) / 100
    : currentFee * ppy * units;
  const gap = annualTotal - currentAnnual;

  const body = `
${header("موازنة تقديرية", String(budget.year), issuer)}
<h1>الموازنة التقديرية لعام ${budget.year}</h1>
<div class="sub">${a.name} · جمعية ملاك${units ? ` · ${countAr(units, "وحدة")}` : ""}</div>

<div class="note">
  هذه موازنة تقديرية تُعرض على الجمعية العامة لاعتمادها، وعلى أساسها يُحدَّد اشتراك الصيانة.
  الأرقام أدناه مدخلة من إدارة الجمعية وقابلة للتعديل قبل التصويت.
</div>

<h1 style="font-size:1rem">أولًا: المصروفات التشغيلية</h1>
<table>
  <thead><tr><th>#</th><th>البند</th><th>شهريًّا (ريال)</th><th>سنويًّا (ريال)</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${items.map((i, n) => `<tr>
      <td>${n + 1}</td>
      <td>${String(i.label).replace(/</g, "&lt;")}</td>
      <td>${sar(i.monthly)}</td>
      <td>${sar((Number(i.monthly) || 0) * 12)}</td>
      <td>${i.note ? String(i.note).replace(/</g, "&lt;") : "—"}</td>
    </tr>`).join("")}
    <tr style="background:#F3EEE2;font-weight:700">
      <td colspan="2">إجمالي المصروفات التشغيلية</td>
      <td>${sar(monthlyTotal)}</td>
      <td>${sar(annualOps)}</td>
      <td>—</td>
    </tr>
  </tbody>
</table>

<h1 style="font-size:1rem">ثانيًا: احتياطي الصيانة الرأسمالية</h1>
<table>
  <tbody>
    <tr><td>نسبة الاحتياطي من المصروفات التشغيلية</td><td style="text-align:left;font-weight:600">${reservePct}%</td></tr>
    <tr><td>مبلغ الاحتياطي السنوي</td><td style="text-align:left;font-weight:600">${sar(reserve)} ريال</td></tr>
  </tbody>
</table>
<div class="note">
  يُخصَّص الاحتياطي للأعمال الكبيرة غير الدورية (تجديد المصاعد، العزل، الأصباغ الخارجية، استبدال المضخات)،
  ويقي الملّاك من مطالبات مالية مفاجئة.
</div>

<div class="due">
  <span class="l">إجمالي الموازنة التقديرية لعام ${budget.year}</span>
  <span class="v">${sar(annualTotal)} ريال</span>
</div>

<h1 style="font-size:1rem">ثالثًا: الاشتراك المقترح لكل وحدة</h1>
${units > 0 ? `<div class="tot">
  <div><div class="v">${units}</div><div class="l">عدد الوحدات</div></div>
  <div><div class="v">${sar(perUnitYear)}</div><div class="l">سنويًّا لكل وحدة (ريال)</div></div>
  <div><div class="v">${sar(perUnitMonth)}</div><div class="l">شهريًّا لكل وحدة (ريال)</div></div>
  ${currentAnnual > 0
    ? `<div><div class="v ${gap > 0 ? "r" : "g"}">${sar(Math.abs(gap))}</div><div class="l">${gap > 0 ? "عجز متوقّع (ريال)" : "فائض متوقّع (ريال)"}</div></div>`
    : `<div><div class="v">—</div><div class="l">لم يُعتمد اشتراك بعد</div></div>`}
</div>` : `<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>لم يُحدَّد عدد الوحدات.</b> أدخل عدد وحدات العقار في إعدادات الجمعية ليُحتسب الاشتراك المقترح لكل وحدة —
  وهو الرقم الذي تُبنى عليه الموازنة.
</div>`}

${currentAnnual > 0 ? `<table>
  <tbody>
    <tr><td>الاشتراك الحالي المعتمد</td><td style="text-align:left;font-weight:600">${byShares ? `حسب حصة كل وحدة (${isAnnual(a) ? "سنويًّا" : "شهريًّا"})` : `${sar(currentFee)} ريال / ${isAnnual(a) ? "سنة" : "شهر"} لكل وحدة`}</td></tr>
    <tr><td>إيرادات الاشتراك الحالي سنويًّا</td><td style="text-align:left;font-weight:600">${sar(currentAnnual)} ريال</td></tr>
    <tr style="background:${gap > 0 ? "#FBE9E7" : "#E6F4EC"};font-weight:700">
      <td>${gap > 0 ? "الفرق المطلوب تغطيته" : "الفائض المرحّل"}</td>
      <td style="text-align:left">${sar(Math.abs(gap))} ريال</td>
    </tr>
  </tbody>
</table>` : ""}

${budget.notes ? `<div class="note">${String(budget.notes).replace(/</g, "&lt;")}</div>` : ""}

<div class="note">
  يُحدَّد مبلغ الاشتراك السنوي بقرار من الجمعية العامة وفق النظام الأساسي للجمعية،
  ويُودَع في الحساب البنكي للجمعية ويُصرف منه وفق هذه الموازنة المعتمدة.
</div>

<div class="sign">
  <div>أعدّها: ${who}<br><br>التوقيع: ________________</div>
  <div>اعتماد رئيس الجمعية<br><br>التوقيع: ________________</div>
</div>
${footer(issuer)}`;
  return SHELL(`الموازنة التقديرية ${budget.year} — ${a.name}`, body, markOf(issuer));
}

/** محضر الجمعية العمومية التأسيسية */
export function foundingMinutesHTML(
  a: AssociationDoc & { units?: number },
  d: {
    meeting_date?: string; place?: string; mode?: string;
    attendees?: number; total_units?: number;
    president?: string; manager?: string;
    fee?: number; due_day?: string; bank?: string;
    year?: number; annual_budget?: number;
    /** v63: فترة الرسم وأساسه، والحضور بالحصص، ورقم الاجتماع (1 أول · 2 ثانٍ) */
    fee_period?: string; fee_basis?: string; attendance?: HoaAttendance[]; round?: number;
    /** approved[n] = المدير أكّد «عُقد الاجتماع وأُقرّ البند n» */
    approved?: boolean[];
  },
  issuer: Issuer = {}
) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  a = scrub(a);
  d = scrub(d);
  issuer = scrub(issuer);
  issuer = hoaIssuer(issuer, a);
  const who = issuer.billing_name as string;
  const date = d.meeting_date || today();
  const units = Number(d.total_units) || Number(a.units) || (a.owners || []).length || 0;
  const q = hoaQuorum({ attendance: d.attendance, attendees: d.attendees as any, total_units: units, round: d.round,
    first_pct: a.quorum_first_pct, second_pct: a.quorum_second_pct });
  const ap1 = (n: number) => !!(d.approved || [])[n];
  const att = q.basis === "units" ? q.present : (d.attendance || []).filter((x) => x.present).length || Number(d.attendees) || 0;
  const fee = Number(d.fee) || Number(a.fee) || 0;
  const ap = { fee_period: d.fee_period || a.fee_period };

  const body = `
${header("محضر اجتماع", "الجمعية العمومية التأسيسية", issuer)}
<h1>محضر الجمعية العمومية التأسيسية</h1>
<div class="sub">${a.name}${units ? ` · ${countAr(units, "وحدة")}` : ""}</div>
${regLine(a)}

<div class="grid">
  <div class="box">
    <h3>بيانات الاجتماع</h3>
    <div class="r"><span>التاريخ</span><span>${arDate(date)}</span></div>
    <div class="r"><span>طريقة الانعقاد</span><span>${d.mode || "حضوري"}</span></div>
    ${d.place ? `<div class="r"><span>المكان</span><span>${d.place}</span></div>` : ""}
    <div class="r"><span>الاجتماع</span><span>${q.round === 2 ? "الثاني (بعد عدم اكتمال نصاب الأول)" : "الأول"}</span></div>
    <div class="r"><span>عدد الحاضرين</span><span>${q.basis === "none" ? "—" : att} من ${(d.attendance || []).length || units || "—"}</span></div>
    <div class="r"><span>${q.basis === "shares" ? "الحصص الحاضرة" : "نسبة الحضور"}</span><span>${q.pct === null || q.basis === "none" ? "—" : q.pct.toLocaleString("en-US", { maximumFractionDigits: 2 }) + "٪"}</span></div>
  </div>
  <div class="box">
    <h3>الأساس النظامي</h3>
    <div class="r"><span>النظام</span><span>ملكية الوحدات العقارية وفرزها وإدارتها</span></div>
    <div class="r"><span>المرسوم الملكي</span><span>م/85 وتاريخ 02/07/1441هـ</span></div>
    <div class="r"><span>الجهة المشرفة</span><span>الهيئة العامة للعقار</span></div>
  </div>
</div>
${quorumBlock(q)}

<div class="note">
  عُقد هذا الاجتماع لتأسيس جمعية ملاك العقار المشترك المذكور أعلاه، وفقًا لنظام ملكية الوحدات العقارية
  وفرزها وإدارتها ولائحته التنفيذية، وبما أن عدد ملّاك الوحدات المفرزة ثلاثة أو أكثر.
</div>

<h1 style="font-size:1rem">جدول الأعمال والقرارات</h1>
<table>
  <thead><tr><th>#</th><th>البند</th><th>القرار</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>تأسيس جمعية الملاك واعتماد نظامها الأساسي</td>
        <td>${decided(q, "الموافقة على التأسيس واعتماد النظام الأساسي (الاسترشادي الصادر من الهيئة).", ap1(1))}</td></tr>
    <tr><td>2</td><td>انتخاب رئيس الجمعية</td>
        <td>${decided(q, d.president ? `انتخاب المكرَّم <b>${escH(d.president)}</b> رئيسًا للجمعية.` : "________________________________", ap1(2))}</td></tr>
    <tr><td>3</td><td>تعيين مدير العقار</td>
        <td>${decided(q, d.manager ? `تعيين <b>${escH(d.manager)}</b> مديرًا للعقار.` : "________________________________", ap1(3))}</td></tr>
    <tr><td>4</td><td>اعتماد الموازنة التقديرية${d.year ? ` لعام ${d.year}` : ""}</td>
        <td>${decided(q, d.annual_budget ? `اعتماد موازنة بإجمالي <b>${sar(d.annual_budget)}</b> ريال سنويًّا.` : "________________________________", ap1(4))}</td></tr>
    <tr><td>5</td><td>تحديد اشتراك الصيانة وموعد سداده</td>
        <td>${decided(q, feeClause(fee, ap as any, d.fee_basis, d.due_day) || "________________________________", ap1(5))}</td></tr>
    <tr><td>6</td><td>فتح الحساب البنكي للجمعية</td>
        <td>${decided(q, d.bank ? `تفويض إدارة الجمعية بفتح حساب لدى <b>${escH(d.bank)}</b> باسم الجمعية.` : "تفويض إدارة الجمعية بفتح حساب بنكي باسم الجمعية.", ap1(6))}</td></tr>
    <tr><td>7</td><td>تسجيل الجمعية لدى الهيئة العامة للعقار</td>
        <td>${decided(q, "تفويض رئيس الجمعية بإتمام التسجيل عبر منصة «ملاك» واستكمال المتطلبات النظامية.", ap1(7))}</td></tr>
  </tbody>
</table>

<div class="note">
  تُودَع الاشتراكات في الحساب البنكي للجمعية، ولا يجوز الصرف منها إلا وفق الموازنة المعتمدة.
  ولا يملك مدير العقار صلاحية تعديل النظام الأساسي أو فرض رسوم جديدة.
</div>

<h1 style="font-size:1rem">${d.attendance && d.attendance.length ? "الحضور والتوقيعات" : "توقيعات الحاضرين"}</h1>
${attendanceTable(a, d.attendance, escH)}

<div class="sign">
  <div>رئيس الجمعية: ${d.president || "________________"}<br><br>التوقيع: ________________</div>
  <div>مدير العقار: ${d.manager || "________________"}<br><br>التوقيع: ________________</div>
</div>
<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>تنويه:</b> هذا نموذج محضر استرشادي أعدّته إدارة الجمعية للاستخدام الإداري.
  وثيق لا يقدّم خدمات قانونية ولا يمثّل الجمعية أمام أي جهة — راجع النموذج مع مختص مرخّص
  وطابقه مع النظام الأساسي المعتمد قبل تقديمه رسميًّا.
</div>
${footer(issuer)}`;
  return SHELL(`محضر تأسيسي — ${a.name}`, body, markOf(issuer));
}

// ============================================================
// مخالصة إخلاء وحدة — تسوية التأمين وقراءات العدادات
// ============================================================

export function moveOutSettlementHTML(
  t: Tenant & {
    status?: string | null; move_out_date?: string | null; notice_date?: string | null;
    deposit_amount?: number | null; deposit_deductions?: number | null; deposit_notes?: string | null;
    meter_elec_in?: string | null; meter_elec_out?: string | null;
    meter_water_in?: string | null; meter_water_out?: string | null;
    elec_account?: string | null; water_account?: string | null;
    turnover_checklist?: { label: string; done?: boolean; note?: string | null }[] | null;
  },
  p: Property, issuer: Issuer = {}
) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  t = scrub(t);
  p = scrub(p);
  issuer = scrub(issuer);
  const st = contractState(t as any, winOf(p, issuer));
  const ul = unitWordFor((t as any).unit_type, p.property_type);
  const who = issuer.billing_name || issuer.org_name || p.manager || "إدارة الأملاك";
  /* كل ما على المستأجر — متأخر المدة شاملًا الضريبة المضافة + الدين المرحَّل
     (مراجعة 29 سبتمبر 2026). كان متأخر المدة وحده قبل الضريبة. */
  const rentOwed = dueIncl(st, vatOf(p, t));
  const carriedOwed = Math.max(0, Number((t as any).carried_debt) || 0);
  const s = settleDeposit(t as any, Math.round((rentOwed + carriedOwed) * 100) / 100);
  const list = Array.isArray(t.turnover_checklist) ? t.turnover_checklist : [];
  const doneCount = list.filter((x) => x?.done).length;
  const vac = vacancyDays(t.move_out_date);
  /* (30 سبتمبر 2026) قراءة التسليم «0» قيمة حقيقية (عدّاد جديد) لا غياب قراءة —
     كان الفرق يظهر «—» كلما كانت قراءة التسليم صفرًا. */
  const hasNum = (x: any) => x !== null && x !== undefined && String(x).trim() !== "" && Number.isFinite(Number(x));
  const meterCell = (x: any) => (hasNum(x) ? String(x) : "—");
  const meterDiff = (inV: any, outV: any) => (hasNum(inV) && hasNum(outV) ? sar(Number(outV) - Number(inV)) : "—");
  const body = `
${header("مخالصة إخلاء", t.name, issuer)}
<h1>مخالصة إخلاء ${ul} رقم (${t.unit || "—"})</h1>
<div class="sub">${p.name}${p.address ? ` — ${p.address}` : ""}${p.city ? `، ${p.city}` : ""} · ${typeLabel(p.property_type)}</div>

<div class="grid">
  <div class="box">
    <h3>بيانات الطرفين</h3>
    <div class="r"><span>المؤجّر / الوكيل</span><span>${who}</span></div>
    <div class="r"><span>المستأجر</span><span>${t.name}</span></div>
    ${t.national_id ? `<div class="r"><span>الهوية / السجل</span><span>${t.national_id}</span></div>` : ""}
    ${t.phone ? `<div class="r"><span>الجوال</span><span>${t.phone}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>بيانات الإخلاء</h3>
    ${t.contract_no ? `<div class="r"><span>رقم العقد</span><span dir="ltr"><b>${t.contract_no}</b></span></div>` : ""}
    <div class="r"><span>الوحدة</span><span>${unitDesc(t, p)}</span></div>
    ${p.usage ? `<div class="r"><span>استخدام العقار</span><span>${USAGE_AR[String(p.usage)] || p.usage}</span></div>` : ""}
    ${t.first_due ? `<div class="r"><span>أول استحقاق</span><span>${arDateH(t.first_due)}</span></div>` : ""}
    <div class="r"><span>بداية العقد</span><span>${arDateH(t.contract_start)}</span></div>
    <div class="r"><span>نهاية العقد</span><span>${arDateH(st.endDate)}</span></div>
    ${t.notice_date ? `<div class="r"><span>تاريخ الإشعار</span><span>${arDate(t.notice_date)}</span></div>` : ""}
    <div class="r"><span>تاريخ الإخلاء الفعلي</span><span>${arDate(t.move_out_date)}</span></div>
    ${vac !== null ? `<div class="r"><span>مدة الشغور حتى تاريخه</span><span>${vac > 0 ? daysAr(vac) : vac === 0 ? "أُخليت اليوم" : "—"}</span></div>` : ""}
  </div>
</div>

<h1 style="font-size:1rem">أولًا: قراءات العدادات</h1>
${(t.elec_account || t.water_account) ? `<div class="sub" style="margin-bottom:6px">حساب الكهرباء: <b dir="ltr">${t.elec_account || "—"}</b> · حساب الماء: <b dir="ltr">${t.water_account || "—"}</b> — على المستأجر سداد ما استُهلك حتى قراءة الإخلاء وعلى الطرفين إتمام نقل الخدمة.</div>` : ""}
<table>
  <thead><tr><th>العدّاد</th><th>عند التسليم</th><th>عند الإخلاء</th><th>الفرق</th></tr></thead>
  <tbody>
    <tr>
      <td>الكهرباء</td><td>${meterCell(t.meter_elec_in)}</td><td>${meterCell(t.meter_elec_out)}</td>
      <td>${meterDiff(t.meter_elec_in, t.meter_elec_out)}</td>
    </tr>
    <tr>
      <td>المياه</td><td>${meterCell(t.meter_water_in)}</td><td>${meterCell(t.meter_water_out)}</td>
      <td>${meterDiff(t.meter_water_in, t.meter_water_out)}</td>
    </tr>
  </tbody>
</table>
<div class="note">يتحمّل المستأجر استهلاك الخدمات حتى تاريخ الإخلاء، ويلتزم بنقل أو فصل الاشتراكات باسمه.</div>

<h1 style="font-size:1rem">ثانيًا: تسوية مبلغ التأمين</h1>
<table>
  <tbody>
    <tr><td>مبلغ التأمين المستلم</td><td style="text-align:left;font-weight:600">${sar(s.deposit)} ريال</td></tr>
    <tr><td>يُخصم: إيجار متأخر حتى تاريخ الإخلاء${vatOf(p, t).enabled ? " (شامل الضريبة)" : ""}</td><td style="text-align:left;font-weight:600">${sar(rentOwed)} ريال</td></tr>
    ${carriedOwed > 0 ? `<tr><td>يُخصم: دين مرحَّل من مدة سابقة</td><td style="text-align:left;font-weight:600">${sar(carriedOwed)} ريال</td></tr>` : ""}
    <tr><td>يُخصم: تلفيات وأعمال إصلاح</td><td style="text-align:left;font-weight:600">${sar(s.deductions)} ريال</td></tr>
    ${s.refund > 0
      ? `<tr style="background:#E6F4EC;font-weight:700"><td>المستحق ردّه للمستأجر</td><td style="text-align:left">${sar(s.refund)} ريال</td></tr>`
      : `<tr style="background:#FBE9E7;font-weight:700"><td>المستحق على المستأجر بعد استنفاد التأمين</td><td style="text-align:left">${sar(s.dueFromTenant)} ريال</td></tr>`}
  </tbody>
</table>
${t.deposit_notes ? `<div class="note">تفصيل الخصومات: ${String(t.deposit_notes).replace(/</g, "&lt;")}</div>` : ""}

${list.length ? `
<h1 style="font-size:1rem">ثالثًا: قائمة تحقّق التسليم (${doneCount} من ${list.length})</h1>
<table>
  <thead><tr><th>#</th><th>البند</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${list.map((x, i) => `<tr>
      <td>${i + 1}</td>
      <td>${String(x.label || "").replace(/</g, "&lt;")}</td>
      <td>${x.done ? '<span class="pill p">تم</span>' : '<span class="pill u">لم يتم</span>'}</td>
      <td>${x.note ? String(x.note).replace(/</g, "&lt;") : "—"}</td>
    </tr>`).join("")}
  </tbody>
</table>` : ""}

<div class="note">
  بتوقيع الطرفين على هذه المخالصة، تُعدّ العلاقة الإيجارية منتهية عن ${ul} رقم (${t.unit || "—"})،
  ${/* (30 سبتمبر 2026) «يُقرّ كل طرف باستلام مستحقاته» كانت تُطبع حتى والمستأجر
       مدين بعد استنفاد التأمين — فيوقّع المؤجّر على إبراءٍ لم يقصده. */
    s.dueFromTenant > 0
    ? `ويُقرّ المستأجر بأن في ذمّته للمؤجّر مبلغ <b>${sar(s.dueFromTenant)}</b> ريال بعد استنفاد التأمين، يلتزم بسداده، ولا تُعدّ هذه المخالصة إبراءً منه`
    : s.refund > 0
      ? `ويلتزم المؤجّر بردّ مبلغ <b>${sar(s.refund)}</b> ريال للمستأجر، ويُقرّ كل طرف بأنه لا مطالبة له على الآخر فيما سُوّي أعلاه بعد ذلك`
      : "ويُقرّ كل طرف بأنه لا مطالبة له على الآخر فيما سُوّي أعلاه"}،
  مع بقاء أي التزام لم يُذكر صراحةً خاضعًا لأحكام العقد والأنظمة المعمول بها.
</div>

<div class="sign">
  <div>المؤجّر / الوكيل: ${who}<br><br>التوقيع: ________________</div>
  <div>المستأجر: ${t.name}<br><br>التوقيع: ________________</div>
</div>
<div class="note" style="border-inline-start-color:#B8791F;background:#FBF1DF;color:#8a5a11">
  مستند إداري صادر عن إدارة الأملاك لتوثيق التسليم بين الطرفين. وثيق لا يقدّم خدمات قانونية ولا يستلم أي مبالغ —
  راجعه مع مختص مرخّص قبل الاعتماد الرسمي.
</div>
${footer(issuer)}`;
  return SHELL(`مخالصة إخلاء — ${t.name}`, body, markOf(issuer));
}

// ============================================================
// محضر الاجتماع السنوي للجمعية العمومية
// النظام يوجب انعقاد الجمعية العامة مرة على الأقل سنويًّا خلال ثلاثة أشهر من نهاية السنة
// المالية؛ وما زاد على ذلك (عدد الاجتماعات، المدد) من النظام الأساسي النموذجي وقابل للتعديل. والمادة (التاسعة)
// تجعل اعتماد الميزانية وتقرير المدير وإبراء ذمّته من اختصاصات الجمعية العامة.
// ملاحظة: إصدار شهادة الجمعية إجراء إلكتروني مباشر في منصة «ملاك» ولا يتطلّب رفع مستندات.
// ============================================================

export function renewalMinutesHTML(
  a: AssociationDoc & { units?: number },
  d: {
    meeting_date?: string; place?: string; mode?: string;
    attendees?: number; total_units?: number;
    president?: string; manager?: string;
    fee?: number; year?: number; annual_budget?: number;
    collected?: number; spent?: number; fund_balance?: number;
    notes?: string;
    /** v63: فترة الرسم وأساسه، والحضور بالحصص، ورقم الاجتماع */
    fee_period?: string; fee_basis?: string; attendance?: HoaAttendance[]; round?: number;
    approved?: boolean[];
  },
  issuer: Issuer = {}
) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  a = scrub(a);
  d = scrub(d);
  issuer = hoaIssuer(scrub(issuer), a);
  const esc = (s: any) => String(s ?? "").replace(/</g, "&lt;");
  const date = d.meeting_date || today();
  const units = Number(d.total_units) || Number(a.units) || (a.owners || []).length || 0;
  const q = hoaQuorum({ attendance: d.attendance, attendees: d.attendees as any, total_units: units, round: d.round,
    first_pct: a.quorum_first_pct, second_pct: a.quorum_second_pct });
  const ap1 = (n: number) => !!(d.approved || [])[n];
  const att = q.basis === "units" ? q.present : (d.attendance || []).filter((x) => x.present).length || Number(d.attendees) || 0;
  const fee = Number(d.fee) || Number(a.fee) || 0;
  const ap = { fee_period: d.fee_period || a.fee_period };
  /* السنة بتوقيت الرياض لا الجهاز */
  const nextYear = Number(d.year) || Number(today().slice(0, 4)) + 1;
  const collected = Number(d.collected) || 0;
  const spent = Number(d.spent) || 0;
  const fund = d.fund_balance !== undefined ? Number(d.fund_balance) || 0 : Number(a.fund_balance) || 0;

  const body = `
${header("محضر اجتماع", "الجمعية العمومية السنوية", issuer)}
<h1>محضر اجتماع الجمعية العمومية السنوي</h1>
<div class="sub">${a.name}${units ? ` · ${countAr(units, "وحدة")}` : ""} · الاجتماع السنوي واعتماد موازنة عام ${nextYear}</div>
${regLine(a)}

<div class="grid">
  <div class="box">
    <h3>بيانات الاجتماع</h3>
    <div class="r"><span>التاريخ</span><span>${arDate(date)}</span></div>
    <div class="r"><span>طريقة الانعقاد</span><span>${d.mode || "حضوري"}</span></div>
    ${d.place ? `<div class="r"><span>المكان</span><span>${esc(d.place)}</span></div>` : ""}
    <div class="r"><span>الاجتماع</span><span>${q.round === 2 ? "الثاني (بعد عدم اكتمال نصاب الأول)" : "الأول"}</span></div>
    <div class="r"><span>عدد الحاضرين</span><span>${q.basis === "none" ? "—" : att} من ${(d.attendance || []).length || units || "—"}</span></div>
    <div class="r"><span>${q.basis === "shares" ? "الحصص الحاضرة" : "نسبة الحضور"}</span><span>${q.pct === null || q.basis === "none" ? "—" : q.pct.toLocaleString("en-US", { maximumFractionDigits: 2 }) + "٪"}</span></div>
  </div>
  <div class="box">
    <h3>الأساس النظامي</h3>
    <div class="r"><span>النظام</span><span>ملكية الوحدات العقارية وفرزها وإدارتها</span></div>
    <div class="r"><span>المرسوم الملكي</span><span>م/85 وتاريخ 02/07/1441هـ</span></div>
    <div class="r"><span>الجهة المشرفة</span><span>الهيئة العامة للعقار — منصة ملاك</span></div>
    <div class="r"><span>سند الانعقاد</span><span>النظام الأساسي — المادتان (9) و(14/2)</span></div>
  </div>
</div>
${quorumBlock(q)}

<div class="note">
  عُقد هذا الاجتماع السنوي لاستعراض أعمال الجمعية عن العام المنقضي، واعتماد الموازنة التقديرية
  لعام ${nextYear}، وتقرير مبلغ اشتراك الصيانة تمهيدًا لإدخاله في قرار رسوم الاشتراك بمنصة «ملاك»
  وطرحه للتصويت.
</div>

<h1 style="font-size:1rem">أولًا: الموقف المالي للعام المنقضي</h1>
<table>
  <tbody>
    <tr><td>إجمالي الاشتراكات المحصَّلة</td><td style="text-align:left;font-weight:600">${collected ? sar(collected) + " ريال" : "________________"}</td></tr>
    <tr><td>إجمالي المصروفات (تشغيل وصيانة)</td><td style="text-align:left;font-weight:600">${spent ? sar(spent) + " ريال" : "________________"}</td></tr>
    <tr style="background:#F3EEE2;font-weight:700"><td>رصيد صندوق الجمعية</td><td style="text-align:left">${moneySigned(fund)} ريال</td></tr>
  </tbody>
</table>

<h1 style="font-size:1rem">ثانيًا: جدول الأعمال والقرارات</h1>
<table>
  <thead><tr><th>#</th><th>البند</th><th>القرار</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>تقرير أعمال الجمعية عن العام المنقضي</td>
        <td>${decided(q, "استُعرض التقرير وصودق عليه.", ap1(1))}</td></tr>
    <tr><td>2</td><td>المصادقة على الحساب الختامي والموقف المالي</td>
        <td>${decided(q, "صودق على الموقف المالي الموضّح أعلاه.", ap1(2))}</td></tr>
    <tr><td>3</td><td>اعتماد الموازنة التقديرية لعام ${nextYear}</td>
        <td>${decided(q, d.annual_budget ? `اعتماد موازنة بإجمالي <b>${sar(d.annual_budget)}</b> ريال سنويًّا (الموازنة التقديرية المعروضة).` : "اعتماد الموازنة التقديرية المعروضة.", ap1(3))}</td></tr>
    <tr><td>4</td><td>اشتراك الصيانة لعام ${nextYear}</td>
        <td>${decided(q, (d.fee_basis || a.fee_basis) === "share"
          ? `توزيع رسوم الاشتراك على الوحدات حسب حصة كل وحدة من الموازنة المعتمدة، وتُستحق ${perWord(ap)}.`
          : fee ? `إقرار الاشتراك بمبلغ <b>${sar(fee)}</b> ريال لكل وحدة ${perWord(ap)}${isAnnual(ap) ? "" : ` (${sar(Math.round(fee * 12 * 100) / 100)} ريال في السنة)`}.` : "________________________________", ap1(4))}</td></tr>
    <tr><td>5</td><td>مدير العقار</td>
        <td>${decided(q, d.manager ? `تجديد تعيين <b>${esc(d.manager)}</b> مديرًا للعقار.` : "________________________________", ap1(5))}</td></tr>
    <tr><td>6</td><td>إدخال قرار رسوم الاشتراك في المنصة</td>
        <td>${decided(q, `تفويض ${d.president ? `رئيس الجمعية <b>${esc(d.president)}</b>` : "رئيس الجمعية"} ومدير العقار بإنشاء قرار
            «إعادة تحديد رسوم الاشتراك» في منصة «ملاك» ببنود موازنة عام ${nextYear} وطرحه لتصويت الأعضاء،
            ثم إصدار الفواتير وفق موعد الاستحقاق المعتمد.`, ap1(6))}</td></tr>
    ${d.notes ? `<tr><td>7</td><td>بنود إضافية</td><td>${decided(q, esc(d.notes), ap1(7))}</td></tr>` : ""}
  </tbody>
</table>

<div class="note">
  تُودَع الاشتراكات في الحساب البنكي للجمعية، ولا يُصرف منها إلا وفق الموازنة المعتمدة.
  وعُرضت في الاجتماع: الموازنة التقديرية لعام ${nextYear}.
</div>

<h1 style="font-size:1rem">${d.attendance && d.attendance.length ? "الحضور والتوقيعات" : "توقيعات الحاضرين"}</h1>
${attendanceTable(a, d.attendance, escH)}

<div class="sign">
  <div>رئيس الجمعية: ${d.president ? esc(d.president) : "________________"}<br><br>التوقيع: ________________</div>
  <div>مدير العقار: ${d.manager ? esc(d.manager) : "________________"}<br><br>التوقيع: ________________</div>
</div>
<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>تنويه:</b> هذا نموذج محضر استرشادي أعدّته إدارة الجمعية للاستخدام الإداري.
  وثيق لا يقدّم خدمات قانونية ولا يمثّل الجمعية أمام أي جهة — طابق النموذج مع النظام الأساسي
  المعتمد ومتطلبات منصة «ملاك» قبل رفعه رسميًّا.
</div>
${footer(issuer)}`;
  return SHELL(`محضر الاجتماع السنوي — ${a.name}`, body, markOf(issuer));
}

// ============================================================
// فاتورة اشتراك وثيق — من وثيق إلى المشترك (تُصدر من لوحة الإدارة فقط)
// ============================================================

export type SubInvoice = {
  invoice_no: string;
  /** اسم المشترك ومنشأته */
  to_name: string;
  to_org?: string | null;
  to_phone?: string | null;
  /** الباقة كما تُعرض للمشترك، مثل: باقة المالك · الاحترافية */
  plan_label: string;
  months: number;
  amount: number;
  /** بداية ونهاية الفترة المشمولة (YYYY-MM-DD) */
  from_date: string;
  to_date: string;
  method?: string | null;
  paid_at?: string | null;
  /** الرقم الضريبي لوثيق — إن وُجد تُحتسب الضريبة، وإن غاب تُطبع فاتورة بلا ضريبة */
  vat_number?: string | null;
  vat_rate?: number | null;
  /** تاريخ الإصدار المحفوظ (YYYY-MM-DD) — عند إعادة الطباعة لا يصير تاريخ اليوم */
  issue_date?: string | null;
  /** توقيع المُصدِر صورةً (data:image/png|jpeg;base64,…) — يُطبع بدل خط التوقيع الفارغ */
  signature?: string | null;
};

/** صورة توقيع مقبولة فقط: data URL لـ PNG/JPEG بلا أي محتوى آخر */
export const isSignatureDataUrl = (v?: string | null): v is string =>
  !!v && v.length <= 400000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v);

/**
 * فاتورة/إيصال اشتراك تُسلَّم للمشترك.
 * لا علامة مائية ولا سطر «أُنشئ عبر وثيق» — المُصدِر هنا وثيق نفسه.
 */
export function subscriptionInvoiceHTML(inv: SubInvoice) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  inv = scrub(inv);
  const rate = Number(inv.vat_rate ?? 15);
  const hasVat = !!inv.vat_number;
  const total = Number(inv.amount) || 0;
  const base = hasVat ? Math.round((total / (1 + rate / 100)) * 100) / 100 : total;
  const vat = Math.round((total - base) * 100) / 100;
  const paid = inv.paid_at || today();
  /* (30 سبتمبر 2026) تاريخ الإصدار المحفوظ أو تاريخ السداد — كان «اليوم» دائمًا،
     فإعادة طباعة فاتورة يناير في مارس تحمل تاريخ مارس. */
  const issued = String(inv.issue_date || inv.paid_at || today()).slice(0, 10);
  const body = `
${header(hasVat ? "فاتورة ضريبية مبسطة" : "فاتورة اشتراك", inv.invoice_no, null, issued)}
<h1>${hasVat ? "فاتورة ضريبية مبسطة — اشتراك وثيق" : "فاتورة اشتراك وثيق"}</h1>
<div class="sub">الفترة: ${arDate(inv.from_date)} حتى ${arDate(inv.to_date)} · ${monthsAr(inv.months)}</div>

<div class="grid">
  <div class="box">
    <h3>المُصدِر</h3>
    <div class="r"><span>الاسم</span><span>وثيق — منصة إدارة الأملاك</span></div>
    <div class="r"><span>وثيقة العمل الحر</span><span>FL-763162251</span></div>
    ${inv.vat_number ? `<div class="r"><span>الرقم الضريبي</span><span>${inv.vat_number}</span></div>` : ""}
    <div class="r"><span>للتواصل</span><span>watheqdocs@gmail.com</span></div>
  </div>
  <div class="box">
    <h3>إلى</h3>
    <div class="r"><span>الاسم</span><span>${inv.to_name || "—"}</span></div>
    ${inv.to_org ? `<div class="r"><span>المنشأة</span><span>${inv.to_org}</span></div>` : ""}
    ${inv.to_phone ? `<div class="r"><span>الجوال</span><span>${inv.to_phone}</span></div>` : ""}
    <div class="r"><span>الباقة</span><span>${inv.plan_label}</span></div>
  </div>
</div>

<table>
  <thead><tr><th>البيان</th><th>الفترة</th><th>المدة</th><th>المبلغ${hasVat ? " قبل الضريبة" : ""} (ريال)</th></tr></thead>
  <tbody>
    <tr>
      <td>اشتراك منصة وثيق — ${inv.plan_label}</td>
      <td>${arDate(inv.from_date)} ← ${arDate(inv.to_date)}</td>
      <td>${monthsAr(inv.months)}</td>
      <td>${sar(base)}</td>
    </tr>
  </tbody>
</table>

${hasVat ? `<table style="max-width:340px;margin-inline-start:auto">
  <tbody>
    <tr><td>الإجمالي قبل الضريبة</td><td style="text-align:left;font-weight:600">${sar(base)}</td></tr>
    <tr><td>ضريبة القيمة المضافة (${rate}%)</td><td style="text-align:left;font-weight:600">${sar(vat)}</td></tr>
    <tr><td style="font-weight:700">الإجمالي شامل الضريبة</td><td style="text-align:left;font-weight:700">${sar(total)}</td></tr>
  </tbody>
</table>` : ""}

<div class="due"><span class="l">الإجمالي المدفوع${hasVat ? " (شامل الضريبة)" : ""}</span><span class="v">${sar(total)} ريال</span></div>

${hasVat ? zatcaQrBlock("وثيق", String(inv.vat_number), total, vat, inv.paid_at || issued) : ""}

<div class="note">
  ${methodAr(inv.method) !== "—" ? `وسيلة السداد: <b>${methodAr(inv.method)}</b> · ` : ""}تاريخ السداد: <b>${arDate(paid)}</b>.
  يسري الاشتراك حتى <b>${arDate(inv.to_date)}</b>، وتبقى بيانات الحساب ومستنداته متاحة للمشترك طوال الفترة.
</div>

${hasVat ? `<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  ${/* (30 سبتمبر 2026) الاسم الرسمي «هيئة الزكاة والضريبة والجمارك» منذ 2021؛ وكان
       التنويه ينفي وجود رمز QR مطبوع في الصفحة نفسها. */ ""}
  <b>تنويه:</b> فاتورة ضريبية مبسطة وفق متطلبات مرحلة الإصدار، برمز الاستجابة السريعة أعلاه؛
  ولا تشمل الربط والتكامل مع منصة «فاتورة» لدى هيئة الزكاة والضريبة والجمارك.
</div>` : `<div class="note">
  <b>لا تشمل هذه الفاتورة ضريبة القيمة المضافة</b> — المُصدِر غير مسجَّل في ضريبة القيمة المضافة،
  وهي مستند إداري لإثبات السداد وليست فاتورة إلكترونية معتمدة من هيئة الزكاة والضريبة والجمارك.
</div>`}

<div class="sign">
  <div>المُصدِر: وثيق<br>${isSignatureDataUrl(inv.signature)
    ? `<div style="margin-top:6px">التوقيع:</div><img src="${inv.signature}" alt="التوقيع" style="display:block;max-height:70px;max-width:220px;margin-top:4px">`
    : `<br>التوقيع: ________________`}</div>
  <div>تاريخ الإصدار: ${arDate(issued)}<br><br>رقم الفاتورة: ${inv.invoice_no}</div>
</div>
${footer()}`;
  return SHELL(`فاتورة ${inv.invoice_no} — ${inv.to_name}`, body, "none");
}

// ============================================================
// تقرير المالك الدوري — أهم مستند يقدّمه مكتب إدارة الأملاك لمالكه:
// إشغال + محصَّل الفترة فعليًّا (من سجل الدفعات) + المتأخرات الحالية.
// يختلف عن «كشف حساب العقار»: ذاك لقطة لحظية، وهذا حصاد فترة.
// ============================================================

export type OwnerReportPayment = PaymentRow & { tenant_name?: string | null; unit?: string | null };

export function ownerReportHTML(
  p: Property & { tenants: (Tenant & { status?: string | null; move_out_date?: string | null })[] },
  period: { label: string; from: string; to: string },
  payments: OwnerReportPayment[] = [],
  issuer: Issuer = {},
  // المصروفات وأتعاب الإدارة اختيارية — بدونها يبقى التقرير كما كان (توافق خلفي)
  extra: { expenses?: ExpenseRow[]; fee_pct?: number | null;
    /** أقساط الإيجار المسجَّلة لكل ساكن في مدته الحالية — كل الأوقات لا الفترة.
     *  منها تُحسب ملاحظة «دفعات سُدّدت قبل بدء التسجيل». بدونها لا ملاحظة. */
    termRentPaid?: Record<string, number>;
    /** إعدادات الضريبة للمستأجرين السابقين (pastVatOf) — لضريبة دفعاتهم */
    pastVat?: PastVat } = {},
  /** شامل: مواصفات كل وحدة وعقدها وتفصيل كل دفعة ومصروف · مختصر: الأرقام والجدول */
  mode: "full" | "brief" = "full",
) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  p = scrub(p);
  period = scrub(period);
  payments = scrub(payments);
  issuer = scrub(issuer);
  extra = scrub(extra);
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || issuer.org_name || p.manager || "إدارة الأملاك";
  const g = winOf(p, issuer);

  const rows = (p.tenants || []).map((t) => ({ t, st: contractState(t, g), vacant: isVacant(t) }));
  const total = rows.length;
  const vacant = rows.filter((r) => r.vacant).length;
  const occupied = total - vacant;
  const occupancy = total ? Math.round((occupied / total) * 100) : 0;
  const late = rows.filter((r) => !r.vacant && r.st.status === "late").length;
  const totalDue = rows.reduce((s, r) => s + (r.vacant ? 0 : dueIncl(r.st, vatOf(p, r.t))), 0);
  /* التقرير يعرض الإجمالي (حق المالك أن يراه كاملًا)، لكن اللوحة تعرض
     «المتأخر» بلا وحدات التنفيذ. بلا هذا التفصيل يرى المكتب رقمين
     مختلفين ولا يعرف أيهما الصحيح — فنُظهر الشقّين ومجموعهما. */
  const arr = arrearsOf(rows.map((r) => ({ ...r, p })) as any[]);
  const collected = payments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  /* المالك يرى ما استُلم فعلًا: العكس يُسقَط مع دفعته، والملاحظات الداخلية تُحذف */
  const shownPays = ownerVisiblePayments(payments as any[]);
  /* (30 سبتمبر 2026) مصروفات المكتب الداخلية (billable:false) لا تُعرض للمالك:
     كانت تظهر في جداول التقرير فيجمعها المالك (1,300) بينما «الحساب الختامي»
     يخصم القابل للخصم وحده (800) — ثلاثة مجاميع لمصروفات فترة واحدة. */
  const exp = (extra.expenses || []).filter(isBillable);
  /* الضريبة داخل المقبوض تُستبعد: أمانة للهيئة لا إيراد للمالك.
     ونحسبها لكل دفعة بحسب وحدتها (العمارة المختلطة). */
  const vt = vatOfPayments(p, payments as any[], extra.pastVat);
  const vatCollected = vt.inside + vt.onTop;
  // أتعاب إدارة الأملاك خدمة خاضعة للضريبة إن كان المكتب مسجَّلًا ضريبيًّا
  const feeVatRate = issuer.vat_number ? (Number(p.vat_rate) || 15) : 0;
  /* المالك يجمع عمود «المتأخر» فيخرج رقمًا يخالف بطاقة «المتأخرات القائمة»:
     البطاقة تستبعد الشاغرة والجدول يعرضها. صف الإجمالي يفصلهما صراحةً. */
  const stRows = (p.tenants || []).map((t: any) => ({ t, cs: contractState(t, winOf(p, issuer)) }));
  const activeOwed = stRows.reduce((a, r) => a + (r.cs.vacant ? 0 : dueIncl(r.cs, vatOf(p, r.t))), 0);
  const legacyOwed = stRows.reduce((a, r) => a + (r.cs.vacant ? dueIncl({ amountDue: r.cs.legacyArrears }, vatOf(p, r.t)) : 0), 0);
  const activeLate = stRows.filter((r) => !r.cs.vacant && r.cs.amountDue > 0).length;
  const vacantOwing = stRows.filter((r) => r.cs.vacant && r.cs.legacyArrears > 0).length;
  /* «غير شاملة»: المقبوض فعلًا = المسجَّل + الضريبة التي دُفعت فوقه */
  const fin = ownerNet(collected + vt.onTop, exp, extra.fee_pct, vatCollected, feeVatRate);
  /* «صافي المالك» صافي دخل العقار: يخصم كل مصروفاته — ومنها ما دفعه المالك
     بنفسه. فمن حوّل له «الصافي» خصم ذلك مرتين. (دراسة 685 احتمالًا: 53
     تقريرًا.) السطر الإضافي يقول المحوَّل صراحةً، ويظهر حين يلزم فقط. */
  const ownerPaid = Math.round(exp.filter((e: any) => isBillable(e) && e.paid_by === "owner")
    .reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0) * 100) / 100;
  /* ومع الضريبة: بدونه يرى المالك «المحصَّل» شاملًا ضريبة الهيئة بلا سطر
     يطرحها — في عقار تجاري بلا أتعاب وشهر بلا مصروفات. */
  const showFinance = exp.length > 0 || fin.feePct !== null || (fin.vatCollected || 0) > 0;
  /**
   * الرصيد الافتتاحي.
   *
   * من دخل وثيق ومعه دفعات سابقة يُدخلها عدّادًا («دفعات سُدّدت حتى اليوم»)
   * لا دفعات — فتضبط حالة الوحدة ولا تظهر في المحصَّل. والمالك يرى وحدة
   * سدّدت أربعة أشهر ومحصَّلًا يعادل شهرًا، فيظن أن الباقي ضاع.
   * دراسة عشرة مكاتب أظهرت مكتبًا واحدًا بـ1,217,500 ريال كهذه.
   * نقدّر ما سُدّد قبل التسجيل ونذكره صراحةً — لا نُدخله في الأرقام.
   */
  /**
   * ملاحظة «دفعات سُدّدت قبل بدء التسجيل».
   *
   * كانت تقارن ما سدّده الساكن في مدته بكل دفعات الوحدة **في فترة التقرير**:
   * فتقرير شهر واحد يقول للمالك إن مئات الآلاف «سُدّدت قبل التسجيل» (كل ما
   * دُفع في الأشهر الأخرى)، وتقرير كامل المدة يُنقصها بدفعات المستأجرين
   * السابقين وسداد الديون. دراسة 685 احتمالًا: خاطئة في 260 تقريرًا من 260.
   *
   * الصحيح: رصيد الساكن في مدته − أقساط الإيجار المسجَّلة له في المدة نفسها
   * (كل الأوقات). وبلا هذه البيانات لا ملاحظة — الصمت خير من رقم خاطئ.
   */
  let openingUnits = 0, openingAmount = 0;
  if (extra.termRentPaid) {
    for (const t of (p.tenants || []) as any[]) {
      const rent = Number(t.rent_amount) || 0;
      if (rent <= 0 || isVacant(t)) continue;
      const counted = (Number(t.paid_periods) || 0) * rent + (Number(t.partial_amount) || 0);
      const gap = Math.round((counted - (extra.termRentPaid[t.id] || 0)) * 100) / 100;
      if (gap > 0.5) { openingUnits++; openingAmount += gap; }
    }
  }
  const expiring = rows.filter((r) => !r.vacant && r.st.daysToEnd !== null && r.st.daysToEnd >= 0 && r.st.daysToEnd <= 60).length;

  const body = `
${header("تقرير دوري للمالك", p.name, issuer)}
<h1>تقرير المالك — ${p.name}</h1>
<div class="sub">${typeLabel(p.property_type)}${p.address ? ` — ${p.address}` : ""}${p.city ? `، ${p.city}` : ""} · الفترة: <b>${period.label}</b> (${arDate(period.from)} إلى ${arDate(period.to)})</div>

<div class="tot">
  <div><div class="v">${total}</div><div class="l">إجمالي الوحدات</div></div>
  <div><div class="v">${occupancy}%</div><div class="l">الإشغال (${vacant} شاغرة)</div></div>
  <div><div class="v g">${sar(collected)}</div><div class="l">المُحصَّل خلال الفترة (ريال)</div></div>
  <div><div class="v${totalDue ? " r" : ""}">${sar(totalDue)}</div><div class="l">المتأخرات القائمة (ريال)</div></div>
</div>

${totalDue > 0 || expiring > 0 ? `<div class="note">${[
    late ? `متأخرات على ${countAr(late, "وحدة", true)} بإجمالي ${sar(totalDue)} ريال` : "",
    arr.litigation > 0 ? `منها <b>${sar(arr.litigation)}</b> ريال على ${countAr(arr.litigationCount, "وحدة", true)} تحت التنفيذ القضائي، و<b>${sar(arr.current)}</b> ريال قيد المطالبة` : "",
    expiring ? `${expiring === 1 ? "عقد واحد ينتهي" : expiring === 2 ? "عقدان ينتهيان" : `${countAr(expiring, "عقد")} تنتهي`} خلال 60 يومًا — قرار التجديد مطلوب` : "",
  ].filter(Boolean).join(" · ")}</div>` : ""}

${mode === "full" ? `
<h2>بيانات العقار</h2>
<div class="grid">
  <div class="box">
    <div class="r"><span>النوع</span><span>${typeLabel(p.property_type)}</span></div>
    ${p.usage ? `<div class="r"><span>الاستخدام</span><span>${USAGE_AR[String(p.usage)] || p.usage}</span></div>` : ""}
    ${p.address ? `<div class="r"><span>العنوان</span><span>${p.address}</span></div>` : ""}
    ${p.city ? `<div class="r"><span>المدينة</span><span>${p.city}</span></div>` : ""}
  </div>
  <div class="box">
    <div class="r"><span>عدد الوحدات</span><span>${p.tenants.length}</span></div>
    ${/* (30 سبتمبر 2026) المربّع أعلاه «المُحصَّل خلال الفترة» = إجمالي المقبوض (14,500)،
         وهذا بعد استبعاد الضريبة (13,000) — رقمان مختلفان تحت اسم واحد. */ ""}
    <div class="r"><span>${(fin.vatCollected || 0) > 0 ? "صافي الإيجار بعد الضريبة" : "المحصَّل خلال الفترة"}</span><span><b style="color:#137a50">${sar(fin.collected)}</b> ريال</span></div>
    <div class="r"><span>المتأخرات القائمة</span><span><b style="color:${totalDue > 0 ? "#a5322c" : "#137a50"}">${sar(totalDue)}</b> ريال</span></div>
    ${arr.litigation > 0 ? `<div class="r"><span style="padding-inline-start:12px">— قيد المطالبة</span><span>${sar(arr.current)} ريال</span></div>
    <div class="r"><span style="padding-inline-start:12px">— تحت التنفيذ القضائي</span><span>${sar(arr.litigation)} ريال</span></div>` : ""}
    ${arr.carried > 0 ? `<div class="r"><span>دين مُرحَّل من مدة سابقة</span><span><b style="color:#9A4B00">${sar(arr.carried)}</b> ريال</span></div>` : ""}
    ${arr.legacy > 0 ? `<div class="r"><span>على مستأجرين سابقين (وحدات شاغرة)</span><span><b style="color:#9A4B00">${sar(arr.legacy)}</b> ريال</span></div>` : ""}
    ${arr.grand !== arr.total ? `<div class="r"><span><b>إجمالي المستحق على العقار</b></span><span><b style="color:${arr.grand > 0 ? "#a5322c" : "#137a50"}">${sar(arr.grand)}</b> ريال</span></div>` : ""}
    ${extra.fee_pct ? `<div class="r"><span>أتعاب الإدارة</span><span>${extra.fee_pct}%</span></div>` : ""}
    ${Number(p.grace_days) > 0 ? `<div class="r"><span>فترة السماح</span><span>${daysAr(Number(p.grace_days))}</span></div>` : ""}
  </div>
</div>
${propertyMetersHTML(p, (t) => `<h2>${t}</h2>`)}` : ""}

${(fin.feeExceedsCollected || (fin.feePct !== null && fin.feePct >= 30)) ? `
<div class="note" style="border-inline-start-color:#a5322c;background:#FBE9E7;color:#a5322c">
  <b>راجع نسبة أتعاب الإدارة (${fin.feePct}%):</b>
  ${fin.feeExceedsCollected
    ? `الأتعاب وضريبتها (${sar(fin.fee)} ريال) تتجاوز المُحصَّل خلال الفترة (${sar(fin.collected)} ريال)، فيظهر الصافي سالبًا.`
    : `الأتعاب (${sar(fin.fee)} ريال) تلتهم أغلب المُحصَّل (${sar(fin.collected)} ريال).`}
  وأتعاب الإدارة في السوق 2.5–15% عادةً، فالأرجح أن النسبة أُدخلت خطأً —
  صحّحها من إعدادات العقار وأعد إصدار التقرير.
</div>` : ""}

<h2>الوحدات — وصفها وإيجارها وحالتها في نهاية الفترة</h2>
${unitsRegisterHTML(p, p.tenants || [], g, issuer)}
<div class="box" style="margin-top:8px">
  <div class="r"><span><b>إجمالي المتأخر</b> <span style="font-size:.72rem;color:#5C6B67">(${activeLate ? `متأخرات على ${countAr(activeLate, "وحدة", true)}` : "لا وحدات متأخرة"}${vacantOwing ? ` · شاغرة عليها دين سابق: ${vacantOwing}` : ""})</span></span>
    <span><b>${sar(activeOwed)}</b>${legacyOwed > 0 ? ` <span style="font-size:.72rem;color:#5C6B67">+ ${sar(legacyOwed)} على مستأجرين سابقين</span>` : ""}</span></div>
</div>

<h2>الدفعات المستلمة خلال الفترة (${shownPays.length})</h2>
${shownPays.length ? `<div class="scrollx"><table>
  <thead><tr><th>التاريخ</th><th>المستأجر</th><th>${ul}</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${shownPays.map((x) => `<tr>
      <td>${arDate(x.paid_on)}</td>
      <td>${x.tenant_name || "—"}</td>
      <td>${x.unit || "—"}</td>
      <td><b>${sar(x.amount)}</b></td>
      <td>${payMethod(x)}</td>
      <td>${x.note ? escH(x.note) : "—"}</td>
    </tr>`).join("")}
    <tr><td colspan="3"><b>الإجمالي</b></td><td><b>${sar(collected)}</b></td><td colspan="2">—</td></tr>
  </tbody>
</table></div>` : `<div class="sub">لم تُسجَّل دفعات خلال هذه الفترة.</div>`}

${showFinance ? `
<h2>مصروفات الفترة (${exp.length})</h2>
${exp.length ? `<div class="scrollx"><table>
  <thead><tr><th>التاريخ</th><th>التصنيف</th><th>${ul}</th><th>المبلغ</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${exp.map((x) => `<tr>
      <td>${arDate(x.spent_on)}</td>
      <td>${catLabel(x.category)}</td>
      <td>${x.unit || "—"}</td>
      <td><b>${sar(Number(x.amount) || 0)}</b></td>
      <td>${x.note ? escH(x.note) : "—"}</td>
    </tr>`).join("")}
    <tr><td colspan="3"><b>إجمالي المصروفات</b></td><td><b>${sar(fin.expenses)}</b></td><td>${sumByCategory(exp).map((c) => `${c.label} ${sar(c.total)}`).join(" · ") || "—"}</td></tr>
  </tbody>
</table></div>` : `<div class="sub">لا مصروفات مسجّلة خلال هذه الفترة.</div>`}

<h2>الحساب الختامي للمالك</h2>
<table>
  <tbody>
    ${(fin.vatCollected || 0) > 0 ? `<tr><td>إجمالي المقبوض خلال الفترة${vt.onTop > 0 ? ` <span style="font-size:.72rem;color:#5C6B67">(يشمل ${sar(vt.onTop)} ضريبة دُفعت فوق الإيجار)</span>` : ""}</td><td style="text-align:left">${sar(fin.grossCollected || 0)}</td></tr>
    <tr><td>(−) ضريبة القيمة المضافة المحصَّلة <span style="font-size:.72rem;color:#5C6B67">(تُورَّد للهيئة — ليست إيرادًا للمالك)</span></td><td style="text-align:left">${sar(fin.vatCollected || 0)}</td></tr>` : ""}
    <tr><td>${(fin.vatCollected || 0) > 0 ? "صافي إيراد المالك من الإيجار" : "المحصَّل خلال الفترة"}</td><td style="text-align:left"><b>${sar(fin.collected)}</b></td></tr>
    <tr><td>(−) مصروفات الفترة</td><td style="text-align:left">${sar(fin.expenses)}</td></tr>
    ${fin.feePct !== null ? `<tr><td>(−) أتعاب الإدارة (${fin.feePct}% من صافي الإيجار)</td><td style="text-align:left">${sar(fin.feeBase ?? fin.fee)}</td></tr>${(fin.feeVat || 0) > 0 ? `<tr><td>(−) ضريبة على أتعاب الإدارة (${feeVatRate}%)</td><td style="text-align:left">${sar(fin.feeVat || 0)}</td></tr>` : ""}` : ""}
    <tr><td><b>صافي المالك عن ${period.label}</b></td><td style="text-align:left"><b style="font-size:1.1rem">${sar(fin.net)} ريال</b></td></tr>
    ${ownerPaid > 0.005 ? `<tr><td>(+) مصروفات دفعها المالك بنفسه <span style="font-size:.72rem;color:#5C6B67">(خُصمت أعلاه لأنها من مصروفات العقار، ولم تمرّ بالمكتب)</span></td><td style="text-align:left">${sar(ownerPaid)}</td></tr>
    <tr style="background:#F3EEE2"><td><b>المستحق تحويله للمالك</b></td><td style="text-align:left"><b style="font-size:1.1rem">${sar(Math.round((fin.net + ownerPaid) * 100) / 100)} ريال</b></td></tr>` : ""}
  </tbody>
</table>
` : ""}
${mode === "full" && exp.length ? `
<h1 style="font-size:1rem">تفصيل مصروفات الفترة</h1>
<div class="scrollx"><table>
  <thead><tr><th>التاريخ</th><th>${unitLabel(p.property_type)}</th><th>التصنيف</th><th>المبلغ</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${exp.slice().sort((a, b) => String(a.spent_on).localeCompare(String(b.spent_on)))
      .map((e) => `<tr><td>${arDate(e.spent_on)}</td><td>${(e as any).unit || "—"}</td><td>${catLabel(e.category)}</td><td>${sar(e.amount)}</td><td>${(e as any).note ? escH((e as any).note) : "—"}</td></tr>`).join("")}
    <tr><td colspan="3"><b>الإجمالي</b></td><td colspan="2"><b>${sar(exp.reduce((a, e) => a + (Number(e.amount) || 0), 0))}</b></td></tr>
  </tbody>
</table></div>` : ""}

${openingUnits > 0 ? `<div class="note" style="border-inline-start-color:#B8791F;background:#FDF6E3">
  <b>عن المحصَّل:</b> يشمل الدفعات المسجَّلة في وثيق بتاريخ استلامها فقط.
  ${countAr(openingUnits, "وحدة")} فيها دفعات سُدّدت قبل بدء التسجيل
  (نحو ${sar(Math.round(openingAmount))} ريال) — حالتها محسوبة صحيحًا في الجدول، لكنها لا تظهر ضمن المحصَّل أعلاه.
</div>` : ""}
<div class="note">تقرير استرشادي صادر آليًّا من سجل الدفعات والمصروفات وبيانات العقود المسجّلة في وثيق بتاريخ ${arDate(today())}. الأرقام تعكس ما وثّقه المكتب في النظام.</div>
<div class="sign"><div>إدارة الأملاك: ${who}<br><br>التوقيع: ________________</div><div>المالك: ____________________<br><br>تاريخ الإصدار: ${arDate(today())}</div></div>
${footer(issuer)}`;
  return SHELL(`تقرير المالك — ${p.name} — ${period.label}`, body, markOf(issuer));
}

// ============================================================
// كشف المالك المجمّع — كل عقارات المالك في كشف واحد لفترة يحددها
// المكتب (من شهر إلى شهر). طُلب من أول مكتب فعلي (160 وحدة، ملّاك
// متعددو العقارات) في سبتمبر 2026.
//
// التصميم: ملخص أعلى الكشف (كل عقار في صف: محصَّل − مصروفات − أتعاب
// = صافي، ثم الإجمالي) لأن المالك يسأل «كم لي؟» أولًا؛ ثم تفصيل كل
// عقار (دفعات ومصروفات) لمن يريد التحقق. الحسابات نفسها التي يستخدمها
// تقرير العقار الواحد (ownerNet) حتى لا يختلف رقم هنا عن رقم هناك.
// ============================================================

export type OwnerStatementSection = {
  property: Property & { tenants: (Tenant & { status?: string | null; move_out_date?: string | null })[] };
  payments: OwnerReportPayment[];
  expenses: ExpenseRow[];
  fee_pct?: number | null;
  pastVat?: PastVat;
};

export function ownerConsolidatedStatementHTML(
  ownerName: string,
  sections: OwnerStatementSection[],
  period: { label: string; from: string; to: string },
  issuer: Issuer = {},
  /** full: كل شيء · brief: بلا سجل الوحدات · arrears: المتأخر والمستحق فقط */
  detail: "full" | "brief" | "arrears" = "full",
) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  ownerName = scrub(ownerName);
  sections = scrub(sections);
  period = scrub(period);
  issuer = scrub(issuer);
  /* (30 سبتمبر 2026) كبقية المستندات: اسم الفوترة ثم اسم المنشأة — كان مكتب بلا
     اسم فوترة يوقّع كشف مالكه «إدارة الأملاك» والترويسة تحمل اسمه. */
  const who = issuer.billing_name || issuer.org_name || "إدارة الأملاك";
  /* مصروفات المكتب الداخلية (billable:false) لا تظهر للمالك في أي جدول — وإلا جمعها
     المالك فخرج بمجموع يخالف «المصروفات» المخصومة من صافيه. */
  sections = sections.map((s) => ({ ...s, expenses: (s.expenses || []).filter(isBillable) }));

  const rows = sections.map((s) => {
    const g = winOf(s.property, issuer);
    const ten = (s.property.tenants || []).map((t) => ({ t, st: contractState(t, g), vacant: isVacant(t) }));
    const units = ten.length;
    const vacant = ten.filter((r) => r.vacant).length;
    const due = ten.reduce((a, r) => a + (r.vacant ? 0 : dueIncl(r.st, vatOf(s.property, r.t))), 0);
    const collected = s.payments.reduce((a, x) => a + (Number(x.amount) || 0), 0);
    /* الضريبة المحصَّلة تُستبعد قبل الأتعاب والصافي (أمانة للهيئة) */
    const vt = vatOfPayments(s.property, s.payments as any[], s.pastVat);
    const vatCollected = vt.inside + vt.onTop;
    const feeVatRate = issuer.vat_number ? (Number(s.property.vat_rate) || 15) : 0;
    const fin = ownerNet(collected + vt.onTop, s.expenses, s.fee_pct, vatCollected, feeVatRate);
    /* الدين المرحَّل (كل الوحدات) ودين المستأجرين السابقين — لسطر المتأخرات */
    const carried = ten.reduce((a, r) => a + (Number(r.st.carriedDebt) || 0), 0);
    const legacy = ten.reduce((a, r) => a + (r.vacant ? dueIncl({ amountDue: r.st.legacyArrears }, vatOf(s.property, r.t)) : 0), 0);
    return { s, units, vacant, due, collected, fin, ten, vt, carried, legacy };
  });

  /* المالك يقارن «المحصَّل» بشيء: بلا مرجع للفترة يبدو التحصيل كارثيًّا
     (122,900 مقابل دخل سنوي 3.4 مليون). المتوقع للفترة يعطيه المرجع. */
  const periodDays = Math.max(1, Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86400000) + 1);
  /* ما دفعه المالك بنفسه من مصروفات العقارات — يُضاف للصافي عند التحويل */
  const ownerPaidAll = Math.round(rows.reduce((a, r) => a + (r.s.expenses || [])
    .filter((e: any) => isBillable(e) && e.paid_by === "owner")
    .reduce((b: number, e: any) => b + (Number(e.amount) || 0), 0), 0) * 100) / 100;
  const T = rows.reduce((a, r) => ({
    units: a.units + r.units, vacant: a.vacant + r.vacant, due: a.due + r.due,
    collected: a.collected + r.fin.collected, expenses: a.expenses + r.fin.expenses,
    fee: a.fee + r.fin.fee, net: a.net + r.fin.net,
    gross: a.gross + (r.fin.grossCollected ?? r.fin.collected), vat: a.vat + (r.fin.vatCollected ?? 0),
    carried: a.carried + r.carried, legacy: a.legacy + r.legacy,
  }), { units: 0, vacant: 0, due: 0, collected: 0, expenses: 0, fee: 0, net: 0, gross: 0, vat: 0, carried: 0, legacy: 0 });
  const anyFee = rows.some((r) => r.fin.feePct !== null);

  /* ═══════════ وضع «المتأخرات والمستحق فقط» ═══════════
     صاحب المكتب يرسل للمالك ورقة سؤالها واحد: مَن عليه مبلغ وكم؟ الكشف
     الشامل يُغرقها في سجل دفعات ومصروفات ووحدات منتظمة لا تحتاج قرارًا.
     هنا لا تظهر إلا وحدة عليها متأخر أو استحقاق قائم — والباقي سطر واحد. */
  if (detail === "arrears") {
    const propRows = rows.map((r) => {
      /* «المتأخر» و«المستحق» شيئان مختلفان: الأول مبلغ حلّ أجله ولم يُدفع
         (amountDue)، والثاني قسط قادم قرُب موعده ولم يحلّ بعد — وقيمته
         الإيجار لا amountDue (وهو صفر قبل الاستحقاق). خلطهما في رقم واحد
         يجعل المالك يظن أن عليه مبلغًا لم يتأخر أحد فيه. */
      /* (30 سبتمبر 2026) الدين المرحَّل ودين المستأجر السابق كانا خارج هذا الكشف كليًّا:
         وحدة عليها 4,000 مرحَّلة ولا متأخر حالي لا تظهر، والإجمالي ينقصها — والمالك
         يرى الرقم نفسه في تقرير العقار. الآن: المرحَّل يُضاف لمبلغ وحدته، والشاغرة
         المدينة صفٌّ باسم «على المستأجر السابق». */
      const owe = r.ten
        .filter((x) => x.vacant
          ? (Number(x.st.legacyArrears) || 0) + (Number(x.st.carriedDebt) || 0) > 0
          : (x.st.amountDue > 0 || x.st.status === "soon" || (Number(x.st.carriedDebt) || 0) > 0))
        .map((x) => {
          const v = vatOf(r.s.property, x.t);
          const carried = Number(x.st.carriedDebt) || 0;
          const legacy = x.vacant ? dueIncl({ amountDue: x.st.legacyArrears }, v) : 0;
          const lateAmt = x.vacant ? 0 : x.st.amountDue > 0 ? dueIncl(x.st, v) : 0;
          const soonAmt = !x.vacant && x.st.amountDue <= 0 && x.st.status === "soon" ? splitVat(Number(x.t.rent_amount) || 0, v).total : 0;
          return {
            ...x, key: unitStatus(x.t, x.st), carried, legacy, lateAmt, soonAmt,
            amount: Math.round((lateAmt + soonAmt + carried + legacy) * 100) / 100,
            /* «متأخر» = عليه مبلغ حلّ فعلًا: متأخر المدة أو مرحَّل أو دين سابق */
            isLate: lateAmt + carried + legacy > 0,
          };
        })
        .sort((a, b) => (a.st.daysToNextDue ?? 0) - (b.st.daysToNextDue ?? 0));
      const late = owe.filter((x) => x.isLate);
      const lit = owe.filter((x) => (x.t as any)?.litigation && !x.vacant);
      const soon = owe.filter((x) => !x.isLate);
      const total = owe.reduce((a, x) => a + x.amount, 0);
      /* المتأخر = ما حلّ فعلًا (بلا قسط قادم لوحدة عليها مرحَّل) */
      const lateTotal = owe.reduce((a, x) => a + x.lateAmt + x.carried + x.legacy, 0);
      const litTotal = lit.reduce((a, x) => a + x.lateAmt, 0);
      const carriedTotal = owe.reduce((a, x) => a + x.carried, 0);
      const legacyTotal = owe.reduce((a, x) => a + x.legacy, 0);
      return { r, owe, late, soon, lit, total, lateTotal, litTotal, carriedTotal, legacyTotal };
    });
    const G = propRows.reduce((a, x) => ({
      total: a.total + x.total, lateTotal: a.lateTotal + x.lateTotal,
      litTotal: a.litTotal + x.litTotal, litN: a.litN + x.lit.length,
      lateN: a.lateN + x.late.length, soonN: a.soonN + x.soon.length,
      carried: a.carried + x.carriedTotal, legacy: a.legacy + x.legacyTotal,
    }), { total: 0, lateTotal: 0, litTotal: 0, litN: 0, lateN: 0, soonN: 0, carried: 0, legacy: 0 });

    const unitRow = (x: any, p: any) => {
      const d = x.st.daysToNextDue;
      const when = x.vacant ? `<span style="color:#9A4B00">دين سابق</span>`
        : x.lateAmt > 0 && d != null && d < 0
        ? `<span style="color:#D0453F;font-weight:600">متأخر ${daysAr(d)}</span>`
        : x.st.upcomingDate ? ((x.st.daysToUpcoming ?? 0) <= 0 ? "يستحق اليوم" : `يستحق خلال ${daysAr(x.st.daysToUpcoming)}`) : "—";
      /* تاريخ ما حلّ للمتأخر، وتاريخ القسط القادم لغيره؛ والشاغرة بلا تاريخ */
      const dueOn: string | null = x.vacant ? null : x.lateAmt > 0 ? (x.st.nextDueDate || null) : (x.st.upcomingDate || null);
      const sub = (t: string) => `<div style="font-size:.72rem;color:#5C6B67">${t}</div>`;
      return `<tr>
        <td>${x.t.unit || "—"}</td>
        <td>${x.vacant ? `<span style="color:#5C6B67">— شاغرة —</span>${sub("على المستأجر السابق")}` : `${x.t.name || "—"}${x.t.phone ? `<div style="font-size:.72rem;color:#5C6B67" dir="ltr">${x.t.phone}</div>` : ""}`}</td>
        <td><b>${sar(x.amount)}</b>${x.lateAmt > 0 && x.st.hasPartial ? sub(`سدّد ${sar(x.st.partial)} جزئيًّا`) : ""}${x.soonAmt > 0 ? sub(`${x.carried > 0 ? `منه ${sar(x.soonAmt)} ` : ""}لم يحلّ بعد`) : ""}${x.carried > 0 && (x.lateAmt > 0 || x.soonAmt > 0 || x.legacy > 0) ? sub(`منه ${sar(x.carried)} دين مرحَّل`) : x.carried > 0 ? sub("دين مرحَّل من مدة سابقة") : ""}</td>
        <td>${dueOn ? `${arDate(dueOn)}<div style="font-size:.72rem;color:#5C6B67">${hijriShort(dueOn)}</div>` : "—"}</td>
        <td>${when}</td>
        <td>${x.vacant ? "شاغرة — دين سابق" : x.lateAmt <= 0 && x.soonAmt <= 0 ? "دين مرحَّل" : unitStatusLabel(x.key, x.st)}</td>
      </tr>`;
    };

    const body = `
${header("كشف المتأخرات والمستحق", ownerName, issuer)}
<h1>المتأخرات والمستحق — ${ownerName}</h1>
<div class="sub">${countAr(rows.length, "عقار")} · ${countAr(T.units, "وحدة")} · حتى ${arDate(today())}</div>

<div class="tot">
  ${/* كان class="v l" فيأخذ خطّ التسمية الرمادي الصغير — المتأخر أحمر ظاهر */ ""}
  <div><div class="v r" style="font-size:1.35rem">${sar(G.lateTotal)}</div><div class="l"><b>المتأخر (ريال)</b></div></div>
  <div><div class="v">${sar(Math.round((G.total - G.lateTotal) * 100) / 100)}</div><div class="l">أقساط قرُب موعدها (ريال)</div></div>
  <div><div class="v">${sar(G.total)}</div><div class="l">إجمالي المطلوب (ريال)</div></div>
  <div><div class="v">${G.lateN} / ${G.soonN}</div><div class="l">وحدة متأخرة / قرُب قسطها</div></div>
</div>

${G.carried + G.legacy > 0 ? `<div class="sub" style="margin-top:8px">المتأخر يشمل ${[G.carried > 0 ? `<b>${sar(G.carried)}</b> ريال دينًا مُرحَّلًا من مدد سابقة` : "", G.legacy > 0 ? `<b>${sar(G.legacy)}</b> ريال على مستأجرين سابقين (وحدات شاغرة)` : ""].filter(Boolean).join(" و")}.</div>` : ""}
${G.litTotal > 0 ? `<div class="sub" style="margin-top:8px">منها <b>${sar(G.litTotal)}</b> ريال على ${countAr(G.litN, "وحدة", true)} تحت التنفيذ القضائي، و<b>${sar(Math.round((G.lateTotal - G.litTotal) * 100) / 100)}</b> ريال قيد المطالبة.</div>` : ""}

${G.total === 0 ? `<div class="note" style="margin-top:14px">لا توجد متأخرات ولا مستحقات قائمة على وحدات هذه العقارات حتى تاريخه.</div>` : ""}

${propRows.filter((x) => x.owe.length).map((x) => `
<h2 style="margin-top:20px">${x.r.s.property.name}</h2>
<div class="sub" style="margin-bottom:6px">${typeLabel(x.r.s.property.property_type)}${x.r.s.property.city ? ` · ${x.r.s.property.city}` : ""} · ${countAr(x.r.units, "وحدة")} (${x.r.units - x.r.vacant} مؤجّرة، ${x.r.vacant} شاغرة) · المطلوب <b>${sar(x.total)}</b> ريال</div>
<div class="scrollx"><table>
  <thead><tr><th>${unitLabel(x.r.s.property.property_type)}</th><th>المستأجر</th><th>المبلغ</th><th>تاريخ الاستحقاق</th><th>المدة</th><th>الحالة</th></tr></thead>
  <tbody>
    ${x.late.map((u: any) => unitRow(u, x.r.s.property)).join("")}
    ${x.soon.map((u: any) => unitRow(u, x.r.s.property)).join("")}
    <tr><td colspan="2"><b>إجمالي العقار</b></td><td colspan="4"><b>${sar(x.total)}</b> ريال${x.lateTotal ? ` (منها ${sar(x.lateTotal)} متأخر)` : ""}</td></tr>
  </tbody>
</table></div>
`).join("")}

${propRows.filter((x) => !x.owe.length).length ? `
<h2 style="margin-top:20px">عقارات بلا متأخرات</h2>
<div class="sub">${propRows.filter((x) => !x.owe.length).map((x) => `${x.r.s.property.name} (${countAr(x.r.units, "وحدة")})`).join(" · ")}</div>` : ""}

<div class="note">كشف استرشادي بالمتأخرات والمستحقات القائمة حتى ${arDate(today())}، مُستخرج من عقود الوحدات ودفعاتها المسجّلة في وثيق، شاملًا الديون المرحَّلة من مدد سابقة. لا يشمل المحصَّل ولا المصروفات ولا صافي المالك — لتلك اطلب الكشف الشامل. الوحدات الشاغرة لا تُدرج إلا إن بقي دين على مستأجرها السابق.</div>
<div class="sign"><div>إدارة الأملاك: ${who}<br><br>التوقيع: ________________</div><div>المالك: ${ownerName}<br><br>تاريخ الإصدار: ${arDate(today())}</div></div>
${footer(issuer)}`;
    return SHELL(`المتأخرات والمستحق — ${ownerName}`, body, markOf(issuer));
  }

  const body = `
${header("كشف حساب مالك — مجمّع", ownerName, issuer)}
<h1>كشف حساب المالك — ${ownerName}</h1>
<div class="sub">${countAr(rows.length, "عقار")} · ${countAr(T.units, "وحدة")} · الفترة: <b>${period.label}</b> (${arDate(period.from)} إلى ${arDate(period.to)})</div>

<div class="tot">
  <div><div class="v g">${sar(T.collected)}</div><div class="l">المُحصَّل للمالك (ريال)</div></div>
  <div><div class="v">${sar(T.expenses)}</div><div class="l">المصروفات (ريال)</div></div>
  ${anyFee ? `<div><div class="v">${sar(T.fee)}</div><div class="l">أتعاب الإدارة (ريال)</div></div>` : ""}
  <div><div class="v g" style="font-size:1.35rem">${sar(T.net)}</div><div class="l"><b>صافي المالك (ريال)</b></div></div>
</div>
${ownerPaidAll > 0.005 ? `<div class="note" style="border-inline-start-color:#B8791F;background:#FDF6E3">
  <b>المستحق تحويله للمالك: ${sar(Math.round((T.net + ownerPaidAll) * 100) / 100)} ريال</b> — الصافي أعلاه
  (${sar(T.net)}) يخصم كل مصروفات العقارات، ومنها ${sar(ownerPaidAll)} ريال دفعها المالك بنفسه ولم تمرّ بالمكتب.
</div>` : ""}

<div class="box" style="margin:12px 0 6px">
  <!-- حقائق لا تقديرات: المستند يُسلَّم للمالك كبيان حساب -->
  ${T.vat > 0 ? `<div class="r"><span>إجمالي المقبوض من المستأجرين</span><span>${sar(T.gross)} ريال — منه ${sar(T.vat)} ضريبة تُورَّد للهيئة</span></div>` : ""}
  <div class="r"><span>${T.vat > 0 ? "صافي الإيجار للمالك بعد الضريبة" : "المُحصَّل خلال الفترة"}</span><span><b style="color:#137a50">${sar(T.collected)}</b> ريال من ${countAr(rows.length, "عقار")}</span></div>
  <div class="r"><span>المتأخرات القائمة</span><span><b style="color:${T.due > 0 ? "#a5322c" : "#137a50"}">${sar(T.due)}</b> ريال — تراكمية لكل المدد لا الفترة</span></div>
  ${T.carried + T.legacy > 0 ? `<div class="r"><span style="padding-inline-start:12px">— ويُضاف إليها</span><span>${[T.carried > 0 ? `${sar(T.carried)} دين مرحَّل` : "", T.legacy > 0 ? `${sar(T.legacy)} على مستأجرين سابقين` : ""].filter(Boolean).join(" · ")}</span></div>` : ""}
</div>
<div class="note" style="margin-bottom:12px">
  المُحصَّل والمصروفات والأتعاب عن <b>الفترة المحددة وحدها</b>؛ أما «المتأخرات القائمة» فرقم تراكمي لكامل العقود — فلا يُقارن بها مباشرة.
</div>
<h2>ملخص العقارات</h2>
<div class="scrollx"><table>
  <thead><tr><th>العقار</th><th>الوحدات</th><th>شاغرة</th><th>${T.vat > 0 ? "صافي الإيجار" : "المُحصَّل"}</th><th>المصروفات</th>${anyFee ? "<th>الأتعاب</th>" : ""}<th>الصافي</th><th>متأخرات قائمة<div style="font-size:.62rem;font-weight:400;opacity:.8">كل المدد لا الفترة</div></th></tr></thead>
  <tbody>
    ${rows.map((r) => `<tr>
      <td><b>${r.s.property.name}</b><div style="font-size:.72rem;color:#5C6B67">${typeLabel(r.s.property.property_type)}${r.s.property.city ? ` · ${r.s.property.city}` : ""}</div></td>
      <td>${r.units}</td><td>${r.vacant || "—"}</td>
      <td>${sar(r.fin.collected)}</td><td>${sar(r.fin.expenses)}</td>
      ${anyFee ? `<td>${r.fin.feePct !== null ? `${sar(r.fin.fee)} <span style="font-size:.7rem;color:#5C6B67">(${r.fin.feePct}%)</span>` : "—"}</td>` : ""}
      <td><b>${sar(r.fin.net)}</b></td>
      <td>${r.due ? `<span class="pill l">${sar(r.due)}</span>` : "—"}</td>
    </tr>`).join("")}
    <tr>
      <td><b>الإجمالي</b></td><td><b>${T.units}</b></td><td>${T.vacant || "—"}</td>
      <td><b>${sar(T.collected)}</b></td><td><b>${sar(T.expenses)}</b></td>
      ${anyFee ? `<td><b>${sar(T.fee)}</b></td>` : ""}
      <td><b style="font-size:1.05rem">${sar(T.net)}</b></td>
      <td>${T.due ? `<b>${sar(T.due)}</b>` : "—"}</td>
    </tr>
  </tbody>
</table></div>

${rows.map((r) => `
<h2 style="margin-top:22px">${r.s.property.name} — التفصيل</h2>
<div class="sub" style="margin-bottom:6px">${typeLabel(r.s.property.property_type)}${r.s.property.city ? ` · ${r.s.property.city}` : ""}${r.s.property.address ? ` · ${r.s.property.address}` : ""}${r.s.property.usage ? ` · ${USAGE_AR[String(r.s.property.usage)] || r.s.property.usage}` : ""} · ${countAr(r.units, "وحدة")} (${r.units - r.vacant} مؤجّرة، ${r.vacant} شاغرة)</div>
${detail === "full" ? `
<h3 style="font-size:.85rem;margin:10px 0 4px">الوحدات — وصفها وإيجارها وحالتها</h3>
${unitsRegisterHTML(r.s.property, r.s.property.tenants || [], winOf(r.s.property, issuer), issuer)}
${propertyMetersHTML(r.s.property, (t) => `<h3 style="font-size:.85rem;margin:10px 0 4px">${t}</h3>`)}` : ""}
${ownerVisiblePayments(r.s.payments as any[]).length ? `<div class="scrollx"><table>
  <thead><tr><th>التاريخ</th><th>المستأجر</th><th>${unitLabel(r.s.property.property_type)}</th><th>المبلغ</th><th>الطريقة</th></tr></thead>
  <tbody>
    ${ownerVisiblePayments(r.s.payments as any[]).map((x: any) => `<tr><td>${arDate(x.paid_on)}</td><td>${x.tenant_name || "—"}</td><td>${x.unit || "—"}</td><td><b>${sar(x.amount)}</b></td><td>${payMethod(x)}</td></tr>`).join("")}
    ${/* (30 سبتمبر 2026) الإجمالي مجموع الصفوف نفسها: كان صافي الإيجار بعد الضريبة
         (13,000) تحت صفّين مجموعهما 14,500، فيجمع المالك بيده ويجد فرقًا بلا تفسير.
         الضريبة وصافي المالك سطران مسمّيان تحته. */ ""}
    <tr><td colspan="3"><b>إجمالي الدفعات المستلمة</b></td><td colspan="2"><b>${sar(r.collected)}</b></td></tr>
    ${r.vt.onTop > 0 ? `<tr><td colspan="3">(+) ضريبة دُفعت فوق الإيجار</td><td colspan="2">${sar(r.vt.onTop)}</td></tr>` : ""}
    ${(r.fin.vatCollected || 0) > 0 ? `<tr><td colspan="3">(−) ضريبة القيمة المضافة <span style="font-size:.72rem;color:#5C6B67">(تُورَّد للهيئة)</span></td><td colspan="2">${sar(r.fin.vatCollected || 0)}</td></tr>
    <tr><td colspan="3"><b>صافي الإيجار للمالك</b></td><td colspan="2"><b>${sar(r.fin.collected)}</b></td></tr>` : ""}
  </tbody>
</table></div>` : `<div class="sub">لا دفعات مسجّلة لهذا العقار خلال الفترة.</div>`}
${r.s.expenses.length ? `<div class="scrollx" style="margin-top:8px"><table>
  <thead><tr><th>التاريخ</th><th>التصنيف</th><th>${unitLabel(r.s.property.property_type)}</th><th>المبلغ</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${r.s.expenses.map((x) => `<tr><td>${arDate(x.spent_on)}</td><td>${catLabel(x.category)}</td><td>${x.unit || "—"}</td><td><b>${sar(Number(x.amount) || 0)}</b></td><td>${x.note ? escH(x.note) : "—"}</td></tr>`).join("")}
    <tr><td colspan="3"><b>إجمالي المصروفات</b></td><td colspan="2"><b>${sar(r.fin.expenses)}</b></td></tr>
  </tbody>
</table></div>` : ""}
`).join("")}

<div class="note">كشف استرشادي صادر آليًّا من سجل الدفعات والمصروفات المسجّلة في وثيق بتاريخ ${arDate(today())}. الأرقام تعكس ما وثّقه المكتب في النظام، وصافي كل عقار يُحسب بنفس طريقة تقرير العقار المنفرد.</div>
<div class="sign"><div>إدارة الأملاك: ${who}<br><br>التوقيع: ________________</div><div>المالك: ${ownerName}<br><br>تاريخ الإصدار: ${arDate(today())}</div></div>
${footer(issuer)}`;
  return SHELL(`كشف حساب المالك — ${ownerName} — ${period.label}`, body, markOf(issuer));
}

// ============================================================
// سجل التزامات المكتب العقاري — نسخة مطبوعة لملف المكتب:
// رخصة فال · عقود الوساطة ونوافذ عمولتها · تراخيص الإعلانات،
// مع الحدود النظامية بصياغة استرشادية موحّدة (UI_LEGAL).
// ============================================================

const DEAL_AR: Record<string, string> = { sale: "بيع", rent: "إيجار" };
const phasePill = (tone: "ok" | "warn" | "bad" | "muted", label: string) =>
  `<span class="pill ${tone === "ok" ? "p" : tone === "bad" ? "l" : "u"}">${label}</span>`;

export function complianceRegisterHTML(items: ComplianceItem[], orgName: string, issuer: Issuer = {}) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  items = scrub(items);
  orgName = scrub(orgName);
  issuer = scrub(issuer);
  const who = issuer.billing_name || orgName || "المكتب العقاري";
  const fal = items.filter((x) => x.kind === "fal_license");
  const bro = items.filter((x) => x.kind === "brokerage");
  const ads = items.filter((x) => x.kind === "ad_license");

  const falRows = fal.map((it) => {
    const st = complianceState(it);
    return `<tr>
      <td>${it.title}</td>
      <td>${it.ref_no || "—"}</td>
      <td>${arDate(it.start_date)}</td>
      <td>${arDate(st.endDate)}</td>
      <td>${phasePill(st.tone, st.label)}</td>
    </tr>`;
  }).join("");

  const broRows = bro.map((it) => {
    const st = complianceState(it);
    const be = brokerageEnd(it);
    const fee = expectedCommission(it);
    return `<tr>
      <td>${it.title}${it.exclusive ? ' <span class="pill u">حصري</span>' : ""}</td>
      <td>${it.party || "—"}</td>
      <td>${DEAL_AR[String(it.deal_type || "")] || "—"}</td>
      <td>${it.ref_no || "—"}</td>
      <td>${arDate(it.start_date)}</td>
      <td>${arDate(st.endDate)}${be.derived ? ' <span class="pill u">مستنتج 90 يومًا</span>' : ""}</td>
      <td>${st.windowEnd ? arDate(st.windowEnd) : "—"}</td>
      <td>${fee ? `${sar(fee)} <span style="font-size:.7rem;color:#5C6B67">(${Number(it.commission_pct) > 0 ? it.commission_pct : DEFAULT_COMMISSION_PCT}%)</span>` : "—"}</td>
      <td>${phasePill(st.tone, st.label)}</td>
    </tr>`;
  }).join("");

  const adRows = ads.map((it) => {
    const st = complianceState(it);
    return `<tr>
      <td>${it.title}</td>
      <td>${it.platform || "—"}</td>
      <td>${it.ref_no || "—"}</td>
      <td>${arDate(it.start_date)}</td>
      <td>${arDate(st.endDate)}</td>
      <td>${phasePill(st.tone, st.label)}</td>
    </tr>`;
  }).join("");

  const body = `
${header("سجل التزامات المكتب", who, issuer)}
<h1>سجل التزامات المكتب العقاري</h1>
<div class="sub">${who} · تاريخ الإصدار: ${arDate(today())} · ${countAr(items.length, "بند")}</div>

<h2>🪪 رخصة فال</h2>
${fal.length ? `<div class="scrollx"><table>
  <thead><tr><th>الرخصة</th><th>رقمها</th><th>الإصدار</th><th>الانتهاء</th><th>الحالة</th></tr></thead>
  <tbody>${falRows}</tbody>
</table></div>` : `<div class="sub">لم تُسجَّل رخصة فال بعد — سجّلها ليصلك تنبيه قبل انتهائها بثلاثين يومًا.</div>`}

<h2>🤝 عقود الوساطة (${bro.length})</h2>
${bro.length ? `<div class="scrollx"><table>
  <thead><tr><th>العقد</th><th>المالك</th><th>النوع</th><th>رقم الإيداع</th><th>الإبرام</th><th>الانتهاء</th><th>نافذة العمولة حتى</th><th>العمولة المتوقعة</th><th>الحالة</th></tr></thead>
  <tbody>${broRows}</tbody>
</table></div>` : `<div class="sub">لا عقود وساطة مسجّلة.</div>`}

<h2>📢 تراخيص الإعلانات (${ads.length})</h2>
${ads.length ? `<div class="scrollx"><table>
  <thead><tr><th>الإعلان</th><th>المنصة</th><th>رقم الترخيص</th><th>البداية</th><th>الانتهاء</th><th>الحالة</th></tr></thead>
  <tbody>${adRows}</tbody>
</table></div>` : `<div class="sub">لا تراخيص إعلانات مسجّلة.</div>`}

<h2>الحدود النظامية — استرشاديًّا</h2>
<table>
  <tbody>
    ${UI_LEGAL.map((x) => `<tr><td style="width:90px"><b>${x.ref}</b></td><td>${x.text}</td></tr>`).join("")}
  </tbody>
</table>

<div class="note">${LEGAL_DISCLAIMER}</div>
<div class="sign"><div>أعدّه: ${who}<br><br>التوقيع: ________________</div><div>تاريخ الإصدار: ${arDate(today())}</div></div>
${footer(issuer)}`;
  return SHELL(`سجل التزامات المكتب — ${who}`, body, markOf(issuer));
}

// ============================================================
// سجل المعروضات — نسخة مطبوعة تحلّ محلّ الأوراق المتفرقة:
// كل معروض بكوده وحالته وسعر متره وتاريخ آخر تأكيد لتوفره.
// ============================================================

export function listingsRegisterHTML(items: Listing[], orgName: string, issuer: Issuer = {}) {
  // تعقيم المدخلات (انظر scrub أعلاه)
  items = scrub(items);
  orgName = scrub(orgName);
  issuer = scrub(issuer);
  const who = issuer.billing_name || orgName || "المكتب العقاري";
  const rows = sortListings(items || []);
  const s = summarize(rows);

  const line = (l: Listing) => {
    const meta = L_KIND[l.kind] || L_KIND.other;
    const st = STATUS_META[(l.status || "available") as keyof typeof STATUS_META] || STATUS_META.available;
    const fr = freshness(l);
    const ppm = pricePerMeter(l);
    return `<tr>
      <td><b>${l.code || "—"}</b></td>
      <td>${meta.icon} ${meta.label} — ${OFFER_LABEL[l.offer_type] || ""}</td>
      <td>${shortDesc(l)}${l.title ? `<div style="font-size:.72rem;color:#5C6B67">${l.title}</div>` : ""}</td>
      <td>${Number(l.price) > 0 ? sar(Number(l.price)) : "—"}</td>
      <td>${ppm ? sar(ppm) : "—"}</td>
      <td>${l.owner_name || "—"}${l.owner_phone ? `<div style="font-size:.72rem;color:#5C6B67">${l.owner_phone}</div>` : ""}</td>
      <td>${arDate(l.last_confirmed_at)}${fr.stale ? ' <span class="pill u">راجعه</span>' : ""}</td>
      <td><span class="pill ${st.tone === "ok" ? "p" : st.tone === "warn" ? "u" : "u"}">${st.label}</span></td>
    </tr>`;
  };

  const body = `
${header("سجل المعروضات", who, issuer)}
<h1>سجل المعروضات</h1>
<div class="sub">${who} · تاريخ الإصدار: ${arDate(today())} · ${countAr(s.total, "معروض")}</div>

<div class="tot">
  <div><div class="v">${s.total}</div><div class="l">إجمالي المعروضات</div></div>
  <div><div class="v g">${s.available}</div><div class="l">متاح</div></div>
  <div><div class="v">${s.reserved}</div><div class="l">محجوز بعربون</div></div>
  <div><div class="v${s.stale ? " r" : ""}">${s.stale}</div><div class="l">يحتاج تأكيد توفر</div></div>
</div>

${s.stale > 0 ? `<div class="note">${s.stale === 1 ? "معروض واحد لم يُؤكَّد توفره" : `${countAr(s.stale, "معروض")} لم يُؤكَّد توفرها`} منذ ${daysAr(STALE_DAYS)} أو أكثر — تأكّد من المالك قبل عرضها على أي عميل.</div>` : ""}

<h2>المعروضات</h2>
${rows.length ? `<div class="scrollx"><table>
  <thead><tr><th>الكود</th><th>النوع</th><th>الوصف</th><th>السعر</th><th>سعر المتر</th><th>المالك</th><th>آخر تأكيد</th><th>الحالة</th></tr></thead>
  <tbody>${rows.map(line).join("")}</tbody>
</table></div>` : `<div class="sub">لا معروضات مسجّلة بعد.</div>`}

<div class="note">سجل داخلي للمكتب صادر آليًّا من وثيق بتاريخ ${arDate(today())}. الأسعار والحالات تعكس ما وثّقه المكتب، ولا يُعدّ هذا المستند عرضًا أو إعلانًا عقاريًّا.</div>
<div class="sign"><div>أعدّه: ${who}<br><br>التوقيع: ________________</div><div>تاريخ الإصدار: ${arDate(today())}</div></div>
${footer(issuer)}`;
  return SHELL(`سجل المعروضات — ${who}`, body, markOf(issuer));
}


// ============================================================
// سجل المصروفات المجمّع — كل العقارات في تقرير واحد
//
// صاحب المكتب كان يفتح كل عقار ليرى مصروفاته، فلا تتكوّن عنده صورة واحدة
// ولا يستطيع أن يطبع للمالك ما صُرف على عقاراته كلها. هذا التقرير يجمعها
// بفلترة على المالك والفترة والتصنيف، ويفصل بوضوح:
//   ما يُخصم من المالك · ما على المكتب · ما هو مستحق لم يُدفع بعد.
// ============================================================
export function expensesRegisterHTML(
  rows: (ExpenseRow & { property_name?: string | null; owner_name?: string | null })[],
  period: { label: string; from: string; to: string },
  issuer: Issuer = {},
  filters: { owner?: string | null; category?: string | null } = {},
) {
  if (period) period = scrub(period);   /* عنوان الفترة يُعرض في المستند */
  /* تعقيم ما يدخل المستند من نصّ مستخدم — كانت هذه الدالة تُدخله خامًا */
  filters = scrub(filters);
  rows = scrub(rows); issuer = scrub(issuer);
  const list = [...(rows || [])].sort((a, b) => String(a.spent_on).localeCompare(String(b.spent_on)));

  const billable = sumExpensesLocal(list.filter(isBillable));
  const onOffice = sumExpensesLocal(list.filter((e) => !isBillable(e)));
  const due = sumExpensesLocal(list.filter((e) => e.status === "due"));
  const total = sumExpensesLocal(list);

  // تجميع حسب العقار ثم حسب التصنيف
  const byProp: Record<string, typeof list> = {};
  list.forEach((e) => { const k = e.property_name || "—"; (byProp[k] ||= []).push(e); });
  const cats = sumByCategory(list as ExpenseRow[]);

  const inner = `
${header("سجل المصروفات", filters.owner ? `مالك: ${filters.owner}` : "كل العقارات", issuer)}
<h1>سجل المصروفات — ${period.label}</h1>
<div class="sub">من ${arDateH(period.from)} إلى ${arDateH(period.to)}${filters.owner ? ` · المالك: ${filters.owner}` : ""}${filters.category ? ` · التصنيف: ${catLabel(filters.category)}` : ""} · ${countAr(list.length, "قيد")}</div>

<div class="tot">
  <div><div class="v">${sar(total)}</div><div class="l">إجمالي المصروفات (ريال)</div></div>
  <div><div class="v r">${sar(billable)}</div><div class="l">تُخصم من المالك</div></div>
  <div><div class="v">${sar(onOffice)}</div><div class="l">على المكتب</div></div>
  ${due > 0 ? `<div><div class="v u">${sar(due)}</div><div class="l">مستحقة لم تُدفع</div></div>` : ""}
</div>

${cats.length ? `
<h2>حسب التصنيف</h2>
<div class="scrollx"><table>
  <thead><tr><th>التصنيف</th><th>عدد القيود</th><th>المبلغ</th><th>النسبة</th></tr></thead>
  <tbody>
    ${cats.map((c) => `<tr><td>${c.label}</td><td>${list.filter((e) => String(e.category || "other") === c.category).length}</td><td>${sar(c.total)}</td><td>${total > 0 ? Math.round((c.total / total) * 100) : 0}%</td></tr>`).join("")}
    <tr><td><b>الإجمالي</b></td><td><b>${list.length}</b></td><td><b>${sar(total)}</b></td><td>100%</td></tr>
  </tbody>
</table></div>` : ""}

${Object.entries(byProp).map(([name, items]) => `
<h2 style="margin-top:18px">${name} — ${sar(sumExpensesLocal(items))} ريال</h2>
<div class="scrollx"><table>
  <thead><tr><th>التاريخ</th><th>الوحدة</th><th>التصنيف</th><th>المورّد</th><th>رقم الفاتورة</th><th>المبلغ</th><th>على من</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${items.map((e) => `<tr>
      <td>${arDate(e.spent_on)}</td>
      <td>${e.unit || "—"}</td>
      <td>${catLabel(e.category)}</td>
      <td>${e.vendor || "—"}</td>
      <td dir="ltr">${e.invoice_no || "—"}</td>
      <td><b>${sar(e.amount)}</b></td>
      <td>${isBillable(e) ? "المالك" : "<span style='color:#5C6B67'>المكتب</span>"}${e.paid_by ? `<div style="font-size:.65rem;color:#5C6B67">${PAID_BY[String(e.paid_by)] || ""}</div>` : ""}</td>
      <td>${e.status === "due" ? '<span class="pill u">مستحقة</span>' : '<span class="pill p">مدفوعة</span>'}</td>
      <td>${e.note ? escH(e.note) : "—"}</td>
    </tr>`).join("")}
    <tr><td colspan="5"><b>مجموع ${name}</b></td><td colspan="4"><b>${sar(sumExpensesLocal(items))} ريال</b></td></tr>
  </tbody>
</table></div>`).join("")}

<div class="note">
  «تُخصم من المالك» تدخل في حساب صافيه في تقرير المالك، و«على المكتب» لا تدخل.
  والمستحقة غير المدفوعة معروضة للعلم ولا تُعدّ نقدًا خارجًا بعد.
  سجل استرشادي صادر آليًّا بتاريخ ${arDate(today())}.
</div>`;
  return SHELL(`سجل المصروفات — ${period.label}`, inner + footer(issuer), markOf(issuer));
}

/** مجموع بسيط بلا فلترة — داخلي لهذا التقرير */
function sumExpensesLocal(rows: ExpenseRow[]): number {
  return Math.round((rows || []).reduce((s, x) => s + (Number(x.amount) || 0), 0) * 100) / 100;
}

// ============================================================
// كشف التحصيل — على نمط الكشف الذي يعدّه المكتب بيده
//
// المكتب كان يكتبه في إكسل: صفٌّ لكل دفعة عبر كل العمائر، ثم المصروفات،
// ثم صافي الدخل. وهو مختلف عن كشوفنا: تلك تعرض حالة العقد، وهذا يعرض
// حركة النقد في فترة.
//
// حافظتُ على ترتيب أعمدته كما هي — لأن المكتب يقرأها بعينه من سنوات،
// وتغيير الترتيب يجعله يعيد التعلّم بلا سبب.
// ============================================================

export type CollectionRow = {
  property: string;
  unit?: string | null;
  tenant?: string | null;
  paid_on: string;
  amount: number;
  /** «القسط الأول» · «جزء من القسط الثاني باقي 2,500» */
  statement?: string | null;
  /** رقم عقد إيجار، أو «ورقي» حين لا يوجد */
  contract_no?: string | null;
  calendar?: string | null;
};

export function collectionStatementHTML(
  rows: CollectionRow[],
  expenses: { note?: string | null; category?: string | null; amount: number }[],
  period: { label: string; from: string; to: string },
  issuer: any,
  opts?: { title?: string; feePct?: number | null;
    /** الصافي بمعادلة تقرير المالك (lib/collection) — بدونه يبقى «المسجَّل − المصروفات» */
    fin?: { gross: number; vat: number; collected: number; expenses: number; fee: number; feeVat: number; net: number; ownerPaid: number; feePcts: number[] } },
) {
  if (period) period = scrub(period);   /* عنوان الفترة يُعرض في المستند */
  /* تعقيم ما يدخل المستند من نصّ مستخدم — كانت هذه الدالة تُدخله خامًا */
  rows = scrub(rows); expenses = scrub(expenses); issuer = scrub(issuer);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  /* (30 سبتمبر 2026) esc بعد scrub كان يُهرِّب مرتين («أ &amp;amp; ب») — escH لا يُكرِّر */
  const esc = (v: any) => escH(v);
  const sorted = [...(rows || [])].sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)));
  const collected = round2(sorted.reduce((a, x) => a + (Number(x.amount) || 0), 0));
  const exp = (expenses || []).filter((e) => Number(e.amount) > 0);
  const expTotal = round2(exp.reduce((a, x) => a + (Number(x.amount) || 0), 0));
  const F = opts?.fin;
  const net = F ? F.net : round2(collected - expTotal);

  /* التاريخ بالتقويمين: المكتب يكتب الهجري، والمحاسب يحتاج الميلادي */
  const both = (iso: string, cal?: string | null) => {
    if (!iso) return "—";
    return String(cal) === "hijri"
      ? `${hijriText(iso)}<div style="font-size:.62rem;color:#5C6B67">${arDate(iso)}</div>`
      : `${arDate(iso)}<div style="font-size:.62rem;color:#5C6B67">${hijriText(iso)}</div>`;
  };

  const inner = `
${header(esc(opts?.title || "كشف حساب لعمائر المكتب"), esc(period.label), issuer)}

<div class="sub" style="margin-bottom:14px">
  تاريخ التحصيل من <b>${arDate(period.from)}</b> إلى <b>${arDate(period.to)}</b>
  · ${sorted.length ? `${countAr(sorted.length, "عملية")} تحصيل` : "لا عمليات تحصيل"}
</div>

${sorted.length ? `<div class="scrollx"><table>
  <thead><tr>
    <th>عمارة</th><th>رقم الوحدة</th><th>اسم المستأجر</th>
    <th>تاريخ السداد</th><th>البيان</th><th>المبلغ</th><th>رقم العقد</th>
  </tr></thead>
  <tbody>
    ${sorted.map((x) => `<tr>
      <td>${esc(x.property || "—")}</td>
      <td>${esc(String(x.unit ?? "—"))}</td>
      <td>${esc(x.tenant || "—")}</td>
      <td>${both(x.paid_on, x.calendar)}</td>
      <td>${esc(x.statement || "—")}</td>
      <td><b>${sar(Number(x.amount) || 0)}</b></td>
      <td style="font-size:.7rem">${esc(x.contract_no || "ورقي")}</td>
    </tr>`).join("")}
    <tr style="background:#F6F2E8">
      <td colspan="5"><b>رصيد السداد المتاح</b></td>
      <td><b>${sar(collected)}</b></td><td>—</td>
    </tr>
  </tbody>
</table></div>` : `<div class="sub">لم تُسجَّل عمليات تحصيل في هذه الفترة.</div>`}

<h2>كشف مصروفات</h2>
<div class="scrollx"><table>
  <thead><tr><th>البيان</th><th>المبلغ</th></tr></thead>
  <tbody>
    ${exp.length ? exp.map((e) => `<tr>
      <td>${esc(e.note || catLabel(e.category || "other"))}</td>
      <td><b>${sar(Number(e.amount) || 0)}</b></td>
    </tr>`).join("") : `<tr><td>لا مصروفات في الفترة</td><td>0</td></tr>`}
    <tr style="background:#F6F2E8"><td><b>إجمالي المبلغ</b></td><td><b>${sar(expTotal)}</b></td></tr>
  </tbody>
</table></div>

${F ? `<div class="box" style="margin-top:16px">
  ${F.vat > 0 ? `<div class="r"><span>إجمالي المقبوض</span><span>${sar(F.gross)}</span></div>
  <div class="r"><span>(−) ضريبة القيمة المضافة المحصَّلة <span style="font-size:.72rem;color:#5C6B67">(تُورَّد للهيئة)</span></span><span>${sar(F.vat)}</span></div>` : ""}
  <div class="r"><span>${F.vat > 0 ? "صافي إيراد المالك من الإيجار" : "المحصَّل خلال الفترة"}</span><span>${sar(F.collected)}</span></div>
  <div class="r"><span>(−) المصروفات على المالك</span><span>${sar(F.expenses)}</span></div>
  ${F.fee > 0 ? `<div class="r"><span>(−) أتعاب الإدارة${F.feePcts.length === 1 ? ` (${F.feePcts[0]}%)` : ""}</span><span>${sar(F.fee)}</span></div>` : ""}
  ${F.feeVat > 0 ? `<div class="r"><span>(−) ضريبة على أتعاب الإدارة</span><span>${sar(F.feeVat)}</span></div>` : ""}
</div>` : ""}
<div class="box" style="margin-top:${F ? 8 : 16}px;background:#0E3A37;color:#EAF1EE;border:0">
  <div class="r" style="border:0">
    <span style="font-size:1rem">${F ? "صافي المالك" : "صافي الدخل"}</span>
    <span style="font-size:1.35rem;font-weight:800;color:#E7C877">${sar(net)} ريال</span>
  </div>
  ${F && F.ownerPaid > 0.005 ? `<div class="r" style="border:0"><span>المستحق تحويله للمالك <span style="font-size:.72rem;opacity:.8">(+ ${sar(F.ownerPaid)} مصروفات دفعها بنفسه)</span></span>
    <span style="font-weight:800;color:#E7C877">${sar(Math.round((net + F.ownerPaid) * 100) / 100)} ريال</span></div>` : ""}
</div>

<div class="note">
  ${F ? "صافي المالك بالمعادلة نفسها في تقرير المالك: المقبوض − ضريبة الهيئة − المصروفات على المالك − أتعاب الإدارة."
      : `صافي الدخل = رصيد السداد المتاح (${sar(collected)}) − إجمالي المصروفات (${sar(expTotal)}).`}
  والمبالغ من الدفعات المسجَّلة في وثيق بتاريخ استلامها.
</div>
`;
  return SHELL(`كشف حساب لعمائر المكتب — ${esc(period.label)}`, inner + footer(issuer), markOf(issuer));
}

/**
 * أقساط الإيجار المسجَّلة لكل ساكن في مدته الحالية — لملاحظة الرصيد الافتتاحي
 * في تقرير المالك. تُمرَّر دفعات العقار كلها (لا دفعات الفترة) مع وحداته.
 * المقارنة نصّية: PostgREST يُرجع الطوابع بصيغة واحدة، فتبقى دقة الميكروثانية.
 */
export function termRentPaidOf(
  tenants: { id: string; term_started_at?: string | null }[],
  payments: { tenant_id?: string | null; amount: number | string; applies_to?: string | null; created_at?: string | null }[],
): Record<string, number> {
  const since: Record<string, string | null> = {};
  for (const t of tenants || []) {
    const v = t.term_started_at ? String(t.term_started_at) : null;
    since[t.id] = v && !/infinity/.test(v) ? v : null;
  }
  const out: Record<string, number> = {};
  for (const x of payments || []) {
    if (!x.tenant_id || !(x.tenant_id in since)) continue;
    if ((x.applies_to || "rent") !== "rent") continue;          // سداد الديون ليس قسطًا
    const b = since[x.tenant_id];
    if (b && String(x.created_at || "") < b) continue;          // دفعات مدة سابقة
    out[x.tenant_id] = Math.round(((out[x.tenant_id] || 0) + (Number(x.amount) || 0)) * 100) / 100;
  }
  return out;
}

// ============================================================
// محاضر الجمعية لبوابة الملاك (30 سبتمبر 2026)
// HTML دلالي بسيط يمرّ على منقّي البوابة كما هو (h2 · p · b · table):
// بلا ترويسة ولا تذييل ولا جداول توقيع ولا أنماط — المالك يقرأ ويعتمد من جواله.
// ============================================================
type MinutesInput = {
  meeting_date?: string; place?: string; mode?: string; attendees?: number | string; total_units?: number | string;
  president?: string; manager?: string; fee?: number | string; due_day?: string; bank?: string;
  year?: number | string; annual_budget?: number | string; collected?: number | string; spent?: number | string;
  fund_balance?: number | string; notes?: string;
  fee_period?: string; fee_basis?: string; attendance?: HoaAttendance[]; round?: number; approved?: boolean[];
};
const pEsc = (v: any) => escH(unesc(String(v ?? "")));
const decidedPlain = (q: HoaQuorum, text: string, ticked?: boolean) =>
  q.met === true && ticked ? text : q.met === false ? "لم يُتّخذ قرار — النصاب غير مكتمل" : "يُدوَّن بعد التصويت";
function portalMinutes(kind: "founding" | "renewal", a: AssociationDoc, d: MinutesInput): { title: string; html: string; draft: boolean } {
  const units = Number(d.total_units) || Number(a.units) || (a.owners || []).length || 0;
  const q = hoaQuorum({ attendance: d.attendance, attendees: d.attendees as any, total_units: units, round: d.round,
    first_pct: a.quorum_first_pct, second_pct: a.quorum_second_pct });
  const ap1 = (n: number) => !!(d.approved || [])[n];
  const draft = !(q.met === true && (d.approved || []).some(Boolean));
  const ap = { fee_period: d.fee_period || a.fee_period };
  const fee = Number(d.fee) || Number(a.fee) || 0;
  const share = (d.fee_basis || a.fee_basis) === "share";
  const feeTxt = share ? `توزيع رسوم الاشتراك حسب حصة كل وحدة، وتُستحق ${perWord(ap)}`
    : fee ? `الاشتراك ${sar(fee)} ريال لكل وحدة ${perWord(ap)}` : "";
  const nextYear = Number(d.year) || Number(today().slice(0, 4)) + (kind === "renewal" ? 1 : 0);
  const items: [string, string][] = kind === "founding" ? [
    ["تأسيس جمعية الملاك واعتماد نظامها الأساسي", decidedPlain(q, "الموافقة على التأسيس واعتماد النظام الأساسي", ap1(1))],
    ["انتخاب رئيس الجمعية", decidedPlain(q, d.president ? `انتخاب ${pEsc(d.president)} رئيسًا للجمعية` : "يُدوَّن بعد التصويت", ap1(2))],
    ["تعيين مدير العقار", decidedPlain(q, d.manager ? `تعيين ${pEsc(d.manager)} مديرًا للعقار` : "يُدوَّن بعد التصويت", ap1(3))],
    [`اعتماد الموازنة التقديرية${d.year ? ` لعام ${pEsc(d.year)}` : ""}`, decidedPlain(q, d.annual_budget ? `اعتماد موازنة بإجمالي ${sar(Number(d.annual_budget))} ريال سنويًّا` : "يُدوَّن بعد التصويت", ap1(4))],
    ["تحديد اشتراك الصيانة", decidedPlain(q, feeTxt || "يُدوَّن بعد التصويت", ap1(5))],
    ["فتح الحساب البنكي للجمعية", decidedPlain(q, d.bank ? `تفويض الإدارة بفتح حساب لدى ${pEsc(d.bank)}` : "تفويض الإدارة بفتح حساب بنكي باسم الجمعية", ap1(6))],
    ["التسجيل في منصة «ملاك»", decidedPlain(q, "تفويض رئيس الجمعية بإتمام التسجيل", ap1(7))],
  ] : [
    ["تقرير أعمال الجمعية عن العام المنقضي", decidedPlain(q, "استُعرض التقرير وصودق عليه", ap1(1))],
    ["الموقف المالي", decidedPlain(q, "صودق على الموقف المالي", ap1(2))],
    [`اعتماد الموازنة التقديرية لعام ${nextYear}`, decidedPlain(q, d.annual_budget ? `اعتماد موازنة بإجمالي ${sar(Number(d.annual_budget))} ريال سنويًّا (الموازنة المعروضة)` : "اعتماد الموازنة التقديرية المعروضة", ap1(3))],
    [`اشتراك الصيانة لعام ${nextYear}`, decidedPlain(q, feeTxt || "يُدوَّن بعد التصويت", ap1(4))],
    ["مدير العقار", decidedPlain(q, d.manager ? `تجديد تعيين ${pEsc(d.manager)} مديرًا للعقار` : "يُدوَّن بعد التصويت", ap1(5))],
    ["قرار رسوم الاشتراك في منصة «ملاك»", decidedPlain(q, "تفويض الرئيس ومدير العقار بإنشاء القرار وطرحه للتصويت", ap1(6))],
    ...(d.notes ? [["بنود إضافية", decidedPlain(q, pEsc(d.notes), ap1(7))] as [string, string]] : []),
  ];
  const base = kind === "founding" ? "محضر الجمعية العمومية التأسيسية" : "محضر اجتماع الجمعية العمومية السنوي";
  const title = draft ? `مشروع محضر — للاطلاع والاعتماد: ${base.replace(/^محضر /, "")}` : base;
  const pct = q.pct === null || q.basis === "none" ? "—" : `${q.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}٪`;
  const qTxt = q.met === true ? `النصاب متحقق (${pct}${q.basis === "shares" ? " من الحصص" : ""})`
    : q.met === false ? `النصاب غير متحقق (${pct}) — لم يُتّخذ أي قرار`
    : `يُحتسب النصاب عند الانعقاد — المطلوب ${q.round === 2 && !q.threshold ? "أي عدد في الاجتماع الثاني" : `${q.threshold}٪ من الحصص`} حسب النظام الأساسي للجمعية`;
  const reg = [a.mullak_reg_no ? `رقم التسجيل في «ملاك»: ${pEsc(a.mullak_reg_no)}` : "", a.unified_no ? `الرقم الموحّد: ${pEsc(a.unified_no)}` : ""].filter(Boolean).join(" · ");
  const html = [
    `<h2>${pEsc(title)} — ${pEsc(a.name)}</h2>`,
    reg ? `<p>${reg}</p>` : "",
    `<p><b>التاريخ:</b> ${arDate(d.meeting_date || today())}${hijriText(String(d.meeting_date || today()).slice(0, 10)) ? ` (${hijriText(String(d.meeting_date || today()).slice(0, 10))})` : ""}</p>`,
    `<p><b>طريقة الانعقاد:</b> ${pEsc(d.mode || "حضوري")}${d.place ? ` — ${pEsc(d.place)}` : ""}</p>`,
    `<p><b>الاجتماع:</b> ${q.round === 2 ? "الثاني" : "الأول"} · <b>الحضور:</b> ${q.basis === "none" ? "—" : `${q.present} من ${q.total}`} · <b>النصاب:</b> ${qTxt}</p>`,
    kind === "renewal" ? `<p><b>الموقف المالي:</b> المحصَّل ${Number(d.collected) ? sar(Number(d.collected)) + " ريال" : "—"} · المصروف ${Number(d.spent) ? sar(Number(d.spent)) + " ريال" : "—"} · رصيد الصندوق ${moneySigned(Number(d.fund_balance ?? a.fund_balance) || 0)} ريال</p>` : "",
    `<table><thead><tr><th>البند</th><th>القرار</th></tr></thead><tbody>${items.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>`,
    `<p>${draft ? "هذا مشروع محضر للاطلاع قبل الاجتماع أو قبل تدوين القرارات — لا يُعدّ إقرارًا لأي بند." : "تُتّخذ القرارات بموافقة ملاك ثلاثة أرباع المساحة الإجمالية للوحدات (المادة 18/6)."} نموذج استرشادي أعدّته إدارة الجمعية؛ يُطابَق مع النظام الأساسي المعتمد.</p>`,
  ].filter(Boolean).join("\n");
  return { title, html, draft };
}
export const foundingMinutesPortalHTML = (a: AssociationDoc, d: MinutesInput) => portalMinutes("founding", a, d);
export const renewalMinutesPortalHTML = (a: AssociationDoc, d: MinutesInput) => portalMinutes("renewal", a, d);

/**
 * سند صرف مصروف عقار (schema-v74 — طلب مكتب، 6 أكتوبر 2026).
 *
 * المكتب يصرف من حساب العقار لصيانة أو غيرها، ويسلّم المبلغ لشخص يكتب
 * اسمه يدويًا (مستأجر، أحد الورثة، فنّي). السند: رقم متسلسل من القاعدة،
 * المبلغ رقمًا وبالحروف، البيان، وخانتا توقيع المستلم والمكتب.
 * المصروف نفسه يبقى في المصروفات ويدخل صافي المالك كما هو.
 */
export type ExpenseVoucher = ExpenseRow & {
  voucher_no?: string | null; payee_name?: string | null; payee_ref?: string | null;
};
export function expenseVoucherHTML(e: ExpenseVoucher, p: { name: string; property_type?: string | null; owner_name?: string | null }, issuer: Issuer = {}) {
  e = scrub(e); p = scrub(p); issuer = scrub(issuer);
  const who = issuerName(issuer) || "إدارة الأملاك";
  const amount = Number(e.amount) || 0;
  const ul = unitLabel(p.property_type as any);
  const body = `
${header("سند صرف", e.voucher_no || "—", issuer, e.spent_on)}
<h1>سند صرف</h1>
<div class="sub">${p.name}${e.unit ? ` · ${ul} ${e.unit}` : ""}</div>

<div class="box" style="margin-top:10px">
  <div class="r"><span>رقم السند</span><span dir="ltr" style="font-family:monospace;font-weight:700">${e.voucher_no || "—"}</span></div>
  <div class="r"><span>التاريخ</span><span>${arDateH(e.spent_on)}</span></div>
  <div class="r"><span>صُرف إلى</span><span style="font-weight:700">${e.payee_name || "—"}</span></div>
  ${e.payee_ref ? `<div class="r"><span>هوية / جوال المستلم</span><span dir="ltr">${e.payee_ref}</span></div>` : ""}
  <div class="r"><span>المبلغ</span><span style="font-weight:700;font-size:1.1em">${sar(amount)} ريال</span></div>
  <div class="r"><span>المبلغ بالحروف</span><span>${riyalsInWords(amount)}</span></div>
  <div class="r"><span>البند</span><span>${catLabel(e.category)}</span></div>
  ${e.note ? `<div class="r"><span>البيان</span><span style="overflow-wrap:anywhere">${e.note}</span></div>` : ""}
  ${e.vendor ? `<div class="r"><span>المورّد</span><span>${e.vendor}</span></div>` : ""}
  ${e.invoice_no ? `<div class="r"><span>رقم الفاتورة</span><span dir="ltr">${e.invoice_no}</span></div>` : ""}
  <div class="r"><span>مصدر الصرف</span><span>${PAID_BY[String(e.paid_by || "collections")] || PAID_BY.collections}${isBillable(e) ? (p.owner_name ? ` — يُخصم من صافي ${p.owner_name}` : " — يُخصم من صافي المالك") : " — على المكتب"}</span></div>
</div>

<div class="note">أقرّ أنا المستلم بأنني استلمت المبلغ الموضح أعلاه كاملًا للغرض المذكور في البيان.</div>

<div class="sign">
  <div>المستلم: ${e.payee_name || "________________"}<br><br>التوقيع: ________________<br><br>التاريخ: ____ / ____ / ________</div>
  <div>عن ${who}<br><br>التوقيع والختم: ________________</div>
</div>
${footer(issuer)}`;
  return SHELL(`سند صرف ${e.voucher_no || ""} — ${p.name}`, body, markOf(issuer));
}
