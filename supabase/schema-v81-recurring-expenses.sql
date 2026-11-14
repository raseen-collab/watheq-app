-- ============================================================
-- وثيق — schema-v81: المصروف الشهري المتكرر (14 نوفمبر 2026)
--
-- طلب مكتب «الأولى»: راتب حارس العمارة كل شهر، وعقد المصاعد الدوري،
-- ومصاريف أخرى ليست صيانة. كان كل مصروف يُسجَّل يدويًّا كل شهر.
--
-- التصميم:
--  • جدول قوالب: expense_templates — مبلغ وتصنيف وبيان ويوم في الشهر، لعقار
--    واحد، مع «على من» و«من دفع» كأي مصروف. يُوقَف أو يُحذف متى شاء المكتب.
--  • الترحيل: دالة تُنشئ مصروفًا عاديًّا في expenses لكل شهر مستحق لم يُرحَّل
--    (من شهر البداية حتى الشهر الحالي، إن حلّ يوم الاستحقاق). المصروف
--    المرحَّل يحمل recurring_id + recurring_month، وفهرس فريد يمنع التكرار
--    مهما تكرر النداء. حذف المصروف المرحَّل يدويًّا لا يعيده (يُسجَّل في
--    جدول التخطّي).
--  • تُستدعى من اللوحة عند فتح «المصروفات» (للعقار)، ومن الكرون اليومي
--    (لكل المكاتب بمفتاح الخدمة). المكتب المنتهي اشتراكه يرفضه حارس
--    الاستحقاق — يُتخطّى بلا إسقاط الدفعة كلها.
--  • المصروف المرحَّل يدخل تقرير المالك بحسب billable كأي مصروف — لا حساب خاص.
--  • لا يمسّ شيئًا في حسابات الملاك: جدول مستقل، والمصروفات الناتجة عادية.
--
-- آمن للتشغيل أكثر من مرة. Supabase → SQL Editor → Run.
-- ============================================================

begin;

create table if not exists public.expense_templates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  property_id   uuid not null references public.properties(id) on delete cascade,
  unit          text,
  category      text not null default 'other',
  amount        numeric(14,2) not null check (amount > 0),
  note          text check (note is null or char_length(note) <= 300),
  vendor        text check (vendor is null or char_length(vendor) <= 120),
  billable      boolean not null default true,
  paid_by       text not null default 'collections' check (paid_by in ('collections', 'office', 'owner')),
  post_status   text not null default 'paid' check (post_status in ('paid', 'due')),
  day_of_month  int  not null default 1 check (day_of_month between 1 and 28),
  start_month   date not null default date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date,
  end_month     date,
  active        boolean not null default true,
  last_posted   date,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists expense_templates_prop_idx on public.expense_templates (property_id) where active;
create index if not exists expense_templates_office_idx on public.expense_templates (user_id) where active;

alter table public.expenses add column if not exists recurring_id uuid references public.expense_templates(id) on delete set null;
alter table public.expenses add column if not exists recurring_month date;
create unique index if not exists expenses_recurring_once on public.expenses (recurring_id, recurring_month)
  where recurring_id is not null and recurring_month is not null;

-- شهر حذف المكتب مصروفه المرحَّل يدويًّا: لا يُعاد ترحيله
create table if not exists public.expense_template_skips (
  template_id uuid not null references public.expense_templates(id) on delete cascade,
  month       date not null,
  primary key (template_id, month)
);
create or replace function public.expenses_recurring_skip_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.recurring_id is not null and old.recurring_month is not null
     and current_setting('watheq.purge', true) is distinct from '1' then
    /* حذف العقار يُسقط القالب والمصروفات معًا بترتيب غير مضمون — لا نُدرج تخطّيًا لقالب زال */
    begin
      insert into expense_template_skips (template_id, month)
        select old.recurring_id, old.recurring_month
         where exists (select 1 from expense_templates t where t.id = old.recurring_id)
        on conflict do nothing;
    exception when others then null;
    end;
  end if;
  return old;
end $$;
drop trigger if exists expenses_recurring_skip_on_delete on public.expenses;
create trigger expenses_recurring_skip_on_delete after delete on public.expenses
  for each row execute function public.expenses_recurring_skip_on_delete();

-- ── الصلاحيات: من يدير المصروفات يدير قوالبها؛ القراءة لمن يرى المال ──
alter table public.expense_templates enable row level security;
drop policy if exists expense_templates_read on public.expense_templates;
create policy expense_templates_read on public.expense_templates for select using (watheq_perm(user_id, 'view_financials'));
drop policy if exists expense_templates_ins on public.expense_templates;
create policy expense_templates_ins on public.expense_templates for insert
  with check (watheq_perm(user_id, 'manage_expenses')
              and exists (select 1 from properties p where p.id = property_id and p.user_id = expense_templates.user_id));
