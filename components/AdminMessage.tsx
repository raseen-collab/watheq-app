"use client";
// زر «رسالة جاهزة»: يعرض النص ويفتحه في واتساب مكتوبًا — لا نسخ ولا صياغة
import { useState } from "react";
import { buildMessage, waSend, type MsgKind, type MsgCtx } from "@/lib/admin-messages";

export default function AdminMessage({ kind, ctx, phone }: { kind: MsgKind; ctx: MsgCtx; phone: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { text } = buildMessage(kind, ctx);

  return (
    <>
      <div className="flex gap-1.5 shrink-0">
        <button type="button" onClick={() => setOpen(true)}
          className="text-[11px] bg-white/15 hover:bg-white/25 rounded-md px-2 py-1">✍️ رسالة</button>
        {phone && <a href={waSend(phone, text)} target="_blank" rel="noreferrer"
          className="text-[11px] bg-[#25D366] text-white rounded-md px-2 py-1">واتساب</a>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white text-deep rounded-2xl border border-line max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold mb-3">رسالة جاهزة — {ctx.name}</h3>
            <textarea className="fld h-64 leading-relaxed" defaultValue={text} id={`m-${kind}-${ctx.name}`} />
            <div className="flex gap-2 mt-3">
              {phone && <a className="btn btn-gold text-sm flex-1 justify-center"
                href={waSend(phone, (typeof document !== "undefined" && (document.getElementById(`m-${kind}-${ctx.name}`) as HTMLTextAreaElement)?.value) || text)}
                target="_blank" rel="noreferrer">إرسال في واتساب</a>}
              <button className="btn btn-ghost text-sm" onClick={async () => {
                const v = (document.getElementById(`m-${kind}-${ctx.name}`) as HTMLTextAreaElement)?.value || text;
                try { await navigator.clipboard.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* */ }
              }}>{copied ? "✓ نُسخ" : "نسخ"}</button>
              <button className="btn btn-ghost text-sm" onClick={() => setOpen(false)}>إغلاق</button>
            </div>
            <p className="text-[11px] text-muted mt-2">عدّل النص كما تشاء قبل الإرسال — يُرسل ما تراه.</p>
          </div>
        </div>
      )}
    </>
  );
}
