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
