/**
 * 🛡️ حساب الأمانات (schema-v87 — طلب مكتب «الأولى»، 16 نوفمبر 2026).
 *
 * مال يمرّ بالمكتب وليس إيجارًا ولا مصروفًا على المالك:
 *  - تأمين المستأجر: يُستلم عند العقد ويُردّ (كله أو بعضه) عند الإخلاء.
 *  - حصص العداد المشترك: عدّة شقق/معارض على عداد واحد، كلٌّ يرسل حصته من
 *    الفاتورة، والمكتب يسدّد الفاتورة كاملة — الناتج صفر.
 *
 * لماذا جدول مستقل لا «دفعة» بنوع آخر: مجموع الدفعات يُقرأ في أكثر من 15
 * موضعًا (المحصَّل، تقرير المالك، الأتعاب، الضريبة، الكشوف…). أي مبلغ يدخل
 * payments يصير دخلًا للمالك وتُحسب عليه أتعاب المكتب. هنا لا يصل إليها أبدًا.
 *
 * هذا الملف نقيّ (بلا React ولا Supabase) ليُختبر وحده.
 */

export type TrustKind = "deposit_in" | "deposit_out" | "utility_in" | "utility_out";

export type TrustRow = {
  id: string;
  property_id: string;
  tenant_id?: string | null;
  unit?: string | null;
  kind: TrustKind;
  amount: number | string;
  entry_on: string;
  method?: string | null;
  party?: string | null;
  meter?: string | null;
  bill_period?: string | null;
  reference?: string | null;
  note?: string | null;
  doc_no?: string | null;
  source_payment?: string | null;
  created_at?: string | null;
};

export const TRUST_KINDS: { v: TrustKind; l: string; icon: string; hint: string }[] = [
  { v: "deposit_in", l: "استلام مبلغ الضمان", icon: "🛡️", hint: "من المستأجر عند العقد — لا يدخل الإيجار ولا تقرير المالك" },
  { v: "deposit_out", l: "استرداد مبلغ الضمان", icon: "↩︎", hint: "للمستأجر عند الإخلاء — كاملًا أو بعد الخصم" },
  { v: "utility_in", l: "حصة فاتورة مشتركة", icon: "⚡", hint: "حصة مستأجر من فاتورة عداد مشترك" },
  { v: "utility_out", l: "سداد فاتورة مشتركة", icon: "🧾", hint: "سداد المكتب للفاتورة كاملة — يقابل الحصص" },
];

const KIND_MAP = Object.fromEntries(TRUST_KINDS.map((k) => [k.v, k])) as Record<TrustKind, (typeof TRUST_KINDS)[number]>;

export const isTrustKind = (k: unknown): k is TrustKind => typeof k === "string" && k in KIND_MAP;
export const trustKindLabel = (k?: string | null) => (isTrustKind(k) ? KIND_MAP[k].l : "أمانة");
export const trustKindIcon = (k?: string | null) => (isTrustKind(k) ? KIND_MAP[k].icon : "•");
/** قبض (يدخل الأمانات) أم صرف (يخرج منها) */
export const isTrustIn = (k?: string | null) => k === "deposit_in" || k === "utility_in";
export const isDepositKind = (k?: string | null) => k === "deposit_in" || k === "deposit_out";

