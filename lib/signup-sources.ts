/**
 * مصادر التسجيل — التعريف الواحد الذي تشترك فيه صفحة الدخول ولوحة الإدارة.
 *
 * السبب: كانت القائمة مكتوبة مرتين (صفحة الدخول للاختيار والتحقق، ولوحة
 * الإدارة للتسمية) فاختلفتا: رابط الديمو يرسل `?src=demo` وهي قيمة صحيحة
 * لكنها غير موجودة في أي من القائمتين، فكانت تُرمى بصمت في صفحة الدخول
 * وتُعرض «غير معروف» في اللوحة. القيمة الواحدة هنا تُغلق البابين معًا.
 *
 * بلا كوكيز ولا تتبّع: القيمة تأتي من اختيار المستخدم أو من معامل في
 * الرابط الذي نشرناه نحن — لا من بصمة متصفح ولا من طرف ثالث.
 */

export type SignupSource = { v: string; l: string; adminLabel: string };

/** ما يختاره المستخدم بنفسه من القائمة المنسدلة */
export const CHOSEN_SOURCES: SignupSource[] = [
  { v: "haraj",    l: "حراج",                      adminLabel: "حراج" },
  { v: "group",    l: "قروب واتساب أو تليجرام",     adminLabel: "قروب" },
  { v: "twitter",  l: "تويتر / X",                  adminLabel: "تويتر" },
  { v: "search",   l: "بحث في جوجل",                adminLabel: "بحث جوجل" },
  { v: "referral", l: "توصية من شخص",               adminLabel: "توصية" },
  { v: "direct",   l: "تواصل مباشر معكم",           adminLabel: "تواصل مباشر" },
  { v: "other",    l: "مصدر آخر",                   adminLabel: "أخرى" },
];

/**
 * قيم تأتي من روابطنا فقط ولا تُعرض في القائمة.
 * «جرّب الديمو ثم سجّل» ليس جوابًا يختاره إنسان عن «كيف عرفت عنا؟» — هو
 * واقعة نعرفها من الرابط نفسه. ولذلك تُقبل في التحقق وتُسمّى في اللوحة
 * دون أن تزحم القائمة بخيار لا معنى له للزائر.
 */
export const LINK_SOURCES: SignupSource[] = [
  { v: "demo", l: "النسخة التجريبية", adminLabel: "النسخة التجريبية" },
];

/** «أفضّل عدم الذكر» — تُحفظ عند ترك الحقل فارغًا، ولا تُعرض كخيار مكرَّر */
export const SKIP_SOURCE: SignupSource = { v: "skip", l: "أفضّل عدم الذكر", adminLabel: "لم يذكر" };

export const ALL_SOURCES: SignupSource[] = [...CHOSEN_SOURCES, ...LINK_SOURCES, SKIP_SOURCE];

/** هل هذه قيمة مصدر معروفة؟ يُستعمل للتحقق من `?src=` ومن جسم أي طلب */
export const isSignupSource = (v?: string | null): boolean =>
  !!v && ALL_SOURCES.some((s) => s.v === v);

/**
 * استنتاج المصدر من الصفحة التي جاء منها الزائر (`document.referrer`).
 *
 * لماذا: من يدخل بحساب قوقل لا يمرّ بقائمة «كيف عرفت عنا؟» أصلًا، ومن يصل
 * من بحث جوجل لا يحمل `?src=`. فبقي أكبر حساب على المنصة بلا مصدر، وقناةٌ
 * لا تُقاس لا تُضاعَف.
 *
 * ما لا تفعله: لا تخمّن. النطاق الذي لا نعرفه يعود فارغًا لا «أخرى» —
 * مصدر خاطئ أسوأ من مصدر مجهول لأنه يُبنى عليه قرار.
 *
 * ⚠️ نسخة مطابقة من هذا المنطق تعمل في سكربت الموقع التسويقي
 * (watheqapp.com، قبل `</body>` في كل صفحة). المستودعان منفصلان فلا يمكن
 * استيراد واحد من الآخر — إن غيّرت الخرائط هنا فغيّرها هناك، والاختبار
 * `tests/signup-sources.js` يحرس هذه الحالات.
 */
export function sourceFromReferrer(ref?: string | null): string {
  if (!ref) return "";
  let h = "";
  try { h = new URL(ref).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
  if (h === "watheqapp.com" || h.endsWith(".watheqapp.com")) return "";  // من موقعنا: لا جديد
  const L = h.split(".");
  const has = (x: string) => L.includes(x);
  if (has("google") || has("bing") || has("duckduckgo") || has("yandex") || has("ecosia")
      || h.startsWith("search.yahoo.")) return "search";
  if (has("twitter") || h === "x.com" || h === "t.co") return "twitter";
  if (has("haraj")) return "haraj";
  if (has("whatsapp") || h === "wa.me" || has("telegram") || h === "t.me") return "group";
  return "";
}

/** تسمية عربية مختصرة للوحة الإدارة */
export const sourceAdminLabel = (v?: string | null): string =>
  ALL_SOURCES.find((s) => s.v === v)?.adminLabel || "غير معروف";

/** تسمية كاملة كما تُعرض للمستخدم */
export const sourceLabel = (v?: string | null): string =>
  ALL_SOURCES.find((s) => s.v === v)?.l || "—";
