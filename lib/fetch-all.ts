import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * وثيق — جلب كل الصفوف بلا قصّ صامت.
 *
 * Supabase يقصّ أي استجابة عند 1000 صف افتراضيًّا ولا يخبرك — فمكتب بـ400
 * وحدة قد يرى بعضها فقط وتُحسب أرقامه ناقصة بلا أي تحذير. هذه الدالة تجلب
 * على دفعات حتى ينتهي الجدول فعلًا، وتُستعمل في كل مسار يحمل بيانات قد
 * تتجاوز الألف: الوحدات، الدفعات، المصروفات.
 */
export async function fetchAllRows<T = any>(
  db: SupabaseClient,
  table: string,
  select: string,
  shape: (q: any) => any = (q) => q,
  page = 1000,
  hardCap = 50000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await shape(db.from(table).select(select)).range(from, from + page - 1);
    if (error) { console.error(`fetchAllRows(${table})`, error.message); break; }
    out.push(...((data || []) as T[]));
    if (!data || data.length < page || out.length >= hardCap) break;
  }
  return out;
}
