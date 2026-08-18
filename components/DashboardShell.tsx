"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { trialDaysLeft } from "@/lib/domain";
import type { AccountType } from "@/lib/roles";
import type { SubState } from "@/lib/subscription";

export default function DashboardShell({
  userName, accountType, showSwitcher, trialEndsAt, sub, children,
}: {
  userName: string;
  accountType: AccountType;
  showSwitcher: boolean;
  trialEndsAt?: string | null;
  sub?: SubState;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const days = trialDaysLeft(trialEndsAt);
  // كل لوحة لها مستشارها الخاص، فالمسار نفسه يحدّد اللوحة — بلا استثناءات
  const onProperty = pathname.includes("/property");
  const current = onProperty ? "property" : "association";

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // روابط اللوحة الحالية فقط — لا تزاحم بين عالمين
  const nav = onProperty
    ? [
        { href: "/dashboard/property", label: "عقاراتي" },
        { href: "/dashboard/property/listings", label: "📋 المعروضات" },
        { href: "/dashboard/property/import", label: "رفع Excel" },
        { href: "/dashboard/property/advisor", label: "🧠 المستشار" },
      ]
    : [
        { href: "/dashboard/association", label: "جمعيتي" },
        { href: "/dashboard/association/advisor", label: "🧠 المستشار" },
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
                {onProperty ? "إدارة الأملاك" : "جمعية الملاك"}
              </div>
            </div>
          </a>

          <div className="flex items-center gap-2 flex-wrap">
            {/* مبدّل اللوحتين — للحساب المزدوج فقط */}
            {showSwitcher && (
              <div className="inline-flex bg-white/10 border border-white/15 rounded-xl p-1" role="tablist" aria-label="تبديل اللوحة">
                <Link href="/dashboard/property" role="tab" aria-selected={onProperty}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                    onProperty ? "bg-goldSoft text-deep2" : "text-[#CFE0DB] hover:bg-white/10"}`}>
                  🏢 الأملاك
                </Link>
                <Link href="/dashboard/association" role="tab" aria-selected={!onProperty}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                    !onProperty ? "bg-goldSoft text-deep2" : "text-[#CFE0DB] hover:bg-white/10"}`}>
                  🏗️ الجمعية
                </Link>
              </div>
            )}

            {/* روابط اللوحة الحالية */}
            <nav className="inline-flex bg-white/5 border border-white/10 rounded-xl p-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                    pathname === n.href ? "bg-white/15 text-white" : "text-[#CFE0DB] hover:bg-white/10"}`}>
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Link href="/settings" className="text-[#CFE0DB] hover:text-white text-sm">الإعدادات</Link>
            <span className="text-[#9FB8B3] hidden sm:inline max-w-[130px] truncate">{userName}</span>
            <button onClick={signOut} className="btn text-sm bg-white/10 text-[#EAF1EE] hover:bg-white/20 border border-white/15">خروج</button>
          </div>
        </div>
      </header>

      {sub?.kind === "paid_soon" && (
        <div className="text-center text-sm py-2 px-4 bg-[#FBF1DF] text-[#8a5a11] border-b border-[#EBD9AA]">
          اشتراكك ينتهي بعد <b>{sub.subDaysLeft}</b> يومًا.{" "}
          <a href="https://wa.me/966596300591?text=%D8%A3%D8%A8%D8%BA%D9%89%20%D8%A3%D8%AC%D8%AF%D8%AF%20%D8%A7%D8%B4%D8%AA%D8%B1%D8%A7%D9%83%D9%8A%20%D9%81%D9%8A%20%D9%88%D8%AB%D9%8A%D9%82" target="_blank" rel="noreferrer" className="underline font-bold">جدّد الآن</a>
        </div>
      )}

      {sub?.expired && (
        <div className="text-center text-sm py-2 px-4 bg-[#FBE9E7] text-[#8f2b26] border-b border-[#F5C6C2]">
          {sub.planPaid
            ? <>انتهى اشتراكك — المستندات تُطبع بعلامة «نسخة تجريبية» وحصة المستشار ٣ أسئلة يوميًا. </>
            : <>انتهت تجربتك المجانية. </>}
          <a href="https://wa.me/966596300591?text=%D8%A3%D8%A8%D8%BA%D9%89%20%D8%A3%D8%AC%D8%AF%D8%AF%20%D8%A7%D8%B4%D8%AA%D8%B1%D8%A7%D9%83%D9%8A%20%D9%81%D9%8A%20%D9%88%D8%AB%D9%8A%D9%82" target="_blank" rel="noreferrer" className="underline font-bold">راسلنا للتفعيل</a>
        </div>
      )}

      {sub?.trial && days !== null && days <= 30 && days > 0 && (
        <div className={`text-center text-sm py-2 px-4 ${
          days <= 5 ? "bg-[#FBE9E7] text-[#8f2b26] border-b border-[#F5C6C2]"
                    : "bg-[#FBF1DF] text-[#8a5a11] border-b border-[#EBD9AA]"}`}>
          🎁 تجربتك المجانية — متبقٍ <b>{days}</b> يومًا من أصل ٣٠. كل المزايا مفعّلة.
        </div>
      )}

      <main className="max-w-6xl mx-auto p-4">{children}</main>

      <footer className="max-w-6xl mx-auto px-4 pb-8 text-center text-xs text-muted leading-relaxed">
        وثيق أداة تنظيمية تُنشئ <b>نماذج خطابات تذكير وإشعارات</b> لتستخدمها بنفسك.
        لا نقدّم خدمات قانونية، ولا نرفع دعاوى، ولا نستلم أو نحوّل أي مبالغ.
        <br />
        <a href="https://t.me/+966550165210" target="_blank" rel="noreferrer" className="text-gold font-semibold">تليجرام</a>
        {" · "}
        <a href="mailto:watheqdocs@gmail.com" className="text-gold font-semibold">watheqdocs@gmail.com</a>
      </footer>
    </div>
  );
}
