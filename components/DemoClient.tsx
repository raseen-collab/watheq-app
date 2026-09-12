"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PropertyView from "@/components/PropertyView";
import DemoGuide from "@/components/DemoGuide";
import { buildDemo, demoPayments, setDemoPhone } from "@/lib/demo-data";
import { sandboxClient, type SandboxStore } from "@/lib/sandbox-db";

/** يبني المكتب التجريبي في الذاكرة بالشكل الذي تتوقّعه اللوحة */
function buildStore(): { store: SandboxStore; properties: any[] } {
  setDemoPhone(null);
  const src = buildDemo(new Date());
  const store: SandboxStore = { properties: [], tenants: [], payments: [], expenses: [], property_notes: [], invoices: [], office_messages: [] };
  const properties: any[] = [];
  src.forEach((p, pi) => {
    const pid = `demo_p${pi}`;
    const { tenants, expenses, notes, ...prop } = p;
    const tRows = tenants.map((t, ti) => ({ ...t, id: `demo_t${pi}_${ti}`, property_id: pid }));
    const nRows = notes.map((n, ni) => ({ ...n, id: `demo_n${pi}_${ni}`, property_id: pid, done_at: null }));
    const eRows = expenses.map((e, ei) => ({ ...e, id: `demo_e${pi}_${ei}`, property_id: pid }));
    const idByUnit: Record<string, string> = {};
    tRows.forEach((t) => { idByUnit[String(t.unit)] = t.id; });
    const pays = demoPayments(p).filter((x) => idByUnit[x.unit]).map((x, xi) => ({
      id: `demo_pay${pi}_${xi}`, tenant_id: idByUnit[x.unit], property_id: pid,
      paid_on: x.paid_on, amount: x.amount, method: x.method, note: x.note, reference: x.reference, periods_covered: 1,
    }));
    const collected = pays.reduce((a, x) => a + x.amount, 0);
    const row = { ...prop, id: pid, is_demo: true, collected, tenants: tRows, property_notes: nRows };
    properties.push(row);
    store.properties.push({ ...prop, id: pid, is_demo: true, collected });
    store.tenants.push(...tRows);
    store.property_notes.push(...nRows);
    store.expenses.push(...eRows);
    store.payments.push(...pays);
  });
  return { store, properties };
}

export default function DemoClient() {
  const { store, properties } = useMemo(buildStore, []);
  const db = useMemo(() => sandboxClient(store), [store]);
  const [joinOpen, setJoinOpen] = useState(false);
  /* أي دعوة للتسجيل من داخل اللوحة (زر «ابدأ ببياناتي» مثلًا) تفتح النافذة */
  useEffect(() => {
    const open = () => setJoinOpen(true);
    window.addEventListener("watheq:demo-join", open);
    return () => window.removeEventListener("watheq:demo-join", open);
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      {/* شريط علوي يشرح أين هو ويعرض التسجيل — بلا إلحاح */}
      <div className="bg-deep text-[#EAF1EE] sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-display font-bold text-goldSoft">وثيق</span>
            <span className="text-[11px] opacity-75 truncate">تجربة حيّة — بلا تسجيل</span>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setJoinOpen(true)} className="bg-gold text-white rounded-lg px-3 py-1.5 text-xs font-bold">ابدأ مجانًا</button>
            <Link href="/login" className="text-[#CFE0DB] hover:text-white text-xs self-center">دخول</Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-3 py-4">
        <div className="bg-[#FBF1DF] border-2 border-dashed border-gold rounded-2xl px-4 py-3 mb-4 text-sm">
          <b className="text-deep">🎯 هذا مكتب تجريبي</b>
          <span className="text-muted"> — ٥ عقارات و٨٠ وحدة بحالات حقيقية. كل شيء هنا يعمل فعلًا:
            سجّل دفعة، افتح كشف حساب، جرّب تقرير المالك. التغييرات في متصفحك فقط ولا تُحفظ،
            والمستأجرون بلا أرقام أو هويات حقيقية.</span>
        </div>

        <PropertyView
          initial={properties}
          orgName="مكتب التجربة للأملاك"
          issuer={{ billing_name: "مكتب التجربة للأملاك", trial: true }}
          dueSoonDays={10} dueImminentDays={5} expiringDays={60}
          db={db} demo
        />
      </div>

      <DemoGuide onEvent={(e) => {
        if (e === "clear-demo") { setJoinOpen(true); return; }
        /* بقية الأفعال تنفّذها اللوحة نفسها — نمرّرها إليها كحدث */
        window.dispatchEvent(new CustomEvent("watheq:guide", { detail: e }));
      }} />

      {joinOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 grid place-items-center p-4" onClick={() => setJoinOpen(false)}>
          <div className="bg-white rounded-2xl border border-line max-w-sm w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-3xl mb-2">🚀</div>
            <h3 className="font-display font-bold text-deep text-lg mb-2">جاهز لبياناتك؟</h3>
            <p className="text-sm text-muted leading-relaxed mb-4">
              أنشئ حسابك مجانًا وابدأ بعقاراتك — أو أرسل لنا بياناتك بأي شكل (إكسل، صورة دفتر)
              ونجهّز حسابك كاملًا خلال يوم، بلا رسوم.
            </p>
            <div className="space-y-2">
              <Link href="/signup" className="btn btn-gold w-full justify-center">أنشئ حسابي مجانًا</Link>
              <a className="btn btn-wa w-full justify-center"
                href="https://wa.me/966596300591?text=%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85%20%D8%B9%D9%84%D9%8A%D9%83%D9%85%D8%8C%20%D8%AC%D8%B1%D9%91%D8%A8%D8%AA%20%D9%88%D8%AB%D9%8A%D9%82%20%D9%88%D8%A3%D8%A8%D8%BA%D9%89%20%D8%A3%D8%AC%D9%87%D9%91%D8%B2%20%D8%AD%D8%B3%D8%A7%D8%A8%D9%8A"
                target="_blank" rel="noreferrer">💬 جهّزوا لي حسابي</a>
              <button className="btn btn-ghost w-full justify-center text-sm" onClick={() => setJoinOpen(false)}>أكمل التجربة</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
