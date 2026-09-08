import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import AdsWorkspace from "@/components/AdsWorkspace";

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

  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const [{ data: profiles }, { data: props }, { data: posts, error: postsErr }, { data: team }] = await Promise.all([
    db.from("profiles").select("id,created_at,signup_source,subscribed_until"),
    db.from("properties").select("user_id"),
    db.from("ad_posts").select("*").order("posted_at", { ascending: false }).limit(60),
    db.from("team_members").select("member_id"),
  ]);

  const members = new Set((team || []).map((t: any) => t.member_id));
  const accounts = (profiles || []).filter((p: any) => !members.has(p.id));
  const withProps = new Set((props || []).map((p: any) => p.user_id));

  const CH = [
    { k: "haraj", l: "حراج" }, { k: "twitter", l: "تويتر / X" },
    { k: "group", l: "قروبات" }, { k: "direct", l: "تواصل مباشر" }, { k: "other", l: "أخرى" },
  ];
  const srcKey: Record<string, string> = { haraj: "haraj", twitter: "twitter", group: "group", direct: "direct" };

  const perChannel = CH.map((c) => {
    const src = srcKey[c.k];
    const list = src ? accounts.filter((p: any) => p.signup_source === src) : [];
    const activated = list.filter((p: any) => withProps.has(p.id)).length;
    const paid = list.filter((p: any) => p.subscribed_until && Date.parse(p.subscribed_until) > Date.now()).length;
    const postCount = (posts || []).filter((p: any) => p.channel === c.k).length;
    const last = (posts || []).find((p: any) => p.channel === c.k)?.posted_at || null;
    return { ...c, signups: list.length, activated, paid, postCount, last, perPost: postCount ? (list.length / postCount) : null };
  });

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
