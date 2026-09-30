-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v64: جولة المراجعة الثانية لاتحاد الملاك (30 سبتمبر 2026)
--
-- ١) منع جعل الاشتراك صفرًا وللملاك أرصدة (مشغّل + فحص في إعادة التسعير)،
--    والعكس برسم صفر يرفع خطأً صريحًا بدل التخطّي الصامت.
-- ٢) قيد شكل الرصيد على الملاك: متأخر ≥ 0، مقدَّم ≥ 0، جزئي ≥ 0، ولا متأخر ومقدَّم معًا.
--    يُضاف NOT VALID ثم يُتحقَّق منه فقط إن لم تخالفه صفوف قائمة (وإلا إشعار ويبقى للجديد).
-- ٣) الرصيد الافتتاحي (owners.opening_set): القائمون = true، والملاك الجدد = false
--    حتى يؤكد المدير متأخراتهم الافتتاحية (دالة watheq_owner_confirm_opening).
-- ٤) سجل المطالبات والتواصل ([تحصيل] / [تواصل]) لا يُحذف ولا يُعدَّل.
-- ٥) الجمعية التي لها دفعات أو مصروفات لا تُحذف — تُؤرشف (archived_at).
-- ٦) رقم تسجيل الجمعية في «ملاك» والرقم الموحّد، وإعداد النصاب حسب النظام الأساسي.
-- ٧) حذف الحساب: دالة لمفتاح الخدمة تحذف بيانات الجمعيات بالترتيب الصحيح.
-- ٨) البوابة: السند المعكوس يُفتح بختم «سند معكوس»، وجوال المكتب لإرسال الإيصال.
-- ٩) فهرس الدفعات حسب الجمعية والتاريخ، واستحقاق لمكتب واحد (للبوت).
-- ١٠) الجمعية المؤرشفة لا يُستحق عليها، والإرجاع يبدأ من الفترة الحالية؛ وسوم السجل لا تُزوَّر؛
--     والرصيد الافتتاحي يُؤكَّد مرة واحدة.
--
-- يتطلب schema-v63. آمن للتكرار. معاملة واحدة. لا يغيّر أي رقم قائم.
-- Supabase → SQL Editor → New query → الصق الملف → Run
--
-- ── فحص مسبق (اختياري، للقراءة فقط — شغّله وحده قبل الملف) ──
-- صفوف الملاك التي تخالف قيد شكل الرصيد (٢). إن ظهرت صفوف: يُطبَّق الملف ويبقى القيد
-- NOT VALID للجديد فقط حتى تُصحَّح، ثم أعد تشغيل الملف ليُتحقَّق منه.
--
-- select o.id, a.name as الجمعية, o.name as المالك, o.unit as الوحدة,
--        o.months_late, o.prepaid_months, o.partial_amount
--   from public.owners o join public.associations a on a.id = o.association_id
--  where not (coalesce(o.months_late, 0) >= 0 and coalesce(o.prepaid_months, 0) >= 0
--             and coalesce(o.partial_amount, 0) >= 0
--             and not (coalesce(o.months_late, 0) > 0 and coalesce(o.prepaid_months, 0) > 0))
--  order by a.name, o.unit;
-- ═══════════════════════════════════════════════════════════════════
begin;

do $$ begin
  if to_regprocedure('public.watheq_assoc_set_fee_plan(uuid, numeric, text, text, numeric, integer)') is null then
    raise exception 'شغّل schema-v63 أولًا';
  end if;
end $$;

-- ── ١) الأعمدة ─────────────────────────────────────────────────
alter table public.associations add column if not exists archived_at timestamptz;
alter table public.associations add column if not exists mullak_reg_no text;
alter table public.associations add column if not exists unified_no text;
alter table public.associations add column if not exists quorum_first_pct numeric(5,2) not null default 75;
alter table public.associations add column if not exists quorum_second_pct numeric(5,2);   -- null = يصح بأي عدد
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'owners' and column_name = 'opening_set') then
    alter table public.owners add column opening_set boolean not null default true;   -- القائمون: مؤكَّدون
  end if;
