import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true, experimental: { instrumentationHook: true } };

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
