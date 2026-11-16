"use client";
/**
 * 🛡️ الأمانات — تأمين المستأجرين وحصص العدادات المشتركة (schema-v87).
 *
 * (16 نوفمبر 2026 — طلب مكتب «الأولى») مال يمرّ بالمكتب وليس إيجارًا:
 *  - تأمين يُستلم ويُردّ عند الإخلاء.
 *  - حصص فاتورة عداد مشترك يرسلها المستأجرون، ثم يسدّد المكتب الفاتورة — الناتج صفر.
 * لا يدخل شيء من هنا المحصَّل ولا تقرير المالك ولا الأتعاب ولا الضريبة.
 * كل قيد يصدر له سند مرقّم: قبض TR- أو صرف TV-.
 */
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, today } from "@/lib/utils";
import { arDate, openDoc, trustDocHTML } from "@/lib/documents";
import { unitWordFor } from "@/lib/domain";
import type { PropertyMeter } from "@/lib/meters";
import { TRUST_KINDS, trustKindLabel, trustKindIcon, isTrustIn, isDepositKind, depositBalances, meterBalances, trustTotals, checkTrustDraft,
  type TrustRow, type TrustKind } from "@/lib/trust";

const METHODS: { v: string; l: string }[] = [
  { v: "transfer", l: "تحويل بنكي" }, { v: "ejar", l: "منصة إيجار" }, { v: "cash", l: "نقدًا" },
  { v: "pos", l: "شبكة" }, { v: "cheque", l: "شيك" }, { v: "other", l: "أخرى" },
];
const methodL = (v?: string | null) => METHODS.find((m) => m.v === v)?.l || (v === "card" ? "بطاقة" : "أخرى");

export type TrustTenant = { id: string; name?: string | null; unit?: string | null; unit_type?: string | null; deposit_amount?: number | null; vacant?: boolean };

type Tab = "all" | "deposit" | "utility";

