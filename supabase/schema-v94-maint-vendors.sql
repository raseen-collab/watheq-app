-- ============================================================
-- وثيق — schema-v94: دليل الفنيين للصيانة (22 نوفمبر 2026)
--
-- الفني يُكتب اليوم في كل طلب من جديد (اسمه وجواله). هنا قائمة فنيي المكتب
-- بتخصصاتهم، تُختار في الطلب بضغطة. جدول للمكتب كله (لا لعقار بعينه).
--
-- الصلاحيات (نفس قواعد المكتب):
--   القراءة: watheq_can_read(user_id) — كل موظف يرى قائمة فنيي مكتبه.
--   الإضافة والتعديل والحذف: watheq_can_maintain(user_id) — من يدير الصيانة.
--   user_id يُثبَّت عند الإدراج للمكتب الذي يملك صاحب الطلب صلاحية الصيانة فيه
--   (فحص with check)، ولا يُنقل فني لمكتب آخر (فحص التعديل).
-- آمن للتكرار. لا يحذف شيئًا.
-- ============================================================

create table if not exists public.maintenance_vendors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  phone text check (phone is null or phone ~ '^[0-9+ -]{7,20}$'),
  specialty text not null default 'other'
    check (specialty in ('plumbing','electric','ac','elevator','cleaning','security','painting','carpentry','general','other')),
  notes text check (notes is null or char_length(notes) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_vendors_office_idx on public.maintenance_vendors (user_id, active);

alter table public.maintenance_vendors enable row level security;

drop policy if exists maint_vendors_read on public.maintenance_vendors;
create policy maint_vendors_read on public.maintenance_vendors
  for select to authenticated using (public.watheq_can_read(user_id));

drop policy if exists maint_vendors_insert on public.maintenance_vendors;
create policy maint_vendors_insert on public.maintenance_vendors
  for insert to authenticated with check (public.watheq_can_maintain(user_id));

drop policy if exists maint_vendors_update on public.maintenance_vendors;
create policy maint_vendors_update on public.maintenance_vendors
  for update to authenticated using (public.watheq_can_maintain(user_id)) with check (public.watheq_can_maintain(user_id));

drop policy if exists maint_vendors_delete on public.maintenance_vendors;
create policy maint_vendors_delete on public.maintenance_vendors
  for delete to authenticated using (public.watheq_can_maintain(user_id));

revoke all on public.maintenance_vendors from anon;
grant select, insert, update, delete on public.maintenance_vendors to authenticated;

-- تحقق: RLS مفعّل، 4 سياسات، ولا صلاحية لـ anon (المتوقع: true · 4 · false)
select c.relrowsecurity as rls_on,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'maintenance_vendors') as policies,
       has_table_privilege('anon', 'public.maintenance_vendors', 'select') as anon_can_read
from pg_class c where c.oid = 'public.maintenance_vendors'::regclass;
