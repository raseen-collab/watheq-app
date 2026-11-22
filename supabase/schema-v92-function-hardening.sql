-- ============================================================
-- وثيق — schema-v92: إحكام صلاحيات الدوال (22 نوفمبر 2026)
--
-- من فحص Supabase Security Advisor (22 نوفمبر):
--   • 18 دالة SECURITY DEFINER قابلة للاستدعاء من anon — كلها دوال triggers.
--     Postgres يمنع استدعاء دالة trigger مباشرة، فالخطر الفعلي منخفض، لكن
--     القاعدة: لا SECURITY DEFINER مكشوفة لـ anon. سحب EXECUTE من دالة trigger
--     لا يوقفها: الـtrigger يعمل بلا فحص صلاحية التنفيذ (جُرّب على Postgres 16:
--     إدخال كمستخدم anon بعد السحب → الـtrigger اشتغل، والاستدعاء المباشر رُفض).
--   • 27 دالة بلا search_path مثبّت → تُثبَّت على public, extensions, pg_temp
--     (نفس ما تراه اليوم فعليًّا؛ pgcrypto وuuid-ossp في extensions).
--
-- لا يمسّ: دوال RPC المخصصة للمستخدم المسجّل (authenticated) — هذا تصميمها.
-- ولا يحذف شيئًا ولا يغيّر جسم أي دالة. آمن للتكرار.
-- ============================================================

do $$
declare r record; n_revoke int := 0; n_path int := 0;
begin
  /* 1) دوال triggers في public: لا يستدعيها أحد مباشرة — نسحب التنفيذ من الجميع */
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prorettype = 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    n_revoke := n_revoke + 1;
  end loop;

  /* 2) تثبيت search_path لكل دالة في public بلا search_path */
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- دوال الامتدادات ليست لنا
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.sig);
    n_path := n_path + 1;
  end loop;

  raise notice 'v92: سُحب التنفيذ من % دالة trigger، وثُبّت search_path في % دالة', n_revoke, n_path;
end $$;

-- تحقق 1: دوال SECURITY DEFINER قابلة للاستدعاء من anon — المتوقع 0
select count(*) as anon_security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

-- تحقق 2: دوال بلا search_path — المتوقع 0
select count(*) as no_search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

-- تحقق 3: الـtriggers ما زالت موجودة ومفعّلة (العدد قبل وبعد يجب أن يكون نفسه)
select count(*) as active_triggers
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'D';
