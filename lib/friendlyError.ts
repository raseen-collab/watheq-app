/**
 * رسالة خطأ يفهمها صاحب المكتب (v78 · 7 أكتوبر 2026).
 *
 * كانت أخطاء القاعدة تُعرض كما هي: «permission denied for table profiles»
 * أو «new row violates row-level security policy» — مستخدم جديد في أول
 * دقيقة يرى إنجليزية تقنية فيغلق الصفحة. نترجم الأنماط الشائعة، ونُبقي
 * النص الأصلي بين قوسين في الحالة المجهولة ليفيد الدعم إن راسلنا.
 */
import * as Sentry from "@sentry/nextjs";

/**
 * (24 نوفمبر 2026 — تقييم التجربة) كانت ٣٣ رسالة تقول للعميل «شغّل schema-vXX في Supabase» —
 * تعليمات للمبرمج تظهر لصاحب المكتب فيظن أن بياناته تعطّلت. القاعدة الحية فيها كل التحديثات،
 * فهذه الفروع لا تقع إلا لخطأ آخر: نقول للعميل ما يفهمه ونُرسل التفاصيل لنا (Sentry).
 */
export const SYSTEM_GAP_MSG = "تعذّر إتمام العملية من جهتنا — بياناتك سليمة. حاول بعد قليل، وإن تكرر راسلنا على واتساب 0550165210 ونحلّها لك.";
export function systemGap(where: string, raw?: unknown): string {
  try { Sentry.captureMessage(`system-gap: ${where}: ${String((raw as any)?.message ?? raw ?? "").slice(0, 200)}`, "warning"); } catch { /* */ }
  return SYSTEM_GAP_MSG;
}

export function friendlyError(raw: unknown): string {
  const msg = String((raw as any)?.message ?? raw ?? "").trim();
  if (!msg) return "تعذّر إتمام العملية — حاول مرة أخرى.";
  if (/[؀-ۿ]/.test(msg)) return msg;                        // رسالة عربية كتبناها نحن — تُعرض كما هي
  if (/jwt|session|refresh token|not authenticated|auth session missing/i.test(msg))
    return "انتهت الجلسة — أعد تسجيل الدخول ثم حاول مرة أخرى.";
  if (/permission denied|not authorized|row-level security|violates row level/i.test(msg))
    return "ما عندك صلاحية لهذا الإجراء. إن كنت موظفًا فاطلبه من صاحب المكتب، وإلا راسلنا على واتساب 0550165210.";
  if (/failed to fetch|network|timeout|timed out|load failed|fetch failed/i.test(msg))
    return "تعذّر الاتصال — تأكد من الإنترنت وحاول مرة أخرى.";
  if (/duplicate key|already exists|unique/i.test(msg))
    return "هذا السجل موجود من قبل.";
  if (/check constraint|value too long|invalid input|out of range/i.test(msg))
    return "قيمة غير مقبولة في أحد الحقول — راجع المدخلات وحاول مرة أخرى.";
  /* مجهول: لا نعرض الإنجليزية التقنية للعميل — تصلنا في Sentry بدلًا من ذلك */
  try { console.error("watheq error:", msg); Sentry.captureMessage(`friendlyError unknown: ${msg.slice(0, 200)}`, "warning"); } catch { /* */ }
  return "تعذّر إتمام العملية — بياناتك السابقة سليمة. حاول مرة أخرى، وإن تكرر راسلنا على واتساب 0550165210.";
}
