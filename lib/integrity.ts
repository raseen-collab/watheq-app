// ============================================================
// وثيق — فحص سلامة البيانات
//
// لماذا هذا الملف موجود:
// أغلب شكاوى المكاتب لم تكن أعطالًا برمجية بل بيانات معطوبة لا يراها أحد —
// وحدة مؤجّرة بلا تاريخ بداية تظهر «منتظمة» وهي خارج كل حساب، وعقد هجري
// مسجّل بتقويم ميلادي تنزاح استحقاقاته أيامًا، ووحدة مكرّرة تنقسم دفعاتها.
// الاختبارات تفحص المنطق على بيانات مثالية؛ هذا يفحص بيانات المكتب نفسها.
//
// دوال نقية بلا شبكة: تُستدعى من الصفحة وتُختبر مباشرة.
// ============================================================

import { contractState, isVacant, unitVatApplies, type Frequency } from "./contracts";

export type Severity = "critical" | "warn" | "info";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  why: string;              // لماذا يهمّ — بأثره لا بوصفه
  fix: string;              // ما يفعله المستخدم
  propertyId?: string;
  propertyName?: string;
  unit?: string | null;
  tenantId?: string;
  tenantName?: string | null;
};

type T = any; type P = any;

const num = (v: any) => Number(v) || 0;
const isRealDate = (s?: string | null) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
const yearOf = (s?: string | null) => Number(String(s || "").slice(0, 4)) || 0;

/** تحويل تاريخ ميلادي إلى هجري للمقارنة — لكشف العقد الهجري المسجّل ميلاديًّا */
const H_FMT = typeof Intl !== "undefined"
  ? new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" })
  : null;
function hijriDay(iso: string): number | null {
  if (!H_FMT) return null;
  try {
    const parts = H_FMT.formatToParts(new Date(iso + "T12:00:00Z"));
    return Number(parts.find((x) => x.type === "day")?.value) || null;
  } catch { return null; }
}

/**
 * الفحص الكامل لحساب مكتب.
 * يُرجع قائمة ملاحظات مرتّبة بالخطورة — كل واحدة تسمّي الوحدة وتقول ماذا يُفعل.
 */
