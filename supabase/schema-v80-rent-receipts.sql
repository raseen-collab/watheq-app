-- ============================================================
-- وثيق — schema-v80: سند قبض مرقَّم لكل دفعة إيجار (14 نوفمبر 2026)
--
-- طلب مكتب «الأولى»: «سجّلت الدفعة وأبغى سند أو إيصال». كان للمكتب
-- «فاتورة» (مطالبة بالدفعة القادمة قبل سدادها) و«كشف حساب» — ولا سند
-- يُسلَّم للمستأجر بعد الاستلام. جمعيات الملاك عندها سند منذ v60.
--
-- التصميم:
--  • عدّاد لكل مكتب (profiles.receipt_counter) — مستقل عن عدّاد الفواتير
--    وعن عدّادات الجمعيات. الرقم «RC-00001» (الجمعيات «R-…» فلا يختلطان).
--  • مشغّل before insert على payments: كل دفعة إيجار موجبة (ليست عكسًا،
--    ليست جمعية، ليست تجريبية) تأخذ رقمها في معاملة التسجيل نفسها — بلا
--    فجوات، ويغطّي كل مسارات التسجيل (الزر، الدين المرحَّل، المستأجر السابق،
--    اعتماد حوالة من صفحة المستأجر).
--  • الدفعات السابقة تُرقَّم بترتيب تسجيلها لكل مكتب، ثم يُضبط العدّاد.
--  • الدفعات التجريبية بلا سند: حذف التجريبي لا يترك فجوة في أرقام المكتب.
--  • رقم السند لا يتغيّر بعد صدوره. تاريخ السداد والمرجع يبقيان قابلين
--    للتصحيح في دفعات الإيجار (مطابقة كشف البنك — سلوك قائم منذ v31/v44)؛
--    سند الجمعية يبقى جامدًا كما في v60.
--  • صفحة المستأجر: دالة watheq_tenant_receipt(token, payment) تُرجع سندًا
--    واحدًا من دفعات هذا المستأجر فقط (للرابط /r/t/{token}/p/{id}).
--
-- آمن للتشغيل أكثر من مرة. Supabase → SQL Editor → Run.
-- ============================================================

begin;

-- ── ١) العدّاد والترقيم ─────────────────────────────────────
alter table public.profiles add column if not exists receipt_counter int not null default 0;
alter table public.payments add column if not exists receipt_no text;

create or replace function public.watheq_rent_receipt_label(n int)
returns text language sql immutable as $$
  select 'RC-' || case when n < 100000 then lpad(n::text, 5, '0') else n::text end;
$$;

create or replace function public.payments_rent_receipt_no()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.receipt_no is not null then return new; end if;
  if new.association_id is not null or new.owner_id is not null then return new; end if;  -- الجمعيات لها ترقيمها
  if coalesce(new.amount, 0) <= 0 or new.reverses is not null then return new; end if;    -- العكس لا سند له
  if coalesce(new.is_demo, false) then return new; end if;                                  -- التجريبي بلا سند
  /* دفعة سجّلها المكتب يدويًّا داخل عقار تجريبي (الزر لا يضع is_demo): بلا سند أيضًا —
     وإلا بدأ ترقيم المكتب الحقيقي من RC-00009 بعد حذف التجريبي */
  if new.property_id is not null and exists (select 1 from properties p where p.id = new.property_id and coalesce(p.is_demo, false)) then
    return new;
  end if;
  if new.user_id is null then return new; end if;
  update public.profiles set receipt_counter = coalesce(receipt_counter, 0) + 1
   where id = new.user_id returning receipt_counter into n;
  if n is null then return new; end if;  -- مكتب بلا ملف (لا يُفترض) — الدفعة تمرّ بلا رقم
  new.receipt_no := watheq_rent_receipt_label(n);
  return new;
end $$;

drop trigger if exists payments_rent_receipt_no on public.payments;
create trigger payments_rent_receipt_no before insert on public.payments
  for each row execute function public.payments_rent_receipt_no();

