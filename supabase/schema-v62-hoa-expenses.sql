-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v62: مصروفات العمارة وشفافية الصندوق (30 سبتمبر 2026)
--
-- ١) association_expenses — سجل مصروفات الجمعية، إلحاقي فقط:
--    • كل مصروف يُنقص رصيد الصندوق في المعاملة نفسها (قفل صف الجمعية).
--    • سند صرف مرقَّم تسلسليًا لكل جمعية بلا فجوات: S-00001 (expense_counter).
--    • التصحيح = سطر عكس (مبلغ سالب يشير للأصل) لا تعديل ولا حذف — كالدفعات.
--    • الصندوق لا ينزل تحت الصفر إلا بقرار صريح (p_allow_negative):
--      «مصروف دفعه المدير مقدّمًا» ويُوسم السطر overdraft = true.
--    • الكتابة عبر دالتين فقط: watheq_record_assoc_expense (المدير)
--      و watheq_reverse_assoc_expense (صلاحية التراجع). القراءة لموظفي المكتب.
-- ٢) رابط شفافية العمارة (associations.public_token): صفحة عامة /b/<رمز>
--    بأرقام مجمَّعة فقط — الصندوق، المحصَّل، المصروفات حسب البند، نسبة السداد.
--    لا أسماء ملاك ولا من تأخر (نظام حماية البيانات الشخصية + خطر التشهير).
--    الدالة العامة watheq_hoa_building لمفتاح الخدمة وحده، تُستدعى من خادم Next.
-- ٣) البوابة (watheq_hoa_portal) تحمل الأرقام المجمَّعة نفسها للمالك.
-- ٤) سجل التدقيق لا يوثّق حركة الصندوق من المصروفات كـ«يدوي» (مصدرها السند).
-- ٥) إصلاح عاجل: حفظ «الموازنة» كان يفشل منذ v60 (حارس المكتب يقرأ عمودًا
--    غير موجود في جدول الموازنات). الحارس الآن يفحص المالك للدفعات فقط.
--
-- يتطلب schema-v60 و schema-v61. آمن للتكرار. معاملة واحدة.
-- لا يغيّر أي رقم لمالك أو جمعية قائمة.
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════
begin;

do $$ begin
  if to_regprocedure('public.watheq_hoa_portal(text)') is null
     or to_regprocedure('public.watheq_hoa_accrue_locked(public.associations)') is null then
    raise exception 'شغّل schema-v60 ثم schema-v61 أولًا';
  end if;
  -- حارس إعادة التشغيل: بعد v63 كانت إعادة هذا الملف تُرجع دوال المال إلى نسختها الأقدم
  if to_regprocedure('public.watheq_assoc_set_fee_plan(uuid, numeric, text, text, numeric, integer)') is not null then
    raise exception 'نسخة أحدث مطبَّقة — لا تُعِد تشغيل هذا الملف';
  end if;
end $$;

-- ── ١) أعمدة الجمعية ───────────────────────────────────────────
alter table public.associations add column if not exists expense_counter int not null default 0;
alter table public.associations add column if not exists public_token text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'associations_public_token_chk') then
    alter table public.associations add constraint associations_public_token_chk
      check (public_token is null or public_token ~ '^[0-9a-f]{64}$');
  end if;
end $$;
create unique index if not exists associations_public_token_once
  on public.associations (public_token) where public_token is not null;

-- ── ٢) جدول المصروفات ─────────────────────────────────────────
create table if not exists public.association_expenses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  association_id uuid not null references public.associations(id) on delete cascade,
  spent_on       date not null,
  category       text not null check (category in
                   ('maintenance','cleaning','security','elevators','utilities','management','insurance','admin','other')),
  description    text not null check (char_length(btrim(description)) between 1 and 300),
  amount         numeric(14,2) not null,
  vendor         text check (vendor is null or char_length(vendor) <= 120),
  reference      text check (reference is null or char_length(reference) <= 80),
  voucher_no     text,
  overdraft      boolean not null default false,
  request_id     uuid,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  reverses       uuid references public.association_expenses(id),
  -- الأصل موجب وله سند؛ سطر العكس سالب ويشير إلى أصله
  constraint association_expenses_shape_chk check (
    (reverses is null and amount > 0 and voucher_no is not null)
    or (reverses is not null and amount < 0))
);
create unique index if not exists association_expenses_voucher_once
  on public.association_expenses (association_id, voucher_no) where voucher_no is not null;
