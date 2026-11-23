"use client";
// ============================================================
// وثيق — Vercel Web Analytics (23 نوفمبر 2026)
// أي الصفحات تُستعمل وأين يتوقف المستخدمون — بلا كوكيز وبلا بيانات شخصية.
// نحذف الاستعلام (?…) ونستبدل المعرّفات الطويلة في المسار بـ :id، فلا يخرج
// رقم عقار أو مستأجر أو رمز رابط مالك من المتصفح. لا يعمل إلا بعد تفعيله من لوحة Vercel.
// ============================================================
import { Analytics } from "@vercel/analytics/react";
import { scrubUrl } from "@/lib/analytics-scrub";

export default function WqAnalytics() {
  return <Analytics beforeSend={(e) => ({ ...e, url: scrubUrl(e.url) })} />;
}
