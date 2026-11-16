-- ============================================================
-- وثيق — schema-v87: حساب الأمانات — التأمين وحصص العدادات المشتركة (16 نوفمبر 2026)
--
-- طلب مكتب الأولى:
--  ١) شقق أو معارض على عداد واحد: المستأجرون يرسلون حصتهم من الفاتورة والمكتب يسددها.
--     يريد سند قبض للحصة لا يدخل في الإيجار، وسند صرف لسداد الفاتورة — والناتج صفر.
--  ٢) التأمين: يُقبض ولا يدخل في الإيجار، ويُسترد ولا يُخصم من الإيجار.
--
-- لماذا جدول مستقل لا نوعًا جديدًا في payments: المدفوعات تُجمع في أكثر من 15 موضعًا
-- (تقرير المالك، كشف التحصيل، دفتر المكتب، المحفظة، ملخص تليجرام، رابط المالك…)، وكثير
-- منها يعدّ كل ما ليس «rent» دخلًا (سداد ديون). نوع جديد هناك = خطر أن يُحسب التأمين
-- للمالك في موضع نُسي. هنا الأمانة لا تصل لأي حساب دخل بالبناء نفسه.
--
--   kind: deposit_in  (قبض تأمين)       · deposit_out (استرداد تأمين)
--         utility_in  (قبض حصة فاتورة)   · utility_out (سداد فاتورة مشتركة)
--   doc_no: سند قبض أمانة TR-00001 للقبض · سند صرف أمانة TV-00001 للصرف — لكل مكتب.
--   بعد صدور الرقم لا يتغيّر النوع ولا المبلغ ولا الطريقة ولا الوحدة؛ يُعدَّل التاريخ
--   والمرجع والبيان والطرف والعداد والفترة فقط. التصحيح بالحذف (للمدير) وتسجيل جديد.
--
-- + نوع وحدة «معرض» (showroom) في قيد tenants، وعمود profiles.last_backup_at للتذكير الشهري بالتصدير.
--
-- ٣) watheq_payment_to_trust: دفعة سُجِّلت إيجارًا وهي تأمين أو حصة فاتورة ⇒ تُعكس
--    (بنفس منطق العكس) وتُسجَّل أمانةً بمبلغها وتاريخها وطريقتها ومرجعها — في معاملة واحدة.
-- ٤) watheq_correct_payment: تصحيح مبلغ دفعة إيجار = عكسها وتسجيل المبلغ الصحيح بتاريخها
--    وطريقتها ومرجعها في معاملة واحدة (سند جديد برقم جديد؛ القديم يبقى «معكوسًا» للتدقيق).
--
-- آمن للتشغيل أكثر من مرة. Supabase → SQL Editor → Run — قبل رفع الكود.
-- ============================================================

begin;

