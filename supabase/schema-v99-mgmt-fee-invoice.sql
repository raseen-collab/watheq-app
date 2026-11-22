-- ============================================================
-- وثيق — schema-v99: فاتورة أتعاب الإدارة من المكتب على المالك (23 نوفمبر 2026)
--
-- دليل الوكلاء العقاريين §5.2: عمولة/أتعاب الوكيل توريد مستقل خاضع للنسبة الأساسية
-- (15%) حتى لو كان الإيجار نفسه سكنيًّا معفى. المورّد هنا المكتب باسمه ورقمه؛
-- المشتري المالك: مسجَّل في الضريبة (رقم ضريبي صحيح في العقار) ← قياسية، وإلا مبسطة.
--
--  • invoices.subject: 'rent' (الافتراضي، كل القديم) | 'mgmt_fee'.
--  • لقطة الحساب في الفاتورة: period_from/to، fee_basis (صافي المحصَّل الذي حُسبت عليه
--    النسبة)، fee_pct، fee_fixed، fee_times — تُكتب من المتصفح بأرقام تقرير المالك نفسه،
--    وتُطبع في «كيف حُسبت». amount = الأتعاب (قبل الضريبة إن غير شاملة، وشاملة إن شاملة).
--  • properties.fee_vat_inclusive: «أتعابي شاملة الضريبة» (افتراضيًّا لا).
--  • الضريبة على فاتورة الأتعاب تُقرَّر في القاعدة: مفعّلة فقط إن كان للمكتب رقم ضريبي
--    صحيح — فلا يحصّل مكتب غير مسجَّل ضريبةً بالخطأ.
--  • فاتورة واحدة لكل عقار لكل فترة (قيد فريد على القائمة غير الملغاة).
--  • وسيلة دفع 'deduction' = خُصمت من المحصَّل.
-- آمن للتكرار. لا يحذف بيانات ولا يعدّل فاتورة قائمة.
-- ============================================================

alter table public.properties add column if not exists fee_vat_inclusive boolean not null default false;

