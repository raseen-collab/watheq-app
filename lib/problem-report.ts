/**
 * تنظيف بلاغ «بلّغ عن مشكلة» قبل الحفظ — دالة نقية تُختبر وحدها (tests/problem-report.js).
 * كل حقل يُقصّ لحدّ عمود القاعدة (schema-v93) فلا يُرفض الإدخال كله بسبب حقل طويل.
 */
export type CleanRow = {
  message: string; path: string | null; user_agent: string | null;
  viewport: string | null; sentry_event: string | null;
};

const str = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() : "";
  return s ? s.slice(0, max) : null;
};

export function cleanReport(body: any, uaHeader?: string | null): { ok: true; row: CleanRow } | { ok: false; error: string } {
  const message = str(body?.message, 2000);
  if (!message || message.length < 3) return { ok: false, error: "اكتب وصفًا قصيرًا للمشكلة (3 أحرف على الأقل)." };
  /* المسار فقط بلا الاستعلام: روابط المستأجر والمالك تحمل رموز وصول في الرابط */
  let path = str(body?.path, 200);
  if (path) path = path.split("?")[0].split("#")[0] || null;
  if (path && !path.startsWith("/")) path = null;
  const vp = str(body?.viewport, 40);
  const viewport = vp && /^\d{2,5}x\d{2,5}$/.test(vp) ? vp : null;
  const ev = str(body?.sentry_event, 64);
  const sentry_event = ev && /^[a-f0-9]{16,64}$/i.test(ev) ? ev : null;
  return { ok: true, row: { message, path, user_agent: str(uaHeader, 400), viewport, sentry_event } };
}
