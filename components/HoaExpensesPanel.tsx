"use client";
/**
 * وثيق — صندوق العمارة ومصروفاتها (schema-v62).
 *
 *  • تسجيل مصروف ← ينقص الصندوق في القاعدة بعملية واحدة ويصدر «سند صرف» S-00001.
 *  • العكس بدل الحذف (سطر سالب يعيد المبلغ للصندوق) — السند لا يُعدَّل.
 *  • رابط «شفافية العمارة» العام /b/<رمز>: أرقام مجمَّعة فقط، بلا أسماء.
 *  • «ملخص الشهر» لمجموعة واتساب العمارة: مجاميع فقط، بلا أسماء ولا وحدات.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { openDoc } from "@/lib/documents";
import { renderVoucherPage, type VoucherRow } from "@/lib/hoaPortal";
import { openExternal, today } from "@/lib/utils";
import { EXPENSE_CATEGORIES, expenseCatAr, MONTHS_AR, r2, type BuildingData } from "@/lib/hoaMoney";
import DateField from "@/components/DateField";

type Expense = VoucherRow & { id: string; reverses: string | null; created_at: string };

const fmt = (n: number) => {
  const v = r2(n); const a = Math.abs(v);
  const t = Number.isInteger(a) ? a.toLocaleString("en-US") : a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `−${t}` : t;
};
const dayAr = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${Number(m[3])} ${MONTHS_AR[Number(m[2]) - 1]} ${m[1]}` : "—";
};
const uuid = () => (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function" ? (crypto as any).randomUUID() : null);
const dbMsg = (m: string) => /not authorized/i.test(m) ? "هذا الإجراء لمدير المكتب — اطلبه من صاحب المكتب."
  : /Could not find|does not exist|schema cache/i.test(m) ? "قاعدة البيانات تحتاج تحديث (schema-v62) — لم يُنفَّذ الإجراء." : m;

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

// ─── رابط شفافية العمارة ────────────────────────────────────────
export function BuildingLinkButton({ association, className, onToken }: {
  association: { id: string; name: string }; className?: string; onToken?: (t: string | null) => void;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const fetchLink = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("watheq_assoc_public_link", { p_assoc: association.id, p_action: "get" });
    setBusy(false);
    if (error || !data) { setErr(dbMsg(String(error?.message || "تعذّر إنشاء الرابط"))); return; }
    setUrl(`${window.location.origin}/b/${data}`); setRevoked(false); onToken?.(String(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [association.id]);

  const revoke = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("watheq_assoc_public_link", { p_assoc: association.id, p_action: "revoke" });
    setBusy(false);
    if (error) { setErr(dbMsg(error.message)); return; }
    setUrl(null); setRevoked(true); setConfirming(false); onToken?.(null);
  };
  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { (document.getElementById(`bl-${association.id}`) as HTMLInputElement | null)?.select(); }
  };
  const share = () => {
    if (!url) return;
    const msg = [`صفحة شفافية ${association.name}:`, url, "",
      "فيها رصيد صندوق العمارة، وما حُصّل وما صُرف وعلى أي بند، ونسبة الوحدات المسدِّدة — أرقام مجمَّعة بلا أسماء."].join("\n");
    openExternal(`https://wa.me/?text=${encodeURIComponent(msg)}`);
  };

  return (
    <>
      <button type="button" className={className || "btn btn-ghost text-xs"} onClick={() => { setOpen(true); setConfirming(false); setCopied(false); fetchLink(); }}
        title="صفحة عامة لأرقام الصندوق — بلا أسماء">🔗 رابط شفافية العمارة</button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h3 className="font-display font-bold text-deep text-lg mb-1">رابط شفافية العمارة</h3>
          <p className="text-sm text-muted mb-3">صفحة واحدة لكل العمارة ترسلها لمجموعة الملاك: رصيد الصندوق، المحصَّل والمصروف حسب البند، ونسبة السداد. <b>لا تُعرض فيها أسماء الملاك ولا حالة أي وحدة.</b></p>
          {busy && !url && <p className="text-sm text-muted">جارٍ التجهيز…</p>}
          {err && <p className="text-sm text-late mb-2">{err}</p>}
          {revoked && !url && (
            <div className="rounded-xl bg-[#F6F2E8] p-3 text-sm mb-3">أُبطل الرابط — من يفتحه يرى «الرابط غير متاح».
              <div className="mt-2"><button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={fetchLink}>إنشاء رابط جديد</button></div>
            </div>
          )}
          {url && (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input id={`bl-${association.id}`} className="fld text-xs" dir="ltr" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn btn-ghost text-xs whitespace-nowrap" onClick={copy}>{copied ? "نُسخ ✓" : "نسخ"}</button>
              </div>
              <button type="button" className="btn btn-wa w-full justify-center mt-3" onClick={share}>مشاركة عبر واتساب (اختر المجموعة)</button>
              <div className="border-t border-line mt-4 pt-3">
                {!confirming ? (
                  <button type="button" className="text-late text-sm font-semibold underline" onClick={() => setConfirming(true)}>إبطال هذا الرابط</button>
                ) : (
                  <div className="rounded-xl bg-[#FBE9E7] p-3 text-sm">
                    <p className="font-semibold text-[#8f2b26]">سيتوقف الرابط فورًا عند كل من لديه.</p>
                    <div className="flex gap-2 mt-3">
                      <button type="button" className="btn btn-ghost text-xs flex-1 justify-center" onClick={() => setConfirming(false)}>تراجع</button>
                      <button type="button" className="btn text-xs flex-1 justify-center bg-late text-white" disabled={busy} onClick={revoke}>تأكيد الإبطال</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="flex justify-end mt-4"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>إغلاق</button></div>
        </Modal>
      )}
    </>
  );
}

// ─── لوحة الصندوق والمصروفات ────────────────────────────────────
export default function HoaExpensesPanel({ association, orgName, onFund, notify }: {
  association: { id: string; name: string; fund_balance: number; public_token?: string | null };
  orgName?: string | null;
  onFund: (balance: number) => void;
  notify: (k: "ok" | "err", m: string) => void;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [summary, setSummary] = useState<BuildingData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [token, setToken] = useState<string | null>(association.public_token || null);

  const load = useCallback(async () => {
    setErr(null);
    const [{ data, error }, s] = await Promise.all([
      supabase.from("association_expenses").select("*").eq("association_id", association.id)
        .order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(300),
      supabase.rpc("watheq_assoc_building_summary", { p_assoc: association.id }),
    ]);
    if (error) { setErr(dbMsg(error.message)); setRows([]); } else setRows((data || []) as Expense[]);
    if (!s.error && s.data) setSummary(s.data as BuildingData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [association.id]);
  useEffect(() => { setRows(null); setSummary(null); load(); }, [load]);

  const reversed = useMemo(() => new Set((rows || []).filter((r) => r.reverses).map((r) => String(r.reverses))), [rows]);
  const month = today().slice(0, 7);
  const monthRows = (rows || []).filter((r) => String(r.spent_on).slice(0, 7) === month);
  const monthTotal = r2(monthRows.reduce((s, r) => s + Number(r.amount || 0), 0));
  const monthByCat = useMemo(() => {
    const m: Record<string, number> = {};
    monthRows.forEach((r) => { m[r.category] = r2((m[r.category] || 0) + Number(r.amount || 0)); });
    return Object.entries(m).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, month]);

  const printVoucher = (e: Expense) =>
    openDoc(renderVoucherPage({ association: { name: association.name }, office: { org_name: orgName || null }, expense: e }, { nonce: "watheq" }));

  const reverse = async (e: Expense) => {
    if (!confirm(`عكس سند ${e.voucher_no} بمبلغ ${fmt(e.amount)} ريال؟ يعود المبلغ للصندوق ويبقى السطران في السجل.`)) return;
    const { data, error } = await supabase.rpc("watheq_reverse_assoc_expense", { p_expense: e.id, p_note: null });
    if (error) return notify("err", /not authorized/.test(error.message) ? "العكس يحتاج صلاحية «التراجع والحذف»." : dbMsg(error.message));
    onFund(Number((data as any)?.fund_balance));
    notify("ok", `عُكس سند ${e.voucher_no} وعاد المبلغ للصندوق.`);
    load();
  };

  const summaryText = () => {
    const [y, m] = month.split("-").map(Number);
    const lines = [`📊 ملخص ${MONTHS_AR[m - 1]} ${y} — ${association.name}`, ""];
    if (summary) lines.push(`• المحصَّل من الاشتراكات: ${fmt(summary.month_collected)} ريال`);
    lines.push(`• المصروف: ${fmt(summary ? summary.month_expenses : monthTotal)} ريال`);
    monthByCat.forEach(([c, v]) => lines.push(`   ◦ ${expenseCatAr(c)}: ${fmt(v)} ريال`));
    lines.push(`• رصيد الصندوق: ${fmt(summary ? summary.fund_balance : association.fund_balance)} ريال`);
    if (summary?.collection_pct != null) lines.push(`• نسبة الوحدات المسدِّدة: ${summary.collection_pct}٪`);
    lines.push("");
    if (token) lines.push("التفاصيل وآخر المصروفات:", `${window.location.origin}/b/${token}`, "");
    lines.push("أرقام مجمَّعة لكل العمارة — شاكرين تعاونكم.", `إدارة ${association.name}`);
    return lines.join("\n");
  };

  const fund = Number(association.fund_balance) || 0;

  return (
    <div className="bg-white rounded-2xl border border-line p-4">
      <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-start">
        <div className="min-w-0">
          <h3 className="font-display font-bold text-deep text-lg">الصندوق والمصروفات</h3>
          <p className="text-xs text-muted">كل مصروف يُنقص الصندوق ويصدر له سند صرف مرقَّم. التصحيح بعكس السند لا بحذفه.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-gold text-sm" onClick={() => setForm(true)}>+ مصروف</button>
          <BuildingLinkButton association={{ id: association.id, name: association.name }} onToken={setToken} />
          <button type="button" className="btn btn-wa text-xs" onClick={() => openExternal(`https://wa.me/?text=${encodeURIComponent(summaryText())}`)}
            title="رسالة لمجموعة العمارة: مجاميع الشهر بلا أسماء">💬 ملخص الشهر</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <Kpi v={fmt(fund)} l="رصيد الصندوق (ريال)" tone={fund < 0 ? "bad" : "good"} />
        <Kpi v={summary ? fmt(summary.month_collected) : "…"} l="محصَّل هذا الشهر" />
        <Kpi v={fmt(summary ? summary.month_expenses : monthTotal)} l="مصروف هذا الشهر" />
        <Kpi v={summary ? fmt(summary.year_expenses) : "…"} l="مصروف العام" />
      </div>
      {fund < 0 && <p className="text-xs text-late mt-2">الصندوق بالسالب — مصروفات دفعها مدير العقار مقدّمًا تُستردّ من التحصيل القادم.</p>}

      {err && <p className="text-sm text-late mt-3">{err}</p>}
      {rows === null && <p className="text-sm text-muted mt-3">جارٍ التحميل…</p>}
      {rows && rows.length === 0 && !err && <p className="text-sm text-muted mt-3">لا مصروفات بعد. سجّل أول مصروف ليظهر في سند صرف وفي صفحة الشفافية.</p>}

      <div className="mt-3 flex flex-col gap-2">
        {(rows || []).slice(0, 60).map((e) => {
          const isRev = !!e.reverses, wasRev = reversed.has(e.id);
          return (
            <div key={e.id} className={`rounded-xl border border-line p-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 ${isRev || wasRev ? "opacity-60" : ""}`}>
              <div className="min-w-0">
                <div className="font-semibold text-sm break-words">{e.description}</div>
                <div className="text-xs text-muted">
                  <span dir="ltr">{e.voucher_no || "عكس"}</span> · {expenseCatAr(e.category)} · {dayAr(e.spent_on)}
                  {e.vendor ? ` · ${e.vendor}` : ""}{e.overdraft ? " · دفعه المدير مقدّمًا" : ""}{wasRev ? " · (معكوس)" : ""}
                </div>
              </div>
              <div className={`font-bold tabular-nums text-sm ${isRev ? "text-paid" : "text-deep"} ${wasRev ? "line-through" : ""}`}>{fmt(-Number(e.amount))}</div>
              {!isRev && !wasRev && (
                <div className="col-span-2 flex gap-1.5 justify-end">
                  <button type="button" className="btn btn-ghost text-xs px-2" onClick={() => printVoucher(e)}>سند صرف</button>
                  <button type="button" className="btn btn-ghost text-xs px-2 text-late" onClick={() => reverse(e)}>عكس</button>
                </div>
              )}
            </div>
          );
        })}
        {(rows || []).length > 60 && <p className="text-xs text-muted text-center">يُعرض آخر 60 سطرًا.</p>}
      </div>

      {form && <ExpenseForm assocId={association.id} fund={fund} onClose={() => setForm(false)}
        onDone={(r) => { onFund(Number(r.fund_balance)); setForm(false); notify("ok", r.duplicate ? `المصروف مسجّل سابقًا · ${r.voucher_no}` : `سُجّل المصروف · سند ${r.voucher_no}`); load(); }}
        notify={notify} />}
    </div>
  );
}

function Kpi({ v, l, tone }: { v: string; l: string; tone?: "good" | "bad" }) {
  return (
    <div className="bg-paper2 rounded-lg p-2.5 min-w-0">
      <div className={`font-display font-bold tabular-nums truncate ${tone === "bad" ? "text-late" : tone === "good" ? "text-paid" : "text-deep"}`} title={v}>{v}</div>
      <div className="text-[.7rem] text-muted mt-0.5">{l}</div>
    </div>
  );
}

function ExpenseForm({ assocId, fund, onClose, onDone, notify }: {
  assocId: string; fund: number; onClose: () => void;
  onDone: (r: { fund_balance: number; voucher_no: string; duplicate?: boolean }) => void;
  notify: (k: "ok" | "err", m: string) => void;
}) {
  const supabase = createClient();
  const [d, setD] = useState({ amount: "", category: "maintenance", description: "", spent_on: today(), vendor: "", reference: "", negative: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /* معرّف واحد للنافذة: إعادة الإرسال بعد انقطاع لا تسجّل مصروفًا ثانيًا (يتجدد إن تغيّرت البيانات) */
  const req = useRef<{ k: string; id: string | null } | null>(null);
  const amt = r2(Number(String(d.amount).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))) || 0);
  const short = amt > 0 && r2(fund - amt) < 0;
  const future = d.spent_on > today();
  const ready = amt > 0 && d.description.trim().length > 0 && !future && (!short || d.negative) && !busy;

  const submit = async () => {
    if (!ready) return;
    const k = [amt, d.category, d.description.trim(), d.spent_on, d.vendor.trim(), d.reference.trim()].join("|");
    if (!req.current || req.current.k !== k) req.current = { k, id: uuid() };
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("watheq_record_assoc_expense", {
      p_assoc: assocId, p_amount: amt, p_category: d.category, p_description: d.description.trim(),
      p_spent_on: d.spent_on, p_vendor: d.vendor.trim() || null, p_reference: d.reference.trim() || null,
      p_allow_negative: short && d.negative, p_request: req.current.id,
    });
    setBusy(false);
    if (error) { setErr(dbMsg(error.message)); return; }
    onDone(data as any);
  };

  return (
    <Modal onClose={() => !busy && onClose()}>
      <h3 className="font-display font-bold text-deep text-lg mb-1">تسجيل مصروف</h3>
      <p className="text-xs text-muted mb-3">رصيد الصندوق الآن {fmt(fund)} ريال. يصدر سند صرف مرقَّم تلقائيًا.</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0"><span className="block text-sm font-semibold mb-1">المبلغ (ريال)</span>
            <input className="fld" type="number" inputMode="decimal" min={0} autoFocus value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></label>
          <label className="block min-w-0"><span className="block text-sm font-semibold mb-1">التاريخ</span>
            <DateField value={d.spent_on} onChange={(v) => setD({ ...d, spent_on: v || today() })} /></label>
        </div>
        <label className="block"><span className="block text-sm font-semibold mb-1">البند</span>
          <select className="fld" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">البيان</span>
          <input className="fld" maxLength={300} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="مثال: صيانة دورية للمصعد — سبتمبر" />
          <span className="block text-xs text-[#8a5a11] mt-1">الوصف يظهر لكل الملاك في صفحة الشفافية — لا تكتب أسماء أشخاص.</span></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0"><span className="block text-sm font-semibold mb-1">المورّد <span className="text-xs text-muted font-normal">(لا يظهر للملاك)</span></span>
            <input className="fld" maxLength={120} value={d.vendor} onChange={(e) => setD({ ...d, vendor: e.target.value })} /></label>
          <label className="block min-w-0"><span className="block text-sm font-semibold mb-1">رقم الفاتورة</span>
            <input className="fld" dir="ltr" maxLength={80} value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} /></label>
        </div>
        {short && (
          <label className="flex items-start gap-2 text-sm rounded-xl border border-[#F5C6C2] bg-[#FEF7F6] p-3 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={d.negative} onChange={(e) => setD({ ...d, negative: e.target.checked })} />
            <span><b>الصندوق لا يكفي — تسجيل بالسالب (مصروف دفعه المدير مقدّمًا)</b>
              <span className="block text-xs text-muted">يصبح الرصيد {fmt(r2(fund - amt))} ريال، ويُوسم السند بأنه دُفع مقدّمًا.</span></span>
          </label>
        )}
        {future && <p className="text-xs text-late">تاريخ المصروف لا يكون بعد اليوم.</p>}
        {err && <p className="text-sm text-late">{err}</p>}
      </div>
      <div className="flex gap-2 mt-5">
        <button type="button" className="btn btn-ghost flex-1 justify-center" disabled={busy} onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-gold flex-1 justify-center" disabled={!ready} onClick={submit}>{busy ? "جارٍ التسجيل…" : "تسجيل وإصدار السند"}</button>
      </div>
    </Modal>
  );
}
