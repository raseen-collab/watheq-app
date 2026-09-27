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

/** تسمية عربية مختصرة للوحة الإدارة */
export const sourceAdminLabel = (v?: string | null): string =>
  ALL_SOURCES.find((s) => s.v === v)?.adminLabel || "غير معروف";

/** تسمية كاملة كما تُعرض للمستخدم */
export const sourceLabel = (v?: string | null): string =>
  ALL_SOURCES.find((s) => s.v === v)?.l || "—";