end $$;
alter table public.owners alter column opening_set set default false;                  -- الجدد: بانتظار التأكيد
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'associations_regno_chk') then
    alter table public.associations add constraint associations_regno_chk
      check ((mullak_reg_no is null or char_length(mullak_reg_no) <= 40) and (unified_no is null or char_length(unified_no) <= 40));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'associations_quorum_chk') then
    alter table public.associations add constraint associations_quorum_chk
      check (quorum_first_pct > 0 and quorum_first_pct <= 100 and (quorum_second_pct is null or (quorum_second_pct > 0 and quorum_second_pct <= 100)));
  end if;
end $$;
create index if not exists payments_assoc_paid_idx on public.payments (association_id, paid_on) where association_id is not null;

-- ── ٢) قيد شكل الرصيد ─────────────────────────────────────────
do $$
declare bad int;
begin
  if not exists (select 1 from pg_constraint where conname = 'owners_balance_shape_chk') then
    alter table public.owners add constraint owners_balance_shape_chk check (
      coalesce(months_late, 0) >= 0 and coalesce(prepaid_months, 0) >= 0 and coalesce(partial_amount, 0) >= 0
      and not (coalesce(months_late, 0) > 0 and coalesce(prepaid_months, 0) > 0)) not valid;
  end if;
  if exists (select 1 from pg_constraint where conname = 'owners_balance_shape_chk' and not convalidated) then
    select count(*) into bad from public.owners
     where not (coalesce(months_late, 0) >= 0 and coalesce(prepaid_months, 0) >= 0 and coalesce(partial_amount, 0) >= 0
                and not (coalesce(months_late, 0) > 0 and coalesce(prepaid_months, 0) > 0));
    if bad = 0 then
      alter table public.owners validate constraint owners_balance_shape_chk;
    else
      raise notice 'قيد شكل الرصيد: % صف قائم يخالفه — بقي القيد للجديد فقط (NOT VALID). راجع هذه الصفوف ثم أعد تشغيل الملف.', bad;
    end if;
  end if;
end $$;

-- ── ٣) الاشتراك صفرًا وللملاك أرصدة ───────────────────────────
create or replace function public.watheq_assoc_fee_zero_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.fee, 0) <= 0 and coalesce(old.fee, 0) > 0
     and exists (select 1 from owners o where o.association_id = new.id and o.fee_override is null
                  and (coalesce(o.months_late, 0) > 0 or coalesce(o.prepaid_months, 0) > 0 or coalesce(o.partial_amount, 0) <> 0)) then
    raise exception 'لا يمكن جعل الاشتراك صفرًا وللملاك أرصدة قائمة — سوِّ الأرصدة أولًا أو أبقِ قيمة الاشتراك';
  end if;
  return new;
end $$;
drop trigger if exists watheq_assoc_fee_zero_guard on public.associations;
create trigger watheq_assoc_fee_zero_guard before update of fee on public.associations
  for each row execute function public.watheq_assoc_fee_zero_guard();


-- ── ٤) حارس الأعمدة (يستبدل v63): + الأرشفة ─────────────────────
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
      new.archived_at := null;
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
    new.archived_at := old.archived_at;          -- v64: الأرشفة بدالة المدير
  end if;
  if new.auto_accrue and not coalesce(old.auto_accrue, false) then
    new.accrued_through := watheq_hoa_period_start(new.fee_period, new.fiscal_start_month, t);
  end if;
  return new;
end $$;

-- الملاك الجدد من الواجهة: بلا رسم خاص، ورصيدهم الافتتاحي بانتظار التأكيد
create or replace function public.watheq_owner_protect()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and coalesce(nullif(current_setting('watheq.src', true), ''), 'manual') = 'manual' then
    new.fee_override := null;
    new.opening_set := false;
  end if;
  return new;
end $$;

-- ── ٥) العكس وإعادة التسعير (تستبدلان v63) ────────────────────
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
    -- v64: رسم صفر مع مالك موجود ⇒ خطأ صريح (كان يُتخطّى فيبقى الرصيد بعد سحب المبلغ من الصندوق)
    if found and fee <= 0 then
      raise exception 'رسم هذا المالك صفر — حدّد قيمة الاشتراك قبل عكس الدفعة';
    end if;
    if found then
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

  -- v64: اشتراك صفر بأساس متساوٍ والملاك عليهم/لهم أرصدة ⇒ تضيع الأرصدة (لا تقسيم على صفر)
  if p_basis = 'equal' and v_fee <= 0 and exists (select 1 from owners where association_id = a.id
       and (coalesce(months_late, 0) > 0 or coalesce(prepaid_months, 0) > 0 or coalesce(partial_amount, 0) <> 0)) then
    raise exception 'لا يمكن جعل الاشتراك صفرًا وللملاك أرصدة قائمة — سوِّ الأرصدة أولًا أو أبقِ قيمة الاشتراك';
  end if;
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

