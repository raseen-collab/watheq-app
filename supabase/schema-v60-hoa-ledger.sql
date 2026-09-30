-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v60: دفتر اتحاد الملاك (30 سبتمبر 2026)
--
-- ١) رصيد المالك بنموذج واحد: الرصيد = مقدَّم×الرسم + الجزئي − متأخر×الرسم
--    فالدفع والعكس والاستحقاق كلها «إضافة/خصم مبلغ ثم تقسيم» — لا شهر يضيع.
--    • الدفع المقدَّم يُحفظ (prepaid_months) بدل أن يسقط.
--    • «سدّد الكل» = الدالة نفسها بلا مبلغ ⇒ تسدّد المستحق بالضبط، بإيصال.
--    • منع التكرار: p_request (معرّف الضغطة) فريد — الضغطة الثانية تُرجع الأولى.
--    • التاريخ بتوقيت الرياض (القاعدة على UTC).
--    • اسم المالك ووحدته يُحفظان مع الدفعة، وحذف المالك لا يمحو سجل دفعاته.
-- ٢) عكس دفعة مالك (watheq_reverse_owner_payment) — كمسار العقارات.
-- ٣) استحقاق شهري تلقائي، لا يتكرر لنفس الشهر (accrued_through).
--    الجمعيات الموجودة: مطفأ (auto_accrue = false) حتى يفعّله صاحبها —
--    لا يتغيّر رقم أي مالك قائم بدون قراره. الجمعيات الجديدة: مفعّل.
-- ٤) سجل تدقيق لا يُعدَّل ولا يُحذف (hoa_audit): كل تغيير على متأخرات مالك
--    أو رسوم/صندوق الجمعية — من؟ متى؟ قبل/بعد؟ ومن أي مسار؟
-- ٥) إغلاق ثغرة: موظف «مدير» كان يستطيع نقل الجمعية (أو العقار) لحسابه.
--    وحارس: الموازنة/الدفعة لا تُربط بجمعية أو مالك من مكتب آخر.
--
-- آمن للتكرار. معاملة واحدة. لا يغيّر أي رقم لمالك أو جمعية قائمة.
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════
begin;

-- حارس إعادة التشغيل (أُضيف 30 سبتمبر 2026): إعادة هذا الملف بعد v62/v63 كانت ستُرجع
-- دوال المال والحراس إلى نسختها الأقدم. التشغيل الأول (قبلها) لا يتأثر.
do $$ begin
  if to_regprocedure('public.watheq_assoc_set_fee_plan(uuid, numeric, text, text, numeric, integer)') is not null
     or to_regprocedure('public.watheq_record_assoc_expense(uuid, numeric, text, text, date, text, text, boolean, uuid)') is not null then
    raise exception 'نسخة أحدث مطبَّقة — لا تُعِد تشغيل هذا الملف';
  end if;
end $$;

-- ── ٠) يوم الرياض ──────────────────────────────────────────────
create or replace function public.watheq_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;
grant execute on function public.watheq_today() to authenticated, service_role;

-- ── ١) أعمدة جديدة ─────────────────────────────────────────────
alter table public.owners       add column if not exists prepaid_months int not null default 0;
alter table public.associations add column if not exists auto_accrue boolean;
alter table public.associations add column if not exists accrued_through date;
update public.associations set auto_accrue = false where auto_accrue is null;         -- القائمة: مطفأ
alter table public.associations alter column auto_accrue set default true;            -- الجديدة: مفعّل
alter table public.associations alter column auto_accrue set not null;
update public.associations set accrued_through = date_trunc('month', public.watheq_today())::date
 where accrued_through is null;
alter table public.associations alter column accrued_through
  set default (date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date);

-- حساب الجمعية البنكي — يظهر للمالك في رابطه ورسالة التذكير ليحوّل مباشرة
alter table public.associations add column if not exists bank_name text;
alter table public.associations add column if not exists bank_account_name text;
alter table public.associations add column if not exists iban text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'associations_iban_chk') then
    alter table public.associations add constraint associations_iban_chk
      check (iban is null or iban ~ '^SA[0-9]{22}$');
  end if;
end $$;

