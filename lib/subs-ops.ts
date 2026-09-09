// ============================================================
// وثيق — تشغيل الاشتراكات
//
// البنية موجودة (فترة سماح 5 أيام · تنبيهات للمشترك · تسجيل تجديد · فاتورة)
// والناقص هو التشغيل: من أتواصل معه اليوم، وبماذا أخاطبه.
//
// المبدأ: التجديد لا يحدث لأن النظام قطع الخدمة، بل لأن أحدًا ذكّر في وقته.
// أول تذكير قبل 7 أيام، والحاسم يوم الانتهاء، وأخير في اليوم الرابع من السماح.
// ============================================================

import { subState, GRACE_DAYS, SOON_DAYS, type SubProfile } from "./subscription";

export type SubAccount = SubProfile & {
  id: string;
  org_name?: string | null;
  full_name?: string | null;
  billing_phone?: string | null;
  units?: number;
  properties?: number;
  last_active?: string | null;
};

/** مرحلة التواصل — تحدد الرسالة وأولوية العرض */
export type Stage = "expired" | "grace" | "due_today" | "due_soon" | "trial_ending" | "ok";

export const STAGE_META: Record<Stage, { label: string; icon: string; rank: number; cls: string }> = {
  expired:      { label: "انتهى وخرج من السماح", icon: "🔴", rank: 0, cls: "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]" },
  grace:        { label: "في فترة السماح",       icon: "🟠", rank: 1, cls: "bg-[#FDECD2] text-[#9A4B00] border-[#F5CFA0]" },
  due_today:    { label: "ينتهي اليوم أو غدًا",   icon: "🟡", rank: 2, cls: "bg-[#FBF1DF] text-[#8a5a11] border-[#EAD9A8]" },
  due_soon:     { label: `ينتهي خلال ${SOON_DAYS} أيام`, icon: "🔵", rank: 3, cls: "bg-[#EEF4FB] text-[#2B5C8A] border-[#CFE0F0]" },
  trial_ending: { label: "تجربة تنتهي قريبًا",   icon: "🎁", rank: 4, cls: "bg-[#F1EBFC] text-[#5B21B6] border-[#D9CEF6]" },
  ok:           { label: "ساري",                 icon: "✅", rank: 5, cls: "bg-[#E6F4EC] text-[#137a50] border-[#CDE7D8]" },
};

/** المرحلة التي يقف عندها الحساب اليوم */
export function stageOf(a: SubAccount): { stage: Stage; days: number | null } {
  const s = subState(a);
  if (s.grace) return { stage: "grace", days: s.graceDaysLeft };
  if (s.planPaid && s.expired) return { stage: "expired", days: s.subDaysLeft };
  if (s.paid && s.subDaysLeft !== null) {
    if (s.subDaysLeft <= 1) return { stage: "due_today", days: s.subDaysLeft };
    if (s.subDaysLeft <= SOON_DAYS) return { stage: "due_soon", days: s.subDaysLeft };
    return { stage: "ok", days: s.subDaysLeft };
  }
  if (s.trial && s.trialDaysLeft !== null && s.trialDaysLeft <= 7) return { stage: "trial_ending", days: s.trialDaysLeft };
  return { stage: s.trial ? "ok" : "expired", days: s.trialDaysLeft };
}

/** قائمة العمل: من يحتاج تواصلًا اليوم، مرتَّبًا بالإلحاح */
export function actionList(accounts: SubAccount[]): { a: SubAccount; stage: Stage; days: number | null }[] {
  return accounts
    .map((a) => ({ a, ...stageOf(a) }))
    .filter((x) => x.stage !== "ok")
    .sort((x, y) => STAGE_META[x.stage].rank - STAGE_META[y.stage].rank || (x.days ?? 0) - (y.days ?? 0));
}

/** صيغة المدة — والسالب يعني «منذ» لا «سالب تسعة أيام» */
const nDays = (n: number | null): string => {
  if (n === null) return "";
  if (n < 0) return `منذ ${nDays(Math.abs(n))}`;
  if (n === 0) return "اليوم";
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومين";
  return n <= 10 ? `${n} أيام` : `${n} يومًا`;
};

/**
 * الرسالة المناسبة لكل مرحلة.
 *
 * ثلاث قواعد تعلّمتها من الرسائل التي رُدّ عليها:
 * لا تبدأ بالمطالبة · اذكر ما يخسره لا ما تكسبه أنت · واجعل الردّ خطوة واحدة.
 */
