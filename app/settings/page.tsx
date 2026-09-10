import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SettingsView from "@/components/SettingsView";
import { getOffice } from "@/lib/office";

export const dynamic = "force-dynamic";

/**
 * الإعدادات لصاحب المكتب وحده.
 *
 * ما في هذه الصفحة يخصّ المكتب كله لا المستخدم: ربط بوت تليجرام، ونوافذ
 * «قريب» و«مستحق» التي تحدد متى يُعدّ المستأجر متأخرًا في كل العقارات،
 * وبيانات الفوترة. وتركها مفتوحة للموظفين يعني أمرين كلاهما ضار:
 * موظف يغيّر نافذة الاستحقاق فتتغيّر حالات كل الوحدات على الجميع،
 * أو موظف يعدّل صفحته الخاصة فلا يتغيّر شيء ويظن أن النظام معطّل.
 */
export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const office = await getOffice(supabase);
  /* غياب النتيجة يعني مالكًا (نفس افتراض getOffice عند فشل الاستدعاء) */
  if (office && office.isOwner === false) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="bg-white border border-line rounded-2xl p-8">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="font-display font-bold text-deep text-lg mb-2">الإعدادات لصاحب المكتب</h1>
          <p className="text-sm text-muted leading-relaxed mb-5">
            هذه الصفحة تضبط إعدادات المكتب كله — تنبيهات تليجرام، ومتى يُعدّ المستأجر
            متأخرًا، وبيانات الفوترة. يضبطها صاحب المكتب مرة واحدة وتسري على الجميع.
          </p>
          <Link href="/dashboard/property" className="btn btn-gold">← العودة إلى اللوحة</Link>
        </div>
      </main>
    );
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return <SettingsView profile={profile || { id: user.id }} />;
}
