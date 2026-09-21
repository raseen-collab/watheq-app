-- ============================================================
-- وثيق — استخراج هيكل القاعدة كاملًا من محرر SQL (بلا طرفية)
--
-- الناتج عمود واحد «ddl»: أوامر SQL مرتّبة تعيد بناء الهيكل على قاعدة
-- جديدة. انسخ العمود كله واحفظه في ملف (مثلًا watheq-schema-2026-09-21.sql).
--
-- الترتيب مقصود — كل خطوة تعتمد على ما قبلها:
--   ١ الجداول بأعمدتها   ٢ الدوال   ٣ المفاتيح والقيود   ٤ المفاتيح الأجنبية
--   ٥ الفهارس   ٦ المشغِّلات   ٧ تفعيل RLS   ٨ السياسات   ٩ الصلاحيات
--
-- يغطي مخطط public وحده — وهو كل ما بنيناه. مخططات Supabase الداخلية
-- (auth · storage) يعيد Supabase إنشاءها بنفسه في أي مشروع جديد.
-- ============================================================

with
tbl as (
  select c.oid, c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),

/* ١) الجداول: الأعمدة بأنواعها الدقيقة وقيمها الافتراضية */
s1 as (
  select 1 as step, t.relname as k,
    'create table if not exists public.' || quote_ident(t.relname) || ' (' || E'\n' ||
    string_agg(
      '  ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod)
      || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
      || case when a.attnotnull then ' not null' else '' end,
      ',' || E'\n' order by a.attnum)
    || E'\n);' as ddl
  from tbl t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
  group by t.relname
),

/* ٢) الدوال — قبل القيود والسياسات التي تستدعيها */
s2 as (
  select 2, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    pg_get_functiondef(p.oid) || ';'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend dp where dp.objid = p.oid and dp.deptype = 'e')
),

/* ٣) المفتاح الأساسي والفريد والفحص */
s3 as (
  select 3, t.relname || '.' || con.conname,
    'alter table public.' || quote_ident(t.relname) || ' add constraint '
      || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) || ';'
  from pg_constraint con join tbl t on t.oid = con.conrelid
  where con.contype in ('p', 'u', 'c')
),

/* ٤) المفاتيح الأجنبية — بعد كل الجداول */
s4 as (
  select 4, t.relname || '.' || con.conname,
    'alter table public.' || quote_ident(t.relname) || ' add constraint '
      || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) || ';'
  from pg_constraint con join tbl t on t.oid = con.conrelid
  where con.contype = 'f'
),

/* ٥) الفهارس — عدا ما تُنشئه القيود نفسها */
s5 as (
  select 5, i.relname, pg_get_indexdef(x.indexrelid) || ';'
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join tbl t on t.oid = x.indrelid
  where not exists (select 1 from pg_constraint c where c.conindid = x.indexrelid)
),

/* ٦) المشغِّلات */
s6 as (
  select 6, t.relname || '.' || tg.tgname, pg_get_triggerdef(tg.oid) || ';'
  from pg_trigger tg join tbl t on t.oid = tg.tgrelid
  where not tg.tgisinternal
),

/* ٧) تفعيل أمان الصفوف */
s7 as (
  select 7, c.relname,
    'alter table public.' || quote_ident(c.relname) || ' enable row level security;'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
),

/* ٨) السياسات */
s8 as (
  select 8, tablename || '.' || policyname,
    'create policy ' || quote_ident(policyname) || ' on public.' || quote_ident(tablename)
      || ' as ' || permissive
      || ' for ' || cmd
      || ' to ' || array_to_string(roles, ', ')
      || coalesce(' using (' || qual || ')', '')
      || coalesce(' with check (' || with_check || ')', '') || ';'
  from pg_policies where schemaname = 'public'
),

/* ٩) الصلاحيات — على الجدول كله وعلى أعمدة بعينها (وهذه دقيقة عندنا:
      profiles تمنح تعديل أعمدة محددة فقط) */
s9 as (
  select 9, 'table:' || table_name || ':' || grantee || ':' || privilege_type,
    'grant ' || lower(privilege_type) || ' on public.' || quote_ident(table_name)
      || ' to ' || quote_ident(grantee) || ';'
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  union all
  select 9, 'col:' || c.table_name || ':' || c.grantee || ':' || c.privilege_type,
    'grant ' || lower(c.privilege_type) || ' (' || string_agg(quote_ident(c.column_name), ', ' order by c.column_name)
      || ') on public.' || quote_ident(c.table_name) || ' to ' || quote_ident(c.grantee) || ';'
  from information_schema.column_privileges c
  where c.table_schema = 'public' and c.grantee in ('anon', 'authenticated')
    and not exists (
      select 1 from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = c.table_name
        and g.grantee = c.grantee and g.privilege_type = c.privilege_type)
  group by c.table_name, c.grantee, c.privilege_type
)

/* خانة واحدة: محرر Supabase يعرض الصفوف في جدول ونسخ مئات الصفوف مرهق.
   الآن اضغط الخانة الوحيدة ← انسخ ← الصق في ملف. */
, allx as (
  select * from s1 union all select * from s2 union all select * from s3
  union all select * from s4 union all select * from s5 union all select * from s6
  union all select * from s7 union all select * from s8 union all select * from s9
)
select
  '-- هيكل قاعدة وثيق — مُستخرَج ' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || E'\n'
  || '-- جداول: '  || (select count(*) from s1)
  || ' · دوال: '   || (select count(*) from s2)
  || ' · سياسات: ' || (select count(*) from s8)
  || ' · فهارس مستقلة: ' || (select count(*) from s5) || E'\n'
  || '-- للتشغيل على مشروع Supabase جديد فارغ — بالترتيب كما هو.' || E'\n\n'
  || string_agg(ddl, E'\n\n' order by step, k) as schema_sql
from allx;
