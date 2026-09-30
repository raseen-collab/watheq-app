-- ============================================================
-- وثيق — schema-v67: الباقات والصلاحيات وانتهاء الاشتراك (مرجعها صفحة الأسعار)
--
-- قبل هذا الملف: الاشتراك لا يحدّ شيئًا في القاعدة. المنتهي يعدّل كل شيء،
-- و«باقة المالك» تضيف عقارات بلا حد، و«الأساسية» جمعيات ووحدات بلا حد.
--
-- القرارات (30 سبتمبر 2026):
--   • بعد انتهاء الاشتراك + 5 أيام سماح: الحساب للقراءة والتصدير فقط.
--   • الحساب المزدوج: باقة للأملاك (plan) وباقة للجمعيات (hoa_plan) — كلٌّ بحدوده.
--   • حدود الباقات (صفحة الأسعار):
--       أملاك  basic «باقة المالك»  عقار واحد (التجريبي لا يُحسب)
--              full  «باقة المكتب»  بلا حد   (و pro القديمة تُعامل كالمكتب)
--       جمعيات basic «الأساسية»     جمعية واحدة، حتى 20 وحدة
--              pro   «الاحترافية»   جمعية واحدة، وحدات بلا حد
--              full  «الشاملة»      جمعيات بلا حد
--     التجربة = كل المزايا بلا حدود.
--
-- الحارس مشغِّل BEFORE على جداول العمل — لا يمسّ سياسات RLS القائمة.
-- لا يعمل إلا لطلبات المستخدمين (auth.uid() موجود): الخادم بمفتاح الخدمة
-- (الاستحقاق الشهري، بوابة المالك، لوحة الإدارة) ومحرر SQL لا يُحجبان.
--
-- آمن للتشغيل أكثر من مرة.
-- ============================================================

-- ─── ١) باقة الجمعيات للحساب المزدوج ──────────────────────────
-- العمود + تعبئة الحسابات المزدوجة القائمة مرة واحدة فقط (عند إنشاء العمود):
-- كانت plan وحدها تغطي الجهتين، فلا نسحب منها شيئًا — باقة الجمعيات = باقتها الحالية.
-- إعادة تشغيل الملف لاحقًا لا تعيد التعبئة (فلا تُمنح باقة جمعيات لمن اشترى الأملاك وحدها).
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'hoa_plan') then
    alter table public.profiles add column hoa_plan text;
    update public.profiles set hoa_plan = lower(plan)
     where account_type = 'both' and lower(coalesce(plan, '')) in ('basic', 'pro', 'full');
  end if;
end $$;
alter table public.profiles drop constraint if exists profiles_hoa_plan_chk;
alter table public.profiles add constraint profiles_hoa_plan_chk
  check (hoa_plan is null or hoa_plan in ('basic', 'pro', 'full'));
-- لا منح UPDATE عليه للمستخدمين: عمود مالي مثل plan (تُضبط من لوحة الإدارة فقط)
revoke update (hoa_plan) on public.profiles from authenticated, anon;


-- نوع الحساب يحدّد أي باقة تسري على أي جهة، فتغييره من الإعدادات يغيّر الصلاحيات:
-- مشترك «احترافية» جمعيات يتحوّل «أملاك» فتُقرأ باقته باقةَ مكتب بلا حد.
-- المستخدم يغيّره بنفسه ما دام بلا باقة (تجربة)؛ وبعد الاشتراك من لوحة الإدارة.
create or replace function public.watheq_profile_type_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and new.account_type is distinct from old.account_type
     and (old.plan is not null or old.hoa_plan is not null) then
    raise exception using errcode = 'P0001',
      message = 'تغيير نوع الحساب بعد الاشتراك يتم عن طريقنا — راسلنا ونغيّره لك مع باقته المناسبة.';
  end if;
  return new;
end $$;
revoke all on function public.watheq_profile_type_guard() from public, anon, authenticated;
drop trigger if exists zz_profile_type_guard on public.profiles;
create trigger zz_profile_type_guard before update of account_type on public.profiles
  for each row execute function public.watheq_profile_type_guard();

