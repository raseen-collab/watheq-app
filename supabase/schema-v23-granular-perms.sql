-- ============================================================
-- وثيق — schema-v23: صلاحيات دقيقة لكل موظف
--
-- الأدوار الثلاثة (مدير/محصّل/مشاهد) تكفي المكتب الصغير، لكن مالك المحفظة
-- يريد أدقّ: محصّل يسجّل الدفعات ويُصدر الفواتير، وآخر يسجّل ولا يُصدر.
-- الحل: يبقى الدور أساسًا يحدد الافتراضات، وتُضاف استثناءات صريحة لكل موظف
-- في عمود perms (jsonb): {"issue_invoices": false, "edit_tenants": true}.
-- ما لم يُذكر يعود لافتراضي الدور — فلا يتغيّر شيء لمن لم يُخصَّص له استثناء.
--
-- المفاتيح المعتمدة:
--   record_payments  تسجيل الدفعات        (افتراضي: مدير ✓ محصّل ✓ مشاهد ✗)
--   issue_invoices   إصدار الفواتير        (مدير ✓ محصّل ✓ مشاهد ✗)
--   edit_tenants     إضافة/تعديل الوحدات   (مدير ✓ محصّل ✗ مشاهد ✗)
--   manage_listings  المعروضات والطلبات    (مدير ✓ محصّل ✗ مشاهد ✗)
--   view_financials  المصروفات وتقارير المالك وروابطه (مدير ✓ محصّل ✗ مشاهد ✗)
--   export_data      تصدير بيانات المكتب   (مدير ✓ محصّل ✗ مشاهد ✗)
-- ============================================================

alter table team_members add column if not exists perms jsonb not null default '{}'::jsonb;

/**
 * هل يملك المستخدم الحالي صلاحية (perm) في هذا المكتب؟
 * صاحب المكتب: كل شيء. الموظف: استثناؤه الصريح إن وُجد، وإلا افتراضي دوره.
 */
create or replace function watheq_perm(office uuid, perm text)
returns boolean language plpgsql stable security definer
set search_path = public as $$
declare m record; v jsonb; def boolean;
begin
  if office = auth.uid() then return true; end if;
  select role, perms into m from team_members
   where owner_id = office and member_id = auth.uid();
  if not found then return false; end if;

  v := m.perms -> perm;
  if v is not null and jsonb_typeof(v) = 'boolean' then
    return v::text = 'true';                       -- استثناء صريح يتقدّم على الدور
  end if;

  def := case perm
    when 'record_payments' then m.role in ('manager','collector')
    when 'issue_invoices'  then m.role in ('manager','collector')
    when 'edit_tenants'    then m.role = 'manager'
    when 'manage_listings' then m.role = 'manager'
    when 'view_financials' then m.role = 'manager'
    when 'export_data'     then m.role = 'manager'
    else false end;
  return coalesce(def, false);
end $$;

revoke all on function watheq_perm(uuid, text) from public, anon;
grant execute on function watheq_perm(uuid, text) to authenticated, service_role;

-- ---------- ربط السياسات بالصلاحيات الدقيقة ----------
-- الفواتير: الإصدار صار صلاحية مستقلة عن تسجيل الدفعات
drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices for all
  using (watheq_perm(user_id, 'issue_invoices'))
  with check (watheq_perm(user_id, 'issue_invoices'));

-- الوحدات والعقود
drop policy if exists tenants_write on tenants;
create policy tenants_write on tenants for all using (
  exists (select 1 from properties p where p.id = tenants.property_id and watheq_perm(p.user_id, 'edit_tenants')))
  with check (
  exists (select 1 from properties p where p.id = tenants.property_id and watheq_perm(p.user_id, 'edit_tenants')));

-- المعروضات وطلبات الباحثين
drop policy if exists listings_write on listings;
create policy listings_write on listings for all
  using (watheq_perm(user_id, 'manage_listings')) with check (watheq_perm(user_id, 'manage_listings'));
drop policy if exists requests_write on seeker_requests;
create policy requests_write on seeker_requests for all
  using (watheq_perm(user_id, 'manage_listings')) with check (watheq_perm(user_id, 'manage_listings'));

-- الأرقام المالية للمالك: المصروفات وروابط الملّاك
drop policy if exists expenses_read on expenses;
create policy expenses_read on expenses for select using (watheq_perm(user_id, 'view_financials'));
drop policy if exists owner_links_read on owner_links;
create policy owner_links_read on owner_links for select using (watheq_perm(user_id, 'view_financials'));

-- ---------- تسجيل الدفعة والتراجع: صلاحية دقيقة بدل الدور ----------
-- (الدالتان تُعاد كتابتهما بتغيير سطر التحقق فقط — بقية المنطق كما هو)
create or replace function watheq_record_payment(
  p_tenant uuid, p_amount numeric, p_method text default 'transfer',
  p_note text default null, p_paid_on date default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; rent numeric; pool numeric;
        completed int; newpaid int; newpartial numeric; pid uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  select user_id into office from properties where id = t.property_id for update;

  if auth.uid() is not null then
    if not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  rent := coalesce(t.rent_amount, 0);
  if rent <= 0 then raise exception 'قيمة الدفعة غير محدّدة لهذا العقد'; end if;
  pool       := greatest(0, coalesce(t.partial_amount, 0)) + p_amount;
  completed  := floor(pool / rent);
  newpartial := round(pool - completed * rent, 2);
  newpaid    := greatest(0, coalesce(t.paid_periods, 0)) + completed;

  update tenants set paid_periods = newpaid, partial_amount = newpartial where id = p_tenant;
  update properties set collected = coalesce(collected, 0) + p_amount where id = t.property_id;
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by)
  values (office, p_tenant, t.property_id, coalesce(p_paid_on, current_date), p_amount,
          coalesce(nullif(p_method, ''), 'transfer'), completed, p_note, actor)
  returning id into pid;
  return jsonb_build_object('paid_periods', newpaid, 'partial_amount', newpartial,
                            'completed', completed, 'payment_id', pid);
end $$;

-- ---------- watheq_my_office: يعيد صلاحيات الموظف الفعّالة للواجهة ----------
-- (الحماية تبقى في السياسات؛ هذه لإخفاء ما لا يملكه فلا يضغط زرًّا يُرفض)
-- تغيّرت أعمدة الإرجاع (أُضيف perms)، وcreate or replace لا يغيّر نوع الإرجاع
drop function if exists watheq_my_office();
create or replace function watheq_my_office()
returns table (owner_id uuid, role text, account_type text, org_name text,
               plan text, trial_ends_at timestamptz, subscribed_until timestamptz, perms jsonb)
language sql stable security definer set search_path = public as $$
  select tm.owner_id, tm.role, p.account_type, p.org_name, p.plan, p.trial_ends_at, p.subscribed_until,
         jsonb_build_object(
           'record_payments', watheq_perm(tm.owner_id, 'record_payments'),
           'issue_invoices',  watheq_perm(tm.owner_id, 'issue_invoices'),
           'edit_tenants',    watheq_perm(tm.owner_id, 'edit_tenants'),
           'manage_listings', watheq_perm(tm.owner_id, 'manage_listings'),
           'view_financials', watheq_perm(tm.owner_id, 'view_financials'),
           'export_data',     watheq_perm(tm.owner_id, 'export_data')
         )
  from team_members tm join profiles p on p.id = tm.owner_id
  where tm.member_id = auth.uid()
  limit 1;
$$;
revoke all on function watheq_my_office() from public, anon;
grant execute on function watheq_my_office() to authenticated;
