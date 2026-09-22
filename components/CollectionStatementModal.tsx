"use client";
// ============================================================
// وثيق — كشف التحصيل
//
// نمط الكشف الذي يعدّه المكتب بيده في إكسل: صفٌّ لكل دفعة عبر كل العمائر
// في فترة، ثم المصروفات، ثم صافي الدخل.
//
// وهو مختلف عن كشوفنا القائمة: تلك تعرض حالة العقد لكل وحدة، وهذا يعرض
// حركة النقد. والمكتب يحتاج الاثنين لغرضين مختلفين.
//
// «البيان» يُشتقّ من السجل: رقم القسط من الدفعات التي سبقته، وملاحظة
// المكتب إن كتبها، و«جزء من القسط» حين كان المبلغ أقل من الدفعة الكاملة.
// ============================================================

import {useEffect, useMemo, useState} from "react";
import { createClient } from "@/lib/supabase-client";
import { fetchAllRows } from "@/lib/fetch-all";
import { collectionStatementHTML, pastVatOf } from "@/lib/documents";
import { buildCollection } from "@/lib/collection";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (n: number) => { const d = new Date(Date.parse(today() + "T00:00:00Z")); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sar = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];

const RANGES = [
  { k: "m", label: "هذا الشهر", from: () => today().slice(0, 7) + "-01", to: today },
  { k: "3", label: "آخر ٣ أشهر", from: () => shift(-90), to: today },
  { k: "6", label: "آخر ٦ أشهر", from: () => shift(-180), to: today },
  { k: "y", label: "هذه السنة", from: () => today().slice(0, 4) + "-01-01", to: today },
  { k: "c", label: "فترة مخصّصة", from: () => shift(-30), to: today },
];