-- ── ٦) الرصيد الافتتاحي ──────────────────────────────────────
-- المدير يؤكد متأخرات المالك الافتتاحية (0 = لا متأخرات) — مرة لكل مالك جديد
create or replace function public.watheq_owner_confirm_opening(p_owner uuid, p_months int default 0, p_expected_late int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o owners%rowtype; office uuid; r jsonb := '{}'::jsonb; src0 text := coalesce(current_setting('watheq.src', true), '');
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into o from owners where id = p_owner;
  if not found then raise exception 'المالك غير موجود'; end if;
  select user_id into office from associations where id = o.association_id;
  if office is null or not watheq_can_manage(office) then raise exception 'not authorized'; end if;
  if coalesce(o.opening_set, true) then raise exception 'الرصيد الافتتاحي مؤكَّد سابقًا — استعمل التعديل'; end if;
  if p_months is null or p_months < 0 or p_months > 120 then raise exception 'المتأخرات الافتتاحية بين 0 و120 فترة'; end if;
  if p_months > 0 then
    r := watheq_owner_adjust(p_owner, p_months, p_expected_late);   -- نفس مسار التعديل الموثَّق
  end if;
  perform set_config('watheq.src', 'opening', true);
  update owners set opening_set = true where id = p_owner;
  perform set_config('watheq.src', src0, true);
  insert into hoa_audit (user_id, association_id, owner_id, actor, source, action, after)
  values (office, o.association_id, o.id, auth.uid(), 'opening', 'confirm_opening', jsonb_build_object('months', p_months));
  select jsonb_build_object('id', x.id, 'opening_set', x.opening_set, 'months_late', x.months_late,
                            'partial_amount', x.partial_amount, 'prepaid_months', x.prepaid_months)
    into r from owners x where x.id = p_owner;
  return r;
end $$;
revoke all on function public.watheq_owner_confirm_opening(uuid, int, int) from public, anon;
grant execute on function public.watheq_owner_confirm_opening(uuid, int, int) to authenticated;
-- opening_set لا يُكتب مباشرة: خارج منحة الأعمدة (name, unit, phone)
revoke update on public.owners from authenticated;
grant update (name, unit, phone) on public.owners to authenticated;

-- ── ٧) سجل المطالبات والتواصل لا يُحذف ولا يُعدَّل ─────────────
drop policy if exists assocnotes_del on public.association_notes;
create policy assocnotes_del on public.association_notes for delete using (
  exists (select 1 from associations a where a.id = association_notes.association_id and watheq_perm(a.user_id, 'undo_actions'))
  and not (coalesce(association_notes.text, '') ~ '^\s*[\[［]\s*(تحصيل|تواصل)'));
drop policy if exists assocnotes_upd on public.association_notes;
create policy assocnotes_upd on public.association_notes for update using (
  exists (select 1 from associations a where a.id = association_notes.association_id and watheq_perm(a.user_id, 'add_notes'))
  and not (coalesce(association_notes.text, '') ~ '^\s*[\[［]\s*(تحصيل|تواصل)'))
  with check (
  exists (select 1 from associations a where a.id = association_notes.association_id and watheq_perm(a.user_id, 'add_notes')));


-- ── ٧ب) وسوم السجل لا تُزوَّر (N2) ──────────────────────────────
-- النص الموسوم [تحصيل]/[تواصل] (ولو بقوس عريض ［ أو مسافة قبله): لا يُعدَّل أبدًا، ولا يُحوَّل
-- إليه نص عادي بالتعديل، وتاريخه عند الإدراج تاريخ اليوم (الرياض) لا ما يرسله العميل.
create or replace function public.watheq_assoc_note_tag_guard()
returns trigger language plpgsql as $$
declare tag text := '^\s*[\[［]\s*(تحصيل|تواصل)';
begin
  if tg_op = 'UPDATE' then
    if coalesce(new.text, '') ~ tag or coalesce(old.text, '') ~ tag then
      raise exception 'سجل التحصيل لا يُعدَّل' using errcode = '42501';
    end if;
    return new;
  end if;
  if coalesce(new.text, '') ~ tag then new.note_date := watheq_today(); end if;
  return new;
