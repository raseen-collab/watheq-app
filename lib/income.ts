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
import { contractState, buildSchedule, isVacant, defaultTermPeriods } from "@/lib/contracts";
import { toHijri, fromHijri } from "@/lib/hijri";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function yearUncollected(
  tenants: any[],
  opts: { graceDays?: number | null; yearEnd: string; soonDays?: number | null; imminentDays?: number | null },
): { overdue: number; restOfYear: number; units: number } {
  let overdue = 0, restOfYear = 0, units = 0;
  for (const t of tenants || []) {
    const st = contractState(t, { graceDays: opts.graceDays, soonDays: opts.soonDays, imminentDays: opts.imminentDays });
    overdue += st.totalOwed || 0;                     // متأخر الساكن + الدين المرحَّل (أو متأخرات الشاغرة)
    if (isVacant(t)) continue;
    const rent = Number(t.rent_amount) || 0; if (rent <= 0) continue;
    /* ما لم يدخل «المتأخر»: الأقساط من max(المسدَّد، المستحق) حتى نهاية السنة —
       ومنها ما في مهلة السماح (حلّ ولم يُعَدّ متأخرًا بعد) */
    const from = Math.max(Number(st.paid) || 0, Number(st.due) || 0);
    const sched = buildSchedule(t as any);
    let got = 0;
    for (let k = from; k < sched.length; k++) {
      if (String(sched[k].date) > opts.yearEnd) break;
      got += rent;
    }
    /* الجزئي يخصّ القسط رقم «المسدَّد» — يُطرح هنا فقط إن لم يكن متأخرًا
       (المتأخر يطرحه بنفسه) */
    if (got > 0 && (Number(st.paid) || 0) >= (Number(st.due) || 0)) got -= Math.min(rent, Number(t.partial_amount) || 0);
    if (got > 0.005) units++;
    restOfYear += got;
  }
  return { overdue: r2(overdue), restOfYear: r2(restOfYear), units };
}

// ── السنة بالتقويمين، والتفصيل لكل وحدة ─────────────────────────

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

export type YearRow = {
  key: string; unit: string | null; name: string | null; past: boolean;
  collected: number; overdue: number; rest: number; restCount: number;
};
/**
 * تفصيل دخل السنة لكل وحدة — مجموع الصفوف = أرقام البطاقة بالضبط.
 * الساكن: محصَّله في السنة (دفعاته)، ومتأخره الآن، وما يحلّ عليه حتى نهاية
 * السنة. والمستأجر السابق صفّ مستقل: ما قبضه المكتب منه في السنة، ودينه القائم.
 */
export function yearBreakdown(input: {
  tenants: any[]; payments: any[];            // دفعات العقار داخل السنة حتى اليوم (كل الأنواع)
  past: { id: string; name: string; unit: string | null; debt_amount: number; debt_paid: number; debt_status: string }[];
  graceDays?: number | null; yearEnd: string; soonDays?: number | null; imminentDays?: number | null;
}): { rows: YearRow[]; totals: { collected: number; overdue: number; rest: number } } {
  const rows: Record<string, YearRow> = {};
  const row = (key: string, unit: string | null, name: string | null, past: boolean) =>
    (rows[key] ||= { key, unit, name, past, collected: 0, overdue: 0, rest: 0, restCount: 0 });
  for (const t of input.tenants || []) {
    const r = row(`t:${t.id}`, t.unit ?? null, t.name ?? null, false);
    const u = yearUncollected([t], { graceDays: input.graceDays, yearEnd: input.yearEnd, soonDays: input.soonDays, imminentDays: input.imminentDays });
    r.overdue += u.overdue; r.rest += u.restOfYear;
    if (u.restOfYear > 0.005) {
      const rent = Number(t.rent_amount) || 0;
      r.restCount = rent > 0 ? Math.ceil(u.restOfYear / rent - 1e-9) : 0;
    }
  }
  for (const x of input.payments || []) {
    const a = Number(x.amount) || 0;
    if (x.tenant_id) row(`t:${x.tenant_id}`, x.unit_label ?? null, x.payer_name ?? null, false).collected += a;
    else row(`p:${x.past_tenancy_id || x.payer_name || "?"}`, x.unit_label ?? null, x.payer_name ?? null, true).collected += a;
  }
  for (const p of input.past || []) {
    if (["settled", "written_off"].includes(String(p.debt_status))) continue;
    const left = (Number(p.debt_amount) || 0) - (Number(p.debt_paid) || 0);
    if (left <= 0.005) continue;
    row(`p:${p.id}`, p.unit ?? null, p.name ?? null, true).overdue += left;
  }
  const list = Object.values(rows).map((r) => ({ ...r, collected: r2(r.collected), overdue: r2(r.overdue), rest: r2(r.rest) }))
    .filter((r) => r.collected || r.overdue || r.rest || !r.past)
    .sort((a, b) => String(a.unit || "").localeCompare(String(b.unit || ""), "ar", { numeric: true }) || Number(a.past) - Number(b.past));
  const totals = { collected: r2(list.reduce((s, r) => s + r.collected, 0)), overdue: r2(list.reduce((s, r) => s + r.overdue, 0)),
                   rest: r2(list.reduce((s, r) => s + r.rest, 0)) };
  return { rows: list, totals };
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
  annual: number; occupied: number;                 // المؤجّرة: مجموع الإيجار السنوي وعددها
  vacant: number; vacantAnnual: number;             // الشاغرة وآخر إيجار سنوي لها
  expired: number; expiredAnnual: number;           // منها عقود انتهت ولم تُجدَّد (ضمن المؤجّرة)
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
    out.occupied++; out.annual += a;
    const st = contractState(t, {});
    if (st.daysToEnd !== null && st.daysToEnd < 0) { out.expired++; out.expiredAnnual += a; }
  }
  out.annual = r2(out.annual); out.vacantAnnual = r2(out.vacantAnnual); out.expiredAnnual = r2(out.expiredAnnual);
  return out;
}