export default function TrustLedgerModal({ propertyId, propertyName, propertyType, tenants, meters, issuer, db, focusTenantId, canIn, canOut, canDelete, onClose }: {
  propertyId: string; propertyName: string; propertyType?: string | null;
  tenants: TrustTenant[]; meters?: PropertyMeter[] | null; issuer?: any; db?: any;
  /** فُتحت من قائمة وحدة: تُعرض قيودها ويُختار التأمين لها افتراضيًّا */
  focusTenantId?: string | null;
  canIn: boolean; canOut: boolean; canDelete: boolean;
  onClose: () => void;
}) {
  const supabase: any = useMemo(() => db || createClient(), [db]);
  const [rows, setRows] = useState<TrustRow[] | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [onlyTenant, setOnlyTenant] = useState<string | null>(focusTenantId || null);
  const [adding, setAdding] = useState<TrustKind | null>(null);
  const [editing, setEditing] = useState<TrustRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);
  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), k === "err" ? 7000 : 3500); }

  const tenantById = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);
  const uw = (t?: TrustTenant | null) => unitWordFor(t?.unit_type, propertyType);

  function friendly(e: any) {
    const t = String(e?.message || e);
    if (/trust_ledger|watheq_payment_to_trust/.test(t) && /(does not exist|schema cache|relation)/i.test(t))
      return "الأمانات تحتاج تحديث قاعدة البيانات (schema-v87) — تواصل معنا على واتساب 0550165210.";
    if (e?.code === "42501" || /row-level security|permission/i.test(t)) return "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.";
    return t;
  }

  async function load() {
    const { data, error } = await supabase.from("trust_ledger").select("*").eq("property_id", propertyId)
      .order("entry_on", { ascending: false }).order("created_at", { ascending: false }).limit(3000);
    if (error) { flash("err", friendly(error)); setRows([]); return; }
    setRows((data || []) as TrustRow[]);
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const all = rows || [];
  const totals = useMemo(() => trustTotals(all), [all]);
  const deps = useMemo(() => depositBalances(all), [all]);
  const mets = useMemo(() => meterBalances(all), [all]);
  const heldOf = (tid?: string | null) => (tid ? deps.find((d) => d.tenant_id === tid)?.held || 0 : 0);
  const meterBal = (m?: string | null) => mets.find((x) => x.meter === String(m || "").trim())?.balance || 0;

  const shown = all.filter((r) =>
    (tab === "all" || (tab === "deposit" ? isDepositKind(r.kind) : !isDepositKind(r.kind)))
    && (!onlyTenant || r.tenant_id === onlyTenant));

  /* اقتراحات العداد: عدادات العقار الرئيسية + ما كُتب في قيود سابقة */
  const meterHints = useMemo(() => {
    const s = new Set<string>();
    (meters || []).forEach((m) => m.account && s.add(String(m.account)));
    all.forEach((r) => r.meter && s.add(String(r.meter)));
    return Array.from(s);
  }, [meters, all]);

  function print(r: TrustRow) {
    const t = r.tenant_id ? tenantById.get(r.tenant_id) : null;
    openDoc(trustDocHTML(r, { name: propertyName, property_type: propertyType }, issuer || {}, t ? { unit: t.unit, unit_type: t.unit_type, name: t.name } : null));
  }

  async function save(d: Draft) {
    const { errors, warnings } = checkTrustDraft(d, { today: today(), heldForTenant: heldOf(d.tenant_id), meterBalance: d.kind === "utility_out" ? meterBal(d.meter) : undefined });
    if (errors.length) { flash("err", errors.join(" ")); return; }
    if (warnings.length && !confirm(`${warnings.join("\n\n")}\n\nحفظ القيد؟`)) return;
    setBusy(true);
    try {
      const uid = await officeId(supabase);
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const t = d.tenant_id ? tenantById.get(d.tenant_id) : null;
      const row = {
        user_id: uid, property_id: propertyId, tenant_id: d.tenant_id || null,
        unit: (t?.unit ? String(t.unit) : "").slice(0, 40) || null,
        kind: d.kind, amount: Math.round(Number(d.amount) * 100) / 100, entry_on: d.entry_on, method: d.method || "transfer",
        party: d.party.trim().slice(0, 160) || null, meter: isDepositKind(d.kind) ? null : (d.meter.trim().slice(0, 60) || null),
        bill_period: isDepositKind(d.kind) ? null : (d.bill_period.trim().slice(0, 40) || null),
        reference: d.reference.trim().slice(0, 80) || null, note: d.note.trim().slice(0, 300) || null,
      };
      const { data, error } = await supabase.from("trust_ledger").insert(row).select("*").single();
      if (error) throw error;
      setRows([data as TrustRow, ...all]);
      setAdding(null);
      flash("ok", `سُجّل ${trustKindLabel(d.kind)} · سند ${(data as TrustRow).doc_no || ""}`);
      print(data as TrustRow);
    } catch (e) { flash("err", friendly(e)); } finally { setBusy(false); }
  }

  async function saveEdit(r: TrustRow, p: { entry_on: string; reference: string; note: string; party: string; meter: string; bill_period: string }) {
    const day = String(p.entry_on || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return flash("err", "التاريخ مطلوب.");
    if (day > today()) return flash("err", "التاريخ بعد اليوم.");
    setBusy(true);
    const patch: any = { entry_on: day, reference: p.reference.trim() || null, note: p.note.trim() || null, party: p.party.trim() || null };
    if (!isDepositKind(r.kind)) { patch.meter = p.meter.trim() || null; patch.bill_period = p.bill_period.trim() || null; }
    const { data, error } = await supabase.from("trust_ledger").update(patch).eq("id", r.id).select("*");
    setBusy(false);
    if (error) return flash("err", friendly(error));
    if (!data?.length) return flash("err", "هذا التعديل يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.");
    setRows(all.map((x) => (x.id === r.id ? (data[0] as TrustRow) : x)));
    setEditing(null);
    flash("ok", "حُفظ التعديل");
  }

  async function remove(r: TrustRow) {
    if (!confirm(`حذف «${trustKindLabel(r.kind)} — ${sar(Number(r.amount))} ريال» (سند ${r.doc_no || "—"})؟\n\nيُلغى السند ولا يُعاد استعمال رقمه. للتصحيح: احذف ثم سجّل من جديد.`)) return;
    setBusy(true);
    const { data, error } = await supabase.from("trust_ledger").delete().eq("id", r.id).select("id");
    setBusy(false);
    if (error) return flash("err", friendly(error));
    if (!data?.length) return flash("err", "الحذف يحتاج صلاحية «التراجع والحذف» — اطلبه من صاحب المكتب.");
    setRows(all.filter((x) => x.id !== r.id));
  }

  const focusT = onlyTenant ? tenantById.get(onlyTenant) : null;
  const kindsAllowed = TRUST_KINDS.filter((k) => (isTrustIn(k.v) ? canIn : canOut));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3 sm:p-4" onClick={onClose}>
      <div data-testid="trust-modal" className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-4 sm:p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-deep text-xl">🛡️ الأمانات — {propertyName}</h2>
            <p className="text-sm text-muted mt-1">التأمين وحصص العدادات المشتركة: مال يمرّ بالمكتب — لا يدخل الإيجار ولا تقرير المالك ولا الأتعاب.</p>
          </div>
          <button className="btn btn-ghost text-xs" onClick={onClose}>إغلاق</button>
        </div>

        {msg && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>{msg.m}</div>
        )}

        {/* الأرصدة */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
          <div className="rounded-xl border border-line bg-paper p-3">
            <div className="text-[.72rem] text-muted">تأمين محتفَظ به (أمانة للمستأجرين)</div>
            <div className="font-display font-bold text-xl text-deep">{sar(totals.depositHeld)} <span className="text-xs font-normal">ريال</span></div>
          </div>
          <div className="rounded-xl border border-line bg-paper p-3">
            <div className="text-[.72rem] text-muted">رصيد العدادات المشتركة (حصص − فواتير)</div>
            <div className={`font-display font-bold text-xl ${Math.abs(totals.utilityBalance) < 0.005 ? "text-deep" : totals.utilityBalance > 0 ? "text-[#8a5a11]" : "text-late"}`}>
              {sar(totals.utilityBalance)} <span className="text-xs font-normal">ريال</span>
            </div>
            <div className="text-[10px] text-muted">{Math.abs(totals.utilityBalance) < 0.005 ? "متوازن — كل ما جُمع سُدّد" : totals.utilityBalance > 0 ? "حصص مستلمة لم تُسدَّد بها الفاتورة بعد" : "سُدّد أكثر مما جُمع — حصص لم تصل"}</div>
          </div>
        </div>

        {/* إضافة */}
        {kindsAllowed.length > 0 && !adding && (
          <div className="flex gap-2 flex-wrap mt-4">
            {kindsAllowed.map((k) => (
              <button key={k.v} className={`btn text-xs ${isTrustIn(k.v) ? "btn-gold" : "btn-ghost"}`} onClick={() => setAdding(k.v)} title={k.hint}>
                {k.icon} {k.l}
              </button>
            ))}
          </div>
        )}
        {adding && (
          <TrustForm kind={adding} tenants={tenants} propertyType={propertyType} busy={busy} meterHints={meterHints}
            defaultTenant={onlyTenant} heldOf={heldOf} meterBal={meterBal}
            onCancel={() => setAdding(null)} onSave={save} />
        )}
        {meterHints.length > 0 && <datalist id="wq-trust-meters">{meterHints.map((m) => <option key={m} value={m} />)}</datalist>}

        {/* ملخّص لكل وحدة / لكل عداد */}
        {(deps.length > 0 || mets.length > 0) && (
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {deps.length > 0 && (
              <div className="rounded-xl border border-line p-3">
                <div className="text-sm font-semibold mb-1.5">التأمين لكل وحدة</div>
                <div className="flex flex-col gap-1 text-xs">
                  {deps.map((d) => {
                    const t = d.tenant_id ? tenantById.get(d.tenant_id) : null;
                    const agreed = Number(t?.deposit_amount) || 0;
                    return (
                      <button type="button" key={(d.tenant_id || "") + d.unit} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-right hover:bg-paper ${onlyTenant && onlyTenant === d.tenant_id ? "bg-paper2" : ""}`}
                        onClick={() => { setOnlyTenant(d.tenant_id && onlyTenant !== d.tenant_id ? d.tenant_id : null); setTab("deposit"); }}>
                        <span className="min-w-0 truncate">{uw(t)} {d.unit || "—"}{(t?.name || d.party) ? ` · ${t?.name || d.party}` : ""}</span>
                        <span className="shrink-0 tabular-nums"><b>{sar(d.held)}</b>{d.refunded > 0 ? <span className="text-muted"> (رُدّ {sar(d.refunded)})</span> : null}
                          {agreed > 0 && Math.abs(agreed - d.received) > 0.005 ? <span className="text-[#8a5a11]"> · المتفق {sar(agreed)}</span> : null}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {mets.length > 0 && (
              <div className="rounded-xl border border-line p-3">
                <div className="text-sm font-semibold mb-1.5">العدادات المشتركة</div>
                <div className="flex flex-col gap-1 text-xs">
                  {mets.map((m) => (
                    <div key={m.meter} className="flex items-center justify-between gap-2 px-2 py-1">
                      <span className="min-w-0 truncate" dir="auto">{m.meter || "بلا رقم عداد"}</span>
                      <span className="shrink-0 tabular-nums">جُمع {sar(m.collected)} · سُدّد {sar(m.paid)} · <b className={Math.abs(m.balance) < 0.005 ? "" : m.balance > 0 ? "text-[#8a5a11]" : "text-late"}>{sar(m.balance)}</b></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* القيود */}
        <div className="flex items-center gap-1.5 flex-wrap mt-4">
          {([["all", "الكل"], ["deposit", "التأمين"], ["utility", "الفواتير المشتركة"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={`btn text-xs ${tab === k ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(k)}>{l}</button>
          ))}
          {focusT && (
            <span className="inline-flex items-center gap-1 text-xs bg-paper2 rounded-full px-2.5 py-1">
              {uw(focusT)} {focusT.unit || "—"}{focusT.name ? ` · ${focusT.name}` : ""}
              <button className="text-muted" onClick={() => setOnlyTenant(null)} aria-label="إظهار كل الوحدات">✕</button>
            </span>
          )}
        </div>

        {rows === null ? (
          <p className="text-sm text-muted mt-3">جارٍ التحميل…</p>
        ) : !shown.length ? (
          <p className="text-sm text-muted mt-3 bg-paper border border-line rounded-lg p-3">
            {all.length ? "لا قيود في هذا العرض." : "لا أمانات مسجّلة بعد. سجّل تأمين مستأجر أو حصته من فاتورة عداد مشترك — يصدر له سند قبض مرقّم ولا يدخل الإيجار."}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {shown.map((r) => {
              const t = r.tenant_id ? tenantById.get(r.tenant_id) : null;
              const inn = isTrustIn(r.kind);
              return (
                <div key={r.id} className="rounded-xl border border-line bg-paper p-3">
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <span className="text-lg" aria-hidden>{trustKindIcon(r.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{trustKindLabel(r.kind)}{(t || r.unit) ? ` — ${uw(t)} ${t?.unit || r.unit}` : ""}{r.party ? ` · ${r.party}` : ""}</div>
                      <div className="text-xs text-muted">
                        {arDate(r.entry_on)} · {methodL(r.method)}{r.meter ? ` · عداد ${r.meter}` : ""}{r.bill_period ? ` · ${r.bill_period}` : ""}{r.reference ? ` · مرجع ${r.reference}` : ""}{r.note ? ` · ${r.note}` : ""}
                      </div>
                      {r.doc_no && <div className="text-xs text-deep mt-0.5">🧾 {inn ? "سند قبض" : "سند صرف"} <span dir="ltr" className="font-mono">{r.doc_no}</span></div>}
                    </div>
                    <div dir="ltr" className={`font-bold text-sm shrink-0 tabular-nums ${inn ? "text-[#137a50]" : "text-late"}`}>{inn ? "+" : "−"}{sar(Math.abs(Number(r.amount)))}</div>
                    <div className="flex gap-1 shrink-0 w-full sm:w-auto justify-end">
                      <button className="btn btn-ghost text-xs px-2" title="طباعة السند" onClick={() => print(r)}>🖨</button>
                      {(canIn || canOut) && <button className="btn btn-ghost text-xs px-2" title="تعديل التاريخ والمرجع والملاحظة" onClick={() => setEditing(editing?.id === r.id ? null : r)}>✎</button>}
                      {canDelete && <button className="btn btn-ghost text-xs px-2 text-late" disabled={busy} onClick={() => remove(r)}>حذف</button>}
                    </div>
                  </div>
                  {editing?.id === r.id && <TrustEdit r={r} busy={busy} onCancel={() => setEditing(null)} onSave={(p) => saveEdit(r, p)} />}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted mt-4">المبلغ والنوع لا يُعدَّلان بعد صدور السند — للتصحيح احذف القيد وسجّله من جديد. دفعة إيجار سُجّلت خطأً وهي تأمين أو حصة فاتورة: انقلها من «سجل المدفوعات» ← زر «⇄ أمانة».</p>
      </div>
    </div>
  );
}

type Draft = { kind: TrustKind; tenant_id: string | null; amount: string; entry_on: string; method: string; party: string; meter: string; bill_period: string; reference: string; note: string };

function TrustForm({ kind, tenants, propertyType, busy, meterHints, defaultTenant, heldOf, meterBal, onSave, onCancel }: {
  kind: TrustKind; tenants: TrustTenant[]; propertyType?: string | null; busy: boolean; meterHints: string[];
  defaultTenant?: string | null; heldOf: (tid?: string | null) => number; meterBal: (m?: string | null) => number;
  onSave: (d: Draft) => void; onCancel: () => void;
}) {
  const dep = isDepositKind(kind);
  const firstT = defaultTenant ? tenants.find((t) => t.id === defaultTenant) : null;
  const [d, setD] = useState<Draft>({
    kind, tenant_id: firstT?.id || null, amount: "", entry_on: today(), method: "transfer",
    party: kind === "utility_out" ? "" : String(firstT?.name || ""), meter: meterHints.length === 1 ? meterHints[0] : "", bill_period: "", reference: "", note: "",
  });
  const set = (p: Partial<Draft>) => setD((c) => ({ ...c, ...p }));
  const occupied = tenants.filter((t) => !t.vacant || (dep && kind === "deposit_out"));
  const held = heldOf(d.tenant_id);
  const bal = meterBal(d.meter);
  const t = d.tenant_id ? tenants.find((x) => x.id === d.tenant_id) : null;
  const agreed = Number(t?.deposit_amount) || 0;

  return (
    <div className="mt-4 rounded-xl border border-gold/50 bg-[#FFFBF0] p-3">
      <div className="text-sm font-semibold mb-2">{trustKindIcon(kind)} {trustKindLabel(kind)}</div>
      <div className="grid sm:grid-cols-2 gap-2">
        {kind !== "utility_out" && (
          <label className="block"><span className="block text-xs font-semibold mb-1">الوحدة{dep ? "" : <span className="font-normal text-muted"> — اختياري</span>}</span>
            <select className="fld" value={d.tenant_id || ""} onChange={(e) => {
              const nt = tenants.find((x) => x.id === e.target.value);
              set({ tenant_id: e.target.value || null, party: nt?.name ? String(nt.name) : d.party,
                amount: kind === "deposit_in" && !d.amount && Number(nt?.deposit_amount) > 0 ? String(nt?.deposit_amount) : kind === "deposit_out" && !d.amount && heldOf(nt?.id) > 0 ? String(heldOf(nt?.id)) : d.amount });
            }}>
              <option value="">— اختر —</option>
              {occupied.map((x) => <option key={x.id} value={x.id}>{unitWordFor(x.unit_type, propertyType)} {x.unit || "—"}{x.name ? ` · ${x.name}` : ""}</option>)}
            </select>
            {kind === "deposit_out" && d.tenant_id && <span className="block text-[11px] text-muted mt-0.5">المحتفظ به لهذه الوحدة: {sar(held)} ريال</span>}
            {kind === "deposit_in" && agreed > 0 && <span className="block text-[11px] text-muted mt-0.5">التأمين المكتوب في بيانات الوحدة: {sar(agreed)} ريال</span>}
          </label>
        )}
        {!dep && (
          <label className="block"><span className="block text-xs font-semibold mb-1">رقم العداد / الحساب</span>
            <input className="fld" dir="ltr" list="wq-trust-meters" value={d.meter} onChange={(e) => set({ meter: e.target.value })} maxLength={60} placeholder="مثل 10012345678" />
            {kind === "utility_out" && d.meter.trim() && <span className="block text-[11px] text-muted mt-0.5">الحصص المستلمة لهذا العداد ولم تُسدَّد: {sar(bal)} ريال{bal > 0 && !d.amount ? <button type="button" className="underline ms-1" onClick={() => set({ amount: String(bal) })}>استعمله</button> : null}</span>}
          </label>
        )}
        <label className="block"><span className="block text-xs font-semibold mb-1">المبلغ (ريال)</span>
          <input className="fld" inputMode="decimal" value={d.amount} onChange={(e) => set({ amount: e.target.value.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[^\d.]/g, "") })} placeholder="0" /></label>
        <label className="block"><span className="block text-xs font-semibold mb-1">التاريخ</span>
          <input className="fld" type="date" value={d.entry_on} max={today()} onChange={(e) => set({ entry_on: e.target.value })} /></label>
        <label className="block"><span className="block text-xs font-semibold mb-1">الطريقة</span>
          <select className="fld" value={d.method} onChange={(e) => set({ method: e.target.value })}>{METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}</select></label>
        <label className="block"><span className="block text-xs font-semibold mb-1">{isTrustIn(kind) ? "استلمنا من" : "صُرف إلى"}</span>
          <input className="fld" value={d.party} onChange={(e) => set({ party: e.target.value })} maxLength={160} placeholder={kind === "utility_out" ? "شركة الكهرباء / المياه" : "اسم المستأجر"} /></label>
        {!dep && (
          <label className="block"><span className="block text-xs font-semibold mb-1">فترة الفاتورة <span className="font-normal text-muted">— اختياري</span></span>
            <input className="fld" value={d.bill_period} onChange={(e) => set({ bill_period: e.target.value })} maxLength={40} placeholder="أكتوبر 2026" /></label>
        )}
        <label className="block"><span className="block text-xs font-semibold mb-1">المرجع <span className="font-normal text-muted">— اختياري</span></span>
          <input className="fld" dir="ltr" value={d.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={80} /></label>
        <label className="block sm:col-span-2"><span className="block text-xs font-semibold mb-1">ملاحظة <span className="font-normal text-muted">— اختياري</span></span>
          <input className="fld" value={d.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} placeholder={kind === "deposit_out" ? "مثل: خُصم 500 ريال إصلاح باب" : ""} /></label>
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn btn-gold text-sm" disabled={busy} onClick={() => onSave(d)}>حفظ وإصدار السند</button>
        <button className="btn btn-ghost text-sm" onClick={onCancel}>إلغاء</button>
      </div>
    </div>
  );
}

function TrustEdit({ r, busy, onSave, onCancel }: {
  r: TrustRow; busy: boolean; onCancel: () => void;
  onSave: (p: { entry_on: string; reference: string; note: string; party: string; meter: string; bill_period: string }) => void;
}) {
  const [p, setP] = useState({ entry_on: String(r.entry_on || "").slice(0, 10), reference: r.reference || "", note: r.note || "", party: r.party || "", meter: r.meter || "", bill_period: r.bill_period || "" });
  const set = (x: Partial<typeof p>) => setP((c) => ({ ...c, ...x }));
  const util = !isDepositKind(r.kind);
  return (
    <div className="mt-2 border-t border-line pt-2 grid sm:grid-cols-3 gap-2 items-end">
      <label className="block"><span className="block text-xs font-semibold mb-1">التاريخ</span>
        <input className="fld" type="date" value={p.entry_on} max={today()} onChange={(e) => set({ entry_on: e.target.value })} /></label>
      <label className="block"><span className="block text-xs font-semibold mb-1">{isTrustIn(r.kind) ? "استلمنا من" : "صُرف إلى"}</span>
        <input className="fld" value={p.party} maxLength={160} onChange={(e) => set({ party: e.target.value })} /></label>
      <label className="block"><span className="block text-xs font-semibold mb-1">المرجع</span>
        <input className="fld" dir="ltr" value={p.reference} maxLength={80} onChange={(e) => set({ reference: e.target.value })} /></label>
      {util && <label className="block"><span className="block text-xs font-semibold mb-1">العداد</span>
        <input className="fld" dir="ltr" list="wq-trust-meters" value={p.meter} maxLength={60} onChange={(e) => set({ meter: e.target.value })} /></label>}
      {util && <label className="block"><span className="block text-xs font-semibold mb-1">فترة الفاتورة</span>
        <input className="fld" value={p.bill_period} maxLength={40} onChange={(e) => set({ bill_period: e.target.value })} /></label>}
      <label className={`block ${util ? "" : "sm:col-span-2"}`}><span className="block text-xs font-semibold mb-1">ملاحظة</span>
        <input className="fld" value={p.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} /></label>
      <div className="flex gap-1 sm:col-span-3">
        <button className="btn btn-primary text-xs" disabled={busy} onClick={() => onSave(p)}>حفظ</button>
        <button className="btn btn-ghost text-xs" onClick={onCancel}>إلغاء</button>
        <span className="text-[11px] text-muted self-center ms-2">المبلغ والنوع والطريقة ثابتة بعد السند.</span>
      </div>
    </div>
  );
}
