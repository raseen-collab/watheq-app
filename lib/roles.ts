// ============================================================
// أدوار الحسابات والتوجيه — مصدر الحقيقة الوحيد
// ============================================================

export type AccountType = "hoa_manager" | "landlord" | "both";
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
  return false;
}

/** هل يستطيع التبديل بين اللوحتين؟ */
export const canSwitch = (accountType?: string | null) => accountType === "both";

/** اللوحة الافتراضية عند الدخول */
export function defaultDashboard(
  accountType: string | null | undefined,
  lastUsed?: string | null
): Dashboard {
  if (accountType === "landlord") return "property";
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
