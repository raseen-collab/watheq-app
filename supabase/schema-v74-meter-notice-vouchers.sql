-- ============================================================
-- وثيق — schema-v74 (طلب مكتب عمرو باعبدالله، 6 أكتوبر 2026)
--
-- ١) إشعار تسجيل عداد الكهرباء باسم المستأجر
--    زر يرسل للمستأجر رقم حساب عداد وحدته ويطلب تسجيله باسمه لدى شركة
--    الكهرباء. تُحفظ على الوحدة لحظة آخر إرسال وعدد مرات الإرسال —
--    «عشان يكون ما لنا حجة». الحفظ عبر دالة تتحقق من صلاحية التذكيرات
--    (المحصِّل يرسل التذكيرات ولا يملك تعديل بيانات الوحدة).
--
-- ٢) سند صرف لمصروفات العقار
--    المصروف يبقى مصروفًا (يدخل صافي المالك كما هو)، ويُضاف له اختياريًا
--    اسم المستلم (يُكتب يدويًا: مستأجر، أحد الورثة، فنّي…) ومرجع اختياري
--    (هوية أو جوال). عند وجود المستلم تُصدر القاعدة رقم سند متسلسلًا لكل
--    مكتب PV-00001. بعد صدور السند لا يُعدَّل مبلغه ولا تاريخه ولا مستلمه
--    ولا رقمه — التصحيح بحذف المصروف وتسجيله من جديد.
--
-- آمن للتشغيل أكثر من مرة. يُشغَّل قبل رفع الكود.
-- ============================================================

-- ─── ١) إشعار العداد ─────────────────────────────────────────
alter table public.tenants add column if not exists elec_notice_at timestamptz;
alter table public.tenants add column if not exists elec_notice_count integer not null default 0;

create or replace function public.watheq_log_meter_notice(p_tenant uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare office uuid; ts timestamptz := now();
begin
  select p.user_id into office
    from tenants t join properties p on p.id = t.property_id
   where t.id = p_tenant;
  if office is null then raise exception 'الوحدة غير موجودة'; end if;
  if not watheq_perm(office, 'send_reminders') then
    raise exception 'هذا الإجراء يحتاج صلاحية التذكيرات — اطلبه من صاحب المكتب.';
  end if;
  update tenants
     set elec_notice_at = ts, elec_notice_count = coalesce(elec_notice_count, 0) + 1
   where id = p_tenant;
  return ts;
end $$;
revoke all on function public.watheq_log_meter_notice(uuid) from public, anon;
grant execute on function public.watheq_log_meter_notice(uuid) to authenticated;

-- ─── ٢) سند صرف المصروف ──────────────────────────────────────
alter table public.expenses add column if not exists voucher_no text;
alter table public.expenses add column if not exists payee_name text;
alter table public.expenses add column if not exists payee_ref  text;

alter table public.expenses drop constraint if exists expenses_payee_len;
alter table public.expenses add constraint expenses_payee_len
  check (coalesce(char_length(payee_name), 0) <= 120 and coalesce(char_length(payee_ref), 0) <= 60);

create unique index if not exists expenses_voucher_uniq
  on public.expenses (user_id, voucher_no) where voucher_no is not null;

-- عدّاد السندات لكل مكتب — لا يُقرأ ولا يُكتب إلا من المشغّل أدناه
create table if not exists public.expense_voucher_counters (
  user_id uuid primary key,
  last_no integer not null default 0
);
alter table public.expense_voucher_counters enable row level security;
revoke all on public.expense_voucher_counters from anon, authenticated;

create or replace function public.watheq_expense_voucher()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  new.payee_name := nullif(btrim(coalesce(new.payee_name, '')), '');
  new.payee_ref  := nullif(btrim(coalesce(new.payee_ref, '')), '');

  if tg_op = 'UPDATE' and old.voucher_no is not null then
    if new.voucher_no is distinct from old.voucher_no
       or new.payee_name is distinct from old.payee_name
       or new.payee_ref  is distinct from old.payee_ref
       or new.amount     is distinct from old.amount
       or new.spent_on   is distinct from old.spent_on
       or new.user_id    is distinct from old.user_id then
      raise exception 'صدر سند الصرف % لهذا المصروف ولا يُعدَّل. للتصحيح احذف المصروف وسجّله من جديد.', old.voucher_no;
    end if;
    return new;
  end if;

  -- الرقم تُصدره القاعدة وحدها — لا يُقبل رقم من الواجهة
  new.voucher_no := null;
  if new.payee_name is not null then
    insert into expense_voucher_counters as c (user_id, last_no) values (new.user_id, 1)
      on conflict (user_id) do update set last_no = c.last_no + 1
      returning last_no into n;
    new.voucher_no := 'PV-' || lpad(n::text, 5, '0');
  end if;
  return new;
end $$;

drop trigger if exists a_expense_voucher on public.expenses;
create trigger a_expense_voucher before insert or update on public.expenses
  for each row execute function public.watheq_expense_voucher();

notify pgrst, 'reload schema';

-- ─── التحقق (صف واحد — المتوقع: 2 · 3 · true · true · true) ───
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tenants'
     and column_name in ('elec_notice_at', 'elec_notice_count'))                        as أعمدة_العداد,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'expenses'
     and column_name in ('voucher_no', 'payee_name', 'payee_ref'))                       as أعمدة_السند,
  to_regprocedure('public.watheq_log_meter_notice(uuid)') is not null                   as دالة_الإشعار,
  to_regclass('public.expense_voucher_counters') is not null                            as عداد_السندات,
  exists (select 1 from pg_trigger where tgname = 'a_expense_voucher' and not tgisinternal) as مشغّل_السند;
