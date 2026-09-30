-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v63: حصص الوحدات وأساس الرسوم والفترة السنوية (30 سبتمبر 2026)
--
-- ١) رسم لكل مالك: الرسم الفعلي = coalesce(owners.fee_override, associations.fee).
--    كل دوال المال تستعمله: الدفع، العكس، التعديل اليدوي، الاستحقاق، إعادة
--    التقسيم عند تغيّر الرسم، والبوابة. الجمعيات القائمة: fee_override = null
--    لكل مالك ⇒ السلوك مطابق لما قبل هذا الملف حرفيًّا.
-- ٢) أساس الرسوم (associations.fee_basis):
--    • equal (الافتراضي): كل وحدة تدفع associations.fee للفترة.
--    • share: رسم المالك للفترة = round(total_budget × share_pct ÷ (100 × فترات_السنة), 2)
--      حيث total_budget = الموازنة **السنوية** الإجمالية، وفترات_السنة = 12 للشهري و1 للسنوي.
--      (مثال: موازنة 120,000 وحصة 2.5% ⇒ سنوي 3,000 ⇒ شهري 250.)
--      التقريب لكل مالك على حدة؛ مجموع الرسوم قد يختلف عن الموازنة بهللات.
--      الحصص يجب أن تكون لكل الملاك وأكبر من صفر ومجموعها 100 (±0.01).
-- ٣) فترة الرسوم (associations.fee_period): monthly (الافتراضي) أو annual.
--    السنوي يُستحق مرة في بداية السنة المالية للجمعية (fiscal_start_month، 1–12).
--    months_late / prepaid_months صارا «فترات» (أشهر للشهري، سنوات للسنوي).
-- ٤) تغيير الرسم أو الأساس أو الفترة أو الحصص لا يعيد تسعير الماضي: رصيد كل مالك
--    بالريال يبقى كما هو ويُعاد تقسيمه على رسمه الجديد (كقاعدة v60).
--    تغيير الفترة أو بداية السنة المالية يبدأ من الفترة الحالية بلا أثر رجعي،
--    وقبل التغيير يُستحق ما فات بالخطة القديمة.
-- ٥) الأساس والفترة والموازنة والسنة المالية والحصص والرسم الخاص: عبر دوال
--    المدير فقط (watheq_assoc_set_fee_plan / watheq_assoc_apply_shares /
--    watheq_owner_set_share) — لا تُكتب مباشرة من الواجهة.
--
-- يتطلب schema-v62. آمن للتكرار. معاملة واحدة. لا يغيّر أي رقم قائم.
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════
begin;

do $$ begin
  if to_regprocedure('public.watheq_hoa_building_data(uuid)') is null then
    raise exception 'شغّل schema-v62 أولًا';
  end if;
  -- حارس إعادة التشغيل: بعد v64 كانت إعادة هذا الملف تُرجع العكس وإعادة التسعير والبوابة لنسختها الأقدم
  if to_regprocedure('public.watheq_owner_confirm_opening(uuid, integer, integer)') is not null then
    raise exception 'نسخة أحدث مطبَّقة — لا تُعِد تشغيل هذا الملف';
  end if;
end $$;

