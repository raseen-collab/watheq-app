-- ============================================================
-- وثيق — schema-v100: مساعد المساعدة بالذكاء الاصطناعي (23 نوفمبر 2026)
--
-- help_queries.via: كيف وُجد الجواب — 'kw' بحث الكلمات في المتصفح (كل القديم)،
-- 'ai' مطابقة النموذج (يختار من قاعدة المعرفة فقط، لا يكتب جوابًا من عنده).
-- يُستعمل أيضًا للسقف اليومي لاستدعاءات النموذج (التكلفة) وللتقرير الأسبوعي.
-- إضافة عمود فقط. لا يحذف ولا يعدّل بيانات.
-- ============================================================
alter table public.help_queries add column if not exists via text not null default 'kw';
do $$ begin
  alter table public.help_queries add constraint help_queries_via_chk check (via in ('kw', 'ai'));
exception when duplicate_object then null; end $$;
create index if not exists help_queries_via_day on public.help_queries (via, created_at);
