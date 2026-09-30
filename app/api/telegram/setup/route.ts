import { NextResponse } from "next/server";
import { tgSetWebhook, tgSetCommands } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * إعداد لمرّة واحدة:
 *   GET /api/telegram/setup  مع الترويسة  Authorization: Bearer <CRON_SECRET>
 *   (30 سبتمبر 2026: لا يُقبل السرّ في الرابط — يبقى في سجلات الخادم والمتصفح)
 * يربط الـ webhook بتليجرام ويضبط قائمة الأوامر.
 * أعِد استدعاءه فقط عند تغيير الدومين أو الأوامر.
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "اضبط المتغيّر TELEGRAM_WEBHOOK_SECRET أولًا" },
      { status: 400 }
    );
  }

  const base =
    process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get("host")}`;
  const hook = `${base}/api/telegram/webhook`;

  const webhook = await tgSetWebhook(hook, secret);
  const commands = await tgSetCommands();

  return NextResponse.json({ ok: webhook.ok && commands.ok, hook, webhook, commands });
}
