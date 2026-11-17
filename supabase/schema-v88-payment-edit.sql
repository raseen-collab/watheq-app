-- ═══════════════════════════════════════════════════════════════════
-- schema-v88 — تعديل الدفعة المسجّلة من المدير + ملاحظة السند (17 نوفمبر 2026)
--
-- طلب مكتب «الأولى»:
--   ١) دفعة سُجّلت «تحويل بنكي» وهي «منصة إيجار» — لا يمكن تغيير الطريقة.
--   ٢) المدير يريد تعديل المبلغ وكل شيء، حتى لو أدخلها المحصّل.
--   ٣) الملاحظة تظهر في سند القبض.
--
-- قبلها: مشغّل watheq_receipt_immutable (v80) يمنع المتصفح من تغيير المبلغ والطريقة
-- بعد صدور السند، والتصحيح = عكس + تسجيل جديد برقم سند جديد.
--
-- الآن: دالة واحدة watheq_edit_payment لصلاحية «التراجع والحذف» (المالك والمدير):
--   • تغيّر المبلغ والطريقة والتاريخ والمرجع والملاحظة على الصف نفسه — رقم السند يبقى.
--   • إن تغيّر المبلغ: تعيد حساب عدّاد الأقساط والجزئي للمستأجر (بنفس معادلة
--     watheq_reverse_payment: المدفوع الكلي ± الفرق ثم watheq_split_credit)، و«المحصّل»
--     في العقار، و«اكتملت» في الصف — كلها في معاملة واحدة مع قفل الصفوف.
--   • تسجيل الدفعة يقرّب المبلغ لهللتين (كان يُحفظ خامًا فيتراكم فرق هللة بين المحصّل والمتبقي).
--   • كل تعديل يُسجَّل في payment_edits (قبل/بعد، من، متى) ويظهر في سجل المدفوعات.
--   • لا تعدّل: دفعة معكوسة أو صف عكس، دفعات الجمعيات، مبلغ دفعة مستأجر سابق
--     أو من مدة قبل التجديد (العدّاد الحالي لا يخصّها) — الطريقة والتاريخ والملاحظة فيها تُعدَّل.
--
-- آمن للتكرار. شغّله كاملًا في Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════
begin;

-- ── ١) سجل التعديلات ────────────────────────────────────────────────
create table if not exists public.payment_edits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,                         -- المكتب
  payment_id  uuid not null references public.payments(id) on delete cascade,
  actor       uuid,
  edited_at   timestamptz not null default clock_timestamp(),
  before      jsonb not null,
  after       jsonb not null
);
create index if not exists payment_edits_payment_idx on public.payment_edits (payment_id, edited_at desc);
alter table public.payment_edits alter column edited_at set default clock_timestamp();
create index if not exists payment_edits_office_idx on public.payment_edits (user_id, edited_at desc);
alter table public.payment_edits enable row level security;
drop policy if exists payment_edits_read on public.payment_edits;
create policy payment_edits_read on public.payment_edits for select using (watheq_can_read(user_id));
revoke all on public.payment_edits from public, anon, authenticated;
grant select on public.payment_edits to authenticated;   -- الكتابة من الدالة وحدها

