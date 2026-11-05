// ============================================================
// وثيق — قسم الصيانة (schema-v79، 5 نوفمبر 2026)
// دوال نقية بلا شبكة: الترتيب والفلترة وعمر الطلب ونصوص واتساب.
// تُستعمل في صفحة الصيانة وتُختبر في tests/maintenance.js.
// ============================================================
import { requestCatAr, requestLocAr } from "./hoaMoney";

export type MaintStatus = "new" | "in_progress" | "done" | "rejected";
export type MaintRequest = {
  id: string; property_id: string; tenant_id: string | null; tenant_name: string | null; unit: string | null;
  category: string; location: string; description: string; status: MaintStatus;
  manager_note: string | null; created_at: string; updated_at?: string | null; closed_at?: string | null;
  /* v79 — غائبة قبل تشغيل الملف، فكلها اختيارية */
  priority?: "normal" | "urgent" | null; source?: "tenant" | "office" | null;
  tech_name?: string | null; tech_phone?: string | null; visit_date?: string | null;
  cost?: number | null; expense_id?: string | null;
};

export const STATUS_META: Record<MaintStatus, { label: string; bar: string; pill: string }> = {
  new:         { label: "جديد",        bar: "bg-[#C9861A]", pill: "bg-[#FDF0DC] text-[#8A5A11] border-[#F1D9AE]" },
  in_progress: { label: "قيد التنفيذ", bar: "bg-[#2F6FB0]", pill: "bg-[#E6F0FA] text-[#1F4F80] border-[#C7DBF0]" },
  done:        { label: "أُنجز",       bar: "bg-paid",      pill: "bg-[#E3F4EA] text-paid border-[#BFE3CD]" },
  rejected:    { label: "مرفوض",       bar: "bg-[#9AA5A2]", pill: "bg-[#F1F1EF] text-muted border-line" },
};

/** أيقونة كل فئة (أسماء Icon) ولون خلفيتها */
export const CAT_ICON: Record<string, { icon: "drop" | "bolt" | "elevator" | "broom" | "lock" | "snow" | "wrench"; tint: string }> = {
  plumbing: { icon: "drop",     tint: "bg-[#E6F0FA] text-[#1F4F80]" },
  electric: { icon: "bolt",     tint: "bg-[#FDF0DC] text-[#8A5A11]" },
  elevator: { icon: "elevator", tint: "bg-[#EEE9F8] text-[#4B3A8A]" },
  cleaning: { icon: "broom",    tint: "bg-[#E3F4EA] text-paid" },
  security: { icon: "lock",     tint: "bg-[#F1F1EF] text-ink" },
  ac:       { icon: "snow",     tint: "bg-[#E4F5F7] text-[#16656F]" },
  other:    { icon: "wrench",   tint: "bg-paper2 text-deep" },
};
export const catIcon = (c?: string | null) => CAT_ICON[c || "other"] || CAT_ICON.other;

export const isOpen = (r: Pick<MaintRequest, "status">) => r.status === "new" || r.status === "in_progress";
export const isUrgent = (r: Pick<MaintRequest, "priority">) => r.priority === "urgent";

/** يوم الرياض (YYYY-MM-DD) لطابع زمني */
export function riyadhDay(ts?: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** عدد الأيام الكاملة بين يومين (YYYY-MM-DD) */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** عمر الطلب بالأيام: المفتوح حتى اليوم، والمغلق حتى إغلاقه */
export function ageDays(r: MaintRequest, today: string): number {
  const end = isOpen(r) ? today : (riyadhDay(r.closed_at) || today);
  return Math.max(0, daysBetween(riyadhDay(r.created_at), end));
}

/** حدّ التأخر: العاجل بعد يوم، والعادي بعد 3 أيام — ما دام مفتوحًا */
export const LATE_AFTER = { urgent: 1, normal: 3 } as const;
export function isLate(r: MaintRequest, today: string): boolean {
  if (!isOpen(r)) return false;
  return ageDays(r, today) > (isUrgent(r) ? LATE_AFTER.urgent : LATE_AFTER.normal);
}

export function agePhrase(days: number): string {
  if (days <= 0) return "اليوم";
  if (days === 1) return "منذ يوم";
  if (days === 2) return "منذ يومين";
  if (days <= 10) return `منذ ${days} أيام`;
  return `منذ ${days} يومًا`;
}

export type MaintFilter = { status: "open" | MaintStatus | "all"; property: string; q: string; urgentOnly: boolean };
export const DEFAULT_FILTER: MaintFilter = { status: "open", property: "", q: "", urgentOnly: false };

const norm = (s: unknown) => String(s ?? "").toLowerCase()
  .replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();

export function matchesFilter(r: MaintRequest, f: MaintFilter, propertyName: (id: string) => string): boolean {
  if (f.status === "open" ? !isOpen(r) : f.status !== "all" && r.status !== f.status) return false;
  if (f.property && r.property_id !== f.property) return false;
  if (f.urgentOnly && !isUrgent(r)) return false;
  const q = norm(f.q);
  if (q) {
    const hay = norm([r.tenant_name, r.unit, r.description, r.tech_name, propertyName(r.property_id), requestCatAr(r.category)].join(" "));
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/**
 * ترتيب يخدم من يعمل: المفتوح أولًا، والعاجل قبل العادي، والجديد قبل قيد التنفيذ،
 * ثم الأقدم أولًا (الأقدم أحق بالانتباه). المغلق بعده: الأحدث إغلاقًا أولًا.
 */
export function sortRequests(rows: MaintRequest[]): MaintRequest[] {
  const rank = (r: MaintRequest) => (isOpen(r) ? 0 : 1);
  return [...rows].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 0) {
      if (isUrgent(a) !== isUrgent(b)) return isUrgent(a) ? -1 : 1;
      if (a.status !== b.status) return a.status === "new" ? -1 : 1;
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    }
    const ac = a.closed_at || a.updated_at || a.created_at, bc = b.closed_at || b.updated_at || b.created_at;
    return ac < bc ? 1 : ac > bc ? -1 : 0;
  });
}

