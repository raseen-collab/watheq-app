-- ============================================================
-- وثيق — schema-v24: توسعة الصلاحيات الدقيقة + حصر التراجع
--
-- (1) التراجع عن أي خطوة (إلغاء دفعة، حذف وحدة أو دفعة أو مصروف، إخلاء،
--     تجديد) للمالك والمدير فقط — مهما مُنح المحصّل من صلاحيات أخرى.
--     مبرّره: التسجيل خطأً يُصحَّح بتراجع موثّق؛ أما من يملك التراجع فيملك
--     محو الأثر، وهذه صلاحية إدارية لا تشغيلية.
-- (2) صلاحيات إضافية يختارها صاحب المكتب بحرية أكبر.
--
-- المفاتيح الكاملة (الافتراضي بين قوسين: مدير/محصّل/مشاهد):
--   record_payments   تسجيل الدفعات                 (✓/✓/✗)
--   issue_invoices    إصدار الفواتير                (✓/✓/✗)
--   send_reminders    التذكيرات والخطابات           (✓/✓/✗)
--   add_notes         إضافة ملاحظات على العقار      (✓/✓/✗)
--   edit_tenants      إضافة وتعديل الوحدات والعقود  (✓/✗/✗)
--   renew_contracts   تجديد العقود                  (✓/✗/✗)
--   move_out          تسجيل الإخلاء والمخالصة       (✓/✗/✗)
--   manage_expenses   تسجيل المصروفات               (✓/✗/✗)
--   manage_listings   المعروضات وطلبات الباحثين     (✓/✗/✗)
--   manage_compliance التزامات المكتب والتراخيص     (✓/✗/✗)
--   view_financials   أرقام المالك والأتعاب         (✓/✗/✗)
--   owner_links       إنشاء روابط الملّاك وإبطالها  (✓/✗/✗)
--   export_data       تصدير بيانات المكتب           (✓/✗/✗)
--   view_activity     سجل العمليات                  (✓/✓/✓)
--   undo_actions      التراجع والحذف                (✓/✗/✗) — لا يُمنح لمحصّل إطلاقًا
-- ============================================================

create or replace function watheq_perm(office uuid, perm text)
returns boolean language plpgsql stable security definer
set search_path = public as $$
declare m record; v jsonb; def boolean;
begin
  if office = auth.uid() then return true; end if;
  select role, perms into m from team_members
   where owner_id = office and member_id = auth.uid();
  if not found then return false; end if;

  -- التراجع والحذف: للمدير فقط، ولا يفتحه استثناء صريح
  if perm = 'undo_actions' then return m.role = 'manager'; end if;

  v := m.perms -> perm;
  if v is not null and jsonb_typeof(v) = 'boolean' then
    return v::text = 'true';
  end if;

  def := case perm
    when 'record_payments'   then m.role in ('manager','collector')
    when 'issue_invoices'    then m.role in ('manager','collector')
    when 'send_reminders'    then m.role in ('manager','collector')
    when 'add_notes'         then m.role in ('manager','collector')
    when 'view_activity'     then true
    when 'edit_tenants'      then m.role = 'manager'
    when 'renew_contracts'   then m.role = 'manager'
    when 'move_out'          then m.role = 'manager'
    when 'manage_expenses'   then m.role = 'manager'
    when 'manage_listings'   then m.role = 'manager'
    when 'manage_compliance' then m.role = 'manager'
    when 'view_financials'   then m.role = 'manager'
    when 'owner_links'       then m.role = 'manager'
    when 'export_data'       then m.role = 'manager'
    else false end;
  return coalesce(def, false);
end $$;

-- ---------- الحذف: صلاحية التراجع وحدها ----------
drop policy if exists payments_delete on payments;
create policy payments_delete on payments for delete using (watheq_perm(user_id, 'undo_actions'));

drop policy if exists tenants_write on tenants;
create policy tenants_cu on tenants for insert with check (
  exists (select 1 from properties p where p.id = tenants.property_id and watheq_perm(p.user_id, 'edit_tenants')));