export default function CollectionStatementModal({ properties, issuer, onClose }: {
  /** اسم المالك يأتي مع العقار — فالتصفية بالمالك بلا استعلام إضافي */
  /** العقار كاملًا: mgmt_fee_pct وإعدادات الضريبة تدخل حساب صافي المالك */
  properties: ({ id: string; name: string; owner_name?: string | null } & Record<string, any>)[];
  issuer: any;
  onClose: () => void;
}) {

  /* قفل تمرير الصفحة خلف النافذة — يُزال حتمًا عند الإغلاق */
  useEffect(() => {
    document.body.classList.add("wq-modal-open");
    return () => document.body.classList.remove("wq-modal-open");
  }, []);
  const supabase = useMemo(() => createClient(), []);
  const [rangeKey, setRangeKey] = useState("m");
  const [from, setFrom] = useState(RANGES[0].from());
  const [to, setTo] = useState(today());
  /**
   * ثلاثة نطاقات: كل العمائر · عمارة بعينها · مالك بعينه.
   *
   * المالك أهمّها عمليًّا: المكتب يسلّم لكل مالك كشف عمائره هو، ولا معنى
   * أن يرى فيه عمائر غيره.
   */
  const [scopeKind, setScopeKind] = useState<"all" | "property" | "owner">("all");
  const [scope, setScope] = useState("");           // معرّف العقار أو اسم المالك

  /* الملّاك المستخرَجون من العقارات — بلا تكرار وبعدد عمائر كلٍّ منهم */
  const owners = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of properties) {
      const o = (p.owner_name || "").trim();
      if (o) m.set(o, (m.get(o) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  }, [properties]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pickRange(k: string) {
    setRangeKey(k);
    const r = RANGES.find((x) => x.k === k)!;
    if (k !== "c") { setFrom(r.from()); setTo(r.to()); }
  }
  const label = rangeKey === "c" ? `من ${from} إلى ${to}` : RANGES.find((x) => x.k === rangeKey)!.label;

  async function build() {
    setBusy(true); setErr(null);
    try {
      const inScope = scopeKind === "property" ? properties.filter((p) => p.id === scope)
        : scopeKind === "owner" ? properties.filter((p) => (p.owner_name || "").trim() === scope)
        : properties;
      const ids = inScope.map((p) => p.id);
      if (!ids.length) {
        setErr(scopeKind === "owner" ? "لا عقارات مسجّلة لهذا المالك." : "لا عقارات بعد.");
        return;
      }

      /* بلا قصّ: كشف «منذ البداية» لمكتب كبير يتجاوز أي حدّ ثابت */
      const pays = await fetchAllRows(supabase as any, "payments",
        "*",
        (q) => q.in("property_id", ids).gte("paid_on", from).lte("paid_on", to).order("paid_on", { ascending: true }));
      /* كل الحقول: «على من» يحدّد الصافي، وإعدادات الضريبة والعدّاد وحدّ المدة
         يحدّدان الترقيم والضريبة */
      const exps = await fetchAllRows(supabase as any, "expenses", "*",
        (q) => q.in("property_id", ids).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: true }));
      const tenants = await fetchAllRows(supabase as any, "tenants", "*", (q) => q.in("property_id", ids));
      /* كل دفعات الساكنين الحاليين (كل الأوقات): الترقيم من بداية مدة العقد
         لا من بداية الفترة */
      const allTenantPayments = await fetchAllRows(supabase as any, "payments", "*",
        (q) => q.in("property_id", ids).not("tenant_id", "is", null).order("paid_on", { ascending: true }));
      const pastQ = await supabase.from("past_tenancies").select("id, snapshot").in("property_id", ids).limit(5000);

      const { rows, expRows, fin } = buildCollection({
        periodPayments: pays || [], allTenantPayments: allTenantPayments || [], expenses: exps || [],
        tenants: tenants || [], properties: inScope as any[], pastVat: pastQ.error ? undefined : pastVatOf(pastQ.data as any),
        issuer: issuer || {}, from,
      });
      const pName: Record<string, string> = Object.fromEntries(properties.map((p) => [p.id, p.name]));

      /* كشف «منذ البداية» لمكتب بسبع سنوات يقارب عشرين ألف صفّ — خمسة
         ميجابايت لا تُطبع ولا تُقرأ. نسأل قبل أن نُغرق المتصفح. */
      if (rows.length > 3000 && !confirm(
        `الكشف سيحتوي ${rows.length.toLocaleString("en-US")} عملية تحصيل.\n\n`
        + `مستند بهذا الحجم ثقيل على المتصفح وصعب الطباعة.\n`
        + `الأفضل تضييق الفترة أو اختيار عمارة واحدة.\n\nمتابعة على أي حال؟`
      )) { setBusy(false); return; }

      const title = scopeKind === "property" ? `كشف حساب — ${pName[scope] || ""}`
        : scopeKind === "owner" ? `كشف حساب — عمائر ${scope}`
        : "كشف حساب لعمائر المكتب";
      const html = collectionStatementHTML(rows, expRows, { label, from, to }, issuer || {}, { title, fin });
      const w = window.open("", "_blank");
      if (!w) { setErr("المتصفح منع فتح النافذة — اسمح بالنوافذ المنبثقة وأعد المحاولة."); return; }
      w.document.write(html); w.document.close();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "تعذّر بناء الكشف.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 grid place-items-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-bold text-deep text-lg mb-1">كشف التحصيل</h3>
        <p className="text-xs text-muted mb-4 leading-relaxed">
          كل دفعة استُلمت في الفترة عبر عمائرك، ثم المصروفات، ثم صافي الدخل.
        </p>

        <label className="block text-sm font-semibold mb-2">الفترة</label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {RANGES.map((r) => (
            <button key={r.k} type="button" onClick={() => pickRange(r.k)}
              className={`text-xs px-3 py-1.5 rounded-full border ${rangeKey === r.k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>
              {r.label}
            </button>
          ))}
        </div>
        {rangeKey === "c" && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <label className="block"><span className="text-[11px] text-muted">من</span>
              <input type="date" className="fld" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="block"><span className="text-[11px] text-muted">إلى</span>
              <input type="date" className="fld" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
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
              <>
                <select className="fld mb-1.5" value={scope} onChange={(e) => setScope(e.target.value)}>
                  {owners.map(([o, n]) => <option key={o} value={o}>{o} — {n} {n === 1 ? "عقار" : "عقارات"}</option>)}
                </select>
                <p className="text-[11px] text-muted mb-3 leading-relaxed">
                  يشمل كل عمائر هذا المالك عندك. وإن نقصت عمارة، فاسم المالك فيها مكتوب بصيغة مختلفة —
                  وحّده من إعدادات العقار.
                </p>
              </>
            )}
          </>
        )}

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