-- ── ٢) الدالة ───────────────────────────────────────────────────────
create or replace function public.watheq_edit_payment(
  p_payment uuid, p_amount numeric, p_method text, p_paid_on date,
  p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; t tenants%rowtype; office uuid; actor uuid;
        v_amount numeric; v_method text; v_ref text; v_note text; delta numeric;
        credit numeric; s record; v_cov int; v_carried numeric;
begin
  perform set_config('watheq.in_fn', '1', true);
  select * into pay from payments where id = p_payment for update;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  /* الصلاحية قبل أي فحص آخر: مستخدم من مكتب آخر لا يعرف حتى إن كانت الدفعة معكوسة */
  office := pay.user_id;
  if auth.uid() is null or not watheq_perm(office, 'undo_actions') then raise exception 'not authorized'; end if;
  actor := auth.uid();
  if pay.amount <= 0 or pay.reverses is not null then raise exception 'هذا صفّ عكس ولا يُعدَّل'; end if;
  if exists (select 1 from payments where reverses = p_payment) then
    raise exception 'هذه الدفعة معكوسة — لا تُعدَّل';
  end if;
  if pay.association_id is not null or pay.owner_id is not null then
    raise exception 'دفعات الجمعيات لا تُعدَّل من هنا — اعكسها وسجّلها من جديد';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if v_amount > 10000000 then raise exception 'المبلغ أكبر من المعقول — راجع الرقم'; end if;
  v_method := coalesce(nullif(btrim(p_method), ''), pay.method, 'transfer');
  if v_method not in ('transfer','ejar','cash','pos','card','cheque','other') then raise exception 'طريقة الدفع غير معروفة'; end if;
  if p_paid_on is null then raise exception 'تاريخ السداد مطلوب'; end if;
  if p_paid_on > (current_date + 1) then raise exception 'تاريخ السداد في المستقبل'; end if;
  v_ref  := left(nullif(btrim(coalesce(p_reference, '')), ''), 80);
  v_note := left(nullif(btrim(coalesce(p_note, '')), ''), 500);

  delta := v_amount - pay.amount;
  v_cov := pay.periods_covered;

  if abs(delta) >= 0.005 then
    select user_id into office from properties where id = pay.property_id for update;
    if pay.past_tenancy_id is not null then
      raise exception 'دفعة مستأجر سابق — مبلغها لا يُعدَّل؛ اعكسها وسجّل الصحيح';
    elsif pay.applies_to = 'carried' then
      select * into t from tenants where id = pay.tenant_id for update;
      if not found then raise exception 'الوحدة غير موجودة'; end if;
      v_carried := round(coalesce(t.carried_debt, 0) - delta, 2);
      if v_carried < 0 then raise exception 'المبلغ الجديد أكبر من الدين المرحّل المتبقي'; end if;
      update tenants set carried_debt = v_carried where id = pay.tenant_id;
    else
      select * into t from tenants where id = pay.tenant_id for update;
      if not found then raise exception 'الوحدة غير موجودة'; end if;
      if t.term_started_at is not null and pay.created_at < t.term_started_at then
        raise exception 'هذه دفعة من مدة سابقة (قبل التجديد) — مبلغها لا يُعدَّل من المدة الحالية';
      end if;
      if coalesce(t.rent_amount, 0) <= 0 then raise exception 'قيمة الدفعة غير محدّدة لهذا العقد'; end if;
      credit := coalesce(t.paid_periods, 0) * t.rent_amount + coalesce(t.partial_amount, 0) + delta;
      if credit < -0.005 then raise exception 'المبلغ الجديد يجعل المدفوع أقل من صفر — راجع الدفعات'; end if;
      s := watheq_split_credit(credit, t.rent_amount);
      update tenants set paid_periods = s.paid, partial_amount = s.partial where id = pay.tenant_id;
      v_cov := greatest(0, coalesce(pay.periods_covered, 0) + (s.paid - coalesce(t.paid_periods, 0)));
    end if;
    update properties set collected = coalesce(collected, 0) + delta where id = pay.property_id;
  end if;

  if (v_amount, v_method, p_paid_on, v_ref, v_note) is not distinct from
     (pay.amount, pay.method, pay.paid_on, pay.reference, pay.note) then
    return jsonb_build_object('changed', false, 'payment_id', pay.id);
  end if;

  update payments set amount = v_amount, method = v_method, paid_on = p_paid_on,
         reference = v_ref, note = v_note, periods_covered = v_cov
   where id = pay.id;

  insert into payment_edits (user_id, payment_id, actor, before, after)
  values (pay.user_id, pay.id, actor,
          jsonb_build_object('amount', pay.amount, 'method', pay.method, 'paid_on', pay.paid_on, 'reference', pay.reference, 'note', pay.note),
          jsonb_build_object('amount', v_amount, 'method', v_method, 'paid_on', p_paid_on, 'reference', v_ref, 'note', v_note));

  return jsonb_build_object('changed', true, 'payment_id', pay.id, 'amount', v_amount, 'method', v_method,
    'paid_on', p_paid_on, 'reference', v_ref, 'note', v_note, 'periods_covered', v_cov, 'delta', delta);
end $$;
revoke all on function public.watheq_edit_payment(uuid, numeric, text, date, text, text) from public, anon;
grant execute on function public.watheq_edit_payment(uuid, numeric, text, date, text, text) to authenticated;

-- ── ٤) تقريب المبلغ لهللتين عند التسجيل (اكتُشف في اختبار ٥٠٠ سيناريو، 17 نوفمبر) ──
-- زر الدفعة كان يرسل المبلغ بلا تقريب (نصف 4166.67 = 2083.335). الرصيد يُحفظ مقرّبًا لهللتين
-- والدفعة بمبلغها الخام، فيتراكم فرق هللة أو هللتين بين «المحصّل» و«المتبقي». الدالتان كما في v45
-- حرفيًّا مع سطر التقريب وحده.
create or replace function public.watheq_record_payment(
  p_tenant uuid, p_amount numeric, p_method text default 'transfer',
  p_note text default null, p_paid_on date default null, p_actor uuid default null,
  p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; rent numeric; pool numeric;
        completed int; newpaid int; newpartial numeric; pid uuid;
begin
  perform set_config('watheq.in_fn', '1', true);
  p_amount := round(p_amount, 2);   -- (v88) هللتان كحدّ: المبلغ المحفوظ = المبلغ المحسوب في الرصيد
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
  if p_paid_on is not null and p_paid_on > (current_date + 1) then raise exception 'تاريخ السداد في المستقبل'; end if;
  rent := coalesce(t.rent_amount, 0);
  if rent <= 0 then raise exception 'قيمة الدفعة غير محدّدة لهذا العقد'; end if;
  pool       := greatest(0, coalesce(t.partial_amount, 0)) + p_amount;
  completed  := floor(pool / rent);
  newpartial := round(pool - completed * rent, 2);
  newpaid    := greatest(0, coalesce(t.paid_periods, 0)) + completed;
  update tenants set paid_periods = newpaid, partial_amount = newpartial where id = p_tenant;
  update properties set collected = coalesce(collected, 0) + p_amount where id = t.property_id;
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note,
                        created_by, reference, payer_name, unit_label)
  values (office, p_tenant, t.property_id, coalesce(p_paid_on, current_date), p_amount,
          coalesce(nullif(p_method, ''), 'transfer'), completed, p_note, actor, nullif(btrim(p_reference), ''),
          t.name, t.unit)
  returning id into pid;
  return jsonb_build_object('paid_periods', newpaid, 'partial_amount', newpartial, 'completed', completed, 'payment_id', pid);
