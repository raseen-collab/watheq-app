"use client";
/**
 * 📦 تذكير شهري بحفظ نسخة من البيانات (16 نوفمبر 2026 — طلب عبيد).
 *
 * لصاحب المكتب فقط (التصدير في «الإعدادات» وهي له). يظهر إن مرّ 30 يومًا على آخر
 * تصدير، أو لم يصدّر قط وقد مضى على حسابه 14 يومًا. التاريخ في القاعدة
 * (profiles.last_backup_at — schema-v87) فلا يتكرر التذكير على كل جهاز.
 * «لاحقًا» يؤجّله 7 أيام في هذا المتصفح. قبل الترحيل (لا عمود) لا يظهر شيء.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { backupDue } from "@/lib/backupReminder";

const SNOOZE_KEY = "wq_backup_snooze";

export default function BackupReminder() {
  const [due, setDue] = useState<null | { days: number | null }>(null);

  useEffect(() => {
    let off = false;
    async function check() {
      try {
        let snooze = "";
        try { snooze = localStorage.getItem(SNOOZE_KEY) || ""; } catch { /* */ }
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase.from("profiles").select("last_backup_at, created_at").eq("id", user.id).maybeSingle();
        if (error || !data || off) return;   // قبل v87 أو خطأ عابر: لا تذكير
        setDue(backupDue({ lastBackup: (data as any).last_backup_at, since: (data as any).created_at, snoozeUntil: snooze, now: new Date() }));
      } catch { /* */ }
    }
    void check();
    const done = () => setDue(null);
    window.addEventListener("wq-backup-done", done);
    return () => { off = true; window.removeEventListener("wq-backup-done", done); };
  }, []);

  if (!due) return null;
  function later() {
    try { localStorage.setItem(SNOOZE_KEY, new Date(Date.now() + 7 * 86400000).toISOString()); } catch { /* */ }
    setDue(null);
  }
  return (
    <div className="text-sm py-2 px-4 bg-[#E6F4EC] text-[#137a50] border-b border-[#B7DFC7] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center" role="status">
      <span>📦 {due.days === null ? "لم تحفظ نسخة من بياناتك بعد" : `آخر نسخة من بياناتك قبل ${due.days} يومًا`} — صدّرها Excel واحفظها خارج جهازك (دقيقة واحدة).</span>
      <Link href="/settings#export" className="font-bold underline">تصدير الآن</Link>
      <button type="button" className="text-xs opacity-80 hover:opacity-100" onClick={later}>لاحقًا</button>
    </div>
  );
}
