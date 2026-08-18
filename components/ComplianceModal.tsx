"use client";
/**
 * ⚖️ التزامات المكتب العقاري — عقود الوساطة · تراخيص الإعلانات · رخصة فال.
 *
 * لماذا هذه الشاشة: عقد الوساطة المنسي = عمولة ساقطة (م15 تمنح شهرين فقط
 * بعد الانتهاء بشرط إثبات الوساطة)، والإعلان بترخيص منتهٍ مخالفة،
 * والعمل برخصة فال منتهية مخالفة. هنا يراها المكتب كلها قبل فوات وقتها.
 *
 * مكوّن مستقل بحاله: يدير CRUD على جدول compliance_items بنفسه،
 * ويبلّغ الأب بالتغييرات عبر onChanged (لتحديث شارة التنبيهات فورًا).
 */
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { sar, today } from "@/lib/utils";
import {
  complianceState, brokerageEnd, commissionWindowEnd, expectedCommission,
  KIND_META, UI_LEGAL, LEGAL_DISCLAIMER, DEFAULT_COMMISSION_PCT,
  type ComplianceItem, type ComplianceKind,
} from "@/lib/compliance";
import { complianceRegisterHTML, openDoc, arDate } from "@/lib/documents";

type PropOpt = { id: string; name: string };

const TONE_CLS: Record<string, string> = {
  ok:    "bg-[#E6F4EC] text-[#137a50]",
  warn:  "bg-[#FBF1DF] text-[#8a5a11]",
  bad:   "bg-[#FBE9E7] text-[#a5322c]",
  muted: "bg-[#F1F5F9] text-[#475569]",
};

const DEAL_LABEL: Record<string, string> = { sale: "بيع", rent: "إيجار" };

