import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * لوحة الإدارة — للقراءة فقط.
 *
 * الحماية: قائمة معرّفات في متغيّر البيئة ADMIN_USER_IDS (مفصولة بفاصلة).
 * لا تعتمد على حقل في قاعدة البيانات عمدًا — الحقل قد يرفعه المستخدم لنفسه
 * إن كانت سياسة التحديث على profiles سخيّة، أما متغيّر البيئة فلا يُمسّ.
 */
function serviceDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const dayISO = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const fmt = (v?: string | null) => (v ? String(v).slice(0, 10) : "—");

/** مصادر التسجيل — مطابقة لما في app/login/page.tsx */
const SOURCE_AR: Record<string, string> = {
  haraj: "حراج", group: "قروب واتساب/تليجرام", twitter: "تويتر", search: "بحث جوجل",
  referral: "توصية", direct: "تواصل مباشر", other: "أخرى", skip: "لم يذكر",
};
const sourceLabel = (v?: string | null) => SOURCE_AR[String(v || "")] || "غير معروف";

/** منذ كم يوم */
function since(v?: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}
const agoLabel = (d: number | null) =>
  d === null ? "—" : d === 0 ? "اليوم" : d === 1 ? "أمس" : `قبل ${d} يوم`;

/** رقم سعودي إلى صيغة wa.me */
function waNumber(raw?: string | null): string | null {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("966")) return d;
  if (d.startsWith("0")) return "966" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) return "966" + d;
  return d.length >= 9 ? d : null;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: { view?: string; sort?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const allowed = (process.env.ADMIN_USER_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  // لا نكشف وجود الصفحة لغير المصرّح لهم
  if (!allowed.length || !allowed.includes(user.id)) notFound();

  const db = serviceDb();

  const [profilesRes, propsRes, tenantsRes, assocRes, ownersRes, paysRes, invRes, budgetsRes] =
    await Promise.all([
      db.from("profiles").select("id,full_name,org_name,account_type,created_at,trial_ends_at,telegram_chat_id,billing_phone,last_digest_at,signup_source").order("created_at", { ascending: false }).limit(1000),
      db.from("properties").select("id,user_id,created_at"),
      db.from("tenants").select("id,status,property_id,created_at"),
      db.from("associations").select("id,user_id,created_at"),
      db.from("owners").select("id,association_id,created_at"),
      db.from("payments").select("id,user_id,amount,paid_on"),
      db.from("invoices").select("id,user_id"),
      db.from("association_budgets").select("id,user_id"),
    ]);

  const profiles = profilesRes.data || [];
  const properties = propsRes.data || [];
  const tenants = tenantsRes.data || [];
  const associations = assocRes.data || [];
  const owners = ownersRes.data || [];
  const payments = paysRes.data || [];
  const invoices = invRes.data || [];
  const budgets = budgetsRes.data || [];

  const errors = [profilesRes, propsRes, tenantsRes, assocRes, ownersRes, paysRes, invRes, budgetsRes]
    .map((r) => r.error?.message).filter(Boolean) as string[];

  // ---------- خرائط مساعدة ----------
  const propOwner: Record<string, string> = {};
  properties.forEach((p: any) => (propOwner[p.id] = p.user_id));
  const assocOwner: Record<string, string> = {};
  associations.forEach((a: any) => (assocOwner[a.id] = a.user_id));

  /** آخر نشاط فعلي للمستخدم — أحدث سجلّ أنشأه في أي جدول */
  function lastActivity(uid: string): string | null {
    const stamps: string[] = [];
    properties.forEach((p: any) => { if (p.user_id === uid && p.created_at) stamps.push(p.created_at); });
    associations.forEach((a: any) => { if (a.user_id === uid && a.created_at) stamps.push(a.created_at); });
    tenants.forEach((t: any) => { if (propOwner[t.property_id] === uid && t.created_at) stamps.push(t.created_at); });
    owners.forEach((o: any) => { if (assocOwner[o.association_id] === uid && o.created_at) stamps.push(o.created_at); });
    payments.forEach((p: any) => { if (p.user_id === uid && p.paid_on) stamps.push(p.paid_on); });
    if (!stamps.length) return null;
    return stamps.sort().reverse()[0];
  }

  const stats = (uid: string) => ({
    props: properties.filter((p: any) => p.user_id === uid).length,
    units: tenants.filter((t: any) => propOwner[t.property_id] === uid).length,
    assoc: associations.filter((a: any) => a.user_id === uid).length,
    owners: owners.filter((o: any) => assocOwner[o.association_id] === uid).length,
    pays: payments.filter((p: any) => p.user_id === uid).length,
  });

  // ---------- صفوف مُثراة ----------
  type Row = ReturnType<typeof buildRow>;
  function buildRow(p: any) {
    const s = stats(p.id);
    const started = s.props + s.assoc > 0;
    const last = lastActivity(p.id);
    const trialLeft = p.trial_ends_at
      ? Math.round((Date.parse(p.trial_ends_at) - Date.now()) / 86400000)
      : null;
    return { p, s, started, last, sinceLast: since(last), sinceJoin: since(p.created_at), trialLeft };
  }
  const rows = profiles.map(buildRow);

  const started = rows.filter((r) => r.started);
  const dormant = rows.filter((r) => !r.started);
  const activationPct = rows.length ? Math.round((started.length / rows.length) * 100) : 0;

  const now = Date.now();
  const newWeek = rows.filter((r) => r.sinceJoin !== null && r.sinceJoin <= 7).length;
  const activeWeek = rows.filter((r) => r.sinceLast !== null && r.sinceLast <= 7).length;
  const trialLive = rows.filter((r) => r.trialLeft !== null && r.trialLeft >= 0).length;
  const trialSoon = rows.filter((r) => r.trialLeft !== null && r.trialLeft >= 0 && r.trialLeft <= 7);
  const linked = rows.filter((r) => r.p.telegram_chat_id).length;

  const paidTotal = payments.reduce((s, r: any) => s + (Number(r.amount) || 0), 0);
  const vacant = tenants.filter((t: any) => String(t.status) === "vacated").length;

  // ---------- نموّ آخر 6 أسابيع ----------
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const end = daysAgo(i * 7);
    const start = daysAgo((i + 1) * 7);
    const n = profiles.filter((p: any) => {
      const t = Date.parse(p.created_at || "");
      return !isNaN(t) && t > start.getTime() && t <= end.getTime();
    }).length;
    return { label: i === 0 ? "هذا الأسبوع" : `قبل ${i}`, n };
  }).reverse();
  const maxWeek = Math.max(1, ...weeks.map((w) => w.n));

  // ---------- الفرز والعرض ----------
  const view = searchParams?.view || "all";
  const sort = searchParams?.sort || "new";
  let shown = view === "dormant" ? dormant : view === "started" ? started : rows;
  shown = [...shown].sort((a, b) => {
    if (sort === "activity") return (a.sinceLast ?? 9999) - (b.sinceLast ?? 9999);
    if (sort === "size") return (b.s.units + b.s.owners) - (a.s.units + a.s.owners);
    return (a.sinceJoin ?? 9999) - (b.sinceJoin ?? 9999);
  });

  const K = ({ v, l, tone }: { v: string; l: string; tone?: "ok" | "warn" | "gold" }) => (
    <div className="bg-white border border-line rounded-xl p-4 shadow-sm">
      <div className={`font-display font-bold text-2xl leading-none ${
        tone === "ok" ? "text-paid" : tone === "warn" ? "text-late" : tone === "gold" ? "text-gold" : "text-deep"}`}>{v}</div>
      <div className="mt-1.5 text-sm text-muted">{l}</div>
    </div>
  );

  /** زر تواصل واتساب برسالة مناسبة للحالة */
  const Contact = ({ r }: { r: Row }) => {
    const num = waNumber(r.p.billing_phone);
    if (!num) return <span className="text-xs text-muted">لا جوال</span>;
    const name = r.p.full_name || "";
    const msg = !r.started
      ? `السلام عليكم ${name}، أنا عبيد من وثيق. لاحظت إنك سجّلت عندنا — واجهتك أي صعوبة في البداية؟ أساعدك بلا مقابل.`
      : (r.trialLeft !== null && r.trialLeft <= 7)
        ? `السلام عليكم ${name}، تجربتك في وثيق تنتهي خلال ${r.trialLeft} يوم. كيف كانت التجربة؟ وش ينقصك؟`
        : `السلام عليكم ${name}، أنا عبيد من وثيق. أطمئن على تجربتك — فيه شي تحتاجه؟`;
    return (
      <a href={`https://wa.me/${num}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"
        className="btn btn-wa text-xs px-2.5" title="تواصل عبر واتساب">💬 تواصل</a>
    );
  };

  const tab = (k: string, label: string, n: number) => (
    <Link href={`/admin?view=${k}&sort=${sort}`}
      className={`text-xs font-semibold rounded-lg px-3 py-1.5 border transition ${
        view === k ? "bg-deep text-[#F6F1E4] border-deep" : "bg-white text-deep border-line hover:border-goldSoft"}`}>
      {label} {n}
    </Link>
  );
  const sortLink = (k: string, label: string) => (
    <Link href={`/admin?view=${view}&sort=${k}`}
      className={`text-xs rounded-lg px-2.5 py-1.5 border ${
        sort === k ? "bg-paper2 text-deep border-goldSoft font-semibold" : "bg-white text-muted border-line"}`}>
      {label}
    </Link>
  );

  return (
    <div className="max-w-6xl mx-auto p-5">
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-deep text-xl">لوحة الإدارة</h1>
          <div className="text-sm text-muted">قراءة فقط · {dayISO(new Date())}</div>
        </div>
        <Link href="/admin/subs" className="btn btn-primary text-sm">💳 الاشتراكات والتجديد</Link>
        <Link href="/dashboard/property" className="btn btn-ghost text-sm">← رجوع للوحة</Link>
      </div>

      {errors.length > 0 && (
        <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 mb-4 text-sm">
          تعذّر جلب بعض البيانات: {errors.join(" · ")}
        </div>
      )}

      {/* ═══ ما يحتاج تصرّفًا اليوم ═══ */}
      {(dormant.length > 0 || trialSoon.length > 0) && (
        <div className="bg-deep text-[#EAF1EE] rounded-2xl p-5 mb-6">
          <div className="font-display font-bold text-goldSoft mb-3">يحتاج تصرّفًا اليوم</div>

          {dormant.length > 0 && (
            <div className="mb-4">
              <div className="text-sm mb-2">
                <b className="text-[#F5A9A4]">{dormant.length}</b> سجّلوا ولم يضيفوا شيئًا — تواصل معهم قبل ما ينسوك:
              </div>
              <div className="flex flex-col gap-1.5">
                {dormant.slice(0, 6).map((r) => (
                  <div key={r.p.id} className="flex items-center gap-3 bg-[#0A2C2A] rounded-lg px-3 py-2">
                    <span className="flex-1 min-w-0 text-sm truncate">
                      {r.p.full_name || "بلا اسم"}
                      <span className="text-[#9FB8B3] text-xs"> · سجّل {agoLabel(r.sinceJoin)}</span>
                    </span>
                    <Contact r={r} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {trialSoon.length > 0 && (
            <div>
              <div className="text-sm mb-2">
                <b className="text-goldSoft">{trialSoon.length}</b> تنتهي تجربتهم خلال أسبوع:
              </div>
              <div className="flex flex-col gap-1.5">
                {trialSoon.slice(0, 6).map((r) => (
                  <div key={r.p.id} className="flex items-center gap-3 bg-[#0A2C2A] rounded-lg px-3 py-2">
                    <span className="flex-1 min-w-0 text-sm truncate">
                      {r.p.full_name || "بلا اسم"}
                      <span className="text-[#9FB8B3] text-xs"> · باقٍ {r.trialLeft} يوم</span>
                    </span>
                    <Contact r={r} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ الحسابات ═══ */}
      <h2 className="font-semibold text-deep mb-2">الحسابات</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <K v={String(rows.length)} l="إجمالي الحسابات" />
        <K v={String(newWeek)} l="جديدة هذا الأسبوع" tone={newWeek ? "ok" : undefined} />
        <K v={`${activationPct}%`} l={`فعّلوا فعلًا (${started.length})`} tone={activationPct >= 50 ? "ok" : "warn"} />
        <K v={String(dormant.length)} l="لم يبدؤوا" tone={dormant.length ? "warn" : undefined} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <K v={String(activeWeek)} l="نشطوا خلال 7 أيام" tone={activeWeek ? "ok" : undefined} />
        <K v={String(trialLive)} l="تجربة سارية" tone="gold" />
        <K v={String(trialSoon.length)} l="تنتهي خلال أسبوع" tone={trialSoon.length ? "warn" : undefined} />
        <K v={String(linked)} l="ربطوا تليجرام" />
      </div>

      {/* ═══ النموّ ═══ */}
      <h2 className="font-semibold text-deep mb-2">التسجيلات — آخر 6 أسابيع</h2>
      <div className="bg-white border border-line rounded-2xl shadow-sm p-5 mb-6">
        <div className="flex items-end gap-3 h-28">
          {weeks.map((w, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="text-xs font-semibold text-deep tabular-nums">{w.n}</div>
              <div className="w-full rounded-t-md bg-gold" style={{ height: `${Math.max(4, (w.n / maxWeek) * 78)}px`, opacity: w.n ? 1 : .25 }} />
              <div className="text-[.65rem] text-muted whitespace-nowrap">{w.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ مصادر التسجيل ═══ */}
      {rows.length > 0 && (() => {
        const bySource = rows.reduce((acc, r) => {
          const k = String(r.p.signup_source || "unknown");
          acc[k] = acc[k] || { total: 0, started: 0 };
          acc[k].total++;
          if (r.started) acc[k].started++;
          return acc;
        }, {} as Record<string, { total: number; started: number }>);
        const list = Object.entries(bySource).sort((a, b) => b[1].total - a[1].total);
        const max = Math.max(1, ...list.map(([, v]) => v.total));
        return (
          <>
            <h2 className="font-semibold text-deep mb-2">من أين جاؤوا</h2>
            <div className="bg-white border border-line rounded-2xl shadow-sm p-5 mb-6">
              <div className="flex flex-col gap-2.5">
                {list.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-sm text-deep w-40 shrink-0">{sourceLabel(k)}</span>
                    <div className="flex-1 bg-paper2 rounded-full h-5 overflow-hidden">
                      <div className="h-full bg-gold rounded-full" style={{ width: `${(v.total / max) * 100}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted w-28 shrink-0 text-left">
                      {v.total} · فعّل {v.started}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted mt-4 leading-relaxed">
                القناة الأفضل ليست الأكثر تسجيلًا — بل الأعلى نسبة تفعيل. راقب العمود الأيسر.
              </p>
            </div>
          </>
        );
      })()}

      {/* ═══ النشاط ═══ */}
      <h2 className="font-semibold text-deep mb-2">النشاط على المنصة</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <K v={String(properties.length)} l="عقارات" />
        <K v={String(tenants.length)} l={`وحدات (${vacant} شاغرة)`} />
        <K v={String(associations.length)} l="جمعيات" />
        <K v={String(owners.length)} l="ملّاك" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <K v={String(payments.length)} l="دفعات مسجّلة" tone={payments.length ? "ok" : undefined} />
        <K v={sar(paidTotal)} l="إجمالي المسجّل (ريال)" />
        <K v={String(invoices.length)} l="فواتير صادرة" />
        <K v={String(budgets.length)} l="موازنات جمعيات" />
      </div>

      {/* ═══ الجدول ═══ */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="font-semibold text-deep flex-1">الحسابات ({shown.length})</h2>
        <div className="flex gap-1.5">
          {sortLink("new", "الأحدث تسجيلًا")}
          {sortLink("activity", "الأحدث نشاطًا")}
          {sortLink("size", "الأكبر حجمًا")}
        </div>
      </div>
      <div className="flex gap-1.5 mb-3">
        {tab("all", "الكل", rows.length)}
        {tab("dormant", "لم يبدؤوا", dormant.length)}
        {tab("started", "فعّلوا", started.length)}
      </div>

      <div className="bg-white border border-line rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper2"><tr>
              <th className="p-2.5 text-right font-semibold">الاسم</th>
              <th className="p-2.5 text-right font-semibold">الجهة</th>
              <th className="p-2.5 text-right font-semibold">المصدر</th>
              <th className="p-2.5 text-right font-semibold">سجّل</th>
              <th className="p-2.5 text-right font-semibold">آخر نشاط</th>
              <th className="p-2.5 text-right font-semibold">التجربة</th>
              <th className="p-2.5 text-right font-semibold">ما أضافه</th>
              <th className="p-2.5 text-right font-semibold">تواصل</th>
            </tr></thead>
            <tbody>
              {shown.slice(0, 60).map((r) => (
                <tr key={r.p.id} className={`border-t border-line ${r.started ? "" : "bg-[#FBF8F1]"}`}>
                  <td className="p-2.5 font-semibold">
                    {r.p.full_name || "—"}
                    {r.p.telegram_chat_id && <span title="ربط تليجرام"> ✅</span>}
                  </td>
                  <td className="p-2.5 text-muted text-xs">{r.p.org_name || "—"}</td>
                  <td className="p-2.5 text-muted text-xs whitespace-nowrap">{sourceLabel(r.p.signup_source)}</td>
                  <td className="p-2.5 text-muted text-xs whitespace-nowrap">{agoLabel(r.sinceJoin)}</td>
                  <td className="p-2.5 text-xs whitespace-nowrap">
                    {r.sinceLast === null
                      ? <span className="text-late">لا نشاط</span>
                      : r.sinceLast <= 7
                        ? <span className="text-paid font-semibold">{agoLabel(r.sinceLast)}</span>
                        : <span className="text-muted">{agoLabel(r.sinceLast)}</span>}
                  </td>
                  <td className="p-2.5 text-xs whitespace-nowrap">
                    {r.trialLeft === null ? "—"
                      : r.trialLeft < 0 ? <span className="text-late">انتهت</span>
                      : r.trialLeft <= 7 ? <span className="text-gold font-semibold">{r.trialLeft} يوم</span>
                      : <span className="text-paid">{r.trialLeft} يوم</span>}
                  </td>
                  <td className="p-2.5 text-xs">
                    {r.started
                      ? [
                          r.s.props ? `${r.s.props} عقار · ${r.s.units} وحدة` : "",
                          r.s.assoc ? `${r.s.assoc} جمعية · ${r.s.owners} مالك` : "",
                          r.s.pays ? `${r.s.pays} دفعة` : "",
                        ].filter(Boolean).join(" · ")
                      : <span className="text-late font-semibold">لم يبدأ</span>}
                  </td>
                  <td className="p-2.5"><Contact r={r} /></td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={8} className="p-8 text-center text-muted">لا حسابات في هذا العرض.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted leading-relaxed">
        قراءة فقط — لا تسمح هذه الصفحة بتعديل بيانات أي مستخدم.
        الوصول محكوم بمتغيّر البيئة <code>ADMIN_USER_IDS</code>، ومن ليس فيه ترجع له الصفحة كأنها غير موجودة.
      </p>
    </div>
  );
}
