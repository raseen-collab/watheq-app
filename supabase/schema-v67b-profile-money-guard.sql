-- ============================================================
-- وثيق — schema-v67b: إغلاق تعديل الباقة من المتصفح (حرج)
--
-- الفحص بعد v67 (30 سبتمبر 2026) أعاد:
--   has_column_privilege('authenticated','profiles','plan','UPDATE') = true
-- أي أن صلاحية UPDATE على جدول profiles كاملًا ممنوحة للمستخدمين (أُعيد فتحها
-- في أغسطس حين انكسر التسجيل مرتين). فأي مستخدم يستطيع من المتصفح:
--   update profiles set plan='full', subscribed_until='2099-01-01' where id = <هو>
-- اشتراك دائم مجاني — ويتجاوز كل حدود v67.
--
-- الحل المتفق عليه منذ أغسطس (بدل سحب الصلاحيات الذي كسر التسجيل مرتين):
-- مُشغِّل BEFORE يرفض تغيير الأعمدة المالية من أي طلب مستخدم. لا يمسّ
-- الصلاحيات ولا التسجيل؛ ولوحة الإدارة والمهام الآلية (مفتاح الخدمة) ومحرر
-- SQL ودوال الخادم (next_invoice_no وأمثالها) لا تُحجب.
--
-- آمن للتشغيل أكثر من مرة.
-- ============================================================

create or replace function public.watheq_profile_money_guard()
returns trigger language plpgsql set search_path = public as $$
-- ⚠️ بلا security definer عمدًا: نحتاج current_user الحقيقي. الطلب المباشر من
-- المتصفح يصل بدور «authenticated»؛ أما دوال الخادم (security definer) مثل
-- next_invoice_no فتعمل بدور مالكها وتزيد العدّادات مشروعًا — فلا تُحجب.
declare
  n jsonb := to_jsonb(new);
  o jsonb;
  k text;
  -- الأعمدة المالية والتشغيلية التي لا يكتبها إلا الخادم
  locked text[] := array['plan', 'hoa_plan', 'subscribed_until', 'trial_ends_at', 'trial_started_at',
                         'invoice_counter', 'telegram_link_code', 'last_digest_at', 'created_at', 'id'];
begin
  if auth.uid() is null or current_user not in ('authenticated', 'anon') then
    return new;   -- الخادم / محرر SQL / دوال الخادم الموثوقة
  end if;

  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    foreach k in array locked loop
      if n ? k and (n -> k) is distinct from (o -> k) then
        raise exception using errcode = '42501',
          message = format('لا يمكن تعديل «%s» من الحساب — يُضبط من إدارة وثيق فقط.', k);
      end if;
    end loop;
    -- كل عدّاد (ترقيم سندات/فواتير) يزيده الخادم وحده
    for k in select jsonb_object_keys(n) loop
      if k like '%\_counter' escape '\' and (n -> k) is distinct from (o -> k) then
        raise exception using errcode = '42501',
          message = format('لا يمكن تعديل «%s» من الحساب — يُضبط من إدارة وثيق فقط.', k);
      end if;
    end loop;
    -- ربط تليجرام يتم عبر البوت (مفتاح الخدمة)؛ المستخدم يملك فكّه فقط
    if n ? 'telegram_chat_id' and (n -> 'telegram_chat_id') is distinct from (o -> 'telegram_chat_id')
       and nullif(n ->> 'telegram_chat_id', '') is not null then
      raise exception using errcode = '42501',
        message = 'ربط تليجرام يتم من البوت نفسه — افتح الرابط من الإعدادات.';
    end if;
    return new;
  end if;

  -- INSERT من المستخدم (onboarding حين لا يوجد صف): لا باقة ولا تمديد
  if coalesce(n ->> 'plan', '') <> '' or coalesce(n ->> 'hoa_plan', '') <> ''
     or n ->> 'subscribed_until' is not null
     or coalesce((n ->> 'invoice_counter')::int, 0) <> 0
     or (n ->> 'trial_ends_at' is not null and (n ->> 'trial_ends_at')::timestamptz > now() + interval '31 days') then
    raise exception using errcode = '42501', message = 'لا يمكن ضبط الاشتراك من الحساب — يُضبط من إدارة وثيق فقط.';
  end if;
  return new;
end $$;
revoke all on function public.watheq_profile_money_guard() from public, anon, authenticated;

drop trigger if exists zz_profile_money_guard on public.profiles;
create trigger zz_profile_money_guard before insert or update on public.profiles
  for each row execute function public.watheq_profile_money_guard();

-- ─── التحقق ───
-- ١) المُشغِّل مركَّب (المتوقع: 1)
select count(*) as حارس_الباقة from pg_trigger where tgname = 'zz_profile_money_guard';
-- ٢) اختبار حيّ بصلاحية مستخدم على حسابك أنت — ثم تراجع (لا يغيّر شيئًا):
--    شغّل الأسطر الأربعة التالية معًا؛ المتوقع خطأ «لا يمكن تعديل «plan» من الحساب…»
-- begin;
-- select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where org_name = 'عبيدعبيد'), 'role', 'authenticated')::text, true);
-- set local role authenticated;
-- update profiles set plan = 'full' where org_name = 'عبيدعبيد';
-- rollback;

-- ٣) فحص عام (قراءة فقط): جداول public بلا RLS — المتوقع: لا صفوف
--    (أي صف هنا يعني أن المستخدمين يقرؤونه/يكتبونه كله إن كانت له صلاحية)
select c.relname as جدول_بلا_RLS,
       (select string_agg(privilege_type, ', ') from information_schema.role_table_grants g
         where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'authenticated') as صلاحيات_المستخدم
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
 where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 order by 1;
