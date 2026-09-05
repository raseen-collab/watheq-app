"use client";
// شاشة الانهيار الكامل: تُبلّغ Sentry وتعرض للمستخدم رسالة عربية بدل صفحة بيضاء
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "Tahoma, sans-serif", display: "grid", placeItems: "center", minHeight: "90vh", background: "#F6F1E4", color: "#0B211F" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <div style={{ fontSize: "2rem" }}>⚠️</div>
          <h1 style={{ fontSize: "1.1rem" }}>حدث خطأ غير متوقع</h1>
          <p style={{ fontSize: ".85rem", color: "#5C6B67" }}>وصلنا التقرير تلقائيًّا. حدّث الصفحة — وإن تكرر، راسلنا: watheqdocs@gmail.com</p>
          <a href="/dashboard" style={{ display: "inline-block", marginTop: 12, padding: "9px 16px", borderRadius: 10, background: "#0E3A37", color: "#E7C877", textDecoration: "none", fontWeight: 600 }}>العودة للوحة</a>
        </div>
      </body>
    </html>
  );
}