alter table public.payments add column if not exists request_id uuid;
create unique index if not exists payments_request_once on public.payments (request_id) where request_id is not null;
-- سند قبض مرقَّم تسلسليًا لكل جمعية (بلا فجوات: العدّاد في نفس معاملة الدفعة)
alter table public.associations add column if not exists receipt_counter int not null default 0;
alter table public.payments add column if not exists receipt_no text;
-- الدفعات السابقة (إن وُجدت) تُرقَّم بترتيب تسجيلها، ثم يُضبط العدّاد
with x as (
  select p.id, p.association_id,
         row_number() over (partition by p.association_id order by p.created_at, p.id) as n
    from public.payments p
   where p.association_id is not null and p.amount > 0 and p.reverses is null and p.receipt_no is null
     and not exists (select 1 from public.payments q where q.association_id = p.association_id and q.receipt_no is not null)
)
update public.payments p set receipt_no = 'R-' || lpad(x.n::text, 5, '0') from x where p.id = x.id;
update public.associations a set receipt_counter = greatest(a.receipt_counter,
  coalesce((select max(substring(receipt_no from 3)::int) from public.payments p
             where p.association_id = a.id and p.receipt_no ~ '^R-[0-9]+$'), 0));
create unique index if not exists payments_receipt_once on public.payments (association_id, receipt_no) where receipt_no is not null;
create index if not exists payments_owner_idx on public.payments (owner_id, paid_on) where owner_id is not null;

-- حذف المالك كان يمحو كل دفعاته (cascade) فيختفي أثر مبالغ دخلت الصندوق.
-- الآن تبقى الدفعة (باسمه ووحدته المحفوظين) ويُفصل الرابط فقط.
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.payments'::regclass and con.contype = 'f'
      and con.confrelid = 'public.owners'::regclass and con.confdeltype = 'c'
  loop
    execute format('alter table public.payments drop constraint %I', c.conname);
    execute format('alter table public.payments add constraint %I foreign key (owner_id) references public.owners(id) on delete set null', c.conname);
  end loop;
end $$;

-- ── ٦) سجل التدقيق ────────────────────────────────────────────
create table if not exists public.hoa_audit (
  id bigserial primary key,
  user_id uuid not null,
  association_id uuid,
  owner_id uuid,
  actor uuid,
  source text not null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists hoa_audit_assoc_idx on public.hoa_audit (association_id, created_at desc);
alter table public.hoa_audit enable row level security;
drop policy if exists hoa_audit_read on public.hoa_audit;
create policy hoa_audit_read on public.hoa_audit for select using (watheq_can_read(user_id));
revoke insert, update, delete, truncate on public.hoa_audit from public, anon, authenticated;
grant select on public.hoa_audit to authenticated;

-- ── ٢) الرصيد والتقسيم ─────────────────────────────────────────
create or replace function public.watheq_owner_balance(late int, partial numeric, prepaid int, fee numeric)
returns numeric language sql immutable as $$
  select round(coalesce(prepaid, 0) * fee + coalesce(partial, 0) - coalesce(late, 0) * fee, 2);
$$;

create or replace function public.watheq_owner_split(bal numeric, fee numeric,
  out late int, out partial numeric, out prepaid int)
language plpgsql immutable as $$
begin
  if fee is null or fee <= 0 then raise exception 'رسم الجمعية غير محدَّد'; end if;
  bal := round(bal, 2);
  if bal >= 0 then
    late := 0; prepaid := floor(bal / fee); partial := round(bal - prepaid * fee, 2);
  else
    prepaid := 0; late := ceil(-bal / fee); partial := round(late * fee + bal, 2);
  end if;
end $$;

-- ── ٣) الاستحقاق الشهري (داخلي: يُستدعى والجمعية مقفلة) ─────────
create or replace function public.watheq_hoa_accrue_locked(a public.associations)
returns int language plpgsql security definer set search_path = public as $$
declare cur date := date_trunc('month', watheq_today())::date; n int; n0 int;
        prev text := coalesce(current_setting('watheq.src', true), '');
