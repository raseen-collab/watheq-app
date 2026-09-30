import { createClient as createAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { noStoreFetch } from "./no-store-fetch";

/**
 * وثيق — أدوات خادم بوابة المالك (app/r/o/**). مفتاح الخدمة لا يُستعمل إلا
 * لاستدعاء دوال watheq_hoa_portal* (schema-v61) التي تتحقق من الرمز داخل
 * القاعدة وتحصر كل قراءة بمكتب الرابط وجمعيته ومالكه.
 */
export function portalDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } });
}

/** أول عنوان في x-forwarded-for (يضعه Vercel) — للتوثيق لا للتحقق */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0] : req.headers.get("x-real-ip") || "").trim();
  return ip ? ip.slice(0, 64) : null;
}

export const userAgent = (req: Request): string | null => {
  const ua = (req.headers.get("user-agent") || "").trim();
  return ua ? ua.slice(0, 300) : null;
};

export const newNonce = () => crypto.randomUUID().replace(/-/g, "");

/**
 * v66: قراءة نموذج بوابة المالك بالحمايات نفسها في /sign — نوع المحتوى نموذج
 * عادي، حجم ≤ 4KB، الأصل (Origin) نفس الموقع إن أُرسل. يرجع الحقول أو سبب الرفض.
 */
export async function readPortalForm(req: Request, max = 4096):
  Promise<{ ok: true; f: URLSearchParams } | { ok: false; status: number; msg: string }> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) return { ok: false, status: 413, msg: "الطلب أكبر من المسموح" };
  const ctype = (req.headers.get("content-type") || "").toLowerCase();
  if (!ctype.startsWith("application/x-www-form-urlencoded")) return { ok: false, status: 415, msg: "طلب غير صالح" };
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    try { if (new URL(origin).host !== new URL(req.url).host) return { ok: false, status: 403, msg: "طلب غير صالح" }; }
    catch { return { ok: false, status: 403, msg: "طلب غير صالح" }; }
  }
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > max) return { ok: false, status: 413, msg: "الطلب أكبر من المسموح" };
    return { ok: true, f: new URLSearchParams(new TextDecoder().decode(buf)) };
  } catch { return { ok: false, status: 400, msg: "طلب غير صالح" }; }
}

/** أرقام عربية/فارسية ← لاتينية، وحذف فواصل الآلاف والمسافات */
export const latinDigits = (v: string) => String(v || "")
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6F0))
  .replace(/[٫]/g, ".").replace(/[,،٬\s]/g, "");