end $$;
drop trigger if exists watheq_assoc_note_tag_guard on public.association_notes;
create trigger watheq_assoc_note_tag_guard before insert or update on public.association_notes
  for each row execute function public.watheq_assoc_note_tag_guard();

-- ── ٨) الأرشفة بدل الحذف ─────────────────────────────────────
create or replace function public.watheq_assoc_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('watheq.purge', true) = '1' and auth.uid() is null then return old; end if;   -- حذف الحساب (مفتاح الخدمة)
  if exists (select 1 from payments where association_id = old.id)
     or exists (select 1 from association_expenses where association_id = old.id) then
    raise exception 'لا يمكن حذف جمعية لها دفعات أو مصروفات مسجّلة — أرشفها بدل الحذف (يبقى سجلها المالي محفوظًا)'
      using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists watheq_assoc_delete_guard on public.associations;
create trigger watheq_assoc_delete_guard before delete on public.associations
  for each row execute function public.watheq_assoc_delete_guard();

create or replace function public.watheq_assoc_archive(p_assoc uuid, p_archive boolean default true)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; src0 text := coalesce(current_setting('watheq.src', true), ''); v timestamptz;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into a from associations where id = p_assoc for update;
  if not found or not watheq_can_manage(a.user_id) then raise exception 'not authorized'; end if;
  v := case when coalesce(p_archive, true) then coalesce(a.archived_at, now()) end;
  perform set_config('watheq.src', 'archive', true);
  -- الإرجاع من الأرشيف يبدأ الاستحقاق من الفترة الحالية — لا تُستحق فترات الأرشفة بأثر رجعي
  update associations set archived_at = v,
         accrued_through = case when v is null and a.archived_at is not null then watheq_hoa_cur_period(a) else accrued_through end
   where id = a.id;
  perform set_config('watheq.src', src0, true);
  insert into hoa_audit (user_id, association_id, actor, source, action)
  values (a.user_id, a.id, auth.uid(), 'archive', case when v is null then 'unarchive' else 'archive' end);
  return v;
end $$;
revoke all on function public.watheq_assoc_archive(uuid, boolean) from public, anon;
grant execute on function public.watheq_assoc_archive(uuid, boolean) to authenticated;

-- الإلحاقيّان (v61/v62) يسمحان بالحذف فقط داخل حذف الحساب (دالة مفتاح الخدمة أدناه)
create or replace function public.watheq_hoa_sig_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.association_id, new.document_id, new.owner_name, new.unit, new.decision,
        new.typed_name, new.comment, new.doc_sha256, new.signed_at, new.ip, new.user_agent)
       is distinct from
       (old.id, old.user_id, old.association_id, old.document_id, old.owner_name, old.unit, old.decision,
        old.typed_name, old.comment, old.doc_sha256, old.signed_at, old.ip, old.user_agent)
       or (new.owner_id is distinct from old.owner_id and new.owner_id is not null)
       or (new.link_id  is distinct from old.link_id  and new.link_id  is not null) then
      raise exception 'القرار المسجَّل لا يُعدَّل' using errcode = '42501';
    end if;
    return new;
  end if;
  if current_setting('watheq.purge', true) = '1' and auth.uid() is null then return old; end if;
  if exists (select 1 from public.hoa_documents d where d.id = old.document_id) then
    raise exception 'القرار المسجَّل لا يُحذف' using errcode = '42501';
  end if;
  return old;
end $$;

create or replace function public.watheq_assoc_expense_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'سند الصرف صدر ولا يُعدَّل — اعكسه وسجّله من جديد' using errcode = '42501';
  end if;
  if current_setting('watheq.purge', true) = '1' and auth.uid() is null then return old; end if;
  if exists (select 1 from public.associations a where a.id = old.association_id) then
    raise exception 'سند الصرف لا يُحذف — اعكسه بدل الحذف' using errcode = '42501';
  end if;
  return old;
end $$;