-- ── ١) الأعمدة ─────────────────────────────────────────────────
alter table public.owners add column if not exists share_pct numeric(7,4);
alter table public.owners add column if not exists area_m2 numeric(12,2);
alter table public.owners add column if not exists fee_override numeric(12,2);
alter table public.associations add column if not exists fee_basis text not null default 'equal';
alter table public.associations add column if not exists fee_period text not null default 'monthly';
alter table public.associations add column if not exists total_budget numeric(14,2);
alter table public.associations add column if not exists fiscal_start_month int not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'owners_share_pct_chk') then
    alter table public.owners add constraint owners_share_pct_chk check (share_pct is null or (share_pct >= 0 and share_pct <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'owners_area_m2_chk') then
    alter table public.owners add constraint owners_area_m2_chk check (area_m2 is null or area_m2 > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'owners_fee_override_chk') then
    alter table public.owners add constraint owners_fee_override_chk check (fee_override is null or fee_override > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'associations_fee_basis_chk') then
    alter table public.associations add constraint associations_fee_basis_chk check (fee_basis in ('equal', 'share'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'associations_fee_period_chk') then
    alter table public.associations add constraint associations_fee_period_chk check (fee_period in ('monthly', 'annual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'associations_total_budget_chk') then
    alter table public.associations add constraint associations_total_budget_chk check (total_budget is null or total_budget >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'associations_fiscal_start_chk') then
    alter table public.associations add constraint associations_fiscal_start_chk check (fiscal_start_month between 1 and 12);
  end if;
end $$;

-- ── ٢) أدوات الفترة ────────────────────────────────────────────
-- بداية الفترة التي يقع فيها اليوم: أول الشهر (شهري) أو أول السنة المالية (سنوي)
create or replace function public.watheq_hoa_period_start(p_period text, p_fiscal int, p_day date)
returns date language sql immutable as $$
  select case when p_period = 'annual'
    then make_date(extract(year from p_day)::int
                   - case when extract(month from p_day)::int < coalesce(p_fiscal, 1) then 1 else 0 end,
                   coalesce(p_fiscal, 1), 1)
    else date_trunc('month', p_day)::date end;
$$;

-- عدد بدايات الفترات في (p_from, p_to] — p_from و p_to أوائل أشهر
create or replace function public.watheq_hoa_periods_between(p_period text, p_from date, p_to date)
returns int language sql immutable as $$
  select case
    when p_from is null or p_to is null or p_to <= p_from then 0
    when p_period = 'annual' then
      ceil(((extract(year from p_to)::int - extract(year from p_from)::int) * 12
            + (extract(month from p_to)::int - extract(month from p_from)::int)) / 12.0)::int
    else (extract(year from p_to)::int - extract(year from p_from)::int) * 12
       + (extract(month from p_to)::int - extract(month from p_from)::int) end;
$$;

create or replace function public.watheq_hoa_cur_period(a public.associations)
returns date language sql stable set search_path = public as $$
  select watheq_hoa_period_start(coalesce(a.fee_period, 'monthly'), coalesce(a.fiscal_start_month, 1), watheq_today());
$$;

-- رسم الفترة لمالك من حصته: الموازنة سنوية، فالشهري ÷ 12
create or replace function public.watheq_share_fee(p_total numeric, p_share numeric, p_period text)
returns numeric language sql immutable as $$
  select round((p_total * p_share) / (100 * case when p_period = 'annual' then 1 else 12 end), 2);
$$;

-- ── ٣) الاستحقاق (يستبدل v60): فترة الجمعية ورسم كل مالك ────────
create or replace function public.watheq_hoa_accrue_locked(a public.associations)
returns int language plpgsql security definer set search_path = public as $$
declare cur date := watheq_hoa_cur_period(a); n int; n0 int;
        prev text := coalesce(current_setting('watheq.src', true), '');
begin
  n := watheq_hoa_periods_between(coalesce(a.fee_period, 'monthly'), a.accrued_through, cur);
  perform set_config('watheq.src', 'accrual', true);
  if a.accrued_through is null or n <= 0 then
    if a.accrued_through is null then update associations set accrued_through = cur where id = a.id; end if;
    perform set_config('watheq.src', prev, true);
    return 0;
  end if;
  if not a.auto_accrue then
    update associations set accrued_through = cur where id = a.id;   -- المطفأ لا يتراكم عليه شيء لاحقًا
    perform set_config('watheq.src', prev, true);
    return 0;
  end if;
  n0 := n; n := least(n, case when a.fee_period = 'annual' then 2 else 24 end);
  update owners o set months_late = s.late, partial_amount = s.partial, prepaid_months = s.prepaid
    from (select x.id, (watheq_owner_split(
                   watheq_owner_balance(x.months_late, x.partial_amount, x.prepaid_months, coalesce(x.fee_override, a.fee))
                     - n * coalesce(x.fee_override, a.fee),
                   coalesce(x.fee_override, a.fee))).*
            from owners x where x.association_id = a.id and coalesce(x.fee_override, a.fee, 0) > 0) s
   where o.id = s.id;
  update associations set accrued_through = cur where id = a.id;
  insert into hoa_audit (user_id, association_id, actor, source, action, before, after)
  values (a.user_id, a.id, auth.uid(), 'accrual', 'accrue',
          jsonb_build_object('accrued_through', a.accrued_through),
          jsonb_build_object('accrued_through', cur, 'months', n, 'months_due', n0, 'fee', a.fee,
                             'period', coalesce(a.fee_period, 'monthly'), 'fee_basis', coalesce(a.fee_basis, 'equal'),
                             'owners', (select count(*) from owners where association_id = a.id)));
  perform set_config('watheq.src', prev, true);
  return n;
end $$;
revoke all on function public.watheq_hoa_accrue_locked(public.associations) from public, anon, authenticated;

create or replace function public.watheq_hoa_accrue_mine()
returns int language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; total int := 0;
begin
  if auth.uid() is null then return 0; end if;
  for a in select * from associations x
            where watheq_can_read(x.user_id)
              and x.accrued_through < watheq_hoa_period_start(x.fee_period, x.fiscal_start_month, watheq_today())
            order by x.id
            for update
  loop
    total := total + watheq_hoa_accrue_locked(a);
  end loop;
  return total;
end $$;
revoke all on function public.watheq_hoa_accrue_mine() from public, anon;
grant execute on function public.watheq_hoa_accrue_mine() to authenticated;

create or replace function public.watheq_hoa_accrue_all()
returns int language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; total int := 0;
begin
  for a in select * from associations x
            where x.accrued_through < watheq_hoa_period_start(x.fee_period, x.fiscal_start_month, watheq_today())
            order by x.id
            for update
  loop
    total := total + watheq_hoa_accrue_locked(a);
  end loop;
  return total;
end $$;
revoke all on function public.watheq_hoa_accrue_all() from public, anon, authenticated;
grant execute on function public.watheq_hoa_accrue_all() to service_role;

-- ── ٤) حارس أعمدة الجمعية (يستبدل v62) ──────────────────────────
create or replace function public.watheq_assoc_protect()
returns trigger language plpgsql as $$
declare t date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.receipt_counter := 0;
      new.expense_counter := 0;
      new.public_token := null;
      new.fee_basis := 'equal';              -- الحصص تُوزَّع بعد إضافة الملاك (دالة)
      new.accrued_through := watheq_hoa_period_start(new.fee_period, new.fiscal_start_month, t);
    end if;
    return new;
  end if;
  if coalesce(nullif(current_setting('watheq.src', true), ''), 'manual') = 'manual' and auth.uid() is not null then
    new.receipt_counter := old.receipt_counter;
    new.accrued_through := old.accrued_through;
    new.expense_counter := old.expense_counter;
    new.public_token := old.public_token;
    new.fee_basis := old.fee_basis;
    new.fee_period := old.fee_period;
    new.total_budget := old.total_budget;
    new.fiscal_start_month := old.fiscal_start_month;
  end if;
  if new.auto_accrue and not coalesce(old.auto_accrue, false) then
    new.accrued_through := watheq_hoa_period_start(new.fee_period, new.fiscal_start_month, t);
  end if;
  return new;
end $$;

-- الرسم الخاص لا يُضبط عند الإدراج من الواجهة (يُحسب من الحصص بدالة)
create or replace function public.watheq_owner_protect()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and coalesce(nullif(current_setting('watheq.src', true), ''), 'manual') = 'manual' then
    new.fee_override := null;
  end if;
  return new;
end $$;
drop trigger if exists watheq_owner_protect on public.owners;
create trigger watheq_owner_protect before insert on public.owners
  for each row execute function public.watheq_owner_protect();

-- تغيير رسم الجمعية: يُعاد تقسيم من يتبع رسم الجمعية فقط (لا من له رسم خاص)
create or replace function public.watheq_assoc_fee_resplit()
returns trigger language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('watheq.src', true), '');
begin
  if prev = 'fee_plan' then return new; end if;   -- دالة الخطة تعيد التقسيم بنفسها
  if coalesce(old.fee, 0) > 0 and coalesce(new.fee, 0) > 0 and new.fee <> old.fee then
    perform set_config('watheq.src', 'fee_change', true);
    update owners o set months_late = s.late, partial_amount = s.partial, prepaid_months = s.prepaid
      from (select x.id, (watheq_owner_split(
                 watheq_owner_balance(x.months_late, x.partial_amount, x.prepaid_months, old.fee), new.fee)).*
              from owners x where x.association_id = new.id and x.fee_override is null) s
     where o.id = s.id;
    perform set_config('watheq.src', prev, true);
  end if;
  return new;
