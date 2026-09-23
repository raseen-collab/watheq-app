"use client";
/**
 * صفحة خطأ اللوحة: تحميل البيانات صار يرمي خطأً صريحًا بدل عرض نصفها كأنه
 * كلها (lib/fetch-all.ts). هذه تعرضه بلغة المكتب مع «إعادة المحاولة» — بدل
 * صفحة الخطأ العامة التي تستبدل الموقع كله.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto mt-16 bg-white border border-line rounded-2xl p-6 text-center">
      <div className="text-3xl mb-2">⚠️</div>
      <h2 className="font-semibold text-deep text-lg">تعذّر تحميل البيانات</h2>
      <p className="text-sm text-muted mt-2 leading-relaxed">
        لم نعرض شيئًا حتى لا تظهر لك أرقام ناقصة. غالبًا انقطاع مؤقت في الاتصال — أعد المحاولة.
      </p>
      <button type="button" className="btn btn-primary mt-4" onClick={() => reset()}>إعادة المحاولة</button>
      {error?.digest && <div className="text-[11px] text-muted mt-3">رمز الخطأ: {error.digest}</div>}
    </div>
  );
}