create table if not exists public.trust_ledger (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,                                         -- المكتب
  property_id    uuid not null references public.properties(id) on delete cascade,
  tenant_id      uuid references public.tenants(id) on delete set null,
  unit           text check (unit is null or char_length(unit) <= 40),
  kind           text not null check (kind in ('deposit_in', 'deposit_out', 'utility_in', 'utility_out')),
  amount         numeric(14,2) not null check (amount > 0),
  entry_on       date not null default (now() at time zone 'Asia/Riyadh')::date,
  method         text not null default 'transfer' check (method in ('transfer', 'ejar', 'cash', 'pos', 'card', 'cheque', 'other')),
  party          text check (party is null or char_length(party) <= 160),    -- الدافع أو المستلم
  meter          text check (meter is null or char_length(meter) <= 60),     -- رقم/اسم العداد
  bill_period    text check (bill_period is null or char_length(bill_period) <= 40),
  reference      text check (reference is null or char_length(reference) <= 80),
  note           text check (note is null or char_length(note) <= 300),
  doc_no         text,
  source_payment uuid,                                                   -- دفعة إيجار حُوِّلت إلى هنا
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create index if not exists trust_ledger_office_idx on public.trust_ledger (user_id, entry_on desc);
create index if not exists trust_ledger_prop_idx on public.trust_ledger (property_id, entry_on desc);
create index if not exists trust_ledger_tenant_idx on public.trust_ledger (tenant_id) where tenant_id is not null;
create unique index if not exists trust_ledger_doc_once on public.trust_ledger (user_id, doc_no) where doc_no is not null;
create unique index if not exists trust_ledger_source_once on public.trust_ledger (source_payment) where source_payment is not null;

/* عدّاد لا يرجع: حذف آخر سند لا يعيد رقمه لسند جديد (سندان مطبوعان برقم واحد) */
create table if not exists public.trust_doc_counters (
  user_id uuid not null, pfx text not null check (pfx in ('TR-', 'TV-')), n int not null default 0,
  primary key (user_id, pfx)
);
alter table public.trust_doc_counters enable row level security;   -- لا سياسات: الوصول عبر المشغّل فقط
revoke all on public.trust_doc_counters from anon, authenticated;

-- حارس + ترقيم: العقار من المكتب، والوحدة من العقار، ورقم سند متسلسل لكل مكتب
create or replace function public.trust_ledger_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pfx text; v_n int;
begin
  if not exists (select 1 from properties p where p.id = new.property_id and p.user_id = new.user_id) then
    raise exception 'العقار ليس من عقارات هذا المكتب';
  end if;
  if new.tenant_id is not null and not exists (select 1 from tenants t where t.id = new.tenant_id and t.property_id = new.property_id) then
    raise exception 'الوحدة ليست من هذا العقار';
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := auth.uid(); end if;
    v_pfx := case when new.kind like '%\_in' escape '\' then 'TR-' else 'TV-' end;
    insert into trust_doc_counters (user_id, pfx, n) values (new.user_id, v_pfx, 1)
      on conflict (user_id, pfx) do update set n = trust_doc_counters.n + 1
      returning trust_doc_counters.n into v_n;
    new.doc_no := v_pfx || lpad(v_n::text, 5, '0');
  else
    if (new.kind, new.amount, new.method, new.user_id, new.property_id, new.doc_no, new.source_payment)
       is distinct from (old.kind, old.amount, old.method, old.user_id, old.property_id, old.doc_no, old.source_payment) then
      raise exception 'صدر لهذا القيد سند — النوع والمبلغ والطريقة لا تُعدَّل؛ احذفه وسجّله من جديد';
    end if;
    if new.tenant_id is distinct from old.tenant_id and new.tenant_id is not null then
      raise exception 'الوحدة لا تتغيّر بعد صدور السند';
    end if;   -- (الحذف من tenants يجعلها null تلقائيًّا — مسموح)
  end if;
  return new;
end $$;
drop trigger if exists trust_ledger_guard on public.trust_ledger;
create trigger trust_ledger_guard before insert or update on public.trust_ledger
  for each row execute function public.trust_ledger_guard();

alter table public.trust_ledger enable row level security;
drop policy if exists trust_ledger_read on public.trust_ledger;
create policy trust_ledger_read on public.trust_ledger for select
  using (watheq_perm(user_id, 'view_financials') or watheq_perm(user_id, 'record_payments'));
-- القبض لمن يسجّل الدفعات؛ الصرف (استرداد التأمين وسداد الفاتورة) لمن يدير المصروفات
drop policy if exists trust_ledger_ins on public.trust_ledger;
create policy trust_ledger_ins on public.trust_ledger for insert with check (
  case when kind in ('deposit_in', 'utility_in') then watheq_perm(user_id, 'record_payments')
       else watheq_perm(user_id, 'manage_expenses') end);
drop policy if exists trust_ledger_upd on public.trust_ledger;
create policy trust_ledger_upd on public.trust_ledger for update
  using (watheq_perm(user_id, 'record_payments') or watheq_perm(user_id, 'manage_expenses'))
  with check (watheq_perm(user_id, 'record_payments') or watheq_perm(user_id, 'manage_expenses'));
drop policy if exists trust_ledger_del on public.trust_ledger;
create policy trust_ledger_del on public.trust_ledger for delete using (watheq_perm(user_id, 'undo_actions'));
grant select, insert, update, delete on public.trust_ledger to authenticated;
revoke all on public.trust_ledger from anon;

-- ── ٢ب) نوع وحدة «معرض» (16 نوفمبر 2026): كان المعرض بلا نوع فيُكتب «شقة» في مستنداته ──
alter table public.tenants drop constraint if exists tenants_unit_type_check;
alter table public.tenants add constraint tenants_unit_type_check
  check (unit_type is null or unit_type in ('apartment','annex','studio','room','shop','showroom','office','warehouse','land','villa','other')) not valid;   -- not valid: لا يفحص القديم (قد لا يكون القيد موجودًا أصلًا)