-- ── ٩) حذف الحساب: بيانات الجمعيات بالترتيب (مفتاح الخدمة فقط) ─────
-- الترتيب: القرارات (تمنع حذفها مشغّلاتها ما دام المستند قائمًا) ← المستندات ← الروابط
-- ← المصروفات (إلحاقية) ← الدفعات ← الملاك والملاحظات والموازنات ← الجمعيات ← التدقيق (حذف الملاك يكتب فيه).
create or replace function public.watheq_purge_office_hoa(p_office uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_sig int; n_doc int; n_link int; n_exp int; n_pay int; n_aud int; n_assoc int;
begin
  if p_office is null then raise exception 'office required'; end if;
  if auth.uid() is not null then raise exception 'not authorized'; end if;
  perform set_config('watheq.purge', '1', true);
  delete from hoa_signatures where user_id = p_office; get diagnostics n_sig = row_count;
  delete from hoa_documents where user_id = p_office; get diagnostics n_doc = row_count;
  delete from hoa_member_links where user_id = p_office; get diagnostics n_link = row_count;
  delete from association_expenses where user_id = p_office and reverses is not null;
  delete from association_expenses where user_id = p_office; get diagnostics n_exp = row_count;
  delete from payments where user_id = p_office and association_id is not null and reverses is not null;
  delete from payments where user_id = p_office and association_id is not null; get diagnostics n_pay = row_count;
  delete from owners where association_id in (select id from associations where user_id = p_office);
  delete from association_notes where association_id in (select id from associations where user_id = p_office);
  delete from association_budgets where user_id = p_office;
  delete from associations where user_id = p_office; get diagnostics n_assoc = row_count;
  -- التدقيق أخيرًا: حذف الملاك أعلاه يكتب سطور تدقيق (مشغّل v60)
  delete from hoa_audit where user_id = p_office; get diagnostics n_aud = row_count;
  perform set_config('watheq.purge', '', true);
  return jsonb_build_object('signatures', n_sig, 'documents', n_doc, 'links', n_link, 'expenses', n_exp,
                            'payments', n_pay, 'audit', n_aud, 'associations', n_assoc);
end $$;
revoke all on function public.watheq_purge_office_hoa(uuid) from public, anon, authenticated;
grant execute on function public.watheq_purge_office_hoa(uuid) to service_role;

-- ── ٩ب) الاستحقاق يتخطّى الجمعيات المؤرشفة (تستبدل v63) ─────────
create or replace function public.watheq_hoa_accrue_locked(a public.associations)
returns int language plpgsql security definer set search_path = public as $$
declare cur date := watheq_hoa_cur_period(a); n int; n0 int;
        prev text := coalesce(current_setting('watheq.src', true), '');
begin
  -- v64: الجمعية المؤرشفة لا يُستحق عليها شيء ولا يتقدّم تاريخها (الإرجاع يعيد ضبطه)
  if a.archived_at is not null then return 0; end if;
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
            where watheq_can_read(x.user_id) and x.archived_at is null
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
            where x.archived_at is null and x.accrued_through < watheq_hoa_period_start(x.fee_period, x.fiscal_start_month, watheq_today())
            order by x.id
            for update
  loop
    total := total + watheq_hoa_accrue_locked(a);
  end loop;
  return total;
end $$;
revoke all on function public.watheq_hoa_accrue_all() from public, anon, authenticated;
grant execute on function public.watheq_hoa_accrue_all() to service_role;

create or replace function public.watheq_hoa_building(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a associations%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into a from associations where public_token = p_token;
  if not found then return null; end if;
  if a.archived_at is null and (a.accrued_through is null or a.accrued_through < watheq_hoa_cur_period(a)) then
    select * into a from associations where id = a.id for update;
    perform watheq_hoa_accrue_locked(a);
  end if;
  return watheq_hoa_building_data(a.id)
      || jsonb_build_object('office', (select jsonb_build_object('org_name', p.org_name) from profiles p where p.id = a.user_id));
end $$;
revoke all on function public.watheq_hoa_building(text) from public, anon, authenticated;
grant execute on function public.watheq_hoa_building(text) to service_role;

-- ── ١٠) استحقاق مكتب واحد (للبوت، مفتاح الخدمة) ─────────────────
create or replace function public.watheq_hoa_accrue_office(p_office uuid)
returns int language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; total int := 0;
begin
  for a in select * from associations x
            where x.user_id = p_office and x.archived_at is null
              and x.accrued_through < watheq_hoa_period_start(x.fee_period, x.fiscal_start_month, watheq_today())
            order by x.id for update
  loop
    total := total + watheq_hoa_accrue_locked(a);
  end loop;
  return total;
