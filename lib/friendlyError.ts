/**
 * رسالة خطأ يفهمها صاحب المكتب (v78 · 7 أكتوبر 2026).
 *
 * كانت أخطاء القاعدة تُعرض كما هي: «permission denied for table profiles»
 * أو «new row violates row-level security policy» — مستخدم جديد في أول
 * دقيقة يرى إنجليزية تقنية فيغلق الصفحة. نترجم الأنماط الشائعة، ونُبقي
 * النص الأصلي بين قوسين في الحالة المجهولة ليفيد الدعم إن راسلنا.
 */
export function friendlyError(raw: unknown): string {
  const msg = String((raw as any)?.message ?? raw ?? "").trim();
  if (!msg) return "تعذّر الحفظ — حاول مرة أخرى.";
  if (/[؀-ۿ]/.test(msg)) return msg;                        // رسالة عربية كتبناها نحن — تُعرض كما هي
  if (/jwt|session|refresh token|not authenticated|auth session missing/i.test(msg))
    return "انتهت الجلسة — أعد تسجيل الدخول ثم حاول مرة أخرى.";
  if (/permission denied|not authorized|row-level security|violates row level/i.test(msg))
    return "ما عندك صلاحية لهذا الإجراء. إن كنت موظفًا فاطلبه من صاحب المكتب، وإلا راسلنا على واتساب 0596300591.";
  if (/failed to fetch|network|timeout|timed out|load failed|fetch failed/i.test(msg))
    return "تعذّر الاتصال — تأكد من الإنترنت وحاول مرة أخرى.";
  if (/duplicate key|already exists|unique/i.test(msg))
    return "هذا السجل موجود من قبل.";
  if (/check constraint|value too long|invalid input|out of range/i.test(msg))
    return "قيمة غير مقبولة في أحد الحقول — راجع المدخلات وحاول مرة أخرى.";
  return `تعذّر الحفظ — حاول مرة أخرى، وإن تكرر راسلنا على واتساب 0596300591. (${msg.slice(0, 120)})`;
}
