-- ============================================================
-- وثيق — schema-v93: «بلّغ عن مشكلة» (22 نوفمبر 2026)
--
-- بلاغ المستخدم من داخل اللوحة: نصّه + الصفحة + الجهاز + نسخة التطبيق
-- + معرّف آخر خطأ في Sentry إن وُجد. يكتبه مسار /api/report على الخادم
-- (service_role) بعد التحقق من الجلسة، ويقرؤه مالك وثيق في /admin/reports.
--
-- RLS مفعّل بلا أي سياسة، وتُسحب كل الصلاحيات من anon/authenticated:
-- لا يقرأ مستخدمٌ بلاغات غيره ولا بلاغاته من المتصفح. آمن للتكرار.
-- ============================================================

create table if not exists public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  message text not null check (char_length(message) between 3 and 2000),
  path text check (path is null or char_length(path) <= 200),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  viewport text check (viewport is null or char_length(viewport) <= 40),
  app_version text check (app_version is null or char_length(app_version) <= 60),
  sentry_event text check (sentry_event is null or char_length(sentry_event) <= 64),
  status text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz not null default now()
);

create index if not exists problem_reports_created_idx on public.problem_reports (created_at desc);

alter table public.problem_reports enable row level security;
revoke all on public.problem_reports from anon, authenticated;

-- تحقق: الجدول موجود، RLS مفعّل، ولا صلاحية لـ anon/authenticated (المتوقع: true · false · false)
select c.relrowsecurity as rls_on,
       has_table_privilege('anon', 'public.problem_reports', 'select') as anon_can_read,
       has_table_privilege('authenticated', 'public.problem_reports', 'select') as auth_can_read
from pg_class c where c.oid = 'public.problem_reports'::regclass;
