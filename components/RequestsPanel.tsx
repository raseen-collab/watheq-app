"use client";
/**
 * 🔎 طلبات الباحثين — ذاكرة المكتب: «منو كان يدور أرض في النرجس؟»
 * كل طلب يعرض فورًا كم معروضًا مفتوحًا يطابقه (مطابقة حتمية قابلة
 * للتفسير: نوع + عرض + ميزانية + مساحة + تقاطع أحياء) مع زر واتساب
 * جاهز بنص يذكر أكواد المعروضات المطابقة.
 */
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, waLink } from "@/lib/utils";
import { KIND_META, OFFER_LABEL, pricePerMeter, shortDesc, type Listing, type ListingKind, type OfferType } from "@/lib/listings";
import { matchesForRequest, requestDesc, isActiveRequest, type SeekerRequest } from "@/lib/requests";

export default function RequestsPanel({ initial, listings }: { initial: SeekerRequest[]; listings: Listing[] }) {
  const supabase = createClient();
  const [items, setItems] = useState<SeekerRequest[]>(initial || []);
  const [showClosed, setShowClosed] = useState(false);
  const [form, setForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);

  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 3500); }
  function friendly(e: any) {
    const t = String(e?.message || e);
    return /seeker_requests/.test(t) && /(not exist|relation|schema cache)/i.test(t)
      ? "شغّل ملف schema-v8.sql في Supabase أولًا ثم أعد المحاولة" : t;
  }

  const shown = useMemo(
    () => items.filter((r) => (showClosed ? true : isActiveRequest(r))),
    [items, showClosed],
  );
  const activeCount = items.filter(isActiveRequest).length;

  async function save(d: Partial<SeekerRequest>) {
    setBusy(true);
    try {
      const uid = await officeId(supabase);
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const { data, error } = await supabase.from("seeker_requests")
        .insert({ ...d, user_id: uid }).select("*").single();
      if (error) throw error;
      setItems([data as SeekerRequest, ...items]);
      setForm(false);
      flash("ok", "سُجّل الطلب");
    } catch (e) { flash("err", friendly(e)); } finally { setBusy(false); }
  }

  async function setStatus(r: SeekerRequest, status: "active" | "closed") {
    const { error } = await supabase.from("seeker_requests").update({ status }).eq("id", r.id);
    if (error) return flash("err", friendly(error));
    setItems(items.map((x) => (x.id === r.id ? { ...x, status } : x)));
  }

  async function remove(r: SeekerRequest) {
    if (!confirm(`حذف طلب «${r.seeker_name || "بلا اسم"}» نهائيًّا؟ الأفضل عادةً «✓ أُنجز» ليبقى في السجل.`)) return;
    const { error } = await supabase.from("seeker_requests").delete().eq("id", r.id);
    if (error) return flash("err", friendly(error));
    setItems(items.filter((x) => x.id !== r.id));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted">
          سجّل ما يبحث عنه كل عميل وقت المكالمة — وحين يدخل معروض جديد يطابقه سيظهر هنا فورًا.
        </p>
        <div className="flex gap-2">
          <button className="btn btn-ghost text-xs" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "إخفاء المنجزة" : "إظهار المنجزة"}
          </button>
          <button className="btn btn-gold text-sm" onClick={() => setForm(true)}>+ طلب</button>
        </div>
      </div>

      {msg && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
          msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>
          {msg.m}
        </div>
      )}

      {form && <RequestForm busy={busy} onCancel={() => setForm(false)} onSave={save} />}

      {!shown.length ? (
        <div className="mt-4 rounded-xl border border-line bg-paper p-6 text-center text-sm text-muted">
          {activeCount ? "لا طلبات بهذا الفرز." : "لا طلبات بعد — أول مكالمة «أبغى شقة في…» سجّلها هنا بدل ورقة تضيع."}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {shown.map((r) => {
            const meta = KIND_META[r.kind] || KIND_META.other;
            const hits = matchesForRequest(r, listings);
            const active = isActiveRequest(r);
            const expanded = openId === r.id;
            return (
              <div key={r.id} className={`rounded-xl border border-line p-3 ${active ? "bg-white" : "bg-[#F8FAFC] opacity-80"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.seeker_name || "طلب بلا اسم"}</span>
                      {!active && <span className="text-[.68rem] font-bold rounded-lg px-2 py-0.5 bg-[#F1F5F9] text-[#475569]">أُنجز</span>}
                      {active && (
                        <button onClick={() => setOpenId(expanded ? null : r.id)}
                          className={`text-[.68rem] font-bold rounded-lg px-2 py-0.5 transition ${
                            hits.length ? "bg-[#E6F4EC] text-[#137a50] hover:bg-[#d6ecdf]" : "bg-[#F1F5F9] text-[#475569]"}`}>
                          {hits.length ? `✨ يطابق ${hits.length} ${hits.length === 1 ? "معروضًا" : "معروضات"}` : "لا مطابقة بعد"}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {requestDesc(r, meta.label, OFFER_LABEL[r.offer_type])}{r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:justify-end shrink-0">
                    {r.seeker_phone && active && (
                      <a className="btn btn-ghost text-xs" target="_blank" rel="noreferrer"
                        href={waLink(r.seeker_phone,
                          hits.length
                            ? `السلام عليكم ${r.seeker_name || ""}، عندنا ${hits.length === 1 ? "معروض يناسب طلبك" : "معروضات تناسب طلبك"}: ${hits.slice(0, 3).map((l) => `${l.code} (${shortDesc(l)}${Number(l.price) > 0 ? ` — ${sar(Number(l.price))} ريال` : ""})`).join(" · ")} — نرتب لك معاينة؟`
                            : `السلام عليكم ${r.seeker_name || ""}، طلبك عندنا مسجّل وسنوافيك فور توفر ما يناسبه.`)}>
                        واتساب
                      </a>
                    )}
                    {active
                      ? <button className="btn btn-ghost text-xs" onClick={() => setStatus(r, "closed")} title="اشترى/استأجر أو انسحب — يخرج من المطابقة">✓ أُنجز</button>
                      : <button className="btn btn-ghost text-xs" onClick={() => setStatus(r, "active")}>إعادة فتح</button>}
                    <button className="btn btn-ghost text-xs text-late" onClick={() => remove(r)}>حذف</button>
                  </div>
                </div>

                {expanded && hits.length > 0 && (
                  <div className="mt-2 border-t border-line pt-2 flex flex-col gap-1.5">
                    {hits.map((l) => (
                      <div key={l.id} className="flex items-center gap-2 text-xs bg-paper border border-line rounded-lg px-2.5 py-1.5">
                        <span className="font-mono font-bold">{l.code}</span>
                        <span className="text-muted min-w-0 flex-1 truncate">{shortDesc(l)}</span>
                        {Number(l.price) > 0 && (
                          <span className="shrink-0"><b>{sar(Number(l.price))}</b>{pricePerMeter(l) ? <span className="text-muted"> · {sar(pricePerMeter(l)!)}/م</span> : null}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RequestForm({ busy, onSave, onCancel }: {
  busy: boolean; onSave: (d: Partial<SeekerRequest>) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<any>({
    kind: "apartment" as ListingKind, offer_type: "rent" as OfferType,
    seeker_name: "", seeker_phone: "", districts: "", city: "",
    price_max: "", area_min: "", area_max: "", note: "",
  });
  const num = (v: any) => (v === "" || v == null ? null : Number(v));
  const txt = (v: any) => (String(v || "").trim() || null);
  const ready = String(d.seeker_name || "").trim().length > 0 || String(d.seeker_phone || "").trim().length > 0;

  return (
    <div className="mt-4 border border-line rounded-xl p-4 bg-paper space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">اسم الباحث</span>
          <input className="fld" value={d.seeker_name} onChange={(e) => setD({ ...d, seeker_name: e.target.value })} placeholder="أبو خالد" /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">جواله</span>
          <input className="fld" type="tel" value={d.seeker_phone} onChange={(e) => setD({ ...d, seeker_phone: e.target.value })} placeholder="05xxxxxxxx" /></label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="block text-sm font-semibold mb-1">يبحث عن</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(KIND_META) as ListingKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setD({ ...d, kind: k })}
                className={`border-2 rounded-lg py-1.5 text-[.68rem] font-semibold transition ${
                  d.kind === k ? "border-gold bg-[#FBF1DF]" : "border-line bg-white hover:border-goldSoft"}`}>
                {KIND_META[k].icon} {KIND_META[k].label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="block text-sm font-semibold mb-1">العرض</span>
          <div className="grid grid-cols-2 gap-2">
            {(["sale", "rent"] as OfferType[]).map((k) => (
              <button key={k} type="button" onClick={() => setD({ ...d, offer_type: k })}
                className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                  d.offer_type === k ? "border-gold bg-[#FBF1DF]" : "border-line bg-white hover:border-goldSoft"}`}>
                {OFFER_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">الأحياء <span className="text-muted text-xs font-normal">— افصل بفاصلة، فارغ = أي حي</span></span>
          <input className="fld" value={d.districts} onChange={(e) => setD({ ...d, districts: e.target.value })} placeholder="النرجس، الياسمين" /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">المدينة <span className="text-muted text-xs font-normal">— اختياري</span></span>
          <input className="fld" value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} /></label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">أقصى ميزانية <span className="text-muted text-xs font-normal">— ريال</span></span>
          <input className="fld" type="number" value={d.price_max} onChange={(e) => setD({ ...d, price_max: e.target.value })} placeholder="45000" /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">مساحة من <span className="text-muted text-xs font-normal">— م²</span></span>
          <input className="fld" type="number" value={d.area_min} onChange={(e) => setD({ ...d, area_min: e.target.value })} /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">إلى <span className="text-muted text-xs font-normal">— م²</span></span>
          <input className="fld" type="number" value={d.area_max} onChange={(e) => setD({ ...d, area_max: e.target.value })} /></label>
      </div>

      <label className="block"><span className="block text-sm font-semibold mb-1">ملاحظة <span className="text-muted text-xs font-normal">— اختياري</span></span>
        <input className="fld" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="يفضّل دور أرضي، جاهز للدفع كاش" /></label>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[.7rem] text-muted">يكفي الاسم أو الجوال — الحقول الفارغة تعني «لا يهم» في المطابقة.</span>
        <div className="flex gap-2">
          <button className="btn btn-ghost text-sm" onClick={onCancel} disabled={busy}>إلغاء</button>
          <button className="btn btn-gold text-sm" disabled={!ready || busy}
            onClick={() => onSave({
              kind: d.kind, offer_type: d.offer_type,
              seeker_name: txt(d.seeker_name), seeker_phone: txt(d.seeker_phone),
              districts: txt(d.districts), city: txt(d.city),
              price_max: num(d.price_max), area_min: num(d.area_min), area_max: num(d.area_max),
              note: txt(d.note),
            })}>
            {busy ? "…" : "تسجيل الطلب"}
          </button>
        </div>
      </div>
    </div>
  );
}
