"use client";
/**
 * 📋 سجل المعروضات — الأراضي والشقق المعروضة للبيع أو الإيجار.
 *
 * غرضه الترتيب الداخلي لا التسويق: كود موحّد لكل معروض يُسمّى به كل شيء
 * (الصور، الصك، الإعلان، محادثة واتساب)، وحالة صريحة، وزر واحد
 * «✓ أكّدت التوفر» لأن المعروضات تتعفّن ولا تضيع.
 *
 * (29 أكتوبر 2026 — طلب عميل من حراج: «جاني زبون يبي شقة ٣ غرف، أبحث في
 * وثيق») صار البحث بحث زبون: النوع والعرض والغرف وأقصى سعر، وترتيب،
 * وعرض بطاقات بصورة الغلاف أو قائمة، وزرّ يحفظ البحث طلبًا للزبون.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { sar, today, waLink } from "@/lib/utils";
import { openDoc, listingsRegisterHTML, arDate } from "@/lib/documents";
import {
  KIND_META, OFFER_LABEL, STATUS_META, freshness, pricePerMeter, shortDesc,
  summarize, nextCode, isOpen, STALE_DAYS, filterListings, sortListingsBy, hasSeekerCriteria, SORT_LABEL,
  type Listing, type ListingKind, type OfferType, type ListingStatus, type StatusFilter, type ListingSort, type ListingQuery,
} from "@/lib/listings";
import { complianceState, type ComplianceItem } from "@/lib/compliance";
import { matchesForListing, roomsAtLeast, type SeekerRequest } from "@/lib/requests";
import RequestsPanel from "@/components/RequestsPanel";
import ListingPhotos from "@/components/ListingPhotos";
import AdComposer from "@/components/AdComposer";
import DateField from "@/components/DateField";
import Icon, { type IconName } from "@/components/Icon";

const TONE_CLS: Record<string, string> = {
  ok:    "bg-[#E6F4EC] text-[#137a50]",
  warn:  "bg-[#FBF1DF] text-[#8a5a11]",
  bad:   "bg-[#FBE9E7] text-[#a5322c]",
  muted: "bg-[#F1F5F9] text-[#475569]",
};

/** أيقونة خطّية لكل نوع — الإيموجي في KIND_META يبقى لنصوص الإعلان والمستندات */
export const KIND_ICON: Record<ListingKind, IconName> = {
  land: "land", apartment: "apartment", villa: "villa", building: "building", shop: "shop", other: "box",
};
const OFFER_CLS: Record<OfferType, string> = {
  sale: "bg-[#E6F1FB] text-[#0C447C]",
  rent: "bg-[#EEE9FB] text-[#4B3AA6]",
};
const ROOM_STEPS = [1, 2, 3, 4, 5];
const VIEW_KEY = "watheq.listings.view";

/* صور الغلاف: أول صورة لكل معروض مفتوح، بقائمة واحدة لكل مجلد وتوقيع جماعي
   واحد — لا تُبطئ الصفحة: تُجلب بعد الرسم، والبطاقة تعرض أيقونة النوع حتى تصل. */
