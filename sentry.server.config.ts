// مراقبة أخطاء الخادم (الصفحات ومسارات API والكرون)
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0, sendDefaultPii: false,
    environment: process.env.VERCEL_ENV || "production" });
}