-- ── ٢ج) آخر نسخة احتياطية (تصدير Excel/JSON): تذكير شهري لصاحب المكتب داخل التطبيق ──
alter table public.profiles add column if not exists last_backup_at timestamptz;

-- ── ٣) دفعة إيجار ⇒ أمانة ──────────────────────────────────────
create or replace function public.watheq_payment_to_trust(p_payment uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; t tenants%rowtype; office uuid; rid uuid; rev jsonb;
begin
  if p_kind not in ('deposit_in', 'utility_in') then raise exception 'النوع غير صالح'; end if;
  select * into pay from payments where id = p_payment for update;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  if pay.amount <= 0 or pay.tenant_id is null or pay.past_tenancy_id is not null
     or coalesce(pay.applies_to, 'rent') <> 'rent' or pay.association_id is not null then
    raise exception 'تُحوَّل دفعات الإيجار للوحدة الحالية فقط';
  end if;
  if exists (select 1 from payments where reverses = p_payment) then raise exception 'هذه الدفعة معكوسة أصلًا'; end if;
  select user_id into office from properties where id = pay.property_id;
  if not watheq_perm(office, 'undo_actions') then raise exception 'not authorized'; end if;
  select * into t from tenants where id = pay.tenant_id;
  rev := watheq_reverse_payment(p_payment);          -- يعيد العدّاد ويضيف صفّ العكس كما يفعل زرّ «اعكسها»
  insert into trust_ledger (user_id, property_id, tenant_id, unit, kind, amount, entry_on, method, party, reference, note, source_payment, created_by)
  values (office, pay.property_id, pay.tenant_id, coalesce(pay.unit_label, t.unit), p_kind, pay.amount, pay.paid_on,
          case when pay.method in ('transfer','ejar','cash','pos','card','cheque','other') then pay.method else 'other' end,
          coalesce(pay.payer_name, t.name), pay.reference,
          'محوّلة من دفعة إيجار' || coalesce(' — سند ' || pay.receipt_no, ''), p_payment, auth.uid())
  returning id into rid;
  return jsonb_build_object('trust_id', rid, 'reversal', rev);
end $$;
revoke all on function public.watheq_payment_to_trust(uuid, text) from public, anon;
grant execute on function public.watheq_payment_to_trust(uuid, text) to authenticated;

-- ── ٤) تصحيح مبلغ دفعة إيجار: عكس + تسجيل بالمبلغ الصحيح ─────────
create or replace function public.watheq_correct_payment(p_payment uuid, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; rev jsonb; rec jsonb;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'المبلغ الصحيح يجب أن يكون أكبر من صفر'; end if;
  select * into pay from payments where id = p_payment for update;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  if pay.amount <= 0 or pay.tenant_id is null or pay.past_tenancy_id is not null or coalesce(pay.applies_to, 'rent') <> 'rent' then
    raise exception 'يُصحَّح مبلغ دفعات الإيجار للوحدة الحالية فقط';
  end if;
  if exists (select 1 from payments where reverses = p_payment) then raise exception 'هذه الدفعة معكوسة أصلًا'; end if;
  if round(p_amount, 2) = round(pay.amount, 2) then raise exception 'المبلغ نفسه — لا تغيير'; end if;
  rev := watheq_reverse_payment(p_payment);                              -- يتحقق من صلاحية التراجع
  rec := watheq_record_payment(pay.tenant_id, p_amount, pay.method,
           'تصحيح مبلغ دفعة' || coalesce(' — بدل سند ' || pay.receipt_no, ''), pay.paid_on, null, pay.reference);
  return jsonb_build_object('reversal', rev, 'payment', rec);
end $$;
revoke all on function public.watheq_correct_payment(uuid, numeric) from public, anon;
grant execute on function public.watheq_correct_payment(uuid, numeric) to authenticated;

commit;

notify pgrst, 'reload schema';

-- تحقّق: الجدول + 4 سياسات + المشغّل + الدالتان
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'trust_ledger') as الجدول_يجب_1,
  (select count(*) from pg_policies where tablename = 'trust_ledger') as السياسات_يجب_4,
  (select count(*) from pg_trigger where tgname = 'trust_ledger_guard' and not tgisinternal) as المشغّل_يجب_1,
  (select count(*) from pg_proc where proname in ('watheq_payment_to_trust', 'watheq_correct_payment')) as الدالتان_يجب_2;
