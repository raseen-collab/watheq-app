-- ============================================================
-- وثيق — schema-v96: الفاتورة الضريبية القياسية للمستأجر المسجَّل (22 نوفمبر 2026)
--
-- الدليل التفصيلي للفوترة الإلكترونية §4.2.1(ب): الفاتورة المبسطة بين منشأتين
-- اختيارية فقط إن قلّت قيمة التوريد الخاضع عن 1,000 ريال — وإيجار المعرض للشركة
-- فوقها دائمًا، فيلزمه «فاتورة ضريبية» (قياسية). وملحق قرار الضوابط يطلب فيها:
-- اسم المشتري وعنوانه، ورقمه الضريبي إن كان مسجّلًا، ونسبة الضريبة ومبلغها لكل
-- بند، ووسيلة الدفع.
--
--  • tenants.vat_number / tenants.billing_address — رقم المستأجر الضريبي وعنوانه.
--  • profiles.payment_means — وسيلة الدفع المطبوعة في الفاتورة.
--  • invoices.invoice_kind ('simplified' | 'standard') + لقطة buyer_vat/buyer_address/
--    payment_means — تُحسب في القاعدة لحظة الإصدار (watheq_invoice_snapshot).
--    قياسية = للمستأجر رقم ضريبي صحيح. الإشعار الدائن يرث نوع فاتورته (§4.3).
--
-- آمن للتكرار. لا يحذف بيانات ولا يعدّل فاتورة قائمة.
-- ============================================================

alter table public.tenants add column if not exists vat_number text;
alter table public.tenants add column if not exists billing_address text;
do $$ begin
  alter table public.tenants add constraint tenants_vat_number_chk check (vat_number is null or vat_number ~ '^3[0-9]{13}3$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tenants add constraint tenants_billing_address_len check (billing_address is null or char_length(billing_address) <= 200);
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists payment_means text;
do $$ begin
  alter table public.profiles add constraint profiles_payment_means_chk
    check (payment_means is null or payment_means in ('transfer', 'cash', 'cheque', 'card', 'sadad', 'other'));
exception when duplicate_object then null; end $$;

alter table public.invoices add column if not exists invoice_kind text not null default 'simplified';
alter table public.invoices add column if not exists buyer_vat text;
alter table public.invoices add column if not exists buyer_address text;
alter table public.invoices add column if not exists payment_means text;
do $$ begin
  alter table public.invoices add constraint invoices_kind_chk check (invoice_kind in ('simplified', 'standard'));
exception when duplicate_object then null; end $$;

create or replace function public.watheq_invoice_snapshot()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare pr record; pp record; tt record; src record;
begin
  -- الحساب لا يُدرج إشعارًا دائنًا بنفسه — يمرّ عبر watheq_void_invoice، وهي وحدها
  -- تضبط watheq.void_ref للفاتورة الأصلية داخل المعاملة (set_config غير مكشوفة للمتصفح).
  if new.doc_type is distinct from 'invoice'
     and coalesce(current_setting('watheq.void_ref', true), '') is distinct from coalesce(new.ref_invoice_id::text, '-') then
    raise exception using errcode = '42501', message = 'الإشعار الدائن يصدر من «إلغاء الفاتورة» فقط.';
  end if;

  new.issued_by := auth.uid();
  new.voided_at := null;
  new.voided_by := null;
  if new.status is distinct from 'issued' then new.status := 'issued'; end if;

  if new.doc_type = 'credit_note' then
    -- الإشعار بنفس بيانات الفاتورة الأصلية ونوعها (قياسية/مبسطة)
    select * into src from public.invoices where id = new.ref_invoice_id;
    new.seller_mode := src.seller_mode;   new.seller_name := src.seller_name;
    new.seller_vat := src.seller_vat;     new.seller_cr := src.seller_cr;
    new.seller_address := src.seller_address;
    new.buyer_name := src.buyer_name;     new.buyer_id := src.buyer_id;
    new.buyer_vat := src.buyer_vat;       new.buyer_address := src.buyer_address;
    new.unit_label := src.unit_label;     new.property_name := src.property_name;
    new.invoice_kind := coalesce(src.invoice_kind, 'simplified');
    new.payment_means := src.payment_means;
    return new;
  end if;

  new.ref_invoice_id := null;
  new.reason := null;

  select coalesce(nullif(btrim(billing_name), ''), nullif(btrim(org_name), '')) as nm,
         nullif(btrim(vat_number), '') as vat, nullif(btrim(cr_number), '') as cr,
         nullif(btrim(billing_address), '') as addr, payment_means as pm
    into pr from public.profiles where id = new.user_id;
  select name, manager, address, city, rent_seller, owner_name, owner_vat_number, owner_address
    into pp from public.properties where id = new.property_id;
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

-- تحقّق (المتوقَّع: 3 · 0 بلا نوع)
select (select count(*) from information_schema.columns where table_name = 'invoices' and column_name in ('invoice_kind', 'buyer_vat', 'buyer_address')) as cols,
       (select count(*) from public.invoices where invoice_kind is null) as no_kind;