end $$;

-- سجل تدقيق الملاك: إعادة التقسيم من الخطة/الحصص موثَّقة بسطر واحد في الدالة
create or replace function public.watheq_hoa_audit_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare office uuid; src text := coalesce(nullif(current_setting('watheq.src', true), ''), 'manual');
        b jsonb; a jsonb;
begin
  if tg_op = 'UPDATE' then
    if (old.months_late, old.partial_amount, old.prepaid_months, old.name, old.unit)
       is not distinct from (new.months_late, new.partial_amount, new.prepaid_months, new.name, new.unit) then
      return new;
    end if;
    if src in ('payment', 'reversal', 'accrual', 'fee_change', 'fee_plan') then return new; end if;
  end if;
  select user_id into office from associations where id = coalesce(new.association_id, old.association_id);
  if office is null then return coalesce(new, old); end if;
  if tg_op <> 'INSERT' then
    b := jsonb_build_object('name', old.name, 'unit', old.unit, 'months_late', old.months_late,
                            'partial_amount', old.partial_amount, 'prepaid_months', old.prepaid_months);
  end if;
  if tg_op <> 'DELETE' then
    a := jsonb_build_object('name', new.name, 'unit', new.unit, 'months_late', new.months_late,
                            'partial_amount', new.partial_amount, 'prepaid_months', new.prepaid_months);
  end if;
  insert into hoa_audit (user_id, association_id, owner_id, actor, source, action, before, after)
  values (office, coalesce(new.association_id, old.association_id), coalesce(new.id, old.id),
          auth.uid(), src, lower(tg_op), b, a);
  return coalesce(new, old);
end $$;

