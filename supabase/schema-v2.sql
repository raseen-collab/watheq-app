-- ============================================================
-- وثيق — ترقية المخطط (الإصدار 2)
-- شغّل هذا الملف في: Supabase → SQL Editor → New query → Run
-- آمن للتشغيل حتى لو كان المخطط الأول منفّذًا (إضافي بالكامل)
-- ============================================================

-- ==================== 1) الملفات الشخصية: الدور + التجربة المجانية ====================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text check (role in ('association','property')),
  org_name text,
  trial_started_at timestamptz default now(),
  trial_ends_at timestamptz default (now() + interval '30 days'),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- إنشاء ملف شخصي تلقائيًّا عند التسجيل
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ملفات للمستخدمين الحاليين (إن وُجدوا)
insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data->>'name', '') from auth.users
on conflict (id) do nothing;


-- ==================== 2) العقارات: النوع ====================
-- سكني / معرض تجاري / مكتب / مستودع / فيلا / أرض
alter table public.properties add column if not exists property_type text default 'residential';
alter table public.properties add column if not exists city text;


-- ==================== 3) المستأجرون: دورة التعاقد والدفعات ====================
-- دورة الدفع: يومي / أسبوعي / شهري / ربع سنوي / نصف سنوي / سنوي
alter table public.tenants add column if not exists payment_frequency text default 'monthly';
-- عدد الفترات المسدّدة (يُشتق منها كل شيء: المستحق، المتأخر، تاريخ الاستحقاق القادم)
alter table public.tenants add column if not exists paid_periods integer default 0;
-- مدة العقد بعدد الفترات (اختياري — إن تُرك فارغًا يُحسب من تاريخ النهاية)
alter table public.tenants add column if not exists contract_periods integer;
-- نوع الوحدة (يرث نوع العقار افتراضيًّا)
alter table public.tenants add column if not exists unit_type text;

-- ترحيل البيانات القديمة: months_late → paid_periods
-- (لا نحذف months_late حفاظًا على التوافق، لكن الحساب الجديد يعتمد paid_periods)


-- ==================== 4) فهارس ====================
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_props_type on public.properties(property_type);
create index if not exists idx_tenants_freq on public.tenants(payment_frequency);
