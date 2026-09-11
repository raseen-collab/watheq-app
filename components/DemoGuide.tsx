"use client";
// ============================================================
// وثيق — دليل التجربة
//
// الزائر من إعلان يدخل مكتبًا تجريبيًّا ولا يعرف من أين يبدأ. الدليل يأخذه
// في سبع خطوات قصيرة، كل خطوة فعل واحد يجرّبه بيده لا شرح يقرؤه:
// يرى المتأخر، يرسل تذكيرًا، يسجّل دفعة، يفتح كشفًا، يرى تقرير المالك.
//
// مصمَّم للجوال أولًا: ورقة سفلية صغيرة فوق الأزرار العائمة، تُطوى إلى
// شارة، وتتذكّر موضعه. لا نافذة تغطّي الشاشة ولا نصّ يتجاوز ثلاثة أسطر.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";

type Step = {
  title: string;
  body: string;
  /** زر الفعل: حدث تلتقطه اللوحة، أو رابط */
  action?: { label: string; event?: string; href?: string };
};

const STEPS: Step[] = [
  { title: "هذا مكتبك التجريبي 👋",
    body: "٥ عقارات و٨٠ وحدة بحالات حقيقية: متأخرون ومنتظمون وشواغر. كل ما تراه يعمل فعلًا — جرّب بلا خوف، وتحذفه بضغطة متى شئت.",
    action: { label: "ابدأ الجولة", event: "next" } },
  { title: "من عليه متأخرات؟",
    body: "الشارات تقول كل شيء: أحمر متأخر، برتقالي مستحق، أخضر منتظم. اضغط الفلتر لترى المتأخرين وحدهم.",
    action: { label: "أرِني المتأخرين", event: "filter:late" } },
  { title: "ذكّره بضغطة",
    body: "على أي مستأجر متأخر اضغط 💬 الأخضر — يفتح واتساب برسالة مكتوبة بالمبلغ والتاريخ. المستأجرون هنا بلا أرقام حقيقية، فالرسالة تصلك أنت أو تختار المستلم.",
    action: { label: "فهمت — التالي", event: "next" } },
  { title: "سجّل دفعة",
    body: "زر ✔ الأخضر الداكن يسجّل دفعة كاملة باسمك وبالتاريخ. جرّبه على متأخر — وستراه يتحوّل «منتظم» فورًا.",
    action: { label: "التالي", event: "next" } },
  { title: "كشف حساب جاهز",
    body: "افتح «📄 مستندات ▾» ← «كشف حساب العقار». يطلع كشف باسم مكتبك، تطبعه أو تحفظه PDF.",
    action: { label: "افتح كشف العقار", event: "open:statement" } },
  { title: "ماذا يستلم المالك؟",
    body: "«👤 المالك ▾» ← «تقرير المالك»: المحصَّل ناقص المصروفات ناقص أتعابك = صافيه. تختار الفترة، وله رابط يفتحه بنفسه.",
    action: { label: "افتح تقرير المالك", event: "open:owner" } },
  { title: "كل عقاراتك في صفحة",
    body: "«نظرة عامة» تجمع المحفظة كلها: من تأخر في أي عقار، والدخل المتوقع، وبحث في كل الوحدات بالاسم أو الجوال.",
    action: { label: "افتح النظرة العامة", href: "/dashboard/property/overview" } },
  { title: "جاهز لبياناتك؟ 🎯",
    body: "احذف التجريبي وأضف عقارك — أو أرسل لنا بياناتك بأي شكل ونجهّز حسابك مجانًا في يوم واحد.",
    action: { label: "احذف التجريبي وابدأ", event: "clear-demo" } },
];

const KEY = "watheq.guide.step";

export default function DemoGuide({ onEvent }: { onEvent: (event: string) => void }) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "done") setOpen(false);
      else if (saved) setStep(Math.min(STEPS.length - 1, Number(saved) || 0));
    } catch { /* */ }
    setReady(true);
  }, []);
  const save = (n: number | "done") => { try { localStorage.setItem(KEY, String(n)); } catch { /* */ } };
  /* على الجوال تحتل الورقة أسفل الشاشة كلّه — فتُخفى الأزرار العائمة ما دامت مفتوحة */
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("wq-guide-open", open && ready);
    return () => { document.body.classList.remove("wq-guide-open"); };
  }, [open, ready]);

  const go = (n: number) => { const c = Math.max(0, Math.min(STEPS.length - 1, n)); setStep(c); save(c); };
  const finish = () => { setOpen(false); save("done"); };
  const act = (a: Step["action"]) => {
    if (!a) return;
    if (a.event === "next") return go(step + 1);
    if (a.event) { onEvent(a.event); if (step < STEPS.length - 1) go(step + 1); }
  };

  if (!ready) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="fixed z-40 start-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:bottom-24 bg-gold text-white rounded-full shadow-lg px-3.5 py-2 text-xs font-semibold">
        🧭 دليل التجربة {step + 1}/{STEPS.length}
      </button>
    );
  }

  return (
    <div className="fixed z-[45] inset-x-2 sm:inset-x-auto sm:start-4 sm:w-[360px] bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-24 bg-white border-2 border-gold rounded-2xl shadow-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-gold">🧭 دليل التجربة · {step + 1} من {STEPS.length}</span>
        <div className="flex gap-1">
          <button className="text-muted text-xs px-2" onClick={() => setOpen(false)} title="طيّ">▁</button>
          <button className="text-muted text-xs px-2" onClick={finish} title="إنهاء الدليل">✕</button>
        </div>
      </div>
      <div className="h-1 bg-paper rounded-full mb-3 overflow-hidden">
        <div className="h-full bg-gold transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <h4 className="font-display font-bold text-deep mb-1">{s.title}</h4>
      <p className="text-sm text-ink leading-relaxed mb-3">{s.body}</p>
      <div className="flex gap-2">
        {s.action?.href ? (
          <Link href={s.action.href} onClick={() => go(step + 1)} className="btn btn-gold flex-1 justify-center text-sm">{s.action.label}</Link>
        ) : (
          <button className="btn btn-gold flex-1 justify-center text-sm" onClick={() => act(s.action)}>{s.action?.label || "التالي"}</button>
        )}
        {step > 0 && <button className="btn btn-ghost text-sm" onClick={() => go(step - 1)}>السابق</button>}
      </div>
      {last && (
        <div className="mt-2 text-center">
          <a className="text-[11px] text-muted underline" href="https://wa.me/966596300591?text=%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85%20%D8%B9%D9%84%D9%8A%D9%83%D9%85%D8%8C%20%D8%A3%D8%A8%D8%BA%D9%89%20%D8%A3%D8%AC%D9%87%D9%91%D8%B2%20%D8%AD%D8%B3%D8%A7%D8%A8%D9%8A%20%D9%81%D9%8A%20%D9%88%D8%AB%D9%8A%D9%82%20%D9%88%D8%B9%D9%86%D8%AF%D9%8A%20%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%20%D8%B9%D9%82%D8%A7%D8%B1%D8%A7%D8%AA%D9%8A" target="_blank" rel="noreferrer">
            أو أرسل بياناتك على واتساب ونجهّزها لك مجانًا
          </a>
        </div>
      )}
    </div>
  );
}