create unique index if not exists association_expenses_reverse_once
  on public.association_expenses (reverses) where reverses is not null;
create unique index if not exists association_expenses_request_once
  on public.association_expenses (request_id) where request_id is not null;
create index if not exists association_expenses_assoc_idx
  on public.association_expenses (association_id, spent_on desc, created_at desc);

-- رقم سند الصرف: S-00001 … S-99999 ثم يكمل بلا قصّ
create or replace function public.watheq_voucher_label(n int)
returns text language sql immutable as $$
  select 'S-' || case when n < 100000 then lpad(n::text, 5, '0') else n::text end;
$$;

-- إلحاقي فقط: لا تعديل، ولا حذف إلا حين تُحذف الجمعية نفسها (بالتسلسل)
create or replace function public.watheq_assoc_expense_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'سند الصرف صدر ولا يُعدَّل — اعكسه وسجّله من جديد' using errcode = '42501';
  end if;
  if exists (select 1 from public.associations a where a.id = old.association_id) then
    raise exception 'سند الصرف لا يُحذف — اعكسه بدل الحذف' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists watheq_assoc_expense_append_only on public.association_expenses;
create trigger watheq_assoc_expense_append_only before update or delete on public.association_expenses
  for each row execute function public.watheq_assoc_expense_append_only();

-- حارس «السجل يتبع مكتب جمعيته» (يستبدل v60).
-- إصلاح: نسخة v60 تقرأ new.owner_id في كل الجداول، وجدول الموازنات
-- (association_budgets) لا يحوي هذا العمود ⇒ كان كل حفظ للموازنة يفشل بخطأ
-- «record "new" has no field "owner_id"». الآن يُقرأ المالك للدفعات فقط.
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

-- المصروف يتبع مكتب جمعيته (الحارس نفسه)
drop trigger if exists watheq_guard_assoc_office on public.association_expenses;
create trigger watheq_guard_assoc_office before insert or update of association_id, user_id on public.association_expenses
  for each row execute function public.watheq_guard_assoc_office();

alter table public.association_expenses enable row level security;
drop policy if exists association_expenses_read on public.association_expenses;
create policy association_expenses_read on public.association_expenses for select
  using (watheq_can_read(user_id));
revoke all on public.association_expenses from public, anon, authenticated;
grant select on public.association_expenses to authenticated, service_role;

-- ── ٣) حارس أعمدة الجمعية الداخلية (يستبدل v60) ─────────────────
-- + عدّاد سندات الصرف ورمز رابط الشفافية: لا يُكتبان من الواجهة
create or replace function public.watheq_assoc_protect()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.receipt_counter := 0;
      new.expense_counter := 0;
      new.public_token := null;
      new.accrued_through := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
    end if;
    return new;
  end if;
  if coalesce(nullif(current_setting('watheq.src', true), ''), 'manual') = 'manual' and auth.uid() is not null then
    new.receipt_counter := old.receipt_counter;
    new.accrued_through := old.accrued_through;
    new.expense_counter := old.expense_counter;
    new.public_token := old.public_token;
  end if;
  if new.auto_accrue and not coalesce(old.auto_accrue, false) then
    new.accrued_through := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
  end if;
  return new;
end $$;

-- سجل التدقيق: حركة الصندوق من المصروفات موثَّقة في جدول المصروفات (يستبدل v60)
create or replace function public.watheq_hoa_audit_assoc()
returns trigger language plpgsql security definer set search_path = public as $$
declare src text := coalesce(nullif(current_setting('watheq.src', true), ''), 'manual');
begin
  if (old.fee, old.fund_balance, old.auto_accrue, old.name) is not distinct from
     (new.fee, new.fund_balance, new.auto_accrue, new.name) then return new; end if;
  -- حركة الصندوق من الدفعات والمصروفات موثَّقة في جدوليهما
  if src in ('payment', 'reversal', 'expense') and (old.fee, old.auto_accrue, old.name)
     is not distinct from (new.fee, new.auto_accrue, new.name) then return new; end if;
  insert into hoa_audit (user_id, association_id, actor, source, action, before, after)
  values (new.user_id, new.id, auth.uid(), src, 'update',
          jsonb_build_object('name', old.name, 'fee', old.fee, 'fund_balance', old.fund_balance, 'auto_accrue', old.auto_accrue),
          jsonb_build_object('name', new.name, 'fee', new.fee, 'fund_balance', new.fund_balance, 'auto_accrue', new.auto_accrue));
  return new;