-- ── ٥) الدفع والعكس والتعديل بالرسم الفعلي للمالك (تستبدل v60) ──
create or replace function public.watheq_record_owner_payment(
  p_owner uuid, p_amount numeric default null, p_method text default 'transfer',
  p_note text default null, p_actor uuid default null, p_paid_on date default null,
  p_reference text default null, p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o owners%rowtype; assoc associations%rowtype; office uuid; actor uuid; prev payments%rowtype;
        fee numeric; bal numeric; amt numeric; s record; months int; pid uuid; newbal numeric; d date; rno int;
begin
  select * into o from owners where id = p_owner;
  if not found then raise exception 'المالك غير موجود'; end if;
  select * into assoc from associations where id = o.association_id for update;
  office := assoc.user_id;

  if auth.uid() is not null then
    if not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  if p_request is not null then
    select * into prev from payments where request_id = p_request;
    if found then
      if prev.user_id is distinct from office or prev.owner_id is distinct from p_owner then
        raise exception 'طلب مكرر لعملية أخرى';
      end if;
      select * into o from owners where id = prev.owner_id;
      return jsonb_build_object('duplicate', true, 'payment_id', prev.id, 'amount', prev.amount,
        'months', prev.periods_covered, 'months_late', o.months_late, 'partial_amount', o.partial_amount,
        'prepaid_months', o.prepaid_months, 'receipt_no', prev.receipt_no, 'paid_on', prev.paid_on,
        'fund_balance', (select fund_balance from associations where id = prev.association_id));
    end if;
  end if;

  if coalesce(o.fee_override, assoc.fee, 0) <= 0 then raise exception 'اشتراك الجمعية غير محدَّد'; end if;

  perform watheq_hoa_accrue_locked(assoc);                     -- الرصيد محدَّث قبل الحساب
  select * into o from owners where id = p_owner for update;
  select * into assoc from associations where id = o.association_id;
  fee := coalesce(o.fee_override, assoc.fee, 0);
  if fee <= 0 then raise exception 'اشتراك الجمعية غير محدَّد'; end if;

  bal := watheq_owner_balance(o.months_late, o.partial_amount, o.prepaid_months, fee);
  if p_amount is null then
    amt := greatest(0, -bal);
    if amt <= 0 then raise exception 'لا مستحقات على هذا المالك'; end if;
  else
    amt := round(p_amount, 2);
  end if;
  if amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if amt > fee * (case when assoc.fee_period = 'annual' then 10 else 120 end) then
    raise exception 'المبلغ أكبر من المعقول لهذه الجمعية — راجع الرقم';
  end if;

  d := coalesce(p_paid_on, watheq_today());
  if d > watheq_today() + 1 or d < date '2000-01-01' then raise exception 'تاريخ الدفعة غير صالح'; end if;

  s := watheq_owner_split(bal + amt, fee);
  months := (coalesce(o.months_late, 0) - s.late) + (s.prepaid - coalesce(o.prepaid_months, 0));

  perform set_config('watheq.src', 'payment', true);
  update owners set months_late = s.late, partial_amount = s.partial, prepaid_months = s.prepaid,
                    last_paid = case when months > 0 then greatest(coalesce(last_paid, d), d) else last_paid end
   where id = p_owner;
  newbal := round(coalesce(assoc.fund_balance, 0) + amt, 2);
  update associations set fund_balance = newbal, receipt_counter = receipt_counter + 1
   where id = assoc.id returning receipt_counter into rno;
  perform set_config('watheq.src', '', true);

  insert into payments (user_id, owner_id, association_id, paid_on, amount, method, periods_covered,
                        note, created_by, reference, payer_name, unit_label, request_id, receipt_no)
  values (office, p_owner, assoc.id, d, amt, coalesce(nullif(p_method, ''), 'transfer'), months,
          nullif(btrim(coalesce(p_note, '')), ''), actor, nullif(btrim(coalesce(p_reference, '')), ''),
          o.name, o.unit, p_request, watheq_receipt_label(rno))
  returning id into pid;

  return jsonb_build_object('months_late', s.late, 'partial_amount', s.partial, 'prepaid_months', s.prepaid,
                            'months', months, 'payment_id', pid, 'fund_balance', newbal,
                            'amount', amt, 'paid_on', d, 'receipt_no', watheq_receipt_label(rno), 'fee', fee);
end $$;
revoke all on function public.watheq_record_owner_payment(uuid, numeric, text, text, uuid, date, text, uuid) from public, anon;
grant execute on function public.watheq_record_owner_payment(uuid, numeric, text, text, uuid, date, text, uuid) to authenticated, service_role;

create or replace function public.watheq_reverse_owner_payment(p_payment uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; o owners%rowtype; assoc associations%rowtype; office uuid; actor uuid;
        fee numeric; s record; pid uuid; newbal numeric; r_late int; r_partial numeric; r_prepaid int;
begin
  select * into pay from payments where id = p_payment;
  if not found or pay.association_id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.amount <= 0 or pay.reverses is not null then raise exception 'هذا سطر عكس — لا يُعكس'; end if;
  select * into assoc from associations where id = pay.association_id for update;
  office := assoc.user_id;

  if auth.uid() is not null then
    if not watheq_perm(office, 'undo_actions') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;
  if exists (select 1 from payments where reverses = p_payment) then raise exception 'عُكست هذه الدفعة من قبل'; end if;

  perform set_config('watheq.src', 'reversal', true);
  if pay.owner_id is not null then
    perform watheq_hoa_accrue_locked(assoc);
    select * into assoc from associations where id = pay.association_id;
    select * into o from owners where id = pay.owner_id for update;
    fee := coalesce(o.fee_override, assoc.fee, 0);
    if found and fee > 0 then
      s := watheq_owner_split(watheq_owner_balance(o.months_late, o.partial_amount, o.prepaid_months, fee) - pay.amount, fee);
      r_late := s.late; r_partial := s.partial; r_prepaid := s.prepaid;
      update owners set months_late = s.late, partial_amount = s.partial, prepaid_months = s.prepaid,
             last_paid = coalesce(
               (select max(p.paid_on) from payments p
                 where p.owner_id = o.id and p.id <> pay.id and p.amount > 0 and p.reverses is null
                   and coalesce(p.periods_covered, 0) > 0
                   and not exists (select 1 from payments r where r.reverses = p.id)),
               case when o.last_paid is not distinct from pay.paid_on then null else o.last_paid end)
       where id = o.id;
    end if;
  end if;
  select fund_balance into newbal from associations where id = assoc.id;
  newbal := round(coalesce(newbal, 0) - pay.amount, 2);
  update associations set fund_balance = newbal where id = assoc.id;
  perform set_config('watheq.src', '', true);

  insert into payments (user_id, owner_id, association_id, paid_on, amount, method, periods_covered,
                        note, created_by, reverses, payer_name, unit_label)
  values (office, pay.owner_id, pay.association_id, pay.paid_on, -pay.amount, 'other',
          -coalesce(pay.periods_covered, 0), 'عكس دفعة ' || pay.paid_on::text, actor, pay.id,
          pay.payer_name, pay.unit_label)
  returning id into pid;

  -- (v60 كان يقرأ s.late بلا مالك — المالك المحذوف كان يُسقط العكس بخطأ «record not assigned»)
  return jsonb_build_object('payment_id', pid, 'reversed', pay.amount, 'fund_balance', newbal,
    'months_late', r_late, 'partial_amount', r_partial, 'prepaid_months', r_prepaid);
end $$;
revoke all on function public.watheq_reverse_owner_payment(uuid, uuid) from public, anon;
grant execute on function public.watheq_reverse_owner_payment(uuid, uuid) to authenticated, service_role;

create or replace function public.watheq_owner_adjust(p_owner uuid, p_months int, p_expected_late int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o owners%rowtype; a associations%rowtype; s record; fee numeric;
begin
  select * into o from owners where id = p_owner;
  if not found then raise exception 'المالك غير موجود'; end if;
  select * into a from associations where id = o.association_id for update;
  if auth.uid() is null or not watheq_can_manage(a.user_id) then raise exception 'not authorized'; end if;
  if coalesce(o.fee_override, a.fee, 0) <= 0 then raise exception 'حدّد قيمة الاشتراك أولًا'; end if;
  if p_months is null or p_months = 0 or abs(p_months) > 120 then raise exception 'تعديل غير صالح'; end if;
  perform watheq_hoa_accrue_locked(a);
  select * into a from associations where id = o.association_id;
  select * into o from owners where id = p_owner for update;
  fee := coalesce(o.fee_override, a.fee, 0);
  if p_expected_late is not null and p_expected_late <> coalesce(o.months_late, 0) then
    raise exception 'تغيّرت بيانات المالك منذ فتحت الشاشة — حدّث الصفحة ثم أعد التعديل';
  end if;
  s := watheq_owner_split(watheq_owner_balance(o.months_late, o.partial_amount, o.prepaid_months, fee) - p_months * fee, fee);
  update owners set months_late = s.late, partial_amount = s.partial, prepaid_months = s.prepaid where id = p_owner;
  return jsonb_build_object('months_late', s.late, 'partial_amount', s.partial, 'prepaid_months', s.prepaid);
end $$;
revoke all on function public.watheq_owner_adjust(uuid, int, int) from public, anon;
grant execute on function public.watheq_owner_adjust(uuid, int, int) to authenticated;

-- ── ٦) إعادة التسعير (داخلية: تُستدعى والجمعية مقفلة) ─────────────
-- تطبّق خطة رسوم كاملة وتُبقي رصيد كل مالك بالريال ثابتًا.
create or replace function public.watheq_assoc_reprice_locked(a public.associations,
  p_fee numeric, p_basis text, p_period text, p_total numeric, p_fiscal int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare src0 text := coalesce(current_setting('watheq.src', true), '');
        v_fee numeric := round(coalesce(p_fee, 0), 2); v_tot numeric := round(p_total, 2);
        cnt int; missing int; nonpos int; ssum numeric; tiny int; cur date; res jsonb;
begin
  if p_basis is null or p_basis not in ('equal', 'share') then raise exception 'أساس الرسوم غير معروف'; end if;
  if p_period is null or p_period not in ('monthly', 'annual') then raise exception 'فترة الرسوم غير معروفة'; end if;
  if p_fiscal is null or p_fiscal not between 1 and 12 then raise exception 'شهر بداية السنة المالية بين 1 و12'; end if;
  if v_fee < 0 or v_fee > 10000000 then raise exception 'قيمة الاشتراك غير صالحة'; end if;
  if v_tot is not null and (v_tot < 0 or v_tot > 1000000000) then raise exception 'إجمالي الموازنة غير صالح'; end if;

  if p_basis = 'share' then
    if coalesce(v_tot, 0) <= 0 then raise exception 'حدّد إجمالي الموازنة السنوية أولًا لتوزيعها حسب الحصص'; end if;
    select count(*), count(*) filter (where share_pct is null), count(*) filter (where share_pct <= 0),
           coalesce(sum(share_pct), 0)
      into cnt, missing, nonpos, ssum
      from owners where association_id = a.id;
    if cnt = 0 then raise exception 'أضف الملاك وحصصهم أولًا'; end if;
    if missing > 0 then raise exception 'ملّاك بلا حصة: % من % — أدخل حصة كل مالك أولًا', missing, cnt; end if;
    if nonpos > 0 then raise exception 'حصة كل مالك يجب أن تكون أكبر من صفر (% بحصة صفر)', nonpos; end if;
    if abs(ssum - 100) > 0.01 then
      raise exception 'مجموع الحصص %٪ — يجب أن يساوي 100٪ (بفارق لا يتجاوز 0.01)', round(ssum, 4);
    end if;
    select count(*) into tiny from owners
     where association_id = a.id and watheq_share_fee(v_tot, share_pct, p_period) <= 0;
    if tiny > 0 then raise exception 'حصة % مالك صغيرة جدًا فيصبح رسمه صفرًا — راجع الحصص أو الموازنة', tiny; end if;
  end if;

  cur := watheq_hoa_period_start(p_period, p_fiscal, watheq_today());
  perform set_config('watheq.src', 'fee_plan', true);

  update owners o set fee_override = s.nov,
         months_late = coalesce(s.late, o.months_late),
         partial_amount = coalesce(s.partial, o.partial_amount),
         prepaid_months = coalesce(s.prepaid, o.prepaid_months)
    from (select y.id, y.nov, sp.late, sp.partial, sp.prepaid
            from (select x.id, x.months_late, x.partial_amount, x.prepaid_months,
                         coalesce(x.fee_override, a.fee, 0) as oldfee,
                         case when p_basis = 'share' then watheq_share_fee(v_tot, x.share_pct, p_period) end as nov
                    from owners x where x.association_id = a.id) y
            -- التقسيم فقط حين يتغيّر الرسم وكلاهما موجب (وإلا تبقى الأرقام كما هي)
            left join lateral (
              select (watheq_owner_split(watheq_owner_balance(y.months_late, y.partial_amount, y.prepaid_months, y.oldfee),
                                         coalesce(y.nov, v_fee))).*
               where y.oldfee > 0 and coalesce(y.nov, v_fee) > 0 and y.oldfee is distinct from coalesce(y.nov, v_fee)
            ) sp on true) s
   where o.id = s.id;

  update associations set fee = v_fee, fee_basis = p_basis, fee_period = p_period, total_budget = v_tot,
         fiscal_start_month = p_fiscal,
         accrued_through = case when coalesce(a.fee_period, 'monthly') is distinct from p_period
                                  or (p_period = 'annual' and coalesce(a.fiscal_start_month, 1) is distinct from p_fiscal)
                                then cur else accrued_through end
   where id = a.id;
  perform set_config('watheq.src', src0, true);

  select jsonb_build_object('fee', v_fee, 'fee_basis', p_basis, 'fee_period', p_period, 'total_budget', v_tot,
           'fiscal_start_month', p_fiscal,
           'owners', coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'fee_override', o.fee_override,
               'months_late', o.months_late, 'partial_amount', o.partial_amount, 'prepaid_months', o.prepaid_months,
               'share_pct', o.share_pct)), '[]'::jsonb))
    into res from owners o where o.association_id = a.id;

  insert into hoa_audit (user_id, association_id, actor, source, action, before, after)
  values (a.user_id, a.id, auth.uid(), 'fee_plan', 'reprice',
          jsonb_build_object('fee', a.fee, 'fee_basis', a.fee_basis, 'fee_period', a.fee_period,
                             'total_budget', a.total_budget, 'fiscal_start_month', a.fiscal_start_month),
          res - 'owners' || jsonb_build_object('owners', jsonb_array_length(res->'owners')));
  return res;