function useCovers(items: Listing[]) {
  const supabase = useMemo(() => createClient(), []);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const ids = useMemo(() => items.filter(isOpen).slice(0, 60).map((l) => l.id).join(","), [items]);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const uid = await officeId(supabase);
        if (!uid || !ids) return;
        const list = ids.split(",");
        const paths: { id: string; path: string }[] = [];
        for (let i = 0; i < list.length; i += 6) {
          const chunk = list.slice(i, i + 6);
          const res = await Promise.all(chunk.map((id) => supabase.storage.from("listing-photos")
            .list(`${uid}/${id}`, { limit: 1, sortBy: { column: "created_at", order: "asc" } })
            .then((r: any) => ({ id, f: r?.data?.[0] }), () => ({ id, f: null }))));
          for (const r of res) if (r.f?.name) paths.push({ id: r.id, path: `${uid}/${r.id}/${r.f.name}` });
          if (dead) return;
        }
        if (!paths.length) return;
        const { data } = await supabase.storage.from("listing-photos").createSignedUrls(paths.map((p) => p.path), 3600);
        if (dead || !data) return;
        const m: Record<string, string> = {};
        (data as any[]).forEach((d, i) => { if (d?.signedUrl) m[paths[i].id] = d.signedUrl; });
        setCovers(m);
      } catch { /* الغلاف تحسين لا شرط */ }
    })();
    return () => { dead = true; };
  }, [ids, tick, supabase]);
  return { covers, refresh: () => setTick((t) => t + 1) };
}

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
  const [query, setQuery] = useState<ListingQuery>({ status: "open", kind: "", offer: "", roomsMin: 0, priceMax: 0, q: "" });
  const [sortBy, setSortBy] = useState<ListingSort>("attention");
  const [view, setView] = useState<"cards" | "list">("cards");
  const [prefill, setPrefill] = useState<Partial<SeekerRequest> | null>(null);
  const [form, setForm] = useState<null | { editing?: Listing }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);
  const { covers, refresh: refreshCovers } = useCovers(items);

  /* طريقة العرض تُتذكّر لكل متصفح — راحة لا حالة: تعمل بدونها */
  useEffect(() => { try { const v = localStorage.getItem(VIEW_KEY); if (v === "list" || v === "cards") setView(v); } catch { /* */ } }, []);
  function pickView(v: "cards" | "list") { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* */ } }

  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 3500); }
  const set = (p: Partial<ListingQuery>) => setQuery((x) => ({ ...x, ...p }));

  const s = useMemo(() => summarize(items), [items]);
  const shown = useMemo(() => sortListingsBy(filterListings(items, query), sortBy), [items, query, sortBy]);
  const isLandOnly = query.kind ? !!KIND_META[query.kind as ListingKind]?.land : false;
  const filtered = !!(query.kind || query.offer || query.roomsMin || query.priceMax || (query.q || "").trim());

  function clearFilters() { setQuery({ status: "open", kind: "", offer: "", roomsMin: 0, priceMax: 0, q: "" }); }

  /** بحث الزبون ← طلب محفوظ: «لما يجي معروض يناسبه نعرف» */
  function saveAsRequest() {
    setPrefill({
      kind: (query.kind || "apartment") as ListingKind,
      offer_type: (query.offer || "rent") as OfferType,
      rooms_min: Number(query.roomsMin) || null,
      price_max: Number(query.priceMax) || null,
      districts: (query.q || "").trim() || null,
    });
    setTab("requests");
  }

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
        flash("ok", `أُضيف المعروض ${(data as Listing).code} — أضف صوره من زر الكاميرا`);
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

  const activeReq = requests.filter((r) => String(r.status || "active") === "active").length;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-[#FBF1DF] text-[#8a5a11] shrink-0"><Icon name="tag" size={22} /></span>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-deep text-2xl leading-tight">سجل المعروضات</h1>
            <p className="text-sm text-muted mt-1 leading-relaxed">
              عقاراتك المعروضة بكود ثابت وحالة واضحة، وبحث سريع لما يتصل زبون.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <button className="btn btn-ghost text-sm" onClick={() => openDoc(listingsRegisterHTML(items, orgName, issuer || {}))}>
              <Icon name="print" /> <span className="hidden sm:inline">طباعة السجل</span>
            </button>
          )}
          <button className="btn btn-gold text-sm" onClick={() => setForm({})}><Icon name="plus" /> معروض</button>
        </div>
      </div>

      {/* تبويبا السجل: معروضاتك ↔ طلبات الباحثين */}
      <div className="inline-flex bg-white border border-line rounded-xl p-1 mt-4">
        {([["listings", "tag", "المعروضات", s.total], ["requests", "search", "طلبات الزبائن", activeReq]] as const).map(([k, ic, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3.5 min-h-[40px] rounded-lg text-sm font-semibold transition ${
              tab === k ? "bg-[#FBF1DF] text-deep" : "text-muted hover:bg-paper"}`}>
            <Icon name={ic} /> {label}
            <span className={`text-[.7rem] rounded-full px-1.5 min-w-[1.4rem] ${tab === k ? "bg-white text-deep" : "bg-[#F1F5F9] text-[#475569]"}`}>{n}</span>
          </button>
        ))}
      </div>

      {msg && (
        <div role="status" className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
          msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>
          {msg.m}
        </div>
      )}

      {tab === "requests" ? (
        <div className="mt-4"><RequestsPanel initial={requests} listings={items} prefill={prefill} onPrefillUsed={() => setPrefill(null)} /></div>
      ) : (<>

      {/* الأرقام التي تهمّ فعلًا — وكل رقم يفتح ما يعدّه */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        <Stat v={s.open} l="مفتوح للعرض" icon="tag" on={query.status === "open"} onClick={() => set({ status: "open" })} />
        <Stat v={s.available} l="متاح" icon="check" tone="ok" on={query.status === "available"} onClick={() => set({ status: "available" })} />
        <Stat v={s.reserved} l="محجوز بعربون" icon="clock" on={query.status === "reserved"} onClick={() => set({ status: "reserved" })} />
        <Stat v={s.stale} l="يحتاج تأكيد توفر" icon="alert" tone={s.stale ? "warn" : undefined} on={query.status === "stale"} onClick={() => set({ status: "stale" })} />
      </div>

      {s.stale > 0 && query.status !== "stale" && (
        <div className="mt-3 rounded-xl border border-[#EBD9AA] bg-[#FBF1DF] p-3 text-sm text-[#8a5a11] flex items-center gap-3 flex-wrap">
          <Icon name="alert" size={18} />
          <span className="flex-1 min-w-[200px] leading-relaxed">
            <b>{s.stale}</b> من معروضاتك المفتوحة لم يُؤكَّد توفرها منذ {STALE_DAYS} يومًا أو أكثر — اتصل بالمالك قبل أن تعرضها على زبون.
          </span>
          <button className="btn btn-ghost text-xs" onClick={() => set({ status: "stale" })}>اعرضها</button>
        </div>
      )}

      {/* بحث الزبون */}
      <div className="mt-4 rounded-2xl border border-line bg-white p-3 sm:p-4">
        <div className="relative">
          <span className="absolute inset-y-0 start-3 grid place-items-center text-muted pointer-events-none"><Icon name="search" /></span>
          <input className="fld text-sm" style={{ paddingInlineStart: "2.4rem" }} placeholder="ابحث بالحي، الكود، المالك، رقم الصك…"
            value={query.q} onChange={(e) => set({ q: e.target.value })} aria-label="بحث في المعروضات" />
        </div>

        <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="النوع">
          <Chip on={!query.kind} onClick={() => set({ kind: "" })}>الكل</Chip>
          {(Object.keys(KIND_META) as ListingKind[]).map((k) => (
            <Chip key={k} on={query.kind === k} onClick={() => set({ kind: query.kind === k ? "" : k, ...(KIND_META[k].land ? { roomsMin: 0 } : {}) })}>
              <Icon name={KIND_ICON[k]} /> {KIND_META[k].label}
            </Chip>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-3 mt-3 items-end">
          <div>
            <div className="text-[11px] font-semibold text-muted mb-1">العرض</div>
            <div className="inline-flex rounded-lg border border-line p-0.5 bg-paper">
              {([["", "الكل"], ["sale", "للبيع"], ["rent", "للإيجار"]] as const).map(([k, l]) => (
                <button key={k || "all"} type="button" onClick={() => set({ offer: k as any })}
                  className={`px-3 min-h-[36px] rounded-md text-xs font-semibold transition ${query.offer === k ? "bg-white text-deep shadow-sm" : "text-muted"}`}>{l}</button>
              ))}
            </div>
          </div>
          {!isLandOnly && (
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-muted mb-1 flex items-center gap-1"><Icon name="bed" size={13} /> الغرف</div>
              <div className="flex gap-1.5 overflow-x-auto">
                <Chip small on={!query.roomsMin} onClick={() => set({ roomsMin: 0 })}>أي عدد</Chip>
                {ROOM_STEPS.map((n) => (
                  <Chip small key={n} on={query.roomsMin === n} onClick={() => set({ roomsMin: query.roomsMin === n ? 0 : n })}><bdi dir="ltr">{n}+</bdi></Chip>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className="text-[11px] font-semibold text-muted mb-1 block">أقصى سعر (ريال)</span>
            <input className="fld text-sm sm:w-40" type="number" inputMode="numeric" min={0} placeholder="لا حد"
              value={query.priceMax || ""} onChange={(e) => set({ priceMax: Number(e.target.value) || 0 })} />
          </label>
        </div>

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line flex-wrap">
          <span className="text-sm font-semibold text-deep">{shown.length} {shown.length === 1 ? "معروض" : "معروضًا"}</span>
          {filtered && <button className="text-xs text-muted underline underline-offset-4 min-h-[36px]" onClick={clearFilters}>مسح الفلاتر</button>}
          <div className="grid grid-cols-[1fr_1fr_auto] sm:flex items-center gap-2 w-full sm:w-auto sm:ms-auto">
            <label className="flex items-center gap-1.5 text-xs text-muted min-w-0">
              <span className="hidden sm:inline"><Icon name="filter" size={14} /></span>
              <select className="fld text-xs py-1.5 min-w-0" style={{ width: "100%" }} value={query.status} onChange={(e) => set({ status: e.target.value as StatusFilter })} aria-label="الحالة">
                <option value="open">المفتوحة</option>
                <option value="available">متاح</option>
                <option value="reserved">محجوز</option>
                <option value="stale">يحتاج تأكيد</option>
                <option value="contracted">متعاقد</option>
                <option value="withdrawn">مسحوب</option>
                <option value="all">كل الحالات</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted min-w-0">
              <span className="hidden sm:inline"><Icon name="sort" size={14} /></span>
              <select className="fld text-xs py-1.5 min-w-0" style={{ width: "100%" }} value={sortBy} onChange={(e) => setSortBy(e.target.value as ListingSort)} aria-label="الترتيب">
                {(Object.keys(SORT_LABEL) as ListingSort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
              </select>
            </label>
            <div className="inline-flex rounded-lg border border-line p-0.5 bg-paper" role="group" aria-label="طريقة العرض">
              {([["cards", "grid", "بطاقات"], ["list", "list", "قائمة"]] as const).map(([k, ic, l]) => (
                <button key={k} type="button" onClick={() => pickView(k)} title={l} aria-label={l} aria-pressed={view === k}
                  className={`grid place-items-center w-9 h-9 rounded-md transition ${view === k ? "bg-white text-deep shadow-sm" : "text-muted"}`}>
                  <Icon name={ic} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {hasSeekerCriteria(query) && (
          <div className="mt-3 rounded-xl bg-[#E6F4EC] border border-[#B7DFC7] p-2.5 flex items-center gap-2 flex-wrap text-[12.5px] text-[#137a50]">
            <Icon name="save" />
            <span className="flex-1 min-w-[180px]">{shown.length ? "هذا بحث زبون؟ احفظه طلبًا ليُبلغك وثيق حين يدخل معروض جديد يناسبه." : "ما عندك الحين ما يناسبه — احفظه طلبًا وتصلك المطابقة أول ما يدخل معروض."}</span>
            <button className="btn btn-ghost text-xs" onClick={saveAsRequest}>احفظه طلبًا للزبون</button>
          </div>
        )}
      </div>

      {!shown.length ? (
        <div className="mt-4 rounded-2xl border border-dashed border-line bg-paper p-8 text-center">
          <span className="inline-grid place-items-center w-12 h-12 rounded-full bg-white border border-line text-gold mb-2"><Icon name={items.length ? "search" : "tag"} size={22} /></span>
          <p className="text-sm text-muted leading-relaxed">
            {items.length ? "لا معروض بهذه الشروط." : "ابدأ بأول معروض — أرض أو شقة — ويُعطى كودًا تلقائيًّا مثل أ-101."}
          </p>
          {items.length ? (
            filtered && <button className="btn btn-ghost text-xs mt-3" onClick={clearFilters}>مسح الفلاتر</button>
          ) : (
            <button className="btn btn-gold text-sm mt-3" onClick={() => setForm({})}><Icon name="plus" /> أضف معروضًا</button>
          )}
        </div>
      ) : (
        <div className={view === "cards" ? "mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" : "mt-3 flex flex-col gap-2"}>
          {shown.map((l) => (
            <Card key={l.id} l={l} compact={view === "list"} cover={covers[l.id]} adOrg={orgName} adPhone={issuer?.billing_phone}
              brokerages={brokerages} requests={requests} busy={busy === l.id}
              onConfirm={() => confirmAvailable(l)} onEdit={() => setForm({ editing: l })}
              onStatus={(st) => setStatus(l, st)} onRemove={() => remove(l)} onPhotosClosed={refreshCovers} />
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}

function Chip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap rounded-full border font-semibold transition ${
        small ? "px-3 min-h-[36px] text-xs" : "px-3.5 min-h-[40px] text-[13px]"} ${
        on ? "border-gold bg-[#FBF1DF] text-deep" : "border-line bg-white text-muted hover:border-goldSoft hover:text-deep"}`}>
      {children}
    </button>
  );
}

function Stat({ v, l, icon, tone, on, onClick }: { v: number; l: string; icon: IconName; tone?: "ok" | "warn"; on?: boolean; onClick?: () => void }) {
  const c = tone === "ok" ? "text-[#137a50]" : tone === "warn" ? "text-[#8a5a11]" : "text-deep";
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`rounded-xl border p-3 text-start transition ${on ? "border-gold bg-[#FBF1DF]" : "border-line bg-white hover:border-goldSoft"}`}>
      <div className="flex items-center justify-between">
        <span className={`font-display font-bold text-2xl leading-none ${c}`}>{v}</span>
        <span className={`${c} opacity-70`}><Icon name={icon} size={18} /></span>
      </div>
      <div className="text-[.72rem] text-muted mt-1.5">{l}</div>
    </button>
  );
}

