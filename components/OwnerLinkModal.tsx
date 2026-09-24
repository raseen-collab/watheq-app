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
import { waLink, openExternal } from "@/lib/utils";
import { arDate } from "@/lib/documents";

type LinkRow = {
  id: string; token: string; label: string | null;
  revoked: boolean; expires_at: string | null; created_at: string;
  property_id?: string | null; owner_name?: string | null; property_ids?: string[] | null;
};

function randomToken(): string {
  const bytes = new Uint8Array(24); // 48 خانة hex — تخمينه غير عملي
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function OwnerLinkModal({ propertyId, propertyName, ownerPhoneHint, ownerName, properties, onClose }: {
  propertyId: string; propertyName: string; ownerPhoneHint?: string | null; ownerName?: string | null;
  /** عقارات المكتب — لنطاقَي «كل عقارات المالك» و«عقارات مختارة» */
  properties?: { id: string; name: string; owner_name?: string | null }[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [label, setLabel] = useState("");
  /**
   * ثلاثة نطاقات:
   *  one  — هذا العقار وحده
   *  all  — كل عقارات هذا المالك (بالاسم): تتّسع تلقائيًّا بعقار جديد له
   *  pick — عقارات يختارها المكتب: لمالك عنده ست عمائر ويريد رابطًا
   *         لثلاث منها — كأن تكون الأخرى بشراكة مع غيره
   */
  const owner = (ownerName || "").trim();
  const ownerProps = (properties || []).filter((p) => (p.owner_name || "").trim() === owner && owner);
  /* الاسم نفسه بكتابة مختلفة («أبو فهد» و«ابو فهد»): «كل عقاراته» يجمع على الخادم
     بالاسم حرفيًّا فلا يشملها — ننبّه لذلك، ونضيفها لـ«عقارات أختارها» (بالمعرّفات،
     يعمل دائمًا). كان خيار المجمّع يختفي كليًّا فلا يعرف المكتب لماذا. */
  const norm = (x?: string | null) => String(x || "").trim().replace(/\s+/g, " ").replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[\u064B-\u0652\u0640]/g, "");
  const similarProps = (properties || []).filter((p) => owner && norm(p.owner_name) === norm(owner) && (p.owner_name || "").trim() !== owner);
  const pickable = [...ownerProps, ...similarProps];
  const [scope, setScope] = useState<"one" | "all" | "pick">("one");
  const [picked, setPicked] = useState<string[]>([propertyId]);
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
    // روابط هذا العقار + الروابط المجمّعة لمالكه (property_id فارغ، owner_name مطابق) حتى تُبطَل من هنا أيضًا
    let q = supabase.from("owner_links").select("id, token, label, revoked, expires_at, created_at, property_id, owner_name, property_ids");
    /* روابط هذا العقار + المجمّعة لمالكه + المختارة التي تضمّه — فتُبطَل من هنا كلها */
    const parts = [`property_id.eq.${propertyId}`, `property_ids.cs.{${propertyId}}`];
    if (ownerName) parts.push(`owner_name.eq.${JSON.stringify(ownerName)}`);
    q = q.or(parts.join(","));
    const { data, error } = await q.order("created_at", { ascending: false }).limit(50);
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
      if (scope === "pick" && picked.length === 0) throw new Error("اختر عقارًا واحدًا على الأقل");
      const row: any = { user_id: uid, token, label: label.trim() || null };
      if (scope === "one") row.property_id = propertyId;
      else if (scope === "all") row.owner_name = owner;
      else row.property_ids = picked;
      const { data, error } = await supabase.from("owner_links")
        .insert(row)
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

        {/* النطاق — يظهر حين للمالك أكثر من عقار؛ وإلا فالرابط لهذا العقار */}
        {pickable.length > 1 && (
          <div className="mt-4">
            <span className="block text-sm font-semibold mb-2">الرابط يعرض</span>
            <div className="grid gap-1.5">
              {([
                ["one", `هذا العقار وحده — ${propertyName}`],
                ["all", `كل عقارات ${owner} (${ownerProps.length}) — ويشمل ما يُضاف له لاحقًا`],
                ["pick", "عقارات أختارها"],
              ] as const).map(([k, l]) => (
                <label key={k} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer ${
                  scope === k ? "border-deep bg-paper2" : "border-line"}`}>
                  <input type="radio" name="scope" className="mt-0.5" checked={scope === k} onChange={() => setScope(k)} />
                  <span>{l}</span>
                </label>
              ))}
            </div>

            {similarProps.length > 0 && (
              <p className="mt-2 text-[11.5px] leading-relaxed rounded-lg border border-[#F2D49B] bg-[#FFF6E5] px-3 py-2 text-[#6b4a10]">
                {similarProps.length === 1 ? "عقار" : `${similarProps.length} عقارات`} باسم مالك مكتوب بطريقة أخرى
                ({similarProps.map((p) => `«${p.name}»: «${(p.owner_name || "").trim()}»`).join("، ")}) — «كل عقارات {owner}» لا {similarProps.length === 1 ? "يشمله" : "يشملها"}
                حتى يُوحَّد الاسم من إعدادات العقار. أو اختر «عقارات أختارها».
              </p>
            )}
            {scope === "pick" && (
              <div className="mt-2 rounded-lg border border-line p-2 max-h-48 overflow-y-auto">
                {pickable.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-2 text-sm">
                    <input type="checkbox" checked={picked.includes(p.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                    {p.name}
                  </label>
                ))}
                <p className="text-[11px] text-muted px-2 pt-1">
                  {picked.length} من {pickable.length} — والعقار الجديد لا يُضاف لهذا الرابط تلقائيًّا.
                </p>
              </div>
            )}
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
                  {/* نطاق كل رابط ظاهر — فلا يُبطِل المكتب رابط «كل العقارات» ظانًّا أنه لعقار واحد */}
                  <span className="ms-2 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-paper2 border border-line text-muted">
                    {x.property_ids?.length ? `${x.property_ids.length} عقارات مختارة`
                      : x.owner_name && !x.property_id ? "كل عقارات المالك" : "هذا العقار"}
                  </span>
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
                      <a className="btn btn-ghost text-xs" target="_blank" rel="noreferrer" href={waLink(ownerPhoneHint || "", waText(x.token))} onClick={(e) => { e.preventDefault(); openExternal(waLink(ownerPhoneHint || "", waText(x.token))); }}>واتساب</a>
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