/** عنوان السند المطبوع — قبض TR أو صرف TV */
export function trustDocTitle(k?: string | null): string {
  switch (k) {
    case "deposit_in": return "سند قبض مبلغ ضمان";
    case "utility_in": return "سند قبض حصة فاتورة";
    case "deposit_out": return "سند صرف — استرداد مبلغ الضمان";
    case "utility_out": return "سند صرف — سداد فاتورة";
    default: return "سند أمانة";
  }
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** موجب للقبض، سالب للصرف */
export const trustSigned = (r: Pick<TrustRow, "kind" | "amount">) => (isTrustIn(r.kind) ? 1 : -1) * Math.abs(num(r.amount));

export type DepositBalance = { tenant_id: string | null; unit: string; party: string; received: number; refunded: number; held: number };
export type MeterBalance = { meter: string; collected: number; paid: number; balance: number };

/**
 * التأمين المحتفَظ به لكل وحدة: المستلم − المردود.
 * القيد بلا وحدة (وحدة حُذفت مثلًا) يُجمع تحت «unit» المكتوب فيه.
 */
export function depositBalances(rows: TrustRow[]): DepositBalance[] {
  const m = new Map<string, DepositBalance>();
  for (const r of rows || []) {
    if (!isDepositKind(r.kind)) continue;
    const key = r.tenant_id ? `t:${r.tenant_id}` : `u:${String(r.unit || "").trim()}`;
    const cur = m.get(key) || { tenant_id: r.tenant_id || null, unit: String(r.unit || "").trim(), party: String(r.party || "").trim(), received: 0, refunded: 0, held: 0 };
    if (r.kind === "deposit_in") cur.received = r2(cur.received + Math.abs(num(r.amount)));
    else cur.refunded = r2(cur.refunded + Math.abs(num(r.amount)));
    if (!cur.unit && r.unit) cur.unit = String(r.unit).trim();
    if (!cur.party && r.party) cur.party = String(r.party).trim();
    cur.held = r2(cur.received - cur.refunded);
    m.set(key, cur);
  }
  return Array.from(m.values()).sort((a, b) => a.unit.localeCompare(b.unit, "ar", { numeric: true }));
}

/**
 * رصيد كل عداد مشترك: الحصص المستلمة − الفواتير المسدَّدة.
 * صفر = متوازن. موجب = حصص عند المكتب لم تُسدَّد بها الفاتورة بعد.
 * سالب = المكتب سدّد أكثر مما جمع (حصص لم تصل).
 */
export function meterBalances(rows: TrustRow[]): MeterBalance[] {
  const m = new Map<string, MeterBalance>();
  for (const r of rows || []) {
    if (isDepositKind(r.kind) || !isTrustKind(r.kind)) continue;
    const meter = String(r.meter || "").trim();
    const cur = m.get(meter) || { meter, collected: 0, paid: 0, balance: 0 };
    if (r.kind === "utility_in") cur.collected = r2(cur.collected + Math.abs(num(r.amount)));
    else cur.paid = r2(cur.paid + Math.abs(num(r.amount)));
    cur.balance = r2(cur.collected - cur.paid);
    m.set(meter, cur);
  }
  return Array.from(m.values()).sort((a, b) => a.meter.localeCompare(b.meter, "ar", { numeric: true }));
}

export type TrustTotals = { depositHeld: number; utilityBalance: number; total: number };
export function trustTotals(rows: TrustRow[]): TrustTotals {
  let dep = 0, util = 0;
  for (const r of rows || []) {
    if (!isTrustKind(r.kind)) continue;
    if (isDepositKind(r.kind)) dep += trustSigned(r); else util += trustSigned(r);
  }
  return { depositHeld: r2(dep), utilityBalance: r2(util), total: r2(dep + util) };
}

export type TrustDraft = {
  kind: TrustKind | string; amount: number | string; entry_on: string;
  tenant_id?: string | null; meter?: string | null; party?: string | null;
};

/**
 * فحص القيد قبل الحفظ. يرجع { errors } تمنع الحفظ و { warnings } تُعرض للتأكيد.
 * `heldForTenant`: التأمين المحتفظ به للوحدة المختارة (لاسترداد أكثر منه).
 */
export function checkTrustDraft(d: TrustDraft, opts: { today: string; heldForTenant?: number; meterBalance?: number } ): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  if (!isTrustKind(d.kind)) errors.push("اختر نوع القيد.");
  const amt = num(d.amount);
  if (!(amt > 0)) errors.push("المبلغ يجب أن يكون أكبر من صفر.");
  if (amt > 10_000_000) errors.push("المبلغ أكبر من المعقول — راجع الرقم.");
  const day = String(d.entry_on || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) errors.push("التاريخ مطلوب.");
  else if (day > opts.today) errors.push("التاريخ بعد اليوم — اكتب يوم وصول المال أو صرفه فعلًا.");
  if (isDepositKind(d.kind) && !d.tenant_id) errors.push("اختر الوحدة — مبلغ الضمان يُتابَع لكل وحدة.");
  if (d.kind === "deposit_out" && d.tenant_id && amt > 0) {
    const held = num(opts.heldForTenant);
    if (amt - held > 0.005) warnings.push(held > 0
      ? `المسترد (${amt}) أكبر من مبلغ الضمان المسجَّل استلامه لهذه الوحدة (${held}).`
      : "لا يوجد مبلغ ضمان مسجَّل استلامه لهذه الوحدة — سجّل الاستلام أولًا إن كان وصل قبل استخدام وثيق.");
  }
  if (d.kind === "utility_out" && amt > 0 && opts.meterBalance !== undefined) {
    const bal = num(opts.meterBalance);
    if (amt - bal > 0.005) warnings.push(`الفاتورة (${amt}) أكبر من الحصص المستلمة لهذا العداد (${bal}) — الفرق يظهر رصيدًا سالبًا حتى تصل الحصص.`);
  }
  if (!isDepositKind(d.kind) && !String(d.meter || "").trim()) warnings.push("بلا رقم عداد لن تُطابَق الحصص بفاتورتها — يُستحسن كتابته.");
  return { errors, warnings };
}
