"use client";
// ============================================================
// وثيق — حذف الحساب نهائيًّا (منطقة الخطر)
//
// حقٌّ لصاحب البيانات لا ميزة: نظام حماية البيانات الشخصية يقرّ حق المحو،
// ومتاجر التطبيقات تشترط إتاحته داخل التطبيق. ولأنه لا رجعة فيه، الواجهة
// تصرّ على خطوتين: تصدير البيانات أولًا (زر يذكّر بمكانه)، ثم كتابة كلمة
// «حذف» يدويًّا — لا زر واحد يُضغط بالخطأ.
// ============================================================

import { useState } from "react";
import { createClient } from "@/lib/supabase-client";

export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: word.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error || "تعذّر الحذف"); setBusy(false); return; }
      // إنهاء الجلسة محليًّا ثم الخروج — الحساب لم يعد موجودًا أصلًا
      try { await createClient().auth.signOut(); } catch { /* الجلسة ماتت مع الحساب */ }
      window.location.assign("/?deleted=1");
    } catch (e: any) {
      setErr(e?.message || "تعذّر الاتصال"); setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-[#F0C9C4] rounded-2xl p-5">
      <h3 className="font-display font-bold text-late text-lg mb-1">⚠️ حذف الحساب نهائيًّا</h3>
      <p className="text-xs text-muted mb-4 leading-relaxed">
        يُحذف حسابك وكل بياناته: العقارات والوحدات والعقود والدفعات والمصروفات والمستندات والصور.
        العملية <b>لا رجعة فيها</b> ولا نحتفظ بنسخة.
        <br />
        قبل الحذف، نزّل نسختك الكاملة من قسم <b>«📦 تصدير بياناتي»</b> أعلاه — تفتحها بـExcel وتعمل عليها،
        ولو رجعت يومًا ترفعها كما هي.
      </p>

      {!open ? (
        <button className="btn btn-ghost text-sm text-late border-[#F0C9C4]" onClick={() => setOpen(true)}>
          أريد حذف حسابي
        </button>
      ) : (
        <div className="bg-[#FBE9E7] border border-[#F5C6C2] rounded-xl p-4">
          <p className="text-sm text-[#a5322c] mb-3">
            للتأكيد، اكتب كلمة <b>حذف</b> في الخانة ثم اضغط الزر. لن نسألك مرة أخرى.
          </p>
          <input className="fld mb-3" value={word} onChange={(e) => setWord(e.target.value)} placeholder="اكتب: حذف" />
          {err && <p className="text-sm text-late mb-3">{err}</p>}
          <div className="flex gap-2">
            <button className="btn text-sm bg-late text-white border-late disabled:opacity-40"
              onClick={run} disabled={busy || word.trim() !== "حذف"}>
              {busy ? "جارٍ الحذف…" : "احذف حسابي نهائيًّا"}
            </button>
            <button className="btn btn-ghost text-sm" onClick={() => { setOpen(false); setWord(""); setErr(null); }}>
              تراجع
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
