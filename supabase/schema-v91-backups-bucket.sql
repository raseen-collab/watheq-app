-- ============================================================
-- وثيق — schema-v91: مخزن النسخ الاحتياطية اليومية (22 نوفمبر 2026)
--
-- bucket خاص «backups»: لا public، ولا أي سياسة RLS على storage.objects
-- تخصّه — فلا يقرؤه ولا يكتبه أي مستخدم ولا anon؛ مفتاح service_role وحده
-- (مسار /api/cron/backup على الخادم) يصل إليه. الملفات مشفّرة أصلًا
-- (AES-256-GCM) ومفتاحها في Vercel فقط، لا في القاعدة.
--
-- آمن للتكرار. لا يحذف شيئًا.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/octet-stream'])
on conflict (id) do update set public = false;

-- تحقق: يجب أن يُرجع صفًّا واحدًا public = false
select id, public, file_size_limit from storage.buckets where id = 'backups';

-- تحقق: لا سياسة على storage.objects تذكر backups (المتوقع 0)
select count(*) as policies_mentioning_backups
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') ilike '%backups%' or coalesce(with_check, '') ilike '%backups%');
