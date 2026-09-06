"use client";
/**
 * 📋 سجل المعروضات — الأراضي والشقق المعروضة للبيع أو الإيجار.
 *
 * غرضه الترتيب الداخلي لا التسويق: كود موحّد لكل معروض يُسمّى به كل شيء
 * (الصور، الصك، الإعلان، محادثة واتساب)، وحالة صريحة، وزر واحد
 * «✓ أكّدت التوفر» لأن المعروضات تتعفّن ولا تضيع.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, today, waLink } from "@/lib/utils";
import { openDoc, listingsRegisterHTML, arDate } from "@/lib/documents";
import {
  KIND_META, OFFER_LABEL, STATUS_META, freshness, pricePerMeter, shortDesc,
  sortListings, summarize, nextCode, isOpen, STALE_DAYS,
  type Listing, type ListingKind, type OfferType, type ListingStatus,
} from "@/lib/listings";
import { complianceState, type ComplianceItem } from "@/lib/compliance";
import { matchesForListing, type SeekerRequest } from "@/lib/requests";
import RequestsPanel from "@/components/RequestsPanel";
import ListingPhotos from "@/components/ListingPhotos";
import AdComposer from "@/components/AdComposer";
import DateField from "@/components/DateField";

const TONE_CLS: Record<string, string> = {
  ok:    "bg-[#E6F4EC] text-[#137a50]",
  warn:  "bg-[#FBF1DF] text-[#8a5a11]",
  bad:   "bg-[#FBE9E7] text-[#a5322c]",
  muted: "bg-[#F1F5F9] text-[#475569]",
};

type Filter = "open" | "all" | "stale" | ListingStatus;

export default function ListingsView({ initial, brokerages, requests, orgName, issuer }: {
  initial: Listing[];
  brokerages: ComplianceItem[];
  requests: SeekerRequest[];
  orgName: string;
  issuer?: any;
}) {
  // تبويبان: المعروضات (ما عندك) والطلبات (ما يبحث عنه الناس) — والمطابقة تربطهما
  const [tab, setTab] = useState<"listings" | "requests">("listings");
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<Listing[]>(initial || []);
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<null | { editing?: Listing }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);

  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 3500); }

  const s = useMemo(() => summarize(items), [items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sortListings(items).filter((l) => {
      if (filter === "open" && !isOpen(l)) return false;
      if (filter === "stale" && !freshness(l).stale) return false;
      if (["available", "reserved", "contracted", "withdrawn"].includes(filter) && (l.status || "available") !== filter) return false;
      if (!needle) return true;
      return [l.code, l.title, l.district, l.city, l.owner_name, l.owner_phone, l.deed_no, l.plan_no, l.parcel_no, l.unit_no]
        .filter(Boolean).some((x) => String(x).toLowerCase().includes(needle));
    });
  }, [items, filter, q]);

  function handleErr(e: any) {
    const t = String(e?.message || e);
    if (/listings/.test(t) && /(not exist|relation|schema cache)/i.test(t))
      return flash("err", "شغّل ملف schema-v7.sql في Supabase أولًا ثم أعد المحاولة");
    if (/listings_code_per_user|duplicate key/i.test(t))
      return flash("err", "هذا الكود مستخدم من قبل — غيّره");
    flash("err", t);
  }

  async function save(payload: Partial<Listing>, editing?: Listing) {
    setBusy("save");
    try {
      if (editing) {
        const { data, error } = await supabase.from("listings").update(payload).eq("id", editing.id).select("*").single();
        if (error) throw error;
        setItems(items.map((x) => (x.id === editing.id ? (data as Listing) : x)));
        flash("ok", "تم حفظ التعديل");
      } else {
        const uid = await officeId(supabase);
        if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
        const { data, error } = await supabase.from("listings").insert({ ...payload, user_id: uid }).select("*").single();
        if (error) throw error;
        setItems([data as Listing, ...items]);
        flash("ok", `أُضيف المعروض ${(data as Listing).code}`);
      }
      setForm(null);
    } catch (e) { handleErr(e); } finally { setBusy(null); }
  }

  /** الزر الأهم في الشاشة: تأكيد أن المعروض ما زال متاحًا بنفس السعر */
  async function confirmAvailable(l: Listing) {
    setBusy(l.id);
    const d = today();
    const { error } = await supabase.from("listings").update({ last_confirmed_at: d }).eq("id", l.id);
    setBusy(null);
    if (error) return handleErr(error);
    setItems(items.map((x) => (x.id === l.id ? { ...x, last_confirmed_at: d } : x)));
  }

  async function setStatus(l: Listing, status: ListingStatus) {
    setBusy(l.id);
    const { error } = await supabase.from("listings").update({ status }).eq("id", l.id);
    setBusy(null);
    if (error) return handleErr(error);
    setItems(items.map((x) => (x.id === l.id ? { ...x, status } : x)));
  }

  async function remove(l: Listing) {
    if (!confirm(`حذف ${l.code} نهائيًّا؟ الأفضل عادةً تغيير حالته إلى «مسحوب» ليبقى في السجل.`)) return;
    const { data: _del, error } = await supabase.from("listings").delete().eq("id", l.id).select("id");
    /* حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم الموظف أنه نجح */
    if (!error && (!_del || _del.length === 0)) { flash("err", "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب."); return; }
    if (error) return handleErr(error);
    setItems(items.filter((x) => x.id !== l.id));
  }

  if (form) {
    return (
      <ListingForm editing={form.editing} all={items} brokerages={brokerages} busy={busy === "save"}
        onCancel={() => setForm(null)} onSave={(d) => save(d, form.editing)} />
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-deep text-2xl">📋 سجل المعروضات</h1>
          <p className="text-sm text-muted mt-1">
            كل أرض وشقة معروضة عندك بكود ثابت وحالة واضحة — سمِّ صور المعروض وصكه وإعلانه بالكود نفسه ولن تبحث عنها مجددًا.
          </p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <button className="btn btn-ghost text-sm" onClick={() => openDoc(listingsRegisterHTML(items, orgName, issuer || {}))}>
              🖨️ طباعة السجل
            </button>
          )}
          <button className="btn btn-gold text-sm" onClick={() => setForm({})}>+ معروض</button>
        </div>
      </div>

      {/* تبويبا السجل: معروضاتك ↔ طلبات الباحثين */}
      <div className="inline-flex bg-white border border-line rounded-xl p-1 mt-4">
        <button onClick={() => setTab("listings")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
            tab === "listings" ? "bg-[#FBF1DF] text-deep" : "text-muted hover:bg-paper"}`}>
          📋 المعروضات ({s.total})
        </button>
        <button onClick={() => setTab("requests")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
            tab === "requests" ? "bg-[#FBF1DF] text-deep" : "text-muted hover:bg-paper"}`}>
          🔎 الطلبات ({requests.filter((r) => String(r.status || "active") === "active").length})
        </button>
      </div>

      {msg && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
          msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>
          {msg.m}
        </div>
      )}

      {tab === "requests" ? (
        <div className="mt-4"><RequestsPanel initial={requests} listings={items} /></div>
      ) : (<>

      {/* الأرقام التي تهمّ فعلًا */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        <Stat v={s.total} l="إجمالي" />
        <Stat v={s.available} l="متاح" tone="ok" />
        <Stat v={s.reserved} l="محجوز بعربون" />
        <Stat v={s.stale} l="يحتاج تأكيد توفر" tone={s.stale ? "warn" : undefined} />
      </div>

      {s.stale > 0 && (
        <div className="mt-3 rounded-xl border border-[#EBD9AA] bg-[#FBF1DF] p-3 text-sm text-[#8a5a11]">
          <b>{s.stale}</b> من معروضاتك المفتوحة لم يُؤكَّد توفرها منذ {STALE_DAYS} يومًا أو أكثر.
          اتصل بالمالك، وإن كان ما زال متاحًا بنفس السعر اضغط <b>✓ أكّدت التوفر</b> — لئلا تعرض على عميل عقارًا بيع أو تغيّر سعره.
        </div>
      )}

      {/* فرز وبحث */}
      <div className="flex flex-wrap gap-2 mt-4 items-center">
        {([
          ["open", `المفتوحة (${s.open})`],
          ["stale", `يحتاج تأكيد (${s.stale})`],
          ["available", "متاح"],
          ["reserved", "محجوز"],
          ["contracted", "متعاقد"],
          ["withdrawn", "مسحوب"],
          ["all", `الكل (${s.total})`],
        ] as [Filter, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border transition ${
              filter === k ? "border-gold bg-[#FBF1DF] text-deep" : "border-line bg-white text-muted hover:border-goldSoft"}`}>
            {label}
          </button>
        ))}
        <input className="fld flex-1 min-w-[160px] text-sm" placeholder="ابحث بالكود، الحي، المالك، رقم الصك…"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!shown.length ? (
        <div className="mt-4 rounded-xl border border-line bg-paper p-6 text-center">
          <p className="text-sm text-muted">
            {items.length ? "لا نتائج بهذا الفرز." : "ابدأ بإضافة أول معروض — أرض أو شقة — وسيُعطى كودًا تلقائيًّا مثل أ-101."}
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {shown.map((l) => (
            <Row key={l.id} l={l} adOrg={orgName} adPhone={issuer?.billing_phone} brokerages={brokerages} requests={requests} busy={busy === l.id}
              onConfirm={() => confirmAvailable(l)} onEdit={() => setForm({ editing: l })}
              onStatus={(st) => setStatus(l, st)} onRemove={() => remove(l)} />
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}

function Stat({ v, l, tone }: { v: number; l: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3 text-center">
      <div className={`font-display font-bold text-xl ${tone === "ok" ? "text-[#137a50]" : tone === "warn" ? "text-[#8a5a11]" : "text-deep"}`}>{v}</div>
      <div className="text-[.7rem] text-muted mt-0.5">{l}</div>
    </div>
  );
}

/* ──────────────────────── سطر معروض واحد ──────────────────────── */

function Row({ l, brokerages, requests, busy, onConfirm, onEdit, onStatus, onRemove, adOrg, adPhone }: {
  l: Listing; brokerages: ComplianceItem[]; requests: SeekerRequest[]; busy: boolean;
  onConfirm: () => void; onEdit: () => void; onStatus: (s: ListingStatus) => void; onRemove: () => void;
  adOrg?: string | null; adPhone?: string | null;
}) {
  const [showPhotos, setShowPhotos] = useState(false);
  const [showAd, setShowAd] = useState(false);
  const [showMatches, setShowMatches] = useState(false);
  const hits = matchesForListing(l, requests);
  const meta = KIND_META[l.kind] || KIND_META.other;
  const st = STATUS_META[(l.status || "available") as ListingStatus] || STATUS_META.available;
  const fr = freshness(l);
  const ppm = pricePerMeter(l);
  const open = isOpen(l);

  // تحذير حقيقي: معروض مفتوح وعقد وساطته انتهى — العرض حينها بلا سند
  const bro = brokerages.find((b) => b.id === l.brokerage_id);
  const broState = bro ? complianceState(bro) : null;
  const broProblem = open && broState && (broState.phase === "expired" || broState.phase === "window");

  return (
    <div className={`rounded-xl border p-3 ${open ? "border-line bg-white" : "border-line bg-[#F8FAFC] opacity-80"}`}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-sm bg-paper border border-line rounded px-1.5 py-0.5">{l.code}</span>
            <span className="font-semibold text-sm">{meta.icon} {meta.label} {OFFER_LABEL[l.offer_type]}</span>
            <span className={`text-[.68rem] font-bold rounded-lg px-2 py-0.5 ${TONE_CLS[st.tone]}`}>{st.label}</span>
            {open && hits.length > 0 && (
              <button onClick={() => setShowMatches(!showMatches)}
                className="text-[.68rem] font-bold rounded-lg px-2 py-0.5 bg-[#E6F4EC] text-[#137a50] hover:bg-[#d6ecdf] transition">
                ✨ يطابق {hits.length} {hits.length === 1 ? "طلبًا" : "طلبات"}
              </button>
            )}
          </div>
          <div className="text-xs text-muted mt-1">{shortDesc(l)}</div>
          {l.title && <div className="text-xs text-[#33413d] mt-0.5">{l.title}</div>}

          <div className="text-xs mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {Number(l.price) > 0 && (
              <span><b>{sar(Number(l.price))}</b> ريال{l.offer_type === "rent" ? " سنويًّا" : ""}
                {ppm ? <span className="text-muted"> · {sar(ppm)} للمتر</span> : null}</span>
            )}
            {l.owner_name && (
              <span className="text-muted">المالك: {l.owner_name}
                {l.owner_phone && (
                  <a className="text-gold font-semibold mr-1.5"
                    href={waLink(l.owner_phone, `السلام عليكم، بخصوص ${meta.label} ${l.code}${l.district ? ` في ${l.district}` : ""} — هل ما زالت متاحة بنفس السعر؟`)}
                    target="_blank" rel="noreferrer">واتساب</a>
                )}
              </span>
            )}
            {l.source && <span className="text-muted">المصدر: {l.source === "owner" ? "مالك مباشر" : "وسيط آخر"}</span>}
          </div>

          {open && (
            <div className={`text-[.7rem] mt-1.5 font-semibold ${fr.tone === "warn" ? "text-[#8a5a11]" : "text-[#137a50]"}`}>
              {fr.label}{l.last_confirmed_at ? ` (${arDate(l.last_confirmed_at)})` : ""}
            </div>
          )}
          {broProblem && (
            <div className="text-[.7rem] mt-1 font-semibold text-[#a5322c]">
              ⚠️ عقد الوساطة «{bro!.title}» — {broState!.label}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 sm:justify-end shrink-0">
          {open && (
            <button className="btn btn-ghost text-xs" onClick={onConfirm} disabled={busy}
              title="سجّل أن المالك أكّد أن المعروض ما زال متاحًا بنفس السعر">
              {busy ? "…" : "✓ أكّدت التوفر"}
            </button>
          )}
          <select className="fld text-xs py-1 px-2 w-auto" value={l.status || "available"}
            onChange={(e) => onStatus(e.target.value as ListingStatus)} disabled={busy} aria-label="حالة المعروض">
            {(Object.keys(STATUS_META) as ListingStatus[]).map((k) => (
              <option key={k} value={k}>{STATUS_META[k].label}</option>
            ))}
          </select>
          <button className="btn btn-ghost text-xs" onClick={() => setShowAd(true)}
            title="نص إعلان جاهز لحراج وX وواتساب من بيانات هذا المعروض">📣 إعلان</button>
          <button className="btn btn-ghost text-xs" onClick={() => setShowPhotos(!showPhotos)}>📷 الصور</button>
          <button className="btn btn-ghost text-xs" onClick={onEdit}>تعديل</button>
          <button className="btn btn-ghost text-xs text-late" onClick={onRemove}>حذف</button>
        </div>
      </div>

      {showMatches && hits.length > 0 && (
        <div className="mt-2 border-t border-line pt-2 flex flex-col gap-1.5">
          {hits.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs bg-white border border-line rounded-lg px-2.5 py-1.5">
              <span className="font-semibold shrink-0">{r.seeker_name || "طلب بلا اسم"}</span>
              <span className="text-muted min-w-0 flex-1 truncate">{r.districts || "أي حي"}{Number(r.price_max) > 0 ? ` · حتى ${sar(Number(r.price_max))}` : ""}</span>
              {r.seeker_phone && (
                <a className="text-gold font-semibold shrink-0" target="_blank" rel="noreferrer"
                  href={waLink(r.seeker_phone, `السلام عليكم ${r.seeker_name || ""}، توفر عندنا ${meta.label} ${OFFER_LABEL[l.offer_type]} يناسب طلبك — الكود ${l.code}${l.district ? ` في ${l.district}` : ""}${Number(l.price) > 0 ? ` بسعر ${sar(Number(l.price))} ريال` : ""}. نرتب لك معاينة؟`)}>
                  واتساب
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {showPhotos && <ListingPhotos listingId={l.id} code={l.code} />}
      {showAd && <AdComposer listing={l} orgName={adOrg} phone={adPhone} onClose={() => setShowAd(false)} />}
    </div>
  );
}

/* ──────────────────────── نموذج إضافة/تعديل ──────────────────────── */

function ListingForm({ editing, all, brokerages, busy, onSave, onCancel }: {
  editing?: Listing; all: Listing[]; brokerages: ComplianceItem[]; busy: boolean;
  onSave: (d: Partial<Listing>) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<any>(() => editing ? { ...editing } : {
    kind: "land" as ListingKind, offer_type: "sale" as OfferType, code: nextCode(all, "land"),
    title: "", district: "", city: "", price: "", area: "", owner_name: "", owner_phone: "", source: "owner",
    deed_no: "", plan_no: "", parcel_no: "", street_count: "",
    unit_no: "", floor_no: "", rooms: "", baths: "", building_age: "", furnished: false,
    status: "available" as ListingStatus, last_confirmed_at: today(), brokerage_id: "", note: "",
  });

  const meta = KIND_META[d.kind as ListingKind] || KIND_META.other;
  const ppm = pricePerMeter({ price: Number(d.price) || 0, area: Number(d.area) || 0 });

  // تغيير النوع يجدّد الكود تلقائيًّا — إلا في التعديل، فالكود ثابت لأنه مرجع كل شيء
  function changeKind(k: ListingKind) {
    setD((x: any) => ({ ...x, kind: k, code: editing ? x.code : nextCode(all, k) }));
  }

  const ready = String(d.code || "").trim().length > 0;

  function submit() {
    const num = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));
    const txt = (v: any) => (String(v || "").trim() || null);
    const land = KIND_META[d.kind as ListingKind]?.land;
    onSave({
      code: String(d.code).trim(),
      kind: d.kind, offer_type: d.offer_type,
      title: txt(d.title), district: txt(d.district), city: txt(d.city),
      price: num(d.price), area: num(d.area),
      owner_name: txt(d.owner_name), owner_phone: txt(d.owner_phone),
      source: d.source === "broker" ? "broker" : "owner",
      // حقول النوع الآخر تُمسح صراحةً حتى لا تبقى بيانات معلّقة من نوع سابق
      deed_no: land ? txt(d.deed_no) : null,
      plan_no: land ? txt(d.plan_no) : null,
      parcel_no: land ? txt(d.parcel_no) : null,
      street_count: land ? num(d.street_count) : null,
      unit_no: land ? null : txt(d.unit_no),
      floor_no: land ? null : num(d.floor_no),
      rooms: land ? null : num(d.rooms),
      baths: land ? null : num(d.baths),
      building_age: land ? null : num(d.building_age),
      furnished: land ? false : !!d.furnished,
      status: d.status || "available",
      last_confirmed_at: d.last_confirmed_at || null,
      brokerage_id: d.brokerage_id || null,
      note: txt(d.note),
    });
  }

  return (
    <div>
      <h1 className="font-display font-bold text-deep text-xl mb-4">
        {editing ? `تعديل ${editing.code}` : "معروض جديد"}
      </h1>

      <div className="space-y-3 max-w-2xl">
        <F label="النوع">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {(Object.keys(KIND_META) as ListingKind[]).map((k) => (
              <button key={k} type="button" onClick={() => changeKind(k)}
                className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                  d.kind === k ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                {KIND_META[k].icon}<br />{KIND_META[k].label}
              </button>
            ))}
          </div>
        </F>

        <div className="grid grid-cols-2 gap-3">
          <F label="العرض">
            <div className="grid grid-cols-2 gap-2">
              {(["sale", "rent"] as OfferType[]).map((k) => (
                <button key={k} type="button" onClick={() => setD({ ...d, offer_type: k })}
                  className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                    d.offer_type === k ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                  {OFFER_LABEL[k]}
                </button>
              ))}
            </div>
          </F>
          <F label="الكود" hint="سمِّ به الصور والصك والإعلان">
            <input className="fld font-mono" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} />
          </F>
        </div>

        <F label="وصف مختصر" hint="اختياري">
          <input className="fld" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })}
            placeholder={meta.land ? "زاوية على شارعين، قريبة من المسجد" : "تشطيب ممتاز، مدخلان"} />
        </F>

        <div className="grid grid-cols-2 gap-3">
          <F label="الحي"><input className="fld" value={d.district} onChange={(e) => setD({ ...d, district: e.target.value })} /></F>
          <F label="المدينة"><input className="fld" value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} /></F>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <F label={d.offer_type === "rent" ? "الإيجار السنوي (ريال)" : "السعر (ريال)"}>
            <input className="fld" type="number" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} />
          </F>
          <F label="المساحة (م²)" hint={ppm ? `سعر المتر ${sar(ppm)}` : undefined}>
            <input className="fld" type="number" value={d.area} onChange={(e) => setD({ ...d, area: e.target.value })} />
          </F>
        </div>

        {/* حقول تخص النوع وحده */}
        {meta.land ? (
          <div className="grid grid-cols-2 gap-3">
            <F label="رقم الصك"><input className="fld" value={d.deed_no} onChange={(e) => setD({ ...d, deed_no: e.target.value })} /></F>
            <F label="رقم المخطط"><input className="fld" value={d.plan_no} onChange={(e) => setD({ ...d, plan_no: e.target.value })} /></F>
            <F label="رقم القطعة"><input className="fld" value={d.parcel_no} onChange={(e) => setD({ ...d, parcel_no: e.target.value })} /></F>
            <F label="عدد الشوارع"><input className="fld" type="number" value={d.street_count} onChange={(e) => setD({ ...d, street_count: e.target.value })} /></F>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <F label="رقم الوحدة"><input className="fld" value={d.unit_no} onChange={(e) => setD({ ...d, unit_no: e.target.value })} /></F>
              <F label="الدور"><input className="fld" type="number" value={d.floor_no} onChange={(e) => setD({ ...d, floor_no: e.target.value })} /></F>
              <F label="عمر البناء (سنة)"><input className="fld" type="number" value={d.building_age} onChange={(e) => setD({ ...d, building_age: e.target.value })} /></F>
            </div>
            <div className="grid grid-cols-3 gap-3 items-end">
              <F label="الغرف"><input className="fld" type="number" value={d.rooms} onChange={(e) => setD({ ...d, rooms: e.target.value })} /></F>
              <F label="دورات المياه"><input className="fld" type="number" value={d.baths} onChange={(e) => setD({ ...d, baths: e.target.value })} /></F>
              <label className="flex items-center gap-2 text-sm pb-2.5">
                <input type="checkbox" checked={!!d.furnished} onChange={(e) => setD({ ...d, furnished: e.target.checked })} />
                <span>مفروشة</span>
              </label>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <F label="اسم المالك"><input className="fld" value={d.owner_name} onChange={(e) => setD({ ...d, owner_name: e.target.value })} /></F>
          <F label="جوال المالك"><input className="fld" type="tel" value={d.owner_phone} onChange={(e) => setD({ ...d, owner_phone: e.target.value })} placeholder="05xxxxxxxx" /></F>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <F label="مصدر المعروض" hint="يحدد نصيبك من العمولة">
            <select className="fld" value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })}>
              <option value="owner">مالك مباشر</option>
              <option value="broker">وسيط آخر</option>
            </select>
          </F>
          <F label="الحالة">
            <select className="fld" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>
              {(Object.keys(STATUS_META) as ListingStatus[]).map((k) => (
                <option key={k} value={k}>{STATUS_META[k].label}</option>
              ))}
            </select>
          </F>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <F label="آخر تأكيد للتوفر" hint="متى سألت المالك آخر مرة">
            <DateField value={d.last_confirmed_at || ""} onChange={(v) => setD({ ...d, last_confirmed_at: v })} />
          </F>
          <F label="عقد الوساطة المرتبط" hint="اختياري">
            <select className="fld" value={d.brokerage_id || ""} onChange={(e) => setD({ ...d, brokerage_id: e.target.value })}>
              <option value="">— بلا ربط —</option>
              {brokerages.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </F>
        </div>

        <F label="ملاحظة" hint="اختياري">
          <input className="fld" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
        </F>

        <div className="flex gap-2 justify-end pt-1">
          <button className="btn btn-ghost text-sm" onClick={onCancel} disabled={busy}>رجوع</button>
          <button className="btn btn-gold text-sm" onClick={submit} disabled={!ready || busy}>
            {busy ? "…" : editing ? "حفظ التعديل" : "إضافة المعروض"}
          </button>
        </div>
      </div>
    </div>
  );
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold mb-1">{label} {hint && <span className="text-muted font-normal text-xs">— {hint}</span>}</span>
      {children}
    </label>
  );
}
