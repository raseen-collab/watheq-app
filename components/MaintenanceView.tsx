"use client";
/**
 * 🛠 قسم الصيانة (schema-v79، 5 نوفمبر 2026)
 *
 * كان الطلب يظهر فقط في شريط أعلى لوحة العقار ويختفي بعد إنجازه، بلا أولوية
 * ولا فني ولا تكلفة. هنا صفحة كاملة: فلاتر وبحث، أولوية «عاجل»، الفني وموعده،
 * صور قبل/بعد، تكلفة تُسجَّل مصروفًا فتدخل صافي المالك، وواتساب للمستأجر والفني.
 *
 * كل كتابة على الطلب عبر دوال القاعدة (الصلاحية داخلها). المصروف يُسجَّل
 * بالإدخال العادي فيمرّ بسياسة manage_expenses وسند الصرف كأي مصروف.
 */
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { createClient } from "@/lib/supabase-client";
import { getOffice, OWNER_PERMS } from "@/lib/office";
import { waLink, openExternal, sar, today as todayStr } from "@/lib/utils";
import { REQUEST_CATEGORIES, requestCatAr, requestLocAr } from "@/lib/hoaMoney";
import { compressImage } from "@/components/ListingPhotos";
import {
  type MaintRequest, type MaintFilter, type MaintStatus, DEFAULT_FILTER, STATUS_META, catIcon, isOpen, isUrgent,
  isLate, ageDays, agePhrase, matchesFilter, sortRequests, counts, shortDate, tenantUpdateText, techText,
  expenseNote, photoDir, PHOTO_BUCKET, MAX_PHOTOS_PER_SIDE,
} from "@/lib/maintenance";

type Prop = { id: string; name: string };
type Tenant = { id: string; property_id: string; name: string; unit: string | null; phone: string | null; status?: string | null };
type LogRow = { action: string; detail: any; created_at: string };

