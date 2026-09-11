"use client";
// ============================================================
// وثيق — تواصل الفريق
//
// لماذا ليست محادثة عامة: الفريق عنده واتساب أصلًا. الفرق هنا أن الرسالة
// تُعلَّق على وحدة أو عقار، فتُقرأ ومعها اسم المستأجر ورقم الوحدة، وتبقى
// في السجل مربوطةً بها — بدل أن تضيع في قروب بعد يومين. وأي رسالة تتحوّل
// إلى مهمة موكّلة لموظف تُغلق عند إنجازها.
//
// التحديث لحظي عبر Supabase Realtime: ما يكتبه الموظف يظهر عندك في الحال
// بلا تحديث للصفحة. والزر يحمل عدّاد الجديد منذ آخر فتح.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { getOffice } from "@/lib/office";

type Msg = {
  id: string; user_id: string; author_id: string; body: string;
  property_id: string | null; tenant_id: string | null;
  assigned_to: string | null; done_at: string | null; created_at: string;
};
type Ctx = { propertyId?: string | null; propertyName?: string | null; tenantId?: string | null; tenantName?: string | null; unit?: string | null };

const SEEN_KEY = "watheq.chat.seen";
const timeAr = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
      timeZone: "Asia/Riyadh", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return iso.slice(0, 16).replace("T", " "); }
};

