"use client";

import { useEffect, useRef, useState } from "react";
import { saveInvoiceSignature } from "@/app/admin/subs/actions";

/**
 * توقيعك على فواتير الاشتراك: ارسمه مرة (إصبع أو فأرة) أو ارفع صورته،
 * ويُطبع تلقائيًّا في خانة «التوقيع» بكل فاتورة تصدرها من هذه الصفحة.
 */
export default function SignaturePanel({ initial }: { initial: string | null }) {
  const [sig, setSig] = useState<string | null>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const cv = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!open || !cv.current) return;
    const c = cv.current, ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0E2F5A";
    setDirty(false);
  }, [open]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return; const ctx = e.currentTarget.getContext("2d")!; const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke(); setDirty(true);
  };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = cv.current; if (!c) return; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setDirty(false); };

  /** يقصّ الفراغ حول التوقيع فيُطبع بحجم مناسب */
  function trimmed(c: HTMLCanvasElement): string {
    const ctx = c.getContext("2d")!; const { width: w, height: h } = c;
    const d = ctx.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return c.toDataURL("image/png");
    const pad = 8, sw = x1 - x0 + 1 + pad * 2, sh = y1 - y0 + 1 + pad * 2;
    const o = document.createElement("canvas"); o.width = sw; o.height = sh;
    o.getContext("2d")!.drawImage(c, x0 - pad, y0 - pad, sw, sh, 0, 0, sw, sh);
    return o.toDataURL("image/png");
  }

  async function save(v: string | null) {
    setBusy(true); setMsg(null);
    const res = await saveInvoiceSignature(v);
    setBusy(false);
    if (!res.ok) { setMsg(res.error); return; }
    setSig(v); setOpen(false); setMsg(v ? "✓ حُفظ التوقيع — يظهر في كل فاتورة تطبعها من الآن" : "حُذف التوقيع");
  }

  function upload(f?: File | null) {
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { setMsg("ارفع صورة PNG أو JPG"); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        // تصغير إلى عرض 600 كحد أقصى — يكفي للطباعة ويُبقي الحجم صغيرًا
        const k = Math.min(1, 600 / img.width); const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        save(c.toDataURL(f.type === "image/png" ? "image/png" : "image/jpeg", 0.9));
      };
      img.src = String(rd.result);
    };
    rd.readAsDataURL(f);
  }

  return (
    <section className="bg-white border border-line rounded-2xl p-4 mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-deep">✍️ توقيعك على الفواتير</h2>
          <div className="text-xs text-muted">يُطبع تلقائيًّا في خانة «التوقيع» بكل فاتورة اشتراك تصدرها — بدل التوقيع اليدوي.</div>
        </div>
        {sig && <img src={sig} alt="التوقيع الحالي" className="h-12 max-w-[180px] object-contain border border-line rounded-lg bg-white px-2" />}
        <button onClick={() => { setOpen(!open); setMsg(null); }} className="btn btn-ghost text-xs">{open ? "إلغاء" : sig ? "غيّر التوقيع" : "أضف توقيعك"}</button>
        {sig && !open && <button disabled={busy} onClick={() => save(null)} className="btn btn-ghost text-xs text-late">احذفه</button>}
      </div>
      {open && (
        <div className="mt-3">
          <div className="text-xs text-muted mb-1.5">ارسم توقيعك بإصبعك أو بالفأرة داخل المربع:</div>
          <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            className="w-full max-w-[520px] h-[170px] border-2 border-dashed border-line rounded-xl bg-white touch-none cursor-crosshair" />
          <div className="flex flex-wrap gap-2 mt-2">
            <button disabled={busy || !dirty} onClick={() => cv.current && save(trimmed(cv.current))} className="btn btn-primary text-xs disabled:opacity-50">{busy ? "…" : "احفظ التوقيع"}</button>
            <button disabled={busy} onClick={clear} className="btn btn-ghost text-xs">امسح</button>
            <label className="btn btn-ghost text-xs cursor-pointer">أو ارفع صورة توقيعك
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          </div>
        </div>
      )}
      {msg && <div className="text-xs mt-2 text-deep">{msg}</div>}
    </section>
  );
}
