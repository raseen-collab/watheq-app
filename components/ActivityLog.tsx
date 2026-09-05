"use client";
// ============================================================
// وثيق — سجل العمليات: كل دفعة وكل تراجع، بمن سجّلها ولمن وبأي ساعة
//
// الغرض تدقيقي: «سُجّلت دفعة بالخطأ — على من، ومتى، ومن فعلها؟»
// يجيب بسطر واحد. المصدر جدول الدفعات نفسه (فيه created_by من v9
// وcreated_at من v11) — لا جدول سجل منفصل قد ينسى أحد الكتابة فيه.
// التراجع يُسجَّل صفًا سالبًا لا حذفًا، فالأثر لا يُمحى أبدًا.
// ============================================================

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { getOffice } from "@/lib/office";

type Entry = {
  id: string; created_at: string | null; paid_on: string; amount: number; method: string | null;
  note: string | null; tenant_id: string; property_id: string; created_by: string | null; periods_covered: number | null;
};

const METHOD_AR: Record<string, string> = { transfer: "تحويل", cash: "نقدًا", pos: "شبكة", cheque: "شيك", other: "أخرى" };
const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");

/** الوقت بتوقيت السعودية، ميلادي، بأرقام لاتينية — لا اجتهاد للمتصفح */
const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
      timeZone: "Asia/Riyadh", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return iso.slice(0, 16).replace("T", " "); }
};

export default function ActivityLog({ properties, onClose }: { properties: any[]; onClose: () => void }) {
  const supabase = createClient();
  const [rows, setRows] = useState<Entry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [me, setMe] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: { user } }, office] = await Promise.all([supabase.auth.getUser(), getOffice(supabase)]);
      setMe(user?.id || null);
      const { data, error } = await supabase.from("payments")
        .select("id, created_at, paid_on, amount, method, note, tenant_id, property_id, created_by, periods_covered")
        .order("created_at", { ascending: false, nullsFirst: false }).limit(300);
      if (error) { setErr(error.message); setLoading(false); return; }
      setRows((data || []) as Entry[]);
      if (office?.officeId) {
        const { data: actors } = await supabase.rpc("watheq_actor_names", { office: office.officeId });
        const m: Record<string, string> = {};
        (actors || []).forEach((a: any) => { m[a.actor_id] = a.actor_name; });
        setNames(m);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pName: Record<string, string> = {}; const tById: Record<string, any> = {};
  properties.forEach((p) => { pName[p.id] = p.name; (p.tenants || []).forEach((t: any) => { tById[t.id] = t; }); });

  const who = (id: string | null) => !id ? "—" : id === me ? `${names[id] || "أنا"} (أنا)` : names[id] || "موظف";
  const needle = q.trim();
  const shown = rows.filter((r) => {
    if (!needle) return true;
    const t = tById[r.tenant_id];
    return [t?.name, t?.unit, pName[r.property_id], who(r.created_by), r.note].some((x) => String(x || "").includes(needle));
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white rounded-2xl border border-line shadow-xl p-5 max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display font-bold text-deep text-xl">🕘 سجل العمليات</h2>
            <p className="text-xs text-muted">كل دفعة سُجّلت وكل تراجع — بمن سجّلها، ولأي مستأجر، وبأي ساعة. آخر 300 عملية.</p>
          </div>
          <button className="btn btn-ghost text-sm shrink-0" onClick={onClose}>إغلاق</button>
        </div>
        <input className="fld mb-3" placeholder="ابحث باسم المستأجر أو الوحدة أو العقار أو الموظف…" value={q} onChange={(e) => setQ(e.target.value)} />

        <div className="overflow-auto flex-1 border border-line rounded-xl">
          {loading ? <div className="p-6 text-center text-muted text-sm">جارٍ التحميل…</div>
          : err ? <div className="p-6 text-sm text-late">{err}</div>
          : shown.length === 0 ? <div className="p-6 text-center text-muted text-sm">لا عمليات بعد.</div>
          : (
            <table className="w-full text-sm">
              <thead className="bg-paper sticky top-0">
                <tr className="text-right">
                  <th className="p-2">الوقت</th><th className="p-2">العملية</th><th className="p-2">المستأجر</th>
                  <th className="p-2">العقار</th><th className="p-2">المبلغ</th><th className="p-2">بواسطة</th><th className="p-2">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const t = tById[r.tenant_id]; const neg = Number(r.amount) < 0;
                  return (
                    <tr key={r.id} className={`border-t border-line ${neg ? "bg-[#FBE9E7]" : ""}`}>
                      <td className="p-2 whitespace-nowrap text-muted" dir="ltr">{fmtTime(r.created_at)}</td>
                      <td className="p-2 whitespace-nowrap">{neg ? <span className="font-semibold text-late">↩︎ تراجع عن دفعة</span>
                        : r.periods_covered ? `✔ دفعة (${r.periods_covered})` : "½ سداد جزئي"}</td>
                      <td className="p-2">{t?.name || "—"}{t?.unit && <span className="text-muted text-xs"> · {t.unit}</span>}</td>
                      <td className="p-2 text-muted">{pName[r.property_id] || "—"}</td>
                      <td className={`p-2 font-semibold whitespace-nowrap ${neg ? "text-late" : ""}`}>{sar(r.amount)} <span className="text-[11px] text-muted">{METHOD_AR[r.method || ""] || ""}</span></td>
                      <td className="p-2 whitespace-nowrap">{who(r.created_by)}</td>
                      <td className="p-2 text-muted">{r.note || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[11px] text-muted mt-2">الوقت بتوقيت السعودية. الحمراء عمليات تراجع — تبقى في السجل ولا تُحذف، فالأثر محفوظ دائمًا.</p>
      </div>
    </div>
  );
}
