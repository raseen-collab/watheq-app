-- ============================================================
-- وثيق — schema-v84: دفتر حسابات المكتب (15 نوفمبر 2026)
--
-- طلب مكتب الأولى: «من فين أشوف مصروفات وإيرادات المكتب؟». المصروفات اليوم
-- لكل عقار (وتدخل تقرير المالك)، وأتعاب الإدارة تُحتسب في تقرير المالك فقط،
-- والسعي ورسوم التوثيق لا مكان لها أصلًا.
--
-- جدول واحد لقيود المكتب نفسه — دخلًا ومصروفًا — منفصل تمامًا عن حساب المالك:
--   • لا يُقرأ في تقرير المالك ولا كشف التحصيل ولا صافي المالك (لا تداخل).
--   • property_id اختياري للإشارة فقط («سعي على شقة 3 في عمارة كذا»).
-- أتعاب الإدارة لا تُسجَّل هنا يدويًّا: تُحتسب في الدفتر من المحصَّل بنفس
-- معادلة تقرير المالك، فلا تُحسب مرتين.
--
-- الصلاحيات كالمصروفات: القراءة لمن يرى أرقام المالك (view_financials)،
-- الإضافة والتعديل لمن يدير المصروفات (manage_expenses)، الحذف تراجع (undo_actions).
-- آمن للتشغيل أكثر من مرة. Supabase → SQL Editor → Run.
-- ============================================================

begin;

create table if not exists public.office_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,                                   -- المكتب
  kind         text not null check (kind in ('income', 'expense')),
  category     text not null,
  amount       numeric(14,2) not null check (amount > 0),
  entry_on     date not null default (now() at time zone 'Asia/Riyadh')::date,
  property_id  uuid references public.properties(id) on delete set null,
  unit         text check (unit is null or char_length(unit) <= 40),
  party        text check (party is null or char_length(party) <= 160),   -- الطرف: من دفع / لمن دُفع
  note         text check (note is null or char_length(note) <= 300),
  reference    text check (reference is null or char_length(reference) <= 80), -- رقم عقد/فاتورة/حوالة
  created_by   uuid,
  created_at   timestamptz not null default now()
);

-- التصنيفات: دخل ← سعي، رسوم توثيق، أتعاب إدارة (يدويًّا — لعقار بلا نسبة أتعاب فقط)، أخرى · مصروف ← إيجار المكتب، رواتب، اشتراكات، تسويق، رسوم حكومية، أخرى
alter table public.office_ledger drop constraint if exists office_ledger_category_check;
alter table public.office_ledger add constraint office_ledger_category_check check (
  (kind = 'income'  and category in ('brokerage', 'documentation', 'management_fee', 'other_income')) or
  (kind = 'expense' and category in ('office_rent', 'salaries', 'subscriptions', 'marketing', 'government', 'other_expense'))
);

create index if not exists office_ledger_office_month_idx on public.office_ledger (user_id, entry_on desc);

-- العقار المشار إليه من المكتب نفسه (حارس خلف الواجهة)
create or replace function public.office_ledger_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.property_id is not null and not exists (
    select 1 from properties p where p.id = new.property_id and p.user_id = new.user_id) then
    raise exception 'العقار المشار إليه ليس من عقارات هذا المكتب';
  end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists office_ledger_guard on public.office_ledger;
create trigger office_ledger_guard before insert or update on public.office_ledger
  for each row execute function public.office_ledger_guard();

alter table public.office_ledger enable row level security;
drop policy if exists office_ledger_read on public.office_ledger;
create policy office_ledger_read on public.office_ledger for select using (watheq_perm(user_id, 'view_financials'));
drop policy if exists office_ledger_ins on public.office_ledger;
create policy office_ledger_ins on public.office_ledger for insert with check (watheq_perm(user_id, 'manage_expenses'));
drop policy if exists office_ledger_upd on public.office_ledger;
create policy office_ledger_upd on public.office_ledger for update
  using (watheq_perm(user_id, 'manage_expenses')) with check (watheq_perm(user_id, 'manage_expenses'));
drop policy if exists office_ledger_del on public.office_ledger;
create policy office_ledger_del on public.office_ledger for delete using (watheq_perm(user_id, 'undo_actions'));
grant select, insert, update, delete on public.office_ledger to authenticated;
revoke all on public.office_ledger from anon;

commit;

notify pgrst, 'reload schema';

-- تحقّق: جدول + 4 سياسات + المشغّل
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'office_ledger') as الجدول_يجب_1,
  (select count(*) from pg_policies where tablename = 'office_ledger') as السياسات_يجب_4,
  (select count(*) from pg_trigger where tgname = 'office_ledger_guard' and not tgisinternal) as المشغّل_يجب_1;
