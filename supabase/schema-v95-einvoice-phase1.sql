-- ============================================================
-- وثيق — schema-v95: إحكام الفاتورة الإلكترونية (المرحلة الأولى) — 22 نوفمبر 2026
--
-- المرجع: الدليل التفصيلي للفوترة الإلكترونية (زاتكا) §5.6 «الوظائف المحظورة»،
-- وملحق قرار الضوابط (الحقول الإلزامية)، ودليل الوكلاء §5.1 و§11.1.1.
--
-- ما كان ناقصًا ويُسدّ هنا:
--  ١) الفاتورة الصادرة كانت قابلة للتعديل والحذف من المتصفح (كل أعمدتها).
--     المحظور: «تعديل أو حذف الفواتير والإشعارات الصادرة؛ الإلغاء بإشعار دائن».
--     ← لا UPDATE ولا DELETE من الحساب. الإلغاء عبر watheq_void_invoice فقط،
--       تُصدر إشعارًا دائنًا مرتبطًا بالفاتورة بسبب مكتوب، من نفس التسلسل.
--  ٢) لا سجلّ لأحداث الفواتير. ← invoice_events: إضافة فقط، لا يعدّله أحد.
--  ٣) اسم البائع ورقمه الضريبي كانا يُقرآن من الإعدادات الحالية وقت الطباعة.
--     ← لقطة البائع والمشتري تُحفظ في الفاتورة لحظة الإصدار (من القاعدة لا من المتصفح).
--  ٤) عنوان البائع حقل إلزامي في الفاتورة الضريبية المبسطة ولم يكن موجودًا.
--     ← profiles.billing_address و properties.owner_address.
--  ٥) المكتب الذي يؤجّر باسم المالك (وكيل معلَن) يجب أن تحمل الفاتورة اسم المالك
--     ورقمه الضريبي لا رقم المكتب (دليل الوكلاء §5.1، س١).
--     ← properties.rent_seller: 'office' (العقد باسم المكتب) أو 'owner'.
--
-- آمن للتكرار. لا يحذف بيانات ولا يعدّل فاتورة قائمة.
-- ============================================================

-- ── أعمدة جديدة ─────────────────────────────────────────────
alter table public.profiles add column if not exists billing_address text;
do $$ begin
  alter table public.profiles add constraint profiles_billing_address_len
    check (billing_address is null or char_length(billing_address) <= 200);
exception when duplicate_object then null; end $$;

