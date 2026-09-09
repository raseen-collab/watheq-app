"use client";
// ============================================================
// وثيق — صفحة فحص سلامة البيانات
//
// زر واحد يفحص حساب المكتب كله ويعرض ما يحتاج إصلاحًا، بسبب كل ملاحظة
// وأثرها وما يُفعل. الهدف أن يجد المكتب الخلل قبل أن يكتشفه في تقرير مالك.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-client";
import { auditOffice, SEV_META, type Finding, type Severity } from "@/lib/integrity";

export default function DataHealth({ initial }: { initial: any[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [props, setProps] = useState<any[]>(initial || []);
  const [pays, setPays] = useState<any[]>([]);
  const [exps, setExps] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [sev, setSev] = useState<Severity | "all">("all");

  async function run() {
    setBusy(true);
    const [pr, pa, ex] = await Promise.all([
      supabase.from("properties").select("*, tenants(*)").limit(2000, { referencedTable: "tenants" }),
      supabase.from("payments").select("id,tenant_id,property_id,amount,paid_on").limit(5000),
      supabase.from("expenses").select("id,property_id,amount,spent_on").limit(5000),
    ]);
    if (!pr.error) setProps(pr.data || []);
    if (!pa.error) setPays(pa.data || []);
    if (!ex.error) setExps(ex.data || []);
    setRanAt(new Date().toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }));
    setBusy(false);
  }
  useEffect(() => { void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const findings = useMemo(() => auditOffice(props, pays, exps), [props, pays, exps]);
  const counts = useMemo(() => ({
    critical: findings.filter((f) => f.severity === "critical").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    info: findings.filter((f) => f.severity === "info").length,
  }), [findings]);
  const shown = sev === "all" ? findings : findings.filter((f) => f.severity === sev);

  const units = props.reduce((a, p) => a + (p.tenants?.length || 0), 0);

  return (
    <main className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-deep text-xl">🩺 فحص سلامة البيانات</h1>
          <p className="text-xs text-muted">
            يفحص {props.length} عقارًا و{units} وحدة بحثًا عمّا يفسد الحسابات بصمت.
            {ranAt && <> · آخر فحص {ranAt}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-gold text-sm" onClick={run} disabled={busy}>{busy ? "جارٍ الفحص…" : "↻ إعادة الفحص"}</button>
          <Link href="/dashboard/property" className="btn btn-ghost text-sm">← اللوحة</Link>
        </div>
      </div>

      {/* الحصيلة */}
      {!busy && findings.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center">
          <div className="text-4xl mb-2">✅</div>
          <h2 className="font-display font-bold text-deep text-lg mb-1">بياناتك سليمة</h2>
          <p className="text-sm text-muted">لا وحدة ناقصة ولا تاريخ مشبوه ولا رقم يفسد حسابًا.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {([["critical", counts.critical], ["warn", counts.warn], ["info", counts.info]] as const).map(([k, n]) => (
              <button key={k} onClick={() => setSev(sev === k ? "all" : k)}
                className={`text-right bg-white border rounded-2xl p-4 transition ${sev === k ? "border-deep ring-1 ring-deep" : "border-line"}`}>
                <div className="text-2xl font-bold tabular-nums text-deep">{n}</div>
                <div className="text-xs text-muted">{SEV_META[k].icon} {SEV_META[k].label}</div>
              </button>
            ))}
          </div>

          {counts.critical > 0 && (
            <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mb-4">
              <b>{counts.critical} ملاحظة تحتاج إصلاحًا الآن.</b> هذه تُفسد الحسابات فعليًّا — وحدات خارج المتابعة أو أرقام خاطئة في تقارير الملّاك.
            </div>
          )}

          <div className="space-y-2">
            {shown.map((f, i) => <Card key={f.id + i} f={f} />)}
          </div>
        </>
      )}
    </main>
  );
}

function Card({ f }: { f: Finding }) {
  const m = SEV_META[f.severity];
  return (
    <div className={`bg-white border rounded-xl p-3.5 ${f.severity === "critical" ? "border-[#F5C6C2]" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="font-semibold text-deep text-sm">{m.icon} {f.title}</div>
        {f.propertyName && (
          <Link href={`/dashboard/property?p=${f.propertyId}${f.unit ? `&q=${encodeURIComponent(f.unit)}` : ""}`}
            className="btn btn-ghost text-xs shrink-0">افتح</Link>
        )}
      </div>
      {(f.propertyName || f.tenantName) && (
        <div className="text-[11px] text-muted mb-1.5">
          {f.propertyName}{f.unit ? ` · وحدة ${f.unit}` : ""}{f.tenantName ? ` · ${f.tenantName}` : ""}
        </div>
      )}
      <p className="text-sm text-ink leading-relaxed mb-1">{f.why}</p>
      <p className="text-xs text-muted"><b className="text-deep">ما تفعله:</b> {f.fix}</p>
    </div>
  );
}
