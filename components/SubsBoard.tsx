"use client";
// ============================================================
// وثيق — لوحة تشغيل الاشتراكات
//
// سؤال واحد تجيب عنه: من أتواصل معه اليوم، وبماذا؟
// مرتّبة بالإلحاح: من خرج من السماح أولًا، ثم من فيه، ثم من يقترب.
// لكل صف رسالة واتساب مكتوبة بمرحلته، وتسجيل تجديد بضغطة.
// ============================================================

import { useMemo, useState } from "react";
import { actionList, stageOf, renewalMessage, renewalWaLink, STAGE_META, type SubAccount, type Stage } from "@/lib/subs-ops";
import { GRACE_DAYS } from "@/lib/subscription";

const sar = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
const nDays = (n: number | null) =>
  n === null ? "" : n < 0 ? `منذ ${Math.abs(n)} يومًا` : n === 0 ? "اليوم" : n === 1 ? "غدًا" : `${n} أيام`;

export default function SubsBoard({ accounts, onRenew }: {
  accounts: SubAccount[];
  /** يسجّل التجديد ويصدر الفاتورة — يُمرَّر من الصفحة */
  onRenew?: (a: SubAccount, months: number) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const list = useMemo(() => actionList(accounts), [accounts]);
  const groups = useMemo(() => {
    const g: Record<string, typeof list> = {};
    list.forEach((x) => { (g[x.stage] ||= []).push(x); });
    return g;
  }, [list]);

  const active = accounts.filter((a) => stageOf(a).stage === "ok").length;
  const atRisk = list.filter((x) => ["expired", "grace", "due_today"].includes(x.stage));
  const unitsAtRisk = atRisk.reduce((s, x) => s + (x.a.units || 0), 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { v: String(accounts.length), l: "حساب", c: "text-deep" },
          { v: String(active), l: "اشتراك ساري", c: "text-[#137a50]" },
          { v: String(atRisk.length), l: "يحتاج تواصلًا اليوم", c: atRisk.length ? "text-late" : "text-muted" },
          { v: sar(unitsAtRisk), l: "وحدة معرّضة للانقطاع", c: unitsAtRisk ? "text-[#9A4B00]" : "text-muted" },
        ].map((x) => (
          <div key={x.l} className="bg-white border border-line rounded-2xl p-4">
            <div className={`text-2xl font-bold tabular-nums ${x.c}`}>{x.v}</div>
            <div className="text-xs text-muted">{x.l}</div>
          </div>
        ))}
      </div>

      {!list.length ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center">
          <div className="text-4xl mb-2">✅</div>
          <p className="font-display font-bold text-deep">لا أحد يحتاج تواصلًا اليوم.</p>
          <p className="text-sm text-muted mt-1">كل الاشتراكات سارية وبعيدة عن الانتهاء.</p>
        </div>
      ) : (
        (["expired", "grace", "due_today", "due_soon", "trial_ending"] as Stage[]).map((st) => {
          const g = groups[st];
          if (!g?.length) return null;
          const m = STAGE_META[st];
          return (
            <section key={st} className="mb-5">
              <h2 className="font-display font-bold text-deep text-sm mb-2">
                {m.icon} {m.label} <span className="text-muted font-normal">({g.length})</span>
                {st === "grace" && <span className="text-[11px] text-muted font-normal"> — كل المزايا تعمل حتى ينتهي السماح</span>}
              </h2>
              <div className="space-y-2">
                {g.map(({ a, days }) => {
                  const wa = renewalWaLink(a, st, days);
                  const msg = renewalMessage(a, st, days);
                  return (
                    <div key={a.id} className={`bg-white border rounded-xl p-3 ${st === "expired" ? "border-[#F5C6C2]" : "border-line"}`}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="font-semibold text-deep">
                            {a.org_name || a.full_name || "حساب بلا اسم"}
                            <span className={`ms-2 text-[11px] px-2 py-0.5 rounded-full border ${m.cls}`}>{nDays(days)}</span>
                          </div>
                          <div className="text-[11px] text-muted mt-0.5">
                            {a.plan ? `باقة ${a.plan}` : "بلا باقة"}
                            {a.units ? ` · ${a.units} وحدة` : ""}
                            {a.properties ? ` · ${a.properties} عقارات` : ""}
                            {a.subscribed_until ? ` · ينتهي ${String(a.subscribed_until).slice(0, 10)}` : ""}
                            {a.billing_phone ? ` · ${a.billing_phone}` : " · لا جوال مسجّل"}
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0 flex-wrap">
                          {wa
                            ? <a className="btn btn-wa text-xs" href={wa} target="_blank" rel="noreferrer">💬 راسله</a>
                            : <button className="btn btn-ghost text-xs" onClick={() => { navigator.clipboard?.writeText(msg); setCopied(a.id); setTimeout(() => setCopied(null), 1500); }}>
                                {copied === a.id ? "نُسخت ✓" : "انسخ الرسالة"}
                              </button>}
                          {onRenew && (
                            <select className="fld !w-auto !py-1 text-xs" defaultValue=""
                              onChange={(e) => { const v = Number(e.target.value); if (v) { onRenew(a, v); e.currentTarget.value = ""; } }}>
                              <option value="">سجّل تجديدًا…</option>
                              <option value="1">شهر</option><option value="3">3 أشهر</option>
                              <option value="6">6 أشهر</option><option value="12">سنة</option>
                            </select>
                          )}
                        </div>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-muted">اقرأ الرسالة قبل الإرسال</summary>
                        <pre className="mt-1.5 whitespace-pre-wrap text-[11px] bg-paper border border-line rounded-lg p-2 leading-relaxed">{msg}</pre>
                      </details>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      <div className="text-[11px] text-muted mt-4 leading-relaxed">
        دورة الاشتراك: تذكير قبل <b>7 أيام</b> · يوم الانتهاء يبقى ساريًا كاملًا ·
        ثم <b>{GRACE_DAYS} أيام سماح</b> بكل المزايا · بعدها تعود المستندات بعلامة «نسخة تجريبية» والبيانات محفوظة كما هي.
      </div>
    </div>
  );
}
