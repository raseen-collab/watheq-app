-- ============================================================
-- وثيق — مخطط قاعدة البيانات (Supabase / PostgreSQL)
-- شغّل هذا الملف في: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ==================== وضع الجمعيات ====================
create table if not exists public.associations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  units integer default 0,
  fee numeric(10,2) default 0,
  cert_expiry date,
  fund_balance numeric(12,2) default 0,
  created_at timestamptz default now()
);

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  name text not null,
  unit text,
  phone text,
  months_late integer default 0,
  last_paid date,
  created_at timestamptz default now()
);

create table if not exists public.association_notes (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  note_date date default current_date,
  text text not null,
  created_at timestamptz default now()
);

-- ==================== وضع الأملاك ====================
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  address text,
  manager text,
  collected numeric(12,2) default 0,
  created_at timestamptz default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  unit text,
  phone text,
  national_id text,
  rent_amount numeric(10,2) default 0,
  contract_start date,
  contract_end date,
  months_late integer default 0,
  last_paid date,
  created_at timestamptz default now()
);

create table if not exists public.property_notes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  note_date date default current_date,
  text text not null,
  created_at timestamptz default now()
);

-- ==================== الفهارس ====================
create index if not exists idx_assoc_user on public.associations(user_id);
create index if not exists idx_owners_assoc on public.owners(association_id);
create index if not exists idx_assocnotes on public.association_notes(association_id);
create index if not exists idx_prop_user on public.properties(user_id);
create index if not exists idx_tenants_prop on public.tenants(property_id);
create index if not exists idx_propnotes on public.property_notes(property_id);

-- ==================== الأمان: كل مستخدم يرى بياناته فقط ====================
alter table public.associations       enable row level security;
alter table public.owners             enable row level security;
alter table public.association_notes  enable row level security;
alter table public.properties         enable row level security;
alter table public.tenants            enable row level security;
alter table public.property_notes     enable row level security;

-- الجمعيات: صاحبها فقط
drop policy if exists assoc_owner_all on public.associations;
create policy assoc_owner_all on public.associations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- الملّاك: تابعون لجمعية يملكها المستخدم
drop policy if exists owners_via_assoc on public.owners;
create policy owners_via_assoc on public.owners
  for all using (exists (select 1 from public.associations a where a.id = owners.association_id and a.user_id = auth.uid()))
  with check    (exists (select 1 from public.associations a where a.id = owners.association_id and a.user_id = auth.uid()));

-- ملاحظات الجمعية
drop policy if exists assocnotes_via_assoc on public.association_notes;
create policy assocnotes_via_assoc on public.association_notes
  for all using (exists (select 1 from public.associations a where a.id = association_notes.association_id and a.user_id = auth.uid()))
  with check    (exists (select 1 from public.associations a where a.id = association_notes.association_id and a.user_id = auth.uid()));

-- العقارات: صاحبها فقط
drop policy if exists prop_owner_all on public.properties;
create policy prop_owner_all on public.properties
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- المستأجرون: تابعون لعقار يملكه المستخدم
drop policy if exists tenants_via_prop on public.tenants;
create policy tenants_via_prop on public.tenants
  for all using (exists (select 1 from public.properties p where p.id = tenants.property_id and p.user_id = auth.uid()))
  with check    (exists (select 1 from public.properties p where p.id = tenants.property_id and p.user_id = auth.uid()));

-- ملاحظات العقار
drop policy if exists propnotes_via_prop on public.property_notes;
create policy propnotes_via_prop on public.property_notes
  for all using (exists (select 1 from public.properties p where p.id = property_notes.property_id and p.user_id = auth.uid()))
  with check    (exists (select 1 from public.properties p where p.id = property_notes.property_id and p.user_id = auth.uid()));
