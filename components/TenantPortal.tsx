"use client";
/**
 * 🔑 رابط المستأجر (schema-v70) — واجهة المكتب:
 *  • TenantLinkModal: إنشاء رابط الوحدة وإرساله واتساب، إخفاء المتأخر، الإبطال.
 *  • TenantPortalInbox: حوالات المستأجرين بانتظار المراجعة وطلبات الصيانة المفتوحة
 *    لكل عقارات المكتب — الاعتماد يفتح نافذة «تسجيل مبلغ مستلم» المعتادة بحرّاسها.
 * كل كتابة عبر دوال القاعدة (صلاحية المكتب داخلها) — لا كتابة مباشرة على الجداول.
 */
import { useEffect, useState } from "react";
import { waLink, openExternal, sar } from "@/lib/utils";
import { REQUEST_CATEGORIES, TENANT_REQUEST_STATUS_AR as REQUEST_STATUS_AR, requestCatAr } from "@/lib/hoaMoney";

const NEEDS_V70 = /watheq_tenant|tenant_portal|tenant_payment_claims|tenant_requests|does not exist|schema cache|Could not find/i;
const friendly = (m: string) =>
  /not authorized/i.test(m) ? "هذا الإجراء يحتاج صلاحية «تسجيل الدفعات» — اطلبه من صاحب المكتب."
  : NEEDS_V70.test(m) && /does not exist|schema cache|Could not find/i.test(m) ? "رابط المستأجر يحتاج تحديث قاعدة البيانات (schema-v70)."
  : m;

const riyadhDate = (ts?: string | null) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

function Overlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} bg-white rounded-2xl shadow-xl p-5 sm:p-6 max-h-[92vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ─── رابط الوحدة ─────────────────────────────────────────────────
export function TenantLinkModal({ tenant, propertyName, unitWord, orgName, db, demo = false, onClose }: {
  tenant: { id: string; name: string; unit: string | null; phone: string | null };
  propertyName: string; unitWord: string; orgName?: string | null;
  db: any; demo?: boolean; onClose: () => void;
}) {
  const [link, setLink] = useState<null | { token: string; show_balance: boolean; last_seen_at: string | null }>(null);
  const [state, setState] = useState<"loading" | "ready" | "revoked" | "error">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = link ? `${origin}/r/t/${link.token}` : "";

  async function load() {
    setState("loading"); setErr("");
    const { data, error } = await db.rpc("watheq_tenant_link_get_or_create", { p_tenant: tenant.id });
    if (error || !data?.token) { setErr(friendly(String(error?.message || "تعذّر إنشاء الرابط"))); setState("error"); return; }
    setLink({ token: data.token, show_balance: data.show_balance !== false, last_seen_at: data.last_seen_at || null });
    setState("ready");
  }
  useEffect(() => { if (!demo) void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.id]);

  const waText = () => [`السلام عليكم ${tenant.name}،`, "",
    `هذه صفحتك الخاصة لعقد ${unitWord} (${tenant.unit || "—"}) في ${propertyName}: الدفعة القادمة وسجل دفعاتك، ومنها تبلّغنا عن حوالتك أو عن أي عطل.`,
    url, "", "الرابط خاص بك — لا تشاركه.", orgName ? orgName : ""].filter((x, i, a) => !(x === "" && i === a.length - 1)).join("\n");

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("انسخ الرابط:", url); }
  }
  async function toggleBalance(show: boolean) {
    if (!link) return;
    setBusy(true);
    const { error } = await db.rpc("watheq_tenant_link_set_balance", { p_tenant: tenant.id, p_show: show });
    setBusy(false);
    if (error) { setErr(friendly(String(error.message || ""))); return; }
    setErr(""); setLink({ ...link, show_balance: show });
  }
  async function revoke() {
    if (!confirm(`إبطال رابط ${tenant.name}؟\n\nالرابط الحالي يتوقف فورًا. تستطيع إنشاء رابط جديد بعده.`)) return;
    setBusy(true);
    const { error } = await db.rpc("watheq_tenant_link_revoke", { p_tenant: tenant.id });
    setBusy(false);
    if (error) { setErr(friendly(String(error.message || ""))); return; }
    setLink(null); setState("revoked");
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-deep text-lg">🔑 رابط المستأجر</h2>
          <p className="text-sm text-muted mt-0.5">{tenant.name} · {unitWord} {tenant.unit || "—"} · {propertyName}</p>
        </div>
        <button className="btn btn-ghost text-xs" onClick={onClose}>إغلاق</button>
      </div>
      <p className="text-[12.5px] text-muted mt-3 leading-relaxed">
        صفحة خاصة بلا حساب: يرى فيها المستأجر عقده والدفعة القادمة وسجل دفعاته، ويبلّغك عن حوالته أو عن عطل — ويصلك تنبيه تليجرام فوري.
        لا تظهر فيها هويته ولا ملاحظاتك. يتوقف الرابط تلقائيًّا عند الإخلاء أو تغيير اسم المستأجر.
      </p>

      {demo ? (
        <div className="mt-4 rounded-xl border border-line bg-paper2 p-3 text-sm">في المكتب التجريبي لا يُنشأ رابط حقيقي — جرّبه على وحداتك بعد البدء ببياناتك.</div>
      ) : state === "loading" ? (
        <div className="mt-4 text-sm text-muted">جارٍ تجهيز الرابط…</div>
      ) : state === "error" ? (
        <div className="mt-4 rounded-lg border border-[#F5C6C2] bg-[#FBE9E7] text-[#8f2b26] px-3 py-2 text-sm font-semibold">{err}</div>
      ) : state === "revoked" ? (
        <div className="mt-4">
          <div className="rounded-lg border border-[#B7DFC7] bg-[#E6F4EC] text-[#137a50] px-3 py-2 text-sm font-semibold">أُبطل الرابط — لم يعد يفتح.</div>
          <button className="btn btn-gold text-sm mt-3" onClick={() => void load()}>+ إنشاء رابط جديد</button>
        </div>
      ) : link && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-line bg-paper2 p-3">
            <div dir="ltr" className="text-[12px] font-mono break-all text-deep select-all">{url}</div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="btn btn-ghost text-xs" onClick={copy}>{copied ? "نُسخ ✓" : "📋 نسخ"}</button>
              <a className="btn btn-wa text-xs" href={waLink(tenant.phone || "", waText())} target="_blank" rel="noreferrer"
                onClick={(e) => { e.preventDefault(); openExternal(waLink(tenant.phone || "", waText())); }}>💬 إرسال واتساب</a>
              <a className="btn btn-ghost text-xs" href={url} target="_blank" rel="noreferrer">معاينة</a>
            </div>
            <div className="text-[11.5px] text-muted mt-2">{link.last_seen_at ? `فتحه المستأجر آخر مرة ${riyadhDate(link.last_seen_at)}` : "لم يُفتح بعد"}</div>
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg border border-line px-3 py-2.5">
            <input type="checkbox" className="mt-1" checked={link.show_balance} disabled={busy} onChange={(e) => void toggleBalance(e.target.checked)} />
            <span><b>يرى المستأجر المتأخر عليه</b><br /><span className="text-[12px] text-muted">أزل العلامة لإخفاء المستحق وكشف الحساب من صفحته (تبقى الدفعة القادمة وسجل الدفعات).</span></span>
          </label>
          {err && <div className="rounded-lg border border-[#F5C6C2] bg-[#FBE9E7] text-[#8f2b26] px-3 py-2 text-sm font-semibold">{err}</div>}
          <button className="btn btn-ghost text-xs text-late" disabled={busy} onClick={revoke}>إبطال الرابط</button>
        </div>
      )}
    </Overlay>
  );
}

// ─── صندوق البلاغات ─────────────────────────────────────────────
export type TenantClaim = {
  id: string; property_id: string; tenant_id: string | null; tenant_name: string | null; unit: string | null;
  amount: number; transfer_date: string; bank_ref: string | null; note: string | null; created_at: string;
};
type TenantReq = {
  id: string; property_id: string; tenant_id: string | null; tenant_name: string | null; unit: string | null;
  category: string; location: string; description: string; status: "new" | "in_progress" | "done" | "rejected";
  manager_note: string | null; created_at: string;
};

