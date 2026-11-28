/**
 * رسالة واتساب للمستأجر عن نهاية العقد (5 أكتوبر 2026).
 *
 * السبب: مكتب أراد إبلاغ مستأجر بانتهاء عقده فلم يجد طريقًا — زر التذكير
 * يُخفى عمدًا عمّن انتهى عقده بلا متأخرات (لأن نصّه عن «الدفعة القادمة»)،
 * وقائمة «عقود تنتهي» بلا زر واتساب أصلًا. والرسالة الوحيدة عن نهاية العقد
 * كانت «إشعار عدم تجديد» في بوت تليجرام، وتقول «تسوية أي مستحقّات» دون أن
 * تذكر هل عليه شيء أم لا.
 *
 * هنا نصّ واحد تشترك فيه لوحة العقار ولوحة المحفظة والبوت، فلا تختلف صيغته
 * بين مكان وآخر. ويذكر صراحةً حالة المستحقات: المبالغ إن وُجدت، و«لا توجد
 * مستحقات متأخرة» إن لم توجد — لأن المستأجر الذي يُبلَّغ بنهاية عقده أول ما
 * يسأل عنه: هل عليّ شيء؟
 */
import { sar } from "@/lib/utils";
import { arDate } from "@/lib/documents";
import { hijriText } from "@/lib/hijri";
import { enDate } from "@/lib/docEn";

export type EndNoticeInput = {
  /** "end" إشعار بانتهاء العقد مع سؤال التجديد أو الإخلاء · "nonrenewal" إشعار بعدم التجديد */
  mode: "end" | "nonrenewal";
  tenantName: string;
  /** مثل: «الشقة (103)» */
  unitText: string;
  propertyName: string;
  endDate: string | null;
  daysToEnd: number | null;
  /** العقد هجري: يُضاف التاريخ الهجري بجانب الميلادي */
  hijri?: boolean;
  /** متأخر العقد الحالي (شاملًا الضريبة إن كانت مضافة) */
  overdue: number;
  overdueVat?: boolean;
  unpaid: number;
  /** دين مرحَّل من مدة سابقة */
  carried: number;
  /** دفعة لم يحن موعدها بعد وتستحق قبل نهاية العقد */
  upcomingDate?: string | null;
  upcomingAmount?: number;
  signer: string;
  /** (14 نوفمبر 2026 — مكتب الأولى) بنود المكتب الاختيارية من الإعدادات — تُطبع فقط إن ضُبطت */
  terms?: EndNoticeTerms;
  /** الإيجار السنوي الحالي — يُذكر مع «عند التجديد» إن فعّل المكتب ذكره */
  annualRent?: number | null;
  /** (18 نوفمبر 2026) للنسخة الإنجليزية: «Apartment (103)» — بدونه يُستعمل unitText */
  unitTextEn?: string;
};

/**
 * بنود إشعار الانتهاء (من إعدادات المكتب — profiles.notice_*):
 * رسوم إدارية للتجديد، أجرة يومية بعد نهاية العقد بموجب مادة فيه، شرط «لا
 * تجديد مع متأخرات»، وذكر قيمة الإيجار عند التجديد. كلها اختيارية؛ ما لم
 * يُضبط لا يظهر، فالمكاتب التي لم تطلبها لا يتغيّر نصّها حرفًا.
 */
export type EndNoticeTerms = {
  adminFee?: number | null;
  dailyRent?: number | null;
  dailyArticle?: string | null;
  noRenewWithArrears?: boolean | null;
  showRent?: boolean | null;
};
export function noticeTermsOf(profile: any): EndNoticeTerms {
  const p = profile || {};
  return {
    adminFee: Number(p.notice_admin_fee) > 0 ? Number(p.notice_admin_fee) : null,
    dailyRent: Number(p.notice_daily_rent) > 0 ? Number(p.notice_daily_rent) : null,
    dailyArticle: String(p.notice_daily_article || "").trim() || null,
    noRenewWithArrears: !!p.notice_no_renew_arrears,
    showRent: !!p.notice_show_rent,
  };
}