-- ─── ٢) حالة المنتج للمكتب — مصدر الحقيقة في القاعدة ─────────────
-- يطابق lib/subscription.ts: paid → grace (5 أيام) → trial → expired
create or replace function public.watheq_product_state(p_office uuid, p_product text)
returns table (state text, plan text)
language sql stable security definer set search_path = public as $$
  with p as (
    select lower(coalesce(case when p_product = 'hoa' and pr.account_type = 'both' then pr.hoa_plan else pr.plan end, '')) as pl,
           pr.subscribed_until as su, pr.trial_ends_at as te
      from profiles pr where pr.id = p_office
  )
  select case
           when pl in ('basic','pro','full') and (su is null or su >= now()) then 'paid'
           when pl in ('basic','pro','full') and su > now() - interval '5 days' then 'grace'
           when te is not null and te >= now() then 'trial'
           else 'expired'
         end,
         nullif(pl, '')
    from p;
$$;
revoke all on function public.watheq_product_state(uuid, text) from public, anon, authenticated;

-- ─── ٣) ما يراه التطبيق: حالة المكتب الذي يعمل فيه المستخدم ─────────
-- (المالك نفسه، أو مكتب الموظف) — يستعمله المستشار واللوحة
create or replace function public.watheq_my_entitlements()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_office uuid; r profiles%rowtype; ps record; hs record;
begin
  select coalesce((select tm.owner_id from team_members tm where tm.member_id = auth.uid() limit 1), auth.uid())
    into v_office;
  if v_office is null then return null; end if;
  select * into r from profiles where id = v_office;
  select * into ps from watheq_product_state(v_office, 'property');
  select * into hs from watheq_product_state(v_office, 'hoa');
  return jsonb_build_object(
    'office_id', v_office, 'account_type', r.account_type,
    'plan', r.plan, 'hoa_plan', r.hoa_plan,
    'trial_ends_at', r.trial_ends_at, 'subscribed_until', r.subscribed_until,
    'property', jsonb_build_object('state', ps.state, 'plan', ps.plan),
    'hoa', jsonb_build_object('state', hs.state, 'plan', hs.plan),
    -- هوية المكتب على المستندات: الموظف يصدر مستندات مكتبه لا ملفه الشخصي
    -- (كان يقرأ ملفه الفارغ: ترويسة بلا اسم المكتب، وعلامة «نسخة تجريبية»
    --  بعد 30 يومًا من تسجيله هو ولو كان المكتب مشتركًا)
    'issuer', jsonb_build_object('org_name', r.org_name, 'full_name', r.full_name,
      'billing_name', r.billing_name, 'vat_number', r.vat_number, 'cr_number', r.cr_number,
      'billing_phone', r.billing_phone),
    'windows', jsonb_build_object('due_soon_days', r.due_soon_days,
      'due_imminent_days', r.due_imminent_days, 'expiring_days', r.expiring_days));
end $$;
revoke all on function public.watheq_my_entitlements() from public, anon;
grant execute on function public.watheq_my_entitlements() to authenticated;

-- ─── ٤) الحارس ────────────────────────────────────────────────
create or replace function public.watheq_entitlement_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(coalesce(new, old));
  v_product text := tg_argv[0];
  v_office uuid; v_state text; v_plan text; n int;
begin
  -- الخادم (مفتاح الخدمة) ومحرر SQL: بلا حجب
  if auth.uid() is null then return coalesce(new, old); end if;

  -- الدفعات: دفعة جمعية أم دفعة عقار
  if tg_table_name = 'payments' then
    v_product := case when (j ? 'association_id' and j->>'association_id' is not null)
                        or (j ? 'owner_id' and j->>'owner_id' is not null) then 'hoa' else 'property' end;
  end if;

  -- المكتب صاحب الصف
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
  if v_office is null then return coalesce(new, old); end if;   -- لا نعرف صاحبه: لا نحجب

  select s.state, s.plan into v_state, v_plan from watheq_product_state(v_office, v_product) s;

  -- ١) انتهى الاشتراك وأيام السماح: قراءة وتصدير فقط
  if v_state = 'expired' then
    raise exception using errcode = 'P0001',
      message = 'انتهى الاشتراك أو التجربة — الحساب الآن للقراءة والتصدير فقط. فعّل الاشتراك لتعود الإضافة والتعديل.';
  end if;

  -- ٢) حدود الباقة عند الإضافة (التجربة بلا حدود). واستعادة جمعية مؤرشفة
  --    تُعدّ إضافة — وإلا: أرشِف، أنشئ غيرها، ثم استعد الأولى فتصير جمعيتين
  if v_state in ('paid', 'grace') and (tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and tg_table_name = 'associations'
           and (to_jsonb(old)->>'archived_at') is not null and (j->>'archived_at') is null)) then
    if tg_op = 'INSERT' and tg_table_name = 'properties' and v_plan = 'basic' and not coalesce((j->>'is_demo')::boolean, false) then
      -- قفل صف المكتب (للمحدود فقط): طلبان متزامنان لا يعدّان العدد نفسه فيتجاوزان الحد معًا
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

