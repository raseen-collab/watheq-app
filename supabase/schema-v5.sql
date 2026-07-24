-- ============================================================
-- وثيق — ترقية المخطط (الإصدار 5)
-- ربط تليجرام برمز بدل نسخ Chat ID يدويًّا
-- شغّله في: Supabase → SQL Editor → New query → Run
-- ============================================================

-- رمز ربط قصير فريد لكل مستخدم
alter table public.profiles add column if not exists telegram_link_code text;
alter table public.profiles add column if not exists telegram_username text;
alter table public.profiles add column if not exists telegram_linked_at timestamptz;

create unique index if not exists idx_profiles_link_code
  on public.profiles(telegram_link_code) where telegram_link_code is not null;

-- توليد رمز عشوائي من 6 خانات (أحرف كبيرة وأرقام، بلا محارف ملتبسة)
create or replace function public.gen_link_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..6 loop
    out := out || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return out;
end;
$$;

-- منح رمز لكل مستخدم لا يملك واحدًا
update public.profiles
set telegram_link_code = public.gen_link_code()
where telegram_link_code is null;

-- توليد الرمز تلقائيًّا لأي مستخدم جديد
create or replace function public.set_link_code()
returns trigger
language plpgsql
as $$
begin
  if new.telegram_link_code is null then
    new.telegram_link_code := public.gen_link_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_code on public.profiles;
create trigger trg_link_code
  before insert on public.profiles
  for each row execute function public.set_link_code();

-- دالة إعادة توليد الرمز (يستدعيها المستخدم من الإعدادات)
create or replace function public.regen_link_code(p_user uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare c text;
begin
  c := public.gen_link_code();
  update public.profiles set telegram_link_code = c where id = p_user;
  return c;
end;
$$;

-- ==================== تحقّق ====================
-- select id, telegram_link_code, telegram_chat_id, telegram_linked_at from public.profiles;
