-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v71: صفحة «اشترك» داخل التطبيق (3 أكتوبر 2026)
--
-- قبلها كان كل زر «جدّد/اشترك» يفتح واتساب عبيد. الآن:
--   صاحب المكتب يختار باقته ← يرى بيانات التحويل ← يضغط «أرسلت الحوالة»
--   ← يصل عبيد تنبيه تليجرام ← يفعّل بضغطة من /admin/subs.
--
-- الأمان:
--   ١) المبلغ يُحسب هنا في القاعدة من جدول الأسعار — لا يُقبل من المتصفح.
--   ٢) صاحب المكتب وحده (لا الموظف)، وطلب معلّق واحد لكل حساب.
--   ٣) الجدول للقراءة فقط لصاحبه؛ الكتابة عبر الدوال وحدها، والاعتماد
--      والرفض لمفتاح الخدمة (لوحة الإدارة).
--   ٤) بلا حارس الاشتراك (zz_entitlement_guard) عمدًا: الحساب المنتهي هو
--      أكثر من يحتاج أن يرسل طلب تجديد.
--   ٥) profiles لا تُمسّ هنا: التفعيل يبقى في لوحة الإدارة كما هو.
--
-- الأسعار (أسعار المؤسسين المنشورة في watheqapp.com، 3 أكتوبر 2026):
--   أملاك: المالك 99/شهر · المكتب 199/شهر أو 1,990/سنة
--   جمعيات: الأساسية 59 · الاحترافية 99 · الشاملة 149 (شهريًا)
--   السنوي متاح لباقة المكتب وحدها (السعر الوحيد المنشور سنويًّا).
--
-- يتطلب v67. آمن للتكرار. معاملة واحدة. لا يغيّر أي بيانات قائمة.
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════
begin;

do $$ begin
  if to_regprocedure('public.watheq_today()') is null
     or to_regclass('public.team_members') is null then
    raise exception 'شغّل schema-v67 أولًا';
  end if;
end $$;

create table if not exists public.subscription_claims (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  account_type    text not null,
  prop_plan       text check (prop_plan in ('basic', 'full')),
  hoa_plan        text check (hoa_plan in ('basic', 'pro', 'full')),
  months          int  not null check (months in (1, 12)),
  amount          numeric(10,2) not null check (amount > 0),
  payer_name      text not null check (char_length(payer_name) between 2 and 80),
  bank_ref        text check (bank_ref is null or char_length(bank_ref) <= 60),
  transfer_date   date not null,
  status          text not null default 'pending' check (status in ('pending', 'processing', 'approved', 'rejected', 'cancelled')),
  reject_reason   text check (reject_reason is null or char_length(reject_reason) <= 200),
  payment_id      uuid,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  check (prop_plan is not null or hoa_plan is not null)
);
create unique index if not exists subscription_claims_one_open
  on public.subscription_claims (user_id) where status in ('pending', 'processing');
create index if not exists subscription_claims_status on public.subscription_claims (status, created_at desc);

alter table public.subscription_claims enable row level security;
revoke all on public.subscription_claims from public, anon, authenticated;
grant select on public.subscription_claims to authenticated;
grant select, insert, update, delete on public.subscription_claims to service_role;
drop policy if exists subscription_claims_own on public.subscription_claims;
create policy subscription_claims_own on public.subscription_claims
  for select to authenticated using (user_id = auth.uid());

-- السعر: null = تركيبة غير متاحة
create or replace function public.watheq_sub_price(p_prop text, p_hoa text, p_months int)
returns numeric language plpgsql immutable as $$
declare total numeric := 0;
begin
  if p_months not in (1, 12) then return null; end if;
  if p_prop is null and p_hoa is null then return null; end if;
  if p_months = 12 then
    -- السنوي لباقة المكتب وحدها
    if p_prop = 'full' and p_hoa is null then return 1990; end if;
    return null;
  end if;
  if p_prop is not null then
    total := total + case p_prop when 'basic' then 99 when 'full' then 199 else null end;
  end if;
  if p_hoa is not null then
    total := total + case p_hoa when 'basic' then 59 when 'pro' then 99 when 'full' then 149 else null end;
  end if;
  return total;
end $$;

-- إرسال الطلب. الرموز: ok · not_signed_in · not_owner · bad_plan · bad_name · bad_ref · bad_date · already_pending
create or replace function public.watheq_sub_claim_submit(p_prop text, p_hoa text, p_months int,
  p_payer text, p_ref text, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); at text; price numeric;
        nm text := btrim(regexp_replace(coalesce(p_payer, ''), '\s+', ' ', 'g'));
        ref text := nullif(btrim(coalesce(p_ref, '')), '');
        pp text := nullif(p_prop, ''); hp text := nullif(p_hoa, '');
begin
  if uid is null then return 'not_signed_in'; end if;
  if exists (select 1 from team_members where member_id = uid) then return 'not_owner'; end if;
  select coalesce(account_type, 'landlord') into at from profiles where id = uid;
  if at is null then return 'not_signed_in'; end if;
  -- الباقة تطابق نوع الحساب
  if at = 'landlord' and (pp is null or hp is not null) then return 'bad_plan'; end if;
  if at = 'hoa_manager' and (hp is null or pp is not null) then return 'bad_plan'; end if;
  price := watheq_sub_price(pp, hp, p_months);
  if price is null then return 'bad_plan'; end if;
  if char_length(nm) not between 2 and 80 then return 'bad_name'; end if;
  if ref is not null and char_length(ref) > 60 then return 'bad_ref'; end if;
  if p_date is null or p_date > watheq_today() or p_date < watheq_today() - 30 then return 'bad_date'; end if;
  if exists (select 1 from subscription_claims where user_id = uid and status in ('pending', 'processing')) then
    return 'already_pending';
  end if;
  insert into subscription_claims (user_id, account_type, prop_plan, hoa_plan, months, amount, payer_name, bank_ref, transfer_date)
  values (uid, at, pp, hp, p_months, price, nm, ref, p_date);
  return 'ok';
exception when unique_violation then
  return 'already_pending';
end $$;

-- إلغاء الطلب المعلّق من صاحبه (اختار باقة خطأ مثلًا)
create or replace function public.watheq_sub_claim_cancel()
returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 'not_signed_in'; end if;
  update subscription_claims set status = 'cancelled', decided_at = now()
   where user_id = auth.uid() and status = 'pending';
  get diagnostics n = row_count;
  return case when n > 0 then 'ok' else 'none' end;
end $$;

revoke all on function public.watheq_sub_price(text, text, int) from public, anon;
grant execute on function public.watheq_sub_price(text, text, int) to authenticated, service_role;
revoke all on function public.watheq_sub_claim_submit(text, text, int, text, text, date) from public, anon;
grant execute on function public.watheq_sub_claim_submit(text, text, int, text, text, date) to authenticated;
revoke all on function public.watheq_sub_claim_cancel() from public, anon;
grant execute on function public.watheq_sub_claim_cancel() to authenticated;

commit;

-- تحقق: يجب أن ترجع الأسطر الثلاثة true
select to_regclass('public.subscription_claims') is not null as table_ok,
       public.watheq_sub_price('full', null, 12) = 1990 as yearly_ok,
       public.watheq_sub_price('full', 'pro', 1) = 298 as both_ok;
