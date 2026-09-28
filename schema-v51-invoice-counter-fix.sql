-- ══════════════════════════════════════════════════════════════════
-- وثيق — إصلاح عدّاد الفواتير (v51) · 28 سبتمبر 2026
--
-- العطل: المشغّل trg_guard_profile_columns يعيد invoice_counter إلى
-- قيمته القديمة في كل تحديث يأتي من مستخدم مسجَّل. ودالة next_invoice_no
-- تُنادى من المكتب، فيلغي الحارس زيادتها، وتُرجع RETURNING القيمة القديمة
-- نفسها في كل مرة — فتخرج كل الفواتير برقم واحد.
--
-- الإصلاح: الدالة تضبط علامة محلية للمعاملة، والحارس يستثني العدّاد وحده
-- حين يراها. الأعمدة الستة الأخرى تبقى محروسة كما هي.
--
-- آمن للتشغيل أكثر من مرة.
-- ══════════════════════════════════════════════════════════════════

begin;

-- ① الحارس: كما هو، مع استثناء واحد معلن
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- الخادم وحده يعدّل الباقة والاشتراك والتجربة والمعرّف
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and auth.uid() is not null then
    new.id               := old.id;
    new.plan             := old.plan;
    new.subscribed_until := old.subscribed_until;
    new.trial_started_at := old.trial_started_at;
    new.trial_ends_at    := old.trial_ends_at;
    new.created_at       := old.created_at;

    -- عدّاد الفواتير: يمرّ فقط من داخل next_invoice_no التي تضبط هذه
    -- العلامة. العميل لا يملك طريقًا لضبطها عبر PostgREST، وأقصى ضرر
    -- محتمل لو ملكها أن يقفز رقم فاتورته — لا شيء يُشترى به.
    if coalesce(current_setting('watheq.bump_invoice_counter', true), '') <> '1' then
      new.invoice_counter := old.invoice_counter;
    end if;
  end if;
  return new;
end
$function$;

-- ② دالة الترقيم: تُعلن نيّتها قبل التحديث ثم تمسح العلامة
create or replace function public.next_invoice_no(p_user uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int; uid uuid := auth.uid();
begin
  if uid is null or not (uid = p_user
      or watheq_perm(p_user, 'record_payments')
      or watheq_perm(p_user, 'edit_units')) then
    raise exception 'not authorized';
  end if;

  perform set_config('watheq.bump_invoice_counter', '1', true);   -- true = محلي للمعاملة
  update public.profiles set invoice_counter = coalesce(invoice_counter, 0) + 1
   where id = p_user returning invoice_counter into n;
  perform set_config('watheq.bump_invoice_counter', '', true);

  if n is null then raise exception 'المكتب غير موجود'; end if;
  return 'INV-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(n::text, 4, '0');
end
$function$;

revoke all on function public.next_invoice_no(uuid) from public, anon;
grant execute on function public.next_invoice_no(uuid) to authenticated;

-- ③ رفع عدّاد كل مكتب فوق أعلى رقم استعمله فعلًا، حتى لا تصطدم
--   الفواتير الجديدة بالقديمة. لا يمسّ الفواتير نفسها.
select set_config('watheq.bump_invoice_counter', '1', true);

update public.profiles p
set invoice_counter = greatest(
      coalesce(p.invoice_counter, 0),
      coalesce((select max(split_part(i.invoice_no, '-', 3)::int)
                from public.invoices i
                where i.user_id = p.id
                  and i.invoice_no ~ '^INV-[0-9]{4}-[0-9]+$'), 0))
where exists (select 1 from public.invoices i where i.user_id = p.id);

select set_config('watheq.bump_invoice_counter', '', true);

commit;

-- ══════════════════════════════════════════════════════════════════
-- الفحص: العدّاد يجب أن يساوي أعلى رقم مستعمل أو يزيد عليه
-- ══════════════════════════════════════════════════════════════════
select coalesce(p.org_name, p.full_name, left(p.id::text, 8)) as المكتب,
       p.invoice_counter                                       as العدّاد,
       (select count(*) from public.invoices i where i.user_id = p.id)        as فواتيره,
       (select max(split_part(i.invoice_no, '-', 3)::int) from public.invoices i
         where i.user_id = p.id and i.invoice_no ~ '^INV-[0-9]{4}-[0-9]+$')   as أعلى_رقم_مستعمل
from public.profiles p
where exists (select 1 from public.invoices i where i.user_id = p.id)
order by 2 desc;