const NEEDS = /does not exist|schema cache|Could not find/i;
function friendly(e: any): string {
  const m = String(e?.message || e || "");
  if (/not authorized|row-level security|violates/i.test(m)) return "هذا الإجراء يحتاج صلاحية أعلى — اطلبه من صاحب المكتب.";
  if (/watheq_tenant_request_(create|update|link_expense)|maintenance-photos|bucket/i.test(m) && /not.*found|does not exist|Could not find/i.test(m))
    return "هذه الميزة تحتاج تحديث قاعدة البيانات (schema-v79-maintenance.sql).";
  if (NEEDS.test(m) && /tenant_requests|tenant_portal/i.test(m)) return "قسم الصيانة يحتاج تحديث قاعدة البيانات (schema-v70).";
  return m || "حدث خطأ — أعد المحاولة";
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/50 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 max-h-[92vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

const V70_COLS = "id,property_id,tenant_id,tenant_name,unit,category,location,description,status,manager_note,created_at,updated_at,closed_at";

export default function MaintenanceView({ orgName }: { orgName?: string | null }) {
  const db = useMemo(() => createClient(), []);
  const [office, setOffice] = useState<string | null>(null);
  const [perms, setPerms] = useState<Record<string, boolean>>(OWNER_PERMS);
  const [rows, setRows] = useState<MaintRequest[] | null>(null);
  const [props, setProps] = useState<Prop[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [v79, setV79] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [f, setF] = useState<MaintFilter>(DEFAULT_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState<MaintRequest | null>(null);
  const [toast, setToast] = useState<{ k: "ok" | "err"; m: string } | null>(null);
  const today = todayStr();

  const may = (k: string) => perms[k] !== false;
  const canWork = may("edit_units") || may("record_payments");
  const canExpense = may("manage_expenses");

  function notify(k: "ok" | "err", m: string) { setToast({ k, m }); setTimeout(() => setToast(null), 4500); }

  async function load() {
    setLoadErr(null);
    const o = await getOffice(db);
    if (!o) { setLoadErr("انتهت الجلسة — سجّل الدخول مجددًا"); setRows([]); return; }
    setOffice(o.officeId);
    setPerms(o.isOwner === false ? (o.perms || {}) : OWNER_PERMS);
    const [p, t] = await Promise.all([
      db.from("properties").select("id,name").order("name"),
      db.from("tenants").select("id,property_id,name,unit,phone,status").limit(5000),
    ]);
    setProps((p.data || []) as Prop[]);
    setTenants(((t.data || []) as Tenant[]).filter((x) => x.status !== "vacated"));
    let r = await db.from("tenant_requests").select("*").order("created_at", { ascending: false }).limit(600);
    if (!r.error && r.data && r.data.length && !("priority" in (r.data[0] as any))) setV79(false);
    if (r.error) {
      r = await db.from("tenant_requests").select(V70_COLS).order("created_at", { ascending: false }).limit(600) as any;
      setV79(false);
    }
    if (r.error) { setLoadErr(friendly(r.error)); setRows([]); return; }
    setRows((r.data || []) as MaintRequest[]);
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const propName = (id: string) => props.find((p) => p.id === id)?.name || "—";
  const tenantOf = (r: MaintRequest) => tenants.find((t) => t.id === r.tenant_id) || null;
  const list = useMemo(() => sortRequests((rows || []).filter((r) => matchesFilter(r, f, propName))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, f, props]);
  const c = counts(rows || [], today);
  const scoped = useMemo(() => (rows || []).filter((r) => !f.property || r.property_id === f.property), [rows, f.property]);
  const cs = counts(scoped, today);

  function patch(id: string, p: Partial<MaintRequest>) {
    setRows((rs) => (rs || []).map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  async function setStatus(r: MaintRequest, status: MaintStatus, note?: string | null) {
    const { data, error } = await db.rpc("watheq_tenant_request_set_status", { p_request: r.id, p_status: status, p_note: note?.trim() || null });
    if (error) { notify("err", friendly(error)); return false; }
    patch(r.id, { status, manager_note: (data as any)?.manager_note ?? r.manager_note,
      closed_at: status === "done" || status === "rejected" ? new Date().toISOString() : null, updated_at: new Date().toISOString() });
    return true;
  }

  async function quickStart(r: MaintRequest) {
    if (await setStatus(r, "in_progress")) notify("ok", "بدأ التنفيذ — يراه المستأجر في صفحته. أرسل له الموعد بواتساب من البطاقة.");
  }

  const filterChips: { v: MaintFilter["status"]; l: string; n: number }[] = [
    { v: "open", l: "المفتوحة", n: cs.open },
    { v: "new", l: "جديد", n: cs.fresh },
    { v: "in_progress", l: "قيد التنفيذ", n: cs.working },
    { v: "done", l: "أُنجز", n: cs.done },
    { v: "all", l: "الكل", n: cs.all },
  ];

  return (
    <div className="max-w-5xl mx-auto" data-testid="maintenance">
      {/* الرأس */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="font-display font-bold text-deep text-2xl inline-flex items-center gap-2"><Icon name="wrench" size={24} /> الصيانة</h1>
          <p className="text-sm text-muted mt-1">طلبات المستأجرين من روابطهم وما يسجّله المكتب — من البلاغ حتى التكلفة في تقرير المالك.</p>
        </div>
        {canWork && v79 && (
          <button className="btn btn-gold" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> طلب جديد</button>
        )}
      </div>

      {!v79 && (
        <div className="mb-4 rounded-xl border border-[#EAD9A8] bg-[#FDF6E3] text-[#7a5c12] text-sm p-3 leading-relaxed">
          الأولوية والفني والتكلفة والصور تعمل بعد تشغيل <b dir="ltr">schema-v79-maintenance.sql</b> في Supabase. الطلبات وحالاتها تعمل الآن.
        </div>
      )}
      {loadErr && <div className="mb-4 rounded-xl border border-[#F5C6C2] bg-[#FBE9E7] text-[#8f2b26] text-sm p-3">{loadErr}</div>}

      {/* الأرقام */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {[
          { l: "مفتوحة", n: c.open, cls: "text-deep", on: () => setF({ ...f, status: "open", urgentOnly: false }) },
          { l: "عاجلة", n: c.urgent, cls: c.urgent ? "text-late" : "text-deep", on: () => setF({ ...f, status: "open", urgentOnly: true }) },
          { l: "متأخرة", n: c.late, cls: c.late ? "text-late" : "text-deep", on: () => setF({ ...f, status: "open", urgentOnly: false }) },
          { l: "أُنجزت", n: c.done, cls: "text-paid", on: () => setF({ ...f, status: "done", urgentOnly: false }) },
        ].map((k) => (
          <button key={k.l} onClick={k.on} className="text-start rounded-2xl bg-white border border-line px-4 py-3 hover:border-goldSoft transition">
            <div className={`font-display font-bold text-2xl tabular-nums ${k.cls}`}>{rows ? k.n : "…"}</div>
            <div className="text-xs text-muted">{k.l}</div>
          </button>
        ))}
      </div>

      {/* الفلاتر */}
      <div className="rounded-2xl bg-white border border-line p-3 mb-4 space-y-2.5">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {filterChips.map((x) => (
            <button key={x.v} onClick={() => setF({ ...f, status: x.v })} aria-pressed={f.status === x.v}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${f.status === x.v ? "bg-deep text-white border-deep" : "bg-paper border-line text-ink hover:border-goldSoft"}`}>
              {x.l} <span className={`tabular-nums ${f.status === x.v ? "text-goldSoft" : "text-muted"}`}>{x.n}</span>
            </button>
          ))}
          {v79 && (
            <button onClick={() => setF({ ...f, urgentOnly: !f.urgentOnly })} aria-pressed={f.urgentOnly}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${f.urgentOnly ? "bg-late text-white border-late" : "bg-white border-[#F1C9C5] text-late"}`}>
              🚨 العاجل فقط
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2">
          <label className="relative block">
            <span className="absolute inset-y-0 start-3 grid place-items-center text-muted"><Icon name="search" size={16} /></span>
            <input className="fld text-sm" style={{ paddingInlineStart: "2.25rem" }} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })}
              placeholder="ابحث باسم المستأجر أو الوحدة أو المشكلة أو الفني" />
          </label>
          <select className="fld text-sm" value={f.property} onChange={(e) => setF({ ...f, property: e.target.value })} aria-label="العقار">
            <option value="">كل العقارات</option>
            {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* القائمة */}
      {rows === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-36 rounded-2xl bg-white border border-line animate-pulse" />)}</div>
      ) : !list.length ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-paper2 grid place-items-center text-deep mb-3"><Icon name="check" size={22} /></div>
          <div className="font-semibold text-deep">{(rows || []).length ? "لا طلبات بهذا الفلتر" : "لا طلبات صيانة بعد"}</div>
          <p className="text-sm text-muted mt-1 max-w-md mx-auto leading-relaxed">
            {(rows || []).length ? "غيّر الفلتر أو امسح البحث." : "أرسل لكل مستأجر رابطه (من قائمة الوحدة ← «رابط المستأجر») فيبلّغ عن أي عطل من جواله، أو سجّل طلبًا بنفسك من «طلب جديد»."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <ReqCard key={r.id} r={r} today={today} office={office} v79={v79} canWork={canWork} canExpense={canExpense}
              property={propName(r.property_id)} tenant={tenantOf(r)} org={orgName || null}
              open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onStart={() => void quickStart(r)} onFinish={() => setFinishing(r)}
              onStatus={(s, n) => setStatus(r, s, n)} onPatch={(p) => patch(r.id, p)} db={db} notify={notify} />
          ))}
        </div>
      )}

      {creating && office && (
        <CreateModal db={db} props={props} tenants={tenants} onClose={() => setCreating(false)}
          onDone={(id) => { setCreating(false); notify("ok", "سُجّل الطلب."); void load().then(() => setOpenId(id)); }} />
      )}
      {finishing && (
        <FinishModal r={finishing} db={db} canExpense={canExpense} today={today}
          onClose={() => setFinishing(null)}
          onDone={(p, msg) => { patch(finishing.id, p); setFinishing(null); notify("ok", msg); }}
          setStatus={(n) => setStatus(finishing, "done", n)} />
      )}

      {toast && (
        <div role="status" className={`fixed bottom-4 inset-x-4 sm:inset-x-auto sm:start-1/2 sm:-translate-x-1/2 z-[60] rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${toast.k === "ok" ? "bg-deep text-white" : "bg-late text-white"}`}>
          {toast.m}
        </div>
      )}
    </div>
  );
}

// ─── البطاقة ─────────────────────────────────────────────────────
function ReqCard({ r, today, office, v79, canWork, canExpense, property, tenant, org, open, onToggle, onStart, onFinish, onStatus, onPatch, db, notify }: {
  r: MaintRequest; today: string; office: string | null; v79: boolean; canWork: boolean; canExpense: boolean;
  property: string; tenant: Tenant | null; org: string | null; open: boolean; onToggle: () => void;
  onStart: () => void; onFinish: () => void; onStatus: (s: MaintStatus, note?: string | null) => Promise<boolean>;
  onPatch: (p: Partial<MaintRequest>) => void; db: any; notify: (k: "ok" | "err", m: string) => void;
}) {
  const meta = STATUS_META[r.status] || STATUS_META.new;
  const ci = catIcon(r.category);
  const age = ageDays(r, today);
  const late = isLate(r, today);
  const phone = tenant?.phone || null;
  const waTenant = phone ? waLink(phone, tenantUpdateText(r, { org })) : null;

  return (
    <article className={`relative rounded-2xl bg-white border ${late ? "border-[#F1C9C5]" : "border-line"} shadow-[0_1px_2px_rgba(11,33,31,.04)] overflow-hidden`}>
      <span aria-hidden="true" className={`absolute inset-y-0 start-0 w-1.5 ${meta.bar}`} />
      <div className="p-4 ps-5">
        <div className="flex items-start gap-3">
          <span className={`shrink-0 w-11 h-11 rounded-xl grid place-items-center ${ci.tint}`}><Icon name={ci.icon} size={22} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display font-bold text-deep text-[15.5px] leading-snug">
                {requestCatAr(r.category)} <span className="font-sans font-normal text-muted text-sm">· {requestLocAr(r.location)}</span>
              </h3>
              <span className={`shrink-0 text-[11.5px] font-bold rounded-full border px-2.5 py-0.5 ${meta.pill}`}>{meta.label}</span>
            </div>
            <div className="text-[13px] text-muted mt-0.5 truncate">
              {r.tenant_name || "بدون مستأجر"}{r.unit ? ` · وحدة ${r.unit}` : ""} · {property}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {isUrgent(r) && <span className="text-[11.5px] font-bold rounded-md bg-[#FBE9E7] text-late px-2 py-0.5">🚨 عاجل</span>}
          <span className={`text-[11.5px] rounded-md px-2 py-0.5 inline-flex items-center gap-1 ${late ? "bg-[#FBE9E7] text-late font-bold" : "bg-paper2 text-muted"}`}>
            <Icon name="clock" size={12} /> {late ? `متأخر · ${agePhrase(age)}` : isOpen(r) ? agePhrase(age) : `استغرق ${age ? `${age} ${age === 1 ? "يوم" : age === 2 ? "يومين" : "أيام"}` : "أقل من يوم"}`}
          </span>
          {r.source === "office" && <span className="text-[11.5px] rounded-md bg-paper2 text-muted px-2 py-0.5">سجّله المكتب</span>}
          {r.tech_name && <span className="text-[11.5px] rounded-md bg-[#E6F0FA] text-[#1F4F80] px-2 py-0.5">👷 {r.tech_name}</span>}
          {r.visit_date && <span className="text-[11.5px] rounded-md bg-[#E6F0FA] text-[#1F4F80] px-2 py-0.5 inline-flex items-center gap-1"><Icon name="calendar" size={12} /> {shortDate(r.visit_date)}</span>}
          {r.cost != null && <span className="text-[11.5px] rounded-md bg-[#E3F4EA] text-paid px-2 py-0.5 tabular-nums">💰 {sar(Number(r.cost))} ريال</span>}
        </div>

        <p className={`text-sm text-ink mt-2.5 whitespace-pre-wrap break-words leading-relaxed ${open ? "" : "line-clamp-2"}`}>{r.description}</p>
        {r.manager_note && <p className="text-[12.5px] text-muted mt-1">ردّك: {r.manager_note}</p>}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {canWork && r.status === "new" && <button className="btn btn-primary text-sm" onClick={onStart}>ابدأ التنفيذ</button>}
          {canWork && r.status === "in_progress" && <button className="btn text-sm bg-paid text-white hover:opacity-90" onClick={onFinish}><Icon name="check" size={15} /> تم الإنجاز</button>}
          {waTenant && (
            <button className="btn btn-ghost text-sm" onClick={() => openExternal(waTenant)} title="رسالة جاهزة بحالة الطلب">
              <Icon name="whatsapp" size={15} /> حدّث المستأجر
            </button>
          )}
          <button className="btn btn-ghost text-sm ms-auto" onClick={onToggle} aria-expanded={open}>
            {open ? "إخفاء التفاصيل" : "التفاصيل"} <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-paper/60 p-4 ps-5 grid gap-4 lg:grid-cols-2">
          {v79 && <TechPanel r={r} canWork={canWork} property={property} tenant={tenant} org={org} db={db} notify={notify} onPatch={onPatch} />}
          {v79 && office && <PhotosPanel r={r} office={office} canWork={canWork} db={db} />}
          {canWork && <StatusPanel r={r} onStatus={onStatus} notify={notify} />}
          {v79 && <CostPanel r={r} canWork={canWork} canExpense={canExpense} onFinish={onFinish} />}
          <HistoryPanel r={r} db={db} />
        </div>
      )}
    </article>
  );
}

const panel = "rounded-xl bg-white border border-line p-3.5";
const panelH = "text-sm font-bold text-deep mb-2.5 inline-flex items-center gap-1.5";

function TechPanel({ r, canWork, property, tenant, org, db, notify, onPatch }: {
  r: MaintRequest; canWork: boolean; property: string; tenant: Tenant | null; org: string | null; db: any;
  notify: (k: "ok" | "err", m: string) => void; onPatch: (p: Partial<MaintRequest>) => void;
}) {
  const [d, setD] = useState({ priority: r.priority || "normal", tech_name: r.tech_name || "", tech_phone: r.tech_phone || "", visit_date: r.visit_date || "" });
  const [busy, setBusy] = useState(false);
  const dirty = d.priority !== (r.priority || "normal") || d.tech_name !== (r.tech_name || "") || d.tech_phone !== (r.tech_phone || "") || d.visit_date !== (r.visit_date || "");
  async function save() {
    setBusy(true);
    const { data, error } = await db.rpc("watheq_tenant_request_update", {
      p_request: r.id, p_priority: d.priority, p_tech_name: d.tech_name.trim() || null,
      p_tech_phone: d.tech_phone.trim() || null, p_visit_date: d.visit_date || null,
    });
    setBusy(false);
    if (error) return notify("err", friendly(error));
    onPatch({ priority: (data as any).priority, tech_name: (data as any).tech_name, tech_phone: (data as any).tech_phone, visit_date: (data as any).visit_date });
    notify("ok", "حُفظ.");
  }
  const cur = { ...r, priority: d.priority as any, tech_name: d.tech_name || null, visit_date: d.visit_date || null };
  const waTech = (r.tech_phone || d.tech_phone) ? waLink(d.tech_phone || r.tech_phone!, techText(cur, { property, tenantPhone: tenant?.phone, org })) : null;
  return (
    <section className={panel}>
      <h4 className={panelH}><Icon name="users" size={16} /> الفني والموعد</h4>
      <div className="grid grid-cols-2 gap-2 mb-2">
        {(["normal", "urgent"] as const).map((p) => (
          <button key={p} type="button" disabled={!canWork} onClick={() => setD({ ...d, priority: p })} aria-pressed={d.priority === p}
            className={`rounded-lg border-2 min-h-[38px] text-sm font-semibold transition ${d.priority === p ? (p === "urgent" ? "border-late bg-[#FBE9E7] text-late" : "border-deep bg-paper2 text-deep") : "border-line bg-white text-muted"}`}>
            {p === "urgent" ? "🚨 عاجل" : "عادي"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="fld text-sm" disabled={!canWork} value={d.tech_name} maxLength={80} onChange={(e) => setD({ ...d, tech_name: e.target.value })} placeholder="اسم الفني" />
        <input className="fld text-sm" disabled={!canWork} type="tel" dir="ltr" value={d.tech_phone} maxLength={20} onChange={(e) => setD({ ...d, tech_phone: e.target.value })} placeholder="05xxxxxxxx" />
        <label className="col-span-2 block">
          <span className="block text-xs text-muted mb-1">موعد الزيارة</span>
          <input className="fld text-sm" disabled={!canWork} type="date" value={d.visit_date} onChange={(e) => setD({ ...d, visit_date: e.target.value })} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 mt-2.5">
        {canWork && <button className="btn btn-primary text-sm" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "…" : "حفظ"}</button>}
        {waTech && <button className="btn btn-ghost text-sm" onClick={() => openExternal(waTech)} title="ترسل للفني النوع والمكان والمشكلة والموعد"><Icon name="whatsapp" size={15} /> أرسل للفني</button>}
      </div>
    </section>
  );
}

type Shot = { path: string; url: string; side: "before" | "after" };
function PhotosPanel({ r, office, canWork, db }: { r: MaintRequest; office: string; canWork: boolean; db: any }) {
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dir = photoDir(office, r.id);
  async function load() {
    setErr(null);
    const { data: files, error } = await db.storage.from(PHOTO_BUCKET).list(dir, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    if (error) { setErr(friendly(error)); setShots([]); return; }
    const names = (files || []).filter((x: any) => x.name && /^(before|after)-/.test(x.name)).map((x: any) => x.name as string);
    if (!names.length) { setShots([]); return; }
    const paths = names.map((n: string) => `${dir}/${n}`);
    const { data: signed, error: e2 } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    if (e2) { setErr(friendly(e2)); setShots([]); return; }
    setShots((signed || []).map((s: any, i: number) => ({ path: paths[i], url: s.signedUrl, side: names[i].startsWith("after-") ? "after" : "before" }))
      .filter((s: Shot) => s.url));
  }
  useEffect(() => { if (shots === null) void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots]);

  async function upload(side: "before" | "after", files: FileList | null) {
    if (!files?.length) return;
    setErr(null); setBusy(side);
    try {
      const have = (shots || []).filter((s) => s.side === side).length;
      const take = Array.from(files).filter((x) => /^image\//.test(x.type)).slice(0, Math.max(0, MAX_PHOTOS_PER_SIDE - have));
      if (!take.length) throw new Error(`الحد ${MAX_PHOTOS_PER_SIDE} صور ${side === "before" ? "قبل" : "بعد"} لكل طلب`);
      for (const file of take) {
        const blob = await compressImage(file);
        const path = `${dir}/${side}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw error;
      }
      setShots(null);
    } catch (e) { setErr(friendly(e)); }
    setBusy(null);
  }
  async function remove(s: Shot) {
    if (!confirm("حذف هذه الصورة نهائيًّا؟")) return;
    setBusy(s.path);
    const { error } = await db.storage.from(PHOTO_BUCKET).remove([s.path]);
    setBusy(null);
    if (error) return setErr(friendly(error));
    setShots((shots || []).filter((x) => x.path !== s.path));
  }

  return (
    <section className={panel}>
      <h4 className={panelH}><Icon name="camera" size={16} /> صور قبل وبعد</h4>
      {err && <div className="text-xs font-semibold text-[#8f2b26] bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2 mb-2">{err}</div>}
      <div className="grid grid-cols-2 gap-3">
        {(["before", "after"] as const).map((side) => {
          const mine = (shots || []).filter((s) => s.side === side);
          return (
            <div key={side} className="min-w-0">
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className={`text-xs font-bold ${side === "after" ? "text-paid" : "text-goldInk"}`}>{side === "before" ? "قبل" : "بعد"} <span className="text-muted font-normal">({mine.length})</span></span>
                {canWork && (
                  <label className={`text-xs font-semibold text-deep cursor-pointer rounded-md border border-line bg-paper px-2 py-0.5 ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                    {busy === side ? "جارٍ الرفع…" : "+ صورة"}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void upload(side, e.target.files); e.target.value = ""; }} />
                  </label>
                )}
              </div>
              {shots === null ? <div className="h-20 rounded-lg bg-paper2 animate-pulse" /> : !mine.length ? (
                <div className="h-20 rounded-lg border border-dashed border-line grid place-items-center text-muted"><Icon name="image" size={20} /></div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {mine.map((s) => (
                    <div key={s.path} className="relative rounded-lg overflow-hidden border border-line bg-paper aspect-square">
                      <a href={s.url} target="_blank" rel="noreferrer" title="فتح بالحجم الكامل">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt={side === "before" ? "قبل الصيانة" : "بعد الصيانة"} className="w-full h-full object-cover" loading="lazy" />
                      </a>
                      {canWork && (
                        <button className="absolute top-1 start-1 bg-black/60 text-white rounded-md text-[10px] px-1.5 py-0.5 hover:bg-late"
                          onClick={() => void remove(s)} disabled={busy === s.path} aria-label="حذف الصورة">{busy === s.path ? "…" : "✕"}</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11.5px] text-muted mt-2 leading-relaxed">تُضغط تلقائيًّا قبل الرفع، ويراها المستأجر في صفحته مع حالة طلبه.</p>
    </section>
  );
}

function StatusPanel({ r, onStatus, notify }: { r: MaintRequest; onStatus: (s: MaintStatus, n?: string | null) => Promise<boolean>; notify: (k: "ok" | "err", m: string) => void }) {
  const [s, setS] = useState<MaintStatus>(r.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setS(r.status); }, [r.status]);
  async function save() {
    if (s === "rejected" && note.trim().length < 3 && !r.manager_note) return notify("err", "اكتب سبب الرفض — يظهر للمستأجر.");
    setBusy(true);
    const ok = await onStatus(s, note);
    setBusy(false);
    if (ok) { setNote(""); notify("ok", `حُدّث الطلب: ${STATUS_META[s].label} — يراه المستأجر في صفحته.`); }
  }
  return (
    <section className={panel}>
      <h4 className={panelH}><Icon name="edit" size={16} /> الحالة وردّك للمستأجر</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
        {(["new", "in_progress", "done", "rejected"] as const).map((x) => (
          <button key={x} type="button" onClick={() => setS(x)} aria-pressed={s === x}
            className={`rounded-lg border text-xs font-semibold min-h-[34px] transition ${s === x ? STATUS_META[x].pill + " border-2" : "bg-white border-line text-muted"}`}>{STATUS_META[x].label}</button>
        ))}
      </div>
      <input className="fld text-sm" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder={s === "rejected" ? "سبب الرفض — يظهر للمستأجر" : s === "in_progress" ? "مثال: الفني يزوركم الأحد (اختياري)" : s === "done" ? "مثال: تم تغيير الخلاط (اختياري)" : "ردّ للمستأجر (اختياري)"} />
      <button className="btn btn-primary text-sm mt-2" disabled={busy || (s === r.status && !note.trim())} onClick={() => void save()}>{busy ? "…" : "حفظ"}</button>
    </section>
  );
}

function CostPanel({ r, canWork, canExpense, onFinish }: { r: MaintRequest; canWork: boolean; canExpense: boolean; onFinish: () => void }) {
  return (
    <section className={panel}>
      <h4 className={panelH}><Icon name="money" size={16} /> التكلفة</h4>
      {r.cost != null ? (
        <div className="text-sm">
          <b className="text-paid tabular-nums">{sar(Number(r.cost))} ريال</b> <span className="text-muted">سُجّلت مصروف صيانة على العقار — تجدها في «المصروفات» بخصمها من صافي المالك أو بدونه حسب اختيارك.</span>
        </div>
      ) : (
        <>
          <p className="text-[12.5px] text-muted leading-relaxed">سجّل ما دُفع للفني فيُضاف لمصروفات العقار تلقائيًّا ويُخصم من صافي المالك (أو يبقى على المكتب).</p>
          {canWork && canExpense && <button className="btn btn-ghost text-sm mt-2" onClick={onFinish}><Icon name="plus" size={15} /> {r.status === "done" ? "سجّل التكلفة" : "أنجز وسجّل التكلفة"}</button>}
          {!canExpense && <p className="text-[11.5px] text-muted mt-1">تسجيل التكلفة يحتاج صلاحية «المصروفات».</p>}
        </>
      )}
    </section>
  );
}

function HistoryPanel({ r, db }: { r: MaintRequest; db: any }) {
  const [log, setLog] = useState<LogRow[] | null>(null);
  useEffect(() => {
    void (async () => {
      const { data } = await db.from("tenant_portal_audit").select("action,detail,created_at")
        .in("action", ["request_status", "request_create", "request_edit", "request_expense"])
        .eq("detail->>request_id", r.id).order("id", { ascending: true }).limit(60);
      setLog((data || []) as LogRow[]);
    })();
  }, [db, r.id, r.status, r.updated_at]);
  const line = (x: LogRow): { t: string; tone: string } => {
    const d = x.detail || {};
    if (x.action === "request_create") return { t: "سجّله المكتب", tone: "bg-deep" };
    if (x.action === "request_status") return { t: `${STATUS_META[d.to as MaintStatus]?.label || d.to}${d.note ? ` — ${d.note}` : ""}`, tone: STATUS_META[d.to as MaintStatus]?.bar || "bg-muted" };
    if (x.action === "request_edit") return { t: [d.priority === "urgent" ? "عاجل" : null, d.tech_name ? `الفني: ${d.tech_name}` : null, d.visit_date ? `الموعد: ${shortDate(d.visit_date)}` : null].filter(Boolean).join(" · ") || "تعديل التفاصيل", tone: "bg-[#2F6FB0]" };
    return { t: `سُجّلت التكلفة: ${sar(Number(d.amount))} ريال`, tone: "bg-paid" };
  };
  return (
    <section className={`${panel} lg:col-span-2`}>
      <h4 className={panelH}><Icon name="history" size={16} /> السجل</h4>
      <ol className="relative border-s-2 border-line ms-1.5 space-y-2">
        <li className="ps-4 relative text-[13px]">
          <span className="absolute -start-[7px] top-1.5 w-3 h-3 rounded-full bg-[#C9861A]" />
          <b className="text-deep">{r.source === "office" ? "فُتح الطلب" : "بلّغ المستأجر"}</b> <span className="text-muted">· {shortDate(r.created_at.slice(0, 10))}</span>
        </li>
        {(log || []).filter((x) => x.action !== "request_create").map((x, i) => {
          const L = line(x);
          return (
            <li key={i} className="ps-4 relative text-[13px]">
              <span className={`absolute -start-[7px] top-1.5 w-3 h-3 rounded-full ${L.tone}`} />
              <span className="text-ink break-words">{L.t}</span> <span className="text-muted">· {shortDate(x.created_at.slice(0, 10))}</span>
            </li>
          );
        })}
        {log === null && <li className="ps-4 text-xs text-muted">…</li>}
      </ol>
    </section>
  );
}

// ─── طلب جديد من المكتب ──────────────────────────────────────────
function CreateModal({ db, props, tenants, onClose, onDone }: {
  db: any; props: Prop[]; tenants: Tenant[]; onClose: () => void; onDone: (id: string) => void;
}) {
  const [d, setD] = useState({ property: props[0]?.id || "", tenant: "", unit: "", category: "plumbing", location: "unit", priority: "normal", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ts = tenants.filter((t) => t.property_id === d.property).sort((a, b) => String(a.unit || "").localeCompare(String(b.unit || ""), "ar", { numeric: true }));
  async function submit() {
    setErr(null);
    if (!d.property) return setErr("اختر العقار");
    if (d.description.trim().length < 3) return setErr("اكتب وصف المشكلة");
    setBusy(true);
    const { data, error } = await db.rpc("watheq_tenant_request_create", {
      p_property: d.property, p_tenant: d.tenant || null, p_unit: d.tenant ? null : (d.unit.trim() || null),
      p_category: d.category, p_location: d.location, p_description: d.description.trim(), p_priority: d.priority,
    });
    setBusy(false);
    if (error) return setErr(friendly(error));
    onDone(String(data));
  }
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display font-bold text-deep text-lg">طلب صيانة جديد</h3>
          <p className="text-xs text-muted mt-0.5">مستأجر اتصل؟ أو لاحظت عطلًا في الأجزاء المشتركة؟ سجّله هنا ويظهر للمستأجر في صفحته.</p>
        </div>
        <button className="btn btn-ghost text-sm" onClick={onClose}>إغلاق</button>
      </div>
      <div className="space-y-3">
        <label className="block"><span className="block text-sm font-semibold mb-1">العقار</span>
          <select className="fld text-sm" value={d.property} onChange={(e) => setD({ ...d, property: e.target.value, tenant: "" })}>
            {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="block text-sm font-semibold mb-1">المستأجر</span>
            <select className="fld text-sm" value={d.tenant} onChange={(e) => setD({ ...d, tenant: e.target.value })}>
              <option value="">— بدون (أجزاء مشتركة) —</option>
              {ts.map((t) => <option key={t.id} value={t.id}>{t.unit ? `${t.unit} · ` : ""}{t.name}</option>)}
            </select></label>
          <label className="block"><span className="block text-sm font-semibold mb-1">الوحدة <span className="text-muted font-normal text-xs">— اختياري</span></span>
            <input className="fld text-sm" disabled={!!d.tenant} value={d.tenant ? (ts.find((t) => t.id === d.tenant)?.unit || "") : d.unit} maxLength={40}
              onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="مثال: الدرج أو 12" /></label>
        </div>
        <div>
          <span className="block text-sm font-semibold mb-1">نوع المشكلة</span>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {REQUEST_CATEGORIES.map((x) => {
              const ci = catIcon(x.v);
              return (
                <button key={x.v} type="button" onClick={() => setD({ ...d, category: x.v })} aria-pressed={d.category === x.v}
                  className={`rounded-xl border-2 p-2 text-xs font-semibold flex flex-col items-center gap-1 transition ${d.category === x.v ? "border-deep bg-paper2" : "border-line bg-white"}`}>
                  <span className={`w-8 h-8 rounded-lg grid place-items-center ${ci.tint}`}><Icon name={ci.icon} size={17} /></span>{x.l}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><span className="block text-sm font-semibold mb-1">المكان</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(["unit", "common"] as const).map((x) => (
                <button key={x} type="button" onClick={() => setD({ ...d, location: x })} aria-pressed={d.location === x}
                  className={`rounded-lg border-2 min-h-[38px] text-xs font-semibold ${d.location === x ? "border-deep bg-paper2 text-deep" : "border-line text-muted"}`}>{x === "unit" ? "داخل الوحدة" : "مشتركة"}</button>
              ))}
            </div></div>
          <div><span className="block text-sm font-semibold mb-1">الأولوية</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(["normal", "urgent"] as const).map((x) => (
                <button key={x} type="button" onClick={() => setD({ ...d, priority: x })} aria-pressed={d.priority === x}
                  className={`rounded-lg border-2 min-h-[38px] text-xs font-semibold ${d.priority === x ? (x === "urgent" ? "border-late bg-[#FBE9E7] text-late" : "border-deep bg-paper2 text-deep") : "border-line text-muted"}`}>{x === "urgent" ? "🚨 عاجل" : "عادي"}</button>
              ))}
            </div></div>
        </div>
        <label className="block"><span className="block text-sm font-semibold mb-1">الوصف</span>
          <textarea className="fld text-sm" rows={3} maxLength={1000} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })}
            placeholder="مثال: تسريب مياه تحت مغسلة المطبخ" /></label>
        {err && <div className="text-xs font-semibold text-[#8f2b26] bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2">{err}</div>}
        <button className="btn btn-gold w-full" disabled={busy} onClick={() => void submit()}>{busy ? "…" : "سجّل الطلب"}</button>
      </div>
    </Overlay>
  );
}

// ─── الإنجاز والتكلفة ────────────────────────────────────────────
function FinishModal({ r, db, canExpense, today, onClose, onDone, setStatus }: {
  r: MaintRequest; db: any; canExpense: boolean; today: string; onClose: () => void;
  onDone: (p: Partial<MaintRequest>, msg: string) => void; setStatus: (note?: string | null) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [billable, setBillable] = useState(true);
  const [paidBy, setPaidBy] = useState<"collections" | "office" | "owner">("collections");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = Number(String(cost).replace(/[^\d.]/g, ""));
  const alreadyDone = r.status === "done";

  async function go() {
    setErr(null);
    if (cost && (!isFinite(amount) || amount <= 0)) return setErr("المبلغ غير صحيح");
    setBusy(true);
    if (!alreadyDone) {
      const ok = await setStatus(note);
      if (!ok) { setBusy(false); return; }
    }
    if (!(amount > 0) || !canExpense) {
      setBusy(false);
      return onDone({ status: "done" }, "أُنجز الطلب ✓ — أضف صور «بعد» من التفاصيل وأرسل للمستأجر.");
    }
    try {
      const o = await getOffice(db);
      if (!o) throw new Error("انتهت الجلسة");
      const { data: ex, error } = await db.from("expenses").insert({
        user_id: o.officeId, property_id: r.property_id, unit: r.unit || null, category: "maintenance",
        amount: Math.round(amount * 100) / 100, spent_on: today, note: expenseNote(r), vendor: r.tech_name || null,
        billable, paid_by: paidBy, status: "paid",
      }).select("id,amount,voucher_no").single();
      if (error) throw error;
      const { error: e2 } = await db.rpc("watheq_tenant_request_link_expense", { p_request: r.id, p_expense: (ex as any).id });
      if (e2) throw e2;
      setBusy(false);
      onDone({ status: "done", cost: Number((ex as any).amount), expense_id: (ex as any).id },
        `أُنجز الطلب ✓ وسُجّلت التكلفة ${sar(Number((ex as any).amount))} ريال${(ex as any).voucher_no ? ` · سند صرف ${(ex as any).voucher_no}` : ""}.`);
    } catch (e) {
      setBusy(false);
      setErr(`${alreadyDone ? "" : "أُنجز الطلب، لكن "}تعذّر تسجيل التكلفة: ${friendly(e)}`);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display font-bold text-deep text-lg inline-flex items-center gap-2"><Icon name="check" size={20} /> {alreadyDone ? "تكلفة الصيانة" : "إنجاز الطلب"}</h3>
          <p className="text-xs text-muted mt-0.5">{requestCatAr(r.category)}{r.unit ? ` · وحدة ${r.unit}` : ""}{r.tenant_name ? ` · ${r.tenant_name}` : ""}</p>
        </div>
        <button className="btn btn-ghost text-sm" onClick={onClose}>إغلاق</button>
      </div>
      <div className="space-y-3">
        {!alreadyDone && (
          <label className="block"><span className="block text-sm font-semibold mb-1">ردّك للمستأجر <span className="text-muted font-normal text-xs">— اختياري</span></span>
            <input className="fld text-sm" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: تم تغيير الخلاط وتنظيف التصريف" /></label>
        )}
        {canExpense ? (
          <div className="rounded-xl border border-line bg-paper p-3 space-y-2.5">
            <label className="block"><span className="block text-sm font-semibold mb-1">التكلفة <span className="text-muted font-normal text-xs">— تُسجَّل مصروف صيانة على العقار</span></span>
              <div className="relative">
                <input className="fld text-sm pe-14 tabular-nums" inputMode="decimal" dir="ltr" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
                <span className="absolute inset-y-0 end-3 grid place-items-center text-xs text-muted">ريال</span>
              </div></label>
            {amount > 0 && (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["collections", "من التحصيل"], ["office", "دفعها المكتب"], ["owner", "دفعها المالك"]] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setPaidBy(v)} aria-pressed={paidBy === v}
                      className={`rounded-lg border-2 min-h-[36px] text-xs font-semibold ${paidBy === v ? "border-deep bg-white text-deep" : "border-line text-muted"}`}>{l}</button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
                  تُخصم من صافي المالك <span className="text-muted text-xs">(ألغِها إن كانت على المكتب)</span>
                </label>
                {r.tech_name && <p className="text-[11.5px] text-muted">المورّد في السند: {r.tech_name}</p>}
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted">تسجيل التكلفة يحتاج صلاحية «المصروفات» — اطلبها من صاحب المكتب.</p>
        )}
        {err && <div className="text-xs font-semibold text-[#8f2b26] bg-[#FBE9E7] border border-[#F5C6C2] rounded-lg p-2">{err}</div>}
        <button className="btn w-full bg-paid text-white hover:opacity-90" disabled={busy || (alreadyDone && !(amount > 0))} onClick={() => void go()}>
          {busy ? "…" : alreadyDone ? "سجّل التكلفة" : amount > 0 ? "أنجز وسجّل التكلفة" : "تم الإنجاز"}
        </button>
      </div>
    </Overlay>
  );
}