create policy tenants_upd on tenants for update using (
  exists (select 1 from properties p where p.id = tenants.property_id and watheq_perm(p.user_id, 'edit_tenants')))
  with check (
  exists (select 1 from properties p where p.id = tenants.property_id and watheq_perm(p.user_id, 'edit_tenants')));
create policy tenants_del on tenants for delete using (
  exists (select 1 from properties p where p.id = tenants.property_id and watheq_perm(p.user_id, 'undo_actions')));

-- المصروفات: تسجيلها صلاحية، وقراءتها ضمن أرقام المالك، وحذفها تراجع
drop policy if exists expenses_write on expenses;
create policy expenses_cu  on expenses for insert with check (watheq_perm(user_id, 'manage_expenses'));
create policy expenses_upd on expenses for update using (watheq_perm(user_id, 'manage_expenses'))
  with check (watheq_perm(user_id, 'manage_expenses'));
create policy expenses_del on expenses for delete using (watheq_perm(user_id, 'undo_actions'));

-- الملاحظات: الإضافة صلاحية مستقلة، الحذف تراجع
drop policy if exists propnotes_write on property_notes;
create policy propnotes_cu on property_notes for insert with check (
  exists (select 1 from properties p where p.id = property_notes.property_id and watheq_perm(p.user_id, 'add_notes')));
create policy propnotes_del on property_notes for delete using (
  exists (select 1 from properties p where p.id = property_notes.property_id and watheq_perm(p.user_id, 'undo_actions')));

-- الالتزامات وروابط الملّاك
drop policy if exists compliance_write on compliance_items;
create policy compliance_write on compliance_items for all
  using (watheq_perm(user_id, 'manage_compliance')) with check (watheq_perm(user_id, 'manage_compliance'));
drop policy if exists owner_links_write on owner_links;
create policy owner_links_write on owner_links for all
  using (watheq_perm(user_id, 'owner_links')) with check (watheq_perm(user_id, 'owner_links'));

-- ---------- التراجع عن الدفعة: صلاحية التراجع صراحةً ----------
create or replace function watheq_undo_payment(p_tenant uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; rent numeric; newpaid int; pid uuid;
begin
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  select user_id into office from properties where id = t.property_id for update;

  if auth.uid() is not null then
    if not watheq_perm(office, 'undo_actions') then
      raise exception 'التراجع عن الدفعات لصاحب المكتب أو المدير فقط';
    end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  if coalesce(t.paid_periods, 0) <= 0 then raise exception 'لا دفعات مسجّلة للتراجع عنها'; end if;
  rent    := coalesce(t.rent_amount, 0);
  newpaid := t.paid_periods - 1;
  update tenants set paid_periods = newpaid where id = p_tenant;
  update properties set collected = coalesce(collected, 0) - rent where id = t.property_id;
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by)
  values (office, p_tenant, t.property_id, current_date, -rent, 'other', -1, 'تراجع عن دفعة', actor)
  returning id into pid;
  return jsonb_build_object('paid_periods', newpaid, 'reversed', rent, 'payment_id', pid);
end $$;

-- ---------- الواجهة تعرف صلاحياتها الفعّالة ----------
-- تغيّرت أعمدة الإرجاع (أُضيف perms)، وcreate or replace لا يغيّر نوع الإرجاع
drop function if exists watheq_my_office();
create or replace function watheq_my_office()
returns table (owner_id uuid, role text, account_type text, org_name text,
               plan text, trial_ends_at timestamptz, subscribed_until timestamptz, perms jsonb)
language sql stable security definer set search_path = public as $$
  select tm.owner_id, tm.role, p.account_type, p.org_name, p.plan, p.trial_ends_at, p.subscribed_until,
         (select jsonb_object_agg(k, watheq_perm(tm.owner_id, k)) from unnest(array[
           'record_payments','issue_invoices','send_reminders','add_notes','edit_tenants',
           'renew_contracts','move_out','manage_expenses','manage_listings','manage_compliance',
           'view_financials','owner_links','export_data','view_activity','undo_actions']) as k)
  from team_members tm join profiles p on p.id = tm.owner_id
  where tm.member_id = auth.uid()
  limit 1;
$$;
revoke all on function watheq_my_office() from public, anon;
grant execute on function watheq_my_office() to authenticated;
