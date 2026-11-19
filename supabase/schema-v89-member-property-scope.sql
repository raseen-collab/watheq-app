-- ═══════════════════════════════════════════════════════════════════
-- schema-v89 — صلاحية الموظف على عقارات محددة (18 نوفمبر 2026)
--
-- الطلب: «كل موظف يكون عنده صلاحية لعقارات محددة مو كل العقارات — حتى المدير.
-- المالك يحدد لكل موظف العقارات اللي يطّلع عليها».
--
-- التصميم:
--   • team_members.property_ids uuid[] — null = كل العقارات (السلوك الحالي، فلا يتغير
--     شيء لأي موظف قائم)، ومصفوفة = هذه العقارات فقط (فارغة = لا شيء).
--   • القراءة والكتابة المباشرة: سياسة «restrictive» واحدة لكل جدول تُضاف (AND) فوق
--     السياسات القائمة — لا تُعاد كتابة أي سياسة سابقة.
--   • الكتابة عبر الدوال (security definer تتجاوز RLS): مشغّل حارس قبل الإدراج/التعديل/الحذف
--     على الجداول نفسها — يعمل داخل كل دالة (تسجيل دفعة، عكس، تعديل، تجديد، إخلاء…).
--   • ما ليس مربوطًا بعقار (حسابات المكتب، روابط الملّاك، جمعيات الملاك، مصروف عام بلا عقار):
--     لصاحب صلاحية «كل العقارات» فقط.
--   • المالك نفسه، والطلبات بلا جلسة (الصفحات العامة، المهام المجدولة) لا يمسّها شيء.
--   • المعروضات وطلبات الباحثين والتزامات المكتب ليست عقارات مُدارة — تبقى على صلاحياتها.
--
-- آمن للتكرار. شغّله كاملًا في Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════
begin;

-- ── ١) العمود ───────────────────────────────────────────────────────
alter table public.team_members add column if not exists property_ids uuid[];
comment on column public.team_members.property_ids is
  'null = كل عقارات المكتب · مصفوفة = هذه العقارات فقط (v89)';

-- صاحب المكتب يضبطه (سياسة team_owner_update القائمة) — منحة العمود فقط
grant update (property_ids) on public.team_members to authenticated;

-- لا يُحفظ إلا عقارات المكتب نفسه، بلا تكرار
create or replace function public.watheq_member_scope_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare bad int;
begin
  if new.property_ids is null then return new; end if;
  new.property_ids := array(select distinct x from unnest(new.property_ids) x where x is not null);
  select count(*) into bad from unnest(new.property_ids) x
   where not exists (select 1 from properties p where p.id = x and p.user_id = new.owner_id);
  if bad > 0 then
    raise exception using errcode = 'P0001', message = 'عقار ليس من عقارات المكتب — أعد تحميل الصفحة واختر من القائمة';
  end if;
  if array_length(new.property_ids, 1) > 2000 then
    raise exception using errcode = 'P0001', message = 'عدد العقارات المختارة أكبر من المسموح';
  end if;
  return new;
end $$;
drop trigger if exists team_members_scope_guard on public.team_members;
create trigger team_members_scope_guard before insert or update of property_ids on public.team_members
  for each row execute function public.watheq_member_scope_guard();
revoke all on function public.watheq_member_scope_guard() from public, anon, authenticated;

