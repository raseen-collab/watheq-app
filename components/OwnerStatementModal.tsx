"use client";
// ============================================================
// وثيق — كشف المالك المجمّع: اختر المالك والفترة (من شهر إلى شهر)
//
// المالك يُعرَّف باسمه على العقار (owner_name — schema-v10). القائمة
// هنا تعرض الأسماء الموجودة فقط، فلا يُكتب اسم لا عقارات له.
// الفترة بالأشهر لا بالأيام: هكذا يطلبها المكتب فعلًا («من يناير
// إلى مارس»)، والتحويل إلى أول يوم/آخر يوم يتم هنا.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { openDoc, ownerConsolidatedStatementHTML, type OwnerReportPayment, type OwnerStatementSection } from "@/lib/documents";
import type { ExpenseRow } from "@/lib/expenses";

const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const ymLabel = (ym: string) => `${AR_MONTHS[Number(ym.slice(5, 7)) - 1] || ym} ${ym.slice(0, 4)}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function OwnerStatementModal({ properties, issuer, onClose }: {
  properties: any[]; issuer?: any; onClose: () => void;
}) {
  const supabase = createClient();
  const owners = useMemo(() => {
    const m = new Map<string, number>();
    properties.forEach((p) => { const n = (p.owner_name || "").trim(); if (n) m.set(n, (m.get(n) || 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], "ar"));
  }, [properties]);

  const [owner, setOwner] = useState(owners[0]?.[0] || "");
  const [from, setFrom] = useState(thisMonth());
  const [to, setTo] = useState(thisMonth());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /* اختيار العقارات: فارغ = كل عقارات المالك. ومستوى التفصيل: شامل يضم
     جدول الوحدات وحالتها وبيانات كل وحدة، والمختصر يبقى كما كان. */
  const [picked, setPicked] = useState<string[]>([]);
  const [detail, setDetail] = useState<"full" | "brief">("full");
  const ownerProps = useMemo(() => properties.filter((p) => (p.owner_name || "").trim() === owner), [properties, owner]);
  useEffect(() => { setPicked([]); }, [owner]);
  const toggleProp = (id: string) => setPicked((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  function preset(kind: "thisMonth" | "quarter" | "half" | "year" | "last12") {
    const now = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
    const ym = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
    if (kind === "thisMonth") { setFrom(ym(now)); setTo(ym(now)); return; }
    if (kind === "year") { setFrom(`${now.getFullYear()}-01`); setTo(ym(now)); return; }
    const back = kind === "quarter" ? 2 : kind === "half" ? 5 : 11;
    setFrom(ym(new Date(now.getFullYear(), now.getMonth() - back, 1))); setTo(ym(now));
  }

  /**
   * رابط مالك مجمّع (schema-v13): رابط واحد يفتح فيه المالك كل عقاراته حيًّا
   * لأي فترة يختارها من الرابط نفسه (?from=YYYY-MM&to=YYYY-MM). مالك بعشرة
   * عقارات كان يستلم عشرة روابط — الآن واحد.
   */
  async function makeLink() {
    if (!owner) return;
    setLinkBusy(true); setErr(null);
    const uid = await officeId(supabase);
    const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase.from("owner_links")
      .insert({ user_id: uid, property_id: null, owner_name: owner, token, label: `مجمّع — ${owner}` });
    setLinkBusy(false);
    if (error) { setErr(/owner_name|scope|null value/.test(error.message) ? "شغّل schema-v13 في القاعدة أولًا." : error.message); return; }
    setLink(`${window.location.origin}/r/${token}?from=${from}&to=${to}`);
  }

  const valid = /^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && from <= to && !!owner;
  const label = from === to ? ymLabel(from) : `${ymLabel(from)} — ${ymLabel(to)}`;

  async function issue() {
    if (!valid) return;
    setLoading(true); setErr(null);
    const fromD = `${from}-01`;
    const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
    const toD = `${to}-${String(new Date(ty, tm, 0).getDate()).padStart(2, "0")}`;

    const props = picked.length ? ownerProps.filter((p) => picked.includes(p.id)) : ownerProps;
    const ids = props.map((p) => p.id);

    /**
     * Supabase يقصّ أي استجابة عند 1000 صف بصمت مهما كان limit —
     * ومالك بـ400 وحدة على فترة سنة يتجاوزها، فيخرج كشفٌ ناقصٌ بلا
     * أي تحذير. نجلب على دفعات حتى تنتهي فعلًا.
     */
    async function fetchAll(table: string, select: string, dateCol: string): Promise<{ rows: any[]; error: string | null }> {
      const out: any[] = []; const PAGE = 1000;
      for (let from0 = 0; ; from0 += PAGE) {
        const { data, error } = await supabase.from(table).select(select)
          .in("property_id", ids).gte(dateCol, fromD).lte(dateCol, toD)
          .order(dateCol, { ascending: true }).order("id", { ascending: true })
          .range(from0, from0 + PAGE - 1);
        if (error) return { rows: out, error: error.message };
        out.push(...(data || []));
        if (!data || data.length < PAGE) break;
        if (out.length > 50000) break; // صمام أمان
      }
      return { rows: out, error: null };
    }
    const [pay, ex] = await Promise.all([
      fetchAll("payments", "id,paid_on,amount,method,periods_covered,note,tenant_id,property_id", "paid_on"),
      fetchAll("expenses", "*", "spent_on"),
    ]);
    setLoading(false);
    if (pay.error) { setErr(pay.error); return; }

    const sections: OwnerStatementSection[] = props.map((p) => {
      const byId: Record<string, any> = {};
      (p.tenants || []).forEach((t: any) => { byId[t.id] = t; });
      const payments: OwnerReportPayment[] = pay.rows.filter((x: any) => x.property_id === p.id).map((x: any) => ({
        id: x.id, paid_on: x.paid_on, amount: x.amount, method: x.method,
        periods_covered: x.periods_covered, note: x.note,
        tenant_name: byId[x.tenant_id]?.name || null, unit: byId[x.tenant_id]?.unit || null,
      }));
      const expenses = (ex.error ? [] : ex.rows).filter((x: any) => x.property_id === p.id) as ExpenseRow[];
      return { property: p, payments, expenses, fee_pct: p.mgmt_fee_pct };
    });

    openDoc(ownerConsolidatedStatementHTML(owner, sections, { label, from: fromD, to: toD }, issuer || {}, detail));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-line shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-bold text-deep text-xl mb-1">📑 كشف حساب مالك — مجمّع</h2>
        <p className="text-sm text-muted mb-4">كل عقارات المالك في كشف واحد: صافي كل عقار والإجمالي، لفترة تحددها.</p>

        {owners.length === 0 ? (
          <div className="text-sm bg-[#FDF6E3] border border-[#EAD9A8] text-[#7a5c12] rounded-xl p-3.5 leading-relaxed">
            لم يُحدَّد مالك لأي عقار بعد. افتح <b>الإعدادات</b> لكل عقار واكتب اسم مالكه في خانة «المالك» — العقارات التي تحمل الاسم نفسه تُجمع هنا تلقائيًّا.
          </div>
        ) : (
          <>
            <label className="block text-sm font-semibold mb-1">المالك</label>
            <select className="fld mb-3" value={owner} onChange={(e) => setOwner(e.target.value)}>
              {owners.map(([n, c]) => <option key={n} value={n}>{n} — {c} {c === 1 ? "عقار" : "عقارات"}</option>)}
            </select>
            {ownerProps.length > 1 && (
              <div className="mb-3">
                <label className="block text-sm font-semibold mb-1">العقارات المشمولة</label>
                <div className="border border-line rounded-xl p-2 max-h-40 overflow-auto bg-paper">
                  <label className="flex items-center gap-2 text-sm py-1">
                    <input type="checkbox" className="w-4 h-4" checked={picked.length === 0} onChange={() => setPicked([])} />
                    <b>كل عقارات المالك ({ownerProps.length})</b>
                  </label>
                  {ownerProps.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm py-1 ps-4">
                      <input type="checkbox" className="w-4 h-4" checked={picked.includes(p.id)} onChange={() => toggleProp(p.id)} />
                      <span>{p.name}<span className="text-muted text-xs"> · {(p.tenants || []).length} وحدة</span></span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted mt-1">اختر عقارًا أو أكثر، أو اترك «كل العقارات».</p>
              </div>
            )}

            <label className="block text-sm font-semibold mb-1">الفترة</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {([["thisMonth", "هذا الشهر"], ["quarter", "آخر 3 أشهر"], ["half", "آخر 6 أشهر"], ["year", "هذه السنة"], ["last12", "آخر 12 شهرًا"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => preset(k)} className="text-[11px] px-2.5 py-1 rounded-full border border-line text-muted hover:text-deep hover:border-deep">{l}</button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1">من شهر</label>
                <input type="month" className="fld" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">إلى شهر</label>
                <input type="month" className="fld" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            {from > to && <p className="text-xs text-late mt-1">شهر البداية بعد شهر النهاية.</p>}
            <div className="mt-3">
              <label className="block text-sm font-semibold mb-1">مستوى التفصيل</label>
              <div className="inline-flex border border-line rounded-lg p-0.5 text-xs">
                <button type="button" onClick={() => setDetail("full")} className={`px-3 py-1.5 rounded-md ${detail === "full" ? "bg-deep text-goldSoft" : "text-muted"}`}>شامل</button>
                <button type="button" onClick={() => setDetail("brief")} className={`px-3 py-1.5 rounded-md ${detail === "brief" ? "bg-deep text-goldSoft" : "text-muted"}`}>مختصر</button>
              </div>
              <p className="text-[11px] text-muted mt-1">
                {detail === "full"
                  ? "الشامل: ملخص العقارات + جدول وحدات كل عقار (المستأجر، الإيجار، الحالة، المتأخر، نهاية العقد) + الدفعات والمصروفات."
                  : "المختصر: ملخص العقارات وصافي كل عقار والدفعات والمصروفات — بلا جدول الوحدات."}
              </p>
            </div>
            {err && <p className="text-sm text-late mt-2">{err}</p>}
            <div className="flex gap-2 mt-5">
              <button className="btn btn-gold flex-1 justify-center" onClick={issue} disabled={!valid || loading}>
                {loading ? "جارٍ التجهيز…" : `إصدار الكشف — ${label}`}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
            </div>
            <div className="mt-4 pt-4 border-t border-line">
              <div className="text-xs font-bold text-muted mb-2">أو رابط حيّ يفتحه المالك بنفسه — كل عقاراته في صفحة واحدة</div>
              {link ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[11px] bg-paper2 border border-line rounded-lg px-2 py-1.5 break-all flex-1" dir="ltr">{link}</code>
                  <button className="btn btn-ghost text-xs" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} }}>
                    {copied ? "✓ نُسخ" : "نسخ"}
                  </button>
                  <a className="btn btn-ghost text-xs" href={`https://wa.me/?text=${encodeURIComponent(`كشف حساب عقاراتك — يتحدّث تلقائيًّا:\n${link}`)}`} target="_blank" rel="noreferrer">واتساب</a>
                </div>
              ) : (
                <button className="btn btn-ghost text-sm" onClick={makeLink} disabled={!owner || linkBusy}>
                  {linkBusy ? "…" : "🔗 إنشاء رابط مجمّع للمالك"}
                </button>
              )}
              <p className="text-[11px] text-muted mt-2">الرابط يُبطَل من نافذة «رابط المالك» في أي عقار للمالك (يظهر باسم «مجمّع»). الفترة في الرابط تُعدَّل من عنوانه.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
