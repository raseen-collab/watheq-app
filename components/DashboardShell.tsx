"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";

export default function DashboardShell({ userName, children }: { userName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const mode = pathname.includes("/property") ? "property" : "association";

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-deep text-[#EAF1EE]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5 font-display font-bold">
            <span className="w-8 h-8 rounded-lg bg-deep2 grid place-items-center text-goldSoft">و</span>
            <div>
              <div>وثيق</div>
              <div className="text-[.65rem] font-normal text-[#9FB8B3] -mt-1">لوحة التحكم</div>
            </div>
          </div>

          <div className="inline-flex bg-white/10 border border-white/15 rounded-xl p-1">
            <Link href="/dashboard/association"
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${mode === "association" ? "bg-goldSoft text-deep2" : "text-[#CFE0DB] hover:bg-white/10"}`}>
              جمعيات الملاك
            </Link>
            <Link href="/dashboard/property"
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${mode === "property" ? "bg-goldSoft text-deep2" : "text-[#CFE0DB] hover:bg-white/10"}`}>
              إدارة الأملاك
            </Link>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-[#9FB8B3] hidden sm:inline">{userName}</span>
            <button onClick={signOut} className="btn text-sm bg-white/10 text-[#EAF1EE] hover:bg-white/20 border border-white/15">خروج</button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-4">{children}</main>
    </div>
  );
}