end $$;
revoke all on function public.watheq_hoa_accrue_office(uuid) from public, anon, authenticated;
grant execute on function public.watheq_hoa_accrue_office(uuid) to service_role;

-- ── ١١) البوابة (تستبدل v63) ──────────────────────────────────
create or replace function public.watheq_hoa_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l hoa_member_links%rowtype; a associations%rowtype; o owners%rowtype; res jsonb;
begin
  l := watheq_hoa_link_resolve(p_token);
  if l.id is null then return null; end if;

  select * into a from associations where id = l.association_id;
  if a.archived_at is null and (a.accrued_through is null or a.accrued_through < watheq_hoa_cur_period(a)) then
    select * into a from associations where id = l.association_id for update;
    perform watheq_hoa_accrue_locked(a);
  end if;
  select * into a from associations where id = l.association_id;
  select * into o from owners where id = l.owner_id;

  update hoa_member_links set last_seen_at = now() where id = l.id;

  select jsonb_build_object(
    'association', jsonb_build_object('name', a.name, 'fee', coalesce(o.fee_override, a.fee, 0),
                   'fee_period', coalesce(a.fee_period, 'monthly'), 'fee_basis', coalesce(a.fee_basis, 'equal'),
                   'mullak_reg_no', a.mullak_reg_no, 'unified_no', a.unified_no,
                   'bank_name', a.bank_name, 'bank_account_name', a.bank_account_name, 'iban', a.iban),
    'office', (select jsonb_build_object('org_name', p.org_name, 'billing_name', p.billing_name, 'billing_phone', p.billing_phone)
                 from profiles p where p.id = l.user_id),
    'owner', jsonb_build_object('name', o.name, 'unit', o.unit,
               'months_late', coalesce(o.months_late, 0), 'partial_amount', coalesce(o.partial_amount, 0),
               'prepaid_months', coalesce(o.prepaid_months, 0), 'last_paid', o.last_paid,
               'fee', coalesce(o.fee_override, a.fee, 0), 'share_pct', o.share_pct,
               'opening_set', coalesce(o.opening_set, true)),
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
    -- v64: الدفعات المعكوسة (لفتح سندها برابط مباشر مع ختم «سند معكوس») — القائمة تبقى صافية
    'reversed_payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'paid_on', p.paid_on, 'amount', p.amount,
               'method', p.method, 'reference', p.reference, 'periods_covered', p.periods_covered,
               'receipt_no', p.receipt_no, 'payer_name', p.payer_name, 'unit_label', p.unit_label,
               'reversed_on', (select (r.created_at at time zone 'Asia/Riyadh')::date from payments r where r.reverses = p.id limit 1)))
        from payments p
       where p.owner_id = l.owner_id and p.association_id = l.association_id and p.user_id = l.user_id
         and p.amount > 0 and p.reverses is null
         and exists (select 1 from payments r where r.reverses = p.id)), '[]'::jsonb),
    'building', watheq_hoa_building_data(l.association_id)
  ) into res;
  return res;
end $$;
revoke all on function public.watheq_hoa_portal(text) from public, anon, authenticated;
grant execute on function public.watheq_hoa_portal(text) to service_role;

commit;

-- ── فحص: صف واحد ──
select
  (select count(*) from pg_trigger where tgname in ('watheq_assoc_fee_zero_guard', 'watheq_assoc_delete_guard') and not tgisinternal) as مشغّلات_جديدة_المتوقع_2,
  (select convalidated from pg_constraint where conname = 'owners_balance_shape_chk') as قيد_الرصيد_مُتحقَّق,
  (select count(*) from public.owners where not coalesce(opening_set, true)) as ملاك_بانتظار_الرصيد_الافتتاحي,
  has_column_privilege('authenticated', 'public.owners', 'opening_set', 'update') as كتابة_الافتتاحي_يجب_false,
  has_function_privilege('authenticated', 'public.watheq_purge_office_hoa(uuid)', 'execute') as حذف_المكتب_لـauthenticated_يجب_false,
  (select count(*) from public.associations where archived_at is not null) as جمعيات_مؤرشفة,
  to_regclass('public.payments_assoc_paid_idx') is not null as فهرس_الدفعات;
