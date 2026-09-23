import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
/**
 * ترويسات الأمان (مراجعة 22 سبتمبر) — لم تكن موجودة إطلاقًا:
 *  • frame-ancestors: كان أي موقع يستطيع تضمين اللوحة في إطار شفّاف فوق زرّ
 *    مغرٍ (clickjacking) — «حذف» أو «إعادة تأجير» دون علم الموظف. مسموح لنطاقات
 *    وثيق وحدها (قد يعرض الموقع التسويقي صفحة التجربة). لا X-Frame-Options:
 *    لا يقبل قائمة نطاقات، والمتصفحات الحديثة تتبع frame-ancestors.
 *  • Referrer-Policy: رمز رابط المالك جزء من العنوان (/r/<token>)؛ رابط خارجي
 *    داخل التقرير كان يُرسل العنوان كاملًا بالرمز للموقع الآخر فيفتح الكشف.
 *    عامةً: الأصل فقط خارج الموقع. ورابط المالك: لا شيء إطلاقًا.
 *  • nosniff و Permissions-Policy: إغلاق ما لا يحتاجه التطبيق.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://watheqapp.com https://*.watheqapp.com" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];
const nextConfig = {
  reactStrictMode: true,
  experimental: { instrumentationHook: true },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      /* رابط المالك: لا يُرسل عنوانه لأي موقع آخر أبدًا */
      { source: "/r/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

/**
 * Sentry (مراقبة الأخطاء) — يعمل فقط حين يكون NEXT_PUBLIC_SENTRY_DSN مضبوطًا
 * في Vercel؛ بدونه التطبيق يبني ويعمل كما كان تمامًا. لا نرفع source maps
 * (يحتاج SENTRY_AUTH_TOKEN) — الأخطاء تصل باسم الملف والسطر ويكفي.
 */
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
  telemetry: false,
  widenClientFileUpload: false,
  disableLogger: true,
});