const daysPhrase = (d: number) =>
  d === 1 ? "يوم واحد" : d === 2 ? "يومين" : d >= 3 && d <= 10 ? `${d} أيام` : `${d} يومًا`;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function endNoticeText(i: EndNoticeInput): string {
  const date = i.endDate ? `${arDate(i.endDate)}${i.hijri ? ` (${hijriText(i.endDate)})` : ""}` : "";
  const ended = i.daysToEnd !== null && i.daysToEnd < 0;
  const where = `${i.unitText} بعقار ${i.propertyName}`;
  const L: string[] = [`السلام عليكم ورحمة الله، ${i.tenantName || ""}`.trim(), ""];

  if (i.mode === "nonrenewal") {
    L.push(date
      ? `نفيدكم برغبتنا بعدم تجديد عقد إيجار ${where}، ${ended ? "المنتهي" : "الذي ينتهي"} بتاريخ ${date}.`
      : `نفيدكم برغبتنا بعدم تجديد عقد إيجار ${where}.`);
  } else if (!date) {
    L.push(`نفيدكم بقرب انتهاء عقد إيجار ${where}.`);
  } else if (ended) {
    L.push(`نفيدكم بأن عقد إيجار ${where} انتهى بتاريخ ${date}.`);
  } else if (i.daysToEnd === 0) {
    L.push(`نفيدكم بأن عقد إيجار ${where} ينتهي اليوم ${date}.`);
  } else {
    L.push(`نفيدكم بأن عقد إيجار ${where} ينتهي بتاريخ ${date}${i.daysToEnd !== null ? ` — بعد ${daysPhrase(i.daysToEnd)}` : ""}.`);
  }

  // ── حالة المستحقات: صريحة في الحالتين
  const overdue = Math.max(0, Number(i.overdue) || 0);
  const carried = Math.max(0, Number(i.carried) || 0);
  const total = round2(overdue + carried);
  L.push("");
  if (total > 0) {
    L.push("وبيان المستحقات غير المسدَّدة حتى تاريخه:");
    if (overdue > 0) L.push(`• ${i.unpaid > 1 ? `دفعات متأخرة (${i.unpaid})` : "دفعة متأخرة"}: ${sar(overdue)} ريال${i.overdueVat ? " (شامل الضريبة)" : ""}`);
    if (carried > 0) L.push(`• متأخرات من مدة سابقة: ${sar(carried)} ريال`);
    if (overdue > 0 && carried > 0) L.push(`• الإجمالي المطلوب: ${sar(total)} ريال`);
  } else {
    L.push("ولا توجد عليكم مستحقات متأخرة حتى تاريخه، شاكرين التزامكم بالسداد.");
  }
  const up = i.upcomingDate && !ended && (Number(i.upcomingAmount) || 0) > 0
    && (!i.endDate || i.upcomingDate <= i.endDate) ? i.upcomingDate : null;
  if (up) L.push(`وتبقى دفعة بتاريخ ${arDate(up)}${i.hijri ? ` (${hijriText(up)})` : ""} بمبلغ ${sar(Number(i.upcomingAmount))} ريال قبل نهاية العقد.`);

  // ── المطلوب من المستأجر
  L.push("");
  if (i.mode === "nonrenewal") {
    L.push(total > 0
      ? `ونأمل سداد المستحقات أعلاه وترتيب الإخلاء وتسليم الوحدة ${ended ? "في أقرب وقت" : "قبل ذلك التاريخ"}.`
      : `ونأمل ترتيب الإخلاء وتسليم الوحدة ${ended ? "في أقرب وقت" : "قبل ذلك التاريخ"}.`);
  } else if (ended) {
    L.push("نأمل التواصل معنا في أقرب وقت لترتيب أحد الأمرين:");
    L.push("• تجديد العقد، أو");
    L.push("• الإخلاء وتسليم الوحدة.");
  } else {
    L.push("نأمل إفادتنا برغبتكم قبل تاريخ انتهاء العقد:");
    L.push("• تجديد العقد، أو");
    L.push("• عدم التجديد والإخلاء وتسليم الوحدة.");
  }
  if (total > 0 && i.mode === "end") L.push("علمًا بأن تسوية المستحقات تسبق التجديد أو تسليم الوحدة.");

  // ── بنود المكتب الاختيارية (إعدادات المكتب) — لا تظهر ما لم تُضبط
  const tm = i.terms || {};
  const renew: string[] = [];
  if (i.mode === "end" && tm.showRent && (Number(i.annualRent) || 0) > 0) renew.push(`يكون الإيجار السنوي ${sar(Number(i.annualRent))} ريال`);
  if (i.mode === "end" && (Number(tm.adminFee) || 0) > 0) renew.push(`${renew.length ? "إضافةً إلى" : "تُستحق"} رسوم إدارية قدرها ${sar(Number(tm.adminFee))} ريال`);
  if (renew.length) L.push(`وفي حال الرغبة في التجديد ${renew.join(" ")}.`);
  if (i.mode === "end" && tm.noRenewWithArrears && total > 0) L.push("علمًا بأن التجديد لا يتم مع وجود متأخرات.");
  if ((Number(tm.dailyRent) || 0) > 0) {
    const art = tm.dailyArticle ? ` بموجب المادة (${tm.dailyArticle}) من العقد` : " حسب العقد";
    L.push(`وفي حال عدم ${i.mode === "end" ? "التجديد و" : ""}الإخلاء ${ended ? "فورًا" : "قبل نهاية العقد"}، تُحتسب أجرة قدرها ${sar(Number(tm.dailyRent))} ريال عن كل يوم تأخير${art} حتى الإخلاء وتسليم المفاتيح.`);
  }

  L.push("", "شاكرين لكم حسن تعاونكم،", i.signer);
  return L.join("\n");
}

