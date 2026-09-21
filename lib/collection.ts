// ============================================================
// وثيق — حساب «كشف التحصيل» (كان داخل CollectionStatementModal)
//
// نُقل هنا ليستعمله المكوّن وتختبره الدراسة بالمنطق نفسه. وأُصلح فيه:
//  • الصافي بمعادلة تقرير المالك نفسها (ownerNet): كان «المسجَّل − المصروفات»
//    فلا يطرح ضريبة الهيئة ولا الأتعاب — فللمالك ثلاثة «صافٍ» في ثلاثة مستندات.
//  • المصروفات: ما على المالك (billable) أيًّا كان دافعها — كان يستبعد ما
//    دفعه المكتب عن المالك ليسترده، فيخالف تقرير المالك.
//  • ترقيم الأقساط من بداية مدة العقد لا من بداية الفترة: كشف يوليو كان
//    يسمّي أول دفعة فيه «القسط الأول» وهي السابعة.
//  • دفعات الدين (مرحَّل/سابق) ودفعات مدة سابقة تُسمّى بما هي، لا أقساطًا.
// ============================================================
import { ownerNet } from "@/lib/expenses";
import { vatOfPaymentsFor, type PastVat } from "@/lib/documents";

export type CollectionRowX = {
  property: string; unit: string | null; tenant: string | null; paid_on: string; amount: number;
  statement: string; contract_no: string | null; calendar?: string | null;
  /** للاختبار: نطاق الأقساط الذي غطّته الدفعة، أو نوعها إن لم تكن قسطًا */
  _from?: number; _to?: number; _kind?: "rent" | "carried" | "past" | "old_term" | "adjust";
};

