-- ============================================================
-- وثيق — schema-v47: ثلاث دوال يستطيع أي زائر استدعاءها
--
-- مراجعة دوال SECURITY DEFINER (تعمل بصلاحية مالك القاعدة وتتجاوز حماية
-- الأعمدة والصفوف). في Postgres تُمنح الدالة لـ public تلقائيًّا، ودور anon في
-- Supabase يرثها — فما لم يُسحب منه يستدعيه أي زائر غير مسجَّل:
--
--   regen_link_code(p_user)  ← بلا أي تحقق: يولّد رمز ربط تليجرام لأي مكتب
--                               ويُرجعه للمستدعي. والبوت يربط أي محادثة بالمكتب
--                               صاحب الرمز — أي استيلاء على بوت المكتب (ملخّصاته
--                               وتسجيل دفعاته). الإعدادات تستدعي نسخة بلا معامل
--                               تقرأ auth.uid()، لكن هذه لم تُحذف فتتعايشان.
--   next_invoice_no(p_user)  ← بلا أي تحقق: يزيد عدّاد فواتير أي مكتب (فجوات في
--                               ترقيم الفواتير الضريبية) ويكشف عددها.
--   watheq_record_owner_payment ← تتحقق بنفسها، لكن غير المسجَّل يمرّ إن أرسل
--                               p_actor = معرّف المكتب (مسار البوت بمفتاح الخدمة).
--                               نظيراتها في الإيجار سُحبت من anon؛ هذه لم تُسحب.
--
-- آمن للتكرار. لا يغيّر بيانات.
-- ============================================================

begin;

-- ── ١) رمز ربط تليجرام: نسخة واحدة، لحساب المستدعي وحده ──
drop function if exists public.regen_link_code(uuid);
create or replace function public.regen_link_code()
returns text language plpgsql security definer set search_path = public as $$
declare c text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authorized'; end if;
  c := public.gen_link_code();
  update public.profiles set telegram_link_code = c where id = uid;
  return c;
end $$;
revoke all on function public.regen_link_code() from public, anon;
grant execute on function public.regen_link_code() to authenticated;

-- ── ٢) رقم الفاتورة: لمكتب المستدعي أو من في فريقه ──
create or replace function public.next_invoice_no(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n int; uid uuid := auth.uid();
begin
  if uid is null or not (uid = p_user or watheq_perm(p_user, 'record_payments') or watheq_perm(p_user, 'edit_units')) then
    raise exception 'not authorized';
  end if;
  update public.profiles set invoice_counter = coalesce(invoice_counter, 0) + 1
   where id = p_user returning invoice_counter into n;
  if n is null then raise exception 'المكتب غير موجود'; end if;
  return 'INV-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(n::text, 4, '0');
end $$;
revoke all on function public.next_invoice_no(uuid) from public, anon;
grant execute on function public.next_invoice_no(uuid) to authenticated;

-- ── ٣) سداد الجمعيات: للمسجَّل (يتحقق بصلاحياته) ولمفتاح الخدمة (البوت) ──
revoke all on function public.watheq_record_owner_payment(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.watheq_record_owner_payment(uuid, numeric, text, text, uuid) to authenticated, service_role;

commit;

-- فحص: يجب أن يُرجع صفًّا واحدًا فيه «لا» في عمود anon لكل دالة
select p.oid::regprocedure as الدالة,
       case when has_function_privilege('anon', p.oid, 'execute') then 'نعم ❌' else 'لا ✅' end as يستدعيها_الزائر
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('regen_link_code', 'next_invoice_no', 'watheq_record_owner_payment')
order by 1;
