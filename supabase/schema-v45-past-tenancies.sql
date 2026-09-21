-- ============================================================
-- وثيق — schema-v45: إعادة التأجير بلا خلط بين المستأجرَين
--
-- المشكلة: إعادة التأجير كانت تكتب المستأجر الجديد فوق صفّ السابق.
--   • اسم السابق وجواله وهويته تُمحى — ولا يبقى منه إلا نصّ ملاحظة.
--   • دينه يُرحَّل على صفّ الجديد: شاشة الديون تعرضه باسم الجديد وجواله،
--     فيتصل المكتب بالمستأجر الجديد ليطالبه بدين غيره.
--   • دفعات السابق تبقى على الصفّ، والتقارير تسمّيها باسم الجديد.
--   • وحين يسدّد السابق دينه، «سُوّي» يُصفّر الرقم بلا نقد في الدفتر —
--     فالمال المقبوض لا يظهر في تقرير المالك.
--
-- الحل: كل إيجار منتهٍ يُحفظ في أرشيف مستقل بصاحبه ودينه ودفعاته، وصفّ
-- الوحدة يُكتب للجديد نظيفًا. وسداد الدين القديم نقدٌ في الدفتر.
--
-- جدول الوحدات يبقى كما هو (صفّ للإيجار الحالي) فلا يتغيّر أي مكان يقرؤه.
-- يتطلب v43 و v44. آمن للتكرار.
-- ============================================================

begin;

-- ── ١) الأرشيف ─────────────────────────────────────────────
create table if not exists public.past_tenancies (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,                                -- المكتب
  property_id  uuid not null references properties(id) on delete cascade,
  unit_row_id  uuid references tenants(id) on delete set null,  -- الوحدة التي سكنها
  unit         text,
  name         text not null,
  phone        text,
  national_id  text,
  snapshot     jsonb not null default '{}'::jsonb,           -- صفّه كاملًا لحظة الأرشفة
  debt_amount  numeric(12,2) not null default 0 check (debt_amount >= 0),
  debt_paid    numeric(12,2) not null default 0,
  debt_status  text not null default 'open'
               check (debt_status in ('open','promised','settled','written_off','legal')),
  debt_note    text,
  legacy       boolean not null default false,               -- رُحّل من دين قديم بلا جوال
  archived_at  timestamptz not null default now(),
  archived_by  uuid
);
create index if not exists past_ten_office_idx on public.past_tenancies (user_id, archived_at desc);
create index if not exists past_ten_prop_idx on public.past_tenancies (property_id);

alter table public.past_tenancies enable row level security;
drop policy if exists past_ten_read on public.past_tenancies;
create policy past_ten_read on public.past_tenancies for select to authenticated using (watheq_can_read(user_id));
grant select on public.past_tenancies to authenticated;   -- الكتابة عبر الدوال وحدها

-- ── ٢) الدفعة تحمل اسم دافعها ─────────────────────────────
/* التقارير كانت تسمّي الدفعة باسم من يسكن الوحدة الآن — فدفعات السابق
   تظهر باسم اللاحق. الاسم يُحفظ لحظة التسجيل ويبقى. */
alter table payments add column if not exists past_tenancy_id uuid references past_tenancies(id) on delete set null;
alter table payments add column if not exists payer_name text;
alter table payments add column if not exists unit_label text;
create index if not exists payments_past_idx on payments (past_tenancy_id) where past_tenancy_id is not null;

/* ماذا تسدّد الدفعة: قسط إيجار، أم دينًا مرحَّلًا على الساكن، أم دين مستأجر
   سابق. العكس والتراجع يحتاجانه: سداد الدين لا يُعكس كأنه قسط. */
alter table payments add column if not exists applies_to text not null default 'rent';
alter table payments drop constraint if exists payments_applies_chk;
alter table payments add constraint payments_applies_chk check (applies_to in ('rent','carried','past_debt'));