drop policy if exists expense_templates_upd on public.expense_templates;
create policy expense_templates_upd on public.expense_templates for update
  using (watheq_perm(user_id, 'manage_expenses')) with check (watheq_perm(user_id, 'manage_expenses'));
drop policy if exists expense_templates_del on public.expense_templates;
create policy expense_templates_del on public.expense_templates for delete using (watheq_perm(user_id, 'manage_expenses'));
grant select, insert, update, delete on public.expense_templates to authenticated;
revoke all on public.expense_template_skips from authenticated, anon;

-- ── الترحيل ───────────────────────────────────────────────────
-- يرحّل قالبًا واحدًا حتى الشهر الحالي (بتوقيت الرياض). يُرجع عدد المصروفات المُنشأة.
create or replace function public.watheq_post_recurring_one(p_template uuid)
returns int language plpgsql security definer set search_path = public as $$
declare tpl expense_templates%rowtype; cur date; m date; n int := 0; spent date; last_m date;
begin
  select * into tpl from expense_templates where id = p_template for update;
  if not found or not tpl.active then return 0; end if;
  cur := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
  last_m := cur;
  /* شهر البداية ≤ الشهر ≤ (نهاية القالب والشهر الحالي) */
  if tpl.end_month is not null and tpl.end_month < last_m then last_m := date_trunc('month', tpl.end_month)::date; end if;
  m := greatest(date_trunc('month', tpl.start_month)::date, coalesce(tpl.last_posted + interval '1 month', tpl.start_month)::date);
  m := date_trunc('month', m)::date;
  while m <= last_m loop
    spent := m + (tpl.day_of_month - 1);
    /* الشهر الحالي: لا يُرحَّل قبل يوم الاستحقاق */
    exit when spent > (now() at time zone 'Asia/Riyadh')::date;
    if not exists (select 1 from expense_template_skips s where s.template_id = tpl.id and s.month = m)
       and not exists (select 1 from expenses e where e.recurring_id = tpl.id and e.recurring_month = m) then
      insert into expenses (user_id, property_id, unit, category, amount, spent_on, note, vendor, billable, paid_by, status,
                            recurring_id, recurring_month)
      values (tpl.user_id, tpl.property_id, tpl.unit, tpl.category, tpl.amount, spent,
              coalesce(nullif(btrim(tpl.note), ''), 'مصروف شهري'), tpl.vendor, tpl.billable, tpl.paid_by, tpl.post_status,
              tpl.id, m);
      n := n + 1;
    end if;
    update expense_templates set last_posted = m where id = tpl.id;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;

-- للوحة: قوالب عقار واحد (المستدعي يملك صلاحية المصروفات في مكتبه)
create or replace function public.watheq_post_recurring_expenses(p_property uuid)
returns int language plpgsql security definer set search_path = public as $$
declare office uuid; r record; n int := 0;
begin
  select user_id into office from properties where id = p_property;
  if office is null or not watheq_perm(office, 'manage_expenses') then raise exception 'not authorized'; end if;
  for r in select id from expense_templates where property_id = p_property and active order by created_at loop
    begin
      n := n + watheq_post_recurring_one(r.id);
    exception when others then
      /* حساب منتهٍ (حارس الاستحقاق) أو خطأ في قالب واحد: لا يُسقط البقية */
      null;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.watheq_post_recurring_one(uuid) from public, anon, authenticated;
revoke all on function public.watheq_post_recurring_expenses(uuid) from public, anon;
grant execute on function public.watheq_post_recurring_expenses(uuid) to authenticated;

-- للكرون اليومي (مفتاح الخدمة): كل القوالب النشطة في كل المكاتب
create or replace function public.watheq_post_recurring_all()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; skipped int := 0;
begin
  for r in select id from expense_templates where active order by user_id, created_at loop
    begin
      n := n + watheq_post_recurring_one(r.id);
    exception when others then
      skipped := skipped + 1;
    end;
  end loop;
  return jsonb_build_object('posted', n, 'skipped_templates', skipped);
end $$;
revoke all on function public.watheq_post_recurring_all() from public, anon, authenticated;
grant execute on function public.watheq_post_recurring_all() to service_role;

commit;

notify pgrst, 'reload schema';

-- ── فحص: صف واحد ──
select
  to_regclass('public.expense_templates') is not null as جدول_القوالب,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'expenses'
     and column_name in ('recurring_id', 'recurring_month')) as أعمدة_الترحيل_المتوقع_2,
  has_function_privilege('authenticated', 'public.watheq_post_recurring_expenses(uuid)', 'execute') as ترحيل_اللوحة_يجب_true,
  has_function_privilege('authenticated', 'public.watheq_post_recurring_all()', 'execute') as ترحيل_الكل_لـauthenticated_يجب_false,
  (select count(*) from pg_trigger where tgname = 'expenses_recurring_skip_on_delete' and not tgisinternal) as مشغّل_التخطي_المتوقع_1;