-- ── ٢) ترقيم الدفعات السابقة (مرة واحدة لكل مكتب لم يُرقَّم) ───
with x as (
  select p.id, p.user_id,
         row_number() over (partition by p.user_id order by p.created_at, p.id) as n
    from public.payments p
   where p.association_id is null and p.owner_id is null
     and p.amount > 0 and p.reverses is null and not coalesce(p.is_demo, false)
     and not exists (select 1 from public.properties pr where pr.id = p.property_id and coalesce(pr.is_demo, false))
     and p.receipt_no is null and p.user_id is not null
     and not exists (select 1 from public.payments q
                      where q.user_id = p.user_id and q.association_id is null and q.receipt_no like 'RC-%')
)
update public.payments p set receipt_no = watheq_rent_receipt_label(x.n::int) from x where p.id = x.id;

update public.profiles r set receipt_counter = greatest(coalesce(r.receipt_counter, 0),
  coalesce((select max(substring(p.receipt_no from 4)::int) from public.payments p
             where p.user_id = r.id and p.association_id is null and p.receipt_no ~ '^RC-[0-9]+$'), 0));

create unique index if not exists payments_rent_receipt_once
  on public.payments (user_id, receipt_no) where association_id is null and receipt_no is not null;

-- ── ٣) الجمود: رقم السند لا يتغيّر؛ سند الجمعية جامد كله (v60)، وسند
--      الإيجار يسمح بتصحيح التاريخ والمرجع والملاحظة فقط ─────────
create or replace function public.watheq_receipt_immutable()
returns trigger language plpgsql as $$
begin
  if old.receipt_no is null then return new; end if;
  if current_setting('watheq.sync', true) = '1' then return new; end if;
  if new.receipt_no is distinct from old.receipt_no then
    raise exception 'رقم سند القبض لا يتغيّر بعد صدوره';
  end if;
  if old.association_id is not null or old.owner_id is not null then
    if (new.amount, new.paid_on, new.payer_name, new.unit_label, new.reference, new.method)
        is distinct from (old.amount, old.paid_on, old.payer_name, old.unit_label, old.reference, old.method) then
      raise exception 'سند القبض صدر ولا يُعدَّل — اعكس الدفعة وسجّلها من جديد';
    end if;
  else
    /* دفعة إيجار: المبلغ والطريقة والمكتب ثابتة (السند يحملها). دوال الخادم
       (watheq.in_fn — مثل إعادة التأجير التي تنقل الدفعات إلى أرشيف المستأجر
       السابق وتثبّت اسمه) تمرّ؛ طلب المتصفح لا يغيّر إلا التاريخ والمرجع والملاحظة. */
    if current_setting('watheq.in_fn', true) is distinct from '1'
       and (new.amount, new.method, new.user_id) is distinct from (old.amount, old.method, old.user_id) then
      raise exception 'صدر لهذه الدفعة سند قبض — المبلغ لا يُعدَّل؛ اعكسها وسجّلها من جديد';
    end if;
  end if;
  return new;
end $$;
-- المشغّل موجود منذ v60 بالاسم نفسه ويستدعي الدالة أعلاه؛ نعيد إنشاءه احتياطًا
drop trigger if exists watheq_receipt_immutable on public.payments;
create trigger watheq_receipt_immutable before update on public.payments
  for each row execute function public.watheq_receipt_immutable();

-- ── ٤) سند المستأجر من صفحته الخاصة (/r/t/{token}/p/{payment}) ───
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
      'payer_name', pay.payer_name, 'unit_label', pay.unit_label,
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

notify pgrst, 'reload schema';

-- ── فحص: صف واحد ──
select
  (select count(*) from pg_trigger where tgname = 'payments_rent_receipt_no' and not tgisinternal) as مشغّل_الترقيم_المتوقع_1,
  (select count(*) from public.payments p where p.association_id is null and p.amount > 0 and p.reverses is null
     and not coalesce(p.is_demo, false) and p.receipt_no is null
     and not exists (select 1 from public.properties pr where pr.id = p.property_id and coalesce(pr.is_demo, false))) as دفعات_إيجار_بلا_سند_المتوقع_0,
  (select count(*) from public.payments where receipt_no like 'RC-%') as سندات_إيجار,
  (select count(*) from public.payments where receipt_no like 'R-%') as سندات_جمعيات,
  has_function_privilege('authenticated', 'public.watheq_tenant_receipt(text, uuid)', 'execute') as سند_المستأجر_لـauthenticated_يجب_false;
