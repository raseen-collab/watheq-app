import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { parseHttpDate, summarize } from "@/lib/clock-diag";

export const dynamic = "force-dynamic";

/**
 * تشخيص «JWT issued at future» — قياس لا تخمين.
 *
 * الاستدعاء:  GET /api/admin/clock            (ثمانية قياسات)
 *             GET /api/admin/clock?n=20       (حتى عشرين)
 *
 * الحماية: نفس حماية /admin — قائمة ADMIN_USER_IDS. غير ذلك 404، فلا
 * يُعرف حتى أن المسار موجود.
 *
 * ما يقيسه: ترويسة `Date` في ردّ خادم المصادقة مقابل ترويسة `Date` في ردّ
 * خادم البيانات، في لحظة واحدة. الفرق الموجب = المصادقة تسبق البيانات =
 * الرمز يولد «في المستقبل» بنظر خادم البيانات فيُرفض. اقرأ lib/clock-diag.ts
 * لتفصيل لماذا لا يصلح المقياس السابق (clock_probe) لهذا.
 *
 * تشخيصي مؤقت — يُحذف بعد إغلاق المشكلة مع الدالة clock_probe.
 */

type Sample = {
  round: number;
  /** ساعة خادم المصادقة (ثوانٍ) */
  auth: number | null;
  /** ساعة خادم البيانات (ثوانٍ) */
  rest: number | null;
  /** auth − rest: موجب = المصادقة تسبق */
  diff: number | null;
  /** من ردّ فعلًا — للتحقّق أن القياس ليس للبوّابة نفسها مرتين */
  authServer: string | null;
  restServer: string | null;
  authStatus: number;
  restStatus: number;
  /** ساعة خادم التطبيق (Vercel) لحظة القياس — مرجع ثالث */
  app: number;
};

async function probe(url: string, apikey: string) {
  /* رأس فقط: لا جسم، لا بيانات، أخفّ رحلة ممكنة.
     apikey يُرسل لأن البوّابة ترفض بدونه قبل أن يردّ الخادم الخلفي. */
  const r = await fetch(url, {
    method: "GET",
    headers: { apikey, Authorization: `Bearer ${apikey}` },
    cache: "no-store",
  });
  /* نستهلك الجسم ونُسقطه: تركه معلّقًا يُبقي الاتصال مفتوحًا */
  try { await r.arrayBuffer(); } catch { /* لا يهم */ }
  return {
    status: r.status,
    date: parseHttpDate(r.headers.get("date")),
    server: r.headers.get("server"),
  };
}

export async function GET(req: Request) {
  /* ── الحماية: نفس حماية /admin حرفيًّا ── */
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const allowed = (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!user || !allowed.length || !allowed.includes(user.id)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!base || !apikey) {
    return NextResponse.json({ ok: false, error: "متغيّرات Supabase غير مضبوطة" }, { status: 500 });
  }

  const n = Math.min(20, Math.max(1, Number(new URL(req.url).searchParams.get("n")) || 8));
  const AUTH = `${base}/auth/v1/health`;
  const REST = `${base}/rest/v1/`;

  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    /* نقلب الترتيب كل دورة: لو كان أحد الخادمين أبطأ، أفاد التبادل في
       إلغاء أثر التأخير على الفرق بدل أن يُضاف إليه في اتجاه واحد. */
    const authFirst = i % 2 === 0;
    const app = Math.round(Date.now() / 1000);
    let a, p;
    try {
      if (authFirst) { a = await probe(AUTH, apikey); p = await probe(REST, apikey); }
      else           { p = await probe(REST, apikey); a = await probe(AUTH, apikey); }
    } catch (e: any) {
      samples.push({ round: i + 1, auth: null, rest: null, diff: null, authServer: null,
        restServer: null, authStatus: 0, restStatus: 0, app });
      continue;
    }
    samples.push({
      round: i + 1,
      auth: a.date, rest: p.date,
      diff: a.date !== null && p.date !== null ? a.date - p.date : null,
      authServer: a.server, restServer: p.server,
      authStatus: a.status, restStatus: p.status,
      app,
    });
    /* فاصل قصير: القياسات المتلاصقة تقع كلها داخل ثانية واحدة فتتشابه،
       والتوزيع على ثوانٍ مختلفة هو ما يكشف فرقًا أصغر من ثانية. */
    if (i < n - 1) await new Promise((r) => setTimeout(r, 400));
  }

  const summary = summarize(samples.map((s) => s.diff).filter((d): d is number => d !== null));

  /* المقياس القديم بجانبه — وخطؤه ظاهرًا هذه المرة لا مكتومًا كما كان في
     /admin، حيث كان try/catch يبتلع كل شيء فيظهر «لا شيء» ولا يُعرف السبب. */
  const { data: probeData, error: probeError } = await supabase.rpc("clock_probe");
  const row: any = Array.isArray(probeData) ? probeData[0] : probeData;

  return NextResponse.json({
    ok: true,
    قِيس_في: new Date().toISOString(),
    الخلاصة: summary.label,
    verdict: summary.verdict,
    summary,
    /* من ردّ فعلًا: لو تطابقت القيمتان في كل القياسات فالمردود من بوّابة
       واحدة والصفر لا يُقرأ دليل سلامة — مذكور في lib/clock-diag.ts */
    ردّ_عليه: { المصادقة: samples[0]?.authServer ?? null, البيانات: samples[0]?.restServer ?? null },
    samples,
    clock_probe: {
      iat_epoch: row?.iat_epoch ?? null,
      db_epoch: row?.db_epoch ?? null,
      skew_seconds: row?.skew_seconds ?? null,
      error: probeError?.message ?? null,
      ملاحظة: "هذا الرقم = iat ناقص ساعة القاعدة، وهو سالب دائمًا لأنه عمر الرمز. لا يُقرأ انحرافًا.",
    },
  });
}
