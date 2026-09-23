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
    /* ترتيب ثانوي بالمعرّف: Postgres لا يضمن الترتيب نفسه بين استعلامين، فبلا
       ترتيب ثابت قد يتكرر صفّ أو يسقط عند حدود الصفحات */
    const { data, error } = await shape(db.from(table).select(select)).order("id", { ascending: true }).range(from, from + page - 1);
    /* فشل صفحة في المنتصف يُرمى خطأً — كان يُرجع ما جُمع قبله فيُعرض نصف
       البيانات كأنه كلها (أرقام مالية ناقصة بلا تحذير) */
    if (error) throw new Error(`تعذّر تحميل ${table}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < page) break;
    if (out.length >= hardCap) throw new Error(`${table}: أكثر من ${hardCap} صفّ — تجاوز حدّ التحميل`);
  }
  return out;
}
