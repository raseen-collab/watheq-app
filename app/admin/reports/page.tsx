import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import { createClient as admin } from "@supabase/supabase-js";
import { noStoreFetch } from "@/lib/no-store-fetch";

export const dynamic = "force-dynamic";

/**
 * بلاغات «بلّغ عن مشكلة» (schema-v93) — لمالك وثيق فقط (ADMIN_USER_IDS).
 * القراءة والتحديث بمفتاح الخادم؛ الجدول مغلق على المتصفح تمامًا.
 */
async function isAdmin() {
  const { data: { user } } = await createClient().auth.getUser();
  const allowed = (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return !!user && allowed.includes(user.id);
}
function serviceDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? admin(url, key, { auth: { persistSession: false }, global: { fetch: noStoreFetch } }) : null;
}

async function setStatus(formData: FormData) {
  "use server";
  if (!(await isAdmin())) return;
  const id = String(formData.get("id") || ""), status = String(formData.get("status") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["new", "done"].includes(status)) return;
  await serviceDb()?.from("problem_reports").update({ status }).eq("id", id);
  revalidatePath("/admin/reports");
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function device(ua: string | null) {
  if (!ua) return "—";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "آخر";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "";
  return `${os}${br ? " · " + br : ""}`;
}

export default async function ReportsPage() {
  if (!(await isAdmin())) {
    return (
      <main className="min-h-screen bg-paper grid place-items-center p-6">
        <div className="text-center"><div className="text-3xl mb-2">🔒</div><p className="text-sm text-muted">هذه الصفحة لإدارة وثيق.</p></div>
      </main>
    );
  }
  const db = serviceDb();
  const { data, error } = db
    ? await db.from("problem_reports").select("*").order("created_at", { ascending: false }).limit(300)
    : { data: [], error: { message: "إعدادات ناقصة" } as any };
  const rows = (data || []) as any[];
  const uids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const { data: profs } = db && uids.length ? await db.from("profiles").select("id,full_name,org_name").in("id", uids) : { data: [] as any[] };
  const name: Record<string, string> = {};
  for (const p of (profs || []) as any[]) name[p.id] = [p.org_name, p.full_name].filter(Boolean).join(" — ") || "بلا اسم";
  const open = rows.filter((r) => r.status !== "done");
  const sentryOrg = "https://watheq.sentry.io/issues/?query=";

  return (
    <main className="min-h-screen bg-paper p-4" dir="rtl">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-xl font-bold text-deep">🐞 بلاغات المشاكل</h1>
          <Link href="/admin" className="btn btn-ghost text-xs">← لوحة الإدارة</Link>
        </div>
        {error && <p className="text-sm text-late mb-3">تعذّر التحميل: {String(error.message)} — هل شُغّل schema-v93؟</p>}
        <p className="text-sm text-muted mb-4">مفتوحة: <b className="text-ink">{open.length}</b> · الكل: {rows.length}</p>
        {rows.length === 0 && !error && <p className="text-sm text-muted p-6 text-center bg-white rounded-2xl border border-line">لا بلاغات بعد.</p>}
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <article key={r.id} className={`bg-white rounded-2xl border p-4 ${r.status === "done" ? "border-line opacity-60" : "border-gold/40"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs text-muted">
                <span><b className="text-ink">{r.user_id ? name[r.user_id] || "حساب" : "حساب محذوف"}</b> · {when(r.created_at)}</span>
                <form action={setStatus}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value={r.status === "done" ? "new" : "done"} />
                  <button className="btn btn-ghost text-xs">{r.status === "done" ? "↺ إعادة فتح" : "✓ تم الحل"}</button>
                </form>
              </div>
              <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{r.message}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-muted">
                <span>📍 <span dir="ltr">{r.path || "—"}</span></span>
                <span>📱 {device(r.user_agent)} {r.viewport ? `· ${r.viewport}` : ""}</span>
                <span>🔖 {r.app_version || "—"}</span>
                {r.sentry_event && <a className="text-gold underline" href={sentryOrg + encodeURIComponent(r.sentry_event)} target="_blank" rel="noreferrer">🧾 الخطأ في Sentry</a>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
