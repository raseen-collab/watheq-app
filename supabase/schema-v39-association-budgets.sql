-- ============================================================
-- وثيق — schema-v39: جدول موازنة الجمعية (مفقود)
--
-- العطل: `association_budgets` تستعلمه لوحة الجمعيات وتكتب فيه، وسياساته
-- معرَّفة في schema-v9، لكن **لا ملف يُنشئ الجدول نفسه**. فمن يفتح موازنة
-- جمعية يراها فارغة (الخطأ مُبتلَع في القراءة)، ومن يحفظها يرى رسالة خطأ.
--
-- وسياسات v9 كانت تُشغَّل على جدول غير موجود — فتفشل أو تُتخطّى بحسب
-- ترتيب التشغيل، وهذا يفسّر لماذا لم يُلاحظ أحد.
--
-- الأعمدة مأخوذة مما يكتبه المكوّن فعلًا (AssociationView.tsx):
--   user_id · association_id · year · items(jsonb) · reserve_pct · notes
-- والقيد الفريد (association_id, year) يطابق onConflict في upsert.
-- ============================================================

create table if not exists public.association_budgets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  association_id uuid not null references public.associations(id) on delete cascade,
  year           int  not null check (year between 1400 and 2200),
  items          jsonb not null default '[]'::jsonb,
  reserve_pct    numeric(5,2) default 10 check (reserve_pct >= 0 and reserve_pct <= 100),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (association_id, year)
);

create index if not exists assoc_budgets_owner_idx on public.association_budgets (user_id);
create index if not exists assoc_budgets_assoc_idx on public.association_budgets (association_id, year);

alter table public.association_budgets enable row level security;

/* نفس نموذج v9: المالك والموظف المصرَّح يقرأ، والمُدير يكتب */
drop policy if exists budgets_read  on public.association_budgets;
drop policy if exists budgets_write on public.association_budgets;
create policy budgets_read  on public.association_budgets for select
  using (watheq_can_read(user_id));
create policy budgets_write on public.association_budgets for all
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));

grant select, insert, update, delete on public.association_budgets to authenticated;

comment on table public.association_budgets is
  'موازنة الجمعية السنوية — بنودها ونسبة الاحتياطي. كانت مفقودة حتى v39.';

-- فحص: يجب أن يُرجع صفًّا واحدًا
select 'association_budgets' as الجدول,
       (select count(*) from information_schema.columns
        where table_schema='public' and table_name='association_budgets') as الأعمدة,
       (select count(*) from pg_policies
        where schemaname='public' and tablename='association_budgets') as السياسات;
