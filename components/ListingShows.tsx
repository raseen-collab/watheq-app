"use client";
/**
 * 👁 «عُرض على» — ذاكرة المسوّق مع زبائنه لكل معروض (2 نوفمبر 2026)
 *
 * المشكلة التي يحلّها: «الزبون اللي شاف الشقة الأسبوع الماضي… منو؟» وأسوأ منها
 * عرض العقار نفسه على الزبون نفسه مرتين، أو نزاع سعي «أنا اللي عرضته عليه أول».
 * سجل بسيط: اسم أو جوال، تاريخ، ملاحظة. الجدول listing_shows (schema-v78).
 */
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { today, waLink } from "@/lib/utils";
import { arDate, openDoc, listingShowsHTML, type ListingLinkRow } from "@/lib/documents";
import type { Listing } from "@/lib/listings";

export type ShowRow = {
  id: string; listing_id: string; customer_name: string | null; customer_phone: string | null;
  shown_at: string; note: string | null; created_at: string;
};

export default function ListingShows({ listing, onCount, orgName, issuer }: { listing: Listing; onCount?: (n: number) => void; orgName?: string; issuer?: any }) {
  const supabase = createClient();
  const [rows, setRows] = useState<ShowRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [d, setD] = useState({ customer_name: "", customer_phone: "", shown_at: today(), note: "" });

  function friendly(e: any) {
    const t = String(e?.message || e);
    return /listing_shows/.test(t) && /(not exist|relation|schema cache)/i.test(t)
      ? "شغّل ملف schema-v78-marketer.sql في Supabase أولًا ثم أعد المحاولة" : t;
  }

  async function load() {
    const { data, error } = await supabase.from("listing_shows").select("*")
      .eq("listing_id", listing.id).order("shown_at", { ascending: false }).order("created_at", { ascending: false }).limit(100);
    if (error) { setErr(friendly(error)); setRows([]); return; }
    setRows((data || []) as ShowRow[]);
    onCount?.((data || []).length);
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = d.customer_name.trim() || d.customer_phone.trim();

  async function add() {
    setBusy(true); setErr(null);
    try {
      const uid = await officeId(supabase);
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const { data, error } = await supabase.from("listing_shows").insert({
        user_id: uid, listing_id: listing.id,
        customer_name: d.customer_name.trim() || null, customer_phone: d.customer_phone.trim() || null,
        shown_at: d.shown_at || today(), note: d.note.trim() || null,
      }).select("*").single();
      if (error) throw error;
      const next = [data as ShowRow, ...(rows || [])];
      setRows(next); onCount?.(next.length);
      setD({ customer_name: "", customer_phone: "", shown_at: today(), note: "" });
      setAdding(false);
    } catch (e) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  /** «محضر عرض» مطبوع: السجل مؤرّخًا + مشاهدات الرابط — دليل المسوّق في نزاع السعي */
  async function printDoc() {
    let links: ListingLinkRow[] = [];
    try {
      const { data } = await supabase.from("listing_links").select("token, revoked, views, last_view_at, created_at").eq("listing_id", listing.id);
      links = (data || []) as ListingLinkRow[];
    } catch { /* المشاهدات تحسين */ }
    openDoc(listingShowsHTML(listing, rows || [], links, orgName || "", issuer || {}));
  }

  async function remove(r: ShowRow) {
    if (!confirm(`حذف سجل العرض على «${r.customer_name || r.customer_phone}»؟`)) return;
    const { data: del, error } = await supabase.from("listing_shows").delete().eq("id", r.id).select("id");
    if (error) return setErr(friendly(error));
    if (!del?.length) return setErr("هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.");
    const next = (rows || []).filter((x) => x.id !== r.id);
    setRows(next); onCount?.(next.length);
  }

  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-deep inline-flex items-center gap-1.5"><Icon name="eye" size={15} /> عُرض على {rows ? <span className="text-muted font-normal text-xs">({rows.length})</span> : null}</div>
        <div className="flex gap-1.5">
          {!!rows?.length && <button className="btn btn-ghost text-xs" onClick={printDoc} title="محضر عرض مؤرّخ — يُرفق مع عقد الوساطة عند نزاع السعي"><Icon name="print" size={13} /> محضر</button>}
          {!adding && <button className="btn btn-ghost text-xs" onClick={() => setAdding(true)}><Icon name="plus" size={13} /> سجّل عرضًا</button>}
        </div>
      </div>
      {err && <div className="mt-2 text-xs text-[#8f2b26] bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg px-2.5 py-1.5">{err}</div>}

      {adding && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input className="fld text-sm" placeholder="اسم الزبون" value={d.customer_name} onChange={(e) => setD({ ...d, customer_name: e.target.value })} />
          <input className="fld text-sm" type="tel" placeholder="جواله 05xxxxxxxx" value={d.customer_phone} onChange={(e) => setD({ ...d, customer_phone: e.target.value })} />
          <input className="fld text-sm" type="date" value={d.shown_at} onChange={(e) => setD({ ...d, shown_at: e.target.value })} aria-label="تاريخ العرض" />
          <input className="fld text-sm" placeholder="ملاحظة: معاينة · أرسلت الرابط · عرض سعر" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
          <div className="col-span-2 flex gap-2 justify-end">
            <button className="btn btn-ghost text-xs" onClick={() => setAdding(false)} disabled={busy}>إلغاء</button>
            <button className="btn btn-gold text-xs" onClick={add} disabled={!ready || busy}>{busy ? "…" : "حفظ"}</button>
          </div>
        </div>
      )}

      {rows === null ? <p className="text-xs text-muted mt-2">…</p> : !rows.length ? (
        !adding && <p className="text-xs text-muted mt-2">لم يُعرض على أحد بعد — سجّل كل زبون تعرضه عليه، فلا يُعرض مرتين ولا يضيع حقّك في السعي.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-xs bg-white border border-line rounded-lg px-2.5 py-1.5">
              <Icon name="owner" size={13} />
              <span className="font-semibold shrink-0">{r.customer_name || r.customer_phone}</span>
              <span className="text-muted min-w-0 flex-1 truncate">{arDate(r.shown_at)}{r.note ? ` · ${r.note}` : ""}</span>
              {r.customer_phone && (
                <a className="text-goldInk font-semibold shrink-0 inline-flex items-center gap-0.5" target="_blank" rel="noreferrer" title="متابعة واتساب"
                  href={waLink(r.customer_phone, `السلام عليكم ${r.customer_name || ""}، بخصوص العقار (${listing.code}) الذي عرضته عليك — هل عندك قرار أو تودّ معاينة ثانية؟`)}>
                  <Icon name="whatsapp" size={13} />
                </a>
              )}
              <button className="text-muted hover:text-late shrink-0" onClick={() => remove(r)} title="حذف" aria-label="حذف"><Icon name="close" size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
