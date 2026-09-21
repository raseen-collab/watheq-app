-- ============================================================
-- وثيق — schema-v44: التصحيحات المالية صحيحة بالبناء
--
-- مراجعة مسارات التصحيح بالدوال الحقيقية على Postgres كشفت خمسة أعطال:
--
-- (١) عكس/تراجع الدفعة الجزئية يُفسد العدّاد.
--     الدالتان كانتا تنقصان «دفعات كاملة» (greatest(1, periods_covered))
--     ولا تمسّان المبلغ الجزئي. فعكس 2,000 جزئية يُبقي الـ2,000 في العدّاد؛
--     والتراجع عن جزئية فوق 3 مسدَّدة يُسقط دفعة كاملة؛ وعكس دفعة أكملت
--     قسطًا وأبقت 500 يُضيع 1,500.
--     الصواب: العدّاد والجزئي رقم واحد — الرصيد = المسدَّد × الإيجار + الجزئي.
--     التسجيل يضيف المبلغ إلى الرصيد ثم يوزّعه؛ والعكس يطرحه ثم يوزّعه.
--     فيصير العكس معكوس التسجيل بالضبط.
--
-- (٢) الدفعة تُعكس مرتين.
--     التراجع يعرف ما عُكس بالمبلغ والتاريخ، والعكس اليدوي بالمعرّف في
--     الملاحظة — آليتان لا ترى إحداهما الأخرى. فتراجع ثم عكس يدوي للدفعة
--     نفسها يخصمها مرتين.
--     الحل: عمود reverses يربط العكس بدفعته، وفهرس فريد عليه — فالقاعدة
--     نفسها ترفض عكسًا ثانيًا مهما كان الطريق.
--
-- (٣) تعديل تاريخ دفعة معكوسة يفصلها عن عكسها في الشهر: الأصل في شهر
--     والعكس في آخر. الآن: تاريخ العكس يتبع أصله تلقائيًّا ولا يُعدَّل وحده.
--
-- (٤) تعديل العدّاد يدويًّا («تعديل البيانات») صامت بلا أثر — كما كان
--     التراجع قبل v43. الآن يُسجَّل في ledger_adjustments: من، ومتى، ومن كم
--     إلى كم. وكذلك الرصيد الافتتاحي عند الإضافة، وتصفير إعادة التأجير.
--
-- يتطلب v43 (جدول ledger_adjustments). آمن للتكرار.
-- ============================================================

begin;

-- ── ١) ربط العكس بدفعته ─────────────────────────────────────
alter table payments add column if not exists reverses uuid references payments(id) on delete set null;