end $$;

-- ── ٤) تسجيل مصروف ────────────────────────────────────────────
create or replace function public.watheq_record_assoc_expense(
  p_assoc uuid, p_amount numeric, p_category text, p_description text,
  p_spent_on date default null, p_vendor text default null, p_reference text default null,
  p_allow_negative boolean default false, p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; prev association_expenses%rowtype; amt numeric; d date; newbal numeric;
        n int; eid uuid; src0 text := coalesce(current_setting('watheq.src', true), '');
        descr text := btrim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g'));
        vend text := nullif(btrim(regexp_replace(coalesce(p_vendor, ''), '\s+', ' ', 'g')), '');
        ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into a from associations where id = p_assoc for update;
  if not found then raise exception 'الجمعية غير موجودة'; end if;
  if not watheq_can_manage(a.user_id) then raise exception 'not authorized'; end if;

  -- الضغطة الثانية (أو إعادة الإرسال بعد انقطاع) تُرجع الأولى
  if p_request is not null then
    select * into prev from association_expenses where request_id = p_request;
    if found then
      if prev.association_id is distinct from p_assoc then raise exception 'طلب مكرر لعملية أخرى'; end if;
      return jsonb_build_object('duplicate', true, 'expense_id', prev.id, 'voucher_no', prev.voucher_no,
        'amount', prev.amount, 'spent_on', prev.spent_on, 'fund_balance', a.fund_balance, 'overdraft', prev.overdraft);
    end if;
  end if;

  amt := round(coalesce(p_amount, 0), 2);
  if amt <= 0 then raise exception 'مبلغ المصروف يجب أن يكون أكبر من صفر'; end if;
  if amt > 100000000 then raise exception 'المبلغ أكبر من المعقول — راجع الرقم'; end if;
  if p_category is null or p_category not in
     ('maintenance','cleaning','security','elevators','utilities','management','insurance','admin','other') then
    raise exception 'بند المصروف غير معروف';
  end if;
  if char_length(descr) not between 1 and 300 then raise exception 'اكتب بيان المصروف (300 حرف كحد أقصى)'; end if;
  if vend is not null and char_length(vend) > 120 then raise exception 'اسم المورّد أطول من المسموح'; end if;
  if ref is not null and char_length(ref) > 80 then raise exception 'رقم المرجع أطول من المسموح'; end if;
  d := coalesce(p_spent_on, watheq_today());
  if d > watheq_today() or d < date '2000-01-01' then
    raise exception 'تاريخ المصروف غير صالح — لا يكون بعد اليوم';
  end if;

  newbal := round(coalesce(a.fund_balance, 0) - amt, 2);
  if newbal < 0 and not coalesce(p_allow_negative, false) then
    raise exception 'رصيد الصندوق (% ريال) لا يكفي لمصروف بمبلغ % ريال. إن دفعه المدير من ماله مقدّمًا فاختر «تسجيل بالسالب».',
      round(coalesce(a.fund_balance, 0), 2), amt;
  end if;

  perform set_config('watheq.src', 'expense', true);
  update associations set fund_balance = newbal, expense_counter = expense_counter + 1
   where id = a.id returning expense_counter into n;
  perform set_config('watheq.src', src0, true);

  insert into association_expenses (user_id, association_id, spent_on, category, description, amount,
                                    vendor, reference, voucher_no, overdraft, request_id, created_by)
  values (a.user_id, a.id, d, p_category, descr, amt, vend, ref, watheq_voucher_label(n),
          newbal < 0, p_request, auth.uid())
  returning id into eid;

  return jsonb_build_object('expense_id', eid, 'voucher_no', watheq_voucher_label(n), 'amount', amt,
                            'spent_on', d, 'fund_balance', newbal, 'overdraft', newbal < 0);
end $$;
revoke all on function public.watheq_record_assoc_expense(uuid, numeric, text, text, date, text, text, boolean, uuid) from public, anon;
grant execute on function public.watheq_record_assoc_expense(uuid, numeric, text, text, date, text, text, boolean, uuid) to authenticated;

-- ── ٥) عكس مصروف (سطر سالب يعيد المبلغ للصندوق) ────────────────
create or replace function public.watheq_reverse_assoc_expense(p_expense uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e association_expenses%rowtype; a associations%rowtype; newbal numeric; rid uuid;
        src0 text := coalesce(current_setting('watheq.src', true), '');
        note text := nullif(btrim(left(coalesce(p_note, ''), 200)), '');
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into e from association_expenses where id = p_expense;
  if not found then raise exception 'المصروف غير موجود'; end if;
  select * into a from associations where id = e.association_id for update;
  if not found or not watheq_perm(a.user_id, 'undo_actions') then raise exception 'not authorized'; end if;
  if e.reverses is not null or e.amount <= 0 then raise exception 'هذا سطر عكس — لا يُعكس'; end if;
  if exists (select 1 from association_expenses where reverses = e.id) then raise exception 'عُكس هذا المصروف من قبل'; end if;

  newbal := round(coalesce(a.fund_balance, 0) + e.amount, 2);
  perform set_config('watheq.src', 'expense', true);
  update associations set fund_balance = newbal where id = a.id;
  perform set_config('watheq.src', src0, true);

  insert into association_expenses (user_id, association_id, spent_on, category, description, amount,
                                    reverses, created_by)
  values (a.user_id, a.id, e.spent_on, e.category,
          left('عكس سند ' || e.voucher_no || coalesce(' — ' || note, ''), 300), -e.amount, e.id, auth.uid())
  returning id into rid;

  return jsonb_build_object('expense_id', rid, 'reversed', e.amount, 'voucher_no', e.voucher_no, 'fund_balance', newbal);
end $$;
revoke all on function public.watheq_reverse_assoc_expense(uuid, text) from public, anon;
grant execute on function public.watheq_reverse_assoc_expense(uuid, text) to authenticated;

-- ── ٦) رابط شفافية العمارة ─────────────────────────────────────
create or replace function public.watheq_assoc_public_link(p_assoc uuid, p_action text default 'get')
returns text language plpgsql security definer set search_path = public as $$
declare a associations%rowtype; tok text; src0 text := coalesce(current_setting('watheq.src', true), '');
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into a from associations where id = p_assoc for update;
  if not found or not watheq_can_manage(a.user_id) then raise exception 'not authorized'; end if;
  if p_action = 'revoke' then
    if a.public_token is not null then
      perform set_config('watheq.src', 'public_link', true);
      update associations set public_token = null where id = a.id;
      perform set_config('watheq.src', src0, true);
      insert into hoa_audit (user_id, association_id, actor, source, action)
      values (a.user_id, a.id, auth.uid(), 'portal', 'building_link_revoke');
    end if;
    return null;
  elsif p_action = 'get' then
    if a.public_token is not null then return a.public_token; end if;
    tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    perform set_config('watheq.src', 'public_link', true);
    update associations set public_token = tok where id = a.id;
    perform set_config('watheq.src', src0, true);
    insert into hoa_audit (user_id, association_id, actor, source, action)
    values (a.user_id, a.id, auth.uid(), 'portal', 'building_link_create');
    return tok;
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.watheq_assoc_public_link(uuid, text) from public, anon;
grant execute on function public.watheq_assoc_public_link(uuid, text) to authenticated;