end $$;
revoke all on function public.watheq_assoc_reprice_locked(public.associations, numeric, text, text, numeric, int) from public, anon, authenticated;

-- المدير: تغيير خطة الرسوم كاملة (الرسم، الأساس، الفترة، الموازنة، السنة المالية)
create or replace function public.watheq_assoc_set_fee_plan(p_assoc uuid, p_fee numeric, p_basis text,
  p_period text, p_total_budget numeric default null, p_fiscal_start int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a associations%rowtype;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into a from associations where id = p_assoc for update;
  if not found or not watheq_can_manage(a.user_id) then raise exception 'not authorized'; end if;
  perform watheq_hoa_accrue_locked(a);                 -- ما فات يُستحق بالخطة القديمة أولًا
  select * into a from associations where id = p_assoc;
  return watheq_assoc_reprice_locked(a, p_fee, p_basis, p_period, p_total_budget, coalesce(p_fiscal_start, 1));
end $$;
revoke all on function public.watheq_assoc_set_fee_plan(uuid, numeric, text, text, numeric, int) from public, anon;
grant execute on function public.watheq_assoc_set_fee_plan(uuid, numeric, text, text, numeric, int) to authenticated;

-- المدير: توزيع الرسوم حسب الحصص (يحوّل الأساس إلى «حصص»)
create or replace function public.watheq_assoc_apply_shares(p_assoc uuid, p_total_budget numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a associations%rowtype;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into a from associations where id = p_assoc for update;
  if not found or not watheq_can_manage(a.user_id) then raise exception 'not authorized'; end if;
  perform watheq_hoa_accrue_locked(a);
  select * into a from associations where id = p_assoc;
  return watheq_assoc_reprice_locked(a, a.fee, 'share', coalesce(a.fee_period, 'monthly'),
                                     coalesce(p_total_budget, a.total_budget), coalesce(a.fiscal_start_month, 1));
end $$;
revoke all on function public.watheq_assoc_apply_shares(uuid, numeric) from public, anon;
grant execute on function public.watheq_assoc_apply_shares(uuid, numeric) to authenticated;

-- المدير: حصة المالك ومساحته (لا تغيّر رسمه حتى يُعاد التوزيع)
create or replace function public.watheq_owner_set_share(p_owner uuid, p_share numeric, p_area numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o owners%rowtype; office uuid; sh numeric := round(p_share, 4); ar numeric := round(p_area, 2);
        src0 text := coalesce(current_setting('watheq.src', true), '');
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into o from owners where id = p_owner;
  if not found then raise exception 'المالك غير موجود'; end if;
  select user_id into office from associations where id = o.association_id for update;
  if office is null or not watheq_can_manage(office) then raise exception 'not authorized'; end if;
  if sh is not null and (sh < 0 or sh > 100) then raise exception 'الحصة بين 0 و100٪'; end if;
  if ar is not null and (ar <= 0 or ar > 10000000) then raise exception 'المساحة يجب أن تكون أكبر من صفر'; end if;
  perform set_config('watheq.src', 'shares', true);
  update owners set share_pct = sh, area_m2 = ar where id = p_owner;
  perform set_config('watheq.src', src0, true);
  if (o.share_pct, o.area_m2) is distinct from (sh, ar) then
    insert into hoa_audit (user_id, association_id, owner_id, actor, source, action, before, after)
    values (office, o.association_id, o.id, auth.uid(), 'shares', 'set_share',
            jsonb_build_object('share_pct', o.share_pct, 'area_m2', o.area_m2),
            jsonb_build_object('share_pct', sh, 'area_m2', ar));
  end if;
  return jsonb_build_object('id', o.id, 'share_pct', sh, 'area_m2', ar);
end $$;
revoke all on function public.watheq_owner_set_share(uuid, numeric, numeric) from public, anon;
grant execute on function public.watheq_owner_set_share(uuid, numeric, numeric) to authenticated;

-- ── ٧) أرقام العمارة المجمَّعة (تستبدل v62): السنة = السنة المالية ──
create or replace function public.watheq_hoa_building_data(p_assoc uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a associations%rowtype; t date := watheq_today(); m0 date; y0 date; res jsonb;
begin
  select * into a from associations where id = p_assoc;
  if not found then return null; end if;
  m0 := date_trunc('month', t)::date;
  y0 := watheq_hoa_period_start('annual', coalesce(a.fiscal_start_month, 1), t);
  select jsonb_build_object(
    'name', a.name,
    'units', coalesce(a.units, 0),
    'fee', case when coalesce(a.fee_basis, 'equal') = 'equal' then coalesce(a.fee, 0) end,
    'fee_period', coalesce(a.fee_period, 'monthly'),
    'fee_basis', coalesce(a.fee_basis, 'equal'),
    'fund_balance', coalesce(a.fund_balance, 0),
    'today', t, 'month_start', m0, 'year_start', y0,
    'month_collected', (select coalesce(sum(p.amount), 0) from payments p
        where p.association_id = a.id and p.user_id = a.user_id
          and p.paid_on >= m0 and p.paid_on < (m0 + interval '1 month')::date),
    'year_collected', (select coalesce(sum(p.amount), 0) from payments p
        where p.association_id = a.id and p.user_id = a.user_id
          and p.paid_on >= y0 and p.paid_on < (y0 + interval '1 year')::date),
    'month_expenses', (select coalesce(sum(e.amount), 0) from association_expenses e
        where e.association_id = a.id and e.spent_on >= m0 and e.spent_on < (m0 + interval '1 month')::date),
    'year_expenses', (select coalesce(sum(e.amount), 0) from association_expenses e
        where e.association_id = a.id and e.spent_on >= y0 and e.spent_on < (y0 + interval '1 year')::date),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', s.category, 'total', s.total)
                                               order by s.total desc, s.category)
        from (select e.category, sum(e.amount) as total from association_expenses e
               where e.association_id = a.id and e.spent_on >= y0 and e.spent_on < (y0 + interval '1 year')::date
               group by e.category having sum(e.amount) <> 0) s), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('spent_on', x.spent_on, 'category', x.category,
                                             'description', x.description, 'amount', x.amount)
                                          order by x.spent_on desc, x.created_at desc)
        from (select e.spent_on, e.category, e.description, e.amount, e.created_at from association_expenses e
               where e.association_id = a.id and e.reverses is null
                 and not exists (select 1 from association_expenses r where r.reverses = e.id)
               order by e.spent_on desc, e.created_at desc limit 20) x), '[]'::jsonb),
    'owners_total', (select count(*) from owners o where o.association_id = a.id),
    'owners_paid', (select count(*) from owners o where o.association_id = a.id and coalesce(o.months_late, 0) = 0)
  ) into res;
  return res || jsonb_build_object('collection_pct',
    case when (res->>'owners_total')::int > 0
         then round(100.0 * (res->>'owners_paid')::int / (res->>'owners_total')::int)::int else null end);
