import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { sendTelegram } from "@/lib/telegram";
import { contractState } from "@/lib/contracts";
import { unitLabel } from "@/lib/domain";
import { complianceDigestLines, type ComplianceItem } from "@/lib/compliance";
import { listingsDigestLines, type Listing } from "@/lib/listings";
import { requestsDigestLines, type SeekerRequest } from "@/lib/requests";
import { complianceState } from "@/lib/compliance";

/** تليجرام يقرأ الرسالة كـHTML: اسم فيه < أو & يُسقط الرسالة كلها للحساب. نهرّب النصوص الحرة */
const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  /**
   * كل حساب دالة مستقلة، وتُعالَج الحسابات خمسةً خمسة بالتوازي:
   * 40 مكتبًا متسلسلة (استعلام + تليجرام لكل واحد) تقترب من مهلة الستين
   * ثانية؛ بالتوازي تنتهي في ربعها. وخطأ حساب واحد لا يمسّ الباقين.
   */
  const processProfile = async (p: any): Promise<boolean> => {
   try {
    const { data: props } = await db
      .from("properties").select("*, tenants(*)").eq("user_id", p.id);
    if (!props?.length) return false;

    const within = p.notify_days_before ?? 5;
    const dueSoon: string[] = [];
    const lateList: string[] = [];
    const expiring: string[] = [];
    let totalDue = 0;

    for (const prop of props as any[]) {
      const ul = unitLabel(prop.property_type);
      for (const t of prop.tenants || []) {
        // فترة السماح نفسها التي تعتمدها اللوحة — وإلا وصلت رسالة «متأخر» لمستأجر لوحته تقول «فترة سماح»
        const st = contractState(t, { graceDays: Number(prop.grace_days) || 0 });
        if (st.status === "late") {
          totalDue += st.amountDue;
          lateList.push(`• ${esc(t.name)} — ${ul} ${esc(t.unit || "—")} (${esc(prop.name)}) — <b>${sar(st.amountDue)}</b> ريال`);
        } else if (st.daysToNextDue !== null && st.daysToNextDue >= 0 && st.daysToNextDue <= within) {
          dueSoon.push(`• ${esc(t.name)} — ${ul} ${esc(t.unit || "—")} — ${sar(t.rent_amount)} ريال بتاريخ ${st.nextDueDate}`);
        }
        if (st.daysToEnd !== null && st.daysToEnd >= 0 && st.daysToEnd <= 60) {
          expiring.push(`• ${esc(t.name)} — ${ul} ${esc(t.unit || "—")} — ينتهي خلال ${st.daysToEnd} يومًا (${st.endDate})`);
        }
      }
    }

    // ⚖️ التزامات المكتب: عقود وساطة تنتهي/في نافذة الشهرين، تراخيص إعلانات، فال.
    // داخل try حتى لا يُسقط غيابُ جدول schema-v6 الملخّصَ اليومي كله.
    let compliance: string[] = [];
    let brokerages: ComplianceItem[] = [];
    try {
      const { data: cItems } = await db
        .from("compliance_items").select("*").eq("user_id", p.id).eq("status", "active");
      brokerages = (cItems || []) as ComplianceItem[];
      compliance = complianceDigestLines(brokerages);
    } catch { /* الجدول غير منشأ بعد — نتجاهل القسم */ }

    // 📋 المعروضات: ما يحتاج تأكيد توفر، وما هو مفتوح بعقد وساطة منتهٍ.
    // داخل try أيضًا حتى لا يُسقط غيابُ جدول schema-v7 الملخّصَ اليومي.
    let listings: string[] = [];
    let matchLines: string[] = [];
    try {
      const { data: lItems } = await db.from("listings").select("*").eq("user_id", p.id);
      const expiredBro = new Set(
        brokerages
          .filter((b) => b.kind === "brokerage" && ["expired", "window"].includes(complianceState(b).phase))
          .map((b) => b.id),
      );
      const lRows = (lItems || []) as Listing[];
      listings = listingsDigestLines(lRows, expiredBro);

      // 🔎 طلبات لها معروضات مطابقة — مكالمة اليوم أثمن من مكالمة الأسبوع القادم
      try {
        const { data: rItems } = await db.from("seeker_requests").select("*")
          .eq("user_id", p.id).eq("status", "active");
        matchLines = requestsDigestLines((rItems || []) as SeekerRequest[], lRows);
      } catch { /* جدول الطلبات غير منشأ بعد */ }
    } catch { /* الجدول غير منشأ بعد — نتجاهل القسم */ }

    if (!dueSoon.length && !lateList.length && !expiring.length && !compliance.length && !listings.length && !matchLines.length) return false;

    const parts = [`🗂️ <b>ملخّص وثيق اليومي</b>${p.org_name ? ` — ${esc(p.org_name)}` : ""}`, ""];
    // أقصى 12 سطرًا لكل قسم مع ذكر المتبقي — مكتب كبير لا يظن أن القائمة اكتملت
    const more = (n: number) => n > 12 ? [`… و${n - 12} أخرى في اللوحة`] : [];
    if (dueSoon.length) parts.push(`🟡 <b>تستحق خلال ${within} أيام (${dueSoon.length})</b>`, ...dueSoon.slice(0, 12), ...more(dueSoon.length), "");
    if (lateList.length) parts.push(`🔴 <b>متأخرة (${lateList.length})</b> — إجمالي ${sar(totalDue)} ريال`, ...lateList.slice(0, 12), ...more(lateList.length), "");
    if (expiring.length) parts.push(`📄 <b>عقود تنتهي قريبًا (${expiring.length})</b>`, ...expiring.slice(0, 12), ...more(expiring.length), "");
    if (compliance.length) parts.push(`⚖️ <b>التزامات المكتب (${compliance.length})</b>`, ...compliance.slice(0, 12), "");
    if (listings.length) parts.push(`📋 <b>المعروضات</b>`, ...listings, "");
    if (matchLines.length) parts.push(...matchLines, "");
    parts.push("", "افتح لوحتك: https://app.watheqapp.com/dashboard/property");

    const r = await sendTelegram(p.telegram_chat_id as string, parts.join("\n"));
    if (r.ok) {
      await db.from("profiles").update({ last_digest_at: new Date().toISOString() }).eq("id", p.id);
      return true;
    }
    return false;
   } catch (e) {
    // حساب واحد بخطأ غير متوقع لا يُسقط ملخّصات الباقين — نسجّل ونكمل
    console.error("digest failed for", p.id, e);
    Sentry.captureException(e, { tags: { job: "digest" }, extra: { profile: p.id } });
    return false;
   }
  };

  const list = profiles || [];
  for (let i = 0; i < list.length; i += 5) {
    const results = await Promise.all(list.slice(i, i + 5).map(processProfile));
    sent += results.filter(Boolean).length;
  }

  return NextResponse.json({ ok: true, sent, total: list.length });
}
