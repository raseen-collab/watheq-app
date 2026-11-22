-- ============================================================
-- وثيق — schema-v97: «الإخلاء» و«تجديد العقود» تعملان بلا «إضافة وتعديل الوحدات»
-- (22 نوفمبر 2026 — بلاغ مكتب التميز)
--
-- كانت سياسة تعديل المستأجر (tenants_upd) تطلب edit_tenants وحدها، والإخلاء
-- والتجديد يحفظان على صف المستأجر نفسه. فموظف مُنح «الإخلاء» و«التجديد» دون
-- «إضافة وتعديل الوحدات» يرى الزرّين ثم يُرفض الحفظ («يحتاج صلاحية أعلى»).
--
-- الآن: التعديل مسموح لمن له edit_tenants أو move_out أو renew_contracts —
-- لكن من لا يملك edit_tenants يُقصَر على أعمدة إجرائه فقط (الحارس أدناه):
--   الإخلاء:  status, notice_date, move_out_date, deposit_*, meter_*_out,
--             turnover_checklist, covered_by
--   التجديد:  contract_start/end, payment_frequency, contract_periods, rent_amount,
--             paid_periods, partial_amount, carried_debt, first_due,
--             billing_anchor_day, term_started_at
-- فلا يعدّل الاسم ولا الجوال ولا الهوية ولا الوحدة ولا ينقلها لعقار آخر.
-- الحارس يُسمّى a0_ ليعمل قبل المشغّلات التي تضبط أعمدة بنفسها (watheq_touch_debt…).
-- آمن للتكرار. لا يحذف بيانات.
-- ============================================================

create or replace function public.watheq_tenant_action_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  office uuid;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  k text;
  allowed text[] := array[]::text[];
  move_cols text[] := array['status', 'notice_date', 'move_out_date', 'deposit_amount', 'deposit_deductions',
                            'deposit_notes', 'meter_elec_out', 'meter_water_out', 'turnover_checklist', 'covered_by'];
  renew_cols text[] := array['contract_start', 'contract_end', 'payment_frequency', 'contract_periods', 'rent_amount',
                             'paid_periods', 'partial_amount', 'carried_debt', 'first_due', 'billing_anchor_day',
                             'term_started_at'];
begin
  -- دوال الخادم والمفاتيح الخارجية تمرّ؛ الحارس للطلبات المباشرة من الحساب
  if current_user not in ('authenticated', 'anon') or auth.uid() is null then return new; end if;
  select p.user_id into office from public.properties p where p.id = old.property_id;
  if office is null or public.watheq_perm(office, 'edit_tenants') then return new; end if;

  if public.watheq_perm(office, 'move_out') then allowed := allowed || move_cols; end if;
  if public.watheq_perm(office, 'renew_contracts') then allowed := allowed || renew_cols; end if;

  for k in select jsonb_object_keys(n) loop
    if (n -> k) is distinct from (o -> k) and not (k = any(allowed)) then
      raise exception using errcode = '42501',
        message = 'هذا التعديل يحتاج صلاحية «إضافة وتعديل الوحدات» — اطلبها من صاحب المكتب.';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.watheq_tenant_action_guard() from public, anon, authenticated;

drop trigger if exists a0_tenant_action_guard on public.tenants;
create trigger a0_tenant_action_guard before update on public.tenants
  for each row execute function public.watheq_tenant_action_guard();

drop policy if exists tenants_upd on public.tenants;
create policy tenants_upd on public.tenants for update to authenticated
  using (exists (select 1 from public.properties p where p.id = tenants.property_id
                 and (public.watheq_perm(p.user_id, 'edit_tenants') or public.watheq_perm(p.user_id, 'move_out')
                      or public.watheq_perm(p.user_id, 'renew_contracts'))))
  with check (exists (select 1 from public.properties p where p.id = tenants.property_id
                 and (public.watheq_perm(p.user_id, 'edit_tenants') or public.watheq_perm(p.user_id, 'move_out')
                      or public.watheq_perm(p.user_id, 'renew_contracts'))));