const daysEn = (d: number) => `${d} ${d === 1 ? "day" : "days"}`;

/**
 * إشعار انتهاء العقد بالإنجليزية (18 نوفمبر 2026 — طلب مكتب «الأولى»): مرآة endNoticeText
 * سطرًا بسطر — الحالات نفسها، والمستحقات نفسها، وبنود المكتب نفسها. التاريخ ميلادي.
 */
export function endNoticeTextEn(i: EndNoticeInput): string {
  const date = i.endDate ? enDate(i.endDate) : "";
  const ended = i.daysToEnd !== null && i.daysToEnd < 0;
  const where = `${i.unitTextEn || i.unitText}, ${i.propertyName}`;
  const L: string[] = [`Dear ${i.tenantName || "tenant"},`, ""];

  if (i.mode === "nonrenewal") {
    L.push(date
      ? `We would like to inform you that we do not wish to renew the lease for ${where}, which ${ended ? "ended" : "ends"} on ${date}.`
      : `We would like to inform you that we do not wish to renew the lease for ${where}.`);
  } else if (!date) {
    L.push(`We would like to inform you that the lease for ${where} is ending soon.`);
  } else if (ended) {
    L.push(`We would like to inform you that the lease for ${where} ended on ${date}.`);
  } else if (i.daysToEnd === 0) {
    L.push(`We would like to inform you that the lease for ${where} ends today, ${date}.`);
  } else {
    L.push(`We would like to inform you that the lease for ${where} ends on ${date}${i.daysToEnd !== null ? ` — in ${daysEn(i.daysToEnd)}` : ""}.`);
  }

  const overdue = Math.max(0, Number(i.overdue) || 0);
  const carried = Math.max(0, Number(i.carried) || 0);
  const total = round2(overdue + carried);
  L.push("");
  if (total > 0) {
    L.push("Outstanding amounts to date:");
    if (overdue > 0) L.push(`• ${i.unpaid > 1 ? `Overdue instalments (${i.unpaid})` : "Overdue instalment"}: SAR ${sar(overdue)}${i.overdueVat ? " (incl. VAT)" : ""}`);
    if (carried > 0) L.push(`• Balance carried from a previous term: SAR ${sar(carried)}`);
    if (overdue > 0 && carried > 0) L.push(`• Total due: SAR ${sar(total)}`);
  } else {
    L.push("You have no overdue amounts to date — thank you for your timely payments.");
  }
  const up = i.upcomingDate && !ended && (Number(i.upcomingAmount) || 0) > 0
    && (!i.endDate || i.upcomingDate <= i.endDate) ? i.upcomingDate : null;
  if (up) L.push(`One more instalment of SAR ${sar(Number(i.upcomingAmount))} is due on ${enDate(up)}, before the end of the lease.`);

  L.push("");
  if (i.mode === "nonrenewal") {
    L.push(total > 0
      ? `Please settle the amounts above and arrange to vacate and hand over the unit ${ended ? "as soon as possible" : "before that date"}.`
      : `Please arrange to vacate and hand over the unit ${ended ? "as soon as possible" : "before that date"}.`);
  } else if (ended) {
    L.push("Please contact us as soon as possible to arrange one of the following:");
    L.push("• Renewing the lease, or");
    L.push("• Vacating and handing over the unit.");
  } else {
    L.push("Please let us know your decision before the lease end date:");
    L.push("• Renewing the lease, or");
    L.push("• Not renewing, vacating and handing over the unit.");
  }
  if (total > 0 && i.mode === "end") L.push("Please note that outstanding amounts must be settled before renewal or handover.");

  const tm = i.terms || {};
  const renew: string[] = [];
  if (i.mode === "end" && tm.showRent && (Number(i.annualRent) || 0) > 0) renew.push(`the annual rent will be SAR ${sar(Number(i.annualRent))}`);
  if (i.mode === "end" && (Number(tm.adminFee) || 0) > 0) renew.push(`${renew.length ? "plus an" : "an"} administrative fee of SAR ${sar(Number(tm.adminFee))}${renew.length ? "" : " applies"}`);
  if (renew.length) L.push(`If you wish to renew, ${renew.join(" ")}.`);
  if (i.mode === "end" && tm.noRenewWithArrears && total > 0) L.push("Please note that the lease cannot be renewed while arrears remain.");
  if ((Number(tm.dailyRent) || 0) > 0) {
    const art = tm.dailyArticle ? ` under Article (${tm.dailyArticle}) of the lease` : " as per the lease";
    L.push(`If you do not ${i.mode === "end" ? "renew or " : ""}vacate ${ended ? "immediately" : "before the lease ends"}, a charge of SAR ${sar(Number(tm.dailyRent))} per day of delay applies${art} until the unit is vacated and the keys are handed over.`);
  }
  L.push("", "Kind regards,", i.signer);
  return L.join("\n");
}

