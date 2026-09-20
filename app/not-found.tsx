import Link from "next/link";

export const metadata = { title: "الصفحة غير موجودة — وثيق" };

/**
 * صفحة 404 بهوية المنتج.
 *
 * كانت صفحة Next الافتراضية: «This page could not be found» بالإنجليزية
 * واتجاه LTR وخط النظام، بلا شريط ولا رابط رجوع — فأي رابط قديم أو
 * مكتوب خطأ يُسقط المكتب في طريق مسدود لا يفهمه.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-paper grid place-items-center p-6" dir="rtl">
      <div className="w-full max-w-md text-center">
        <div className="w-14 h-14 rounded-2xl bg-deep grid place-items-center text-goldSoft font-display font-bold text-2xl mx-auto mb-5">و</div>
        <h1 className="font-display font-bold text-deep text-2xl mb-2">الصفحة غير موجودة</h1>
        <p className="text-sm text-muted leading-relaxed mb-6">
          الرابط الذي فتحته لم يعد موجودًا أو كُتب خطأً. بياناتك سليمة ولم يتغيّر منها شيء.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link href="/dashboard/property" className="btn btn-gold">← العودة للوحة</Link>
          <Link href="/dashboard/property/overview" className="btn btn-ghost">نظرة عامة</Link>
        </div>
        <p className="text-[11px] text-muted mt-8">
          إن وصلت هنا من رابط داخل وثيق، أخبرنا على واتساب 0596300591 لنصلحه.
        </p>
      </div>
    </main>
  );
}