export function auditOffice(properties: P[], payments: any[] = [], expenses: any[] = []): Finding[] {
  const out: Finding[] = [];
  const push = (f: Omit<Finding, "id">) => out.push({ id: `${f.propertyId || ""}:${f.tenantId || ""}:${f.title}`, ...f });

  const propById: Record<string, P> = {};
  properties.forEach((p) => { propById[p.id] = p; });

  for (const p of properties) {
    const tenants: T[] = Array.isArray(p.tenants) ? p.tenants : [];
    const W = { graceDays: num(p.grace_days), soonDays: num(p.soon_days) || 10, imminentDays: num(p.imminent_days) || 5, expiringDays: num(p.expiring_days) || 60 };

    // ── على مستوى العقار ──
    if (!String(p.name || "").trim()) {
      push({ severity: "warn", title: "عقار بلا اسم", propertyId: p.id, propertyName: p.name,
        why: "يظهر فارغًا في كل الكشوف والقوائم.", fix: "افتح إعدادات العقار وأضف الاسم." });
    }
    if (p.vat_enabled && !(num(p.vat_rate) > 0)) {
      push({ severity: "warn", title: "الضريبة مفعّلة بنسبة صفر", propertyId: p.id, propertyName: p.name,
        why: "الفواتير ستخرج بلا ضريبة رغم تفعيلها.", fix: "حدّد نسبة الضريبة في إعدادات العقار (15% غالبًا)." });
    }
    if (num(p.mgmt_fee_pct) > 50) {
      push({ severity: "warn", title: `أتعاب إدارة مرتفعة (${p.mgmt_fee_pct}%)`, propertyId: p.id, propertyName: p.name,
        why: "تُخصم من صافي المالك في كل تقرير — تحقّق أنها ليست خطأ إدخال.", fix: "راجع النسبة في إعدادات العقار." });
    }

    // ── تكرار أرقام الوحدات المؤجّرة ──
    const seen: Record<string, T> = {};
    for (const t of tenants) {
      const u = String(t.unit || "").trim();
      if (!u || isVacant(t)) continue;
      if (seen[u]) {
        /* ملاحظة واحدة للطرفين لا اثنتان: التكرار حالة واحدة لا حالتان */
        push({ severity: "critical", title: `رقم الوحدة ${u} مكرّر`, propertyId: p.id, propertyName: p.name, unit: u,
          tenantId: t.id, tenantName: `${seen[u].name} و${t.name}`,
          why: `وحدتان مؤجّرتان بالرقم نفسه («${seen[u].name}» و«${t.name}») — الدفعات تنقسم بينهما والتقارير تُضاعف الإيجار.`,
          fix: "سجّل إخلاء المستأجر السابق، أو صحّح رقم إحدى الوحدتين." });
      } else seen[u] = t;
    }

    // ── على مستوى الوحدة ──
    for (const t of tenants) {
      const vac = isVacant(t);
      const st = contractState(t, W);
      const base = { propertyId: p.id, propertyName: p.name, unit: t.unit, tenantId: t.id, tenantName: t.name };
      /* تاريخ بداية فاسد يولّد ملاحظات تابعة مضلّلة («عقد منتهٍ منذ 211,288 يومًا»).
         نُبلّغ عن السبب الجذري وحده، ونصمت عمّا اشتُقّ منه. */
      const badStart = !!t.contract_start &&
        (!isRealDate(String(t.contract_start).slice(0, 10)) || yearOf(t.contract_start) < 1900 || yearOf(t.contract_start) > 2100);

      if (!vac && !t.contract_start) {
        push({ severity: "critical", title: "وحدة مؤجّرة بلا تاريخ بداية عقد", ...base,
          why: "لا يستطيع النظام حساب أي استحقاق ولا نهاية عقد — الوحدة خارج المتابعة كليًّا ولا تظهر في التذكيرات.",
          fix: "افتح الوحدة وأدخل تاريخ بداية العقد من العقد الورقي." });
      }
      if (t.contract_start && !isRealDate(String(t.contract_start).slice(0, 10))) {
        push({ severity: "critical", title: `تاريخ بداية غير صحيح: ${t.contract_start}`, ...base,
          why: "تاريخ لا وجود له يفسد كل الاستحقاقات المحسوبة منه.", fix: "أعد إدخال تاريخ البداية." });
      }
      const y = yearOf(t.contract_start);
      if (y && (y < 1900 || y > 2100)) {
        push({ severity: "critical", title: `سنة بداية العقد غير معقولة (${y})`, ...base,
          why: y < 1900 ? "يبدو تاريخًا هجريًّا حُفظ في خانة ميلادية — كل الحسابات ستكون خاطئة." : "سنة بعيدة في المستقبل.",
          fix: "افتح الوحدة، اضغط «هجري» فوق خانة التاريخ، وأدخل التاريخ الصحيح." });
      }

      // العقد الهجري المسجّل بتقويم ميلادي — أشيع خطأ صامت
      if (!vac && !badStart && t.contract_start && String(t.calendar || "gregorian") !== "hijri") {
        const hd = hijriDay(String(t.contract_start).slice(0, 10));
        // يوم هجري «مستدير» (1 أو 15) مع عقد مكتوب بالهجري غالبًا
        if (hd === 1 || hd === 15) {
          push({ severity: "warn", title: "قد يكون العقد هجريًّا والتقويم ميلادي", ...base,
            why: "بداية العقد تقع على يوم هجري مستدير (1 أو 15) بينما الأقساط تُحسب بأشهر ميلادية — ينزاح الاستحقاق نحو 11 يومًا كل سنة.",
            fix: "إن كان عقدك مكتوبًا بالهجري، غيّر «تُحسب الأقساط بالتقويم» إلى هجري." });
        }
      }

      if (!vac && !(num(t.rent_amount) > 0)) {
        push({ severity: "critical", title: "وحدة مؤجّرة بإيجار صفر", ...base,
          why: "لا تُحتسب لها مستحقات ولا تدخل في الدخل المتوقع — تبدو منتظمة وهي غائبة عن الحساب.",
          fix: "أدخل قيمة الدفعة الواحدة (لا الإيجار السنوي)." });
      }
      if (num(t.rent_amount) < 0) {
        push({ severity: "critical", title: "إيجار سالب", ...base,
          why: "يقلب كل الحسابات المبنية عليه.", fix: "صحّح قيمة الدفعة." });
      }
      if (!vac && !(num(t.contract_periods) > 0)) {
        push({ severity: "warn", title: "عدد الدفعات غير محدّد", ...base,
          why: "يُستعمل الافتراضي (سنة) وقد لا يطابق مدة عقدك الحقيقية.",
          fix: "حدّد مدة العقد في بطاقة الوحدة." });
      }
      if (num(t.paid_periods) > num(t.contract_periods) && num(t.contract_periods) > 0) {
        push({ severity: "warn", title: `مسدَّد ${t.paid_periods} من ${t.contract_periods} دفعة`, ...base,
          why: "المسدَّد أكثر من مدة العقد — إمّا سداد مقدَّم لمدة قادمة أو خطأ إدخال.",
          fix: "إن كان سدادًا لمدة جديدة فجدّد العقد؛ وإلا صحّح عدد الدفعات المسدَّدة." });
      }
      if (num(t.partial_amount) > num(t.rent_amount) && num(t.rent_amount) > 0) {
        push({ severity: "warn", title: "سداد جزئي أكبر من دفعة كاملة", ...base,
          why: "يُفترض أن يتحوّل إلى دفعة مكتملة — الرقم الحالي مضلّل.",
          fix: "افتح سجل المدفوعات وتحقّق من آخر دفعة." });
      }
      if (!vac && t.first_due && t.contract_start && String(t.first_due) < String(t.contract_start)) {
        push({ severity: "warn", title: "أول استحقاق قبل بداية العقد", ...base,
          why: "جدول الدفعات سيبدأ قبل سريان العقد.", fix: "امسح «أول استحقاق» أو صحّحه." });
      }
      if (vac && !t.move_out_date) {
        push({ severity: "info", title: "وحدة شاغرة بلا تاريخ إخلاء", ...base,
          why: "لا تُحسب مدة الشغور ولا تتوقف المتأخرات في تاريخها الصحيح.",
          fix: "أدخل تاريخ الإخلاء من بطاقة الوحدة." });
      }
      if (!vac && !badStart && st.incomplete === false && st.endDate && st.daysToEnd !== null && st.daysToEnd < -60 && !t.litigation) {
        push({ severity: "warn", title: `عقد منتهٍ منذ ${Math.abs(st.daysToEnd)} يومًا`, ...base,
          why: "الوحدة ما زالت مؤجّرة في النظام بعقد انتهى — لا تُحتسب لها دفعات جديدة.",
          fix: "جدّد العقد، أو سجّل الإخلاء إن غادر المستأجر." });
      }
      if (!vac && t.phone && !/^0?5\d{8}$/.test(String(t.phone).replace(/\D/g, "").replace(/^966/, "0"))) {
        push({ severity: "info", title: "رقم جوال غير صالح", ...base,
          why: "تذكير واتساب لن يصل هذا المستأجر.", fix: "صحّح الرقم (يبدأ بـ05 وطوله 10 أرقام)." });
      }
      if (num(t.carried_debt) > 0 && vac) {
        push({ severity: "info", title: `دين مرحَّل ${Math.round(num(t.carried_debt)).toLocaleString("en-US")} على وحدة شاغرة`, ...base,
          why: "دين على مستأجر سابق ما زال مفتوحًا — يحتاج متابعة أو شطبًا بقرار.",
          fix: "تابع التحصيل، أو صفّر الدين المرحَّل من بطاقة الوحدة إن سُوّي." });
      }
      // الضريبة على وحدة سكنية
      if (p.vat_enabled && t.vat_mode === "on" && ["apartment", "studio", "annex", "room"].includes(String(t.unit_type))) {
        push({ severity: "warn", title: "ضريبة مفروضة على وحدة سكنية", ...base,
          why: "الإيجار السكني معفى من ضريبة القيمة المضافة — الفاتورة ستطالب بمبلغ لا يُستحق.",
          fix: "غيّر «الضريبة» في بطاقة الوحدة إلى «تلقائي» أو «معفاة»." });
      }
    }
  }

  // ── الدفعات والمصروفات اليتيمة ──
  const tenantIds = new Set(properties.flatMap((p) => (p.tenants || []).map((t: T) => t.id)));
  const propIds = new Set(properties.map((p) => p.id));
  const orphanPays = (payments || []).filter((x) => x.tenant_id && !tenantIds.has(x.tenant_id)).length;
  if (orphanPays) {
    push({ severity: "warn", title: `${orphanPays} دفعة لوحدات محذوفة`,
      why: "مبالغ مسجّلة لا تظهر في أي كشف وحدة — تختلّ بها المطابقة مع البنك.",
      fix: "راجعها في سجل الحركات المالية." });
  }
  const orphanExp = (expenses || []).filter((x) => x.property_id && !propIds.has(x.property_id)).length;
  if (orphanExp) {
    push({ severity: "warn", title: `${orphanExp} مصروف لعقارات محذوفة`,
      why: "لا يظهر في تقرير أي مالك رغم خروجه من الصندوق.", fix: "راجعها في المصروفات." });
  }

  const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.propertyName).localeCompare(String(b.propertyName), "ar"));
}

export const SEV_META: Record<Severity, { label: string; icon: string; cls: string }> = {
  critical: { label: "يحتاج إصلاحًا الآن", icon: "🔴", cls: "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]" },
  warn:     { label: "يستحق المراجعة",    icon: "🟡", cls: "bg-[#FDF6E3] text-[#7a5c12] border-[#EAD9A8]" },
  info:     { label: "معلومة",            icon: "🔵", cls: "bg-[#EEF4FB] text-[#2B5C8A] border-[#CFE0F0]" },
};