/* تعبئة القديم: العكس اليدوي كان يكتب المعرّف في ملاحظته */
update payments n
   set reverses = (regexp_match(n.note, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1]::uuid
 where n.amount < 0 and n.reverses is null
   and n.note ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
   and exists (select 1 from payments o where o.id =
       (regexp_match(n.note, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1]::uuid);

/* والتراجع كان يقرن بالمبلغ والتاريخ: نقرن كلًّا بأحدث أصل لم يُقرن بعد */
do $$
declare r record; orig uuid;
begin
  for r in select * from payments where amount < 0 and reverses is null order by created_at loop
    select p.id into orig from payments p
     where p.tenant_id = r.tenant_id and p.amount = -r.amount and p.paid_on = r.paid_on
       and p.created_at <= r.created_at
       and not exists (select 1 from payments q where q.reverses = p.id)
     order by p.created_at desc limit 1;
    if orig is not null then update payments set reverses = orig where id = r.id; end if;
  end loop;
end $$;

create unique index if not exists payments_reverses_once on payments (reverses) where reverses is not null;


-- ── ١ب) حدّ المدة الحالية ───────────────────────────────────
/* المدة تبدأ من جديد عند إعادة التأجير وعند التجديد — وكلاهما يصفّر
   العدّاد ويُبقي الصفّ نفسه. فكانت دفعات المدة السابقة تبقى مرئية:
   «تراجع» في المدة الجديدة يعكس دفعة من السابقة، وكشف الحساب يجمع
   دفعات السنة الماضية مع قيمة عقد السنة الحالية.
   الحدّ يفصل بين المدتين. */
alter table tenants add column if not exists term_started_at timestamptz;

/* القديم: لا سجل للتجديدات السابقة. الحدّ = قبيل أول دفعة تقع في المدة
   الحالية (تاريخ سدادها ≥ بداية العقد)؛ وإلا فبُعيد آخر دفعة قبلها؛
   وإلا فلا حدّ (كل الدفعات مرئية). */
update tenants t set term_started_at = coalesce(
    (select min(x.created_at) from payments x
      where x.tenant_id = t.id and x.amount > 0 and x.paid_on >= t.contract_start) - interval '1 second',
    (select max(x.created_at) from payments x
      where x.tenant_id = t.id and x.paid_on < t.contract_start) + interval '1 second',
    '-infinity'::timestamptz)
 where term_started_at is null;

create or replace function tenants_term_boundary()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.term_started_at := coalesce(new.term_started_at, '-infinity'::timestamptz);
  elsif (old.status = 'vacated' and new.status is distinct from 'vacated')              -- إعادة تأجير
     /* تجديد: البداية تقفز للأمام مدةً (≥ 25 يومًا) مع تصفير العدّاد.
        القفزة تفرّقه عن تصحيح تاريخ مكتوب خطأً (أيام معدودة). ولا نشترط
        رصيدًا سابقًا: من صفّر العدّاد يدويًّا ثم جدّد، بدأ مدة جديدة أيضًا. */
     or (new.contract_start >= coalesce(old.contract_start, '-infinity'::date) + 25
         and old.contract_start is not null
         and coalesce(new.paid_periods, 0) = 0 and coalesce(new.partial_amount, 0) = 0) then
    new.term_started_at := now();
  end if;
  return new;
end $$;
drop trigger if exists tenants_term_boundary_trg on tenants;
create trigger tenants_term_boundary_trg before insert or update of status, contract_start, paid_periods, partial_amount on tenants
  for each row execute function tenants_term_boundary();


-- ── ٢) أداة الرصيد المشتركة ────────────────────────────────
/* رصيد → (مسدَّد، جزئي). مصدر واحد للتوزيع في التسجيل والعكس. */
create or replace function watheq_split_credit(credit numeric, rent numeric, out paid int, out partial numeric)
language plpgsql immutable as $$
begin
  if rent is null or rent <= 0 then paid := 0; partial := 0; return; end if;
  credit  := greatest(0, round(credit, 2));
  paid    := floor(credit / rent);
  partial := round(credit - paid * rent, 2);
end $$;


-- ── ٣) التسجيل: كما هو، مع علم «داخل دالة» لمشغّل التدقيق ─────
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

  if p_paid_on is not null and p_paid_on > (current_date + 1) then
    raise exception 'تاريخ السداد في المستقبل';
  end if;

  rent := coalesce(t.rent_amount, 0);
  if rent <= 0 then raise exception 'قيمة الدفعة غير محدّدة لهذا العقد'; end if;
  pool       := greatest(0, coalesce(t.partial_amount, 0)) + p_amount;
  completed  := floor(pool / rent);
  newpartial := round(pool - completed * rent, 2);
  newpaid    := greatest(0, coalesce(t.paid_periods, 0)) + completed;

  update tenants set paid_periods = newpaid, partial_amount = newpartial where id = p_tenant;
  update properties set collected = coalesce(collected, 0) + p_amount where id = t.property_id;
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by, reference)
  values (office, p_tenant, t.property_id, coalesce(p_paid_on, current_date), p_amount,
          coalesce(nullif(p_method, ''), 'transfer'), completed, p_note, actor, nullif(btrim(p_reference), ''))
  returning id into pid;
  return jsonb_build_object('paid_periods', newpaid, 'partial_amount', newpartial,
                            'completed', completed, 'payment_id', pid);
end $$;