begin
  n := (extract(year from cur)::int - extract(year from a.accrued_through)::int) * 12
     + (extract(month from cur)::int - extract(month from a.accrued_through)::int);
  perform set_config('watheq.src', 'accrual', true);
  if a.accrued_through is null or n <= 0 then
    if a.accrued_through is null then update associations set accrued_through = cur where id = a.id; end if;
    perform set_config('watheq.src', prev, true);
    return 0;
  end if;
  if not a.auto_accrue or coalesce(a.fee, 0) <= 0 then
    update associations set accrued_through = cur where id = a.id;   -- المطفأ لا يتراكم عليه شيء لاحقًا
    perform set_config('watheq.src', prev, true);
    return 0;
  end if;
  n0 := n; n := least(n, 24);
  update owners o set months_late = s.late, partial_amount = s.partial, prepaid_months = s.prepaid
    from (select x.id, (watheq_owner_split(
                   watheq_owner_balance(x.months_late, x.partial_amount, x.prepaid_months, a.fee) - n * a.fee,
                   a.fee)).*
            from owners x where x.association_id = a.id) s
   where o.id = s.id;
  update associations set accrued_through = cur where id = a.id;
  insert into hoa_audit (user_id, association_id, actor, source, action, before, after)
  values (a.user_id, a.id, auth.uid(), 'accrual', 'accrue',
          jsonb_build_object('accrued_through', a.accrued_through),
          jsonb_build_object('accrued_through', cur, 'months', n, 'months_due', n0, 'fee', a.fee,
                             'owners', (select count(*) from owners where association_id = a.id)));
  perform set_config('watheq.src', prev, true);
  return n;
end $$;
revoke all on function public.watheq_hoa_accrue_locked(public.associations) from public, anon, authenticated;

-- لكل جمعيات من يستدعي (تفتح اللوحة) — آمنة للتكرار
create or replace function public.watheq_hoa_accrue_mine()
returns int language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; total int := 0;
begin
  if auth.uid() is null then return 0; end if;
  for a in select * from associations
            where watheq_can_read(user_id)
              and accrued_through < date_trunc('month', watheq_today())::date
            order by id
            for update
  loop
    total := total + watheq_hoa_accrue_locked(a);
  end loop;
  return total;
end $$;
revoke all on function public.watheq_hoa_accrue_mine() from public, anon;
grant execute on function public.watheq_hoa_accrue_mine() to authenticated;

-- للمهمة اليومية (مفتاح الخدمة فقط)
create or replace function public.watheq_hoa_accrue_all()
returns int language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; total int := 0;
begin
  for a in select * from associations
            where accrued_through < date_trunc('month', watheq_today())::date
            order by id
            for update
  loop
    total := total + watheq_hoa_accrue_locked(a);
  end loop;
  return total;
end $$;
revoke all on function public.watheq_hoa_accrue_all() from public, anon, authenticated;
grant execute on function public.watheq_hoa_accrue_all() to service_role;

-- حارس أعمدة الجمعية الداخلية: عدّاد السندات وتاريخ آخر استحقاق لا يُكتبان من الواجهة
-- (وإلا: إرجاع العدّاد ⇒ تكرار أرقام، وإرجاع التاريخ ⇒ استحقاق أشهر مفاجئ).
-- وتفعيل الاستحقاق لاحقًا يبدأ من الشهر الحالي — بلا أشهر سابقة.
create or replace function public.watheq_assoc_protect()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.receipt_counter := 0;
      new.accrued_through := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
    end if;
    return new;
  end if;
  if coalesce(nullif(current_setting('watheq.src', true), ''), 'manual') = 'manual' and auth.uid() is not null then
    new.receipt_counter := old.receipt_counter;
    new.accrued_through := old.accrued_through;
  end if;
  if new.auto_accrue and not coalesce(old.auto_accrue, false) then
    new.accrued_through := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
  end if;
  return new;
end $$;
drop trigger if exists watheq_assoc_accrue_toggle on public.associations;
drop trigger if exists watheq_assoc_protect on public.associations;
create trigger watheq_assoc_protect before insert or update on public.associations
  for each row execute function public.watheq_assoc_protect();

-- تغيير الرسم لا يعيد تسعير الماضي: رصيد كل مالك بالريال يبقى كما هو،
-- ويُعاد تقسيمه على الرسم الجديد (6 أشهر × 100 = 600 ⇒ 4 أشهر × 150).
-- وإلا: متأخرات قديمة ترتفع بأثر رجعي، وعكس دفعة مقدَّمة بعد التغيير يخلق مالًا.
create or replace function public.watheq_assoc_fee_resplit()
returns trigger language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('watheq.src', true), '');
begin
  if coalesce(old.fee, 0) > 0 and coalesce(new.fee, 0) > 0 and new.fee <> old.fee then
    perform set_config('watheq.src', 'fee_change', true);
    update owners o set months_late = s.late, partial_amount = s.partial, prepaid_months = s.prepaid
      from (select x.id, (watheq_owner_split(
                 watheq_owner_balance(x.months_late, x.partial_amount, x.prepaid_months, old.fee), new.fee)).*
              from owners x where x.association_id = new.id) s
     where o.id = s.id;
    perform set_config('watheq.src', prev, true);
  end if;
  return new;