export function renewalMessage(a: SubAccount, stage: Stage, days: number | null): string {
  const who = a.org_name || a.full_name || "أستاذ";
  const size = a.units ? `\n(حسابك فيه ${a.units} وحدة${a.properties ? ` في ${a.properties} عقارات` : ""} — كلها محفوظة كما هي.)` : "";
  switch (stage) {
    case "due_soon":
      return `السلام عليكم ${who}\n\nاشتراكك في وثيق ينتهي بعد ${nDays(days)}.\nحبيت أذكّرك قبل الموعد عشان ما ينقطع شي.${size}\n\nتحب أجدّده لك؟ قل لي المدة وأرسل لك التفاصيل.`;
    case "due_today":
      return `السلام عليكم ${who}\n\nاشتراكك ينتهي ${days !== null && days <= 0 ? "اليوم" : "غدًا"}.\nبعد الانتهاء عندك ${GRACE_DAYS} أيام كل شي فيها يشتغل عادي، وبعدها تطلع المستندات بعلامة «نسخة تجريبية».${size}\n\nأجدّده لك الحين؟`;
    case "grace":
      return `السلام عليكم ${who}\n\nانتهى اشتراكك، وأنت الحين في فترة السماح — باقي ${nDays(days)} وكل المزايا شغّالة.\nبعدها المستندات تطلع بعلامة «نسخة تجريبية» (بياناتك تبقى كاملة ولا يضيع منها شي).${size}\n\nقل لي وأجدّده لك اليوم.`;
    case "expired":
      return `السلام عليكم ${who}\n\nاشتراكك منتهي من فترة، والمستندات صارت تطلع بعلامة «نسخة تجريبية».\nبياناتك كلها محفوظة زي ما هي — يوم تجدّد يرجع كل شي في ثانية.${size}\n\nتحب نجدّد؟ ولا فيه شي ما ناسبك في النظام؟ قل لي بصراحة وأنا أستفيد.`;
    case "trial_ending":
      return `السلام عليكم ${who}\n\nتجربتك المجانية تنتهي بعد ${nDays(days)}.${size}\n\nكيف كانت التجربة؟ وإذا فيه شي ناقص قل لي وأضبطه.\nوإن ناسبك النظام أجهّز لك الاشتراك.`;
    default:
      return `السلام عليكم ${who}\n\nكيف الأمور معك في وثيق؟ إن احتجت أي شي أنا موجود.`;
  }
}

/** رابط واتساب جاهز بالرسالة */
export function renewalWaLink(a: SubAccount, stage: Stage, days: number | null): string | null {
  const raw = String(a.billing_phone || "").replace(/\D/g, "");
  if (!raw) return null;
  const intl = raw.startsWith("966") ? raw : raw.startsWith("0") ? "966" + raw.slice(1) : "966" + raw;
  return `https://wa.me/${intl}?text=${encodeURIComponent(renewalMessage(a, stage, days))}`;
}

/** ملخّص للتنبيه اليومي في تليجرام */
export function subsDigest(accounts: SubAccount[]): string | null {
  const list = actionList(accounts);
  if (!list.length) return null;
  const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const group = (st: Stage) => list.filter((x) => x.stage === st);
  const line = (x: { a: SubAccount; stage: Stage; days: number | null }) =>
    `• <b>${esc(x.a.org_name || x.a.full_name || "حساب")}</b>${x.a.units ? ` — ${x.a.units} وحدة` : ""}${x.days !== null ? ` — ${x.stage === "expired" ? nDays(x.days) : `باقٍ ${nDays(x.days)}`}` : ""}`;

  const parts: string[] = ["💳 <b>الاشتراكات — تحتاج تواصلًا</b>"];
  ([["expired", "انتهت وخرجت من السماح"], ["grace", "في فترة السماح"],
    ["due_today", "تنتهي اليوم أو غدًا"], ["due_soon", `تنتهي خلال ${SOON_DAYS} أيام`],
    ["trial_ending", "تجارب تنتهي قريبًا"]] as [Stage, string][])
    .forEach(([st, title]) => {
      const g = group(st);
      if (g.length) parts.push("", `${STAGE_META[st].icon} <b>${title} (${g.length})</b>`, ...g.slice(0, 8).map(line));
    });
  return parts.join("\n");
}