-- ── ٤) العكس اليدوي لدفعة بعينها ───────────────────────────
create or replace function watheq_reverse_payment(p_payment uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; t tenants%rowtype; office uuid; actor uuid;
        credit numeric; s record; pid uuid;
begin
  perform set_config('watheq.in_fn', '1', true);
  select * into pay from payments where id = p_payment for update;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  if pay.amount <= 0 then raise exception 'هذا الصفّ عكسٌ أصلًا ولا يُعكس'; end if;
  if exists (select 1 from payments where reverses = p_payment) then
    raise exception 'سبق عكس هذه الدفعة';
  end if;

  select * into t from tenants where id = pay.tenant_id for update;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  /* دفعة من مدة سابقة: عكسها يُنقص عدّاد مدة لم تُدفع فيها */
  if t.term_started_at is not null and pay.created_at < t.term_started_at then
    raise exception 'هذه دفعة من مدة سابقة (قبل التجديد أو إعادة التأجير) — لا تُعكس من المدة الحالية. عدّل الدين المرحَّل بدلًا منها.';
  end if;
  select user_id into office from properties where id = pay.property_id for update;

  if auth.uid() is not null then
    if not watheq_perm(office, 'undo_actions') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  /* الرصيد ناقص المبلغ ثم يوزَّع — معكوس التسجيل بالضبط */
  credit := coalesce(t.paid_periods, 0) * coalesce(t.rent_amount, 0) + coalesce(t.partial_amount, 0) - pay.amount;
  s := watheq_split_credit(credit, t.rent_amount);
  update tenants set paid_periods = s.paid, partial_amount = s.partial where id = pay.tenant_id;
  update properties set collected = coalesce(collected, 0) - pay.amount where id = pay.property_id;

  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by, reverses)
  values (office, pay.tenant_id, pay.property_id, pay.paid_on, -pay.amount, 'other', -coalesce(pay.periods_covered, 0),
          'عكس دفعة ' || pay.paid_on::text || ' — ' || p_payment::text, actor, p_payment)
  returning id into pid;

  return jsonb_build_object('paid_periods', s.paid, 'partial_amount', s.partial, 'reversed', pay.amount,
                            'paid_on', pay.paid_on, 'payment_id', pid);
end $$;


-- ── ٥) التراجع عن آخر دفعة ──────────────────────────────────
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

  /* آخر دفعة موجبة لم تُعكس — بالربط لا بالمبلغ والتاريخ.
     تُسأل قبل حارس «العدّاد صفر»: إن صُفّر العدّاد يدويًّا ثم اكتشف المكتب
     دفعة سجّلها خطأً، كان الحارس يمنعه من تصحيح نقد حقيقي في الدفتر. */
  select p.* into last_pay from payments p
   where p.tenant_id = p_tenant and p.amount > 0
     and not exists (select 1 from payments r where r.reverses = p.id)
     and (t.term_started_at is null or p.created_at >= t.term_started_at)
   order by p.created_at desc limit 1;

  if not found and credit <= 0 then raise exception 'لا دفعات مسجّلة للتراجع عنها'; end if;

  if found then
    back := last_pay.amount;
    s := watheq_split_credit(credit - back, t.rent_amount);
    update tenants set paid_periods = s.paid, partial_amount = s.partial where id = p_tenant;
    update properties set collected = coalesce(collected, 0) - back where id = t.property_id;
    insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by, reverses)
    values (office, p_tenant, t.property_id, last_pay.paid_on, -back, 'other', -coalesce(last_pay.periods_covered, 0),
            'تراجع عن دفعة بتاريخ ' || last_pay.paid_on::text, actor, last_pay.id)
    returning id into pid;
  else
    /* رصيد افتتاحي: دفعة واحدة من الرصيد، بلا نقد في الدفتر */
    s := watheq_split_credit(credit - coalesce(t.rent_amount, 0), t.rent_amount);
    update tenants set paid_periods = s.paid, partial_amount = s.partial where id = p_tenant;
    insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
    values (office, p_tenant, t.property_id, 'counter', s.paid - coalesce(t.paid_periods, 0), t.rent_amount,
            'تصحيح عدّاد: دفعة سُدّدت قبل وثيق (رصيد افتتاحي) — بلا أثر نقدي', actor);
  end if;

  return jsonb_build_object('paid_periods', s.paid, 'partial_amount', s.partial, 'reversed', back,
                            'paid_on', last_pay.paid_on, 'payment_id', pid,
                            'opening_balance', last_pay.id is null);
end $$;

revoke all on function watheq_record_payment(uuid, numeric, text, text, date, uuid, text) from public, anon;
grant execute on function watheq_record_payment(uuid, numeric, text, text, date, uuid, text) to authenticated;
revoke all on function watheq_reverse_payment(uuid, uuid) from public, anon;
grant execute on function watheq_reverse_payment(uuid, uuid) to authenticated;
revoke all on function watheq_undo_payment(uuid, uuid) from public, anon;
grant execute on function watheq_undo_payment(uuid, uuid) to authenticated;


