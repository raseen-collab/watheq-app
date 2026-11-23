/** (23 نوفمبر 2026) يُزال من رابط التحليلات: الاستعلام والمعرّفات الطويلة (رمز رابط المالك/أرقام السجلات) */
export function scrubUrl(u: string): string {
  try {
    const x = new URL(u);
    x.search = ""; x.hash = "";
    x.pathname = x.pathname.split("/").map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || /^[A-Za-z0-9_-]{16,}$/.test(seg) || /^\d{4,}$/.test(seg) ? ":id" : seg
    ).join("/");
    return x.toString();
  } catch { return u; }
}
