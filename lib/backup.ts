import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * وثيق — النسخة الاحتياطية اليومية للقاعدة كاملة (22 نوفمبر 2026).
 *
 * لماذا لا قائمة جداول ثابتة: كل ترحيل جديد يضيف جدولًا، وقائمة مكتوبة باليد
 * تنسى الجدول الجديد بصمت (هذا ما حدث لتصدير المكتب حتى 16 نوفمبر). هنا نقرأ
 * قائمة الجداول من وصف PostgREST نفسه (OpenAPI) — كل جدول مكشوف يدخل تلقائيًّا،
 * ومعه أعمدة مفتاحه الأساسي للترتيب الثابت بين الصفحات.
 *
 * ما لا يدخل: ملفات Storage (صور المعروضات والمرفقات) — القاعدة فيها مسارها فقط.
 */

export const BUCKET = "backups";
export const DAILY_KEEP_DAYS = 30;
const PAGE = 1000;
const HARD_CAP = 2_000_000; // سقف أمان لكل جدول: خطأ صريح لا ملف ناقص يبدو كاملًا

export type TableSpec = { name: string; pk: string[] };

/** من وصف OpenAPI (Swagger 2) لـ PostgREST: الجداول/العروض وأعمدة المفتاح الأساسي */
export function tablesFromOpenApi(spec: any): TableSpec[] {
  const defs = spec?.definitions || {};
  const paths = spec?.paths || {};
  const out: TableSpec[] = [];
  for (const name of Object.keys(defs).sort()) {
    if (!paths["/" + name]) continue; // تعريفات بلا مسار (أنواع مركّبة) ليست جداول
    const props = defs[name]?.properties || {};
    const pk = Object.keys(props).filter((c) => /<pk\/>/.test(String(props[c]?.description || "")));
    out.push({ name, pk });
  }
  return out;
}

/** أسماء ملفات daily/YYYY-MM-DD.wqbk الأقدم من keepDays — للحذف */
export function expiredDaily(names: string[], todayISO: string, keepDays = DAILY_KEEP_DAYS): string[] {
  const cutoff = Date.parse(todayISO + "T00:00:00Z") - keepDays * 86400000;
  return names.filter((n) => {
    const m = /^(\d{4}-\d{2}-\d{2})\.wqbk$/.exec(n);
    return !!m && Date.parse(m[1] + "T00:00:00Z") < cutoff;
  });
}

export const riyadhToday = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export async function listTables(url: string, serviceKey: string): Promise<TableSpec[]> {
  const r = await fetch(url.replace(/\/$/, "") + "/rest/v1/", {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/openapi+json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`تعذّر قراءة قائمة الجداول (OpenAPI ${r.status})`);
  const tables = tablesFromOpenApi(await r.json());
  if (!tables.length) throw new Error("قائمة الجداول فارغة — لن تُكتب نسخة فارغة على أنها كاملة");
  return tables;
}

/** كل صفوف جدول على دفعات، مرتبة بمفتاحه الأساسي. فشل أي صفحة = خطأ (لا نصف جدول) */
export async function dumpTable(db: SupabaseClient, t: TableSpec): Promise<{ rows: any[]; ordered: boolean }> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q: any = db.from(t.name).select("*");
    for (const c of t.pk) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${t.name}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    if (rows.length >= HARD_CAP) throw new Error(`${t.name}: أكثر من ${HARD_CAP} صف`);
  }
  return { rows, ordered: t.pk.length > 0 };
}

/** حسابات الدخول (auth.users) — بلا كلمات مرور (الواجهة لا تُرجعها أصلًا) */
export async function dumpUsers(db: SupabaseClient): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth.users: ${error.message}`);
    const users = data?.users || [];
    out.push(...users.map((u: any) => ({
      id: u.id, email: u.email, phone: u.phone, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at, user_metadata: u.user_metadata, app_metadata: u.app_metadata,
    })));
    if (users.length < 1000) break;
  }
  return out;
}

export type BackupResult = {
  json: string;
  counts: Record<string, number>;
  unordered: string[]; // جداول بلا مفتاح أساسي وفيها أكثر من صفحة — ترتيبها بين الصفحات غير مضمون
  failed: string[];
};

/**
 * يجمع النسخة. جدول يفشل لا يوقف الباقي — لكنه يُسجَّل في failed ويُبلَّغ عنه،
 * والنسخة تُعلَّم «ناقصة» داخل الملف نفسه.
 */
export async function buildBackup(db: SupabaseClient, url: string, serviceKey: string, now = new Date()): Promise<BackupResult> {
  const tables = await listTables(url, serviceKey);
  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  const failed: string[] = [];
  const unordered: string[] = [];
  for (let i = 0; i < tables.length; i += 4) {
    await Promise.all(tables.slice(i, i + 4).map(async (t) => {
      try {
        const { rows, ordered } = await dumpTable(db, t);
        data[t.name] = rows; counts[t.name] = rows.length;
        if (!ordered && rows.length > PAGE) unordered.push(t.name);
      } catch (e: any) { failed.push(String(e?.message || e)); }
    }));
  }
  try { data["auth.users"] = await dumpUsers(db); counts["auth.users"] = data["auth.users"].length; }
  catch (e: any) { failed.push(String(e?.message || e)); }

  const json = JSON.stringify({
    format: "watheq-backup", version: 1, created_at: now.toISOString(), day: riyadhToday(now),
    complete: failed.length === 0, failed, unordered, counts, tables: data,
  });
  return { json, counts, unordered, failed };
}

/** (23 نوفمبر) الجمعة بتوقيت الرياض — يوم إرسال نسخة إلى تليجرام خارج Supabase */
export const isOffsiteDay = (dayISO: string) => new Date(`${dayISO}T12:00:00+03:00`).getUTCDay() === 5;

/**
 * (23 نوفمبر) تحقّق القراءة: النص المفكوك من الملف المرفوع فعلًا يطابق ما جُمع.
 * يُرجع null إن طابق، أو وصف أول اختلاف.
 */
export function verifyRoundTrip(plainJson: string, counts: Record<string, number>): string | null {
  let m: any;
  try { m = JSON.parse(plainJson); } catch { return "JSON غير صالح"; }
  if (m?.format !== "watheq-backup") return "صيغة غير معروفة";
  for (const [t, n] of Object.entries(counts)) {
    const got = Array.isArray(m.tables?.[t]) ? m.tables[t].length : -1;
    if (got !== n) return `${t}: ${got} صف بدل ${n}`;
  }
  return null;
}
