-- ============================================================
-- وثيق — schema-v78: المسوّق العقاري (2 نوفمبر 2026)
--
-- نوع حساب جديد «marketer»: فرد يسوّق عقارات غيره، يرى من لوحة الأملاك
-- المعروضات والطلبات فقط. باقته واحدة سنوية «marketer» (399 ريالًا)،
-- وتجربة 30 يومًا كغيره (أول 5 يُمنحون 3 أشهر يدويًّا من لوحة الإدارة).
--
-- يشمل:
--   ١) نوع الحساب والباقة في profiles وحارسي الحالة والصلاحيات
--   ٢) الحارس: حساب المسوّق لا يكتب إلا في جداول المعروضات
--   ٣) الاشتراك: السعر 399 سنويًّا وطلب الحوالة من /subscribe
--   ٤) تحسينات المعروضات للمسوّق: نسبة السعي ونصيبه، تفويض المالك،
--      سجل «عُرض على»، رابط عام للزبون (بلا جوال المالك)،
--      وآخر تواصل/موعد متابعة في طلبات الباحثين
--
-- آمن للتشغيل أكثر من مرة. شغّله في Supabase → SQL Editor → Run.
-- ============================================================

-- ─── ١) نوع الحساب ─────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_account_type_chk;
alter table public.profiles add constraint profiles_account_type_chk
  check (account_type is null or account_type in ('hoa_manager','landlord','both','marketer'));

-- role المتوافق مع الكود القديم: المسوّق تحت لوحة الأملاك
create or replace function public.sync_role_from_account_type()
returns trigger language plpgsql as $$
begin
  if new.account_type = 'hoa_manager' then
    new.role := 'association';
  elsif new.account_type in ('landlord', 'marketer') then
    new.role := 'property';
  elsif new.account_type = 'both' then
    new.role := coalesce(new.role, 'property');
  end if;
  return new;
end $$;

create or replace function public.can_access_dashboard(p_user uuid, p_dash text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and (
        p.account_type = 'both'
        or (p.account_type = 'hoa_manager' and p_dash = 'association')
        or (p.account_type in ('landlord', 'marketer') and p_dash = 'property')
      )
  );
$$;

-- حالة المنتج: الباقة marketer مدفوعة كغيرها؛ وحساب المسوّق لا منتج جمعيات له
create or replace function public.watheq_product_state(p_office uuid, p_product text)
returns table (state text, plan text)
language sql stable security definer set search_path = public as $$
  with p as (
    select lower(coalesce(case when p_product = 'hoa' and pr.account_type = 'both' then pr.hoa_plan else pr.plan end, '')) as pl,
           pr.subscribed_until as su, pr.trial_ends_at as te, pr.account_type as at
      from profiles pr where pr.id = p_office
  )
  select case
           when at = 'marketer' and p_product = 'hoa' then 'expired'
           when pl in ('basic','pro','full','marketer') and (su is null or su >= now()) then 'paid'
           when pl in ('basic','pro','full','marketer') and su > now() - interval '5 days' then 'grace'
           when te is not null and te >= now() then 'trial'
           else 'expired'
         end,
         nullif(pl, '')
    from p;
$$;
revoke all on function public.watheq_product_state(uuid, text) from public, anon, authenticated;

-- ─── ٢) الحارس: المسوّق يكتب في جداول المعروضات فقط ──────────────
-- نفس دالة v67 مع فحص واحد إضافي في أولها. القائمة المسموحة: المعروضات،
-- طلبات الباحثين، روابطها وسجل عرضها، والالتزامات (رخصة فال وتراخيص
-- الإعلانات تُسجَّل فيها) وسجل الإعلانات.
create or replace function public.watheq_entitlement_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(coalesce(new, old));
  v_product text := tg_argv[0];
  v_office uuid; v_state text; v_plan text; v_type text; n int;