end $$;
drop trigger if exists watheq_assoc_fee_resplit on public.associations;
create trigger watheq_assoc_fee_resplit after update of fee on public.associations
  for each row execute function public.watheq_assoc_fee_resplit();

-- رقم السند: R-00001 … R-99999 ثم يكمل بلا قصّ
create or replace function public.watheq_receipt_label(n int)
returns text language sql immutable as $$
  select 'R-' || case when n < 100000 then lpad(n::text, 5, '0') else n::text end;
$$;

-- ── ٤) تسجيل دفعة مالك (يستبدل v27/v59) ───────────────────────
drop function if exists public.watheq_record_owner_payment(uuid, numeric, text, text, uuid);
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

  fee := coalesce(assoc.fee, 0);
  if fee <= 0 then raise exception 'اشتراك الجمعية غير محدَّد'; end if;

  perform watheq_hoa_accrue_locked(assoc);                     -- الرصيد محدَّث قبل الحساب
  select * into o from owners where id = p_owner for update;
  select * into assoc from associations where id = o.association_id;

  bal := watheq_owner_balance(o.months_late, o.partial_amount, o.prepaid_months, fee);
  if p_amount is null then
    amt := greatest(0, -bal);
    if amt <= 0 then raise exception 'لا مستحقات على هذا المالك'; end if;
  else
    amt := round(p_amount, 2);
  end if;
  if amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if amt > fee * 120 then raise exception 'المبلغ أكبر من المعقول لهذه الجمعية — راجع الرقم'; end if;

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
                            'amount', amt, 'paid_on', d, 'receipt_no', watheq_receipt_label(rno));
end $$;
revoke all on function public.watheq_record_owner_payment(uuid, numeric, text, text, uuid, date, text, uuid) from public, anon;
grant execute on function public.watheq_record_owner_payment(uuid, numeric, text, text, uuid, date, text, uuid) to authenticated, service_role;

-- ── ٥) عكس دفعة مالك ──────────────────────────────────────────
create or replace function public.watheq_reverse_owner_payment(p_payment uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; o owners%rowtype; assoc associations%rowtype; office uuid; actor uuid;
        fee numeric; s record; pid uuid; newbal numeric;
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

  fee := coalesce(assoc.fee, 0);
  perform set_config('watheq.src', 'reversal', true);
  if pay.owner_id is not null and fee > 0 then
    perform watheq_hoa_accrue_locked(assoc);
    select * into o from owners where id = pay.owner_id for update;
    if found then
      s := watheq_owner_split(watheq_owner_balance(o.months_late, o.partial_amount, o.prepaid_months, fee) - pay.amount, fee);
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

  return jsonb_build_object('payment_id', pid, 'reversed', pay.amount, 'fund_balance', newbal,
    'months_late', s.late, 'partial_amount', s.partial, 'prepaid_months', s.prepaid);
end $$;
revoke all on function public.watheq_reverse_owner_payment(uuid, uuid) from public, anon;
grant execute on function public.watheq_reverse_owner_payment(uuid, uuid) to authenticated, service_role;

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
    if src in ('payment', 'reversal', 'accrual', 'fee_change') then return new; end if;   -- موثَّقة في الدفعات/الاستحقاق
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
drop trigger if exists watheq_hoa_audit_owner on public.owners;
create trigger watheq_hoa_audit_owner after insert or update or delete on public.owners
  for each row execute function public.watheq_hoa_audit_owner();

create or replace function public.watheq_hoa_audit_assoc()
returns trigger language plpgsql security definer set search_path = public as $$
declare src text := coalesce(nullif(current_setting('watheq.src', true), ''), 'manual');
begin
  if (old.fee, old.fund_balance, old.auto_accrue, old.name) is not distinct from
     (new.fee, new.fund_balance, new.auto_accrue, new.name) then return new; end if;
  -- حركة الصندوق من الدفعات موثَّقة في جدول الدفعات
  if src in ('payment', 'reversal') and (old.fee, old.auto_accrue, old.name)
     is not distinct from (new.fee, new.auto_accrue, new.name) then return new; end if;
  insert into hoa_audit (user_id, association_id, actor, source, action, before, after)
  values (new.user_id, new.id, auth.uid(), src, 'update',
          jsonb_build_object('name', old.name, 'fee', old.fee, 'fund_balance', old.fund_balance, 'auto_accrue', old.auto_accrue),
          jsonb_build_object('name', new.name, 'fee', new.fee, 'fund_balance', new.fund_balance, 'auto_accrue', new.auto_accrue));
  return new;
end $$;
drop trigger if exists watheq_hoa_audit_assoc on public.associations;
create trigger watheq_hoa_audit_assoc after update on public.associations
  for each row execute function public.watheq_hoa_audit_assoc();

-- ── ٧) الملكية لا تُنقل من الواجهة ───────────────────────────
create or replace function public.watheq_freeze_user_id()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id and auth.uid() is not null then
    raise exception 'لا يمكن نقل السجل إلى حساب آخر' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists watheq_freeze_user_id on public.associations;
