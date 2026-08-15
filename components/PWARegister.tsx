"use client";

import { useEffect } from "react";

/**
 * يسجّل عامل الخدمة بعد اكتمال تحميل الصفحة.
 * لا يعرض شيئًا ولا يؤثر على أول رسم.
 */
export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // فشل التسجيل لا يكسر شيئًا — التطبيق يعمل بدونه
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
