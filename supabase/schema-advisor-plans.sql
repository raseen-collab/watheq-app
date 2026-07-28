-- ============================================================
-- وثيق — عمود الباقة المدفوعة (لحصص المستشار الذكي)
-- شغّله في: Supabase → SQL Editor → New query → Run
-- ============================================================

alter table public.profiles
  add column if not exists plan text
  check (plan in ('basic', 'pro', 'full') or plan is null);

comment on column public.profiles.plan is
  'الباقة المدفوعة — تُضبط يدويًا عند تأكيد التحويل البنكي:
   basic = باقة المالك (99) أو الأساسية (59)
   pro   = الاحترافية (99)
   full  = باقة المكتب (199) أو الشاملة (149)
   NULL  = تجربة مجانية (10 أسئلة/يوم أثناءها، ثم 3/يوم بعد انتهائها)';

-- لتفعيل باقة عميل بعد استلام التحويل (بدّل البريد والباقة):
-- update public.profiles set plan = 'full'
--   where id = (select id from auth.users where email = 'customer@email.com');