begin
  if auth.uid() is null then return coalesce(new, old); end if;

  if tg_table_name = 'payments' then
    v_product := case when (j ? 'association_id' and j->>'association_id' is not null)
                        or (j ? 'owner_id' and j->>'owner_id' is not null) then 'hoa' else 'property' end;
  end if;

  v_office := nullif(j->>'user_id', '')::uuid;
  if v_office is null and j ? 'association_id' and j->>'association_id' is not null then
    select a.user_id into v_office from associations a where a.id = (j->>'association_id')::uuid;
  end if;
  if v_office is null and j ? 'property_id' and j->>'property_id' is not null then
    select p.user_id into v_office from properties p where p.id = (j->>'property_id')::uuid;
  end if;
  if v_office is null and j ? 'tenant_id' and j->>'tenant_id' is not null then
    select t.user_id into v_office from tenants t where t.id = (j->>'tenant_id')::uuid;
  end if;
  if v_office is null then return coalesce(new, old); end if;

  -- (v78) حساب المسوّق العقاري: المعروضات وما حولها فقط — تجربةً واشتراكًا
  select account_type into v_type from profiles where id = v_office;
  if v_type = 'marketer' and tg_table_name not in
     ('listings','seeker_requests','listing_links','listing_shows','compliance_items','ad_posts') then
    raise exception using errcode = 'P0001',
      message = 'حساب المسوّق العقاري يشمل المعروضات والطلبات فقط — لإدارة عقارات ووحدات مؤجّرة راسلنا لتحويل الحساب إلى باقة المالك أو المكتب.';
  end if;

  select s.state, s.plan into v_state, v_plan from watheq_product_state(v_office, v_product) s;

  if v_state = 'expired' then
    raise exception using errcode = 'P0001',
      message = 'انتهى الاشتراك أو التجربة — الحساب الآن للقراءة والتصدير فقط. فعّل الاشتراك لتعود الإضافة والتعديل.';
  end if;

  if v_state in ('paid', 'grace') and (tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and tg_table_name = 'associations'
           and (to_jsonb(old)->>'archived_at') is not null and (j->>'archived_at') is null)) then
    if tg_op = 'INSERT' and tg_table_name = 'properties' and v_plan = 'basic' and not coalesce((j->>'is_demo')::boolean, false) then
      perform 1 from profiles where id = v_office for update;
      select count(*) into n from properties where user_id = v_office and not coalesce(is_demo, false);
      if n >= 1 then
        raise exception using errcode = 'P0001',
          message = 'باقة المالك تشمل عقارًا واحدًا — لإضافة عقارات أكثر انتقل إلى باقة المكتب.';
      end if;
    elsif tg_table_name = 'associations' and v_plan in ('basic', 'pro') then
      perform 1 from profiles where id = v_office for update;
      select count(*) into n from associations
       where user_id = v_office and archived_at is null
         and (tg_op = 'INSERT' or id <> (j->>'id')::uuid);
      if n >= 1 then
        raise exception using errcode = 'P0001',
          message = 'باقتك تشمل جمعية واحدة — لإدارة أكثر من جمعية انتقل إلى الباقة الشاملة.';
      end if;
    elsif tg_op = 'INSERT' and tg_table_name = 'owners' and v_plan = 'basic' then
      perform 1 from profiles where id = v_office for update;
      select count(*) into n from owners where association_id = (j->>'association_id')::uuid;
      if n >= 20 then
        raise exception using errcode = 'P0001',
          message = 'الباقة الأساسية تشمل حتى 20 وحدة — للوحدات بلا حد انتقل إلى الباقة الاحترافية.';
      end if;
    end if;
  end if;

  return coalesce(new, old);
end $$;
revoke all on function public.watheq_entitlement_guard() from public, anon, authenticated;

-- ─── ٣) الاشتراك ───────────────────────────────────────────────
alter table public.subscription_claims drop constraint if exists subscription_claims_prop_plan_check;
alter table public.subscription_claims add constraint subscription_claims_prop_plan_check
  check (prop_plan in ('basic', 'full', 'marketer'));