-- ── ٧) الأرقام المجمَّعة للعمارة (داخلية) ───────────────────────
-- لا أسماء ملاك ولا وحدات ولا مورّدين — مجاميع فقط. «المحصَّل» = دفعات الملاك
-- صافيةً من العكس (سطر العكس يحمل تاريخ الأصل فيُطرح في فترته نفسها).
create or replace function public.watheq_hoa_building_data(p_assoc uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a associations%rowtype; t date := watheq_today(); m0 date; y0 date; res jsonb;
begin
  select * into a from associations where id = p_assoc;
  if not found then return null; end if;
  m0 := date_trunc('month', t)::date;
  y0 := date_trunc('year', t)::date;
  select jsonb_build_object(
    'name', a.name,
    'units', coalesce(a.units, 0),
    'fee', coalesce(a.fee, 0),
    'fee_period', 'monthly',
    'fee_basis', 'equal',
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

-- للوحة المكتب (ملخص الشهر ولوحة المصروفات) — قراءة لموظفي المكتب
create or replace function public.watheq_assoc_building_summary(p_assoc uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare office uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select user_id into office from associations where id = p_assoc;
  if office is null or not watheq_can_read(office) then raise exception 'not authorized'; end if;
  return watheq_hoa_building_data(p_assoc);
end $$;
revoke all on function public.watheq_assoc_building_summary(uuid) from public, anon;
grant execute on function public.watheq_assoc_building_summary(uuid) to authenticated;

-- الصفحة العامة (مفتاح الخدمة فقط). المجهول والمُبطَل يرجعان null بالطريقة نفسها.
create or replace function public.watheq_hoa_building(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a associations%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into a from associations where public_token = p_token;
  if not found then return null; end if;
  -- نسبة السداد بعد استحقاق هذا الشهر
  if a.accrued_through is null or a.accrued_through < date_trunc('month', watheq_today())::date then
    select * into a from associations where id = a.id for update;
    perform watheq_hoa_accrue_locked(a);
  end if;
  return watheq_hoa_building_data(a.id)
      || jsonb_build_object('office', (select jsonb_build_object('org_name', p.org_name) from profiles p where p.id = a.user_id));
end $$;
revoke all on function public.watheq_hoa_building(text) from public, anon, authenticated;
grant execute on function public.watheq_hoa_building(text) to service_role;

-- ── ٨) البوابة: كل ما كانت تُرجعه (v61) + أرقام العمارة المجمَّعة ─
create or replace function public.watheq_hoa_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l hoa_member_links%rowtype; a associations%rowtype; o owners%rowtype; res jsonb;
begin
  l := watheq_hoa_link_resolve(p_token);
  if l.id is null then return null; end if;

  select * into a from associations where id = l.association_id;
  if a.accrued_through is null or a.accrued_through < date_trunc('month', watheq_today())::date then
    select * into a from associations where id = l.association_id for update;
    perform watheq_hoa_accrue_locked(a);
  end if;
  select * into a from associations where id = l.association_id;
  select * into o from owners where id = l.owner_id;

  update hoa_member_links set last_seen_at = now() where id = l.id;

  select jsonb_build_object(
    'association', jsonb_build_object('name', a.name, 'fee', coalesce(a.fee, 0),
                   'bank_name', a.bank_name, 'bank_account_name', a.bank_account_name, 'iban', a.iban),
    'office', (select jsonb_build_object('org_name', p.org_name) from profiles p where p.id = l.user_id),
    'owner', jsonb_build_object('name', o.name, 'unit', o.unit,
               'months_late', coalesce(o.months_late, 0), 'partial_amount', coalesce(o.partial_amount, 0),
               'prepaid_months', coalesce(o.prepaid_months, 0), 'last_paid', o.last_paid),
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
  to_regclass('public.association_expenses') is not null as جدول_المصروفات,
  (select count(*) from pg_policies where tablename = 'association_expenses') as سياسات_المصروفات_المتوقع_1,
  has_table_privilege('authenticated', 'public.association_expenses', 'insert') as إدراج_مباشر_يجب_false,
  has_table_privilege('authenticated', 'public.association_expenses', 'update') as تعديل_مباشر_يجب_false,
  to_regprocedure('public.watheq_record_assoc_expense(uuid, numeric, text, text, date, text, text, boolean, uuid)') is not null as دالة_المصروف,
  to_regprocedure('public.watheq_reverse_assoc_expense(uuid, text)') is not null as دالة_عكس_المصروف,
  has_function_privilege('anon', 'public.watheq_hoa_building(text)', 'execute') as صفحة_العمارة_لـanon_يجب_false,
  has_function_privilege('authenticated', 'public.watheq_hoa_building(text)', 'execute') as صفحة_العمارة_لـauthenticated_يجب_false,
  (select count(*) from information_schema.triggers where event_object_table = 'association_expenses'
     and trigger_name in ('watheq_assoc_expense_append_only', 'watheq_guard_assoc_office')) as مشغّلات_المصروفات_المتوقع_4,
  (select count(*) from public.associations where expense_counter <> 0 or public_token is not null) as جمعيات_بسندات_أو_روابط;