alter table public.properties add column if not exists rent_seller text not null default 'office';
alter table public.properties add column if not exists owner_vat_number text;
alter table public.properties add column if not exists owner_address text;
do $$ begin
  alter table public.properties add constraint properties_rent_seller_chk check (rent_seller in ('office', 'owner'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.properties add constraint properties_owner_vat_chk
    check (owner_vat_number is null or owner_vat_number ~ '^3[0-9]{13}3$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.properties add constraint properties_owner_address_len
    check (owner_address is null or char_length(owner_address) <= 200);
exception when duplicate_object then null; end $$;

alter table public.invoices add column if not exists doc_type text not null default 'invoice';
alter table public.invoices add column if not exists ref_invoice_id uuid references public.invoices(id) on delete set null;
alter table public.invoices add column if not exists reason text;
alter table public.invoices add column if not exists seller_mode text;
alter table public.invoices add column if not exists seller_name text;
alter table public.invoices add column if not exists seller_vat text;
alter table public.invoices add column if not exists seller_cr text;
alter table public.invoices add column if not exists seller_address text;
alter table public.invoices add column if not exists buyer_name text;
alter table public.invoices add column if not exists buyer_id text;
alter table public.invoices add column if not exists unit_label text;
alter table public.invoices add column if not exists property_name text;
alter table public.invoices add column if not exists issued_by uuid;
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists voided_by uuid;
do $$ begin
  alter table public.invoices add constraint invoices_doc_type_chk check (doc_type in ('invoice', 'credit_note'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoices add constraint invoices_credit_note_ref_chk
    check (doc_type = 'invoice' or (ref_invoice_id is not null and char_length(btrim(coalesce(reason, ''))) between 3 and 300));
exception when duplicate_object then null; end $$;

-- إشعار دائن واحد لكل فاتورة
create unique index if not exists invoices_one_credit_note
  on public.invoices (ref_invoice_id) where doc_type = 'credit_note';

-- ── سجلّ أحداث الفواتير (إضافة فقط) ────────────────────────
create table if not exists public.invoice_events (
  id bigserial primary key,
  invoice_id uuid not null,
  user_id uuid not null,
  action text not null check (action in ('issued', 'credit_note', 'voided')),
  invoice_no text,
  actor uuid,
  at timestamptz not null default now(),
  detail jsonb
);
create index if not exists invoice_events_office_idx on public.invoice_events (user_id, at desc);
alter table public.invoice_events enable row level security;
drop policy if exists invoice_events_read on public.invoice_events;
create policy invoice_events_read on public.invoice_events
  for select to authenticated using (public.watheq_can_read(user_id));
revoke all on public.invoice_events from public, anon, authenticated;
grant select on public.invoice_events to authenticated;
revoke all on sequence public.invoice_events_id_seq from public, anon, authenticated;

-- ── لقطة البائع والمشتري لحظة الإصدار ──────────────────────
-- تُحسب في القاعدة دائمًا: ما يرسله المتصفح في هذه الأعمدة يُستبدل.
create or replace function public.watheq_invoice_snapshot()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare pr record; pp record; tt record; src record;
begin
  -- الحساب لا يُدرج إشعارًا دائنًا بنفسه — يمرّ عبر watheq_void_invoice، وهي وحدها
  -- تضبط watheq.void_ref للفاتورة الأصلية داخل المعاملة (set_config غير مكشوفة للمتصفح).
  -- (لا يصلح فحص current_user هنا: الدالة security definer فيكون دائمًا المالك.)
  if new.doc_type is distinct from 'invoice'
     and coalesce(current_setting('watheq.void_ref', true), '') is distinct from coalesce(new.ref_invoice_id::text, '-') then
    raise exception using errcode = '42501', message = 'الإشعار الدائن يصدر من «إلغاء الفاتورة» فقط.';
  end if;

  new.issued_by := auth.uid();
  new.voided_at := null;
  new.voided_by := null;
  if new.status is distinct from 'issued' then new.status := 'issued'; end if;

  if new.doc_type = 'credit_note' then
    -- الإشعار بنفس بيانات الفاتورة الأصلية (نفس البائع والمشتري)
    select * into src from public.invoices where id = new.ref_invoice_id;
    new.seller_mode := src.seller_mode;   new.seller_name := src.seller_name;
    new.seller_vat := src.seller_vat;     new.seller_cr := src.seller_cr;
    new.seller_address := src.seller_address;
    new.buyer_name := src.buyer_name;     new.buyer_id := src.buyer_id;
    new.unit_label := src.unit_label;     new.property_name := src.property_name;
    return new;
  end if;

  new.ref_invoice_id := null;
  new.reason := null;

  select coalesce(nullif(btrim(billing_name), ''), nullif(btrim(org_name), '')) as nm,
         nullif(btrim(vat_number), '') as vat, nullif(btrim(cr_number), '') as cr,
         nullif(btrim(billing_address), '') as addr
    into pr from public.profiles where id = new.user_id;
  select name, manager, address, city, rent_seller, owner_name, owner_vat_number, owner_address
    into pp from public.properties where id = new.property_id;
  select name, national_id, unit into tt from public.tenants where id = new.tenant_id;

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
  new.unit_label := nullif(btrim(tt.unit), '');
  new.property_name := pp.name;
  return new;
end $$;
revoke all on function public.watheq_invoice_snapshot() from public, anon, authenticated;

drop trigger if exists aa_invoice_snapshot on public.invoices;
create trigger aa_invoice_snapshot before insert on public.invoices
  for each row execute function public.watheq_invoice_snapshot();

-- ── الفاتورة الصادرة لا تُعدَّل ولا تُحذف من الحساب ──────────
-- دوال الخادم (security definer) وأفعال المفاتيح الخارجية تعمل بدور المالك فتمرّ.
create or replace function public.watheq_invoice_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  raise exception using errcode = '42501', message = case when tg_op = 'DELETE'
    then 'الفاتورة الصادرة لا تُحذف — ألغِها بإشعار دائن من سجل فواتير الوحدة.'
    else 'الفاتورة الصادرة لا تُعدَّل — ألغِها بإشعار دائن وأصدر فاتورة جديدة.' end;
end $$;
revoke all on function public.watheq_invoice_immutable() from public, anon, authenticated;

drop trigger if exists zz_invoice_immutable on public.invoices;
create trigger zz_invoice_immutable before update or delete on public.invoices
  for each row execute function public.watheq_invoice_immutable();

revoke update, delete on public.invoices from authenticated, anon;

-- ── السجلّ: كل إصدار وإلغاء ────────────────────────────────
create or replace function public.watheq_invoice_log()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.invoice_events (invoice_id, user_id, action, invoice_no, actor, detail)
    values (new.id, new.user_id, case when new.doc_type = 'credit_note' then 'credit_note' else 'issued' end,
            new.invoice_no, auth.uid(),
            jsonb_build_object('amount', new.amount, 'vat_enabled', new.vat_enabled, 'ref', new.ref_invoice_id));
  elsif tg_op = 'UPDATE' and old.status is distinct from 'void' and new.status = 'void' then
    insert into public.invoice_events (invoice_id, user_id, action, invoice_no, actor)
    values (new.id, new.user_id, 'voided', new.invoice_no, auth.uid());
  end if;
  return null;
end $$;
revoke all on function public.watheq_invoice_log() from public, anon, authenticated;

drop trigger if exists zz_invoice_log on public.invoices;
create trigger zz_invoice_log after insert or update on public.invoices
  for each row execute function public.watheq_invoice_log();

-- ── الإلغاء بإشعار دائن ────────────────────────────────────
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

  -- نفس عدّاد الفواتير: تسلسل واحد للفواتير والإشعارات
  update public.profiles set invoice_counter = coalesce(invoice_counter, 0) + 1
   where id = v.user_id returning invoice_counter into n;
  no := 'CN-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(n::text, 4, '0');

  insert into public.invoices (user_id, tenant_id, property_id, invoice_no, issue_date, due_date, period_label,
                               amount, status, doc_type, ref_invoice_id, reason, vat_enabled, vat_rate, vat_inclusive)
  values (v.user_id, v.tenant_id, v.property_id, no, (now() at time zone 'Asia/Riyadh')::date, null, v.period_label,
          v.amount, 'issued', 'credit_note', v.id, why, v.vat_enabled, v.vat_rate, v.vat_inclusive)
  returning id into cn;

  update public.invoices set status = 'void', voided_at = now(), voided_by = uid where id = v.id;
  perform set_config('watheq.void_ref', '', true);
  return json_build_object('id', cn, 'invoice_no', no);
end $$;
revoke all on function public.watheq_void_invoice(uuid, text) from public, anon;
grant execute on function public.watheq_void_invoice(uuid, text) to authenticated;

-- تحقّق (المتوقَّع: f · f · t · 0 · 3)
select has_table_privilege('authenticated', 'public.invoices', 'update') as can_update,
       has_table_privilege('authenticated', 'public.invoices', 'delete') as can_delete,
       has_table_privilege('authenticated', 'public.invoices', 'insert') as can_insert,
       (select count(*) from public.invoices where doc_type = 'credit_note') as credit_notes,
       (select count(*) from pg_trigger where tgrelid = 'public.invoices'::regclass
          and tgname in ('aa_invoice_snapshot', 'zz_invoice_immutable', 'zz_invoice_log')) as triggers;