create or replace function public.watheq_sub_price(p_prop text, p_hoa text, p_months int)
returns numeric language plpgsql immutable as $$
declare total numeric := 0;
begin
  if p_months not in (1, 12) then return null; end if;
  if p_prop is null and p_hoa is null then return null; end if;
  if p_months = 12 then
    if p_prop = 'full' and p_hoa is null then return 1990; end if;
    if p_prop = 'marketer' and p_hoa is null then return 399; end if;   -- (v78) باقة المسوّق سنوية فقط
    return null;
  end if;
  if p_prop = 'marketer' then return null; end if;                        -- لا شهري للمسوّق
  if p_prop is not null then
    total := total + case p_prop when 'basic' then 99 when 'full' then 199 else null end;
  end if;
  if p_hoa is not null then
    total := total + case p_hoa when 'basic' then 59 when 'pro' then 99 when 'full' then 149 else null end;
  end if;
  return total;
end $$;

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
  if at = 'landlord' and (pp is null or hp is not null or pp = 'marketer') then return 'bad_plan'; end if;
  if at = 'hoa_manager' and (hp is null or pp is not null) then return 'bad_plan'; end if;
  if at = 'both' and pp = 'marketer' then return 'bad_plan'; end if;
  -- (v78) المسوّق: باقته marketer وحدها، سنويًّا
  if at = 'marketer' and (pp is distinct from 'marketer' or hp is not null or p_months <> 12) then return 'bad_plan'; end if;
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

-- ─── ٤) تحسينات المعروضات ──────────────────────────────────────
-- نسبة السعي ونصيب المسوّق منه (المصدر owner/broker موجود من قبل)
alter table public.listings add column if not exists commission_pct numeric(5,2)
  check (commission_pct is null or (commission_pct >= 0 and commission_pct <= 100));
alter table public.listings add column if not exists my_share_pct numeric(5,2)
  check (my_share_pct is null or (my_share_pct >= 0 and my_share_pct <= 100));
-- تفويض المالك: null = لم يُحدَّد، true = موجود، false = لا تفويض.
-- authorization_ack_at: المسوّق قرأ تنبيه «لا تفويض» وأقرّ به (يُمسح للتراجع)
alter table public.listings add column if not exists owner_authorized boolean;
alter table public.listings add column if not exists authorization_ack_at timestamptz;
-- المالك يسوّقه عبر وسطاء آخرين (غير حصري): السعي لمن عرّف الطرفين أولًا — تذكير بتأكيد السعر
alter table public.listings add column if not exists others_marketing boolean not null default false;

-- طلبات الباحثين: آخر تواصل وموعد المتابعة
alter table public.seeker_requests add column if not exists last_contact_at date;
alter table public.seeker_requests add column if not exists follow_up_at date;

-- سجل «عُرض على»: من رأى هذا المعروض ومتى — ذاكرة المسوّق مع زبائنه
create table if not exists public.listing_shows (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  listing_id     uuid not null references public.listings(id) on delete cascade,
  customer_name  text check (customer_name is null or char_length(customer_name) <= 80),
  customer_phone text check (customer_phone is null or char_length(customer_phone) <= 30),
  shown_at       date not null default (now() at time zone 'Asia/Riyadh')::date,
  note           text check (note is null or char_length(note) <= 300),
  created_at     timestamptz not null default now(),
  check (customer_name is not null or customer_phone is not null)
);
create index if not exists idx_listing_shows_listing on public.listing_shows(listing_id, shown_at desc);
alter table public.listing_shows enable row level security;
drop policy if exists listing_shows_read on public.listing_shows;
create policy listing_shows_read on public.listing_shows for select using (watheq_can_read(user_id));
drop policy if exists listing_shows_write on public.listing_shows;
create policy listing_shows_write on public.listing_shows for all
  using (watheq_perm(user_id, 'manage_listings')) with check (watheq_perm(user_id, 'manage_listings'));
grant select, insert, update, delete on public.listing_shows to authenticated;

-- رابط عام للزبون: صور ومواصفات بلا جوال المالك. يُبطَل بضغطة، ويتوقّف
-- وحده حين تخرج الحالة من «متاح/محجوز» (الدالة أدناه ترجع متاح=false).
create table if not exists public.listing_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  token       text not null unique check (token ~ '^[0-9a-f]{48}$'),
  revoked     boolean not null default false,
  views       int not null default 0,
  last_view_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_listing_links_listing on public.listing_links(listing_id);
