"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { trialDaysLeft } from "@/lib/domain";

export default function DashboardShell({
  userName, role, trialEndsAt, children,
}: {
  userName: string;
  role: "association" | "property";
  trialEndsAt?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const days = trialDaysLeft(trialEndsAt);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // الواجهة معيارية: روابط الدور فقط — لا مبدّل بين عالمين مختلفين
  const nav = role === "property"
    ? [
        { href: "/dashboard/property", label: "عقاراتي" },
        { href: "/dashboard/property/import", label: "رفع من Excel" },
      ]
    : [
        { href: "/dashboard/association", label: "جمعيتي" },
      ];

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-deep text-[#EAF1EE]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <a href="https://watheqapp.netlify.app" className="flex items-center gap-2.5 font-display font-bold hover:opacity-90" title="العودة إلى موقع وثيق">
            <span className="w-8 h-8 rounded-lg bg-deep2 grid place-items-center text-goldSoft">و</span>
            <div>
              <div>وثيق</div>
              <div className="text-[.65rem] font-normal text-[#9FB8B3] -mt-1">
                {role === "property" ? "إدارة الأملاك" : "جمعية الملاك"}
              </div>
            </div>
          </a>

          <nav className="inline-flex bg-white/10 border border-white/15 rounded-xl p-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                  pathname === n.href ? "bg-goldSoft text-deep2" : "text-[#CFE0DB] hover:bg-white/10"
                }`}>
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 text-sm">
            <Link href="/settings" className="text-[#CFE0DB] hover:text-white text-sm" title="الإعدادات">الإعدادات</Link>
            <span className="text-[#9FB8B3] hidden sm:inline max-w-[140px] truncate">{userName}</span>
            <button onClick={signOut} className="btn text-sm bg-white/10 text-[#EAF1EE] hover:bg-white/20 border border-white/15">خروج</button>
          </div>
        </div>
      </header>

      {days !== null && days <= 30 && (
        <div className={`text-center text-sm py-2 px-4 ${
          days <= 5 ? "bg-[#FBE9E7] text-[#8f2b26] border-b border-[#F5C6C2]"
                    : "bg-[#FBF1DF] text-[#8a5a11] border-b border-[#EBD9AA]"}`}>
          {days > 0
            ? <>🎁 تجربتك المجانية — متبقٍ <b>{days}</b> يومًا من أصل ٣٠. كل المزايا مفعّلة.</>
            : <>انتهت تجربتك المجانية. <a href="https://wa.me/966596300591" target="_blank" rel="noreferrer" className="underline font-bold">راسلنا لتفعيل اشتراكك</a></>}
        </div>
      )}

      <main className="max-w-6xl mx-auto p-4">{children}</main>

      <footer className="max-w-6xl mx-auto px-4 pb-8 text-center text-xs text-muted leading-relaxed">
        وثيق أداة تنظيمية تُنشئ <b>نماذج خطابات تذكير وإشعارات</b> لتستخدمها بنفسك.
        لا نقدّم خدمات قانونية، ولا نرفع دعاوى، ولا نستلم أو نحوّل أي مبالغ — التحصيل يتم بينك وبين الطرف الآخر مباشرة.
      </footer>
    </div>
  );
}