/**
 * إشعار تسجيل عداد الكهرباء باسم المستأجر (طلب مكتب، 6 أكتوبر 2026).
 *
 * المكتب يريد أن يُبلَّغ المستأجر كتابةً برقم حساب عداد وحدته، ويُطلب منه
 * تسجيله باسمه لدى الشركة السعودية للكهرباء — «عشان يكون ما لنا حجة»:
 * فاتورة متراكمة على اسم المالك بعد خروج مستأجر لم يسجّل العداد خلاف
 * متكرر. الرسالة نفسها في واتساب هي الإثبات، واللوحة تحفظ تاريخ آخر إرسال.
 */
export type MeterNoticeInput = {
  tenantName: string;
  unitText: string;
  unitTextEn?: string;
  propertyName: string;
  account: string;
  /** المهلة بالأيام — 0 = بلا مهلة */
  days?: number;
  signer: string;
};

export function meterNoticeText(i: MeterNoticeInput): string {
  const days = Math.max(0, Math.round(Number(i.days ?? 7)) || 0);
  const L: string[] = [
    `السلام عليكم ورحمة الله، ${i.tenantName || ""}`.trim(), "",
    `نفيدكم بأن ${i.unitText} بعقار ${i.propertyName} مرتبطة بعداد كهرباء رقم حسابه:`,
    i.account, "",
    `ونأمل منكم تسجيل العداد باسمكم بصفتكم المستأجر لدى الشركة السعودية للكهرباء${days ? ` خلال ${daysPhrase(days)} من تاريخه` : ""}، حتى تصدر فواتير الاستهلاك باسمكم طوال مدة العقد.`,
    "", "ونرجو تزويدنا بما يفيد إتمام التسجيل.",
    "", "شاكرين لكم حسن تعاونكم،", i.signer,
  ];
  return L.join("\n");
}

/**
 * تنبيه تنقيط المكيفات (14 نوفمبر 2026 — من خطاب مكتب «الأولى» الورقي).
 *
 * مياه تصريف المكيف تفيض على الجيران أو الواجهة لانسداد المجاري وإهمال
 * الغسيل الدوري. المكتب يطلب من المستأجر المبادرة بالتنظيف أو تعميد المكتب
 * به على حسابه. رسالة واتساب من صف الوحدة، بتوقيع المكتب.
 */
