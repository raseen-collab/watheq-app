// مراقبة أخطاء المتصفح — يُحمَّل في كل صفحة. بلا DSN لا يفعل شيئًا.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    // لا نتتبع الأداء ولا نسجّل الجلسات — أخطاء فقط، وخصوصية المستأجرين أولًا
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "production",
    // ضجيج المتصفح المعروف الذي لا يفيد أحدًا
    ignoreErrors: ["ResizeObserver loop", "Load failed", "NetworkError", "AbortError"],
  });
}
