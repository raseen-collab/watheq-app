"use client";
/**
 * 🔎 طلبات الباحثين — ذاكرة المكتب: «منو كان يدور أرض في النرجس؟»
 * كل طلب يعرض فورًا كم معروضًا مفتوحًا يطابقه (مطابقة حتمية قابلة
 * للتفسير: نوع + عرض + ميزانية + مساحة + تقاطع أحياء) مع زر واتساب
 * جاهز بنص يذكر أكواد المعروضات المطابقة.
 */
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, waLink } from "@/lib/utils";
import { KIND_META, OFFER_LABEL, pricePerMeter, shortDesc, type Listing, type ListingKind, type OfferType } from "@/lib/listings";
import { matchesForRequest, requestDesc, isActiveRequest, type SeekerRequest } from "@/lib/requests";

const KIND_ICON = { land: "land", apartment: "apartment", villa: "villa", building: "building", shop: "shop", other: "box" } as const;

export default function RequestsPanel({ initial, listings, prefill, onPrefillUsed }: {
  initial: SeekerRequest[]; listings: Listing[];
  /** بحث زبون من تبويب المعروضات ← نموذج طلب معبّأ (29 أكتوبر 2026) */
  prefill?: Partial<SeekerRequest> | null; onPrefillUsed?: () => void;
}) {
  const supabase = createClient();
  const [items, setItems] = useState<SeekerRequest[]>(initial || []);
  const [showClosed, setShowClosed] = useState(false);
  const [form, setForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);

  const [seed, setSeed] = useState<Partial<SeekerRequest> | null>(null);
  useEffect(() => { if (prefill) { setSeed(prefill); setForm(true); onPrefillUsed?.(); } }, [prefill, onPrefillUsed]);

  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 3500); }
  function friendly(e: any) {
    const t = String(e?.message || e);
    if (/rooms_min/.test(t)) return "حقل «الغرف» يحتاج تشغيل ملف schema-v77-request-rooms.sql في Supabase مرة واحدة — أو احذف الغرف من الطلب واحفظ.";
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
      setForm(false); setSeed(null);
      flash("ok", "سُجّل الطلب — وحين يدخل معروض يناسبه يظهر هنا وفي ملخّصك اليومي");
    } catch (e) { flash("err", friendly(e)); } finally { setBusy(false); }
  }

  async function setStatus(r: SeekerRequest, status: "active" | "closed") {
    const { error } = await supabase.from("seeker_requests").update({ status }).eq("id", r.id);
    if (error) return flash("err", friendly(error));
    setItems(items.map((x) => (x.id === r.id ? { ...x, status } : x)));
  }

  async function remove(r: SeekerRequest) {
    if (!confirm(`حذف طلب «${r.seeker_name || "بلا اسم"}» نهائيًّا؟ الأفضل عادةً «✓ أُنجز» ليبقى في السجل.`)) return;
    const { data: _del, error } = await supabase.from("seeker_requests").delete().eq("id", r.id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { flash("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
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
          <button className="btn btn-gold text-sm" onClick={() => { setSeed(null); setForm(true); }}><Icon name="plus" /> طلب</button>
        </div>
      </div>

      {msg && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
          msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>
          {msg.m}
        </div>
      )}

      {form && <RequestForm key={seed ? JSON.stringify(seed) : "new"} seed={seed} busy={busy} onCancel={() => { setForm(false); setSeed(null); }} onSave={save} />}

      {!shown.length ? (
        <div className="mt-4 rounded-2xl border border-dashed border-line bg-paper p-8 text-center text-sm text-muted">
          <span className="inline-grid place-items-center w-12 h-12 rounded-full bg-white border border-line text-gold mb-2"><Icon name="search" size={22} /></span>
          <p>{activeCount ? "لا طلبات بهذا الفرز." : "لا طلبات بعد — أول مكالمة «أبغى شقة في…» سجّلها هنا بدل ورقة تضيع."}</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {shown.map((r) => {
            const meta = KIND_META[r.kind] || KIND_META.other;
            const hits = matchesForRequest(r, listings);
            const active = isActiveRequest(r);
            const expanded = openId === r.id;
            return (
              <div key={r.id} className={`rounded-2xl border border-line p-3 ${active ? "bg-white" : "bg-[#F8FAFC] opacity-80"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="min-w-0 flex-1 flex items-start gap-2.5">
                    <span className="grid place-items-center w-10 h-10 rounded-xl bg-paper2 text-gold shrink-0"><Icon name={KIND_ICON[r.kind] || "box"} size={19} /></span>
                    <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-deep">{r.seeker_name || "طلب بلا اسم"}</span>
                      {!active && <span className="text-[.68rem] font-bold rounded-lg px-2 py-0.5 bg-[#F1F5F9] text-[#475569]">أُنجز</span>}
                      {active && (
                        <button onClick={() => setOpenId(expanded ? null : r.id)}
                          className={`text-[.68rem] font-bold rounded-lg px-2 py-0.5 transition ${
                            hits.length ? "bg-[#E6F4EC] text-[#137a50] hover:bg-[#d6ecdf]" : "bg-[#F1F5F9] text-[#475569]"}`}>
                          {hits.length ? <span className="inline-flex items-center gap-1"><Icon name="sparkle" size={12} /> يطابق {hits.length} {hits.length === 1 ? "معروضًا" : "معروضات"}</span> : "لا مطابقة بعد"}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {requestDesc(r, meta.label, OFFER_LABEL[r.offer_type])}{r.note ? ` · ${r.note}` : ""}
                    </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:justify-end shrink-0">
                    {r.seeker_phone && active && (
                      <a className="btn btn-wa text-xs" target="_blank" rel="noreferrer"
                        href={waLink(r.seeker_phone,
                          hits.length
                            ? `السلام عليكم ${r.seeker_name || ""}، عندنا ${hits.length === 1 ? "معروض يناسب طلبك" : "معروضات تناسب طلبك"}: ${hits.slice(0, 3).map((l) => `${l.code} (${shortDesc(l)}${Number(l.price) > 0 ? ` — ${sar(Number(l.price))} ريال` : ""})`).join(" · ")} — نرتب لك معاينة؟`
                            : `السلام عليكم ${r.seeker_name || ""}، طلبك عندنا مسجّل وسنوافيك فور توفر ما يناسبه.`)}>
                        <Icon name="whatsapp" size={14} /> واتساب
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

function RequestForm({ busy, onSave, onCancel, seed }: {
  busy: boolean; onSave: (d: Partial<SeekerRequest>) => void; onCancel: () => void;
  seed?: Partial<SeekerRequest> | null;
}) {
  const [d, setD] = useState<any>({
    kind: (seed?.kind || "apartment") as ListingKind, offer_type: (seed?.offer_type || "rent") as OfferType,
    seeker_name: "", seeker_phone: "", districts: seed?.districts || "", city: "",
    price_max: seed?.price_max ? String(seed.price_max) : "", area_min: "", area_max: "",
    rooms_min: seed?.rooms_min ? Number(seed.rooms_min) : 0, note: "",
  });
  const land = !!KIND_META[d.kind as ListingKind]?.land;
  const num = (v: any) => (v === "" || v == null ? null : Number(v));
  const txt = (v: any) => (String(v || "").trim() || null);
  const ready = String(d.seeker_name || "").trim().length > 0 || String(d.seeker_phone || "").trim().length > 0;

  return (
    <div className="mt-4 border border-line rounded-2xl p-4 bg-paper space-y-3">
      {seed && (
        <div className="rounded-lg bg-[#E6F4EC] border border-[#B7DFC7] text-[#137a50] text-[12.5px] px-3 py-2 inline-flex items-center gap-1.5">
          <Icon name="sparkle" size={14} /> عبّأنا الطلب من بحثك — أضف اسم الزبون وجواله واحفظ.
        </div>
      )}
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
              <button key={k} type="button" onClick={() => setD({ ...d, kind: k, ...(KIND_META[k].land ? { rooms_min: 0 } : {}) })}
                className={`border-2 rounded-lg min-h-[40px] text-[.72rem] font-semibold transition inline-flex items-center justify-center gap-1 ${
                  d.kind === k ? "border-gold bg-[#FBF1DF]" : "border-line bg-white hover:border-goldSoft"}`}>
                <Icon name={KIND_ICON[k]} size={14} /> {KIND_META[k].label}
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

      {!land && (
        <div>
          <span className="block text-sm font-semibold mb-1">أقل عدد غرف <span className="text-muted text-xs font-normal">— «أي عدد» = لا يهم</span></span>
          <div className="flex gap-1.5 flex-wrap">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setD({ ...d, rooms_min: n })} aria-pressed={d.rooms_min === n}
                className={`rounded-full border px-3 min-h-[36px] text-xs font-semibold transition ${d.rooms_min === n ? "border-gold bg-[#FBF1DF] text-deep" : "border-line bg-white text-muted"}`}>
                {n ? <bdi dir="ltr">{n}+</bdi> : "أي عدد"}
              </button>
            ))}
          </div>
        </div>
      )}

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
              /* يُرسل فقط إن حُدِّد: من لم يشغّل v77 بعد يبقى يحفظ طلباته كما كان */
              ...(!land && Number(d.rooms_min) > 0 ? { rooms_min: Number(d.rooms_min) } : {}),
              note: txt(d.note),
            })}>
            {busy ? "…" : "تسجيل الطلب"}
          </button>
        </div>
      </div>
    </div>
  );
}
