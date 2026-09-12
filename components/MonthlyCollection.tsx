"use client";
// ============================================================
// وثيق — التحصيل شهرًا بشهر
//
// طلب المكتب حرفيًّا: «اللي يهمني تحصيل كل شهر بشهره — كم دخل المكتب».
// البطاقة كانت تعرض رقمًا واحدًا للشهر الجاري، فمن دفع قبل شهرين يختفي
// أثره تمامًا ويبدو الشهر فارغًا بلا تفسير.
//
// هنا كل شهر بمبلغه المقبوض فعليًّا من سجل الدفعات — لا من العدّادات ولا
// من المتوقع. وشهر بلا تحصيل يُعرض صفرًا صريحًا لا فراغًا.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const sar = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
const p2 = (n: number) => String(n).padStart(2, "0");

type Row = { paid_on: string; amount: number };

export default function MonthlyCollection({ propertyId, propertyName, months = 6, db }: {
  propertyId: string;
  propertyName?: string;
  months?: number;
  db?: any;
}) {
  const supabase: any = useMemo(() => db || createClient(), [db]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [span, setSpan] = useState(months);

  useEffect(() => {
    if (!propertyId) return;
    let alive = true;
    setRows(null); setErr(null);
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - (span - 1), 1);
    const from = `${first.getFullYear()}-${p2(first.getMonth() + 1)}-01`;
    supabase.from("payments").select("paid_on, amount")
      .eq("property_id", propertyId).gte("paid_on", from).limit(5000)
      .then(({ data, error }: any) => {
        if (!alive) return;
        if (error) { setErr(error.message); setRows([]); return; }
        setRows((data || []) as Row[]);
      });
    return () => { alive = false; };
  }, [propertyId, span, supabase]);

  const buckets = useMemo(() => {
    const now = new Date();
    const out: { key: string; label: string; total: number; count: number }[] = [];
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: `${d.getFullYear()}-${p2(d.getMonth() + 1)}`, label: `${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`, total: 0, count: 0 });
    }
    (rows || []).forEach((r) => {
      const k = String(r.paid_on || "").slice(0, 7);
      const b = out.find((x) => x.key === k);
      if (b) { b.total += Number(r.amount) || 0; b.count++; }
    });
    return out;
  }, [rows, span]);

  const max = Math.max(1, ...buckets.map((b) => b.total));
  const total = buckets.reduce((a, b) => a + b.total, 0);
  const thisMonth = buckets[buckets.length - 1];

  return (
    <div className="bg-white border border-line rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-display font-bold text-deep text-sm">💰 التحصيل شهرًا بشهر</h3>
          <p className="text-[11px] text-muted">
            المقبوض فعليًّا من سجل الدفعات{propertyName ? ` — ${propertyName}` : ""} · لا يشمل ما استُلم قبل التسجيل في وثيق
          </p>
        </div>
        <div className="inline-flex border border-line rounded-lg p-0.5 text-[11px]">
          {[6, 12].map((n) => (
            <button key={n} type="button" onClick={() => setSpan(n)}
              className={`px-2.5 py-1 rounded-md ${span === n ? "bg-deep text-goldSoft" : "text-muted hover:text-deep"}`}>
              {n} أشهر
            </button>
          ))}
        </div>
      </div>

      {err && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-2.5 text-xs mb-3">{err}</div>}
      {rows === null ? (
        <p className="text-center text-xs text-muted py-6">جارٍ الحساب…</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {buckets.map((b, i) => {
              const isNow = i === buckets.length - 1;
              return (
                <div key={b.key} className="flex items-center gap-2 text-sm">
                  <span className={`w-24 shrink-0 text-xs ${isNow ? "font-bold text-deep" : "text-muted"}`}>{b.label}</span>
                  <div className="flex-1 h-5 bg-paper rounded-md overflow-hidden">
                    <div className={`h-full rounded-md transition-all ${b.total > 0 ? (isNow ? "bg-gold" : "bg-[#137a50]") : ""}`}
                      style={{ width: `${b.total > 0 ? Math.max(4, (b.total / max) * 100) : 0}%` }} />
                  </div>
                  <span className={`w-24 shrink-0 text-left tabular-nums ${b.total > 0 ? "font-semibold text-deep" : "text-muted"}`}>
                    {sar(b.total)}
                    {b.count > 0 && <span className="text-[10px] text-muted font-normal"> · {b.count}</span>}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 pt-3 border-t border-line text-xs">
            <span className="text-muted">إجمالي {span} أشهر: <b className="text-deep tabular-nums">{sar(total)}</b> ريال</span>
            <span className="text-muted">هذا الشهر: <b className={`tabular-nums ${thisMonth?.total ? "text-[#137a50]" : "text-muted"}`}>{sar(thisMonth?.total || 0)}</b> ريال</span>
            <span className="text-muted">متوسط الشهر: <b className="text-deep tabular-nums">{sar(total / Math.max(1, span))}</b> ريال</span>
          </div>

          {thisMonth && thisMonth.total === 0 && total > 0 && (
            <p className="text-[11px] text-muted mt-2 leading-relaxed">
              لم يُسجَّل تحصيل هذا الشهر بعد — الأشهر السابقة تُظهر ما قُبض فيها فعلًا.
            </p>
          )}
        </>
      )}
    </div>
  );
}
