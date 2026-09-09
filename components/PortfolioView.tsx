"use client";
// ============================================================
// وثيق — نظرة عامة على المحفظة: كل العقارات في صفحة واحدة
//
// لمكتب بعشرين أو ثلاثين عقارًا: فتح كل عقار على حدة لمعرفة من تأخّر
// ليس عملًا بل عقابًا. هنا: أرقام المحفظة كلها، ثم كل ما يحتاج إجراءً
// من كل العقارات في قوائم واحدة، ثم جدول العقارات بأرقامها، وبحث واحد
// يجد أي مستأجر بالاسم أو الجوال أو الهوية أو رقم العقد أو العداد.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-client";
import { contractState, isVacant, type Frequency } from "@/lib/contracts";
import { sar, waLink } from "@/lib/utils";
import { hijriShort } from "@/lib/hijri";
import ExpensesOverview from "@/components/ExpensesOverview";

type Tenant = any; type Property = any;
const PER_MONTH: Record<string, number> = { daily: 30, weekly: 4.33, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12 };
const UNIT_AR: Record<string, string> = { residential: "شقة", commercial: "محل", office: "مكتب", warehouse: "مستودع", land: "أرض", villa: "فيلا" };

export default function PortfolioView({ properties, windows }: {
  properties: Property[];
  windows: { soon: number; imminent: number; expiring: number };
}) {
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [monthCollected, setMonthCollected] = useState<Record<string, number> | null>(null);
  const [expOpen, setExpOpen] = useState(false);
  /* جدول العقارات بلا ترقيم: مكتب بمئة عقار يرسم 100 صف دفعة واحدة ويطيل
     الصفحة بلا فائدة — الأهم أعلاها (مرتّبة بالأكثر متأخرات). */
  const [propsShown, setPropsShown] = useState(25);

  // المحصَّل هذا الشهر لكل عقار — استعلام واحد لكل المحفظة
  useEffect(() => {
    const now = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
    const from = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-01`;
    const ids = properties.map((p) => p.id);
    if (!ids.length) { setMonthCollected({}); return; }
    supabase.from("payments").select("property_id, amount").in("property_id", ids).gte("paid_on", from).limit(5000)
      .then(({ data }) => {
        const m: Record<string, number> = {};
        (data || []).forEach((x: any) => { m[x.property_id] = (m[x.property_id] || 0) + (Number(x.amount) || 0); });
        setMonthCollected(m);
      });
  }, [properties, supabase]);

  const rows = useMemo(() => {
    const out: { p: Property; t: Tenant; st: ReturnType<typeof contractState> }[] = [];
    properties.forEach((p) => (p.tenants || []).forEach((t: Tenant) => {
      const st = contractState(t, {
        graceDays: Number(p.grace_days) || 0,
        soonDays: Number(p.soon_days) || windows.soon,
        imminentDays: Number(p.imminent_days) || windows.imminent,
        expiringDays: Number(p.expiring_days) || windows.expiring,
      });
      out.push({ p, t, st });
    }));
    return out;
  }, [properties, windows]);

  const totals = useMemo(() => {
    const T = { units: 0, vacant: 0, late: 0, overdue: 0, due: 0, soon: 0, expiring: 0, partial: 0, monthly: 0, litigation: 0 };
    rows.forEach(({ t, st }) => {
      T.units++;
      if (isVacant(t)) { T.vacant++; return; }
      if (t.litigation) T.litigation++;
      else if (st.status === "late") { st.hasPartial ? T.partial++ : T.late++; T.overdue += st.amountDue; }
      else if (st.status === "soon") { st.soonTier === "near" ? T.soon++ : T.due++; }
      if (st.expiringSoon) T.expiring++;
      T.monthly += (Number(t.rent_amount) || 0) * (PER_MONTH[t.payment_frequency || "monthly"] || 1);
    });
    return T;
  }, [rows]);
  const collectedTotal = monthCollected ? Object.values(monthCollected).reduce((a, b) => a + b, 0) : null;

  // ---------- البحث الشامل ----------
  const needle = q.trim().toLowerCase().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const hits = needle.length >= 2 ? rows.filter(({ p, t }) =>
    [t.name, t.unit, t.phone, t.national_id, t.contract_no, t.elec_account, t.water_account, p.name]
      .some((v) => v && String(v).toLowerCase().includes(needle))).slice(0, 30) : [];

  const late = rows.filter(({ t, st }) => !isVacant(t) && !t.litigation && st.status === "late").sort((a, b) => b.st.amountDue - a.st.amountDue);
  const due = rows.filter(({ t, st }) => !isVacant(t) && st.status === "soon" && st.soonTier !== "near").sort((a, b) => (a.st.daysToNextDue ?? 0) - (b.st.daysToNextDue ?? 0));
  const expiring = rows.filter(({ t, st }) => !isVacant(t) && st.expiringSoon).sort((a, b) => (a.st.daysToEnd ?? 0) - (b.st.daysToEnd ?? 0));
  const vacant = rows.filter(({ t }) => isVacant(t));

  const perProperty = properties.map((p) => {
    const mine = rows.filter((r) => r.p.id === p.id);
    const occ = mine.filter((r) => !isVacant(r.t));
    return {
      p, units: mine.length, occupied: occ.length,
      late: occ.filter((r) => r.st.status === "late" && !r.t.litigation).length,
      overdue: occ.reduce((a, r) => a + (r.st.status === "late" ? r.st.amountDue : 0), 0),
      due: occ.filter((r) => r.st.status === "soon").length,
      expiring: occ.filter((r) => r.st.expiringSoon).length,
      monthly: occ.reduce((a, r) => a + (Number(r.t.rent_amount) || 0) * (PER_MONTH[r.t.payment_frequency || "monthly"] || 1), 0),
      collected: monthCollected?.[p.id] ?? null,
    };
  }).sort((a, b) => b.overdue - a.overdue || b.late - a.late || a.p.name.localeCompare(b.p.name, "ar"));

  const remind = (p: Property, t: Tenant, st: any) =>
    waLink(t.phone, `السلام عليكم ${t.name} 🌿\n\nتذكير ودّي بأن الدفعة المستحقة عن ${UNIT_AR[p.property_type] || "الوحدة"} ${t.unit || ""} بعقار ${p.name} بمبلغ ${sar(st.amountDue)} ريال لم تصلنا بعد.\nنرجو السداد في أقرب وقت، وإن كان السداد قد تم فنعتذر ونرجو إرسال ما يثبته.\n\nشكرًا لتعاونكم.`);

  const Item = ({ p, t, st, note, tone }: { p: Property; t: Tenant; st: any; note: string; tone?: "late" | "due" | "exp" }) => (
    <div className="flex items-center justify-between gap-3 bg-white text-deep border border-line rounded-lg px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-semibold truncate text-deep">{t.name || <span className="text-muted font-normal">(بلا اسم مستأجر)</span>} <span className="text-muted font-normal text-xs">· {UNIT_AR[p.property_type] || "وحدة"} {t.unit || "—"} · {p.name}</span></div>
        <div className={`text-[11px] ${tone === "late" ? "text-late font-semibold" : tone === "due" ? "text-[#9A4B00]" : tone === "exp" ? "text-[#991B1B]" : "text-muted"}`}>{note}</div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {tone !== "exp" && t.phone && <a className="btn btn-wa text-xs px-2.5" href={remind(p, t, st)} target="_blank" rel="noreferrer" title="تذكير واتساب">💬</a>}
        <Link className="btn btn-ghost text-xs" href={`/dashboard/property?p=${p.id}&q=${encodeURIComponent(t.unit || t.name)}`}>فتح</Link>
      </div>
    </div>
  );

  return (
    <div>
      {/* ═══ البحث الشامل ═══ */}
      <div className="flex justify-end mb-3">
        <button className="btn btn-ghost text-sm" onClick={() => setExpOpen(true)}
          title="كل مصروفات المكتب بفلترة على المالك والفترة — جاهزة للطباعة">💸 مصروفات كل العقارات</button>
      </div>
      {expOpen && <ExpensesOverview properties={properties as any} onClose={() => setExpOpen(false)} />}
      <div className="bg-white border border-line rounded-2xl p-4 mb-4">
        <input className="fld text-base" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder="ابحث في كل العقارات: اسم المستأجر · الجوال · رقم الهوية · رقم العقد · رقم الوحدة · حساب الكهرباء أو الماء" />
        {needle.length >= 2 && (
          <div className="mt-3">
            {hits.length === 0 ? <p className="text-sm text-muted">لا نتائج لـ«{q}».</p> : (
              <div className="space-y-1.5">
                {hits.map(({ p, t, st }) => (
                  <Item key={t.id} p={p} t={t} st={st}
                    note={`${st.statusLabel}${t.phone ? ` · ${t.phone}` : ""}${t.national_id ? ` · هوية ${t.national_id}` : ""}${t.contract_no ? ` · عقد ${t.contract_no}` : ""}`}
                    tone={st.status === "late" ? "late" : undefined} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ أرقام المحفظة ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { v: `${properties.length}`, l: "عقار", s: `${totals.units} وحدة · ${totals.units ? Math.round(((totals.units - totals.vacant) / totals.units) * 100) : 0}% إشغال` },
          { v: sar(totals.overdue), l: "ريال متأخر", s: `${totals.late} متأخر · ${totals.partial} جزئي`, tone: totals.overdue ? "bad" : "" },
          { v: `${totals.due + totals.soon}`, l: `تستحق خلال ${windows.soon} يوم`, s: `${totals.due} مستحق · ${totals.soon} قريب`, tone: totals.due ? "warn" : "" },
          { v: collectedTotal === null ? "…" : sar(Math.round(collectedTotal)), l: "محصَّل هذا الشهر", s: `المتوقع شهريًّا ${sar(Math.round(totals.monthly))}`, tone: "good" },
        ].map((c) => (
          <div key={c.l} className="bg-white border border-line rounded-2xl p-4">
            <div className={`text-2xl font-bold tabular-nums ${c.tone === "bad" ? "text-late" : c.tone === "warn" ? "text-[#9A4B00]" : c.tone === "good" ? "text-[#137a50]" : "text-deep"}`}>{c.v}</div>
            <div className="text-xs text-muted">{c.l}</div>
            <div className="text-[11px] text-muted mt-0.5">{c.s}</div>
          </div>
        ))}
      </div>

      {/* ═══ يحتاج إجراء ═══ */}
      <div className="bg-deep text-[#EAF1EE] rounded-2xl p-5 mb-4">
        <div className="font-display font-bold text-goldSoft mb-3">يحتاج إجراء — من كل العقارات</div>
        {!late.length && !due.length && !expiring.length && !vacant.length ? <p className="text-sm opacity-80">لا شيء عاجل في المحفظة كلها.</p> : (
          <div className="grid lg:grid-cols-2 gap-4">
            {late.length > 0 && <div><div className="text-xs opacity-80 mb-1.5">🔴 متأخرون ({late.length}) — {sar(totals.overdue)} ريال</div><div className="space-y-1.5">{late.slice(0, 12).map(({ p, t, st }) => <Item key={t.id} p={p} t={t} st={st} tone="late" note={`${st.statusLabel} · ${sar(st.amountDue)} ريال`} />)}{late.length > 12 && <p className="text-[11px] opacity-70">و{late.length - 12} آخرون — افتح كل عقار لرؤيتهم</p>}</div></div>}
            {due.length > 0 && <div><div className="text-xs opacity-80 mb-1.5">🟠 مستحق خلال {windows.imminent} أيام ({due.length})</div><div className="space-y-1.5">{due.slice(0, 12).map(({ p, t, st }) => <Item key={t.id} p={p} t={t} st={st} tone="due" note={`${st.statusLabel} · ${st.nextDueDate} (${hijriShort(st.nextDueDate || "")})`} />)}</div></div>}
            {expiring.length > 0 && <div><div className="text-xs opacity-80 mb-1.5">⏳ عقود تنتهي خلال {windows.expiring} يومًا ({expiring.length})</div><div className="space-y-1.5">{expiring.slice(0, 12).map(({ p, t, st }) => <Item key={t.id} p={p} t={t} st={st} tone="exp" note={`ينتهي ${st.endDate} (بعد ${st.daysToEnd} يوم)`} />)}</div></div>}
            {vacant.length > 0 && <div><div className="text-xs opacity-80 mb-1.5">⚪ شاغرة ({vacant.length})</div><div className="space-y-1.5">{vacant.slice(0, 8).map(({ p, t, st }) => <Item key={t.id} p={p} t={t} st={st} note={t.move_out_date ? `شاغرة منذ ${t.move_out_date}` : "شاغرة"} />)}</div></div>}
          </div>
        )}
      </div>

      {/* ═══ جدول العقارات ═══ */}
      <div className="bg-white border border-line rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-line font-semibold text-deep">العقارات — الأعلى متأخرات أولًا</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs text-muted">
              <tr><th className="text-right px-3 py-2">العقار</th><th className="px-3 py-2">الوحدات</th><th className="px-3 py-2">متأخر</th><th className="px-3 py-2">ريال متأخر</th><th className="px-3 py-2">تستحق</th><th className="px-3 py-2">تنتهي</th><th className="px-3 py-2">محصَّل الشهر</th><th className="px-3 py-2">المتوقع شهريًّا</th><th></th></tr>
            </thead>
            <tbody>
              {perProperty.slice(0, propsShown).map((r) => (
                <tr key={r.p.id} className={`border-t border-line ${r.overdue > 0 ? "bg-[#FFF5F4]" : ""}`}>
                  <td className="px-3 py-2 font-semibold">{r.p.name}<div className="text-[11px] text-muted font-normal">{r.p.city || ""}{r.p.owner_name ? ` · ${r.p.owner_name}` : ""}</div></td>
                  <td className="px-3 py-2 text-center tabular-nums">{r.occupied}/{r.units}</td>
                  <td className={`px-3 py-2 text-center tabular-nums ${r.late ? "text-late font-bold" : "text-muted"}`}>{r.late || "—"}</td>
                  <td className={`px-3 py-2 text-center tabular-nums ${r.overdue ? "text-late font-bold" : "text-muted"}`}>{r.overdue ? sar(r.overdue) : "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{r.due || "—"}</td>
                  <td className={`px-3 py-2 text-center tabular-nums ${r.expiring ? "text-[#991B1B] font-semibold" : "text-muted"}`}>{r.expiring || "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-[#137a50] font-semibold">{r.collected === null ? "…" : sar(Math.round(r.collected))}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-muted">{sar(Math.round(r.monthly))}</td>
                  <td className="px-3 py-2"><Link className="btn btn-ghost text-xs" href={`/dashboard/property?p=${r.p.id}`}>فتح</Link></td>
                </tr>
              ))}
            </tbody>
            {perProperty.length > propsShown && (
              <tbody><tr><td colSpan={9} className="p-2 text-center">
                <button className="btn btn-ghost text-xs" onClick={() => setPropsShown((n) => n + 25)}>
                  عرض 25 عقارًا إضافيًّا — بقي {perProperty.length - propsShown}
                </button>
              </td></tr></tbody>
            )}
            <tfoot className="bg-paper text-xs">
              <tr><td className="px-3 py-2 font-semibold">الإجمالي</td><td className="px-3 py-2 text-center tabular-nums">{totals.units - totals.vacant}/{totals.units}</td><td className="px-3 py-2 text-center tabular-nums text-late font-bold">{totals.late || "—"}</td><td className="px-3 py-2 text-center tabular-nums text-late font-bold">{totals.overdue ? sar(totals.overdue) : "—"}</td><td className="px-3 py-2 text-center tabular-nums">{totals.due + totals.soon || "—"}</td><td className="px-3 py-2 text-center tabular-nums">{totals.expiring || "—"}</td><td className="px-3 py-2 text-center tabular-nums text-[#137a50] font-bold">{collectedTotal === null ? "…" : sar(Math.round(collectedTotal))}</td><td className="px-3 py-2 text-center tabular-nums">{sar(Math.round(totals.monthly))}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
