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
import { collectionStatementHTML, type CollectionRow } from "@/lib/documents";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (n: number) => { const d = new Date(Date.parse(today())); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
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
  properties: { id: string; name: string; owner_name?: string | null }[];
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
        "id,paid_on,amount,method,note,reference,periods_covered,tenant_id,property_id",
        (q) => q.in("property_id", ids).gte("paid_on", from).lte("paid_on", to).order("paid_on", { ascending: true }));
      const exps = await fetchAllRows(supabase as any, "expenses", "id,spent_on,amount,category,note,billable,paid_by,property_id",
        (q) => q.in("property_id", ids).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: true }));
      const tenants = await fetchAllRows(supabase as any, "tenants",
        "id,name,unit,contract_no,rent_amount,calendar,property_id", (q) => q.in("property_id", ids));

      const pName: Record<string, string> = Object.fromEntries(properties.map((p) => [p.id, p.name]));
      const tById: Record<string, any> = Object.fromEntries((tenants || []).map((t: any) => [t.id, t]));

      /**
       * ترقيم الأقساط بالمبلغ المتراكم لا بعدد الصفوف.
       *
       * العدّ بالصفوف كان يُخطئ في حالتين: من دفع نصف القسط ثم أكمله يظهر
       * له «جزء من القسط الثاني» وهو لم يبدأه بعد؛ ومن تجاوز عشر دفعات
       * يظل عند «القسط العاشر». وكلاهما رقم يقرؤه المالك ويحاسب عليه.
       *
       * الصواب: رقم القسط = ما اكتمل من المبلغ قبل هذه الدفعة + 1.
       */
      /**
       * إسقاط الدفعة المعكوسة مع عكسها.
       *
       * تصفية «amount > 0» وحدها تُبقي الدفعة الأصلية وتحذف عكسها — فيضخّم
       * الكشف بمقدارها. والكشف يُسلَّم للمالك، فالرقم المضخَّم فيه أخطر
       * من أي عطل آخر.
       */
      const positives = (pays || []).filter((x: any) => Number(x.amount) > 0);
      const reversals = (pays || []).filter((x: any) => Number(x.amount) < 0);
      const dropped = new Set<string>();
      /* كل عكس يستهلك دفعةً واحدة؛ وما لم يجد دفعته يُسجَّل هنا لحظتَها —
         وإعادة الفحص لاحقًا كانت تعدّ العكس الثاني «مقابَلًا» بدفعة
         استهلكها الأول، فيسقط الاثنان ويعرض الكشف مالًا لم يبقَ. */
      const unmatched: any[] = [];
      for (const rev of reversals) {
        const amt = Math.abs(Number(rev.amount));
        const hit = positives.find((x: any) => !dropped.has(x.id)
          && String(x.tenant_id) === String(rev.tenant_id)
          && Math.abs(Number(x.amount) - amt) < 0.01);
        if (hit) dropped.add(hit.id); else unmatched.push(rev);
      }
      const clean = positives.filter((x: any) => !dropped.has(x.id));

      const paidSoFar: Record<string, number> = {};
      const ord = (n: number) => (n <= 10 ? `القسط ${ORD[n]}` : `القسط ${n}`);
      const rows: CollectionRow[] = clean
        .map((x: any) => {
          const t = tById[x.tenant_id] || {};
          const rent = Number(t.rent_amount) || 0;
          const amt = Number(x.amount) || 0;
          const before = paidSoFar[x.tenant_id] || 0;
          const after = before + amt;
          paidSoFar[x.tenant_id] = after;

          let base: string;
          if (rent <= 0) base = "دفعة";
          else {
            const idx = Math.floor(before / rent) + 1;          // القسط الذي تقع فيه هذه الدفعة
            const doneBefore = before % rent;                    // ما سُدّد منه سلفًا
            const rem = rent - (after % rent === 0 ? rent : after % rent);
            if (after % rent === 0 || Math.floor(after / rent) > Math.floor(before / rent)) {
              /* دفعة تغطّي أكثر من قسط: المكتب يكتبها «سداد 3 شهور» — نسمّيها بمداها */
              const last = Math.ceil((after - 0.01) / rent);
              base = last > idx
                ? `الأقساط ${idx}–${last}`
                : doneBefore > 0.01 ? `إكمال ${ord(idx)}` : ord(idx);
            } else {
              base = `جزء من ${ord(idx)} — باقٍ ${sar(rem)}`;
            }
          }
          const statement = /^جزء من/.test(base)
            ? base
            : (x.note && !/بوت|تراجع|عكس/.test(String(x.note)) ? `${base} · ${x.note}` : base);
          return {
            property: pName[x.property_id] || "—",
            unit: t.unit ?? null,
            tenant: t.name ?? null,
            paid_on: x.paid_on,
            amount: amt,
            statement,
            contract_no: t.contract_no || (x.reference ? `حوالة ${x.reference}` : null),
            calendar: t.calendar,
          };
        });

      /* صفوف العكس غير المقابَل تُضاف بمبالغها السالبة */
      for (const rev of unmatched) {
        const t = tById[rev.tenant_id] || {};
        rows.push({
          property: pName[rev.property_id] || "—",
          unit: t.unit ?? null, tenant: t.name ?? null,
          paid_on: rev.paid_on, amount: Number(rev.amount) || 0,
          statement: "عكس دفعة استُلمت قبل الفترة",
          contract_no: t.contract_no || null, calendar: t.calendar,
        });
      }
      rows.sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)));

      /* المصروفات التي يتحمّلها المالك — مصروف المكتب لا يدخل كشفه */
      const expRows = (exps || [])
        .filter((e: any) => e.billable !== false && e.paid_by !== "office")
        .map((e: any) => ({ note: e.note, category: e.category, amount: Number(e.amount) || 0 }));

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
      const html = collectionStatementHTML(rows, expRows, { label, from, to }, issuer || {}, { title });
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