end $$;

create or replace function public.watheq_record_carried_payment(
  p_tenant uuid, p_amount numeric, p_paid_on date default null,
  p_method text default 'transfer', p_reference text default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; pid uuid;
begin
  perform set_config('watheq.in_fn', '1', true);
  p_amount := round(p_amount, 2);   -- (v88) هللتان كحدّ: المبلغ المحفوظ = المبلغ المحسوب في الرصيد
  if p_amount is null or p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  select user_id into office from properties where id = t.property_id for update;
  if auth.uid() is not null then
    if not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;
  if p_paid_on is not null and p_paid_on > current_date + 1 then raise exception 'تاريخ السداد في المستقبل'; end if;
  if p_amount > coalesce(t.carried_debt, 0) + 0.005 then
    raise exception 'المبلغ أكبر من الدين المرحَّل (%)', round(coalesce(t.carried_debt, 0), 2);
  end if;
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note,
                        created_by, reference, payer_name, unit_label, applies_to)
  values (office, p_tenant, t.property_id, coalesce(p_paid_on, current_date), p_amount,
          coalesce(nullif(p_method, ''), 'transfer'), 0, 'سداد دين مرحَّل', actor,
          nullif(btrim(p_reference), ''), t.name, t.unit, 'carried')
  returning id into pid;
  update tenants set carried_debt = round(coalesce(carried_debt, 0) - p_amount, 2) where id = p_tenant;
  update properties set collected = coalesce(collected, 0) + p_amount where id = t.property_id;
  return jsonb_build_object('payment_id', pid, 'remaining', round(coalesce(t.carried_debt, 0) - p_amount, 2));
end $$;

-- ── ٣) سند المستأجر من رابطه: يحمل الملاحظة أيضًا ────────────────────
create or replace function public.watheq_tenant_receipt(p_token text, p_payment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l tenant_portal_links%rowtype; t tenants%rowtype; pay payments%rowtype; rev payments%rowtype;
        pj jsonb; oj jsonb;
begin
  l := watheq_tenant_link_resolve(p_token);
  if l.id is null then return null; end if;
  select * into pay from payments
   where id = p_payment and tenant_id = l.tenant_id and user_id = l.user_id
     and amount > 0 and reverses is null;
  if not found then return null; end if;
  select * into t from tenants where id = l.tenant_id;
  select * into rev from payments where reverses = pay.id limit 1;
  select to_jsonb(p) into pj from properties p where p.id = l.property_id;
  select to_jsonb(r) into oj from profiles r where r.id = l.user_id;
  return jsonb_build_object(
    'payment', jsonb_build_object('id', pay.id, 'paid_on', pay.paid_on, 'amount', pay.amount, 'method', pay.method,
      'reference', pay.reference, 'periods_covered', pay.periods_covered, 'applies_to', pay.applies_to,
      'receipt_no', pay.receipt_no, 'created_at', pay.created_at,
      'payer_name', pay.payer_name, 'unit_label', pay.unit_label, 'note', pay.note,
      'reversed_on', case when rev.id is not null then rev.created_at end),
    'tenant', jsonb_build_object('name', t.name, 'unit', t.unit, 'unit_type', t.unit_type, 'contract_no', t.contract_no,
      'payment_frequency', t.payment_frequency, 'vat_mode', t.vat_mode),
    'property', jsonb_build_object('name', pj->'name', 'city', pj->'city', 'property_type', pj->'property_type',
      'vat_enabled', pj->'vat_enabled', 'vat_rate', pj->'vat_rate', 'vat_inclusive', pj->'vat_inclusive'),
    'office', jsonb_build_object('org_name', oj->'org_name', 'billing_name', oj->'billing_name',
      'billing_phone', oj->'billing_phone', 'cr_number', oj->'cr_number', 'vat_number', oj->'vat_number'));
end $$;
revoke all on function public.watheq_tenant_receipt(text, uuid) from public, anon, authenticated;
grant execute on function public.watheq_tenant_receipt(text, uuid) to service_role;

commit;

-- تحقق (يجب: 1 | 1)
select (select count(*) from pg_proc where proname = 'watheq_edit_payment') as edit_fn,
       (select count(*) from pg_tables where schemaname = 'public' and tablename = 'payment_edits') as edits_table;