create trigger watheq_freeze_user_id before update of user_id on public.associations
  for each row execute function public.watheq_freeze_user_id();
drop trigger if exists watheq_freeze_user_id on public.properties;
create trigger watheq_freeze_user_id before update of user_id on public.properties
  for each row execute function public.watheq_freeze_user_id();

-- ── ٨) الموازنة والدفعة تتبعان مكتب الجمعية ───────────────────
-- (30 سبتمبر 2026) نسخة الحارس المصحَّحة (كما في v60a/v62): النسخة الأولى كانت تقرأ
-- new.owner_id في جدول الموازنات فيفشل كل حفظ موازنة — لا تُعاد بإعادة تشغيل هذا الملف.
create or replace function public.watheq_guard_assoc_office()
returns trigger language plpgsql security definer set search_path = public as $$
declare aoff uuid; n_owner uuid; o_owner uuid;
begin
  if tg_table_name = 'payments' then
    n_owner := nullif(to_jsonb(new)->>'owner_id', '')::uuid;
    if tg_op = 'UPDATE' then o_owner := nullif(to_jsonb(old)->>'owner_id', '')::uuid; end if;
  end if;
  -- فكّ الروابط عند الحذف (set null) أو تعديل لا يغيّر الانتماء: لا فحص
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id
     and (new.association_id is null or new.association_id is not distinct from old.association_id)
     and (n_owner is null or n_owner is not distinct from o_owner) then
    return new;
  end if;
  if new.association_id is not null then
    select user_id into aoff from associations where id = new.association_id;
    if aoff is distinct from new.user_id then
      raise exception 'الجمعية لا تتبع هذا المكتب' using errcode = '42501';
    end if;
  end if;
  if n_owner is not null then
    if not exists (select 1 from owners o join associations a on a.id = o.association_id
                   where o.id = n_owner and a.user_id = new.user_id
                     and (new.association_id is null or o.association_id = new.association_id)) then
      raise exception 'المالك لا يتبع هذا المكتب' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists watheq_guard_assoc_office on public.association_budgets;
create trigger watheq_guard_assoc_office before insert or update of association_id, user_id on public.association_budgets
  for each row execute function public.watheq_guard_assoc_office();
drop trigger if exists watheq_guard_assoc_office on public.payments;
create trigger watheq_guard_assoc_office before insert or update of association_id, owner_id, user_id on public.payments
  for each row execute function public.watheq_guard_assoc_office();