/** مواصفات المعروض كأيقونات — ما يسأل عنه الزبون أولًا */
function specs(l: Listing): { icon: IconName; text: string }[] {
  const out: { icon: IconName; text: string }[] = [];
  const land = KIND_META[l.kind]?.land;
  if (Number(l.area) > 0) out.push({ icon: "area", text: `${Number(l.area).toLocaleString("en-US")} م²` });
  if (land) {
    if (l.plan_no) out.push({ icon: "land", text: `مخطط ${l.plan_no}` });
    if (l.parcel_no) out.push({ icon: "pin", text: `قطعة ${l.parcel_no}` });
    if (Number(l.street_count) > 0) out.push({ icon: "layers", text: `${l.street_count} ${Number(l.street_count) === 1 ? "شارع" : "شوارع"}` });
  } else {
    if (Number(l.rooms) > 0) out.push({ icon: "bed", text: `${l.rooms} ${Number(l.rooms) === 1 ? "غرفة" : Number(l.rooms) === 2 ? "غرفتان" : "غرف"}` });
    if (Number(l.baths) > 0) out.push({ icon: "bath", text: `${l.baths} ${Number(l.baths) === 1 ? "دورة مياه" : "دورات مياه"}` });
    if (l.floor_no != null) out.push({ icon: "layers", text: Number(l.floor_no) === 0 ? "الأرضي" : `الدور ${l.floor_no}` });
    if (l.furnished) out.push({ icon: "sofa", text: "مفروشة" });
  }
  return out;
}