export default function ComplianceModal({ initial, properties, orgName, issuer, onClose, onChanged }: {
  initial: ComplianceItem[];
  properties: PropOpt[];
  orgName: string;
  issuer: any;
  onClose: () => void;
  onChanged: (items: ComplianceItem[]) => void;
}) {
  const supabase = createClient();
  const [items, setItems] = useState<ComplianceItem[]>(initial || []);
  const [form, setForm] = useState<null | { kind: ComplianceKind; editing?: ComplianceItem }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { k: "ok" | "err"; m: string }>(null);

  function flash(k: "ok" | "err", m: string) {
    setMsg({ k, m });
    setTimeout(() => setMsg(null), 3500);
  }
  function commit(next: ComplianceItem[]) {
    setItems(next);
    onChanged(next);
  }

  const groups = useMemo(() => ({
    fal_license: items.filter((x) => x.kind === "fal_license"),
    brokerage:   items.filter((x) => x.kind === "brokerage"),
    ad_license:  items.filter((x) => x.kind === "ad_license"),
  }), [items]);

  const alerts = useMemo(
    () => items.map((it) => ({ it, st: complianceState(it) })).filter((x) => x.st.alert),
    [items],
  );

  async function save(d: Partial<ComplianceItem>, editing?: ComplianceItem) {
    setBusy(true);
    try {
      if (editing) {
        const { data, error } = await supabase.from("compliance_items")
          .update(d).eq("id", editing.id).select("*").single();
        if (error) throw error;
        commit(items.map((x) => (x.id === editing.id ? (data as ComplianceItem) : x)));
        flash("ok", "تم حفظ التعديل");
      } else {
        const uid = (await supabase.auth.getUser()).data.user?.id;
        if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول مجددًا");
        const { data, error } = await supabase.from("compliance_items")
          .insert({ ...d, user_id: uid }).select("*").single();
        if (error) throw error;
        commit([data as ComplianceItem, ...items]);
        flash("ok", "أُضيف البند");
      }
      setForm(null);
    } catch (e: any) {
      const t = String(e?.message || e);
      flash("err", /compliance_items/.test(t) && /not (exist|found)|relation/i.test(t)
        ? "شغّل ملف schema-v6.sql في Supabase أولًا ثم أعد المحاولة"
        : t);
    } finally { setBusy(false); }
  }

  async function setStatus(it: ComplianceItem, status: "active" | "closed") {
    const { error } = await supabase.from("compliance_items").update({ status }).eq("id", it.id);
    if (error) return flash("err", error.message);
    commit(items.map((x) => (x.id === it.id ? { ...x, status } : x)));
  }

  async function remove(it: ComplianceItem) {
    if (!confirm(`حذف «${it.title}» نهائيًّا؟`)) return;
    const { error } = await supabase.from("compliance_items").delete().eq("id", it.id);
    if (error) return flash("err", error.message);
    commit(items.filter((x) => x.id !== it.id));
  }

  function printRegister() {
    openDoc(complianceRegisterHTML(items, orgName, issuer || {}));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display font-bold text-deep text-xl">⚖️ التزامات المكتب العقاري</h2>
            <p className="text-sm text-muted mt-1">
              عقد الوساطة المنسي عمولة ساقطة، والإعلان بترخيص منتهٍ مخالفة — سجّلها هنا لتصلك التنبيهات في وقتها.
            </p>
          </div>
          <div className="flex gap-2">
            {items.length > 0 && (
              <button className="btn btn-ghost text-xs" onClick={printRegister}
                title="نسخة مطبوعة لملف المكتب بكل البنود وحالاتها">🖨️ طباعة السجل</button>
            )}
            <button className="btn btn-ghost text-xs" onClick={onClose}>إغلاق</button>
          </div>
        </div>

        {msg && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
            msg.k === "ok" ? "bg-[#E6F4EC] border-[#B7DFC7] text-[#137a50]" : "bg-[#FBE9E7] border-[#F5C6C2] text-[#8f2b26]"}`}>
            {msg.m}
          </div>
        )}

        {/* شريط التنبيهات: ما يستحق فعلًا الآن */}
        {alerts.length > 0 && !form && (
          <div className="mt-4 rounded-xl border border-[#EBD9AA] bg-[#FBF1DF] p-3">
            <div className="text-sm font-bold text-[#8a5a11] mb-1.5">🔔 يستحق انتباهك ({alerts.length})</div>
            <div className="space-y-1">
              {alerts.map(({ it, st }) => (
                <div key={it.id} className="text-xs text-[#6b4a10] flex items-center gap-1.5">
                  <span>{KIND_META[it.kind].icon}</span>
                  <b className="truncate">{it.title}</b>
                  <span className="text-[#8a5a11]">— {st.label}{st.endDate ? ` (${st.endDate})` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {form ? (
          <ItemForm kind={form.kind} editing={form.editing} properties={properties} busy={busy}
            onCancel={() => setForm(null)} onSave={(d) => save(d, form.editing)} />
        ) : (
          <>
            <Section kind="fal_license" items={groups.fal_license} properties={properties}
              empty="سجّل رخصتك ليصلك تنبيه قبل انتهائها بثلاثين يومًا — العمل برخصة منتهية مخالفة."
              onAdd={() => setForm({ kind: "fal_license" })}
              onEdit={(it) => setForm({ kind: it.kind, editing: it })}
              onStatus={setStatus} onRemove={remove} />

            <Section kind="brokerage" items={groups.brokerage} properties={properties}
              empty="سجّل كل عقد وساطة بتاريخه — إن لم تُحدَّد مدته فهي 90 يومًا نظامًا، وبعد الانتهاء لك شهران فقط لإثبات وساطتك."
              onAdd={() => setForm({ kind: "brokerage" })}
              onEdit={(it) => setForm({ kind: it.kind, editing: it })}
              onStatus={setStatus} onRemove={remove} />

            <Section kind="ad_license" items={groups.ad_license} properties={properties}
              empty="لكل إعلان ترخيص مستقل بتاريخ انتهاء — سجّله ليصلك تنبيه قبل أن يتحوّل إعلانك إلى مخالفة."
              onAdd={() => setForm({ kind: "ad_license" })}
              onEdit={(it) => setForm({ kind: it.kind, editing: it })}
              onStatus={setStatus} onRemove={remove} />

            <details className="mt-5 rounded-xl border border-line bg-paper p-3">
              <summary className="cursor-pointer text-sm font-semibold text-deep">الحدود النظامية — استرشاديًّا</summary>
              <ul className="mt-2 space-y-1.5 text-xs text-[#33413d] list-disc pr-5">
                {UI_LEGAL.map((x) => <li key={x.ref}><b>{x.ref}:</b> {x.text}</li>)}
              </ul>
              <p className="text-[.7rem] text-muted mt-2">{LEGAL_DISCLAIMER}</p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────── قسم نوع واحد ──────────────────────── */

function Section({ kind, items, properties, empty, onAdd, onEdit, onStatus, onRemove }: {
  kind: ComplianceKind; items: ComplianceItem[]; properties: PropOpt[]; empty: string;
  onAdd: () => void; onEdit: (it: ComplianceItem) => void;
  onStatus: (it: ComplianceItem, s: "active" | "closed") => void; onRemove: (it: ComplianceItem) => void;
}) {
  const meta = KIND_META[kind];
  const propName = (id?: string | null) => properties.find((p) => p.id === id)?.name || null;
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-deep text-sm">{meta.icon} {meta.label} {items.length ? `(${items.length})` : ""}</h3>
        <button className="btn btn-gold text-xs" onClick={onAdd}>+ {meta.one}</button>
      </div>

      {!items.length ? (
        <p className="text-xs text-muted mt-2 bg-paper border border-line rounded-lg p-2.5">{empty}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {items.map((it) => {
            const st = complianceState(it);
            const closed = st.phase === "closed";
            const fee = kind === "brokerage" ? expectedCommission(it) : 0;
            return (
              <div key={it.id} className={`rounded-xl border p-3 ${closed ? "border-line bg-[#F8FAFC] opacity-75" : "border-line bg-paper"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">
                      {it.title}
                      {it.exclusive && kind === "brokerage" && <span className="text-[.65rem] font-bold text-[#5B21B6] bg-[#F1EBFC] rounded px-1.5 py-0.5 mr-1.5">حصري</span>}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {[
                        kind === "brokerage" && it.party ? `المالك: ${it.party}` : null,
                        kind === "brokerage" && it.deal_type ? DEAL_LABEL[it.deal_type] : null,
                        kind === "ad_license" && it.platform ? it.platform : null,
                        it.ref_no ? `رقم ${it.ref_no}` : null,
                        propName(it.property_id) ? `عقار: ${propName(it.property_id)}` : null,
                        st.endDate ? `حتى ${arDate(st.endDate)}${st.endDerived ? " (مستنتج 90 يومًا)" : ""}` : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </div>
                    {kind === "brokerage" && st.windowEnd && !closed && (
                      <div className="text-[.7rem] mt-0.5 text-[#5B21B6]">
                        نافذة استحقاق العمولة حتى {arDate(st.windowEnd)}{fee ? <> · متوقعة <b>{sar(fee)}</b> ريال</> : null}
                      </div>
                    )}
                  </div>
                  <span className={`self-start sm:self-center shrink-0 text-[.7rem] font-bold rounded-lg px-2 py-1 ${TONE_CLS[st.tone]}`}>{st.label}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-end mt-2">
                  <button className="btn btn-ghost text-xs" onClick={() => onEdit(it)}>تعديل</button>
                  {closed
                    ? <button className="btn btn-ghost text-xs" onClick={() => onStatus(it, "active")}>إعادة فتح</button>
                    : <button className="btn btn-ghost text-xs" onClick={() => onStatus(it, "closed")}
                        title={kind === "brokerage" ? "أُتمّت الصفقة أو انتهى التعامل — يخرج من التنبيهات" : "انتهى التعامل — يخرج من التنبيهات"}>
                        {kind === "brokerage" ? "✓ أُنجزت/أُغلق" : "✓ إغلاق"}</button>}
                  <button className="btn btn-ghost text-xs text-late" onClick={() => onRemove(it)}>حذف</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────── نموذج إضافة/تعديل ──────────────────────── */

function ItemForm({ kind, editing, properties, busy, onSave, onCancel }: {
  kind: ComplianceKind; editing?: ComplianceItem; properties: PropOpt[]; busy: boolean;
  onSave: (d: Partial<ComplianceItem>) => void; onCancel: () => void;
}) {
  const meta = KIND_META[kind];
  const [d, setD] = useState<any>(() => editing ? {
    title: editing.title || "", ref_no: editing.ref_no || "", party: editing.party || "",
    deal_type: editing.deal_type || "sale", exclusive: !!editing.exclusive,
    platform: editing.platform || "", property_id: editing.property_id || "",
    start_date: editing.start_date || "", end_date: editing.end_date || "",
    commission_pct: editing.commission_pct ?? "", amount: editing.amount ?? "", note: editing.note || "",
  } : {
    title: kind === "fal_license" ? "رخصة فال للوساطة والتسويق" : "",
    ref_no: "", party: "", deal_type: "sale", exclusive: false, platform: "", property_id: "",
    start_date: kind === "brokerage" ? today() : "", end_date: "",
    commission_pct: "", amount: "", note: "",
  });

  // معاينة حيّة لعقد الوساطة: النهاية المستنتجة + نافذة العمولة + العمولة المتوقعة
  const preview = useMemo(() => {
    if (kind !== "brokerage" || !d.start_date) return null;
    const be = brokerageEnd({ start_date: d.start_date, end_date: d.end_date || null });
    if (!be.end) return null;
    return {
      end: be.end, derived: be.derived,
      windowEnd: commissionWindowEnd(be.end),
      fee: expectedCommission({ amount: Number(d.amount) || 0, commission_pct: Number(d.commission_pct) || 0 }),
    };
  }, [kind, d.start_date, d.end_date, d.amount, d.commission_pct]);

  const ready = String(d.title || "").trim().length > 0
    && (kind === "brokerage" ? !!d.start_date : !!d.end_date);

  function submit() {
    const payload: Partial<ComplianceItem> = {
      kind,
      title: String(d.title).trim(),
      ref_no: String(d.ref_no || "").trim() || null,
      start_date: d.start_date || null,
      end_date: d.end_date || null,
      note: String(d.note || "").trim() || null,
      property_id: d.property_id || null,
      party: null, deal_type: null, exclusive: false, platform: null, commission_pct: null, amount: null,
    };
    if (kind === "brokerage") {
      payload.party = String(d.party || "").trim() || null;
      payload.deal_type = d.deal_type === "rent" ? "rent" : "sale";
      payload.exclusive = !!d.exclusive;
      payload.commission_pct = Number(d.commission_pct) > 0 ? Number(d.commission_pct) : null;
      payload.amount = Number(d.amount) > 0 ? Number(d.amount) : null;
    }
    if (kind === "ad_license") payload.platform = String(d.platform || "").trim() || null;
    if (kind === "fal_license") payload.property_id = null; // رخصة المكتب لا تخص عقارًا
    onSave(payload);
  }

  return (
    <div className="mt-4">
      <h3 className="font-semibold text-deep mb-3">{meta.icon} {editing ? `تعديل ${meta.one}` : `${meta.one} جديد`}</h3>
      <div className="space-y-3">

        <F label={kind === "brokerage" ? "وصف العقد" : kind === "ad_license" ? "وصف الإعلان" : "اسم الرخصة"}>
          <input className="fld" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })}
            placeholder={kind === "brokerage" ? "وساطة بيع — فيلا حي النرجس" : kind === "ad_license" ? "إعلان شقة 12 — منصة عقار" : "رخصة فال للوساطة والتسويق"} />
        </F>

        {kind === "brokerage" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <F label="المالك (الطرف الآخر)"><input className="fld" value={d.party} onChange={(e) => setD({ ...d, party: e.target.value })} /></F>
              <F label="نوع الصفقة">
                <div className="grid grid-cols-2 gap-2">
                  {(["sale", "rent"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setD({ ...d, deal_type: k })}
                      className={`border-2 rounded-lg py-2 text-xs font-semibold transition ${
                        d.deal_type === k ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                      {DEAL_LABEL[k]}
                    </button>
                  ))}
                </div>
              </F>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!d.exclusive} onChange={(e) => setD({ ...d, exclusive: e.target.checked })} />
              <span>عقد حصري <span className="text-muted text-xs">— بدونه يجوز للمالك التعاقد مع وسطاء آخرين (م8)</span></span>
            </label>
          </>
        )}

        {kind === "ad_license" && (
          <F label="المنصة / الوسيلة">
            <input className="fld" value={d.platform} onChange={(e) => setD({ ...d, platform: e.target.value })} placeholder="منصة عقار، X، لوحة طريق…" />
          </F>
        )}

        <div className="grid grid-cols-2 gap-3">
          <F label={kind === "brokerage" ? "رقم إيداع العقد لدى الهيئة" : kind === "ad_license" ? "رقم ترخيص الإعلان" : "رقم الرخصة"} hint="اختياري">
            <input className="fld" value={d.ref_no} onChange={(e) => setD({ ...d, ref_no: e.target.value })} />
          </F>
          {kind !== "fal_license" && (
            <F label="العقار المرتبط" hint="اختياري">
              <select className="fld" value={d.property_id} onChange={(e) => setD({ ...d, property_id: e.target.value })}>
                <option value="">— بلا ربط —</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </F>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <F label={kind === "brokerage" ? "تاريخ الإبرام" : "تاريخ البداية"}>
            <input className="fld" type="date" value={d.start_date} onChange={(e) => setD({ ...d, start_date: e.target.value })} />
          </F>
          <F label="تاريخ الانتهاء" hint={kind === "brokerage" ? "اتركه فارغًا = 90 يومًا نظامًا" : undefined}>
            <input className="fld" type="date" value={d.end_date} onChange={(e) => setD({ ...d, end_date: e.target.value })} />
          </F>
        </div>

        {kind === "brokerage" && (
          <div className="grid grid-cols-2 gap-3">
            <F label={d.deal_type === "rent" ? "إيجار السنة الأولى (ريال)" : "قيمة الصفقة (ريال)"} hint="اختياري — لحساب العمولة">
              <input className="fld" type="number" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} placeholder="850000" />
            </F>
            <F label="نسبة العمولة %" hint={`النظامي ${DEFAULT_COMMISSION_PCT}% ما لم يُتفق كتابةً`}>
              <input className="fld" type="number" step="0.1" value={d.commission_pct}
                onChange={(e) => setD({ ...d, commission_pct: e.target.value })} placeholder={String(DEFAULT_COMMISSION_PCT)} />
            </F>
          </div>
        )}

        <F label="ملاحظة" hint="اختياري">
          <input className="fld" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
        </F>

        {preview && (
          <div className="bg-paper border border-line rounded-xl p-3 text-xs text-[#33413d] space-y-1">
            <div className="font-semibold text-deep text-sm">ما يعنيه هذا نظامًا</div>
            <div>نهاية مدة العقد: <b>{arDate(preview.end)}</b>{preview.derived ? " — مستنتجة (90 يومًا، م7)" : ""}</div>
            <div>آخر يوم في نافذة استحقاق العمولة: <b>{arDate(preview.windowEnd)}</b> — بعده تسقط ما لم تكن الصفقة أُتمّت أثناء السريان (م15)</div>
            {preview.fee > 0 && <div>العمولة المتوقعة: <b>{sar(preview.fee)}</b> ريال{d.deal_type === "rent" ? " — من إيجار السنة الأولى فقط (م14)" : ""}</div>}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button className="btn btn-ghost text-sm" onClick={onCancel} disabled={busy}>رجوع</button>
          <button className="btn btn-gold text-sm" onClick={submit} disabled={!ready || busy}>
            {busy ? "…" : editing ? "حفظ التعديل" : "إضافة"}
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
