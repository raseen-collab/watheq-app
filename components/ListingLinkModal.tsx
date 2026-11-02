"use client";
/**
 * 🔗 رابط المعروض للزبون — /l/{token} (2 نوفمبر 2026)
 *
 * المسوّق يرسل رابطًا واحدًا بدل خمس صور وفقرة: الزبون يرى الصور والمواصفات
 * والسعر وجوال المسوّق، ولا يرى شيئًا عن المالك. الرابط يُبطَل بضغطة، ويتوقّف
 * وحده حين تخرج حالة المعروض من «متاح/محجوز» (الصفحة تعرض «لم يعد متاحًا»).
 * الرمز 48 خانة hex عشوائية — تخمينه غير عملي. الجدول listing_links (schema-v78).
 */
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { waLink } from "@/lib/utils";
import { KIND_META, OFFER_LABEL, isOpen, type Listing } from "@/lib/listings";

type LinkRow = { id: string; token: string; revoked: boolean; views: number; last_view_at: string | null; created_at: string };

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ListingLinkModal({ listing, onClose, onShown }: {
  listing: Listing; onClose: () => void;
  /** بعد الإرسال لزبون: يُسجَّل في «عُرض على» (اختياري) */
  onShown?: (name: string, phone: string) => void;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const open = isOpen(listing);
  const meta = KIND_META[listing.kind] || KIND_META.other;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const urlOf = (t: string) => `${origin}/l/${t}`;
  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 3500); }
  function friendly(e: any) {
    const t = String(e?.message || e);
    return /listing_links/.test(t) && /(not exist|relation|schema cache)/i.test(t)
      ? "شغّل ملف schema-v78-marketer.sql في Supabase أولًا ثم أعد المحاولة" : t;
  }

  async function load() {
    const { data, error } = await supabase.from("listing_links")
      .select("id, token, revoked, views, last_view_at, created_at")
      .eq("listing_id", listing.id).order("created_at", { ascending: false }).limit(20);
    if (error) { flash("err", friendly(error)); setRows([]); } else setRows((data || []) as LinkRow[]);
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = (rows || []).find((r) => !r.revoked) || null;

  async function create() {
    setBusy(true);
    try {
      const uid = await officeId(supabase);
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const { data, error } = await supabase.from("listing_links")
        .insert({ user_id: uid, listing_id: listing.id, token: randomToken() })
        .select("id, token, revoked, views, last_view_at, created_at").single();
      if (error) throw error;
      setRows([data as LinkRow, ...(rows || [])]);
      flash("ok", "أُنشئ الرابط — انسخه أو أرسله واتساب");
    } catch (e) { flash("err", friendly(e)); } finally { setBusy(false); }
  }

  async function setRevoked(r: LinkRow, revoked: boolean) {
    const { error } = await supabase.from("listing_links").update({ revoked }).eq("id", r.id);
    if (error) return flash("err", friendly(error));
    setRows((rows || []).map((x) => (x.id === r.id ? { ...x, revoked } : x)));
    flash("ok", revoked ? "أُبطل الرابط — لن يفتح بعد الآن" : "أُعيد تفعيل الرابط");
  }

  async function copy(t: string) {
    try { await navigator.clipboard.writeText(urlOf(t)); flash("ok", "نُسخ الرابط"); }
    catch { flash("err", "انسخه يدويًّا من الصندوق"); }
  }

  const waText = (t: string) => {
    const name = custName.trim();
    const where = listing.district ? ` في ${listing.district}` : "";
    const price = Number(listing.price) > 0 ? ` — ${Number(listing.price).toLocaleString("en-US")} ريال${listing.offer_type === "rent" ? " سنويًّا" : ""}` : "";
    return `السلام عليكم${name ? ` ${name}` : ""}، هذا ${meta.label} ${OFFER_LABEL[listing.offer_type]}${where}${price}. الصور والمواصفات كاملة في الرابط:\n${urlOf(t)}`;
  };

  function sentTo() {
    if (onShown && (custName.trim() || custPhone.trim())) onShown(custName.trim(), custPhone.trim());
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl border border-line shadow-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="font-display font-bold text-deep text-lg inline-flex items-center gap-2"><Icon name="link" size={20} /> رابط الزبون — {listing.code}</h3>
            <p className="text-xs text-muted leading-relaxed mt-1">
              صفحة بالصور والمواصفات والسعر وجوالك. <b>لا تعرض اسم المالك ولا جواله</b>، وتتوقّف وحدها حين يصير المعروض متعاقدًا أو مسحوبًا.
            </p>
          </div>
          <button className="btn btn-ghost text-sm shrink-0" onClick={onClose}>إغلاق</button>
        </div>

        {msg && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>{msg.m}</div>
        )}

        {!open && (
          <div className="mt-3 text-sm bg-[#FDF6E3] border border-[#EAD9A8] text-[#7a5c12] rounded-xl p-3 leading-relaxed">
            المعروض ليس «متاحًا» ولا «محجوزًا» — الرابط يفتح على «لم يعد متاحًا». غيّر الحالة أولًا إن كان ما زال يُعرض.
          </div>
        )}

        {rows === null ? <p className="text-sm text-muted mt-4">…</p> : !active ? (
          <div className="mt-4 rounded-2xl border border-dashed border-line bg-paper p-5 text-center">
            <p className="text-sm text-muted">لا رابط فعّال لهذا المعروض.</p>
            <button className="btn btn-gold text-sm mt-3" onClick={create} disabled={busy}>{busy ? "…" : <><Icon name="plus" /> أنشئ رابطًا</>}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-line bg-paper p-3">
              <div className="text-[11px] text-muted mb-1">الرابط الفعّال · {active.views} {active.views === 1 ? "مشاهدة" : "مشاهدات"}</div>
              <div className="flex gap-2 items-center">
                <input readOnly className="fld font-mono text-xs flex-1 min-w-0" dir="ltr" value={urlOf(active.token)} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn btn-ghost text-xs shrink-0" onClick={() => copy(active.token)}>نسخ</button>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <a className="btn btn-ghost text-xs" href={urlOf(active.token)} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> معاينة كما يراها الزبون</a>
                <button className="btn btn-ghost text-xs text-late" onClick={() => setRevoked(active, true)}>إبطال الرابط</button>
              </div>
            </div>

            <div className="rounded-xl border border-line p-3">
              <div className="text-sm font-semibold text-deep mb-2">أرسله لزبون</div>
              <div className="grid grid-cols-2 gap-2">
                <input className="fld text-sm" placeholder="اسم الزبون (اختياري)" value={custName} onChange={(e) => setCustName(e.target.value)} />
                <input className="fld text-sm" type="tel" placeholder="جواله 05xxxxxxxx" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
              </div>
              <div className="flex gap-2 mt-2 flex-wrap items-center">
                {custPhone.trim() ? (
                  <a className="btn btn-wa text-sm" target="_blank" rel="noreferrer" href={waLink(custPhone, waText(active.token))} onClick={sentTo}>
                    <Icon name="whatsapp" size={15} /> أرسل واتساب
                  </a>
                ) : (
                  <button className="btn btn-ghost text-sm" onClick={async () => { try { await navigator.clipboard.writeText(waText(active.token)); flash("ok", "نُسخت الرسالة بالرابط"); sentTo(); } catch { flash("err", "انسخ الرابط يدويًّا"); } }}>
                    نسخ الرسالة بالرابط
                  </button>
                )}
                {onShown && <span className="text-[11px] text-muted">يُسجَّل في «عُرض على» تلقائيًّا إن كتبت اسمًا أو جوالًا.</span>}
              </div>
            </div>
          </div>
        )}

        {(rows || []).some((r) => r.revoked) && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer">روابط مُبطَلة ({(rows || []).filter((r) => r.revoked).length})</summary>
            <ul className="mt-2 space-y-1">
              {(rows || []).filter((r) => r.revoked).map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="font-mono truncate flex-1 min-w-0" dir="ltr">…{r.token.slice(-10)}</span>
                  <span>{r.views} مشاهدة</span>
                  {!active && <button className="underline" onClick={() => setRevoked(r, false)}>إعادة تفعيل</button>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
