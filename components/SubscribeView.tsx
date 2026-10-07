"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PROP_PLANS, HOA_PLANS, OFFICE_YEARLY, subPrice, type PropPlan, type HoaPlan } from "@/lib/pricing";
import { WATHEQ_WA } from "@/lib/utils";

export type SubscribeBank = { iban: string; bank: string; name: string };
export type SubscribeClaim = {
  id: string; prop_plan: PropPlan | null; hoa_plan: HoaPlan | null; months: number; amount: number;
  payer_name: string; bank_ref: string | null; transfer_date: string;
  status: "pending" | "processing" | "approved" | "rejected" | "cancelled"; reject_reason: string | null; created_at: string;
};
type ProductStatus = { product: "property" | "hoa"; plan: string | null; kind: string; subDaysLeft: number | null; trialDaysLeft: number | null };

const sar = (n: number) => n.toLocaleString("en-US");
const propName = (id?: string | null) => PROP_PLANS.find((x) => x.id === id)?.name || "";
const hoaName = (id?: string | null) => HOA_PLANS.find((x) => x.id === id)?.name || "";

function statusLine(s: ProductStatus): string {
  const side = s.product === "hoa" ? "الجمعيات" : "الأملاك";
  if (s.kind === "paid" || s.kind === "paid_soon") return `${side}: مشترك${s.subDaysLeft !== null ? ` — متبقٍ ${s.subDaysLeft} يومًا` : ""}`;
  if (s.kind === "grace") return `${side}: انتهى الاشتراك — ضمن فترة السماح`;
  if (s.kind === "trial") return `${side}: تجربة مجانية${s.trialDaysLeft !== null ? ` — متبقٍ ${s.trialDaysLeft} يومًا` : ""}`;
  return `${side}: منتهٍ — للقراءة والتصدير فقط`;
}