-- ── ٦) تاريخ العكس يتبع أصله ────────────────────────────────
create or replace function payments_reversal_date_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.paid_on is not distinct from old.paid_on then return new; end if;
  /* العكس لا يُعدَّل تاريخه وحده — وإلا انفصل عن شهر أصله */
  if new.reverses is not null and current_setting('watheq.sync', true) is distinct from '1' then
    raise exception 'تاريخ صفّ العكس يتبع الدفعة الأصلية — عدّل تاريخ الأصل';
  end if;
  return new;
end $$;

create or replace function payments_reversal_date_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.amount > 0 and new.paid_on is distinct from old.paid_on then
    perform set_config('watheq.sync', '1', true);
    update payments set paid_on = new.paid_on where reverses = new.id;
    perform set_config('watheq.sync', '', true);
  end if;
  return new;
end $$;

drop trigger if exists payments_reversal_date_guard_trg on payments;
create trigger payments_reversal_date_guard_trg before update of paid_on on payments
  for each row execute function payments_reversal_date_guard();
drop trigger if exists payments_reversal_date_sync_trg on payments;
create trigger payments_reversal_date_sync_trg after update of paid_on on payments
  for each row execute function payments_reversal_date_sync();


-- ── ٧) أثرٌ لكل تعديل يدوي للعدّاد ─────────────────────────
create or replace function tenants_counter_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare office uuid; note text;
begin
  if current_setting('watheq.in_fn', true) = '1' then return new; end if;   -- الدوال تسجّل أثرها بنفسها
  if tg_op = 'UPDATE'
     and new.paid_periods is not distinct from old.paid_periods
     and new.partial_amount is not distinct from old.partial_amount then return new; end if;
  if tg_op = 'INSERT' and coalesce(new.paid_periods, 0) = 0 and coalesce(new.partial_amount, 0) = 0 then return new; end if;

  select user_id into office from properties where id = new.property_id;
  note := case
    when tg_op = 'INSERT' then 'رصيد افتتاحي عند الإضافة: ' || coalesce(new.paid_periods, 0) || ' دفعات'
                              || case when coalesce(new.partial_amount, 0) > 0 then ' + جزئي ' || new.partial_amount else '' end
    when old.status = 'vacated' and new.status = 'active' then 'إعادة تأجير: تصفير العدّاد (كان ' || coalesce(old.paid_periods, 0) || ')'
    when old.contract_start is not null and new.contract_start >= old.contract_start + 25 and coalesce(new.paid_periods, 0) = 0
         then 'تجديد العقد: بدأت مدة جديدة (كان المسدَّد ' || coalesce(old.paid_periods, 0) || ')'
    else 'تعديل يدوي للعدّاد: من ' || coalesce(old.paid_periods, 0) || ' إلى ' || coalesce(new.paid_periods, 0)
         || case when new.partial_amount is distinct from old.partial_amount
                 then ' · الجزئي من ' || coalesce(old.partial_amount, 0) || ' إلى ' || coalesce(new.partial_amount, 0) else '' end
  end;
  insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
  values (office, new.id, new.property_id, 'counter',
          coalesce(new.paid_periods, 0) - case when tg_op = 'INSERT' then 0 else coalesce(old.paid_periods, 0) end,
          new.rent_amount, note, auth.uid());
  return new;
end $$;

drop trigger if exists tenants_counter_audit_trg on tenants;
create trigger tenants_counter_audit_trg after insert or update of paid_periods, partial_amount on tenants
  for each row execute function tenants_counter_audit();

commit;

-- ── ٨) التقرير ──────────────────────────────────────────────
select
  (select count(*) from payments where amount < 0 and reverses is not null) as عكوس_رُبطت_بأصلها,
  (select count(*) from payments where amount < 0 and reverses is null)     as عكوس_بلا_أصل_للمراجعة;
-- «عكوس بلا أصل» = صفوف سالبة لم يُعثر على دفعة تقابلها: غالبًا عكسٌ مزدوج
-- قديم. لا تُحذف تلقائيًّا — شغّل هذا وأرسل ناتجه للمراجعة:
-- select pr.name, t.name, t.unit, x.paid_on, x.amount, x.note, x.created_at
-- from payments x join tenants t on t.id = x.tenant_id join properties pr on pr.id = x.property_id
-- where x.amount < 0 and x.reverses is null order by pr.name, x.created_at;
