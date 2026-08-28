"use client";
/**
 * 🔗 رابط المالك — تقرير حي للقراءة فقط بلا حساب ولا كلمة مرور.
 * المكتب ينشئ رابطًا سرّيًّا طويلًا ويرسله للمالك واتساب؛ المالك يفتح
 * فيرى تقرير الشهر الحالي محدَّثًا لحظة الفتح. الرابط يُبطل بضغطة.
 * الأمان بطول الرمز (48 خانة عشوائية) + الإبطال + انتهاء اختياري.
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { officeId } from "@/lib/office";
import { waLink } from "@/lib/utils";
import { arDate } from "@/lib/documents";

type LinkRow = {
  id: string; token: string; label: string | null;
  revoked: boolean; expires_at: string | null; created_at: string;
};

function randomToken(): string {
  const bytes = new Uint8Array(24); // 48 خانة hex — تخمينه غير عملي
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function OwnerLinkModal({ propertyId, propertyName, ownerPhoneHint, onClose }: {
  propertyId: string; propertyName: string; ownerPhoneHint?: string | null; onClose: () => void;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const urlOf = (t: string) => `${origin}/r/${t}`;

  function flash(k: "ok" | "err", m: string) { setMsg({ k, m }); setTimeout(() => setMsg(null), 3500); }
  function friendly(e: any) {
    const t = String(e?.message || e);
    return /owner_links/.test(t) && /(not exist|relation|schema cache)/i.test(t)
      ? "شغّل ملف schema-v8.sql في Supabase أولًا ثم أعد المحاولة" : t;
  }

  async function load() {
    const { data, error } = await supabase.from("owner_links")
      .select("id, token, label, revoked, expires_at, created_at")
      .eq("property_id", propertyId).order("created_at", { ascending: false }).limit(50);
    if (error) { flash("err", friendly(error)); setRows([]); }
    else setRows((data || []) as LinkRow[]);
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createLink() {
    setBusy(true);
    try {
      const uid = await officeId(supabase);
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
      const token = randomToken();
      const { data, error } = await supabase.from("owner_links")
        .insert({ user_id: uid, property_id: propertyId, token, label: label.trim() || null })
        .select("id, token, label, revoked, expires_at, created_at").single();
      if (error) throw error;
      setRows([data as LinkRow, ...(rows || [])]);
      setLabel("");
      flash("ok", "أُنشئ الرابط — انسخه وأرسله للمالك");
    } catch (e) { flash("err", friendly(e)); } finally { setBusy(false); }
  }

  async function setRevoked(x: LinkRow, revoked: boolean) {
    const { error } = await supabase.from("owner_links").update({ revoked }).eq("id", x.id);
    if (error) return flash("err", friendly(error));
    setRows((rows || []).map((r) => (r.id === x.id ? { ...r, revoked } : r)));
    flash("ok", revoked ? "أُبطل الرابط — لن يفتح بعد الآن" : "أُعيد تفعيل الرابط");
  }

  async function copy(t: string) {
    try { await navigator.clipboard.writeText(urlOf(t)); flash("ok", "نُسخ الرابط"); }
    catch { flash("err", "انسخه يدويًّا من الصندوق"); }
  }

  const waText = (t: string) =>
    `السلام عليكم، هذا رابط تقرير عقارك «${propertyName}» — يعرض التحصيل والمصروفات والصافي محدّثًا أولًا بأول:\n${urlOf(t)}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display font-bold text-deep text-xl">🔗 رابط المالك — {propertyName}</h2>
            <p className="text-sm text-muted mt-1">
              المالك يفتح الرابط فيرى تقرير الشهر الحالي حيًّا (إشغال، تحصيل، مصروفات، صافي) — بلا تسجيل ولا كلمة مرور.
            </p>
          </div>
          <button className="btn btn-ghost text-xs" onClick={onClose}>إغلاق</button>
        </div>

        {msg && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
            msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>
            {msg.m}
          </div>
        )}

        <div className="flex items-end gap-2 mt-4 flex-wrap">
          <label className="block flex-1 min-w-[180px]">
            <span className="block text-sm font-semibold mb-1">وصف الرابط <span className="text-muted text-xs font-normal">— اختياري، لك أنت</span></span>
            <input className="fld" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="رابط أبو فهد — مالك العمارة" />
          </label>
          <button className="btn btn-gold text-sm" onClick={createLink} disabled={busy}>{busy ? "…" : "+ إنشاء رابط"}</button>
        </div>

        <div className="mt-3 rounded-xl border border-[#EBD9AA] bg-[#FBF1DF] p-3 text-xs text-[#6b4a10] leading-relaxed">
          الرابط نفسه هو السر: من وصله رأى أرقام هذا العقار (قراءة فقط). أرسله للمالك مباشرة،
          وإن تسرّب أو تغيّر المالك اضغط <b>إبطال</b> وأنشئ غيره — القديم يموت فورًا.
        </div>

        {rows === null ? (
          <p className="text-sm text-muted mt-4">جارٍ التحميل…</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted mt-4">لا روابط بعد — أنشئ أول رابط وأرسله للمالك بدل ملف PDF كل شهر.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {rows.map((x) => (
              <div key={x.id} className={`rounded-xl border border-line p-3 ${x.revoked ? "bg-[#F8FAFC] opacity-75" : "bg-paper"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">{x.label || "رابط المالك"}</span>
                  <span className={`text-[.68rem] font-bold rounded-lg px-2 py-0.5 ${
                    x.revoked ? "bg-[#FBE9E7] text-[#a5322c]" : "bg-[#E6F4EC] text-[#137a50]"}`}>
                    {x.revoked ? "مُبطَل" : "فعّال"}
                  </span>
                  <span className="text-[.7rem] text-muted">أُنشئ {arDate(String(x.created_at).slice(0, 10))}</span>
                </div>
                <input className="fld font-mono text-[.7rem] mt-2" dir="ltr" readOnly value={urlOf(x.token)} onFocus={(e) => e.currentTarget.select()} />
                <div className="flex flex-wrap gap-1.5 justify-end mt-2">
                  {!x.revoked && (
                    <>
                      <button className="btn btn-ghost text-xs" onClick={() => copy(x.token)}>📋 نسخ</button>
                      <a className="btn btn-ghost text-xs" target="_blank" rel="noreferrer" href={waLink(ownerPhoneHint || "", waText(x.token))}>واتساب</a>
                      <a className="btn btn-ghost text-xs" target="_blank" rel="noreferrer" href={urlOf(x.token)}>معاينة</a>
                    </>
                  )}
                  {x.revoked
                    ? <button className="btn btn-ghost text-xs" onClick={() => setRevoked(x, false)}>إعادة تفعيل</button>
                    : <button className="btn btn-ghost text-xs text-late" onClick={() => setRevoked(x, true)}>إبطال</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
