import { today, riyadhDate } from "@/lib/utils";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { createClient as admin } from "@supabase/supabase-js";
import { KB, normalizeAr, searchKB } from "@/lib/help-kb";
import { noStoreFetch } from "@/lib/no-store-fetch";

export const dynamic = "force-dynamic";

/**
 * مراقب مساعد الموقع.
 *
 * السؤال الذي لم يجد جوابًا أثمن من عشرة وجدت: كل واحد إمّا فجوة في الشرح
 * (نضيف مدخلًا) أو فجوة في المنتج (نبنيها). وبدون هذه الشاشة تضيع كلها.
 *
 * الحماية نفسها المعتمدة في بقية لوحة الإدارة: قائمة معرّفات في البيئة.
 */
const ar = (n: number) => n.toLocaleString("en-US");
function when(iso: string) {
  const d = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (d < 60) return `قبل ${d} دقيقة`;
  const h = Math.round(d / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  return `قبل ${Math.round(h / 24)} يومًا`;
}

export default async function HelpMonitorPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const allowed = (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!user || !allowed.includes(user.id)) {
    return (
      <main className="min-h-screen bg-paper grid place-items-center p-6">
        <div className="text-center">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-sm text-muted">هذه الصفحة لإدارة وثيق.</p>
        </div>
      </main>
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = url && key ? admin(url, key, { auth: { persistSession: false }, global: { fetch: noStoreFetch } }) : null;
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: rows, error } = db
    ? await db.from("help_queries").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(3000)
    : { data: [], error: null as any };

  const all = (rows || []) as any[];
  const unanswered = all.filter((r) => !r.answered);
  const rate = all.length ? Math.round(((all.length - unanswered.length) / all.length) * 100) : 0;

  /* (6 نوفمبر 2026) تقييم الأجوبة — schema-v80. غيابه لا يُسقط الصفحة */
  const fb = db ? await db.from("help_feedback").select("question,matched_id,helpful,created_at").gte("created_at", since).limit(3000) : { data: [], error: null as any };
  const feedback = (fb.error ? [] : fb.data || []) as any[];
  const fbMissing = !!fb.error;
  const ups = feedback.filter((f) => f.helpful).length, downs = feedback.length - ups;

  /* من سأل: مكتب مسجّل (اسمه) · زائر · من داخل التجربة — بلا بريد ولا جوال */
  const uids = [...new Set(all.map((r) => r.user_id).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (db && uids.length) {
    const { data: ps } = await db.from("profiles").select("id,org_name,full_name").in("id", uids.slice(0, 500));
    for (const p of (ps || []) as any[]) names[p.id] = p.org_name || p.full_name || "مكتب";
  }
  const who = (r: any) => String(r.path || "").startsWith("/demo") ? "🧪 التجربة" : r.user_id ? `🏢 ${names[r.user_id] || "مكتب"}` : "👤 زائر";
  const kbTitle = (id: string | null) => (id ? KB.find((k) => k.id === id)?.q || id : "");
  const sources = new Map<string, number>();
  for (const r of all) { const k = who(r).startsWith("🏢") ? "🏢 مكاتب مسجّلة" : who(r); sources.set(k, (sources.get(k) || 0) + 1); }

  /* أجوبة تحتاج مراجعة: قيّمها السائل «ما أفاد»، أو طابقت بثقة ضعيفة
     («ما هي العقار المسجل» طابقت «تذكير على العقار» — مُجابة شكلًا لا فعلًا) */
  const downKey = new Set(feedback.filter((f) => !f.helpful).map((f) => normalizeAr(f.question)));
  const review = all.filter((r) => r.answered && (downKey.has(normalizeAr(r.question)) || (r.score != null && Number(r.score) < 5)))
    .slice(0, 30).map((r) => ({ ...r, down: downKey.has(normalizeAr(r.question)) }));

  /* الأسئلة العاجزة مجمَّعة: عشر صياغات لسؤال واحد تعني حاجة واحدة —
     بالتطبيع العربي (همزات، تاء مربوطة، علامات) لا بالمسافات فقط */
  const norm = (s: string) => normalizeAr(s);
  const gaps = new Map<string, { q: string; n: number; last: string; who: string }>();
  for (const r of unanswered) {
    const k = norm(r.question);
    const cur = gaps.get(k);
    if (cur) { cur.n++; if (r.created_at > cur.last) { cur.last = r.created_at; cur.who = who(r); } }
    else gaps.set(k, { q: r.question, n: 1, last: r.created_at, who: who(r) });
  }
  /* سؤال قديم بلا جواب قد يكون سُدّ بعده: نعيد البحث بالقاعدة الحالية فيُعرف ما بقي مفتوحًا فعلًا */
  const gapList = [...gaps.values()].map((g) => ({ ...g, now: searchKB(g.q, 1)[0]?.entry.q || "" }))
    .sort((a, b) => Number(!!a.now) - Number(!!b.now) || b.n - a.n || b.last.localeCompare(a.last));
  const openGaps = gapList.filter((g) => !g.now).length;

  /* المداخل الأكثر طلبًا — تقول أين يتعثّر المكتب فعلًا */
  const hitCount = new Map<string, number>();
  for (const r of all) if (r.matched_id) hitCount.set(r.matched_id, (hitCount.get(r.matched_id) || 0) + 1);
  const top = [...hitCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([id, n]) => ({ n, q: KB.find((k) => k.id === id)?.q || id }));

  /* أيام الرياض لا غرينتش: اليوم يبدأ عند منتصف ليل الرياض، والسؤال يُنسب ليومه هناك */
  const t0 = Date.parse(today() + "T12:00:00+03:00");
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = riyadhDate(t0 - (13 - i) * 86400000);
    return { d, n: all.filter((r) => riyadhDate(r.created_at) === d).length };
  });
  const maxDay = Math.max(1, ...days.map((x) => x.n));

  return (
    <main className="min-h-screen bg-paper">
      <div className="bg-deep text-[#EAF1EE] px-5 py-4 wq-safe-top">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div>
            <div className="font-display font-bold text-goldSoft">🛟 مراقب المساعد</div>
            <div className="text-[11px] opacity-75">آخر ٣٠ يومًا · ما يسأله الناس وما عجز عنه</div>
          </div>
          <Link href="/admin" className="text-xs text-[#CFE0DB] hover:text-white">← الإدارة</Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-5">
        {error && (
          <div className="bg-[#FBE9E7] border border-[#F5C6C2] text-[#a5322c] rounded-xl p-3 text-sm">
            {/relation|does not exist/i.test(String(error.message))
              ? "شغّل schema-v37 في قاعدة البيانات أولًا."
              : String(error.message)}
          </div>
        )}

        {fbMissing && (
          <div className="bg-[#FBF1DF] border border-goldSoft rounded-xl p-3 text-xs text-ink">
            تقييم الأجوبة (👍/👎) يحتاج تشغيل <b>schema-v80-help-feedback.sql</b> مرة واحدة في Supabase.
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { v: ar(all.length), l: "سؤالًا" },
            { v: `${rate}%`, l: "وجدت جوابًا", tone: rate >= 80 ? "text-[#137a50]" : rate >= 60 ? "text-[#9A4B00]" : "text-late" },
            { v: ar(unanswered.length), l: "بلا جواب", tone: unanswered.length ? "text-late" : "text-muted" },
            { v: ar(openGaps), l: "حاجة مفتوحة", tone: openGaps ? "text-late" : "text-muted" },
            { v: fbMissing ? "—" : `${ar(ups)} / ${ar(downs)}`, l: "👍 أفاد / 👎 ما أفاد", tone: downs ? "text-late" : "text-deep" },
          ].map((c) => (
            <div key={c.l} className="bg-white border border-line rounded-xl p-3">
              <div className={`text-xl font-bold tabular-nums ${c.tone || "text-deep"}`}>{c.v}</div>
              <div className="text-[11px] text-muted">{c.l}</div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-line rounded-2xl p-4">
          <h2 className="font-display font-bold text-deep text-sm mb-3">الاستعمال — آخر ١٤ يومًا</h2>
          <div className="flex items-end gap-1 h-24">
            {days.map((x) => (
              <div key={x.d} className="flex-1 h-full flex flex-col justify-end items-center gap-1" title={`${x.d}: ${x.n}`}>
                {/* (6 نوفمبر 2026) العمود بلا ارتفاع كان يجعل كل الأعمدة خطًّا بارتفاع 3px */}
                <div className="w-full flex-1 flex items-end">
                  <div className="w-full bg-gold rounded-t" style={{ height: `${(x.n / maxDay) * 100}%`, minHeight: x.n ? 3 : 0 }} />
                </div>
                {x.n > 0 && <span className="text-[9px] text-deep font-bold tabular-nums">{x.n}</span>}
                <span className="text-[9px] text-muted">{x.d.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>

        {!!sources.size && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-muted self-center">من يسأل:</span>
            {[...sources.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <span key={k} className="bg-white border border-line rounded-full px-3 py-1">{k} <b className="tabular-nums">{ar(n)}</b></span>
            ))}
          </div>
        )}

        {/* أثمن ما في الشاشة */}
        <div className="bg-white border-2 border-[#F5C6C2] rounded-2xl p-4">
          <h2 className="font-display font-bold text-late text-sm mb-1">أسئلة بلا جواب — سدّها</h2>
          <p className="text-[11px] text-muted mb-3">
            كل سطر إمّا فجوة في الشرح (أضف مدخلًا في <code>lib/help-kb.ts</code>) أو فجوة في المنتج (ابنِها).
          </p>
          {!gapList.length ? (
            <p className="text-sm text-muted text-center py-4">لا أسئلة عاجزة — المساعد يغطّي ما يُسأل عنه.</p>
          ) : (
            <div className="space-y-1.5">
              {gapList.slice(0, 40).map((g) => (
                <div key={g.q} className="flex items-start justify-between gap-3 border-b border-line pb-1.5">
                  <span className="min-w-0">
                    <span className={`text-sm ${g.now ? "text-muted line-through decoration-1" : "text-ink"}`}>{g.q}</span>
                    <span className="block text-[11px] text-muted">
                      {g.who}{g.now && <> · <span className="text-[#137a50]">✓ صار له جواب: «{g.now}»</span></>}
                    </span>
                  </span>
                  <span className="text-[11px] text-muted shrink-0 tabular-nums">
                    {g.n > 1 && <b className="text-late">×{g.n} </b>}{when(g.last)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border-2 border-[#F2DCA4] rounded-2xl p-4">
          <h2 className="font-display font-bold text-[#9A4B00] text-sm mb-1">أجوبة تحتاج مراجعة — هل أجاب المساعد فعلًا؟</h2>
          <p className="text-[11px] text-muted mb-3">
            أسئلة حُسبت «مُجابة» لكن السائل قيّمها 👎، أو طابقت مدخلًا بثقة ضعيفة. إن كان الجواب لا يخص السؤال: أضف مدخلًا جديدًا،
            أو أضف صياغة السؤال في <code>alt</code> للمدخل الصحيح في <code>lib/help-kb.ts</code>.
          </p>
          {!review.length ? <p className="text-sm text-muted text-center py-3">لا أجوبة مشكوك فيها.</p> : (
            <div className="space-y-2">
              {review.map((r) => (
                <div key={r.id} className="border-b border-line pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm text-ink">{r.down && <b className="text-late">👎 </b>}{r.question}</span>
                    <span className="text-[11px] text-muted shrink-0">{when(r.created_at)}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    أجاب بـ: <span className="text-deep">«{kbTitle(r.matched_id)}»</span>
                    {r.score != null && <> · الثقة <span className="tabular-nums">{Number(r.score).toFixed(1)}</span></>} · {who(r)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-line rounded-2xl p-4">
          <h2 className="font-display font-bold text-deep text-sm mb-3">الأكثر سؤالًا — أين يتعثّر المكتب</h2>
          {!top.length ? <p className="text-sm text-muted text-center py-3">لا بيانات بعد.</p> : (
            <div className="space-y-1.5">
              {top.map((t) => (
                <div key={t.q} className="flex items-center justify-between gap-3 text-sm border-b border-line pb-1.5">
                  <span className="text-ink">{t.q}</span>
                  <span className="text-xs text-muted tabular-nums shrink-0">{ar(t.n)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-line rounded-2xl p-4">
          <h2 className="font-display font-bold text-deep text-sm mb-3">آخر الأسئلة</h2>
          <div className="space-y-1.5 max-h-80 overflow-auto">
            {all.slice(0, 60).map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 text-sm border-b border-line pb-1.5">
                <span className="min-w-0">
                  <span className={r.answered ? "text-ink" : "text-late font-semibold"}>{r.answered ? "✓ " : "✕ "}{r.question}</span>
                  <span className="block text-[11px] text-muted">
                    {r.answered ? <>← «{kbTitle(r.matched_id)}»</> : "بلا جواب"} · {who(r)}{r.path ? <> · <span dir="ltr">{r.path}</span></> : null}
                  </span>
                </span>
                <span className="text-[11px] text-muted shrink-0">{when(r.created_at)}</span>
              </div>
            ))}
            {!all.length && <p className="text-sm text-muted text-center py-3">لا أسئلة بعد.</p>}
          </div>
        </div>
      </div>
    </main>
  );
}
