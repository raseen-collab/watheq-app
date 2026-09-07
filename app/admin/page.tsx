import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { subState } from "@/lib/subscription";

export const dynamic = "force-dynamic";

/**
 * لوحة الإدارة — مركز قيادة صاحب المنصة في صفحة واحدة.
 *
 * ترتيبها بحسب ما يقرّر لا بحسب ما يوجد: المال أولًا، ثم ما يحتاج تصرّفًا
 * اليوم، ثم قمع التحويل (أين يتسرّب الناس)، ثم صحة المنصة، ثم الحسابات.
 * كل رقم هنا يجيب سؤالًا محددًا؛ ما لا يجيب سؤالًا حُذف.
 *
 * الحماية: قائمة معرّفات في متغيّر البيئة ADMIN_USER_IDS. لا تعتمد على حقل
 * في القاعدة عمدًا — الحقل قد يُرفع، ومتغيّر البيئة لا يُمسّ.
 */
function serviceDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const fmt = (v?: string | null) => (v ? String(v).slice(0, 10) : "—");
const PLAN_PRICE: Record<string, number> = { basic: 99, pro: 199, full: 199 };
const PLAN_AR: Record<string, string> = { basic: "المالك", pro: "المكتب", full: "المكتب" };

const SOURCE_AR: Record<string, string> = {
  haraj: "حراج", group: "قروب", twitter: "تويتر", search: "بحث جوجل",
  referral: "توصية", direct: "تواصل مباشر", other: "أخرى", skip: "لم يذكر",
};
const sourceLabel = (v?: string | null) => SOURCE_AR[String(v || "")] || "غير معروف";

function since(v?: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 86400000));
}
const agoLabel = (d: number | null) => d === null ? "—" : d === 0 ? "اليوم" : d === 1 ? "أمس" : `قبل ${d} يوم`;
function waNumber(raw?: string | null): string | null {
  const d = String(raw || "").replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("966")) return d;
  if (d.startsWith("0")) return "966" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) return "966" + d;
  return d.length >= 9 ? d : null;
}

type Stage = "new" | "onboarded" | "activated" | "collecting" | "paying" | "expired";
const STAGE: Record<Stage, { label: string; cls: string; order: number }> = {
  paying:     { label: "مشترك",       cls: "bg-[#E6F4EC] text-[#137a50] border-[#B7DFC7]", order: 0 },
  collecting: { label: "يسجّل دفعات",  cls: "bg-[#E6F1FB] text-[#0C447C] border-[#B5D4F4]", order: 1 },
  activated:  { label: "أضاف بيانات",  cls: "bg-[#EEE9FB] text-[#4B3AA6] border-[#D9CEF6]", order: 2 },
  onboarded:  { label: "أكمل الترحيب", cls: "bg-[#FDF6E3] text-[#7a5c12] border-[#EAD9A8]", order: 3 },
  new:        { label: "سجّل فقط",     cls: "bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]", order: 4 },
  expired:    { label: "انتهت تجربته",  cls: "bg-[#FBE9E7] text-[#a5322c] border-[#F5C6C2]", order: 5 },
};

