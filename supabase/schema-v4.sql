-- ============================================================
-- وثيق — ترقية المخطط (الإصدار 4)
-- تصنيف أدوار المستخدمين: hoa_manager / landlord / both
-- شغّله في: Supabase → SQL Editor → New query → Run
-- آمن تمامًا: إضافي + يرحّل البيانات القائمة دون فقدان
-- ============================================================

-- ==================== 1) عمود نوع الحساب ====================
alter table public.profiles add column if not exists account_type text;

-- قيود القيم المسموحة
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_account_type_chk'
  ) then
    alter table public.profiles
      add constraint profiles_account_type_chk
      check (account_type is null or account_type in ('hoa_manager','landlord','both'));
  end if;
end $$;

-- ==================== 2) ترحيل البيانات القائمة ====================
-- الحسابات القديمة كانت تستخدم role: 'association' / 'property'
update public.profiles
set account_type = case
  when role = 'association' then 'hoa_manager'
  when role = 'property'    then 'landlord'
  else account_type
end
where account_type is null and role is not null;

-- ==================== 3) مزامنة عكسية (توافق خلفي) ====================
-- يبقى عمود role متوافقًا مع أي كود قديم
create or replace function public.sync_role_from_account_type()
returns trigger
language plpgsql
as $$
begin
  if new.account_type = 'hoa_manager' then
    new.role := 'association';
  elsif new.account_type = 'landlord' then
    new.role := 'property';
  elsif new.account_type = 'both' then
    -- الحساب المزدوج: نُبقي role على آخر لوحة مستخدمة أو الأملاك افتراضًا
    new.role := coalesce(new.role, 'property');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_role on public.profiles;
create trigger trg_sync_role
  before insert or update of account_type on public.profiles
  for each row execute function public.sync_role_from_account_type();

-- ==================== 4) تذكّر آخر لوحة استُخدمت (للحساب المزدوج) ====================
alter table public.profiles add column if not exists last_dashboard text
  check (last_dashboard is null or last_dashboard in ('association','property'));

-- ==================== 5) دالة صلاحية الوصول ====================
-- تُستخدم للتحقق: هل يملك المستخدم صلاحية لوحة معيّنة؟
create or replace function public.can_access_dashboard(p_user uuid, p_dash text)
returns boolean
language sql
stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and (
        p.account_type = 'both'
        or (p.account_type = 'hoa_manager' and p_dash = 'association')
        or (p.account_type = 'landlord'    and p_dash = 'property')
      )
  );
$$;

-- ==================== 6) فهرس ====================
create index if not exists idx_profiles_account_type on public.profiles(account_type);

-- ==================== تحقّق سريع بعد التشغيل ====================
-- select id, role, account_type, last_dashboard from public.profiles;
