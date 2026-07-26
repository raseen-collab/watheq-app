import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tgSend } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * نبض المنصة — ملخّص يومي يصلك على تليجرام.
 *
 * الاستدعاء:  GET /api/admin/pulse?key=CRON_SECRET
 * اربطه بـ Vercel Cron ليصلك تلقائيًّا، أو افتحه يدويًّا وقت ما تشاء.
 *
 * الغرض: أن تعرف أن أحدًا سجّل أو أضاف شيئًا — دون فتح أي لوحة.
 */
function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!chatId) {
    return NextResponse.json({ ok: false, error: "اضبط ADMIN_TELEGRAM_CHAT_ID أولًا" }, { status: 400 });
  }

  const db = serviceDb();
  const since = new Date(); since.setDate(since.getDate() - 1);
  const sinceISO = since.toISOString();

  const [profiles, newProfiles, props, assoc, tenants, owners, pays, newPays] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("profiles").select("id,full_name,org_name,account_type,created_at").gte("created_at", sinceISO),
    db.from("properties").select("user_id"),
    db.from("associations").select("user_id"),
    db.from("tenants").select("id", { count: "exact", head: true }),
    db.from("owners").select("id", { count: "exact", head: true }),
    db.from("payments").select("id", { count: "exact", head: true }),
    db.from("payments").select("amount,paid_on").gte("paid_on", sinceISO.slice(0, 10)),
  ]);

  const total = profiles.count || 0;
  const fresh = newProfiles.data || [];
  const withData = new Set([
    ...(props.data || []).map((r: any) => r.user_id),
    ...(assoc.data || []).map((r: any) => r.user_id),
  ]);
  const dormant = Math.max(0, total - withData.size);
  const dayPays = newPays.data || [];
  const dayTotal = dayPays.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

  const L: string[] = ["📈 <b>نبض وثيق — آخر 24 ساعة</b>", ""];

  if (fresh.length) {
    L.push(`🎉 <b>${fresh.length} حساب جديد</b>`);
    fresh.slice(0, 5).forEach((p: any) =>
      L.push(`• ${esc(p.full_name || "بلا اسم")}${p.org_name ? ` — ${esc(p.org_name)}` : ""}${p.account_type ? ` (${esc(p.account_type)})` : ""}`)
    );
    L.push("");
  } else {
    L.push("لا تسجيلات جديدة اليوم.", "");
  }

  if (dayPays.length) L.push(`💰 دفعات اليوم: <b>${dayPays.length}</b> بمبلغ <b>${sar(dayTotal)}</b> ﷼`, "");

  L.push("— الإجمالي —");
  L.push(`• الحسابات: <b>${total}</b> (فعّلوا: ${withData.size} · لم يبدؤوا: ${dormant})`);
  L.push(`• العقارات: <b>${(props.data || []).length}</b> · الوحدات: <b>${tenants.count || 0}</b>`);
  L.push(`• الجمعيات: <b>${(assoc.data || []).length}</b> · الملّاك: <b>${owners.count || 0}</b>`);
  L.push(`• الدفعات المسجّلة: <b>${pays.count || 0}</b>`);

  const res = await tgSend(chatId, L.join("\n"));
  return NextResponse.json({ ok: !!res.ok, sent: res.ok, newSignups: fresh.length });
}
