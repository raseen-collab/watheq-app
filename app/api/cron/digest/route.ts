import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { sendTelegram } from "@/lib/telegram";
import { contractState } from "@/lib/contracts";
import { unitLabel } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");

/**
 * الملخّص الإداري اليومي — يُرسل للمالك عبر تليجرام.
 * يُستدعى من Vercel Cron يوميًّا. محمي بـ CRON_SECRET.
 */
export async function GET(req: Request) {
  // 🔒 إغلاق افتراضي: غياب السر يمنع التشغيل، لا يفتحه.
  // النسخة السابقة كانت تتخطى الفحص كليًّا إن لم يُضبط CRON_SECRET،
  // فيستطيع أي شخص استدعاء المسار وإطلاق موجة رسائل تليجرام لكل المستخدمين.
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "إعدادات ناقصة" }, { status: 500 });

  const db = createAdmin(url, key, { auth: { persistSession: false } });

  const { data: profiles } = await db
    .from("profiles")
    .select("id, telegram_chat_id, notify_enabled, notify_days_before, org_name")
    .not("telegram_chat_id", "is", null)
    .eq("notify_enabled", true);

  let sent = 0;
  for (const p of profiles || []) {
    const { data: props } = await db
      .from("properties").select("*, tenants(*)").eq("user_id", p.id);
    if (!props?.length) continue;

    const within = p.notify_days_before ?? 5;
    const dueSoon: string[] = [];
    const lateList: string[] = [];
    const expiring: string[] = [];
    let totalDue = 0;

    for (const prop of props as any[]) {
      const ul = unitLabel(prop.property_type);
      for (const t of prop.tenants || []) {
        const st = contractState(t);
        if (st.status === "late") {
          totalDue += st.amountDue;
          lateList.push(`• ${t.name} — ${ul} ${t.unit || "—"} (${prop.name}) — <b>${sar(st.amountDue)}</b> ريال`);
        } else if (st.daysToNextDue !== null && st.daysToNextDue >= 0 && st.daysToNextDue <= within) {
          dueSoon.push(`• ${t.name} — ${ul} ${t.unit || "—"} — ${sar(t.rent_amount)} ريال بتاريخ ${st.nextDueDate}`);
        }
        if (st.daysToEnd !== null && st.daysToEnd >= 0 && st.daysToEnd <= 60) {
          expiring.push(`• ${t.name} — ${ul} ${t.unit || "—"} — ينتهي خلال ${st.daysToEnd} يومًا (${st.endDate})`);
        }
      }
    }

    if (!dueSoon.length && !lateList.length && !expiring.length) continue;

    const parts = [`🗂️ <b>ملخّص وثيق اليومي</b>${p.org_name ? ` — ${p.org_name}` : ""}`, ""];
    if (dueSoon.length) parts.push(`🟡 <b>تستحق خلال ${within} أيام (${dueSoon.length})</b>`, ...dueSoon.slice(0, 12), "");
    if (lateList.length) parts.push(`🔴 <b>متأخرة (${lateList.length})</b> — إجمالي ${sar(totalDue)} ريال`, ...lateList.slice(0, 12), "");
    if (expiring.length) parts.push(`📄 <b>عقود تنتهي قريبًا (${expiring.length})</b>`, ...expiring.slice(0, 12), "");
    parts.push("", "افتح لوحتك: https://watheq-app.vercel.app/dashboard/property");

    const r = await sendTelegram(p.telegram_chat_id as string, parts.join("\n"));
    if (r.ok) {
      sent++;
      await db.from("profiles").update({ last_digest_at: new Date().toISOString() }).eq("id", p.id);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