export default async function AdminPage({ searchParams }: { searchParams?: { view?: string; sort?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const allowed = (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length || !allowed.includes(user.id)) notFound();

  const db = serviceDb();
  const [profilesRes, propsRes, tenantsRes, assocRes, ownersRes, paysRes, subsRes, teamRes, authRes] = await Promise.all([
    db.from("profiles").select("id,full_name,org_name,account_type,created_at,trial_ends_at,subscribed_until,plan,telegram_chat_id,billing_phone,last_digest_at,signup_source").order("created_at", { ascending: false }).limit(1000),
    db.from("properties").select("id,user_id,created_at"),
    db.from("tenants").select("id,status,property_id,created_at"),
    db.from("associations").select("id,user_id,created_at"),
    db.from("owners").select("id,association_id,created_at"),
    db.from("payments").select("id,user_id,amount,paid_on,created_at"),
    db.from("subscription_payments").select("id,user_id,amount,months,plan,paid_at,extended_to").order("paid_at", { ascending: false }),
    db.from("team_members").select("owner_id,member_id,role,created_at"),
    db.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const profiles = (profilesRes.data || []) as any[];
  const properties = (propsRes.data || []) as any[];
  const tenants = (tenantsRes.data || []) as any[];
  const associations = (assocRes.data || []) as any[];
  const owners = (ownersRes.data || []) as any[];
  const payments = (paysRes.data || []) as any[];
  const subs = (subsRes.data || []) as any[];
  const team = (teamRes.data || []) as any[];
  const authUsers = (authRes.data?.users || []) as any[];
  const errors = [profilesRes, propsRes, tenantsRes, assocRes, ownersRes, paysRes, subsRes, teamRes]
    .map((r) => r.error?.message).filter(Boolean) as string[];

  const emailOf: Record<string, string> = {}; const lastLogin: Record<string, string | null> = {};
  authUsers.forEach((u) => { emailOf[u.id] = u.email || ""; lastLogin[u.id] = u.last_sign_in_at || null; });
  const propOwner: Record<string, string> = {}; properties.forEach((p) => (propOwner[p.id] = p.user_id));
  const assocOwner: Record<string, string> = {}; associations.forEach((a) => (assocOwner[a.id] = a.user_id));
  const memberOf: Record<string, { owner: string; role: string }> = {}; team.forEach((t) => (memberOf[t.member_id] = { owner: t.owner_id, role: t.role }));
  const staffCount: Record<string, number> = {}; team.forEach((t) => (staffCount[t.owner_id] = (staffCount[t.owner_id] || 0) + 1));

  function lastActivity(uid: string): string | null {
    const s: string[] = [];
    properties.forEach((p) => p.user_id === uid && p.created_at && s.push(p.created_at));
    associations.forEach((a) => a.user_id === uid && a.created_at && s.push(a.created_at));
    tenants.forEach((t) => propOwner[t.property_id] === uid && t.created_at && s.push(t.created_at));
    owners.forEach((o) => assocOwner[o.association_id] === uid && o.created_at && s.push(o.created_at));
    payments.forEach((p) => p.user_id === uid && (p.created_at || p.paid_on) && s.push(p.created_at || p.paid_on));
    if (lastLogin[uid]) s.push(lastLogin[uid] as string);
    return s.length ? s.sort().reverse()[0] : null;
  }

  function buildRow(p: any) {
    const units = tenants.filter((t) => propOwner[t.property_id] === p.id).length;
    const props = properties.filter((x) => x.user_id === p.id).length + associations.filter((a) => a.user_id === p.id).length;
    const pays = payments.filter((x) => x.user_id === p.id).length;
    const sub = subState(p);
    const last = lastActivity(p.id);
    const trialLeft = p.trial_ends_at ? Math.round((Date.parse(p.trial_ends_at) - Date.now()) / 86400000) : null;
    const paidTotal = subs.filter((s) => s.user_id === p.id).reduce((a: number, s) => a + (Number(s.amount) || 0), 0);
    const stage: Stage = sub.paid ? "paying" : pays > 0 ? "collecting" : props > 0 ? "activated" : sub.expired ? "expired" : p.account_type ? "onboarded" : "new";
    return { p, units, props, pays, sub, last, sinceLast: since(last), sinceJoin: since(p.created_at), trialLeft, paidTotal, stage, staff: staffCount[p.id] || 0, employer: memberOf[p.id] };
  }
  type Row = ReturnType<typeof buildRow>;
  // الموظفون لا يُعدّون حسابات — يُحسبون على مكتبهم
  const rows: Row[] = profiles.filter((p) => !memberOf[p.id]).map(buildRow);
  const employees = profiles.filter((p) => memberOf[p.id]).length;

  // ---------- المال ----------
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const revenueMonth = subs.filter((s) => Date.parse(s.paid_at) >= monthStart.getTime()).reduce((a: number, s) => a + (Number(s.amount) || 0), 0);
  const revenueAll = subs.reduce((a: number, s) => a + (Number(s.amount) || 0), 0);
  const paying = rows.filter((r) => r.sub.paid);
  const mrr = paying.reduce((a, r) => a + (PLAN_PRICE[String(r.p.plan)] || 0), 0);
  const subEnding = paying.filter((r) => r.sub.subDaysLeft !== null && r.sub.subDaysLeft <= 7);
  const subExpired = rows.filter((r) => r.p.plan && !r.sub.paid && r.p.subscribed_until);

  // ---------- القمع ----------
  const funnel = [
    { k: "سجّل", n: rows.length },
    { k: "أكمل الترحيب", n: rows.filter((r) => r.p.account_type).length },
    { k: "أضاف عقارًا", n: rows.filter((r) => r.props > 0).length },
    { k: "سجّل دفعة", n: rows.filter((r) => r.pays > 0).length },
    { k: "اشترك", n: paying.length },
  ];

  // ---------- ما يحتاج تصرّفًا ----------
  const hotTrials = rows.filter((r) => r.stage !== "paying" && r.trialLeft !== null && r.trialLeft >= 0 && r.trialLeft <= 7 && r.props > 0).sort((a, b) => (a.trialLeft || 0) - (b.trialLeft || 0));
  const silentNew = rows.filter((r) => r.props === 0 && r.sinceJoin !== null && r.sinceJoin >= 2 && r.sinceJoin <= 21 && !r.sub.expired).sort((a, b) => (a.sinceJoin || 0) - (b.sinceJoin || 0));
  const goneQuiet = rows.filter((r) => r.props > 0 && r.sinceLast !== null && r.sinceLast >= 14 && !r.sub.paid).sort((a, b) => (b.sinceLast || 0) - (a.sinceLast || 0));
  const justExpired = rows.filter((r) => r.sub.expired && r.props > 0 && r.trialLeft !== null && r.trialLeft >= -14);

  // ---------- صحة المنصة ----------
  const lastDigest = profiles.map((p) => p.last_digest_at).filter(Boolean).sort().reverse()[0] || null;
  const digestOk = lastDigest ? (since(lastDigest) as number) <= 1 : false;
  const paysWeek = payments.filter((p) => { const d = since(p.created_at || p.paid_on); return d !== null && d <= 7; }).length;
  const unitsWeek = tenants.filter((t) => { const d = since(t.created_at); return d !== null && d <= 7; }).length;
  const linked = rows.filter((r) => r.p.telegram_chat_id).length;
  const activeWeek = rows.filter((r) => r.sinceLast !== null && r.sinceLast <= 7).length;

  // ---------- النمو والمصادر ----------
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = daysAgo(i * 7), start = daysAgo((i + 1) * 7);
    const n = rows.filter((r) => { const t = Date.parse(r.p.created_at || ""); return !isNaN(t) && t > start.getTime() && t <= end.getTime(); }).length;
    return { label: i === 0 ? "هذا الأسبوع" : `-${i}`, n };
  }).reverse();
  const maxWeek = Math.max(1, ...weeks.map((w) => w.n));
  const bySource: Record<string, { n: number; act: number; paid: number }> = {};
  rows.forEach((r) => { const k = sourceLabel(r.p.signup_source); bySource[k] ||= { n: 0, act: 0, paid: 0 }; bySource[k].n++; if (r.props > 0) bySource[k].act++; if (r.sub.paid) bySource[k].paid++; });
  const sources = Object.entries(bySource).sort((a, b) => b[1].n - a[1].n);

  // ---------- الجدول ----------
  const view = searchParams?.view || "all";
  const sort = searchParams?.sort || "stage";
  const inTrial = (r: Row) => r.trialLeft !== null && r.trialLeft >= 0 && !r.sub.paid;
  let shown = rows.filter((r) => view === "paying" ? r.stage === "paying" : view === "trial" ? inTrial(r) : view === "dormant" ? r.props === 0 : view === "expired" ? r.sub.expired : true);
  shown = [...shown].sort((a, b) => sort === "recent" ? (a.sinceJoin ?? 9e9) - (b.sinceJoin ?? 9e9)
    : sort === "active" ? (a.sinceLast ?? 9e9) - (b.sinceLast ?? 9e9)
    : sort === "size" ? b.units - a.units
    : STAGE[a.stage].order - STAGE[b.stage].order || (a.sinceLast ?? 9e9) - (b.sinceLast ?? 9e9));

  const Metric = ({ v, l, sub, tone }: { v: string | number; l: string; sub?: string; tone?: "good" | "warn" | "bad" }) => (
    <div className="bg-white border border-line rounded-2xl p-4">
      <div className={`text-2xl font-bold tabular-nums ${tone === "good" ? "text-[#137a50]" : tone === "warn" ? "text-gold" : tone === "bad" ? "text-late" : "text-deep"}`}>{v}</div>
      <div className="text-xs text-muted mt-1">{l}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
  const Person = ({ r, note }: { r: Row; note: string }) => {
    const wa = waNumber(r.p.billing_phone);
    return (
      <div className="flex items-center justify-between gap-3 bg-white/10 rounded-lg px-3 py-2 text-sm">
        <div className="min-w-0">
          <b className="truncate block">{r.p.org_name || r.p.full_name || emailOf[r.p.id] || "—"}</b>
          <span className="text-[11px] opacity-80">{note}</span>
        </div>
        {wa ? <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="text-[11px] bg-[#25D366] text-white rounded-md px-2 py-1 shrink-0">واتساب</a>
          : <span className="text-[11px] opacity-60 shrink-0">لا جوال</span>}
      </div>
    );
  };

  const nothingUrgent = !hotTrials.length && !silentNew.length && !goneQuiet.length && !subEnding.length && !justExpired.length;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-deep text-xl">لوحة الإدارة</h1>
          <p className="text-xs text-muted">{new Date().toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" })} · {rows.length} حساب · {employees} موظف · قراءة فقط</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/admin/subs" className="btn btn-gold text-xs">💳 الاشتراكات والتحصيل</Link>
          <a href="https://sentry.io/" target="_blank" rel="noreferrer" className="btn btn-ghost text-xs">🐞 الأخطاء (Sentry)</a>
          <Link href="/dashboard" className="btn btn-ghost text-xs">← اللوحة</Link>
        </div>
      </div>

      {errors.length > 0 && <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm mb-4">{errors.join(" · ")}</div>}

      {/* ═══ المال ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Metric v={`${sar(revenueMonth)} ر`} l="محصَّل هذا الشهر" sub={`منذ البداية: ${sar(revenueAll)} ر`} tone={revenueMonth > 0 ? "good" : undefined} />
        <Metric v={`${sar(mrr)} ر`} l="الدخل الشهري المتكرر (MRR)" sub={`${paying.length} مشترك دافع`} tone={mrr > 0 ? "good" : undefined} />
        <Metric v={subEnding.length} l="اشتراكات تنتهي خلال 7 أيام" sub={subExpired.length ? `${subExpired.length} انتهت ولم تُجدَّد` : "لا انتهاءات قريبة"} tone={subEnding.length ? "warn" : undefined} />
        <Metric v={`${funnel[2].n}/${rows.length}`} l="حسابات أضافت بيانات فعلًا" sub={`${rows.length ? Math.round((funnel[2].n / rows.length) * 100) : 0}% تفعيل`} tone={rows.length && funnel[2].n / rows.length < 0.3 ? "bad" : undefined} />
      </div>

      {/* ═══ يحتاج تصرّفًا اليوم ═══ */}
      <section className="bg-deep text-[#EAF1EE] rounded-2xl p-5 mb-6">
        <div className="font-display font-bold text-goldSoft mb-3">يحتاج تصرّفًا اليوم</div>
        {nothingUrgent ? <div className="text-sm opacity-80">لا شيء عاجل — يوم هادئ.</div> : (
          <div className="grid md:grid-cols-2 gap-4">
            {subEnding.length > 0 && <div><div className="text-xs opacity-70 mb-1.5">💳 اشتراك ينتهي خلال أسبوع — رسالة تجديد</div><div className="space-y-1.5">{subEnding.map((r) => <Person key={r.p.id} r={r} note={`${PLAN_AR[String(r.p.plan)] || r.p.plan} · ينتهي ${fmt(r.p.subscribed_until)} · ${r.units} وحدة`} />)}</div></div>}
            {hotTrials.length > 0 && <div><div className="text-xs opacity-70 mb-1.5">🔥 تجربة تنتهي خلال أسبوع وقد أدخل بيانات — أقرب اشتراك محتمل</div><div className="space-y-1.5">{hotTrials.map((r) => <Person key={r.p.id} r={r} note={`${r.trialLeft === 0 ? "ينتهي اليوم" : `بقي ${r.trialLeft} يوم`} · ${r.props} عقار · ${r.units} وحدة · ${r.pays} دفعة`} />)}</div></div>}
            {justExpired.length > 0 && <div><div className="text-xs opacity-70 mb-1.5">⏰ انتهت تجربته خلال أسبوعين وكان نشطًا — لم يشترك</div><div className="space-y-1.5">{justExpired.map((r) => <Person key={r.p.id} r={r} note={`انتهت ${fmt(r.p.trial_ends_at)} · ${r.units} وحدة · آخر نشاط ${agoLabel(r.sinceLast)}`} />)}</div></div>}
            {silentNew.length > 0 && <div><div className="text-xs opacity-70 mb-1.5">👋 سجّل ولم يضف شيئًا — اعرض التجهيز اليدوي</div><div className="space-y-1.5">{silentNew.slice(0, 6).map((r) => <Person key={r.p.id} r={r} note={`سجّل ${agoLabel(r.sinceJoin)} · ${sourceLabel(r.p.signup_source)}${r.p.account_type ? "" : " · لم يكمل الترحيب"}`} />)}</div></div>}
            {goneQuiet.length > 0 && <div><div className="text-xs opacity-70 mb-1.5">😶 أضاف بيانات ثم صمت أسبوعين — اسأله ما أوقفه</div><div className="space-y-1.5">{goneQuiet.slice(0, 6).map((r) => <Person key={r.p.id} r={r} note={`آخر نشاط ${agoLabel(r.sinceLast)} · ${r.units} وحدة`} />)}</div></div>}
          </div>
        )}
      </section>

      {/* ═══ القمع + الصحة ═══ */}
      <div className="grid lg:grid-cols-5 gap-4 mb-6">
        <section className="lg:col-span-3 bg-white border border-line rounded-2xl p-5">
          <h2 className="font-semibold text-deep mb-3">قمع التحويل — أين يتسرّب الناس؟</h2>
          <div className="space-y-2">
            {funnel.map((f, i) => {
              const prev = i === 0 ? f.n : funnel[i - 1].n;
              const pct = rows.length ? Math.round((f.n / rows.length) * 100) : 0;
              const drop = i === 0 ? null : prev ? Math.round(((prev - f.n) / prev) * 100) : 0;
              return (
                <div key={f.k} className="flex items-center gap-3 text-sm">
                  <div className="w-28 text-muted">{f.k}</div>
                  <div className="flex-1 bg-paper rounded-full h-5 overflow-hidden"><div className="h-full bg-gold rounded-full" style={{ width: `${pct}%` }} /></div>
                  <div className="w-10 text-right font-bold tabular-nums">{f.n}</div>
                  <div className={`w-16 text-[11px] tabular-nums ${drop !== null && drop >= 50 ? "text-late font-semibold" : "text-muted"}`}>{drop === null ? "" : `−${drop}%`}</div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted mt-3">النسبة الحمراء = أكبر تسرّب. هناك تُصرف ساعات الأسبوع.</p>
        </section>
        <section className="lg:col-span-2 bg-white border border-line rounded-2xl p-5">
          <h2 className="font-semibold text-deep mb-3">صحة المنصة</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between gap-2"><span className="text-muted">ملخّص تليجرام اليومي</span><span className={digestOk ? "text-[#137a50] font-semibold" : "text-late font-semibold"}>{lastDigest ? `${digestOk ? "✓" : "⚠️"} ${agoLabel(since(lastDigest))}` : "لم يُرسل بعد"}</span></li>
            <li className="flex justify-between gap-2"><span className="text-muted">نشطون خلال 7 أيام</span><b className="tabular-nums">{activeWeek} / {rows.length}</b></li>
            <li className="flex justify-between gap-2"><span className="text-muted">دفعات هذا الأسبوع</span><b className="tabular-nums">{paysWeek}</b></li>
            <li className="flex justify-between gap-2"><span className="text-muted">وحدات أُضيفت هذا الأسبوع</span><b className="tabular-nums">{unitsWeek}</b></li>
            <li className="flex justify-between gap-2"><span className="text-muted">مرتبطون بتليجرام</span><b className="tabular-nums">{linked} / {rows.length}</b></li>
            <li className="flex justify-between gap-2"><span className="text-muted">على المنصة</span><b className="tabular-nums text-xs">{properties.length} عقار · {tenants.length} وحدة · {payments.length} دفعة</b></li>
          </ul>
          <p className="text-[11px] text-muted mt-3">الأخطاء التقنية تصلك من Sentry على بريدك لحظة وقوعها.</p>
        </section>
      </div>

      {/* ═══ النمو والمصادر ═══ */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <section className="bg-white border border-line rounded-2xl p-5">
          <h2 className="font-semibold text-deep mb-3">تسجيلات آخر 8 أسابيع</h2>
          <div className="flex items-end gap-1.5 h-28">
            {weeks.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="text-[11px] font-semibold tabular-nums">{w.n}</div>
                <div className={`w-full rounded-t ${w.n ? "bg-gold" : "bg-paper2"}`} style={{ height: `${Math.max(4, (w.n / maxWeek) * 80)}px` }} />
                <div className="text-[10px] text-muted">{w.label}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="bg-white border border-line rounded-2xl p-5">
          <h2 className="font-semibold text-deep mb-3">القنوات — أيها يجلب من يبقى؟</h2>
          {!sources.length ? <p className="text-sm text-muted">لا بيانات بعد.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-muted"><th className="text-right font-normal pb-1">القناة</th><th className="font-normal pb-1">سجّل</th><th className="font-normal pb-1">فعّل</th><th className="font-normal pb-1">اشترك</th></tr></thead>
              <tbody>{sources.map(([k, v]) => (
                <tr key={k} className="border-t border-line"><td className="py-1.5">{k}</td><td className="py-1.5 text-center tabular-nums">{v.n}</td><td className="py-1.5 text-center tabular-nums">{v.act}<span className="text-[10px] text-muted"> ({v.n ? Math.round((v.act / v.n) * 100) : 0}%)</span></td><td className="py-1.5 text-center tabular-nums font-semibold">{v.paid}</td></tr>
              ))}</tbody>
            </table>
          )}
          <p className="text-[11px] text-muted mt-3">القناة الأفضل ليست الأكثر تسجيلًا — بل الأعلى في عمود «اشترك».</p>
        </section>
      </div>

      {/* ═══ الحسابات ═══ */}
      <section className="bg-white border border-line rounded-2xl">
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line">
          <h2 className="font-semibold text-deep flex-1">الحسابات ({shown.length})</h2>
          {([["all", `الكل ${rows.length}`], ["paying", `مشتركون ${paying.length}`], ["trial", `في التجربة ${rows.filter(inTrial).length}`], ["dormant", `لم يبدؤوا ${rows.filter((r) => r.props === 0).length}`], ["expired", `منتهون ${rows.filter((r) => r.sub.expired).length}`]] as const).map(([k, l]) => (
            <Link key={k} href={`/admin?view=${k}&sort=${sort}`} className={`text-xs px-3 py-1 rounded-full border ${view === k ? "bg-deep text-goldSoft border-deep" : "border-line text-muted"}`}>{l}</Link>
          ))}
          <span className="text-muted text-xs mx-1">|</span>
          {([["stage", "بالمرحلة"], ["recent", "الأحدث"], ["active", "الأنشط"], ["size", "الأكبر"]] as const).map(([k, l]) => (
            <Link key={k} href={`/admin?view=${view}&sort=${k}`} className={`text-xs px-2.5 py-1 rounded-full border ${sort === k ? "border-gold text-gold" : "border-line text-muted"}`}>{l}</Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs text-muted">
              <tr>
                <th className="text-right px-3 py-2">الحساب</th><th className="text-right px-3 py-2">المرحلة</th><th className="text-right px-3 py-2">المصدر</th>
                <th className="text-right px-3 py-2">سجّل</th><th className="text-right px-3 py-2">آخر نشاط</th><th className="text-right px-3 py-2">التجربة / الاشتراك</th>
                <th className="text-right px-3 py-2">البيانات</th><th className="text-right px-3 py-2">تليجرام</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const wa = waNumber(r.p.billing_phone);
                return (
                  <tr key={r.p.id} className="border-t border-line align-top">
                    <td className="px-3 py-2"><b className="text-deep">{r.p.org_name || r.p.full_name || "—"}</b><div className="text-[11px] text-muted" dir="ltr">{emailOf[r.p.id]}</div>{r.staff > 0 && <div className="text-[11px] text-muted">👥 {r.staff} موظف</div>}</td>
                    <td className="px-3 py-2"><span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STAGE[r.stage].cls}`}>{STAGE[r.stage].label}</span></td>
                    <td className="px-3 py-2 text-muted">{sourceLabel(r.p.signup_source)}</td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">{agoLabel(r.sinceJoin)}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${r.sinceLast !== null && r.sinceLast <= 7 ? "text-[#137a50] font-semibold" : r.sinceLast === null ? "text-late" : "text-muted"}`}>{r.sinceLast === null ? "لا نشاط" : agoLabel(r.sinceLast)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.sub.paid ? <span className="text-[#137a50] font-semibold">{PLAN_AR[String(r.p.plan)] || r.p.plan} · حتى {fmt(r.p.subscribed_until)}</span>
                        : inTrial(r) ? <span className={(r.trialLeft as number) <= 7 ? "text-gold font-semibold" : ""}>تجربة · {r.trialLeft} يوم</span>
                        : <span className="text-late">منتهية</span>}
                      {r.paidTotal > 0 && <div className="text-[11px] text-muted">دفع {sar(r.paidTotal)} ر</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{r.props ? `${r.props} عقار · ${r.units} وحدة · ${r.pays} دفعة` : <span className="text-late">لم يبدأ</span>}</td>
                    <td className="px-3 py-2">{r.p.telegram_chat_id ? "✓" : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{wa ? <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="text-[11px] bg-[#25D366] text-white rounded-md px-2 py-1">واتساب</a> : <span className="text-[11px] text-muted">لا جوال</span>}</td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted">لا حسابات في هذا التصنيف.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
