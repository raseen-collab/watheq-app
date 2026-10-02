import type { SupabaseClient } from "@supabase/supabase-js";
import { tgSend } from "./telegram";
import { requestCatAr, requestLocAr } from "./hoaMoney";

/**
 * وثيق — تنبيه تليجرام فوري للمكتب حين يصل بلاغ من رابط خاص (3 أكتوبر 2026):
 * حوالة أو طلب صيانة، من مستأجر (إدارة الأملاك) أو من مالك (اتحاد الملاك).
 *
 * - البيانات من watheq_portal_notify_info (schema-v70): محادثة صاحب المكتب
 *   واسم العقار/الجمعية والوحدة والاسم — بعد التحقق من الرمز داخل القاعدة.
 * - كل نص يدخل الرسالة يُهرَّب (HTML تليجرام)، والوصف مقصوص.
 * - لا يُسقط البلاغ أبدًا: البلاغ حُفظ قبل الاستدعاء، وأي فشل هنا يُسجَّل فقط.
 * - سقف زمني قصير: لا ينتظر المستأجر تليجرام أكثر من ثانيتين ونصف.
 */
export type PortalEvent =
  | { type: "claim"; amount: number; date: string; ref?: string | null }
  | { type: "request"; category: string; location: string; description: string };

const escT = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function portalNotifyText(kind: "tenant" | "hoa", info: { place?: string | null; unit?: string | null; name?: string | null }, ev: PortalEvent): string {
  const who = kind === "tenant" ? "المستأجر" : "المالك";
  const head = ev.type === "claim" ? `💳 <b>بلاغ حوالة جديد من ${who}</b>` : `🛠 <b>طلب صيانة جديد من ${who}</b>`;
  const lines = [head, "",
    `${kind === "tenant" ? "🏢 العقار" : "🏢 الجمعية"}: ${escT(info.place || "—")}`,
    `🚪 الوحدة: ${escT(info.unit || "—")}`,
    `👤 ${who}: ${escT(info.name || "—")}`];
  if (ev.type === "claim") {
    lines.push(`💰 المبلغ: <b>${money(ev.amount)} ريال</b>`, `📅 تاريخ الحوالة: ${escT(ev.date)}`);
    if (ev.ref) lines.push(`🔖 المرجع: ${escT(ev.ref)}`);
    lines.push("", "طابقها مع كشف البنك ثم اعتمدها أو ارفضها من لوحتك.");
  } else {
    const d = String(ev.description || "").replace(/\s+/g, " ").trim();
    lines.push(`🔧 النوع: ${escT(requestCatAr(ev.category))} · ${escT(requestLocAr(ev.location))}`,
      `📝 ${escT(d.length > 300 ? d.slice(0, 300) + "…" : d)}`);
  }
  return lines.join("\n");
}

export async function notifyPortalEvent(db: SupabaseClient, kind: "tenant" | "hoa", token: string, ev: PortalEvent): Promise<void> {
  const work = (async () => {
    const { data, error } = await db.rpc("watheq_portal_notify_info", { p_kind: kind, p_token: token });
    if (error) {
      /* قبل تطبيق schema-v70 الدالة غير موجودة — صمت، لا ضجيج في السجلات */
      if (!/Could not find|does not exist|schema cache/i.test(error.message || "")) console.error("portal notify info failed", error.message);
      return;
    }
    const info = data as { chat_id?: string; place?: string; unit?: string; name?: string } | null;
    if (!info?.chat_id) return;   // المكتب لم يربط تليجرام
    const url = `https://app.watheqapp.com/dashboard/${kind === "tenant" ? "property" : "association"}`;
    await tgSend(info.chat_id, portalNotifyText(kind, info, ev), [[{ text: "افتح اللوحة", url }]]);
  })().catch((e) => console.error("portal notify failed", e?.message || e));
  await Promise.race([work, new Promise((r) => setTimeout(r, 2500))]);
}