-- ── ٢) دوال الحكم ──────────────────────────────────────────────────
-- هل يصل المستخدم الحالي إلى العقار prop في المكتب office؟
--   المالك · بلا جلسة · ليس عضوًا (سياسات أخرى تقرر) · عضو بلا قيد ⟵ true
--   عضو مقيَّد ⟵ prop ضمن قائمته. prop = null (شيء على مستوى المكتب) ⟵ false للمقيَّد.
create or replace function public.watheq_prop_ok(office uuid, prop uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare s uuid[]; found_member boolean;
begin
  if auth.uid() is null or office is null or office = auth.uid() then return true; end if;
  select tm.property_ids, true into s, found_member from team_members tm
   where tm.owner_id = office and tm.member_id = auth.uid();
  if found_member is null or s is null then return true; end if;
  return prop is not null and prop = any(s);
end $$;

-- للجداول التي لا تحمل معرّف المكتب بثقة (tenants · property_notes): المكتب من العقار نفسه
create or replace function public.watheq_prop_visible(prop uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare office uuid;
begin
  if auth.uid() is null or prop is null then return true; end if;
  select p.user_id into office from properties p where p.id = prop;
  if office is null then return true; end if;
  return watheq_prop_ok(office, prop);
end $$;

-- عقار الوحدة (لدفعة قديمة بلا property_id)
create or replace function public.watheq_tenant_prop(p_tenant uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select t.property_id from tenants t where t.id = p_tenant
$$;

revoke all on function public.watheq_prop_ok(uuid, uuid), public.watheq_prop_visible(uuid),
                       public.watheq_tenant_prop(uuid) from public, anon;
grant execute on function public.watheq_prop_ok(uuid, uuid), public.watheq_prop_visible(uuid),
                          public.watheq_tenant_prop(uuid) to authenticated;

-- ── ٣) سياسات restrictive (تُضاف فوق القائمة بـ AND) ──────────────
do $$
declare t text;
begin
  -- (أ) جداول تحمل user_id وproperty_id
  foreach t in array array['expenses', 'invoices', 'trust_ledger', 'past_tenancies', 'ledger_adjustments',
                           'tenant_portal_links', 'tenant_payment_claims', 'tenant_requests',
                           'tenant_portal_audit', 'expense_templates'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists zz_scope on public.%I', t);
      execute format('create policy zz_scope on public.%I as restrictive for all to authenticated
                      using (watheq_prop_ok(user_id, property_id)) with check (watheq_prop_ok(user_id, property_id))', t);
    end if;
  end loop;

  -- (ب) على مستوى المكتب فقط: لصاحب «كل العقارات»
  foreach t in array array['office_ledger', 'owner_links', 'associations', 'association_budgets', 'association_expenses',
                           'hoa_audit', 'hoa_documents', 'hoa_member_links', 'hoa_payment_claims',
                           'hoa_request_log', 'hoa_requests', 'hoa_signatures'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists zz_scope on public.%I', t);
      execute format('create policy zz_scope on public.%I as restrictive for all to authenticated
                      using (watheq_prop_ok(user_id, null)) with check (watheq_prop_ok(user_id, null))', t);
    end if;
  end loop;
end $$;

-- العقارات نفسها: المقيَّد يرى عقاراته فقط، ولا يُنشئ عقارًا جديدًا (لن يكون في قائمته)
drop policy if exists zz_scope on public.properties;
create policy zz_scope on public.properties as restrictive for all to authenticated
  using (watheq_prop_ok(user_id, id)) with check (watheq_prop_ok(user_id, id));

-- الوحدات والملاحظات: المكتب من العقار
drop policy if exists zz_scope on public.tenants;
create policy zz_scope on public.tenants as restrictive for all to authenticated
  using (watheq_prop_visible(property_id)) with check (watheq_prop_visible(property_id));
drop policy if exists zz_scope on public.property_notes;
create policy zz_scope on public.property_notes as restrictive for all to authenticated
  using (watheq_prop_visible(property_id)) with check (watheq_prop_visible(property_id));

-- الدفعات: عقار الدفعة، أو عقار وحدتها إن كانت قديمة بلا property_id.
-- دفعات الجمعيات (owner_id) بلا عقار ⟵ لصاحب «كل العقارات».
drop policy if exists zz_scope on public.payments;
create policy zz_scope on public.payments as restrictive for all to authenticated
  using (watheq_prop_ok(user_id, coalesce(property_id, watheq_tenant_prop(tenant_id))))
  with check (watheq_prop_ok(user_id, coalesce(property_id, watheq_tenant_prop(tenant_id))));

-- سجل تعديل الدفعات: يتبع الدفعة (الاستعلام الفرعي يخضع لسياسة الدفعات أعلاه)
do $$ begin
  if to_regclass('public.payment_edits') is not null then
    drop policy if exists zz_scope on public.payment_edits;
    create policy zz_scope on public.payment_edits as restrictive for select to authenticated
      using (exists (select 1 from payments x where x.id = payment_edits.payment_id));
  end if;
end $$;

-- ملاك الجمعيات وملاحظاتها: تتبع الجمعية (المحجوبة عن المقيَّد أعلاه)
do $$ begin
  if to_regclass('public.owners') is not null then
    drop policy if exists zz_scope on public.owners;
    create policy zz_scope on public.owners as restrictive for all to authenticated
      using (exists (select 1 from associations a where a.id = owners.association_id))
      with check (exists (select 1 from associations a where a.id = owners.association_id));
  end if;
  if to_regclass('public.association_notes') is not null then
    drop policy if exists zz_scope on public.association_notes;
    create policy zz_scope on public.association_notes as restrictive for all to authenticated
      using (exists (select 1 from associations a where a.id = association_notes.association_id))
      with check (exists (select 1 from associations a where a.id = association_notes.association_id));
  end if;
end $$;

-- رسائل الفريق: العامة للجميع، والمربوطة بعقار لمن يصل إليه
do $$ begin
  if to_regclass('public.office_messages') is not null then
    drop policy if exists zz_scope on public.office_messages;
    create policy zz_scope on public.office_messages as restrictive for all to authenticated
      using (property_id is null or watheq_prop_ok(user_id, property_id))
      with check (property_id is null or watheq_prop_ok(user_id, property_id));
  end if;
end $$;

-- ── ٤) الحارس داخل الدوال (security definer تتجاوز RLS) ──────────
-- tg_argv[0]: 'prop' = يُفحص عقار الصف (قبل التعديل وبعده) · 'office' = لصاحب «كل العقارات» فقط
create or replace function public.watheq_scope_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mode text := tg_argv[0];
  rows jsonb[];
  j jsonb;
  office uuid; prop uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  -- المسار السريع: المستخدم ليس موظفًا مقيَّدًا في أي مكتب
  if not exists (select 1 from team_members where member_id = auth.uid() and property_ids is not null) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then rows := array[to_jsonb(old), to_jsonb(new)];
  elsif tg_op = 'DELETE' then rows := array[to_jsonb(old)];
  else rows := array[to_jsonb(new)]; end if;

  foreach j in array rows loop
    office := null; prop := null;
    if tg_table_name = 'properties' then
      office := nullif(j->>'user_id', '')::uuid; prop := (j->>'id')::uuid;
    else
      if j ? 'property_id' then prop := nullif(j->>'property_id', '')::uuid; end if;
      if prop is null and j ? 'tenant_id' and nullif(j->>'tenant_id', '') is not null then
        prop := watheq_tenant_prop((j->>'tenant_id')::uuid);
      end if;
      if j ? 'user_id' then office := nullif(j->>'user_id', '')::uuid; end if;
      if office is null and prop is not null then select p.user_id into office from properties p where p.id = prop; end if;
      if office is null and j ? 'association_id' and nullif(j->>'association_id', '') is not null then
        select a.user_id into office from associations a where a.id = (j->>'association_id')::uuid;
      end if;
    end if;
    if office is null then continue; end if;   -- لا مكتب معروف: سياسات أخرى تحكم

    if not watheq_prop_ok(office, case when mode = 'office' then null else prop end) then
      raise exception using errcode = '42501',
        message = case when mode = 'office'
          then 'هذا القسم لمن صلاحيته «كل العقارات» — راجع صاحب المكتب'
          else 'هذا العقار خارج العقارات المحددة لك — راجع صاحب المكتب' end;
    end if;
  end loop;
  return coalesce(new, old);
end $$;
revoke all on function public.watheq_scope_guard() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['properties', 'tenants', 'payments', 'expenses', 'invoices', 'trust_ledger',
                           'past_tenancies', 'ledger_adjustments', 'tenant_portal_links', 'tenant_payment_claims',
                           'tenant_requests', 'tenant_portal_audit', 'property_notes', 'expense_templates'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_scope_guard on public.%I', t);
      execute format('create trigger zz_scope_guard before insert or update or delete on public.%I
                      for each row execute function public.watheq_scope_guard(%L)', t, 'prop');
    end if;
  end loop;
  foreach t in array array['office_ledger', 'owner_links', 'associations', 'owners', 'association_notes',
                           'association_budgets', 'association_expenses', 'hoa_documents', 'hoa_member_links',
                           'hoa_requests', 'hoa_payment_claims', 'hoa_signatures', 'hoa_audit'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_scope_guard on public.%I', t);
      execute format('create trigger zz_scope_guard before insert or update or delete on public.%I
                      for each row execute function public.watheq_scope_guard(%L)', t, 'office');
    end if;
  end loop;
end $$;

-- رسائل الفريق: العامة (بلا عقار) مسموحة للمقيَّد، والمربوطة بعقار تُفحص — حارس خاص.
create or replace function public.watheq_scope_guard_messages()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  foreach j in array (case tg_op when 'UPDATE' then array[to_jsonb(old), to_jsonb(new)]
                                 when 'DELETE' then array[to_jsonb(old)] else array[to_jsonb(new)] end) loop
    if nullif(j->>'property_id', '') is not null
       and not watheq_prop_ok(nullif(j->>'user_id', '')::uuid, (j->>'property_id')::uuid) then
      raise exception using errcode = '42501', message = 'هذا العقار خارج العقارات المحددة لك — راجع صاحب المكتب';
    end if;
  end loop;
  return coalesce(new, old);
end $$;
revoke all on function public.watheq_scope_guard_messages() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.office_messages') is not null then
    drop trigger if exists zz_scope_guard on public.office_messages;
    create trigger zz_scope_guard before insert or update or delete on public.office_messages
      for each row execute function public.watheq_scope_guard_messages();
  end if;
end $$;

-- ── ٥) رابط المستأجر: إن وُجد رابط تُرجعه الدالة بلا كتابة — فحص صريح ──
create or replace function public.watheq_tenant_link_get_or_create(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; k tenant_portal_links%rowtype; prev boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into t from tenants where id = p_tenant;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  select user_id into office from properties where id = t.property_id;
  if office is null or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  -- (v89) الموظف المقيَّد بعقارات محددة
  if not watheq_prop_ok(office, t.property_id) then raise exception 'not authorized'; end if;
  if coalesce(t.status, 'active') = 'vacated' then raise exception 'الوحدة شاغرة — لا رابط لمستأجر أخلى'; end if;
  if watheq_norm_name(t.name) = '' then raise exception 'أدخل اسم المستأجر أولًا'; end if;

  select * into k from tenant_portal_links where tenant_id = p_tenant and revoked_at is null;
  if not found then
    -- خيار «إظهار المتأخر» يبقى كما ضبطه المكتب لهذا المستأجر في رابط سابق
    select show_balance into prev from tenant_portal_links
     where tenant_id = p_tenant and watheq_norm_name(tenant_name) = watheq_norm_name(t.name)
     order by created_at desc limit 1;
    insert into tenant_portal_links (user_id, property_id, tenant_id, tenant_name, token, show_balance, created_by)
    values (office, t.property_id, t.id, btrim(t.name),
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            coalesce(prev, true), auth.uid())
    on conflict (tenant_id) where revoked_at is null do nothing;
    -- ضغطتان متزامنتان: الثانية تأخذ رابط الأولى
    select * into k from tenant_portal_links where tenant_id = p_tenant and revoked_at is null;
    insert into tenant_portal_audit (user_id, property_id, tenant_id, actor, action, detail)
    values (office, t.property_id, t.id, auth.uid(), 'link_create', jsonb_build_object('link_id', k.id));
  end if;
  return jsonb_build_object('token', k.token, 'show_balance', k.show_balance,
                            'created_at', k.created_at, 'last_seen_at', k.last_seen_at);
end $$;
revoke all on function public.watheq_tenant_link_get_or_create(uuid) from public, anon;
grant execute on function public.watheq_tenant_link_get_or_create(uuid) to authenticated;

-- ── ٦) watheq_my_office: مفتاح all_properties مع الصلاحيات (للواجهة — الإخفاء فقط) ──
create or replace function watheq_my_office()
returns table (owner_id uuid, role text, account_type text, org_name text,
               plan text, trial_ends_at timestamptz, subscribed_until timestamptz, perms jsonb)
language sql stable security definer set search_path = public as $$
  select tm.owner_id, tm.role, p.account_type, p.org_name, p.plan, p.trial_ends_at, p.subscribed_until,
         (select jsonb_object_agg(k, watheq_perm(tm.owner_id, k)) from unnest(array[
           'record_payments','issue_invoices','send_reminders','add_notes','edit_tenants',
           'renew_contracts','move_out','manage_expenses','manage_listings','manage_compliance',
           'view_financials','owner_links','export_data','view_activity','undo_actions']) as k)
         || jsonb_build_object('all_properties', tm.property_ids is null)
  from team_members tm join profiles p on p.id = tm.owner_id
  where tm.member_id = auth.uid()
  limit 1;
$$;

notify pgrst, 'reload schema';
commit;

-- ─── التحقق — صف واحد ───
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'team_members' and column_name = 'property_ids') = 1 as العمود,
  (select count(*) from pg_policies where schemaname = 'public' and policyname = 'zz_scope') as السياسات_المقيِّدة,
  (select count(*) from pg_trigger where tgname = 'zz_scope_guard' and not tgisinternal) as الحراس,
  (select count(*) from team_members where property_ids is not null) as موظفون_مقيَّدون_الآن_يجب_0;
