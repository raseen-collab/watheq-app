/**
 * قمع الزوار — التعريف المشترك بين المتصفح والخادم ولوحة الإدارة (7 أكتوبر 2026).
 *
 * أربع محطات، كل واحدة تُسجَّل مرة واحدة لكل جلسة (sid). الجلسة رقم عشوائي
 * في sessionStorage — لا كوكيز ولا بصمة ولا IP. وينتقل من الموقع التسويقي إلى
 * التطبيق في معامل الرابط `wv` لأن النطاقين منفصلان، فتُربط زيارة حراج
 * بفتح التجربة ثم بالتسجيل كمسار واحد.
 */
import { isSignupSource } from "./signup-sources";

export const FUNNEL_EVENTS = ["visit", "demo_open", "signup_view", "signup_submit"] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export const FUNNEL_LABELS: Record<FunnelEvent, string> = {
  visit: "زار الموقع",
  demo_open: "فتح التجربة",
  signup_view: "وصل صفحة التسجيل",
  signup_submit: "ضغط إنشاء الحساب",
};

const SID_RE = /^[A-Za-z0-9]{10,40}$/;
export const isSid = (v: unknown): v is string => typeof v === "string" && SID_RE.test(v);

/**
 * زواحف تشغّل JavaScript (Googlebot وأدوات الفحص) — زيارتها ليست زائرًا.
 * معاينات روابط واتساب وتليجرام لا تشغّل JS أصلًا فلا تصل هنا، ولا تُذكر
 * أسماؤها عمدًا: متصفح تليجرام الداخلي يحمل «Telegram» في وكيله وهو زائر حقيقي.
 */
const BOT_RE = /bot\/|bot;|\+https?:|crawl|spider|slurp|headless|lighthouse|pingdom|curl|wget|python|axios|node-fetch/i;
export const isBotAgent = (ua?: string | null): boolean => !ua || BOT_RE.test(ua);

export type FunnelRow = { event: FunnelEvent; src: string | null; path: string | null; sid: string };

/**
 * يتحقق من جسم الطلب ويعيد الصف الجاهز للإدراج، أو null إن كان أي حقل غير
 * مقبول. الطلب عام بلا جلسة، فلا يُقبل نص حر في أي عمود.
 */
export function parseFunnelBody(raw: string): FunnelRow | null {
  if (!raw || raw.length > 1000) return null;
  let b: any;
  try { b = JSON.parse(raw); } catch { return null; }
  if (!b || typeof b !== "object") return null;
  const event = b.e;
  if (!FUNNEL_EVENTS.includes(event)) return null;
  if (!isSid(b.v)) return null;
  /* skip ليس قناة: هو «أفضّل عدم الذكر» في نموذج التسجيل */
  const src = isSignupSource(b.s) && b.s !== "skip" ? String(b.s) : null;
  let path: string | null = null;
  if (typeof b.p === "string" && b.p.startsWith("/") && !b.p.startsWith("//")) {
    path = b.p.split(/[?#]/)[0].replace(/[^\w\-./]/g, "").slice(0, 80) || "/";
  }
  return { event, src, path, sid: b.v };
}

/** عدّ القمع لفترة: لكل مصدر عدد الجلسات في كل محطة */
export function summarizeFunnel(rows: { event: string; src: string | null; at: string }[], sinceMs: number) {
  const by: Record<string, Record<FunnelEvent, number>> = {};
  const total: Record<FunnelEvent, number> = { visit: 0, demo_open: 0, signup_view: 0, signup_submit: 0 };
  for (const r of rows) {
    if (Date.parse(r.at) < sinceMs) continue;
    if (!FUNNEL_EVENTS.includes(r.event as FunnelEvent)) continue;
    const k = r.src || "";
    by[k] ||= { visit: 0, demo_open: 0, signup_view: 0, signup_submit: 0 };
    by[k][r.event as FunnelEvent]++;
    total[r.event as FunnelEvent]++;
  }
  return { by, total };
}