export type AcDripNoticeInput = {
  tenantName: string;
  unitText: string;
  unitTextEn?: string;
  propertyName: string;
  /** مهلة بالأيام — 0 أو فارغ = «في أقرب وقت» */
  days?: number;
  signer: string;
};
export function acDripNoticeText(i: AcDripNoticeInput): string {
  const d = Math.max(0, Math.floor(Number(i.days) || 0));
  const L = [
    `السلام عليكم ورحمة الله، ${i.tenantName || ""}`.trim(), "",
    `نفيدكم بأن مياه التصريف تفيض من بعض أجهزة التكييف في ${i.unitText} بعقار ${i.propertyName}، وسببها غالبًا انسداد مجاري التصريف وعدم الصيانة.`,
    "وللإحاطة: أجهزة التكييف تحتاج صيانة وغسيلًا دوريًّا لتعمل بالكفاءة المطلوبة، وهو ما يخفّض فاتورة الكهرباء أيضًا.", "",
    `وتجنّبًا للإضرار بالجيران وبالمبنى، نأمل منكم المبادرة بإجراء التنظيف اللازم${d > 0 ? ` خلال ${daysPhrase(d)}` : " في أقرب وقت"}، أو تعميدنا بذلك على أن تتحملوا تكلفته.`,
    "", "شاكرين ومقدّرين تعاونكم،", i.signer,
  ];
  return L.join("\n");
}

/* ============================================================
 * إبلاغ مالك العقار (22 نوفمبر 2026 — طلب مكتب الأولى)
 * عقد الوحدة انتهى (أو عليها متأخرات) والمستأجر لا يتجاوب للسداد أو الإخلاء؛
 * المكتب يبلّغ المالك بواتساب برسالة جاهزة من صف الوحدة، بتوقيع المكتب.
 * الأرقام من حالة العقد كما هي — لا تُحسب هنا.
 * ============================================================ */
export type OwnerAlertInput = {
  ownerName?: string | null;
  tenantName: string;
  unitText: string;
  propertyName: string;
  /** تاريخ انتهاء العقد (ISO) — إن انتهى */
  endDate?: string | null;
  daysToEnd?: number | null;
  hijri?: boolean;
  /** المتأخر شامل الضريبة إن وُجد، وعدد الدفعات المتأخرة */
  overdue: number;
  unpaid: number;
  carried?: number;
  /** ما فعله المكتب: عدد التذكيرات/الإشعارات المرسلة إن أراد ذكره */
  attempts?: string | null;
  signer: string;
};
/** 1 دفعة واحدة · 2 دفعتان · 3–10 دفعات · 11+ دفعة */
const payCount = (n: number) => n === 1 ? "دفعة واحدة" : n === 2 ? "دفعتان" : n >= 3 && n <= 10 ? `${n} دفعات` : `${n} دفعة`;
export function ownerAlertText(i: OwnerAlertInput): string {
  const ended = i.daysToEnd !== null && i.daysToEnd !== undefined && i.daysToEnd < 0 && !!i.endDate;
  const date = i.endDate ? `${arDate(i.endDate)}${i.hijri ? ` (${hijriText(i.endDate)})` : ""}` : "";
  const where = `${i.unitText} بعقار ${i.propertyName}`;
  const owed = Math.max(0, Number(i.overdue) || 0);
  const carried = Math.max(0, Number(i.carried) || 0);
  const L: string[] = [];
  L.push(`السلام عليكم ورحمة الله${i.ownerName ? `، ${i.ownerName}` : ""}`);
  L.push("");
  L.push(`نفيدكم بخصوص ${where}، المستأجر: ${i.tenantName || "—"}:`);
  if (ended) L.push(`• انتهى عقد الإيجار بتاريخ ${date} ولم يُجدَّد.`);
  else if (i.endDate && (i.daysToEnd ?? 0) >= 0) L.push(`• ينتهي عقد الإيجار بتاريخ ${date}.`);
  if (owed > 0) L.push(`• عليه متأخرات ${sar(owed)} ريال (${payCount(i.unpaid)})${carried > 0 ? `، منها ${sar(carried)} ريال مرحَّلة من مدة سابقة` : ""}.`);
  else if (carried > 0) L.push(`• عليه ${sar(carried)} ريال مرحَّلة من مدة سابقة.`);
  L.push(`• تواصلنا معه${i.attempts ? ` (${i.attempts})` : " أكثر من مرة"} ولم يتجاوب للسداد${ended ? " أو الإخلاء" : ""}.`);
  L.push("");
  L.push(ended
    ? "نرجو توجيهكم بالخطوة التالية: الإمهال، أو التجديد بشروط جديدة، أو البدء في إجراءات الإخلاء النظامية."
    : "نرجو توجيهكم بالخطوة التالية: الإمهال، أو إشعاره رسميًّا، أو البدء في الإجراءات النظامية.");
  L.push("");
  L.push("ونبقى على تواصل،");
  L.push(i.signer);
  return L.join("\n");
}