end $$;
revoke all on function public.watheq_hoa_building_data(uuid) from public, anon, authenticated;

create or replace function public.watheq_hoa_building(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a associations%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into a from associations where public_token = p_token;
  if not found then return null; end if;
  if a.accrued_through is null or a.accrued_through < watheq_hoa_cur_period(a) then
    select * into a from associations where id = a.id for update;
    perform watheq_hoa_accrue_locked(a);
  end if;
  return watheq_hoa_building_data(a.id)
      || jsonb_build_object('office', (select jsonb_build_object('org_name', p.org_name) from profiles p where p.id = a.user_id));
end $$;
revoke all on function public.watheq_hoa_building(text) from public, anon, authenticated;
grant execute on function public.watheq_hoa_building(text) to service_role;

-- ── ٨) البوابة (تستبدل v62): رسم المالك الفعلي والفترة ────────────
create or replace function public.watheq_hoa_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l hoa_member_links%rowtype; a associations%rowtype; o owners%rowtype; res jsonb;
begin
  l := watheq_hoa_link_resolve(p_token);
  if l.id is null then return null; end if;

  select * into a from associations where id = l.association_id;
  if a.accrued_through is null or a.accrued_through < watheq_hoa_cur_period(a) then
    select * into a from associations where id = l.association_id for update;
    perform watheq_hoa_accrue_locked(a);
  end if;
  select * into a from associations where id = l.association_id;
  select * into o from owners where id = l.owner_id;

  update hoa_member_links set last_seen_at = now() where id = l.id;

  select jsonb_build_object(
    'association', jsonb_build_object('name', a.name, 'fee', coalesce(o.fee_override, a.fee, 0),
                   'fee_period', coalesce(a.fee_period, 'monthly'), 'fee_basis', coalesce(a.fee_basis, 'equal'),
                   'bank_name', a.bank_name, 'bank_account_name', a.bank_account_name, 'iban', a.iban),
    'office', (select jsonb_build_object('org_name', p.org_name) from profiles p where p.id = l.user_id),
    'owner', jsonb_build_object('name', o.name, 'unit', o.unit,
               'months_late', coalesce(o.months_late, 0), 'partial_amount', coalesce(o.partial_amount, 0),
               'prepaid_months', coalesce(o.prepaid_months, 0), 'last_paid', o.last_paid,
               'fee', coalesce(o.fee_override, a.fee, 0), 'share_pct', o.share_pct),
    'today', watheq_today(),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'paid_on', p.paid_on, 'amount', p.amount,
               'method', p.method, 'reference', p.reference, 'periods_covered', p.periods_covered,
               'receipt_no', p.receipt_no, 'payer_name', p.payer_name, 'unit_label', p.unit_label)
             order by p.paid_on desc, p.created_at desc)
        from payments p
       where p.owner_id = l.owner_id and p.association_id = l.association_id and p.user_id = l.user_id
         and p.amount > 0 and p.reverses is null
         and not exists (select 1 from payments r where r.reverses = p.id)), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'title', d.title,
               'created_at', d.created_at, 'requires_signature', d.requires_signature,
               'closes_at', d.closes_at,
               'decision', (select s.decision from hoa_signatures s where s.document_id = d.id
                              and s.owner_id = l.owner_id and s.decision <> 'seen' limit 1),
               'decided_at', (select s.signed_at from hoa_signatures s where s.document_id = d.id
                              and s.owner_id = l.owner_id and s.decision <> 'seen' limit 1),
               'seen_at', (select s.signed_at from hoa_signatures s where s.document_id = d.id
                              and s.owner_id = l.owner_id and s.decision = 'seen' limit 1))
             order by d.created_at desc)
        from hoa_documents d
       where d.association_id = l.association_id and d.user_id = l.user_id and d.cancelled_at is null), '[]'::jsonb),
    'building', watheq_hoa_building_data(l.association_id)
  ) into res;
  return res;
