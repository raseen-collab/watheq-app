"use client";
// ============================================================
// وثيق — شاشة «تعذّر الاتصال، نعيد المحاولة»
//
// انحراف الساعة بين خوادم المصادقة والقاعدة يجعل الجلسة «صادرة في
// المستقبل» فتُرفض. إعادة المحاولة في الخادم تعالج الانحراف الصغير؛
// وإن كان أكبر، الأسوأ أن يرى صاحب المكتب صفحة خطأ حمراء بلا معنى.
// هذه الشاشة تخبره بالعربية أنها مشكلة مؤقتة، وتعيد التحميل تلقائيًّا
// بعد خمس ثوانٍ — فتُحلّ غالبًا بلا أي تدخل منه.
// ============================================================

import { useEffect, useState } from "react";

export default function RetryScreen({ detail }: { detail?: string }) {
  const [left, setLeft] = useState(5);

  useEffect(() => {
    const t = setInterval(() => setLeft((n) => n - 1), 1000);
    const r = setTimeout(() => window.location.reload(), 5000);
    return () => { clearInterval(t); clearTimeout(r); };
  }, []);

  return (
    <div className="min-h-[70vh] grid place-items-center p-6">
      <div className="max-w-md text-center">
        <div className="text-3xl mb-2">⏳</div>
        <h1 className="font-display font-bold text-deep text-lg mb-2">لحظة من فضلك…</h1>
        <p className="text-sm text-muted leading-relaxed mb-4">
          تعذّر تحميل بياناتك بسبب تأخّر مؤقّت في الخوادم — لا علاقة له بحسابك أو بياناتك، وكلها سليمة.
          سنعيد المحاولة تلقائيًّا خلال <b>{Math.max(left, 0)}</b> ثانية.
        </p>
        <button className="btn btn-gold" onClick={() => window.location.reload()}>إعادة المحاولة الآن</button>
        {detail && <p className="text-[11px] text-muted mt-4" dir="ltr">{detail}</p>}
      </div>
    </div>
  );
}