/* ============================================================
 * (24 نوفمبر 2026 — طلب مكتب الأولى) لغة المراسلة: كل رسالة للمستأجر بالعربي والإنجليزي.
 * الأرقام تُحسب في الواجهة (حالة العقد) وتُمرَّر كما هي — النصّان مرآة سطرًا بسطر.
 * ============================================================ */

/** تذكير الدفع — كان يُبنى داخل لوحة العقار؛ نُقل هنا ليشترك فيه العربي والإنجليزي ولوحة المحفظة */
export type ReminderInput = {
  tenantName: string;
  unitText: string; unitTextEn?: string;
  propertyName: string;
  hijri?: boolean;
  /** 0 = لا متأخر: تذكير بالدفعة القادمة */
  unpaid: number;
  nextDueDate: string | null;
  daysToNextDue: number | null;
  upcomingDate?: string | null;
  instalment: number; instalmentVat: number;
  partial?: number;
  owed: number; owedVat?: boolean;
  carried: number;
  endDate?: string | null; daysToEnd?: number | null; expiringSoon?: boolean;
  signer: string;
};

const arDays = (n: number) => n === 1 ? "يوم واحد" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يومًا`;
const hj = (iso: string | null | undefined, on?: boolean) => (on && iso ? ` (${hijriText(iso)})` : "");

export function reminderText(i: ReminderInput): string {
  const unit = i.unitText;
  const L: string[] = [`السلام عليكم ورحمة الله، ${i.tenantName}`, ""];
  if (i.unpaid === 0) {
    if (!i.nextDueDate) L.push(`نودّ التواصل معكم بخصوص عقد ${unit} بعقار ${i.propertyName}.`);
    else L.push(`تذكير ودّي بأن الدفعة القادمة عن ${unit} بعقار ${i.propertyName} تستحق بتاريخ ${arDate(i.nextDueDate)}${hj(i.nextDueDate, i.hijri)}${
      i.daysToNextDue !== null && i.daysToNextDue > 0 ? ` — بعد ${arDays(i.daysToNextDue)}` : i.daysToNextDue === 0 ? " — اليوم" : ""}.`);
    if (i.instalment) L.push(`• دفعة الإيجار: ${sar(i.instalment)} ريال${i.instalmentVat > 0 ? ` (منها ${sar(i.instalmentVat)} ريال ضريبة قيمة مضافة)` : ""}`);
    if (i.carried > 0) L.push(`• ويتبقّى عليكم متأخرات من مدة سابقة: ${sar(i.carried)} ريال`);
  } else {
    L.push(`نودّ تذكيركم بوجود مستحقّات غير مسدَّدة عن ${unit} بعقار ${i.propertyName}، وبيانها:`);
    L.push(`• عدد الدفعات المتأخرة: ${i.unpaid}`);
    if (i.instalment) L.push(`• دفعة الإيجار: ${sar(i.instalment)} ريال`);
    if ((i.partial || 0) > 0) L.push(`• المسدَّد جزئيًّا: ${sar(i.partial!)} ريال`);
    L.push(`• المبلغ المتبقّي${i.owedVat ? " (شامل الضريبة)" : ""}: ${sar(i.owed)} ريال`);
    if (i.carried > 0) {
      L.push(`• متأخرات من مدة سابقة: ${sar(i.carried)} ريال`);
      L.push(`• الإجمالي المطلوب: ${sar(round2(i.owed + i.carried))} ريال`);
    }
    if (i.nextDueDate) L.push(`• مستحقّة منذ: ${arDate(i.nextDueDate)}${hj(i.nextDueDate, i.hijri)}`);
    if (i.upcomingDate) L.push(`• والدفعة القادمة تستحق بتاريخ: ${arDate(i.upcomingDate)}${hj(i.upcomingDate, i.hijri)}`);
  }
  if (i.endDate && i.daysToEnd !== null && i.daysToEnd !== undefined && (i.daysToEnd < 0 || i.expiringSoon)) {
    L.push(`• علمًا بأن العقد ${i.daysToEnd < 0 ? "انتهى" : "ينتهي"} بتاريخ ${arDate(i.endDate)}${hj(i.endDate, i.hijri)}`);
  }
  L.push("", "ويكون السداد بالوسيلة المتفق عليها في العقد.", "",
    "فإن كان السداد قد تم فنعتذر عن التذكير، ونرجو تزويدنا بما يفيد لتحديث السجل.", "",
    "شاكرين لكم حسن تعاونكم،", i.signer);
  return L.join("\n");
}

export function reminderTextEn(i: ReminderInput): string {
  const where = `${i.unitTextEn || i.unitText}, ${i.propertyName}`;
  const L: string[] = [`Dear ${i.tenantName || "tenant"},`, ""];
  if (i.unpaid === 0) {
    if (!i.nextDueDate) L.push(`We would like to contact you regarding the lease for ${where}.`);
    else L.push(`A friendly reminder that your next rent instalment for ${where} is due on ${enDate(i.nextDueDate)}${
      i.daysToNextDue !== null && i.daysToNextDue > 0 ? ` — in ${daysEn(i.daysToNextDue)}` : i.daysToNextDue === 0 ? " — today" : ""}.`);
    if (i.instalment) L.push(`• Instalment amount: SAR ${sar(i.instalment)}${i.instalmentVat > 0 ? ` (incl. SAR ${sar(i.instalmentVat)} VAT)` : ""}`);
    if (i.carried > 0) L.push(`• Balance carried from a previous term: SAR ${sar(i.carried)}`);
  } else {
    L.push(`This is a reminder that the following amounts for ${where} remain unpaid:`);
    L.push(`• Overdue instalments: ${i.unpaid}`);
    if (i.instalment) L.push(`• Instalment amount: SAR ${sar(i.instalment)}`);
    if ((i.partial || 0) > 0) L.push(`• Paid partially: SAR ${sar(i.partial!)}`);
    L.push(`• Remaining amount${i.owedVat ? " (incl. VAT)" : ""}: SAR ${sar(i.owed)}`);
    if (i.carried > 0) {
      L.push(`• Balance carried from a previous term: SAR ${sar(i.carried)}`);
      L.push(`• Total due: SAR ${sar(round2(i.owed + i.carried))}`);
    }
    if (i.nextDueDate) L.push(`• Overdue since: ${enDate(i.nextDueDate)}`);
    if (i.upcomingDate) L.push(`• Next instalment due on: ${enDate(i.upcomingDate)}`);
  }
  if (i.endDate && i.daysToEnd !== null && i.daysToEnd !== undefined && (i.daysToEnd < 0 || i.expiringSoon)) {
    L.push(`• Please note the lease ${i.daysToEnd < 0 ? "ended" : "ends"} on ${enDate(i.endDate)}`);
  }
  L.push("", "Payment is to be made by the method agreed in the lease.", "",
    "If you have already paid, please accept our apologies and send us proof of payment so we can update our records.", "",
    "Thank you for your cooperation,", i.signer);
  return L.join("\n");
}

export function meterNoticeTextEn(i: MeterNoticeInput): string {
  const days = Math.max(0, Math.round(Number(i.days ?? 7)) || 0);
  return [
    `Dear ${i.tenantName || "tenant"},`, "",
    `Please note that ${i.unitTextEn || i.unitText}, ${i.propertyName}, is linked to an electricity meter with account number:`,
    i.account, "",
    `We kindly ask you to register this meter in your name, as the tenant, with the Saudi Electricity Company${days ? ` within ${daysEn(days)} from today` : ""}, so that consumption bills are issued in your name for the duration of the lease.`,
    "", "Please send us confirmation once the registration is complete.",
    "", "Thank you for your cooperation,", i.signer,
  ].join("\n");
}

export function acDripNoticeTextEn(i: AcDripNoticeInput): string {
  const d = Math.max(0, Math.floor(Number(i.days) || 0));
  return [
    `Dear ${i.tenantName || "tenant"},`, "",
    `We would like to inform you that drain water is overflowing from some air-conditioning units in ${i.unitTextEn || i.unitText}, ${i.propertyName}, usually because the drain lines are blocked and the units have not been serviced.`,
    "Air conditioners need regular servicing and cleaning to work efficiently, which also lowers the electricity bill.", "",
    `To avoid damage to the neighbours and the building, we kindly ask you to have the units cleaned${d > 0 ? ` within ${daysEn(d)}` : " as soon as possible"}, or to authorise us to arrange it at your expense.`,
    "", "Thank you for your cooperation,", i.signer,
  ].join("\n");
}

/** إرسال سند القبض واتساب */
export type ReceiptMsgInput = { tenantName: string; amount: number; paidOn: string; receiptNo?: string | null; url: string; signer: string };
export const receiptMsg = (i: ReceiptMsgInput) => [`السلام عليكم ${i.tenantName}،`,
  `استلمنا ${sar(Number(i.amount))} ريال بتاريخ ${arDate(i.paidOn)}${i.receiptNo ? ` — سند قبض رقم ${i.receiptNo}` : ""}.`,
  `سند القبض: ${i.url}`, "", `شاكرين لكم، ${i.signer}`].join("\n");
export const receiptMsgEn = (i: ReceiptMsgInput) => [`Dear ${i.tenantName || "tenant"},`,
  `We have received SAR ${sar(Number(i.amount))} on ${enDate(i.paidOn)}${i.receiptNo ? ` — receipt no. ${i.receiptNo}` : ""}.`,
  `Payment receipt: ${i.url}`, "", `Thank you, ${i.signer}`].join("\n");

/** رابط صفحة المستأجر الخاصة */
export type PortalMsgInput = { tenantName: string; unitText: string; unitTextEn?: string; propertyName: string; url: string; signer?: string };
export const portalLinkMsg = (i: PortalMsgInput) => [`السلام عليكم ${i.tenantName}،`, "",
  `هذه صفحتك الخاصة لعقد ${i.unitText} في ${i.propertyName}: الدفعة القادمة وسجل دفعاتك، ومنها تبلّغنا عن حوالتك أو عن أي عطل.`,
  i.url, "", "الرابط خاص بك — لا تشاركه.", ...(i.signer ? [i.signer] : [])].join("\n");
export const portalLinkMsgEn = (i: PortalMsgInput) => [`Dear ${i.tenantName || "tenant"},`, "",
  `This is your private page for the lease of ${i.unitTextEn || i.unitText}, ${i.propertyName}: your next instalment and payment history. You can also use it to tell us about a transfer you made or report a maintenance issue.`,
  i.url, "", "This link is personal — please do not share it.", ...(i.signer ? [i.signer] : [])].join("\n");

/** دين على مستأجر سابق أو مرحَّل */
export type PastDebtMsgInput = { name: string; propertyName: string; unit?: string | null; amount: number; signer?: string | null };
export const pastDebtMsg = (i: PastDebtMsgInput) =>
  `السلام عليكم ورحمة الله، ${i.name}\n\n`
  + `بخصوص مبلغ متبقٍّ بذمتكم عن ${i.propertyName}${i.unit ? ` — وحدة ${i.unit}` : ""} بمقدار ${sar(i.amount)} ريال.\n`
  + `نرجو التكرم بسداده أو تحديد موعد يناسبكم.\n\n`
  + `وإن كان السداد قد تم فنعتذر عن التذكير، ونرجو تزويدنا بما يفيد لتحديث السجل.\n\n`
  + `شاكرين لكم حسن تعاونكم،\n${i.signer || ""}`;
export const pastDebtMsgEn = (i: PastDebtMsgInput) =>
  `Dear ${i.name || "tenant"},\n\n`
  + `This is regarding an outstanding balance of SAR ${sar(i.amount)} for ${i.propertyName}${i.unit ? ` — unit ${i.unit}` : ""}.\n`
  + `We kindly ask you to settle it or let us know a date that suits you.\n\n`
  + `If you have already paid, please accept our apologies and send us proof of payment so we can update our records.\n\n`
  + `Thank you for your cooperation,\n${i.signer || ""}`;
