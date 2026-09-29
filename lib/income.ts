// ============================================================
// وثيق — دخل العقار للسنة: المحصَّل وغير المحصَّل
//
// طلب مكتب: في صفحة كل عقار «دخل العقار السنوي، المحصَّل وغير المحصَّل».
// كل رقم هنا دقيق من بيانات قائمة — لا تحويل تقريبي للدورات:
//   • المحصَّل: ما قُبض فعلًا في السنة (من الدفتر) — يمرَّر من الصفحة.
//   • غير المحصَّل = المتأخر الآن + ما يحلّ من بقية السنة ولم يُدفع مقدّمًا.
// «قيمة أقساط السنة» تعريف آخر لا يُحسب بدقة: التجديد يستبدل جدول المدة
// السابقة، فأقساطها التي وقعت في السنة لا تُستعاد.
// ============================================================
import { contractState, isVacant, defaultTermPeriods } from "@/lib/contracts";
import { toHijri, fromHijri } from "@/lib/hijri";

const r2 = (n: number) => Math.round(n * 100) / 100;

/* (30 سبتمبر 2026) حُذفت yearUncollected وyearBreakdown: لا يستوردهما أي ملف في
   المستودع، وبقاؤهما يغري باستعمال حساب لا يعرف الضريبة. */

// ── السنة بالتقويمين ─────────────────────────

export type YearCal = "gregorian" | "hijri";
/** حدود السنة الجارية: ميلادية (1 يناير – 31 ديسمبر) أو هجرية (1 محرم – آخر ذي الحجة) */
export function yearWindow(cal: YearCal, todayISO: string): { from: string; to: string; label: string } {
  if (cal === "hijri") {
    const h = toHijri(todayISO);
    if (h) {
      const from = fromHijri(h.y, 1, 1), next = fromHijri(h.y + 1, 1, 1);
      if (from && next) {
        const d = new Date(next + "T00:00:00"); d.setDate(d.getDate() - 1);
        const p2 = (n: number) => String(n).padStart(2, "0");
        return { from, to: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, label: `${h.y}هـ` };
      }
    }
  }
  const y = Number(todayISO.slice(0, 4));
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}` };
}

// ── دخل العمارة السنوي بعقودها الحالية ─────────────────────────
/**
 * الجزء الثاني من البطاقة: كم تُدخل العمارة في السنة بعقودها — لا ما قُبض.
 * الإيجار السنوي للوحدة = قيمة الدفعة × عدد دفعاتها في السنة. رقم دقيق من
 * العقد الحالي، بلا تاريخ ولا تقدير. ومعه ما يلزم لقراءته:
 *   • الشاغرة بآخر إيجار مسجَّل لها (دخل ضائع بالشغور)
 *   • العقود المنتهية بلا تجديد (دخلها غير مضمون حتى تُجدَّد)
 */
export type RentRoll = {
  annual: number; occupied: number;                 // المؤجّرة بعقد سارٍ: مجموع الإيجار السنوي وعددها
  vacant: number; vacantAnnual: number;             // الشاغرة وآخر إيجار سنوي لها
  expired: number; expiredAnnual: number;           // عقود انتهت ولم تُجدَّد (خارج المجموع)
  perUnit: Record<string, number>;                  // الإيجار السنوي لكل وحدة (بمعرّفها)
};
export function annualRentRoll(tenants: any[]): RentRoll {
  const out: RentRoll = { annual: 0, occupied: 0, vacant: 0, vacantAnnual: 0, expired: 0, expiredAnnual: 0, perUnit: {} };
  for (const t of tenants || []) {
    const rent = Number(t.rent_amount) || 0;
    const perYear = defaultTermPeriods((t.payment_frequency || "monthly") as any) || 0;
    const a = r2(rent * perYear);
    if (t.id) out.perUnit[t.id] = a;
    if (isVacant(t)) { out.vacant++; out.vacantAnnual += a; continue; }
    /* العقد المنتهي بلا تجديد ليس دخلًا مضمونًا — خارج المجموع، في سطره وحده.
       (كان داخلًا فيه: عقد انتهى قبل سنتين يُحسب ضمن «دخل العمارة».) */
    const st = contractState(t, {});
    if (st.daysToEnd !== null && st.daysToEnd < 0) { out.expired++; out.expiredAnnual += a; continue; }
    out.occupied++; out.annual += a;
  }
  out.annual = r2(out.annual); out.vacantAnnual = r2(out.vacantAnnual); out.expiredAnnual = r2(out.expiredAnnual);
  return out;
}
