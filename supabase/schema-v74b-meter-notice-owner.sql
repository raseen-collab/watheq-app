-- ============================================================
-- وثيق — schema-v74b: إشعار العداد يخصّ المستأجر الذي أُرسل له (6 أكتوبر 2026)
--
-- ثغرة اكتُشفت في مراجعة الأسبوع: «إعادة التأجير» تُبقي صفّ الوحدة نفسه
-- وتضع فيه المستأجر الجديد. فتاريخ «أُشعر بالتسجيل» الذي أُرسل للسابق
-- كان سيظهر على الجديد — والمكتب يظن أنه بلّغه وهو لم يفعل.
--
-- الحل: يُحفظ مع الإشعار اسمُ المستأجر ورقمُ الحساب لحظة الإرسال.
-- اللوحة لا تعرض «أُشعر» إلا إن طابقا الحاليين؛ وإرسالٌ لمستأجر آخر أو
-- لعداد آخر يبدأ العدّ من 1. لا يُحذف شيء ولا يُصفَّر شيء قائم.
--
-- يُشغَّل بعد schema-v74. آمن للتشغيل أكثر من مرة.
-- ============================================================

alter table public.tenants add column if not exists elec_notice_name    text;
alter table public.tenants add column if not exists elec_notice_account text;

create or replace function public.watheq_log_meter_notice(p_tenant uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare office uuid; t tenants%rowtype; ts timestamptz := now(); same boolean;
begin
  select * into t from tenants where id = p_tenant;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  select p.user_id into office from properties p where p.id = t.property_id;
  if office is null then raise exception 'الوحدة غير موجودة'; end if;
  if not watheq_perm(office, 'send_reminders') then
    raise exception 'هذا الإجراء يحتاج صلاحية التذكيرات — اطلبه من صاحب المكتب.';
  end if;
  same := coalesce(t.elec_notice_name, '')    = coalesce(btrim(t.name), '')
      and coalesce(t.elec_notice_account, '') = coalesce(btrim(t.elec_account), '');
  update tenants
     set elec_notice_at      = ts,
         elec_notice_count   = case when same then coalesce(elec_notice_count, 0) + 1 else 1 end,
         elec_notice_name    = btrim(t.name),
         elec_notice_account = btrim(t.elec_account)
   where id = p_tenant;
  return ts;
end $$;
revoke all on function public.watheq_log_meter_notice(uuid) from public, anon;
grant execute on function public.watheq_log_meter_notice(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ─── التحقق (المتوقع: 2) ───
select count(*) as أعمدة_صاحب_الإشعار from information_schema.columns
 where table_schema = 'public' and table_name = 'tenants'
   and column_name in ('elec_notice_name', 'elec_notice_account');