const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
const ord = (n: number) => (n <= 10 ? `القسط ${ORD[n]}` : `القسط ${n}`);
const r2 = (n: number) => Math.round(n * 100) / 100;
const sarF = (n: number) => { const v = Math.abs(Number(n) || 0); return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const inTerm = (x: any, t: any) => {
  const b = t?.term_started_at ? String(t.term_started_at) : null;
  return !b || /infinity/.test(b) || String(x.created_at || "") >= b;
};

export function buildCollection(input: {
  periodPayments: any[];            // دفعات الفترة (كل الأنواع، مرتّبة بالتاريخ)
  allTenantPayments: any[];         // كل دفعات الساكنين الحاليين (كل الأوقات) — للترقيم
  expenses: any[];                  // مصروفات الفترة (كل الحقول)
  tenants: any[];                   // صفوف الساكنين الحاليين (كل الحقول)
  properties: any[];                // العقارات (بإعدادات الضريبة ونسبة الأتعاب)
  pastVat?: PastVat;
  issuer?: { vat_number?: string | null };
  from: string;
}) {
  const { periodPayments, allTenantPayments, expenses, tenants, properties, pastVat, issuer, from } = input;
  const pName: Record<string, string> = Object.fromEntries((properties || []).map((p: any) => [p.id, p.name]));
  const tById: Record<string, any> = Object.fromEntries((tenants || []).map((t: any) => [t.id, t]));

  // ── إسقاط الدفعة المعكوسة مع عكسها (المنطق السابق كما هو) ──
  const positives = (periodPayments || []).filter((x: any) => Number(x.amount) > 0);
  const reversals = (periodPayments || []).filter((x: any) => Number(x.amount) < 0);
  const dropped = new Set<string>(); const unmatched: any[] = [];
  for (const rev of reversals) {
    const amt = Math.abs(Number(rev.amount));
    const hit = (rev.reverses && positives.find((x: any) => !dropped.has(x.id) && x.id === rev.reverses))
      || positives.find((x: any) => !dropped.has(x.id) && String(x.tenant_id) === String(rev.tenant_id) && Math.abs(Number(x.amount) - amt) < 0.01);
    if (hit) dropped.add(hit.id); else unmatched.push(rev);
  }
  const clean = positives.filter((x: any) => !dropped.has(x.id));

  // ── رصيد كل ساكن قبل بداية الفترة: الافتتاحي + أقساط مدته قبلها ──
  const credit: Record<string, number> = {};
  for (const t of tenants || []) {
    const rent = Number(t.rent_amount) || 0; if (rent <= 0) continue;
    const term = (allTenantPayments || []).filter((x: any) => x.tenant_id === t.id && (x.applies_to || "rent") === "rent" && inTerm(x, t));
    const recorded = term.reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0);
    const counted = (Number(t.paid_periods) || 0) * rent + (Number(t.partial_amount) || 0);
    const opening = Math.max(0, r2(counted - recorded));                         // دُفع قبل التسجيل
    const beforeFrom = term.filter((x: any) => String(x.paid_on) < from).reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0);
    credit[t.id] = r2(opening + beforeFrom);
  }

  const rows: CollectionRowX[] = clean.map((x: any) => {
    const t = (x.tenant_id && tById[x.tenant_id]) || {};
    const amt = Number(x.amount) || 0;
    const base = { property: pName[x.property_id] || "—", unit: t.unit ?? x.unit_label ?? null, tenant: t.name ?? x.payer_name ?? null,
      paid_on: x.paid_on, amount: amt, contract_no: t.contract_no || (x.reference ? `حوالة ${x.reference}` : null), calendar: t.calendar };
    if (!x.tenant_id) return { ...base, statement: x.applies_to === "past_debt" || x.note === "سداد دين مستأجر سابق" ? "سداد دين مستأجر سابق" : "دفعة (مستأجر سابق)", _kind: "past" as const };
    if (x.applies_to === "carried") return { ...base, statement: "سداد دين مرحَّل", _kind: "carried" as const };
    if (!inTerm(x, t)) return { ...base, statement: "دفعة من مدة سابقة", _kind: "old_term" as const };
    const rent = Number(t.rent_amount) || 0;
    if (rent <= 0) return { ...base, statement: "دفعة", _kind: "rent" as const };
    const before = credit[t.id] || 0, after = r2(before + amt); credit[t.id] = after;
    const idx = Math.floor(before / rent + 1e-9) + 1;
    const doneBefore = r2(before - (idx - 1) * rent);
    let st: string, last = idx;
    if (Math.floor(after / rent + 1e-9) > Math.floor(before / rent + 1e-9)) {
      last = Math.ceil((after - 0.01) / rent);
      st = last > idx ? `الأقساط ${idx}–${last}` : doneBefore > 0.01 ? `إكمال ${ord(idx)}` : ord(idx);
    } else {
      st = `جزء من ${ord(idx)} — باقٍ ${sarF(r2(idx * rent - after))}`;
    }
    const note = x.note && !/بوت|تراجع|عكس/.test(String(x.note)) && !/^جزء من/.test(st) ? ` · ${x.note}` : "";
    return { ...base, statement: st + note, _from: idx, _to: last, _kind: "rent" as const };
  });
  for (const rev of unmatched) {
    const t = tById[rev.tenant_id] || {};
    rows.push({ property: pName[rev.property_id] || "—", unit: t.unit ?? rev.unit_label ?? null, tenant: t.name ?? rev.payer_name ?? null,
      paid_on: rev.paid_on, amount: Number(rev.amount) || 0, statement: "تصحيح لدفعة مسجَّلة سابقًا",
      contract_no: t.contract_no || null, calendar: t.calendar, _kind: "adjust" });
  }
  rows.sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)));

  // ── المصروفات والصافي بمعادلة تقرير المالك، لكل عقار ثم المجموع ──
  const billable = (expenses || []).filter((e: any) => e.billable !== false);
  const expRows = billable.map((e: any) => ({ note: e.note, category: e.category, amount: Number(e.amount) || 0 }));
  const fin = { gross: 0, vat: 0, collected: 0, expenses: 0, fee: 0, feeVat: 0, net: 0, ownerPaid: 0, feePcts: [] as number[] };
  for (const p of properties || []) {
    const pays = (periodPayments || []).filter((x: any) => x.property_id === p.id);
    const unitOf: Record<string, string> = Object.fromEntries((tenants || []).filter((t: any) => t.property_id === p.id).map((t: any) => [t.id, t.unit]));
    const payU = pays.map((x: any) => ({ ...x, unit: (x.tenant_id && unitOf[x.tenant_id]) || x.unit_label || null }));
    const vt = vatOfPaymentsFor({ ...p, tenants: (tenants || []).filter((t: any) => t.property_id === p.id) }, payU, pastVat);
    const exps = billable.filter((e: any) => e.property_id === p.id);
    const recorded = pays.reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0);
    const f = ownerNet(recorded + vt.onTop, exps, p.mgmt_fee_pct, vt.inside + vt.onTop, issuer?.vat_number ? (Number(p.vat_rate) || 15) : 0);
    fin.gross += f.grossCollected ?? f.collected; fin.vat += f.vatCollected ?? 0; fin.collected += f.collected;
    fin.expenses += f.expenses; fin.fee += f.feeBase ?? f.fee; fin.feeVat += f.feeVat ?? 0; fin.net += f.net;
    fin.ownerPaid += exps.filter((e: any) => e.paid_by === "owner").reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0);
    if (f.feePct !== null && !fin.feePcts.includes(f.feePct)) fin.feePcts.push(f.feePct);
  }
  for (const k of ["gross", "vat", "collected", "expenses", "fee", "feeVat", "net", "ownerPaid"] as const) (fin as any)[k] = r2((fin as any)[k]);
  return { rows, expRows, fin };
}