alter table public.invoices add column if not exists subject text not null default 'rent';
alter table public.invoices add column if not exists period_from date;
alter table public.invoices add column if not exists period_to date;
alter table public.invoices add column if not exists fee_basis numeric;
alter table public.invoices add column if not exists fee_pct numeric;
alter table public.invoices add column if not exists fee_fixed numeric;
alter table public.invoices add column if not exists fee_times integer;
do $$ begin
  alter table public.invoices add constraint invoices_subject_chk check (subject in ('rent', 'mgmt_fee'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoices add constraint invoices_fee_period_chk
    check (subject <> 'mgmt_fee' or doc_type <> 'invoice' or (period_from is not null and period_to is not null and period_to >= period_from));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles drop constraint if exists profiles_payment_means_chk;
  alter table public.profiles add constraint profiles_payment_means_chk
    check (payment_means is null or payment_means in ('transfer', 'cash', 'cheque', 'card', 'sadad', 'deduction', 'other'));
exception when others then null; end $$;

-- فاتورة أتعاب واحدة قائمة لكل عقار لكل فترة
create unique index if not exists invoices_fee_period_uniq
  on public.invoices (property_id, period_from, period_to)
  where subject = 'mgmt_fee' and doc_type = 'invoice' and status <> 'void';

create or replace function public.watheq_invoice_snapshot()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare pr record; pp record; tt record; src record;
begin
  if new.doc_type is distinct from 'invoice'
     and coalesce(current_setting('watheq.void_ref', true), '') is distinct from coalesce(new.ref_invoice_id::text, '-') then
    raise exception using errcode = '42501', message = 'الإشعار الدائن يصدر من «إلغاء الفاتورة» فقط.';
  end if;

  new.issued_by := auth.uid();
  new.voided_at := null;
  new.voided_by := null;
  if new.status is distinct from 'issued' then new.status := 'issued'; end if;
  if new.subject is null then new.subject := 'rent'; end if;

  if new.doc_type = 'credit_note' then
    select * into src from public.invoices where id = new.ref_invoice_id;
    new.subject := src.subject;
    new.seller_mode := src.seller_mode;   new.seller_name := src.seller_name;
    new.seller_vat := src.seller_vat;     new.seller_cr := src.seller_cr;
    new.seller_address := src.seller_address;
    new.buyer_name := src.buyer_name;     new.buyer_id := src.buyer_id;
    new.buyer_vat := src.buyer_vat;       new.buyer_address := src.buyer_address;
    new.unit_label := src.unit_label;     new.property_name := src.property_name;
    new.invoice_kind := coalesce(src.invoice_kind, 'simplified');
    new.payment_means := src.payment_means;
    new.period_from := src.period_from;   new.period_to := src.period_to;
    new.fee_basis := src.fee_basis;       new.fee_pct := src.fee_pct;
    new.fee_fixed := src.fee_fixed;       new.fee_times := src.fee_times;
    return new;
  end if;

  new.ref_invoice_id := null;
  new.reason := null;

  select coalesce(nullif(btrim(billing_name), ''), nullif(btrim(org_name), '')) as nm,
         nullif(btrim(vat_number), '') as vat, nullif(btrim(cr_number), '') as cr,
         nullif(btrim(billing_address), '') as addr, payment_means as pm
    into pr from public.profiles where id = new.user_id;
  select name, manager, address, city, rent_seller, owner_name, owner_vat_number, owner_address, fee_vat_inclusive, vat_rate
    into pp from public.properties where id = new.property_id;

  if new.subject = 'mgmt_fee' then
    -- أتعاب الإدارة: المورّد المكتب دائمًا، والمشتري المالك
    if new.tenant_id is not null then
      raise exception using errcode = 'P0001', message = 'فاتورة الأتعاب تصدر على المالك لا على مستأجر.';
    end if;
    if coalesce(nullif(btrim(pp.owner_name), ''), '') = '' then
      raise exception using errcode = 'P0001', message = 'أضف اسم المالك في بيانات العقار قبل إصدار فاتورة الأتعاب.';
    end if;
    new.seller_mode := 'office';
    new.seller_name := coalesce(pr.nm, nullif(btrim(pp.manager), ''));
    new.seller_vat := pr.vat;
    new.seller_cr := pr.cr;
    new.seller_address := pr.addr;
    new.buyer_name := btrim(pp.owner_name);
    new.buyer_id := null;
    new.buyer_vat := pp.owner_vat_number;
    new.buyer_address := coalesce(nullif(btrim(pp.owner_address), ''), nullif(btrim(concat_ws('، ', pp.address, pp.city)), ''));
    new.unit_label := null;
    new.property_name := pp.name;
    new.payment_means := coalesce(new.payment_means, 'deduction');
    new.invoice_kind := case when pp.owner_vat_number ~ '^3[0-9]{13}3$' then 'standard' else 'simplified' end;
    -- الضريبة على الأتعاب: فقط للمكتب المسجَّل (رقم ضريبي صحيح) — وإلا فاتورة بلا ضريبة
    new.vat_enabled := pr.vat ~ '^3[0-9]{13}3$';
    new.vat_rate := coalesce(new.vat_rate, pp.vat_rate, 15);
    new.vat_inclusive := coalesce(pp.fee_vat_inclusive, false);
    return new;
  end if;

  select name, national_id, unit, vat_number, billing_address into tt from public.tenants where id = new.tenant_id;

  if pp.rent_seller = 'owner' then
    new.seller_mode := 'owner';
    new.seller_name := nullif(btrim(pp.owner_name), '');
    new.seller_vat := pp.owner_vat_number;
    new.seller_cr := null;
    new.seller_address := coalesce(nullif(btrim(pp.owner_address), ''), nullif(btrim(concat_ws('، ', pp.address, pp.city)), ''));
  else
    new.seller_mode := 'office';
    new.seller_name := coalesce(pr.nm, nullif(btrim(pp.manager), ''));
    new.seller_vat := pr.vat;
    new.seller_cr := pr.cr;
    new.seller_address := pr.addr;
  end if;
  new.buyer_name := tt.name;
  new.buyer_id := nullif(btrim(tt.national_id), '');
  new.buyer_vat := tt.vat_number;
  new.buyer_address := nullif(btrim(tt.billing_address), '');
  new.unit_label := nullif(btrim(tt.unit), '');
  new.property_name := pp.name;
  new.payment_means := pr.pm;
  new.invoice_kind := case when tt.vat_number is not null then 'standard' else 'simplified' end;
  return new;
end $$;
revoke all on function public.watheq_invoice_snapshot() from public, anon, authenticated;

-- الإشعار الدائن يرث حقول الأتعاب (period/fee_*) عبر المشغّل أعلاه؛ الدالة تمرّر subject فقط
create or replace function public.watheq_void_invoice(p_invoice uuid, p_reason text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.invoices; uid uuid := auth.uid(); n int; no text; cn uuid; why text := btrim(coalesce(p_reason, ''));
begin
  if uid is null then raise exception using errcode = '42501', message = 'not authorized'; end if;
  select * into v from public.invoices where id = p_invoice for update;
  if not found then raise exception using errcode = 'P0002', message = 'الفاتورة غير موجودة.'; end if;
  if not (public.watheq_perm(v.user_id, 'issue_invoices') and public.watheq_prop_ok(v.user_id, v.property_id)) then
    raise exception using errcode = '42501', message = 'لا تملك صلاحية إصدار الفواتير في هذا المكتب.';
  end if;
  if v.doc_type <> 'invoice' then raise exception using errcode = 'P0001', message = 'الإشعار الدائن لا يُلغى.'; end if;
  if v.status = 'void' then raise exception using errcode = 'P0001', message = 'الفاتورة ملغاة من قبل.'; end if;
  if char_length(why) < 3 or char_length(why) > 300 then
    raise exception using errcode = 'P0001', message = 'اكتب سبب الإلغاء (٣ أحرف على الأقل).';
  end if;

  perform set_config('watheq.void_ref', v.id::text, true);

  update public.profiles set invoice_counter = coalesce(invoice_counter, 0) + 1
   where id = v.user_id returning invoice_counter into n;
  no := 'CN-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(n::text, 4, '0');

  insert into public.invoices (user_id, tenant_id, property_id, invoice_no, issue_date, due_date, period_label,
                               amount, status, doc_type, ref_invoice_id, reason, vat_enabled, vat_rate, vat_inclusive, subject)
  values (v.user_id, v.tenant_id, v.property_id, no, (now() at time zone 'Asia/Riyadh')::date, null, v.period_label,
          v.amount, 'issued', 'credit_note', v.id, why, v.vat_enabled, v.vat_rate, v.vat_inclusive, v.subject)
  returning id into cn;

  update public.invoices set status = 'void', voided_at = now(), voided_by = uid where id = v.id;
  perform set_config('watheq.void_ref', '', true);
  return json_build_object('id', cn, 'invoice_no', no);
end $$;
revoke all on function public.watheq_void_invoice(uuid, text) from public, anon;
grant execute on function public.watheq_void_invoice(uuid, text) to authenticated;