export function counts(rows: MaintRequest[], today: string) {
  let open = 0, fresh = 0, working = 0, urgent = 0, late = 0, done = 0;
  for (const r of rows) {
    if (isOpen(r)) {
      open++;
      if (r.status === "new") fresh++; else working++;
      if (isUrgent(r)) urgent++;
      if (isLate(r, today)) late++;
    } else if (r.status === "done") done++;
  }
  return { open, fresh, working, urgent, late, done, all: rows.length };
}

/** تاريخ عربي قصير «12 نوفمبر» من YYYY-MM-DD */
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export function shortDate(d?: string | null): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return "";
  const [, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[m - 1] || ""}`;
}

/** رسالة واتساب للمستأجر: حالة طلبه بلغة بسيطة */
export function tenantUpdateText(r: MaintRequest, o: { org?: string | null; unitWord?: string; note?: string | null }): string {
  const hello = `السلام عليكم${r.tenant_name ? ` ${r.tenant_name}` : ""}،`;
  const what = `بخصوص طلب الصيانة (${requestCatAr(r.category)})${r.unit ? ` في ${o.unitWord || "الوحدة"} ${r.unit}` : ""}:`;
  const L = [hello, what];
  if (r.status === "new") L.push("وصلنا طلبك وجارٍ ترتيب الفني.");
  else if (r.status === "in_progress") L.push(r.visit_date ? `الفني${r.tech_name ? ` (${r.tech_name})` : ""} يزوركم يوم ${shortDate(r.visit_date)} بإذن الله.` : "طلبك قيد التنفيذ، ونبلغك بموعد الفني.");
  else if (r.status === "done") L.push("تمت الصيانة ✓ — إذا بقي أي شيء بلّغنا.");
  else L.push("نعتذر، لم نتمكن من تنفيذ الطلب.");
  const note = (o.note ?? r.manager_note ?? "").trim();
  if (note) L.push(note);
  if (o.org) L.push("", o.org);
  return L.join("\n");
}

/** رسالة واتساب للفني: كل ما يحتاجه ليذهب مباشرة */
export function techText(r: MaintRequest, o: { property: string; tenantPhone?: string | null; unitWord?: string; org?: string | null }): string {
  const L = [`طلب صيانة${isUrgent(r) ? " — 🚨 عاجل" : ""}`, ""];
  L.push(`🔧 النوع: ${requestCatAr(r.category)} · ${requestLocAr(r.location)}`);
  L.push(`🏢 العقار: ${o.property}`);
  if (r.unit) L.push(`🚪 ${o.unitWord || "الوحدة"}: ${r.unit}`);
  if (r.tenant_name) L.push(`👤 المستأجر: ${r.tenant_name}${o.tenantPhone ? ` — ${o.tenantPhone}` : ""}`);
  L.push(`📝 المشكلة: ${r.description}`);
  if (r.visit_date) L.push(`📅 الموعد: ${shortDate(r.visit_date)}`);
  if (o.org) L.push("", o.org);
  return L.join("\n");
}

/** وصف مصروف الصيانة كما يظهر في سند الصرف وتقرير المالك */
export function expenseNote(r: MaintRequest): string {
  const d = r.description.replace(/\s+/g, " ").trim();
  return `صيانة: ${requestCatAr(r.category)}${r.unit ? ` — وحدة ${r.unit}` : ""} — ${d.length > 80 ? d.slice(0, 80) + "…" : d}`.slice(0, 200);
}

/** مسار صور الطلب في دلو maintenance-photos */
export const photoDir = (office: string, requestId: string) => `${office}/${requestId}`;
export const PHOTO_BUCKET = "maintenance-photos";
export const MAX_PHOTOS_PER_SIDE = 6;
