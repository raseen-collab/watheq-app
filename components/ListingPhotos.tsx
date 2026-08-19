"use client";
/**
 * 📷 صور المعروض — رفع بضغط إلزامي في المتصفح وعرض بروابط موقّتة.
 *
 * الضغط ليس تحسينًا بل شرط جدوى: صورة الجوال الخام 3–4MB تأكل حصة
 * التخزين بسرعة؛ بعد التصغير إلى 1600px بجودة 0.8 تصير ~200–300KB،
 * فتتسع الحصة لآلاف الصور. المسار {user_id}/{listing_id}/… وسياسات
 * التخزين تمنع أي مستخدم من لمس مجلد غيره.
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-client";

const BUCKET = "listing-photos";
const MAX_PHOTOS = 12;
const MAX_EDGE = 1600;    // أطول ضلع بعد التصغير
const QUALITY = 0.8;

type Photo = { path: string; url: string };

/** تصغير + تحويل إلى JPEG داخل المتصفح — بلا مكتبات خارجية */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("المتصفح لا يدعم معالجة الصور");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
  if (!blob) throw new Error("تعذّر ضغط الصورة");
  return blob;
}

export default function ListingPhotos({ listingId, code }: { listingId: string; code: string }) {
  const supabase = createClient();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function friendly(e: any) {
    const t = String(e?.message || e);
    if (/bucket.*not.*found|listing-photos/i.test(t) && /not/i.test(t))
      return "شغّل ملف schema-v8.sql في Supabase أولًا (ينشئ دلو الصور وسياساته)";
    if (/row-level security|violates/i.test(t)) return "لا تملك صلاحية على هذا المجلد";
    return t;
  }

  async function load() {
    setErr(null);
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const dir = `${uid}/${listingId}`;
      const { data: files, error } = await supabase.storage.from(BUCKET)
        .list(dir, { limit: MAX_PHOTOS, sortBy: { column: "created_at", order: "asc" } });
      if (error) throw error;
      const paths = (files || []).filter((f) => f.name).map((f) => `${dir}/${f.name}`);
      if (!paths.length) { setPhotos([]); return; }
      const { data: signed, error: e2 } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
      if (e2) throw e2;
      setPhotos((signed || []).filter((s) => s.signedUrl).map((s, i) => ({ path: paths[i], url: s.signedUrl! })));
    } catch (e) { setErr(friendly(e)); setPhotos([]); }
  }
  useEffect(() => { if (photos === null) void load(); // photos=null يعني «أعد التحميل»
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setErr(null); setBusy("رفع");
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const room = MAX_PHOTOS - (photos?.length || 0);
      const list = Array.from(files).slice(0, Math.max(0, room));
      if (!list.length) throw new Error(`الحد ${MAX_PHOTOS} صورة للمعروض — احذف قديمًا لترفع جديدًا`);
      for (const f of list) {
        if (!/^image\//.test(f.type)) continue;
        const blob = await compressImage(f);
        const path = `${uid}/${listingId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error } = await supabase.storage.from(BUCKET)
          .upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw error;
      }
      setPhotos(null); // photos=null يعيد التحميل بروابط موقّعة جديدة
    } catch (e) { setErr(friendly(e)); }
    setBusy(null);
  }

  async function remove(p: Photo) {
    if (!confirm("حذف هذه الصورة نهائيًّا؟")) return;
    setBusy(p.path);
    const { error } = await supabase.storage.from(BUCKET).remove([p.path]);
    setBusy(null);
    if (error) return setErr(friendly(error));
    setPhotos((photos || []).filter((x) => x.path !== p.path));
  }

  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted">📷 صور {code} {photos ? `(${photos.length}/${MAX_PHOTOS})` : ""}</span>
        <label className={`btn btn-ghost text-xs cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          {busy === "رفع" ? "جارٍ الضغط والرفع…" : "+ إضافة صور"}
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {err && <div className="text-xs font-semibold text-[#8f2b26] bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2 mt-2">{err}</div>}
      {photos === null ? (
        <p className="text-xs text-muted mt-2">جارٍ التحميل…</p>
      ) : !photos.length ? (
        <p className="text-xs text-muted mt-2">لا صور بعد — تُضغط تلقائيًّا قبل الرفع فلا تقلق من حجم صور الجوال.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
          {photos.map((p) => (
            <div key={p.path} className="relative group rounded-lg overflow-hidden border border-line bg-paper">
              <a href={p.url} target="_blank" rel="noreferrer" title="فتح بالحجم الكامل">
                {/* روابط موقّتة متغيرة — وسم img عادي أنسب من مكوّن Next هنا */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`صورة ${code}`} className="w-full h-24 object-cover" loading="lazy" />
              </a>
              <button
                className="absolute top-1 left-1 bg-black/60 text-white rounded-md text-[.65rem] px-1.5 py-0.5 opacity-90 hover:bg-[#a5322c]"
                onClick={() => remove(p)} disabled={busy === p.path} title="حذف الصورة">
                {busy === p.path ? "…" : "✕"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