-- ── ٣) أداة: كتابة الحقول الموجودة فعلًا فقط ─────────────
/* قاعدة وثيق فيها أعمدة لا يُنشئها أي ملف SQL في المشروع — فلا نفترض
   عمودًا: نكتب من المفاتيح ما يوجد في الجدول ويقع في القائمة المسموحة. */
create or replace function watheq_apply_tenant_fields(p_tenant uuid, p_fields jsonb, p_allowed text[])
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  for k in select key from jsonb_each(p_fields) loop
    if k = any(p_allowed) and exists (select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'tenants' and column_name = k) then
      execute format('update tenants set %I = (jsonb_populate_record(null::tenants, $1)).%I where id = $2', k, k)
        using p_fields, p_tenant;
    end if;
  end loop;
end $$;
revoke all on function watheq_apply_tenant_fields(uuid, jsonb, text[]) from public, anon, authenticated;


-- ── ٤) إعادة التأجير — عملية واحدة لا تتجزأ ─────────────
create or replace function watheq_relet_unit(p_tenant uuid, p_debt numeric, p_new jsonb, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; arch uuid; moved int;
begin
  perform set_config('watheq.in_fn', '1', true);
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  if coalesce(t.status, 'active') <> 'vacated' then
    raise exception 'سجّل إخلاء المستأجر الحالي أولًا — إعادة التأجير تكون لوحدة شاغرة';
  end if;
  select user_id into office from properties where id = t.property_id for update;

  if auth.uid() is not null then
    if not watheq_perm(office, 'edit_units') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;
  if coalesce(btrim(p_new->>'name'), '') = '' then raise exception 'اسم المستأجر الجديد مطلوب'; end if;

  /* ١) السابق إلى الأرشيف بصاحبه ودينه */
  insert into past_tenancies (user_id, property_id, unit_row_id, unit, name, phone, national_id,
                              snapshot, debt_amount, debt_status, archived_by)
  values (office, t.property_id, t.id, t.unit, coalesce(nullif(btrim(t.name), ''), 'مستأجر سابق'),
          t.phone, t.national_id, to_jsonb(t), greatest(0, round(coalesce(p_debt, 0), 2)),
          case when coalesce(p_debt, 0) > 0 then 'open' else 'settled' end, actor)
  returning id into arch;

  /* ٢) دفعاته تنتقل معه — باسمه */
  update payments set past_tenancy_id = arch, tenant_id = null,
         payer_name = coalesce(payer_name, t.name), unit_label = coalesce(unit_label, t.unit)
   where tenant_id = p_tenant;
  get diagnostics moved = row_count;

  /* ٣) الوحدة للجديد نظيفة: حقوله، وتصفير كل ما يخصّ السابق */
  perform watheq_apply_tenant_fields(p_tenant, p_new, array[
    'name','phone','national_id','rent_amount','contract_start','payment_frequency','contract_periods',
    'contract_end','billing_anchor_day','contract_no','calendar','vat_mode','first_due','unit_type',
    'rooms','baths','acs','elec_account','water_account','meter_elec_in','meter_water_in','deposit_amount','unit']);
  perform watheq_apply_tenant_fields(p_tenant, jsonb_build_object(
    'status','active','paid_periods',0,'partial_amount',0,'carried_debt',0,'carried_debt_note',null,
    'move_out_date',null,'notice_date',null,'deposit_deductions',0,'meter_elec_out',null,'meter_water_out',null,
    'turnover_checklist','[]'::jsonb,'litigation',false,'debt_status',null,'debt_note',null,'debt_since',null),
    array['status','paid_periods','partial_amount','carried_debt','carried_debt_note','move_out_date','notice_date',
          'deposit_deductions','meter_elec_out','meter_water_out','turnover_checklist','litigation',
          'debt_status','debt_note','debt_since']);

  insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
  values (office, p_tenant, t.property_id, 'counter', 0, coalesce(p_debt, 0),
          'إعادة تأجير: أُرشف ' || coalesce(t.name, 'المستأجر السابق')
          || case when coalesce(p_debt, 0) > 0 then ' بدين ' || round(p_debt, 2) else ' بلا دين' end
          || ' · انتقلت دفعاته (' || moved || ')', actor);

  return jsonb_build_object('past_tenancy_id', arch, 'payments_moved', moved, 'debt', greatest(0, coalesce(p_debt, 0)));
end $$;
revoke all on function watheq_relet_unit(uuid, numeric, jsonb, uuid) from public, anon;
grant execute on function watheq_relet_unit(uuid, numeric, jsonb, uuid) to authenticated;


-- ── ٥) سداد دين مستأجر سابق — نقدٌ في الدفتر ─────────────
create or replace function watheq_record_past_payment(
  p_past uuid, p_amount numeric, p_paid_on date default null,
  p_method text default 'transfer', p_reference text default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pt past_tenancies%rowtype; actor uuid; pid uuid; newpaid numeric;
begin
  perform set_config('watheq.in_fn', '1', true);
  if p_amount is null or p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  select * into pt from past_tenancies where id = p_past for update;
  if not found then raise exception 'السجل غير موجود'; end if;
  if auth.uid() is not null then
    if not watheq_perm(pt.user_id, 'record_payments') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> pt.user_id then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;
  if p_paid_on is not null and p_paid_on > current_date + 1 then raise exception 'تاريخ السداد في المستقبل'; end if;
  if p_amount > pt.debt_amount - pt.debt_paid + 0.005 then
    raise exception 'المبلغ أكبر من المتبقي (%) — سجّل المتبقي فقط', round(pt.debt_amount - pt.debt_paid, 2);
  end if;

  insert into payments (user_id, tenant_id, past_tenancy_id, property_id, paid_on, amount, method,
                        periods_covered, note, created_by, reference, payer_name, unit_label, applies_to)
  values (pt.user_id, null, p_past, pt.property_id, coalesce(p_paid_on, current_date), p_amount,
          coalesce(nullif(p_method, ''), 'transfer'), 0, 'سداد دين مستأجر سابق', actor,
          nullif(btrim(p_reference), ''), pt.name, pt.unit, 'past_debt')
  returning id into pid;
  update properties set collected = coalesce(collected, 0) + p_amount where id = pt.property_id;
  newpaid := pt.debt_paid + p_amount;
  update past_tenancies set debt_paid = newpaid,
         debt_status = case when newpaid >= debt_amount - 0.005 then 'settled' else debt_status end
   where id = p_past;
  return jsonb_build_object('payment_id', pid, 'debt_paid', newpaid,
                            'remaining', greatest(0, round(pt.debt_amount - newpaid, 2)));
end $$;
revoke all on function watheq_record_past_payment(uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function watheq_record_past_payment(uuid, numeric, date, text, text, uuid) to authenticated;


-- ── ٥ب) سداد دين مرحَّل على الساكن الحالي — نقدٌ لا تصفير ─────
/* الدين المرحَّل على الساكن نفسه (أُدخل من ملف مثلًا) كان يُسوّى بـ«تصفير»
   بلا نقد — فالمال المقبوض لا يظهر في تقرير المالك. الآن سداده دفعة في
   الدفتر لا تمسّ أقساط الإيجار. */
create or replace function watheq_record_carried_payment(
  p_tenant uuid, p_amount numeric, p_paid_on date default null,
  p_method text default 'transfer', p_reference text default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; pid uuid;
begin
  perform set_config('watheq.in_fn', '1', true);
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
revoke all on function watheq_record_carried_payment(uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function watheq_record_carried_payment(uuid, numeric, date, text, text, uuid) to authenticated;


-- ── ٥ج) شطب دين مرحَّل على الساكن — بقرار مسجَّل لا بتصفير صامت ──
create or replace function watheq_write_off_carried(p_tenant uuid, p_note text, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid;
begin
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  select user_id into office from properties where id = t.property_id;
  if auth.uid() is not null then
    if not watheq_perm(office, 'edit_units') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'اذكر سبب الشطب — يُحفظ في السجل'; end if;
  if coalesce(t.carried_debt, 0) <= 0 then raise exception 'لا دين مرحَّل على هذه الوحدة'; end if;
  insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
  values (office, p_tenant, t.property_id, 'repair', 0, t.carried_debt,
          'شطب دين مرحَّل على ' || coalesce(t.name, 'الساكن') || ' (' || t.carried_debt || ') — ' || btrim(p_note), actor);
  update tenants set carried_debt = 0 where id = p_tenant;
  return jsonb_build_object('written_off', t.carried_debt);
end $$;
revoke all on function watheq_write_off_carried(uuid, text, uuid) from public, anon;
grant execute on function watheq_write_off_carried(uuid, text, uuid) to authenticated;


-- ── ٦) حالة الدين وملاحظته ─────────────────────────────────
create or replace function watheq_set_past_debt(p_past uuid, p_status text, p_note text default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pt past_tenancies%rowtype;
begin
  select * into pt from past_tenancies where id = p_past for update;
  if not found then raise exception 'السجل غير موجود'; end if;
  if auth.uid() is not null then
    if not watheq_perm(pt.user_id, 'edit_units') then raise exception 'not authorized'; end if;
  elsif p_actor is null or p_actor <> pt.user_id then raise exception 'not authorized'; end if;
  if p_status not in ('open','promised','settled','written_off','legal') then raise exception 'حالة غير معروفة'; end if;
  /* «سُوّي» لا تُصفّر رقمًا بلا نقد: إن بقي مبلغ فالتسوية تكون بتسجيل
     سداده أو بشطبه صراحةً — حتى لا يختفي مال من الدفاتر بصمت */
  if p_status = 'settled' and pt.debt_paid < pt.debt_amount - 0.005 then
    raise exception 'بقي % — سجّل سداده، أو اختر «شُطب» إن تنازل عنه المالك', round(pt.debt_amount - pt.debt_paid, 2);
  end if;
  update past_tenancies set debt_status = p_status, debt_note = coalesce(p_note, debt_note) where id = p_past;
  return jsonb_build_object('status', p_status);
end $$;
revoke all on function watheq_set_past_debt(uuid, text, text, uuid) from public, anon;
grant execute on function watheq_set_past_debt(uuid, text, text, uuid) to authenticated;


-- ── ٧) التسجيل يحفظ اسم الدافع · والعكس يعرف دفعات الأرشيف ──
create or replace function watheq_record_payment(
  p_tenant uuid, p_amount numeric, p_method text default 'transfer',
  p_note text default null, p_paid_on date default null, p_actor uuid default null,
  p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; rent numeric; pool numeric;
        completed int; newpaid int; newpartial numeric; pid uuid;
begin
  perform set_config('watheq.in_fn', '1', true);
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

create or replace function watheq_reverse_payment(p_payment uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; t tenants%rowtype; pt past_tenancies%rowtype; office uuid; actor uuid;
        credit numeric; s record; pid uuid;
begin
  perform set_config('watheq.in_fn', '1', true);
  select * into pay from payments where id = p_payment for update;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  if pay.amount <= 0 then raise exception 'هذا الصفّ عكسٌ أصلًا ولا يُعكس'; end if;
  if exists (select 1 from payments where reverses = p_payment) then raise exception 'سبق عكس هذه الدفعة'; end if;
  select user_id into office from properties where id = pay.property_id for update;
  if auth.uid() is not null then
    if not watheq_perm(office, 'undo_actions') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  if pay.past_tenancy_id is not null then
    /* دفعة مستأجر سابق (قبل أرشفته أو سداد دينه بعدها): لا عدّاد لوحدة
       حالية يُمسّ. إن كانت سدادًا لدينه، يعود المتبقي عليه. */
    select * into pt from past_tenancies where id = pay.past_tenancy_id for update;
    if pay.applies_to = 'past_debt' then
      update past_tenancies set debt_paid = debt_paid - pay.amount,
             debt_status = case when debt_status = 'settled' then 'open' else debt_status end
       where id = pay.past_tenancy_id;
    else
      /* دفعة من أيام إقامته عُكست بعد رحيله: صار عليه مبلغها */
      update past_tenancies set debt_amount = debt_amount + pay.amount,
             debt_status = case when debt_status = 'settled' then 'open' else debt_status end
       where id = pay.past_tenancy_id;
    end if;
  elsif pay.applies_to = 'carried' then
    /* سداد دين مرحَّل: يعود الدين، ولا يُمسّ عدّاد الأقساط */
    update tenants set carried_debt = round(coalesce(carried_debt, 0) + pay.amount, 2) where id = pay.tenant_id;
  else
    select * into t from tenants where id = pay.tenant_id for update;
    if not found then raise exception 'الوحدة غير موجودة'; end if;
    if t.term_started_at is not null and pay.created_at < t.term_started_at then
      raise exception 'هذه دفعة من مدة سابقة (قبل التجديد) — لا تُعكس من المدة الحالية. عدّل الدين بدلًا منها.';
    end if;
    credit := coalesce(t.paid_periods, 0) * coalesce(t.rent_amount, 0) + coalesce(t.partial_amount, 0) - pay.amount;
    s := watheq_split_credit(credit, t.rent_amount);
    update tenants set paid_periods = s.paid, partial_amount = s.partial where id = pay.tenant_id;
  end if;

  update properties set collected = coalesce(collected, 0) - pay.amount where id = pay.property_id;
  insert into payments (user_id, tenant_id, past_tenancy_id, property_id, paid_on, amount, method, periods_covered,
                        note, created_by, reverses, payer_name, unit_label, applies_to)
  values (office, pay.tenant_id, pay.past_tenancy_id, pay.property_id, pay.paid_on, -pay.amount, 'other',
          -coalesce(pay.periods_covered, 0), 'عكس دفعة ' || pay.paid_on::text || ' — ' || p_payment::text,
          actor, p_payment, pay.payer_name, pay.unit_label, pay.applies_to)
  returning id into pid;
  /* فرع الأرشيف لا يملأ s — قراءته بلا تعيين تُسقط الدالة */
  if pay.past_tenancy_id is not null or pay.applies_to = 'carried' then
    return jsonb_build_object('reversed', pay.amount, 'paid_on', pay.paid_on, 'payment_id', pid,
                              'past', pay.past_tenancy_id is not null, 'applies_to', pay.applies_to);
  end if;
  return jsonb_build_object('paid_periods', s.paid, 'partial_amount', s.partial, 'reversed', pay.amount,
                            'paid_on', pay.paid_on, 'payment_id', pid, 'past', false);
end $$;


-- ── ٧ب) «تراجع عن آخر دفعة» يخصّ أقساط الإيجار وحدها ──────────
/* سداد دين مرحَّل ليس قسطًا: عكسه بحساب الأقساط يُضيف رصيدًا لم يُدفع
   للإيجار. يُعكس سداد الدين من سجل المدفوعات بزرّ العكس (يعرف نوعه). */
create or replace function watheq_undo_payment(p_tenant uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; last_pay payments%rowtype;
        credit numeric; s record; back numeric := 0; pid uuid;
begin
  perform set_config('watheq.in_fn', '1', true);
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  select user_id into office from properties where id = t.property_id for update;
  if auth.uid() is not null then
    if not watheq_perm(office, 'undo_actions') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;
  credit := coalesce(t.paid_periods, 0) * coalesce(t.rent_amount, 0) + coalesce(t.partial_amount, 0);
  select p.* into last_pay from payments p
   where p.tenant_id = p_tenant and p.amount > 0 and coalesce(p.applies_to, 'rent') = 'rent'
     and not exists (select 1 from payments r where r.reverses = p.id)
     and (t.term_started_at is null or p.created_at >= t.term_started_at)
   order by p.created_at desc limit 1;
  if not found and credit <= 0 then raise exception 'لا دفعات مسجّلة للتراجع عنها'; end if;
  if found then
    back := last_pay.amount;
    s := watheq_split_credit(credit - back, t.rent_amount);
    update tenants set paid_periods = s.paid, partial_amount = s.partial where id = p_tenant;
    update properties set collected = coalesce(collected, 0) - back where id = t.property_id;
    insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note,
                          created_by, reverses, payer_name, unit_label, applies_to)
    values (office, p_tenant, t.property_id, last_pay.paid_on, -back, 'other', -coalesce(last_pay.periods_covered, 0),
            'تراجع عن دفعة بتاريخ ' || last_pay.paid_on::text, actor, last_pay.id,
            last_pay.payer_name, last_pay.unit_label, 'rent')
    returning id into pid;
  else
    s := watheq_split_credit(credit - coalesce(t.rent_amount, 0), t.rent_amount);
    update tenants set paid_periods = s.paid, partial_amount = s.partial where id = p_tenant;
    insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
    values (office, p_tenant, t.property_id, 'counter', s.paid - coalesce(t.paid_periods, 0), t.rent_amount,
            'تصحيح عدّاد: دفعة سُدّدت قبل وثيق (رصيد افتتاحي) — بلا أثر نقدي', actor);
  end if;
  return jsonb_build_object('paid_periods', s.paid, 'partial_amount', s.partial, 'reversed', back,
                            'paid_on', last_pay.paid_on, 'payment_id', pid, 'opening_balance', last_pay.id is null);
end $$;


-- ── ٨) ترحيل الديون القديمة إلى أصحابها ─────────────────────
/* ديون رُحّلت على صفّ المستأجر الجديد بملاحظة «دين X قبل الإخلاء».
   ننقل الدين وصاحبه إلى الأرشيف فيخرج من صفّ الجديد. الجوال لم يُحفظ
   يومها فلا يُستعاد. ولا ننقل الدفعات: لا يمكن فصلها بيقين عن دفعات
   الساكن الحالي، ونقل دفعة إلى الشخص الخطأ أسوأ من تركها.
   كل نقل يُسجَّل في ledger_adjustments قبل التصفير. */
drop table if exists _legacy;
create temp table _legacy as
select t.id, t.property_id, pr.user_id, t.unit, t.carried_debt,
       coalesce(nullif(btrim(substring(t.carried_debt_note from 'دين (.+) قبل الإخلاء')), ''), 'مستأجر سابق') as prev_name,
       t.carried_debt_note
from tenants t join properties pr on pr.id = t.property_id
where coalesce(t.carried_debt, 0) > 0 and t.carried_debt_note like 'دين % قبل الإخلاء';

insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note)
select user_id, id, property_id, 'repair', 0, carried_debt,
       'نُقل دين ' || prev_name || ' (' || carried_debt || ') من صفّ الساكن الحالي إلى أرشيف المستأجرين السابقين'
from _legacy;

insert into past_tenancies (user_id, property_id, unit_row_id, unit, name, snapshot, debt_amount, debt_status, debt_note, legacy)
select l.user_id, l.property_id, l.id, l.unit, l.prev_name,
       jsonb_build_object('legacy_note', l.carried_debt_note),
       l.carried_debt,
       case when coalesce(t.debt_status, 'open') in ('open','promised','settled','written_off','legal')
            then coalesce(t.debt_status, 'open') else 'open' end,
       t.debt_note, true
from _legacy l join tenants t on t.id = l.id;

select set_config('watheq.in_fn', '1', true);
update tenants set carried_debt = 0, carried_debt_note = null where id in (select id from _legacy);
/* حالة المتابعة وملاحظتها وصفتا دين السابق — تنتقلان معه، لا تبقيان على الساكن */
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'tenants' and column_name = 'debt_status') then
    execute 'update tenants set debt_status = null, debt_note = null, debt_since = null where id in (select id from _legacy)';
  end if;
end $$;

commit;

-- ── ٩) التقرير — آخر أمر، فمحرر Supabase يعرض نتيجة الأمر الأخير وحده ──
select (select count(*) from _legacy) as ديون_نُقلت_لأصحابها,
       (select coalesce(sum(carried_debt), 0) from _legacy) as مجموعها,
       (select count(*) from past_tenancies) as سجلات_الأرشيف;