export default function SubscribeView({ accountType, status, subscribedUntil, claims, bank, ready, today }: {
  accountType: "landlord" | "hoa_manager" | "both";
  status: ProductStatus[];
  subscribedUntil: string | null;
  claims: SubscribeClaim[];
  bank: SubscribeBank | null;
  ready: boolean;
  today: string;
}) {
  const router = useRouter();
  const hasProp = accountType !== "hoa_manager";
  const hasHoa = accountType !== "landlord";
  const current = (pr: "property" | "hoa") => status.find((s) => s.product === pr)?.plan || null;

  const initProp = (): PropPlan | null => {
    if (!hasProp) return null;
    const c = current("property");
    return c === "basic" ? "basic" : "full";
  };
  const initHoa = (): HoaPlan | null => {
    if (!hasHoa || accountType === "both") return null;    // المزدوج يختار الجمعيات بنفسه
    const c = current("hoa");
    return c === "basic" || c === "full" ? c : "pro";
  };

  const [prop, setProp] = useState<PropPlan | null>(initProp);
  const [hoa, setHoa] = useState<HoaPlan | null>(initHoa);
  const [months, setMonths] = useState<1 | 12>(1);
  const [payer, setPayer] = useState("");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const yearlyOk = prop === "full" && !hoa;
  const effMonths = yearlyOk ? months : 1;
  const total = useMemo(() => subPrice(prop, hoa, effMonths), [prop, hoa, effMonths]);

  const open = claims.find((c) => c.status === "pending" || c.status === "processing");
  const lastRejected = !open ? claims.find((c) => c.status === "rejected") : undefined;

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* تجاهل */ }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (total === null) { setErr("اختر باقة صالحة."); return; }
    if (payer.trim().length < 2) { setErr("اكتب اسم المحوِّل كما يظهر في البنك."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prop, hoa, months: effMonths, payer, ref, date }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { setErr(j.error || "تعذّر الإرسال — أعد المحاولة."); return; }
      router.refresh();
    } catch {
      setErr("تعذّر الاتصال — تأكد من الإنترنت وأعد المحاولة.");
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      router.refresh();
    } finally { setBusy(false); }
  }

  const waHelp = `https://wa.me/${WATHEQ_WA}?text=${encodeURIComponent("أبغى أشترك في وثيق")}`;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/dashboard" className="text-sm text-gold font-semibold">← العودة إلى اللوحة</Link>
      <h1 className="font-display font-bold text-deep text-2xl mt-3 mb-1">اشترك في وثيق</h1>
      <div className="text-sm text-muted mb-6 leading-relaxed">
        {status.map((s) => <div key={s.product}>{statusLine(s)}</div>)}
        {subscribedUntil && <div>نهاية الاشتراك الحالي: {subscribedUntil} — التجديد يُضاف بعدها فلا تخسر أيامك.</div>}
      </div>

      {!ready && (
        <div className="bg-white border border-line rounded-2xl p-6 text-center">
          <p className="text-sm text-muted mb-4">صفحة الاشتراك قيد التجهيز. راسلنا وننهي اشتراكك مباشرة.</p>
          <a href={waHelp} target="_blank" rel="noreferrer" className="btn btn-gold">راسلنا على واتساب</a>
        </div>
      )}

      {ready && open && (
        <div className="bg-white border border-line rounded-2xl p-6">
          <div className="text-3xl mb-2">⏳</div>
          <h2 className="font-display font-bold text-deep text-lg mb-2">طلبك قيد المراجعة</h2>
          <p className="text-sm text-muted leading-relaxed mb-4">
            وصلنا بلاغ حوالتك، ونفعّل اشتراكك بعد مطابقتها مع كشف البنك — عادةً في نفس اليوم. لا تحتاج إرسال أي شيء آخر.
          </p>
          <dl className="text-sm grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 mb-5">
            <dt className="text-muted">الباقة</dt>
            <dd className="font-semibold">{[propName(open.prop_plan), open.hoa_plan ? `جمعيات: ${hoaName(open.hoa_plan)}` : ""].filter(Boolean).join(" + ")} · {open.months === 12 ? "سنوي" : "شهري"}</dd>
            <dt className="text-muted">المبلغ</dt><dd className="font-semibold">{sar(Number(open.amount))} ريال</dd>
            <dt className="text-muted">المحوِّل</dt><dd>{open.payer_name}</dd>
            {open.bank_ref && <><dt className="text-muted">المرجع</dt><dd>{open.bank_ref}</dd></>}
            <dt className="text-muted">تاريخ التحويل</dt><dd>{open.transfer_date}</dd>
          </dl>
          {open.status === "pending" && (
            <button onClick={cancel} disabled={busy} className="text-sm text-[#8f2b26] underline">
              اخترت باقة خطأ؟ ألغِ الطلب وأعد الإرسال
            </button>
          )}
        </div>
      )}

      {ready && !open && (
        <form onSubmit={submit} className="space-y-5">
          {lastRejected && (
            <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#8f2b26] rounded-xl p-4 text-sm leading-relaxed">
              لم نتمكّن من تأكيد حوالتك السابقة{lastRejected.reject_reason ? `: ${lastRejected.reject_reason}` : "."} راجع البيانات وأعد الإرسال، أو راسلنا.
            </div>
          )}

          {hasProp && (
            <section className="bg-white border border-line rounded-2xl p-5">
              <h2 className="font-display font-bold text-deep mb-3">{accountType === "both" ? "١) باقة إدارة الأملاك" : "١) اختر الباقة"}</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {accountType === "both" && (
                  <PlanCard active={prop === null} onClick={() => setProp(null)} title="بلا تجديد الآن" price="" note="أجدّد الجمعيات فقط" />
                )}
                {PROP_PLANS.map((pl) => (
                  <PlanCard key={pl.id} active={prop === pl.id} onClick={() => setProp(pl.id)}
                    title={pl.name} price={`${pl.monthly} ريال / شهريًا`}
                    note={pl.id === "full" ? `${pl.note} · أو ${sar(OFFICE_YEARLY)} سنويًا` : pl.note} />
                ))}
              </div>
            </section>
          )}

          {hasHoa && (
            <section className="bg-white border border-line rounded-2xl p-5">
              <h2 className="font-display font-bold text-deep mb-3">{accountType === "both" ? "٢) باقة اتحاد الملاك" : "١) اختر الباقة"}</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {accountType === "both" && (
                  <PlanCard active={hoa === null} onClick={() => setHoa(null)} title="بلا تجديد الآن" price="" note="أجدّد الأملاك فقط" />
                )}
                {HOA_PLANS.map((pl) => (
                  <PlanCard key={pl.id} active={hoa === pl.id} onClick={() => setHoa(pl.id)}
                    title={pl.name} price={`${pl.monthly} ريال / شهريًا`} note={pl.note} />
                ))}
              </div>
            </section>
          )}

          <section className="bg-white border border-line rounded-2xl p-5">
            <h2 className="font-display font-bold text-deep mb-3">المدة</h2>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => setMonths(1)}
                className={`btn text-sm ${effMonths === 1 ? "btn-gold" : "bg-white border border-line text-deep"}`}>شهري</button>
              <button type="button" onClick={() => yearlyOk && setMonths(12)} disabled={!yearlyOk}
                className={`btn text-sm ${effMonths === 12 ? "btn-gold" : "bg-white border border-line text-deep"} disabled:opacity-40`}>
                سنوي — {sar(OFFICE_YEARLY)} ريال (شهران مجانًا)
              </button>
            </div>
            {!yearlyOk && <p className="text-xs text-muted mt-2">السنوي متاح لباقة المكتب.</p>}
            <div className="mt-4 text-lg">
              الإجمالي: <b className="text-deep">{total === null ? "—" : `${sar(total)} ريال`}</b>
              <span className="text-xs text-muted"> {effMonths === 12 ? "لمدة سنة" : "لمدة شهر"}</span>
            </div>
          </section>

          <section className="bg-white border border-line rounded-2xl p-5">
            <h2 className="font-display font-bold text-deep mb-3">٢) حوّل المبلغ</h2>
            {bank ? (
              <div className="space-y-2 text-sm">
                {bank.name && <Row label="اسم المستفيد" value={bank.name} onCopy={() => copy(bank.name, "name")} copied={copied === "name"} />}
                {bank.bank && <Row label="البنك" value={bank.bank} />}
                <Row label="الآيبان" value={bank.iban} mono onCopy={() => copy(bank.iban.replace(/\s+/g, ""), "iban")} copied={copied === "iban"} />
                {total !== null && <Row label="المبلغ" value={`${sar(total)} ريال`} onCopy={() => copy(String(total), "amt")} copied={copied === "amt"} />}
              </div>
            ) : (
              <p className="text-sm text-muted">
                لبيانات التحويل <a href={waHelp} target="_blank" rel="noreferrer" className="text-gold font-semibold underline">راسلنا على واتساب</a>، ثم ارجع هنا وأكمل الخطوة التالية.
              </p>
            )}
          </section>

          <section className="bg-white border border-line rounded-2xl p-5 space-y-3">
            <h2 className="font-display font-bold text-deep">٣) أبلغنا بالتحويل</h2>
            <label className="block text-sm">
              <span className="text-muted">اسم المحوِّل كما يظهر في البنك</span>
              <input value={payer} onChange={(e) => setPayer(e.target.value)} maxLength={80} required
                className="mt-1 w-full border border-line rounded-lg px-3 py-2" />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-muted">تاريخ التحويل</span>
                <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required
                  className="mt-1 w-full border border-line rounded-lg px-3 py-2" />
              </label>
              <label className="block text-sm">
                <span className="text-muted">رقم المرجع (اختياري)</span>
                <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60}
                  className="mt-1 w-full border border-line rounded-lg px-3 py-2" />
              </label>
            </div>
            {err && <p className="text-sm text-[#8f2b26]">{err}</p>}
            <button type="submit" disabled={busy || total === null} className="btn btn-gold w-full disabled:opacity-50">
              {busy ? "جارٍ الإرسال…" : "أرسلت الحوالة"}
            </button>
            <p className="text-xs text-muted leading-relaxed">
              نفعّل اشتراكك بعد مطابقة الحوالة مع كشف البنك — عادةً في نفس اليوم.
            </p>
          </section>
        </form>
      )}
    </main>
  );
}

function PlanCard({ active, onClick, title, price, note }: { active: boolean; onClick: () => void; title: string; price: string; note: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`text-right rounded-xl border p-4 transition ${active ? "border-gold bg-[#FBF6EA] ring-1 ring-gold" : "border-line bg-white hover:border-gold/50"}`}>
      <div className="font-bold text-deep">{title}</div>
      {price && <div className="text-sm text-deep mt-1">{price}</div>}
      <div className="text-xs text-muted mt-1">{note}</div>
    </button>
  );
}

function Row({ label, value, mono, onCopy, copied }: { label: string; value: string; mono?: boolean; onCopy?: () => void; copied?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-line rounded-lg px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className={`font-semibold text-deep break-all ${mono ? "font-mono text-[13px]" : ""}`} dir={mono ? "ltr" : undefined}>{value}</div>
      </div>
      {onCopy && <button type="button" onClick={onCopy} className="text-xs text-gold font-semibold shrink-0">{copied ? "✓ نُسخ" : "نسخ"}</button>}
    </div>
  );
}
