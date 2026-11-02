// ============================================================
// أدوار الحسابات والتوجيه — مصدر الحقيقة الوحيد
// ============================================================

/**
 * marketer (2 نوفمبر 2026): «مسوّق عقاري» — فرد يسوّق عقارات غيره بلا وحدات
 * مؤجّرة. يرى من لوحة الأملاك صفحة المعروضات والطلبات وحدها، وباقته واحدة
 * سنوية (lib/pricing.ts MARKETER_YEARLY). لا موظفين: مكتب يريد فريقًا يأخذ
 * باقة المكتب.
 */
export type AccountType = "hoa_manager" | "landlord" | "both" | "marketer";
export type Dashboard = "association" | "property";

export const ACCOUNT_TYPES: {
  value: AccountType; label: string; short: string; icon: string; desc: string; points: string[];
}[] = [
  {
    value: "landlord",
    label: "مالك عقار أو مكتب إدارة أملاك",
    short: "إدارة الأملاك",
    icon: "🏢",
    desc: "أدير عقارات ووحدات مؤجّرة",
    points: [
      "عقود بدورات سداد مرنة وتجديد تلقائي",
      "عمائر، معارض، مكاتب، مستودعات، أراضٍ",
      "كشوف حساب وفواتير مرقّمة",
    ],
  },
  {
    value: "hoa_manager",
    label: "مدير جمعية ملاك",
    short: "جمعيات الملاك",
    icon: "🏗️",
    desc: "أدير اتحاد ملاك عمارة أو مجمّع",
    points: [
      "محاضر اجتماعات وموازنات جاهزة",
      "اشتراكات الصيانة ورصيد الصندوق",
      "تنبيه انتهاء شهادة الجمعية",
    ],
  },
  {
    value: "marketer",
    label: "مسوّق عقاري",
    short: "المسوّق العقاري",
    icon: "📣",
    desc: "أسوّق عقارات للبيع والإيجار وأتابع طلبات الزبائن",
    points: [
      "سجل معروضات بصور ورابط عام لكل عقار",
      "طلبات الزبائن ومطابقتها تلقائيًّا بالمعروضات",
      "إعلان جاهز لحراج وX وواتساب بضغطة",
    ],
  },
  {
    value: "both",
    label: "الاثنان معًا",
    short: "حساب مزدوج",
    icon: "🔀",
    desc: "أدير أملاكًا وجمعية ملاك في آنٍ واحد",
    points: [
      "لوحتان منفصلتان في حساب واحد",
      "تبديل فوري بينهما من الشريط العلوي",
      "كل بياناتك معزولة ومنظّمة",
    ],
  },
];

export const accountLabel = (t?: string | null) =>
  ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? "غير محدّد";

/** هل يملك هذا الحساب صلاحية لوحة معيّنة؟ */
export function canAccess(accountType: string | null | undefined, dash: Dashboard): boolean {
  if (accountType === "both") return true;
  if (accountType === "landlord") return dash === "property";
  if (accountType === "hoa_manager") return dash === "association";
  if (accountType === "marketer") return dash === "property";   // المعروضات تحت لوحة الأملاك
  return false;
}

/** المسوّق العقاري: لوحة الأملاك مختصرة على المعروضات والطلبات */
export const isMarketer = (accountType?: string | null) => accountType === "marketer";

/** المسار الذي يُفتح عليه الحساب أول ما يدخل */
export function homePath(accountType: string | null | undefined, lastUsed?: string | null): string {
  if (isMarketer(accountType)) return "/dashboard/property/listings";
  return dashboardPath(defaultDashboard(accountType, lastUsed));
}

/** صفحات لوحة الأملاك المتاحة للمسوّق — ما عداها يُحوَّل إلى المعروضات */
export const MARKETER_PATHS = ["/dashboard/property/listings"];
export const marketerAllowed = (path: string) => MARKETER_PATHS.some((p) => path === p || path.startsWith(p + "/"));

/** هل يستطيع التبديل بين اللوحتين؟ */
export const canSwitch = (accountType?: string | null) => accountType === "both";

/** اللوحة الافتراضية عند الدخول */
export function defaultDashboard(
  accountType: string | null | undefined,
  lastUsed?: string | null
): Dashboard {
  if (accountType === "landlord" || accountType === "marketer") return "property";
  if (accountType === "hoa_manager") return "association";
  if (accountType === "both") {
    // الحساب المزدوج يعود لآخر لوحة استخدمها
    return lastUsed === "association" ? "association" : "property";
  }
  return "property";
}

export const dashboardPath = (d: Dashboard) =>
  d === "association" ? "/dashboard/association" : "/dashboard/property";

/** اللوحة المقابلة (للتبديل) */
export const otherDashboard = (d: Dashboard): Dashboard =>
  d === "association" ? "property" : "association";

/** توافق خلفي: تحويل role القديم إلى account_type */
export function normalizeAccountType(profile: { account_type?: string | null; role?: string | null }): AccountType | null {
  if (profile.account_type) return profile.account_type as AccountType;
  if (profile.role === "association") return "hoa_manager";
  if (profile.role === "property") return "landlord";
  return null;
}
