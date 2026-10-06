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
};

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
    if (carried > 0) L.push(`• دين مرحَّل من مدة سابقة: ${sar(carried)} ريال`);
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

  L.push("", "شاكرين لكم حسن تعاونكم،", i.signer);
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