alter table public.listing_links enable row level security;
drop policy if exists listing_links_read on public.listing_links;
create policy listing_links_read on public.listing_links for select using (watheq_can_read(user_id));
drop policy if exists listing_links_write on public.listing_links;
create policy listing_links_write on public.listing_links for all
  using (watheq_perm(user_id, 'manage_listings')) with check (watheq_perm(user_id, 'manage_listings'));
grant select, insert, update, delete on public.listing_links to authenticated;

-- الحارس على الجدولين الجديدين (منتهي التجربة لا يُنشئ روابط ولا سجلات)
do $$ begin
  execute 'drop trigger if exists zz_entitlement_guard on public.listing_shows';
  execute 'create trigger zz_entitlement_guard before insert or update or delete on public.listing_shows
           for each row execute function public.watheq_entitlement_guard(''property'')';
  execute 'drop trigger if exists zz_entitlement_guard on public.listing_links';
  execute 'create trigger zz_entitlement_guard before insert or update or delete on public.listing_links
           for each row execute function public.watheq_entitlement_guard(''property'')';
end $$;

-- ما تراه صفحة الزبون /l/{token} — تُستدعى بمفتاح الخدمة فقط (app/l/[token]/route.ts).
-- لا جوال المالك ولا اسمه ولا الصك ولا المصدر ولا السعي: مواصفات وسعر وصور وجوال المسوّق.
-- الرمز المجهول والمُبطَل يرجعان null (الرد نفسه). المعروض غير المتاح يرجع open=false
-- فتعرض الصفحة «لم يعد متاحًا» بلا تفاصيل — الرابط «ينكسر» وحده مع الحالة.
create or replace function public.watheq_listing_public(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lk record; l record; pr record;
begin
  if p_token !~ '^[0-9a-f]{48}$' then return null; end if;
  select * into lk from listing_links where token = p_token and not revoked;
  if lk is null then return null; end if;
  select * into l from listings where id = lk.listing_id;
  if l is null then return null; end if;
  select org_name, full_name, billing_phone, account_type into pr from profiles where id = lk.user_id;
  return jsonb_build_object(
    'open', coalesce(l.status, 'available') in ('available', 'reserved'),
    'status', coalesce(l.status, 'available'),
    'code', l.code, 'kind', l.kind, 'offer_type', l.offer_type, 'title', l.title,
    'district', l.district, 'city', l.city, 'price', l.price, 'area', l.area,
    'rooms', l.rooms, 'baths', l.baths, 'floor_no', l.floor_no, 'building_age', l.building_age,
    'furnished', l.furnished, 'street_count', l.street_count, 'plan_no', l.plan_no,
    'note', null,
    'owner_id', lk.user_id, 'listing_id', l.id,
    'office', jsonb_build_object('name', coalesce(pr.org_name, pr.full_name), 'phone', pr.billing_phone)
  );
end $$;
revoke all on function public.watheq_listing_public(text) from public, anon, authenticated;
grant execute on function public.watheq_listing_public(text) to service_role;

-- عدّاد المشاهدات (الخادم فقط)
create or replace function public.watheq_listing_link_seen(p_token text)
returns void language sql security definer set search_path = public as $$
  update listing_links set views = views + 1, last_view_at = now() where token = p_token and not revoked;
$$;
revoke all on function public.watheq_listing_link_seen(text) from public, anon, authenticated;
grant execute on function public.watheq_listing_link_seen(text) to service_role;

notify pgrst, 'reload schema';

-- ─── التحقق ───────────────────────────────────────────────────
-- ١) القيد يعرف marketer:
select pg_get_constraintdef(oid) from pg_constraint where conname = 'profiles_account_type_chk';
-- ٢) الأعمدة الجديدة (المتوقع 7 صفوف):
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'listings' and column_name in ('commission_pct','my_share_pct','owner_authorized','authorization_ack_at','others_marketing'))
     or (table_name = 'seeker_requests' and column_name in ('last_contact_at','follow_up_at')))
 order by 1, 2;
-- ٣) السعر: 399
select watheq_sub_price('marketer', null, 12);
