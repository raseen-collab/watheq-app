// ============================================================
// وثيق — كشف المستحقات القادمة (ورقة المحصّل)
//
// طلب مكتب مشترك (27 أكتوبر 2026): ورقة تُطبع وتُسلَّم للمحصّل فيها من يستحق
// عليه الدفع خلال أسبوعين أو شهر أو شهرين — اسم المستأجر وجواله ووحدته
// وتاريخ الاستحقاق فقط. بلا دخل ولا مصروفات ولا صافٍ: المحصّل لا يحتاجها
// والمكتب لا يريد أن يراها.
//
// المصدر جدول الدفعات نفسه (buildSchedule) الذي يُطبع في كشف المستأجر —
// فلا يخرج في الورقة تاريخ يخالف ما في كشف الحساب أو في اللوحة.
// ============================================================

import { buildSchedule, contractState, isVacant, withVat } from "@/lib/contracts";

export type DueRow = {
  property_id: string;
  property_name: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  unit: string | null;
  /** رقم القسط في مدة العقد (١ = أول قسط) */
  n: number;
  /** من أصل كم قسطًا في مدة العقد */
  of: number;
  date: string;
  /** المطلوب في هذا القسط شاملًا الضريبة إن انطبقت، بعد خصم السداد الجزئي */
  amount: number;
  kind: "late" | "upcoming";
  /** للمتأخر: عدد الأقساط المجمَّعة في هذا الصف (تاريخه = أقدمها) */
  count?: number;
};

/**
 * يجمع أقساط كل مستأجر ساكن التي تقع في [today, to].
 * includeLate: يضيف الأقساط التي حلّ موعدها ولم تُسدَّد بعد — المحصّل يمرّ
 * عليهم في الجولة نفسها، وورقة تُسقطهم تجعله يتجاوز أهمّ الأبواب.
 */
export function buildDueList(input: {
  tenants: any[];
  properties: any[];
  today: string;
  to: string;
  includeLate: boolean;
}): DueRow[] {
  const pById: Record<string, any> = Object.fromEntries(input.properties.map((p) => [p.id, p]));
  const out: DueRow[] = [];
  for (const t of input.tenants) {
    const p = pById[t.property_id];
    if (!p || isVacant(t)) continue;
    /* البيانات الناقصة (تاريخ بداية غير صالح، إيجار صفر…) لا يُبنى لها جدول
       موثوق — تُعرض في «فحص البيانات» لا في ورقة تُسلَّم لشخص يطرق الأبواب */
    const st = contractState(t);
    if (st.incomplete || st.statusLabel.startsWith("بيانات ناقصة")) continue;
    const sched = buildSchedule(t);
    const of = sched.length;
    /* المتأخرات تُجمع في صفّ واحد للمستأجر: عشرة أقساط متأخرة كانت ستملأ
       صفحة باسم واحد. التاريخ أقدمها، والمبلغ مجموعها. */
    let late: DueRow | null = null;
    for (const r of sched) {
      if (r.status === "paid") continue;
      const remaining = Math.max(0, r.amount - r.paidAmount);
      if (remaining <= 0) continue;
      const isPast = r.date < input.today;
      if (isPast && !input.includeLate) continue;
      if (!isPast && r.date > input.to) continue;
      const amount = Math.round(withVat(remaining, t, p) * 100) / 100;
      if (isPast) {
        if (late) { late.count = (late.count || 1) + 1; late.amount = Math.round((late.amount + amount) * 100) / 100; continue; }
      }
      const row: DueRow = {
        property_id: p.id,
        property_name: p.name || "—",
        tenant_id: t.id,
        name: t.name || "—",
        phone: t.phone || null,
        unit: t.unit || null,
        n: r.n,
        of,
        date: r.date,
        amount,
        kind: isPast ? "late" : "upcoming",
        ...(isPast ? { count: 1 } : {}),
      };
      if (isPast) late = row;
      out.push(row);
    }
  }
  /* العمارة أولًا (جولة المحصّل عمارة عمارة)، ثم التاريخ، ثم الوحدة */
  out.sort((a, b) =>
    a.property_name.localeCompare(b.property_name, "ar")
    || a.date.localeCompare(b.date)
    || String(a.unit || "").localeCompare(String(b.unit || ""), "ar", { numeric: true }));
  return out;
}
