-- ============================================================
-- وثيق — schema-v76: قياس القمع من أول زيارة إلى التسجيل (7 أكتوبر 2026)
--
-- المشكلة: نعرف من سجّل ومن أين (profiles.signup_source)، ولا نعرف كم زائرًا
-- جاء من كل قناة ولا أين توقّف. فإعلان تويتر جاب 210 نقرة و0 تسجيل ولا نعرف
-- هل وصلوا الموقع أصلًا، أو فتحوا التجربة، أو وصلوا صفحة التسجيل ورجعوا.
--
-- أربع محطات فقط، كل واحدة مرة واحدة لكل جلسة:
--   visit          زيارة الموقع التسويقي (watheqapp.com)
--   demo_open      فتح التجربة الحيّة (/demo)
--   signup_view    ظهور نموذج إنشاء الحساب
--   signup_submit  الضغط على «إنشاء الحساب» أو «قوقل» في وضع التسجيل
--
-- الخصوصية: لا كوكيز، ولا عنوان IP، ولا بيانات شخصية. المعرّف `sid` رقم
-- عشوائي يعيش في sessionStorage ويموت بإغلاق التبويب. الكتابة من الخادم
-- بمفتاح الخدمة فقط؛ الجدول مغلق تمامًا أمام المتصفح.
--
-- آمن للتشغيل أكثر من مرة. يُشغَّل قبل رفع الكود.
-- ============================================================

create table if not exists public.site_events (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  event  text not null check (event in ('visit', 'demo_open', 'signup_view', 'signup_submit')),
  src    text check (src is null or char_length(src) <= 20),
  path   text check (path is null or char_length(path) <= 80),
  sid    text not null check (char_length(sid) between 10 and 40),
  unique (sid, event)
);
create index if not exists site_events_at on public.site_events (at);

alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;
-- Supabase من 30 أكتوبر 2026 لا يمنح الجداول الجديدة تلقائيًّا: الصلاحية صريحة لمفتاح الخدمة
grant select, insert, update, delete on public.site_events to service_role;

-- ─── التحقق (صف واحد — المتوقع: true · true · 0) ───
select
  to_regclass('public.site_events') is not null                                   as جدول_القمع,
  (select relrowsecurity from pg_class where oid = 'public.site_events'::regclass) as العزل_مفعّل,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'site_events'
      and grantee in ('anon', 'authenticated'))                                    as صلاحيات_المتصفح;