/* ──────────────────────── بطاقة معروض واحد ──────────────────────── */

function Card({ l, compact, cover, brokerages, requests, busy, onConfirm, onEdit, onStatus, onRemove, onPhotosClosed, adOrg, adPhone }: {
  l: Listing; compact: boolean; cover?: string; brokerages: ComplianceItem[]; requests: SeekerRequest[]; busy: boolean;
  onConfirm: () => void; onEdit: () => void; onStatus: (s: ListingStatus) => void; onRemove: () => void; onPhotosClosed: () => void;
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
  const sp = specs(l);
  const place = [l.district, l.city].filter(Boolean).join("، ");

  // تحذير حقيقي: معروض مفتوح وعقد وساطته انتهى — العرض حينها بلا سند
  const bro = brokerages.find((b) => b.id === l.brokerage_id);
  const broState = bro ? complianceState(bro) : null;
  const broProblem = open && broState && (broState.phase === "expired" || broState.phase === "window");

  function togglePhotos() { if (showPhotos) onPhotosClosed(); setShowPhotos(!showPhotos); }

  const media = (
    <div className={`relative overflow-hidden bg-paper2 ${compact ? "w-20 h-20 sm:w-24 sm:h-24 rounded-xl shrink-0" : cover ? "aspect-[16/10] rounded-t-2xl" : "h-24 rounded-t-2xl"}`}>
      {cover
        ? <img src={cover} alt={`صورة ${l.code}`} className={`w-full h-full object-cover ${open ? "" : "grayscale"}`} loading="lazy" />
        : <div className="w-full h-full grid place-items-center text-gold/70"><Icon name={KIND_ICON[l.kind] || "box"} size={compact ? 30 : 36} /></div>}
      {!compact && (
        <>
          <span className="absolute top-2 start-2 font-mono font-bold text-xs bg-white text-deep rounded-md px-2 py-1 shadow-sm">{l.code}</span>
          <span className={`absolute top-2 end-2 text-[.7rem] font-bold rounded-md px-2 py-1 shadow-sm ${TONE_CLS[st.tone]}`}>{st.label}</span>
        </>
      )}
    </div>
  );

  const priceBlock = Number(l.price) > 0 ? (
    <div className="leading-tight">
      <span className="font-display font-bold text-deep text-lg tabular-nums">{sar(Number(l.price))}</span>
      <span className="text-xs text-muted"> ريال{l.offer_type === "rent" ? " / سنة" : ""}</span>
      {ppm ? <div className="text-[11px] text-muted tabular-nums">{sar(Math.round(ppm))} للمتر{l.offer_type === "rent" ? " سنويًّا" : ""}</div> : null}
    </div>
  ) : <div className="text-xs text-muted">السعر غير مسجّل</div>;

  const iconBtn = (name: IconName, label: string, onClick: () => void, extra = "") => (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={`grid place-items-center w-10 h-10 rounded-lg border border-line bg-white text-deep hover:bg-paper transition ${extra}`}>
      <Icon name={name} size={17} />
    </button>
  );

  return (
    <div className={`rounded-2xl border bg-white transition ${open ? "border-line hover:shadow-[0_8px_24px_-14px_rgba(11,33,31,.35)]" : "border-line opacity-75"} ${compact ? "p-3" : ""}`}>
      <div className={compact ? "flex gap-3" : ""}>
        {media}
        <div className={`min-w-0 flex-1 ${compact ? "" : "p-3.5"}`}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {compact && <span className="font-mono font-bold text-xs bg-paper border border-line rounded-md px-1.5 py-0.5">{l.code}</span>}
            <span className={`text-[.7rem] font-bold rounded-md px-2 py-0.5 ${OFFER_CLS[l.offer_type] || OFFER_CLS.sale}`}>{OFFER_LABEL[l.offer_type]}</span>
            <span className="text-sm font-semibold text-deep inline-flex items-center gap-1"><Icon name={KIND_ICON[l.kind] || "box"} size={15} /> {meta.label}</span>
            {compact && <span className={`text-[.68rem] font-bold rounded-md px-2 py-0.5 ${TONE_CLS[st.tone]}`}>{st.label}</span>}
          </div>
          {place && <div className="text-xs text-muted mt-1 inline-flex items-center gap-1"><Icon name="pin" size={13} /> {place}</div>}
          {l.title && <div className="text-[13px] text-[#33413D] mt-1 line-clamp-2">{l.title}</div>}

          <div className={`flex ${compact ? "items-center justify-between gap-3 flex-wrap" : "flex-col gap-2"} mt-2`}>
            {priceBlock}
            {sp.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sp.map((x, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[11.5px] text-deep bg-paper border border-line rounded-full px-2 py-0.5">
                    <Icon name={x.icon} size={13} /> {x.text}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-1">
            {open && (
              <div className={`text-[11.5px] font-semibold inline-flex items-center gap-1.5 ${fr.tone === "warn" ? "text-[#8a5a11]" : "text-[#137a50]"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${fr.tone === "warn" ? "bg-[#B8791F]" : "bg-[#1FA855]"}`} />
                {fr.label}{l.last_confirmed_at ? ` (${arDate(l.last_confirmed_at)})` : ""}
              </div>
            )}
            {broProblem && (
              <div className="text-[11.5px] font-semibold text-[#a5322c] inline-flex items-center gap-1"><Icon name="alert" size={13} /> عقد الوساطة «{bro!.title}» — {broState!.label}</div>
            )}
            {(l.owner_name || l.source) && (
              <div className="text-[11.5px] text-muted inline-flex items-center gap-1.5 flex-wrap">
                <Icon name="owner" size={13} />
                {l.owner_name || "المالك"}{l.source ? ` · ${l.source === "owner" ? "مالك مباشر" : "وسيط آخر"}` : ""}
                {l.owner_phone && (
                  <a className="text-goldInk font-semibold inline-flex items-center gap-0.5" target="_blank" rel="noreferrer"
                    href={waLink(l.owner_phone, `السلام عليكم، بخصوص ${meta.label} ${l.code}${l.district ? ` في ${l.district}` : ""} — هل ما زالت متاحة بنفس السعر؟`)}>
                    <Icon name="whatsapp" size={13} /> اسأل المالك
                  </a>
                )}
              </div>
            )}
          </div>

          {open && hits.length > 0 && (
            <button onClick={() => setShowMatches(!showMatches)} aria-expanded={showMatches}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[12.5px] font-bold rounded-lg min-h-[38px] bg-[#E6F4EC] text-[#137a50] border border-[#B7DFC7] hover:bg-[#D6ECDF] transition">
              <Icon name="sparkle" size={15} /> {hits.length === 1 ? "يناسب طلب زبون عندك" : hits.length === 2 ? "يناسب طلبين عندك" : `يناسب ${hits.length} طلبات عندك`}
            </button>
          )}
        </div>
      </div>

      <div className={`flex items-center gap-1.5 flex-wrap ${compact ? "mt-3 pt-3" : "px-3.5 pb-3.5 pt-3"} border-t border-line`}>
        {open && (
          <button className={`btn text-xs ${fr.stale ? "btn-gold" : "btn-ghost"}`} onClick={onConfirm} disabled={busy}
            title="سجّل أن المالك أكّد أن المعروض ما زال متاحًا بنفس السعر">
            {busy ? "…" : <><Icon name="check" size={15} /> أكّدت التوفر</>}
          </button>
        )}
        <select className="fld text-xs py-2 px-2" style={{ width: "auto" }} value={l.status || "available"}
          onChange={(e) => onStatus(e.target.value as ListingStatus)} disabled={busy} aria-label="حالة المعروض">
          {(Object.keys(STATUS_META) as ListingStatus[]).map((k) => (
            <option key={k} value={k}>{STATUS_META[k].label}</option>
          ))}
        </select>
        <div className="flex gap-1.5 ms-auto">
          {iconBtn("megaphone", "نص إعلان جاهز لحراج وX وواتساب", () => setShowAd(true))}
          {iconBtn("camera", showPhotos ? "إخفاء الصور" : "الصور", togglePhotos, showPhotos ? "border-gold bg-[#FBF1DF]" : "")}
          {iconBtn("edit", "تعديل", onEdit)}
          {iconBtn("trash", "حذف", onRemove, "text-late")}
        </div>
      </div>

      {showMatches && hits.length > 0 && (
        <div className={`flex flex-col gap-1.5 ${compact ? "mt-2" : "px-3.5 pb-3.5"}`}>
          {hits.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs bg-paper border border-line rounded-lg px-2.5 py-2">
              <Icon name="owner" size={14} />
              <span className="font-semibold shrink-0">{r.seeker_name || "طلب بلا اسم"}</span>
              <span className="text-muted min-w-0 flex-1 truncate">{r.districts || "أي حي"}{Number(r.price_max) > 0 ? ` · حتى ${sar(Number(r.price_max))}` : ""}{Number(r.rooms_min) > 0 ? ` · ${roomsAtLeast(Number(r.rooms_min))}` : ""}</span>
              {r.seeker_phone && (
                <a className="btn btn-wa text-xs py-1.5 px-2.5 shrink-0" target="_blank" rel="noreferrer"
                  href={waLink(r.seeker_phone, `السلام عليكم ${r.seeker_name || ""}، توفر عندنا ${meta.label} ${OFFER_LABEL[l.offer_type]} يناسب طلبك — الكود ${l.code}${l.district ? ` في ${l.district}` : ""}${Number(l.price) > 0 ? ` بسعر ${sar(Number(l.price))} ريال` : ""}. نرتب لك معاينة؟`)}>
                  <Icon name="whatsapp" size={14} /> أرسل له
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {showPhotos && <div className={compact ? "mt-2" : "px-3.5 pb-3.5"}><ListingPhotos listingId={l.id} code={l.code} /></div>}
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
                <span className="block mb-1"><Icon name={KIND_ICON[k]} size={20} /></span>{KIND_META[k].label}
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
