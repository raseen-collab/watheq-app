"use client";
// ============================================================
// وثيق — كشف المستحقات القادمة (ورقة المحصّل)
//
// يختار المكتب الفترة (أسبوعان، شهر، شهران، ٣ أشهر، أو حتى تاريخ) والنطاق
// (كل العمائر، عمارة، مالك)، فتخرج ورقة للطباعة فيها المستأجر وجواله
// ووحدته وتاريخ الاستحقاق — بلا دخل ولا مصروفات. انظر lib/due-list.ts.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { fetchAllRows } from "@/lib/fetch-all";
import { dueListHTML, openDoc, arDate } from "@/lib/documents";
import { buildDueList } from "@/lib/due-list";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (n: number) => { const d = new Date(Date.parse(today() + "T00:00:00Z")); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const RANGES = [
  { k: "14", label: "خلال أسبوعين", days: 14 },
  { k: "30", label: "خلال شهر", days: 30 },
  { k: "60", label: "خلال شهرين", days: 60 },
  { k: "90", label: "خلال ٣ أشهر", days: 90 },
  { k: "c", label: "حتى تاريخ", days: 0 },
];

export default function DueListModal({ properties, issuer, onClose, db }: {
  properties: ({ id: string; name: string; owner_name?: string | null } & Record<string, any>)[];
  issuer: any;
  onClose: () => void;
  db?: any;
}) {
  useEffect(() => {
    document.body.classList.add("wq-modal-open");
    return () => document.body.classList.remove("wq-modal-open");
  }, []);
  const supabase: any = useMemo(() => db || createClient(), [db]);
  const [rangeKey, setRangeKey] = useState("30");
  const [to, setTo] = useState(shift(30));
  const [includeLate, setIncludeLate] = useState(true);
  const [showAmount, setShowAmount] = useState(true);
  const [scopeKind, setScopeKind] = useState<"all" | "property" | "owner">("all");
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const owners = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of properties) {
      const o = (p.owner_name || "").trim();
      if (o) m.set(o, (m.get(o) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  }, [properties]);

  function pickRange(k: string) {
    setRangeKey(k);
    const r = RANGES.find((x) => x.k === k)!;
    if (r.days) setTo(shift(r.days));
  }
  const label = rangeKey === "c" ? `حتى ${arDate(to)}` : RANGES.find((x) => x.k === rangeKey)!.label;

  async function build() {
    setBusy(true); setErr(null);
    try {
      const from = today();
      if (to < from) { setErr("تاريخ النهاية قبل اليوم."); return; }
      const inScope = scopeKind === "property" ? properties.filter((p) => p.id === scope)
        : scopeKind === "owner" ? properties.filter((p) => (p.owner_name || "").trim() === scope)
        : properties;
      const ids = inScope.map((p) => p.id);
      if (!ids.length) { setErr(scopeKind === "owner" ? "لا عقارات مسجّلة لهذا المالك." : "لا عقارات بعد."); return; }

      const tenants = await fetchAllRows(supabase as any, "tenants", "*", (q) => q.in("property_id", ids));
      const rows = buildDueList({ tenants: tenants || [], properties: inScope, today: from, to, includeLate });

      const scopeLabel = scopeKind === "property" ? (inScope[0]?.name || "")
        : scopeKind === "owner" ? `عمائر ${scope}` : "";
      const html = dueListHTML(rows, { label, from, to }, issuer || {}, { showAmount, scopeLabel });
      openDoc(html);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "تعذّر بناء الكشف.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 grid place-items-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-lg mb-1">كشف المستحقات</h3>
        <p className="text-xs text-muted mb-4 leading-relaxed">
          ورقة للمحصّل: المستأجر وجواله ووحدته وتاريخ الاستحقاق — بلا دخل ولا مصروفات.
        </p>

        <label className="block text-sm font-semibold mb-2">يستحق</label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {RANGES.map((r) => (
            <button key={r.k} type="button" onClick={() => pickRange(r.k)}
              className={`text-xs px-3 py-1.5 rounded-full border ${rangeKey === r.k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>
              {r.label}
            </button>
          ))}
        </div>
        {rangeKey === "c" && (
          <label className="block mb-3"><span className="text-[11px] text-muted">من اليوم حتى</span>
            <input type="date" className="fld" value={to} min={today()} onChange={(e) => setTo(e.target.value)} /></label>
        )}

        {properties.length > 1 && (
          <>
            <label className="block text-sm font-semibold mb-2">النطاق</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {([["all", "كل العمائر"], ["property", "عمارة واحدة"],
                 ...(owners.length ? [["owner", "حسب المالك"] as const] : [])] as const).map(([k, l]) => (
                <button key={k} type="button"
                  onClick={() => { setScopeKind(k as any); setScope(k === "property" ? properties[0].id : k === "owner" ? owners[0][0] : ""); }}
                  className={`text-xs px-3 py-1.5 rounded-full border ${scopeKind === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>
                  {l}
                </button>
              ))}
            </div>
            {scopeKind === "property" && (
              <select className="fld mb-3" value={scope} onChange={(e) => setScope(e.target.value)}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {scopeKind === "owner" && (
              <select className="fld mb-3" value={scope} onChange={(e) => setScope(e.target.value)}>
                {owners.map(([o, n]) => <option key={o} value={o}>{o} — {n} {n === 1 ? "عقار" : "عقارات"}</option>)}
              </select>
            )}
          </>
        )}

        <label className="flex items-start gap-2 text-sm mb-2 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={includeLate} onChange={(e) => setIncludeLate(e.target.checked)} />
          <span>أضِف المتأخرين<br /><span className="text-[11px] text-muted">من حلّ قسطه ولم يسدّد — صفّ واحد لكل مستأجر</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm mb-4 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={showAmount} onChange={(e) => setShowAmount(e.target.checked)} />
          <span>أظهِر المبلغ المطلوب<br /><span className="text-[11px] text-muted">أزل العلامة لورقة بالأسماء والتواريخ فقط</span></span>
        </label>

        {err && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mb-3">{err}</div>}

        <div className="flex gap-2">
          <button className="btn btn-gold flex-1 justify-center" disabled={busy} onClick={build}>
            {busy ? "جارٍ التجهيز…" : "🖨️ اعرض الكشف"}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
