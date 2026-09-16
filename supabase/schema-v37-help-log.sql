-- ============================================================
-- وثيق — schema-v37: مراقب مساعد الموقع
--
-- المساعد يجيب من قاعدة معرفة مكتوبة. وقيمته الحقيقية ليست فيما يجيب عنه
-- بل فيما يعجز عنه: كل سؤال بلا جواب هو ثغرة في المنتج أو في شرحه، ولا
-- طريق لمعرفتها إلا بتسجيلها.
--
-- ما يُسجَّل: نصّ السؤال · هل وُجد جواب · أي مدخل طابقه · من أي صفحة.
-- ما لا يُسجَّل: لا بيانات مستأجرين ولا مبالغ — السؤال وحده.
--
-- الإدراج مفتوح (الزائر على /demo و/tools ليس مسجّلًا)، والقراءة مغلقة
-- تمامًا: لا أحد يقرأ هذا الجدول من التطبيق، فقط لوحة الإدارة بمفتاح الخدمة.
-- ============================================================

create table if not exists help_queries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  question    text not null check (length(question) between 1 and 300),
  answered    boolean not null default false,
  matched_id  text,
  score       numeric(6,2),
  path        text,
  created_at  timestamptz not null default now()
);

create index if not exists help_queries_time_idx on help_queries (created_at desc);
create index if not exists help_queries_unanswered_idx on help_queries (created_at desc) where not answered;

alter table help_queries enable row level security;

/* الإدراج فقط — ولا قراءة ولا تعديل ولا حذف لأي مستخدم.
   لوحة الإدارة تقرأ بمفتاح الخدمة الذي يتجاوز RLS. */
drop policy if exists help_insert_any on help_queries;
create policy help_insert_any on help_queries for insert to anon, authenticated with check (true);

revoke all on help_queries from anon, authenticated;
grant insert (user_id, question, answered, matched_id, score, path) on help_queries to anon, authenticated;

comment on table help_queries is 'أسئلة مساعد الموقع — للمراقبة وسدّ فجوات الشرح. بلا بيانات تشغيلية.';
