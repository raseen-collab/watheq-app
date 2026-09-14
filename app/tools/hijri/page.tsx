import HijriScheduleTool from "@/components/HijriScheduleTool";

export const metadata = {
  title: "حاسبة جدول دفعات الإيجار بالتقويم الهجري — مجانية | وثيق",
  description:
    "أدخل تاريخ بداية العقد الهجري ودورة السداد، واحصل على جدول الدفعات بالتاريخين الهجري والميلادي. مجانية وبلا تسجيل، وتُظهر كم ينزاح جدولك لو حُسب بالأشهر الميلادية.",
  keywords: ["جدول دفعات إيجار", "تقويم هجري", "عقد إيجار هجري", "حساب أقساط الإيجار", "إدارة أملاك"],
  openGraph: {
    title: "حاسبة جدول دفعات الإيجار بالهجري — مجانية بلا تسجيل",
    description: "جدول دفعات عقدك بالتاريخين، وكم ينزاح لو حُسب ميلاديًّا.",
    type: "website",
  },
};

/**
 * صفحة عامة تمامًا: لا جلسة ولا قاعدة ولا خادم لكل زائر.
 * ثابتة (static) فتُخدَّم من الحافة — تتحمّل موجة زيارات من منشور واحد
 * بلا تكلفة ولا بطء.
 */
export const dynamic = "force-static";

export default function HijriToolPage() {
  return <HijriScheduleTool />;
}