export default function OfficeChat() {
  /* مركّبة في تخطيط اللوحة كلها: الزر وعدّاد الجديد يظهران في كل صفحة —
     فلا يحتاج أحد فتح وحدة بعينها ليعرف أن هناك رسالة. وأي شاشة تستطيع
     فتح المحادثة بسياق وحدة عبر حدث watheq:chat. */
  const [context, setContext] = useState<Ctx | undefined>(undefined);
  const [lookup, setLookup] = useState<{ props: Record<string, string>; tenants: Record<string, string> }>({ props: {}, tenants: {} });
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [me, setMe] = useState<string | null>(null);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [assign, setAssign] = useState("");
  const [attach, setAttach] = useState(true);
  const [tab, setTab] = useState<"all" | "tasks" | "unit">("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<string>("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { try { setSeenAt(localStorage.getItem(SEEN_KEY) || ""); } catch { /* */ } }, []);

  const load = useCallback(async () => {
    const [{ data: { user } }, office] = await Promise.all([supabase.auth.getUser(), getOffice(supabase)]);
    if (!user) return;
    setMe(user.id);
    const oid = office?.officeId || user.id;
    setOfficeId(oid);
    const { data, error } = await supabase.from("office_messages")
      .select("*").order("created_at", { ascending: true }).limit(300);
    if (error) { setErr(/does not exist|relation/.test(error.message) ? "شغّل schema-v25 في قاعدة البيانات أولًا." : error.message); return; }
    setMsgs((data || []) as Msg[]);
    const { data: actors } = await supabase.rpc("watheq_actor_names", { office: oid });
    const m: Record<string, string> = {};
    (actors || []).forEach((a: any) => { m[a.actor_id] = a.actor_name; });
    setNames(m);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // فهرس الأسماء: تُعرض «شقة 106 — سعود · عمارة قباء» بجانب كل رسالة أينما كنت
  useEffect(() => {
    let alive = true;
    supabase.from("properties").select("id, name, property_type, tenants(id, name, unit)").limit(500)
      .then(({ data }) => {
        if (!alive) return;
        const props: Record<string, string> = {}; const tenants: Record<string, string> = {};
        (data || []).forEach((p: any) => {
          props[p.id] = p.name;
          (p.tenants || []).forEach((t: any) => { tenants[t.id] = `${t.unit ? `وحدة ${t.unit} — ` : ""}${t.name}`; });
        });
        setLookup({ props, tenants });
      });
    return () => { alive = false; };
  }, [supabase]);

  // فتح بسياق وحدة من أي شاشة
  useEffect(() => {
    const h = (e: any) => { setContext(e.detail || undefined); setOpen(true); markSeen(); };
    window.addEventListener("watheq:chat", h);
    return () => window.removeEventListener("watheq:chat", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // بثّ لحظي: رسالة جديدة أو تغيّر حالة مهمة تظهر فورًا للجميع
  useEffect(() => {
    const ch = supabase.channel("office_messages_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "office_messages" }, (p: any) => {
        setMsgs((cur) => {
          if (p.eventType === "INSERT") return cur.some((x) => x.id === p.new.id) ? cur : [...cur, p.new];
          if (p.eventType === "UPDATE") return cur.map((x) => (x.id === p.new.id ? p.new : x));
          if (p.eventType === "DELETE") return cur.filter((x) => x.id !== p.old.id);
          return cur;
        });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase]);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [open, msgs.length]);
  // فُتحت من وحدة بعينها؟ ابدأ على تبويبها مباشرة
  useEffect(() => { if (open && context?.tenantId) setTab("unit"); }, [open, context?.tenantId]);

  function markSeen() {
    const now = new Date().toISOString();
    setSeenAt(now);
    try { localStorage.setItem(SEEN_KEY, now); } catch { /* */ }
  }

  const unread = msgs.filter((m) => m.author_id !== me && (!seenAt || m.created_at > seenAt)).length;
  const openTasks = msgs.filter((m) => m.assigned_to && !m.done_at);
  const myTasks = openTasks.filter((m) => m.assigned_to === me).length;
  const unitMsgs = context?.tenantId ? msgs.filter((m) => m.tenant_id === context.tenantId)
    : context?.propertyId ? msgs.filter((m) => m.property_id === context.propertyId) : [];
  const shown = tab === "tasks" ? openTasks : tab === "unit" ? unitMsgs : msgs;
  /* اسم العقار/الوحدة لكل رسالة من فهرس تمرّره اللوحة — لا من السياق الحالي وحده */
  const ctxLabel = (m: Msg) => {
    const parts = [
      m.tenant_id ? (lookup?.tenants[m.tenant_id] || (context?.tenantId === m.tenant_id ? context?.tenantName : "")) : "",
      m.property_id ? (lookup?.props[m.property_id] || (context?.propertyId === m.property_id ? context?.propertyName : "")) : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "وحدة/عقار مرتبط";
  };

  async function send() {
    const text = body.trim();
    if (!text || !officeId) return;
    setBusy(true); setErr(null);
    const row: any = {
      user_id: officeId, author_id: me, body: text,
      assigned_to: assign || null,
      ...(attach && context?.propertyId ? { property_id: context.propertyId } : {}),
      ...(attach && context?.tenantId ? { tenant_id: context.tenantId } : {}),
    };
    const { data, error } = await supabase.from("office_messages").insert(row).select("*").single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMsgs((cur) => (cur.some((x) => x.id === data.id) ? cur : [...cur, data as Msg]));
    setBody(""); setAssign("");
    markSeen();
  }

  async function toggleDone(m: Msg) {
    const done = !m.done_at;
    const { error } = await supabase.from("office_messages")
      .update({ done_at: done ? new Date().toISOString() : null, done_by: done ? me : null })
      .eq("id", m.id);
    if (error) { setErr(error.message); return; }
    setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, done_at: done ? new Date().toISOString() : null } : x)));
  }

  const who = (id: string | null) => (!id ? "—" : id === me ? "أنا" : names[id] || "زميل");
  const people = Object.entries(names).filter(([id]) => id !== me);

  return (
    <>
      {/* الزر العائم */}
      <button type="button" onClick={() => { setOpen(true); markSeen(); }}
        className="wq-chat-fab fixed z-40 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] end-4 lg:bottom-6 lg:end-6 bg-deep text-goldSoft rounded-full shadow-lg border border-goldSoft/30 px-4 py-3 text-sm font-semibold flex items-center gap-2"
        title="تواصل الفريق">
        💬 الفريق
        {unread > 0 && <span className="bg-late text-white rounded-full text-[11px] px-1.5 py-0.5 min-w-[20px]">{unread}</span>}
        {myTasks > 0 && <span className="bg-gold text-white rounded-full text-[11px] px-1.5 py-0.5" title="مهام موكّلة لك">✓{myTasks}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="bg-paper w-full sm:max-w-lg h-[85vh] sm:h-[80vh] rounded-t-2xl sm:rounded-2xl border border-line flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            {/* الرأس */}
            <div className="bg-deep text-[#EAF1EE] px-4 py-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-display font-bold text-goldSoft">💬 تواصل الفريق</div>
                <div className="text-[11px] opacity-75">الرسائل تبقى في سجل المكتب — ومربوطة بالوحدة التي تخصّها</div>
              </div>
              <button className="text-sm opacity-80 hover:opacity-100" onClick={() => setOpen(false)}>إغلاق ✕</button>
            </div>

            <div className="flex gap-1 px-3 py-2 border-b border-line bg-white">
              {([["all", `الكل ${msgs.length}`], ["tasks", `مهام مفتوحة ${openTasks.length}`],
                 ...(context?.propertyId ? [["unit", `${context.tenantName ? "هذه الوحدة" : "هذا العقار"} ${unitMsgs.length}`] as const] : [])] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${tab === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted"}`}>{l}</button>
              ))}
            </div>

            {/* الرسائل */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              {err && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm">{err}</div>}
              {!err && shown.length === 0 && (
                <div className="text-center text-sm text-muted py-10">
                  {tab === "tasks" ? "لا مهام مفتوحة." : <>لا رسائل بعد.<br />اكتب أول رسالة — وإن كنت في صفحة وحدة فستُربط بها تلقائيًّا.</>}
                </div>
              )}
              {shown.map((m) => {
                const mine = m.author_id === me;
                const isTask = !!m.assigned_to;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 border ${mine ? "bg-deep text-[#EAF1EE] border-deep" : "bg-white border-line"} ${m.done_at ? "opacity-60" : ""}`}>
                      <div className={`text-[11px] mb-0.5 ${mine ? "text-goldSoft" : "text-muted"}`}>
                        {who(m.author_id)} · {timeAr(m.created_at)}
                      </div>
                      {(m.property_id || m.tenant_id) && (
                        <div className={`text-[11px] mb-1 rounded-md px-2 py-0.5 inline-block ${mine ? "bg-white/15" : "bg-paper2 text-muted"}`}>
                          📍 {ctxLabel(m)}
                        </div>
                      )}
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.body}</div>
                      {isTask && (
                        <div className={`mt-1.5 flex items-center gap-2 text-[11px] ${mine ? "text-goldSoft" : "text-muted"}`}>
                          <span>✓ مهمة لـ {who(m.assigned_to)}</span>
                          <button onClick={() => toggleDone(m)}
                            className={`rounded-md px-2 py-0.5 border ${m.done_at ? "border-current" : mine ? "bg-white/15 border-white/20" : "bg-paper border-line"}`}>
                            {m.done_at ? "أُنجزت — إعادة فتح" : "تمّت"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {/* الإرسال */}
            <div className="border-t border-line bg-white p-3">
              {context?.propertyName && (
                <label className="flex items-center gap-2 text-[11px] text-muted mb-2 cursor-pointer">
                  <input type="checkbox" className="w-3.5 h-3.5" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                  اربط الرسالة بـ 📍 {context.propertyName}{context.unit ? ` · ${context.unit}` : ""}{context.tenantName ? ` — ${context.tenantName}` : ""}
                </label>
              )}
              <div className="flex gap-2">
                <textarea className="fld flex-1 h-[46px] resize-none" value={body} rows={1}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
                  placeholder="اكتب رسالتك… (Ctrl+Enter للإرسال)" />
                <button className="btn btn-gold" onClick={send} disabled={busy || !body.trim()}>{busy ? "…" : "إرسال"}</button>
              </div>
              {people.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] text-muted">اجعلها مهمة لـ</span>
                  <select className="fld !w-auto !py-1 text-xs" value={assign} onChange={(e) => setAssign(e.target.value)}>
                    <option value="">— بلا تكليف —</option>
                    {people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