-- ── ٩) تعديل رصيد المالك يدويًا: عبر دالة فقط، ومقارنة بما رآه المدير ──
-- (كتابة الرقم المطلق من شاشة قديمة كانت تمحو دفعة سُجّلت في الأثناء)
create or replace function public.watheq_owner_adjust(p_owner uuid, p_months int, p_expected_late int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o owners%rowtype; a associations%rowtype; s record;
begin
  select * into o from owners where id = p_owner;
  if not found then raise exception 'المالك غير موجود'; end if;
  select * into a from associations where id = o.association_id for update;
  if auth.uid() is null or not watheq_can_manage(a.user_id) then raise exception 'not authorized'; end if;
  if coalesce(a.fee, 0) <= 0 then raise exception 'حدّد قيمة الاشتراك أولًا'; end if;
  if p_months is null or p_months = 0 or abs(p_months) > 120 then raise exception 'تعديل غير صالح'; end if;
  perform watheq_hoa_accrue_locked(a);
  select * into o from owners where id = p_owner for update;
  if p_expected_late is not null and p_expected_late <> coalesce(o.months_late, 0) then
    raise exception 'تغيّرت بيانات المالك منذ فتحت الشاشة — حدّث الصفحة ثم أعد التعديل';
  end if;
  s := watheq_owner_split(watheq_owner_balance(o.months_late, o.partial_amount, o.prepaid_months, a.fee) - p_months * a.fee, a.fee);
  update owners set months_late = s.late, partial_amount = s.partial, prepaid_months = s.prepaid where id = p_owner;
  return jsonb_build_object('months_late', s.late, 'partial_amount', s.partial, 'prepaid_months', s.prepaid);
end $$;
revoke all on function public.watheq_owner_adjust(uuid, int, int) from public, anon;
grant execute on function public.watheq_owner_adjust(uuid, int, int) to authenticated;

-- أرقام الرصيد لا تُكتب مباشرة من الواجهة (الاسم والوحدة والجوال فقط)
revoke update on public.owners from authenticated;
grant update (name, unit, phone) on public.owners to authenticated;

-- تعديل الصندوق يدويًا: للمدير فقط (كان متاحًا لمن يسجّل الدفعات)
create or replace function public.watheq_adjust_fund(p_assoc uuid, p_delta numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; newbal numeric;
begin
  select * into a from associations where id = p_assoc for update;
  if not found then raise exception 'الجمعية غير موجودة'; end if;
  if auth.uid() is not null and not watheq_can_manage(a.user_id) then raise exception 'not authorized'; end if;
  newbal := round(coalesce(a.fund_balance, 0) + coalesce(p_delta, 0), 2);
  update associations set fund_balance = newbal where id = p_assoc;
  return newbal;
end $$;
revoke all on function public.watheq_adjust_fund(uuid, numeric) from public, anon;
grant execute on function public.watheq_adjust_fund(uuid, numeric) to authenticated, service_role;

-- دفعات الملاك لا تُحذف (العكس هو الطريق) — كان حذف سطر العكس يسمح بعكس الدفعة مرتين
drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments for delete
  using (watheq_perm(user_id, 'undo_actions') and association_id is null and owner_id is null);

-- السند بعد صدوره لا يتغيّر مبلغه ولا تاريخه ولا اسمه ولا مرجعه
create or replace function public.watheq_receipt_immutable()
returns trigger language plpgsql as $$
begin
  if old.receipt_no is not null and current_setting('watheq.sync', true) is distinct from '1'
     and (new.amount, new.paid_on, new.payer_name, new.unit_label, new.reference, new.receipt_no, new.method)
         is distinct from (old.amount, old.paid_on, old.payer_name, old.unit_label, old.reference, old.receipt_no, old.method) then
    raise exception 'سند القبض صدر ولا يُعدَّل — اعكس الدفعة وسجّلها من جديد';
  end if;
  return new;
end $$;
drop trigger if exists watheq_receipt_immutable on public.payments;
create trigger watheq_receipt_immutable before update on public.payments
  for each row execute function public.watheq_receipt_immutable();

commit;

-- ── فحص: صف واحد ──
select
  (select count(*) from public.associations where auto_accrue = false) as جمعيات_الاستحقاق_مطفأ,
  (select count(*) from public.associations where accrued_through is null) as بلا_تاريخ_استحقاق_يجب_0,
  to_regprocedure('public.watheq_record_owner_payment(uuid, numeric, text, text, uuid, date, text, uuid)') is not null as دالة_الدفع,
  to_regprocedure('public.watheq_record_owner_payment(uuid, numeric, text, text, uuid)') is null as القديمة_محذوفة,
  to_regprocedure('public.watheq_reverse_owner_payment(uuid, uuid)') is not null as دالة_العكس,
  (select confdeltype from pg_constraint where conrelid = 'public.payments'::regclass and contype = 'f'
     and confrelid = 'public.owners'::regclass limit 1) = 'n' as حذف_المالك_يبقي_الدفعات,
  (select count(distinct (trigger_name, event_object_table)) from information_schema.triggers where trigger_name in
     ('watheq_hoa_audit_owner','watheq_hoa_audit_assoc','watheq_freeze_user_id','watheq_guard_assoc_office',
      'watheq_assoc_protect','watheq_assoc_fee_resplit','watheq_receipt_immutable')) as المشغّلات_المتوقع_9,
  to_regprocedure('public.watheq_owner_adjust(uuid, int, int)') is not null as دالة_التعديل,
  public.watheq_today() as يوم_الرياض;