-- ─── ٤ب) رقم الفاتورة الضريبية: لا يُحجز لحساب منتهٍ ─────────────────
-- (كان يُحجز الرقم ثم يُرفض إدراج الفاتورة — فجوة في التسلسل الضريبي)
-- نفس تعريف v48 حرفيًّا + سطر الحالة
create or replace function public.next_invoice_no(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n int; uid uuid := auth.uid();
begin
  if uid is null or not (uid = p_user
      or watheq_perm(p_user, 'record_payments')
      or watheq_perm(p_user, 'edit_units')) then
    raise exception 'not authorized';
  end if;

  if (select state from watheq_product_state(p_user, 'property')) = 'expired' then
    raise exception using errcode = 'P0001',
      message = 'انتهى الاشتراك أو التجربة — الحساب الآن للقراءة والتصدير فقط. فعّل الاشتراك لتعود الإضافة والتعديل.';
  end if;

  update public.profiles set invoice_counter = coalesce(invoice_counter, 0) + 1
   where id = p_user returning invoice_counter into n;

  if n is null then raise exception 'المكتب غير موجود'; end if;
  return 'INV-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(n::text, 4, '0');
end $$;
revoke all on function public.next_invoice_no(uuid) from public, anon;
grant execute on function public.next_invoice_no(uuid) to authenticated;

-- ─── ٥) تركيبه على جداول العمل (الموجود منها فقط) ──────────────────
do $$
declare t text; prod text;
  tbls text[][] := array[
    ['properties','property'], ['tenants','property'], ['payments','property'],
    ['past_tenancies','property'], ['property_notes','property'], ['expenses','property'],
    ['listings','property'], ['seeker_requests','property'], ['owner_links','property'],
    ['compliance_items','property'], ['invoices','property'], ['ad_posts','property'],
    ['associations','hoa'], ['owners','hoa'], ['association_budgets','hoa'],
    ['association_expenses','hoa'], ['association_notes','hoa'], ['hoa_documents','hoa'],
    ['hoa_signatures','hoa'], ['hoa_requests','hoa'], ['hoa_payment_claims','hoa'],
    ['hoa_member_links','hoa']];
  i int;
begin
  for i in 1 .. array_length(tbls, 1) loop
    t := tbls[i][1]; prod := tbls[i][2];
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_entitlement_guard on public.%I', t);
      execute format('create trigger zz_entitlement_guard before insert or update or delete on public.%I
                      for each row execute function public.watheq_entitlement_guard(%L)', t, prod);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ─── التحقق ───────────────────────────────────────────────────
-- ١) عدد الجداول المحمية (المتوقع: عدد الموجود من القائمة، ≈ 20)
select count(*) as جداول_محمية
  from pg_trigger where tgname = 'zz_entitlement_guard' and not tgisinternal;
-- ٢) المستخدم لا يستطيع تعديل باقة الجمعيات بنفسه (المتوقع: false)
select has_column_privilege('authenticated', 'public.profiles', 'hoa_plan', 'UPDATE') as يعدّل_hoa_plan,
       has_column_privilege('authenticated', 'public.profiles', 'plan', 'UPDATE') as يعدّل_plan;
-- ٣) حالة كل حساب بعد التطبيق — راجع أي «expired» غير متوقَّع
select coalesce(p.org_name, p.full_name) as الحساب, p.account_type, p.plan, p.hoa_plan,
       (select state from watheq_product_state(p.id, 'property')) as حالة_الأملاك,
       (select state from watheq_product_state(p.id, 'hoa')) as حالة_الجمعيات,
       p.trial_ends_at::date as نهاية_التجربة, p.subscribed_until::date as نهاية_الاشتراك
  from profiles p
 where p.account_type is not null
 order by 5, 1;
