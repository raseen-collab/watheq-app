import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import AdsWorkspace from "@/components/AdsWorkspace";
import { splitDemo, isPayingCustomer } from "@/lib/real-data";
import { CHOSEN_SOURCES, LINK_SOURCES, sourceAdminLabel } from "@/lib/signup-sources";
import { FUNNEL_EVENTS, FUNNEL_LABELS, summarizeFunnel } from "@/lib/funnel";
import { fetchAllRows } from "@/lib/fetch-all";
import { noStoreFetch } from "@/lib/no-store-fetch";

export const dynamic = "force-dynamic";

/**
 * صفحة الإعلانات — بديل مسؤول الإعلانات.
 *
 * قيمتها ليست توليد النص (ذلك أسهل جزء)، بل الحلقة: يكتب بحسب قواعد كل
 * قناة، ويسجّل ما نُشر، ويقيس ما نتج عنه من تسجيلات وتفعيلات فعلية، ثم
 * يبني على النتيجة. الأرقام هنا حقيقية من قاعدة البيانات لا تقديرات.
 */
export default async function AdsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const allowed = (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length || !allowed.includes(user.id)) notFound();

  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
  const [{ data: profiles }, { data: props }, { data: posts, error: postsErr }, { data: team }] = await Promise.all([
    db.from("profiles").select("id,created_at,signup_source,subscribed_until"),
    db.from("properties").select("id,user_id,is_demo"),
    db.from("ad_posts").select("*").order("posted_at", { ascending: false }).limit(60),
    db.from("team_members").select("member_id"),
  ]);

  /* قمع الزوار (schema-v76) — آخر 30 يومًا. فشل الجدول لا يُسقط الصفحة:
     يظهر تنبيه بتشغيل الملف بدل الأرقام. */
  const DAY = 86_400_000, now = Date.now();
  const since30 = new Date(now - 30 * DAY).toISOString();
  let events: { event: string; src: string | null; path: string | null; at: string }[] = [];
  let eventsErr = "";
  try {
    events = await fetchAllRows(db, "site_events", "id,event,src,path,at", (q) => q.gte("at", since30));
  } catch (e: any) { eventsErr = String(e?.message || e); }

  const members = new Set((team || []).map((t: any) => t.member_id));
  const accounts = (profiles || []).filter((p: any) => !members.has(p.id));
  /* بذرة التجربة لا تُعدّ تفعيلًا، وحسابك أنت لا يُعدّ اشتراكًا مدفوعًا —
     وإلا نسب جدول القنوات إلى قناةٍ عميلًا دافعًا لا وجود له. */
  const { realProperties } = splitDemo((props || []) as any[], [], []);
  const withProps = new Set(realProperties.map((p: any) => p.user_id));

  /* من lib/signup-sources لا نسخة يدوية: القائمة السابقة أغفلت «بحث جوجل»
     و«توصية» و«النسخة التجريبية»، فحساب جاء منها لا يُنسب لأي صفّ ويقلّ
     مجموع «سجّل» هنا عن /admin بلا إشارة. و«أخرى» كانت بلا مفتاح فتعرض «—»
     دائمًا حتى لو كان فيها حسابات. وأي مصدر يُضاف لاحقًا يظهر هنا تلقائيًّا. */
  const CH = CHOSEN_SOURCES.map((s) => ({ k: s.v, l: s.adminLabel }));
  const srcKey: Record<string, string> = Object.fromEntries(CHOSEN_SOURCES.map((s) => [s.v, s.v]));
  LINK_SOURCES.forEach((s) => { CH.push({ k: s.v, l: s.adminLabel }); srcKey[s.v] = s.v; });

  const perChannel = CH.map((c) => {
    const src = srcKey[c.k];
    const list = src ? accounts.filter((p: any) => p.signup_source === src) : [];
    const activated = list.filter((p: any) => withProps.has(p.id)).length;
    const paid = list.filter((p: any) => isPayingCustomer(p, { admins: allowed, memberIds: members })).length;
    const postCount = (posts || []).filter((p: any) => p.channel === c.k).length;
    const last = (posts || []).find((p: any) => p.channel === c.k)?.posted_at || null;
    return { ...c, signups: list.length, activated, paid, postCount, last, perPost: postCount ? (list.length / postCount) : null };
  });

  /* لكل فترة: محطات القمع لكل مصدر + الحسابات الفعلية المنشأة في الفترة نفسها
     من profiles (المرجع الحقيقي — ضغط «إنشاء» قد يفشل أو ينتظر تأكيد البريد). */
  const funnelFor = (days: number) => {
    const since = now - days * DAY;
    const { by, total } = summarizeFunnel(events, since);
    const signups: Record<string, number> = {};
    let signupsTotal = 0;
    accounts.forEach((p: any) => {
      if (Date.parse(p.created_at || "") < since) return;
      const k = p.signup_source && p.signup_source !== "skip" ? p.signup_source : "";
      signups[k] = (signups[k] || 0) + 1; signupsTotal++;
    });
    const keys = Array.from(new Set([...Object.keys(by), ...Object.keys(signups)]));
    const rows = keys.map((k) => ({
      k, label: k ? sourceAdminLabel(k) : "مباشر / غير معروف",
      ...(by[k] || { visit: 0, demo_open: 0, signup_view: 0, signup_submit: 0 }),
      signups: signups[k] || 0,
    })).sort((a, b) => (b.visit + b.demo_open + b.signups * 100) - (a.visit + a.demo_open + a.signups * 100));
    return { days, rows, total, signupsTotal };
  };
  const funnels = [funnelFor(7), funnelFor(30)];
  const landing = Object.entries(events.filter((e) => e.event === "visit").reduce((m: Record<string, number>, e) => {
    const k = e.path || "/"; m[k] = (m[k] || 0) + 1; return m;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}٪` : "—");

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-deep text-xl">📣 الإعلانات والنمو</h1>
          <p className="text-xs text-muted">يكتب بحسب قواعد كل قناة، ويتذكّر ما نُشر، ويقيس ما نتج عنه فعلًا.</p>
        </div>
        <Link href="/admin" className="btn btn-ghost text-xs">← لوحة الإدارة</Link>
      </div>

      {postsErr && <div className="bg-[#FDF6E3] border border-[#EAD9A8] text-[#7a5c12] rounded-xl p-3 text-sm mb-4">
        جدول سجل النشر غير منشأ بعد — شغّل <code>schema-v19-ad-posts.sql</code> في قاعدة البيانات ليعمل التسجيل والقياس.
      </div>}

      {/* ═══ قمع الزوار ═══ */}
      <section className="bg-white border border-line rounded-2xl p-5 mb-5">
        <h2 className="font-semibold text-deep mb-1">قمع الزوار — أين يتوقّف الناس؟</h2>
        <p className="text-[11px] text-muted mb-3">كل رقم = جلسات (زائر واحد في تبويب واحد)، لا نقرات. بلا كوكيز ولا IP.</p>
        {eventsErr ? (
          <div className="bg-[#FDF6E3] border border-[#EAD9A8] text-[#7a5c12] rounded-xl p-3 text-sm">
            جدول القمع غير منشأ بعد — شغّل <code>schema-v76-site-funnel.sql</code> في قاعدة البيانات.
          </div>
        ) : funnels.map((f) => (
          <div key={f.days} className="mb-4 last:mb-0">
            <div className="text-xs font-semibold text-deep mb-1.5">آخر {f.days} {f.days === 7 ? "أيام" : "يومًا"}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper text-xs text-muted">
                  <tr>
                    <th className="text-right px-3 py-2">المصدر</th>
                    {FUNNEL_EVENTS.map((e) => <th key={e} className="px-3 py-2">{FUNNEL_LABELS[e]}</th>)}
                    <th className="px-3 py-2">حسابات فعلية</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-center text-muted text-xs">لا بيانات بعد في هذه الفترة.</td></tr>}
                  {f.rows.map((r) => (
                    <tr key={r.k} className="border-t border-line">
                      <td className="px-3 py-2 font-medium">{r.label}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{r.visit || "—"}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{r.demo_open || "—"}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{r.signup_view || "—"}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{r.signup_submit || "—"}</td>
                      <td className="px-3 py-2 text-center tabular-nums font-semibold text-[#137a50]">{r.signups || "—"}</td>
                    </tr>
                  ))}
                  {f.rows.length > 0 && (
                    <tr className="border-t-2 border-line bg-paper/60 font-semibold">
                      <td className="px-3 py-2">المجموع</td>
                      {FUNNEL_EVENTS.map((e) => <td key={e} className="px-3 py-2 text-center tabular-nums">{f.total[e] || "—"}</td>)}
                      <td className="px-3 py-2 text-center tabular-nums text-[#137a50]">{f.signupsTotal || "—"}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {f.total.visit > 0 && (
              <p className="text-[11px] text-muted mt-1.5">
                من الزيارات: فتح التجربة {pct(f.total.demo_open, f.total.visit)} · وصل التسجيل {pct(f.total.signup_view, f.total.visit)} · ضغط إنشاء {pct(f.total.signup_submit, f.total.visit)}
              </p>
            )}
          </div>
        ))}
        {!eventsErr && landing.length > 0 && (
          <div className="mt-3 text-xs">
            <div className="font-semibold text-deep mb-1">صفحات الدخول للموقع (30 يومًا)</div>
            <div className="flex flex-wrap gap-1.5">
              {landing.map(([p, n]) => <span key={p} className="bg-paper border border-line rounded-lg px-2 py-1 tabular-nums" dir="ltr">{p} · {n}</span>)}
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted mt-3">
          «حسابات فعلية» من سجل الحسابات لا من الضغطات — الضغط قد يفشل أو ينتظر تأكيد البريد. القياس بدأ يوم رفع v76؛ ما قبله غير موجود.
        </p>
      </section>

      {/* ═══ أداء القنوات ═══ */}
      <section className="bg-white border border-line rounded-2xl p-5 mb-5">
        <h2 className="font-semibold text-deep mb-3">أداء القنوات — ما الذي يجلب من يبقى؟</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs text-muted">
              <tr>
                <th className="text-right px-3 py-2">القناة</th><th className="px-3 py-2">منشورات</th>
                <th className="px-3 py-2">تسجيلات</th><th className="px-3 py-2">فعّلوا</th><th className="px-3 py-2">اشتركوا</th>
                <th className="px-3 py-2">تسجيل/منشور</th><th className="text-right px-3 py-2">آخر نشر</th>
              </tr>
            </thead>
            <tbody>
              {perChannel.map((c) => (
                <tr key={c.k} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{c.l}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{c.postCount || "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums font-semibold">{c.signups || "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{c.activated || "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums font-semibold text-[#137a50]">{c.paid || "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{c.perPost !== null ? c.perPost.toFixed(1) : "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{c.last ? String(c.last).slice(0, 10) : "لم يُنشر"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted mt-3">
          «تسجيل/منشور» يقيس كفاءة القناة لا حجمها. القناة التي تعطي اشتراكًا واحدًا خير من التي تعطي عشرة تسجيلات صامتة.
        </p>
      </section>

      <AdsWorkspace posts={(posts || []) as any[]} />
    </main>
  );
}