end $$;
revoke all on function public.watheq_hoa_portal(text) from public, anon, authenticated;
grant execute on function public.watheq_hoa_portal(text) to service_role;

commit;

-- ── فحص: صف واحد ──
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'owners'
     and column_name in ('share_pct', 'area_m2', 'fee_override')) as أعمدة_الملاك_المتوقع_3,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'associations'
     and column_name in ('fee_basis', 'fee_period', 'total_budget', 'fiscal_start_month')) as أعمدة_الجمعية_المتوقع_4,
  (select count(*) from public.associations where fee_basis <> 'equal' or fee_period <> 'monthly') as جمعيات_غير_شهرية_متساوية_يجب_0,
  (select count(*) from public.owners where fee_override is not null) as ملاك_برسم_خاص_يجب_0,
  has_column_privilege('authenticated', 'public.owners', 'fee_override', 'update') as كتابة_الرسم_الخاص_يجب_false,
  to_regprocedure('public.watheq_assoc_apply_shares(uuid, numeric)') is not null as دالة_توزيع_الحصص,
  to_regprocedure('public.watheq_assoc_set_fee_plan(uuid, numeric, text, text, numeric, int)') is not null as دالة_خطة_الرسوم,
  to_regprocedure('public.watheq_owner_set_share(uuid, numeric, numeric)') is not null as دالة_حصة_المالك,
  public.watheq_hoa_period_start('annual', 7, date '2026-03-15') = date '2025-07-01' as بداية_السنة_المالية_سليمة;