export function TenantPortalInbox({ db, enabled, propertyName, canDecide, canEditReq, onApprove, reloadKey, notify }: {
  db: any; enabled: boolean;
  propertyName: (id: string) => string;
  canDecide: boolean; canEditReq: boolean;
  onApprove: (c: TenantClaim) => void;
  reloadKey: number;
  notify: (k: "ok" | "err", m: string) => void;
}) {
  const [claims, setClaims] = useState<TenantClaim[]>([]);
  const [reqs, setReqs] = useState<TenantReq[]>([]);
  const [open, setOpen] = useState<null | "claims" | "reqs">(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState<Record<string, { status: string; note: string }>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!enabled) return;
    const [c, r] = await Promise.all([
      db.from("tenant_payment_claims").select("id,property_id,tenant_id,tenant_name,unit,amount,transfer_date,bank_ref,note,created_at")
        .eq("status", "pending").order("created_at", { ascending: true }).limit(200),
      db.from("tenant_requests").select("id,property_id,tenant_id,tenant_name,unit,category,location,description,status,manager_note,created_at")
        .in("status", ["new", "in_progress"]).order("created_at", { ascending: true }).limit(300),
    ]);
    /* قبل تطبيق schema-v70 ترجع خطأً — يبقى الصندوق مخفيًّا بهدوء */
    setClaims(c?.error ? [] : ((c?.data || []) as TenantClaim[]));
    setReqs(r?.error ? [] : ((r?.data || []) as TenantReq[]));
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reloadKey]);

  async function reject(c: TenantClaim) {
    const rs = reason.trim();
    if (rs.length < 3) return notify("err", "اكتب سبب الرفض (3 أحرف على الأقل) — يظهر للمستأجر.");
    setBusy(true);
    const { error } = await db.rpc("watheq_tenant_claim_reject", { p_claim: c.id, p_reason: rs });
    setBusy(false);
    if (error) return notify("err", friendly(String(error.message || "")));
    setRejecting(null); setReason("");
    notify("ok", "رُفض البلاغ — يرى المستأجر السبب في صفحته.");
    void load();
  }
  async function saveReq(r: TenantReq) {
    const e = edit[r.id] || { status: r.status, note: "" };
    if (e.status === r.status && !e.note.trim()) return;
    setBusy(true);
    const { error } = await db.rpc("watheq_tenant_request_set_status", { p_request: r.id, p_status: e.status, p_note: e.note.trim() || null });
    setBusy(false);
    if (error) return notify("err", friendly(String(error.message || "")));
    notify("ok", `حُدّث الطلب: ${REQUEST_STATUS_AR[e.status] || e.status} — يراه المستأجر في صفحته.`);
    setEdit((x) => { const n = { ...x }; delete n[r.id]; return n; });
    void load();
  }

  if (!enabled || (!claims.length && !reqs.length && !open)) return null;
  const where = (x: { property_id: string; unit: string | null; tenant_name: string | null }) =>
    `${x.tenant_name || "—"} · ${x.unit ? `وحدة ${x.unit}` : "—"} · ${propertyName(x.property_id)}`;

  return (
    <>
      <div className="rounded-2xl border border-[#E7C877] bg-[#FFFBF0] px-4 py-3 mb-4 flex flex-wrap items-center gap-2" data-testid="tenant-inbox">
        <b className="text-deep text-sm me-1">📨 من روابط المستأجرين:</b>
        {claims.length > 0 && <button className="btn btn-gold text-xs" onClick={() => setOpen("claims")}>💳 حوالات بانتظار المراجعة ({claims.length})</button>}
        {reqs.length > 0 && <button className="btn btn-ghost text-xs" onClick={() => setOpen("reqs")}>🛠 طلبات صيانة مفتوحة ({reqs.length})</button>}
      </div>

      {open && (
        <Overlay wide onClose={() => { setOpen(null); setRejecting(null); }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-2 flex-wrap">
              <button className={`btn text-xs ${open === "claims" ? "btn-gold" : "btn-ghost"}`} onClick={() => setOpen("claims")}>💳 الحوالات ({claims.length})</button>
              <button className={`btn text-xs ${open === "reqs" ? "btn-gold" : "btn-ghost"}`} onClick={() => setOpen("reqs")}>🛠 الصيانة ({reqs.length})</button>
            </div>
            <button className="btn btn-ghost text-xs" onClick={() => { setOpen(null); setRejecting(null); }}>إغلاق</button>
          </div>

          {open === "claims" ? (
            <div className="mt-4 space-y-3">
              <p className="text-[12.5px] text-muted">طابق كل بلاغ مع كشف البنك. «اعتماد» يفتح نافذة تسجيل المبلغ المعتادة بالمبلغ والتاريخ والمرجع — راجعها ثم سجّل.</p>
              {!claims.length && <div className="text-sm text-muted">لا حوالات بانتظار المراجعة ✓</div>}
              {claims.map((c) => (
                <div key={c.id} className="rounded-xl border border-line p-3">
                  <div className="flex justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-bold text-deep tabular-nums">{sar(Number(c.amount))} ريال</div>
                      <div className="text-xs text-muted">{where(c)}</div>
                      <div className="text-xs text-muted mt-0.5">حوالة <bdi dir="ltr">{c.transfer_date}</bdi>{c.bank_ref ? <> · مرجع <bdi dir="ltr">{c.bank_ref}</bdi></> : null} · أُبلغ {riyadhDate(c.created_at)}</div>
                      {c.note && <div className="text-xs mt-1">ملاحظة المستأجر: {c.note}</div>}
                    </div>
                    {canDecide && (
                      <div className="flex gap-2 items-start">
                        <button className="btn btn-gold text-xs" disabled={busy || !c.tenant_id} onClick={() => { setOpen(null); onApprove(c); }}>اعتماد وتسجيل</button>
                        <button className="btn btn-ghost text-xs text-late" disabled={busy} onClick={() => { setRejecting(rejecting === c.id ? null : c.id); setReason(""); }}>رفض</button>
                      </div>
                    )}
                  </div>
                  {rejecting === c.id && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <input className="fld flex-1 min-w-[180px] text-sm" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
                        placeholder="سبب الرفض — يظهر للمستأجر (مثال: لم تصل الحوالة)" autoFocus />
                      <button className="btn text-xs bg-late text-white" disabled={busy} onClick={() => void reject(c)}>تأكيد الرفض</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {!reqs.length && <div className="text-sm text-muted">لا طلبات مفتوحة ✓</div>}
              {reqs.map((r) => {
                const e = edit[r.id] || { status: r.status, note: "" };
                return (
                  <div key={r.id} className="rounded-xl border border-line p-3">
                    <div className="flex justify-between gap-2">
                      <b className="text-deep text-sm">{requestCatAr(r.category)} <span className="text-muted font-normal">· {r.location === "unit" ? "داخل الوحدة" : "الأجزاء المشتركة"}</span></b>
                      <span className="text-[11px] rounded-full px-2 py-0.5 bg-[#FDF0DC] text-[#9A5B00] whitespace-nowrap h-fit">{REQUEST_STATUS_AR[r.status]}</span>
                    </div>
                    <div className="text-xs text-muted">{where(r)} · فُتح {riyadhDate(r.created_at)}</div>
                    <div className="text-sm mt-1.5 whitespace-pre-wrap break-words">{r.description}</div>
                    {r.manager_note && <div className="text-xs mt-1 text-muted">ردّك السابق: {r.manager_note}</div>}
                    {canEditReq && (
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-[150px_1fr_auto] gap-2">
                        <select className="fld text-sm" value={e.status} onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, status: ev.target.value } })}>
                          {(["new", "in_progress", "done", "rejected"] as const).map((s) => <option key={s} value={s}>{REQUEST_STATUS_AR[s]}</option>)}
                        </select>
                        <input className="fld text-sm" maxLength={500} value={e.note} placeholder={e.status === "rejected" ? "سبب الرفض — يظهر للمستأجر" : e.status === "in_progress" ? "مثال: الفني يزوركم الأحد (اختياري)" : e.status === "done" ? "مثال: تم تغيير الخلاط (اختياري)" : "ردّ للمستأجر (اختياري)"}
                          onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, note: ev.target.value } })} />
                        <button className="btn btn-primary text-xs" disabled={busy || (e.status === r.status && !e.note.trim())} onClick={() => void saveReq(r)}>حفظ</button>
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="text-[11.5px] text-muted">الطلبات المُنجزة والمرفوضة تختفي من هنا وتبقى في صفحة المستأجر بحالتها.</p>
            </div>
          )}
        </Overlay>
      )}
    </>
  );
}

/** فئات الطلب (للاختبارات والعرض) */
export const TENANT_REQUEST_CATEGORIES = REQUEST_CATEGORIES;
