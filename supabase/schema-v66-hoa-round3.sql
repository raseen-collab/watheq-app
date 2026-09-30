-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v66: جولة الوضوح الثالثة لاتحاد الملاك (30 سبتمبر 2026)
--
-- ١) «أرسلت الحوالة» من صفحة المالك (نص فقط، بلا صور): hoa_payment_claims
--    pending/approved/rejected. الإدراج عبر دالة البوابة وحدها (مفتاح الخدمة)،
--    3 حوالات معلّقة كحد أقصى لكل مالك، المبلغ > 0 و ≤ رسمه×120، التاريخ ليس
--    في المستقبل ولا أقدم من 90 يومًا. الاعتماد يسجّل الدفعة بنفس دالة اللوحة
--    (p_request = معرّف الحوالة ⇒ لا تتكرر) ويصدر سندها؛ الرفض بسبب إلزامي.
-- ٢) «مسجّلة في ملاك» لكل دفعة: عمودان يُضبطان بدالة فقط (تسجيل الدفعات أو المدير)،
--    موثَّقان، ومسموح تغييرهما رغم حارس ثبات السند.
-- ٣) طلبات الصيانة من صفحة المالك: hoa_requests + سجل حالات hoa_request_log،
--    5 طلبات مفتوحة كحد أقصى لكل مالك. صفحة الشفافية تعرض أعدادًا فقط.
-- ٤) عدّ روابط الملاك الفعّالة (لدليل البداية) بلا كشف الرموز.
-- ٥) البوابة: الحوالات والطلبات وعلامة «ملاك»؛ وحذف الحساب يشمل الجداول الجديدة.
--
-- يتطلب schema-v65. آمن للتكرار. معاملة واحدة. لا يغيّر أي رقم قائم.
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════
begin;

do $$ begin
  if to_regprocedure('public.watheq_owner_confirm_opening(uuid, integer, integer)') is null
     or not exists (select 1 from pg_constraint where conrelid = 'public.payments'::regclass
                     and conname = 'payments_has_subject' and pg_get_constraintdef(oid) like '%association_id%') then
    raise exception 'شغّل schema-v64 ثم schema-v65 أولًا';
  end if;
end $$;

-- ── ١) الحوالات المُبلَّغ عنها ─────────────────────────────────
create table if not exists public.hoa_payment_claims (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  association_id      uuid not null references public.associations(id) on delete cascade,
  owner_id            uuid references public.owners(id) on delete set null,
  link_id             uuid references public.hoa_member_links(id) on delete set null,
  owner_name          text,
  unit                text,
  amount              numeric(12,2) not null check (amount > 0),
  transfer_date       date not null,
  bank_ref            text check (bank_ref is null or char_length(bank_ref) <= 80),
  note                text check (note is null or char_length(note) <= 300),
  status              text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_payment_id uuid references public.payments(id) on delete set null,
  reject_reason       text check (reject_reason is null or char_length(reject_reason) between 3 and 300),
  ip                  text check (ip is null or char_length(ip) <= 64),
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  decided_by          uuid,
  -- عدد مرات الاعتماد: بعد «تراجع» عن الدفعة تُعاد الحوالة معلّقة، ومفتاح الطلب للاعتماد التالي جديد
  approvals           int not null default 0,
  check (status <> 'rejected' or reject_reason is not null)
);
alter table public.hoa_payment_claims add column if not exists approvals int not null default 0;
create index if not exists hoa_payment_claims_assoc_idx on public.hoa_payment_claims (association_id, status, created_at desc);
create index if not exists hoa_payment_claims_owner_idx on public.hoa_payment_claims (owner_id, status);
alter table public.hoa_payment_claims enable row level security;
drop policy if exists hoa_claims_read on public.hoa_payment_claims;
create policy hoa_claims_read on public.hoa_payment_claims for select using (watheq_can_read(user_id));
revoke all on public.hoa_payment_claims from public, anon, authenticated, service_role;
grant select on public.hoa_payment_claims to authenticated, service_role;

-- ── ٢) طلبات الصيانة ─────────────────────────────────────────
create table if not exists public.hoa_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  association_id uuid not null references public.associations(id) on delete cascade,
  owner_id       uuid references public.owners(id) on delete set null,
  link_id        uuid references public.hoa_member_links(id) on delete set null,
  owner_name     text,
  unit           text,
  category       text not null check (category in ('plumbing', 'electric', 'elevator', 'cleaning', 'security', 'ac', 'other')),
  location       text not null check (location in ('common', 'unit')),
  description    text not null check (char_length(btrim(description)) between 3 and 1000),
  status         text not null default 'new' check (status in ('new', 'in_progress', 'done', 'rejected')),
  manager_note   text check (manager_note is null or char_length(manager_note) <= 500),
  expense_id     uuid references public.association_expenses(id) on delete set null,
  ip             text check (ip is null or char_length(ip) <= 64),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz
);
create index if not exists hoa_requests_assoc_idx on public.hoa_requests (association_id, status, created_at desc);
create index if not exists hoa_requests_owner_idx on public.hoa_requests (owner_id, status);
create table if not exists public.hoa_request_log (
  id          bigserial primary key,
  user_id     uuid not null,
  request_id  uuid not null references public.hoa_requests(id) on delete cascade,
  status_from text,
  status_to   text not null,
  note        text,
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index if not exists hoa_request_log_req_idx on public.hoa_request_log (request_id, id);
alter table public.hoa_requests enable row level security;
alter table public.hoa_request_log enable row level security;
drop policy if exists hoa_requests_read on public.hoa_requests;
create policy hoa_requests_read on public.hoa_requests for select using (watheq_can_read(user_id));
drop policy if exists hoa_request_log_read on public.hoa_request_log;
create policy hoa_request_log_read on public.hoa_request_log for select using (watheq_can_read(user_id));
revoke all on public.hoa_requests, public.hoa_request_log from public, anon, authenticated, service_role;
grant select on public.hoa_requests, public.hoa_request_log to authenticated, service_role;

-- ── ٣) علامة «مسجّلة في ملاك» على الدفعة ───────────────────────
alter table public.payments add column if not exists mullak_registered boolean not null default false;
alter table public.payments add column if not exists mullak_invoice_no text;
alter table public.payments add column if not exists mullak_marked_at timestamptz;
alter table public.payments add column if not exists mullak_marked_by uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_mullak_invoice_chk') then
    alter table public.payments add constraint payments_mullak_invoice_chk check (mullak_invoice_no is null or char_length(mullak_invoice_no) <= 60);
  end if;
end $$;
-- لا تُكتب مباشرة: التغيير عبر الدالة وحدها (watheq.src = 'mullak')
create or replace function public.watheq_payment_mullak_guard()
returns trigger language plpgsql as $$
begin
  if (new.mullak_registered, new.mullak_invoice_no, new.mullak_marked_at, new.mullak_marked_by)
     is distinct from (old.mullak_registered, old.mullak_invoice_no, old.mullak_marked_at, old.mullak_marked_by)
     and coalesce(current_setting('watheq.src', true), '') <> 'mullak' and auth.uid() is not null then
    raise exception 'علامة «ملاك» تُضبط من زرّها فقط' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists watheq_payment_mullak_guard on public.payments;
create trigger watheq_payment_mullak_guard before update on public.payments
  for each row execute function public.watheq_payment_mullak_guard();

create or replace function public.watheq_payment_set_mullak(p_payment uuid, p_registered boolean, p_invoice text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p payments%rowtype; office uuid; inv text := nullif(btrim(coalesce(p_invoice, '')), ''); src0 text := coalesce(current_setting('watheq.src', true), '');
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into p from payments where id = p_payment;
  if not found or p.association_id is null then raise exception 'الدفعة غير موجودة'; end if;
  select user_id into office from associations where id = p.association_id;
  if office is null or office is distinct from p.user_id or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  if p.amount <= 0 or p.reverses is not null then raise exception 'سطر العكس لا يُعلَّم'; end if;
  if inv is not null and char_length(inv) > 60 then raise exception 'رقم فاتورة ملاك أطول من المسموح'; end if;
  perform set_config('watheq.src', 'mullak', true);
  update payments set mullak_registered = coalesce(p_registered, false),
         mullak_invoice_no = case when coalesce(p_registered, false) then inv end,
         mullak_marked_at = now(), mullak_marked_by = auth.uid()
   where id = p.id;
  perform set_config('watheq.src', src0, true);
  insert into hoa_audit (user_id, association_id, owner_id, actor, source, action, before, after)
  values (office, p.association_id, p.owner_id, auth.uid(), 'mullak', 'payment_mullak',
          jsonb_build_object('payment_id', p.id, 'registered', p.mullak_registered, 'invoice', p.mullak_invoice_no),
          jsonb_build_object('payment_id', p.id, 'registered', coalesce(p_registered, false), 'invoice', case when coalesce(p_registered, false) then inv end));
  return jsonb_build_object('id', p.id, 'mullak_registered', coalesce(p_registered, false), 'mullak_invoice_no', case when coalesce(p_registered, false) then inv end);
end $$;
revoke all on function public.watheq_payment_set_mullak(uuid, boolean, text) from public, anon;
grant execute on function public.watheq_payment_set_mullak(uuid, boolean, text) to authenticated;

-- ── ٤) دوال البوابة (مفتاح الخدمة فقط) ─────────────────────────
-- حوالة أبلغ عنها المالك. الرموز: ok · invalid_link · bad_amount · bad_date · bad_ref · too_many · no_fee
create or replace function public.watheq_hoa_claim_submit(p_token text, p_amount numeric, p_date date,
  p_ref text default null, p_note text default null, p_ip text default null)
returns text language plpgsql security definer set search_path = public as $$
declare l hoa_member_links%rowtype; o owners%rowtype; a associations%rowtype; fee numeric; amt numeric := round(p_amount, 2);
        ref text := nullif(btrim(coalesce(p_ref, '')), ''); nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  l := watheq_hoa_link_resolve(p_token);
  if l.id is null then return 'invalid_link'; end if;
  select * into a from associations where id = l.association_id for update;   -- يسلسل عدّ المعلّقة
  select * into o from owners where id = l.owner_id;
  fee := coalesce(o.fee_override, a.fee, 0);
  if fee <= 0 then return 'no_fee'; end if;
  if amt is null or amt <= 0 or amt > fee * 120 then return 'bad_amount'; end if;
  if p_date is null or p_date > watheq_today() or p_date < watheq_today() - 90 then return 'bad_date'; end if;
  if (ref is not null and char_length(ref) > 80) or (nt is not null and char_length(nt) > 300) then return 'bad_ref'; end if;
  if (select count(*) from hoa_payment_claims where owner_id = o.id and status = 'pending') >= 3 then return 'too_many'; end if;
  insert into hoa_payment_claims (user_id, association_id, owner_id, link_id, owner_name, unit, amount, transfer_date, bank_ref, note, ip)
  values (l.user_id, l.association_id, o.id, l.id, o.name, o.unit, amt, p_date, ref, nt, left(p_ip, 64));
  update hoa_member_links set last_seen_at = now() where id = l.id;
  return 'ok';
end $$;

-- طلب صيانة. الرموز: ok · invalid_link · bad_category · bad_location · bad_text · too_many
create or replace function public.watheq_hoa_request_submit(p_token text, p_category text, p_location text,
  p_description text, p_ip text default null)
returns text language plpgsql security definer set search_path = public as $$
declare l hoa_member_links%rowtype; o owners%rowtype; rid uuid;
        d text := btrim(regexp_replace(coalesce(p_description, ''), '[ \t]+', ' ', 'g'));
begin
  l := watheq_hoa_link_resolve(p_token);
  if l.id is null then return 'invalid_link'; end if;
  if p_category is null or p_category not in ('plumbing', 'electric', 'elevator', 'cleaning', 'security', 'ac', 'other') then return 'bad_category'; end if;
  if p_location is null or p_location not in ('common', 'unit') then return 'bad_location'; end if;
  if char_length(d) not between 3 and 1000 then return 'bad_text'; end if;
  perform 1 from associations where id = l.association_id for update;
  select * into o from owners where id = l.owner_id;
  if (select count(*) from hoa_requests where owner_id = o.id and status in ('new', 'in_progress')) >= 5 then return 'too_many'; end if;
  insert into hoa_requests (user_id, association_id, owner_id, link_id, owner_name, unit, category, location, description, ip)
  values (l.user_id, l.association_id, o.id, l.id, o.name, o.unit, p_category, p_location, d, left(p_ip, 64))
  returning id into rid;
  insert into hoa_request_log (user_id, request_id, status_from, status_to, note) values (l.user_id, rid, null, 'new', 'فُتح من صفحة المالك');
  update hoa_member_links set last_seen_at = now() where id = l.id;
  return 'ok';
end $$;
revoke all on function public.watheq_hoa_claim_submit(text, numeric, date, text, text, text) from public, anon, authenticated;
revoke all on function public.watheq_hoa_request_submit(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.watheq_hoa_claim_submit(text, numeric, date, text, text, text) to service_role;
grant execute on function public.watheq_hoa_request_submit(text, text, text, text, text) to service_role;

-- ── ٥) دوال المكتب ─────────────────────────────────────────────
-- اعتماد الحوالة: تسجيل الدفعة بالدالة نفسها بمفتاح طلب مشتقّ من الحوالة ⇒ الضغط مرتين لا يكرّرها.
-- F1: دفعة غير معكوسة للمالك نفسه بالمبلغ نفسه (والمرجع نفسه أو خلال ±3 أيام) ⇒ رفض إلا مع p_force.
-- F2: الاعتماد الأول مفتاحه معرّف الحوالة؛ بعد «تراجع» يُشتق مفتاح جديد md5(الحوالة:العدّاد).
-- F3: الدفعة المرتجعة يجب أن تكون للمالك نفسه وبالمبلغ نفسه، وإلا «تعارض في معرّف الحوالة».
drop function if exists public.watheq_hoa_claim_approve(uuid);
create or replace function public.watheq_hoa_claim_approve(p_claim uuid, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c hoa_payment_claims%rowtype; office uuid; r jsonb; req uuid; pay payments%rowtype;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into c from hoa_payment_claims where id = p_claim for update;
  if not found then raise exception 'الحوالة غير موجودة'; end if;
  select user_id into office from associations where id = c.association_id;
  if office is null or office is distinct from c.user_id or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  if c.status = 'approved' then
    return jsonb_build_object('duplicate', true, 'claim_id', c.id, 'payment_id', c.approved_payment_id,
      'receipt_no', (select receipt_no from payments where id = c.approved_payment_id));
  end if;
  if c.status = 'rejected' then raise exception 'رُفضت هذه الحوالة من قبل'; end if;
  if c.owner_id is null then raise exception 'المالك حُذف — سجّل الدفعة يدويًّا إن لزم'; end if;
  if not coalesce(p_force, false) and exists (
      select 1 from payments p
       where p.owner_id = c.owner_id and p.amount = c.amount and p.amount > 0 and p.reverses is null
         and not exists (select 1 from payments x where x.reverses = p.id)
         and ((c.bank_ref is not null and p.reference = c.bank_ref) or abs(p.paid_on - c.transfer_date) <= 3)) then
    raise exception 'توجد دفعة مسجّلة بالمبلغ نفسه قريبًا من تاريخ الحوالة — راجعها أو اعتمد مع التأكيد';
  end if;
  req := case when c.approvals = 0 then c.id else md5(c.id::text || ':' || c.approvals::text)::uuid end;
  r := watheq_record_owner_payment(p_owner => c.owner_id, p_amount => c.amount, p_method => 'transfer',
         p_note => 'حوالة أبلغ عنها المالك' || coalesce(' — ' || c.note, ''), p_paid_on => c.transfer_date,
         p_reference => c.bank_ref, p_request => req);
  select * into pay from payments where id = (r->>'payment_id')::uuid;
  if not found or pay.owner_id is distinct from c.owner_id or pay.amount is distinct from c.amount then
    raise exception 'تعارض في معرّف الحوالة';
  end if;
  update hoa_payment_claims set status = 'approved', approved_payment_id = pay.id, approvals = approvals + 1,
         decided_at = now(), decided_by = auth.uid() where id = c.id;
  insert into hoa_audit (user_id, association_id, owner_id, actor, source, action, after)
  values (office, c.association_id, c.owner_id, auth.uid(), 'claims', 'claim_approve',
          jsonb_build_object('claim_id', c.id, 'amount', c.amount, 'payment_id', pay.id, 'receipt_no', r->>'receipt_no',
                             'forced', coalesce(p_force, false), 'attempt', c.approvals + 1));
  return r || jsonb_build_object('claim_id', c.id);
end $$;

create or replace function public.watheq_hoa_claim_reject(p_claim uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c hoa_payment_claims%rowtype; office uuid; rs text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into c from hoa_payment_claims where id = p_claim for update;
  if not found then raise exception 'الحوالة غير موجودة'; end if;
  select user_id into office from associations where id = c.association_id;
  if office is null or office is distinct from c.user_id or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  if c.status <> 'pending' then raise exception 'الحوالة ليست بانتظار المراجعة'; end if;
  if char_length(rs) not between 3 and 300 then raise exception 'اكتب سبب الرفض (3–300 حرف) — يظهر للمالك'; end if;
  update hoa_payment_claims set status = 'rejected', reject_reason = rs, decided_at = now(), decided_by = auth.uid() where id = c.id;
  insert into hoa_audit (user_id, association_id, owner_id, actor, source, action, after)
  values (office, c.association_id, c.owner_id, auth.uid(), 'claims', 'claim_reject',
          jsonb_build_object('claim_id', c.id, 'amount', c.amount, 'reason', rs));
  return true;
end $$;

-- حالة طلب الصيانة: كل تغيير يُسجَّل في hoa_request_log وفي التدقيق
create or replace function public.watheq_hoa_request_set_status(p_request uuid, p_status text,
  p_note text default null, p_expense uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r hoa_requests%rowtype; office uuid; nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into r from hoa_requests where id = p_request for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  select user_id into office from associations where id = r.association_id;
  if office is null or office is distinct from r.user_id or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in ('new', 'in_progress', 'done', 'rejected') then raise exception 'حالة غير معروفة'; end if;
  if nt is not null and char_length(nt) > 500 then raise exception 'الملاحظة أطول من المسموح'; end if;
  if p_status = 'rejected' and nt is null and r.manager_note is null then raise exception 'اكتب سبب الرفض — يظهر للمالك'; end if;
  if p_expense is not null and not exists (select 1 from association_expenses e where e.id = p_expense and e.association_id = r.association_id and e.reverses is null) then
    raise exception 'سند الصرف لا يتبع هذه الجمعية';
  end if;
  update hoa_requests set status = p_status, manager_note = coalesce(nt, manager_note), updated_at = now(),
         expense_id = coalesce(p_expense, expense_id),
         closed_at = case when p_status in ('done', 'rejected') then coalesce(closed_at, now()) else null end
   where id = r.id;
  insert into hoa_request_log (user_id, request_id, status_from, status_to, note, actor) values (office, r.id, r.status, p_status, nt, auth.uid());
  insert into hoa_audit (user_id, association_id, owner_id, actor, source, action, before, after)
  values (office, r.association_id, r.owner_id, auth.uid(), 'requests', 'request_status',
          jsonb_build_object('request_id', r.id, 'status', r.status), jsonb_build_object('request_id', r.id, 'status', p_status, 'note', nt));
  return jsonb_build_object('id', r.id, 'status', p_status, 'manager_note', coalesce(nt, r.manager_note));
end $$;

-- دليل البداية: كم مالكًا له رابط فعّال (بلا كشف الرموز) — لموظفي المكتب
create or replace function public.watheq_assoc_link_counts(p_assoc uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare office uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select user_id into office from associations where id = p_assoc;
  if office is null or not watheq_can_read(office) then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'owners', (select count(*) from owners where association_id = p_assoc),
    'linked', (select count(distinct k.owner_id) from hoa_member_links k join owners o on o.id = k.owner_id and o.association_id = p_assoc
                where k.association_id = p_assoc and k.revoked_at is null),
    'seen',   (select count(distinct k.owner_id) from hoa_member_links k join owners o on o.id = k.owner_id and o.association_id = p_assoc
                where k.association_id = p_assoc and k.revoked_at is null and k.last_seen_at is not null));
end $$;
revoke all on function public.watheq_hoa_claim_approve(uuid, boolean) from public, anon;
revoke all on function public.watheq_hoa_claim_reject(uuid, text) from public, anon;
revoke all on function public.watheq_hoa_request_set_status(uuid, text, text, uuid) from public, anon;
revoke all on function public.watheq_assoc_link_counts(uuid) from public, anon;
grant execute on function public.watheq_hoa_claim_approve(uuid, boolean) to authenticated;
grant execute on function public.watheq_hoa_claim_reject(uuid, text) to authenticated;
grant execute on function public.watheq_hoa_request_set_status(uuid, text, text, uuid) to authenticated;
grant execute on function public.watheq_assoc_link_counts(uuid) to authenticated;

-- ── ٥ب) العكس (يستبدل v64 بالسلوك نفسه) + إعادة الحوالة المرتبطة إلى «بانتظار المراجعة» ──
create or replace function public.watheq_reverse_owner_payment(p_payment uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; o owners%rowtype; assoc associations%rowtype; office uuid; actor uuid;
        fee numeric; s record; pid uuid; newbal numeric; r_late int; r_partial numeric; r_prepaid int; cl hoa_payment_claims%rowtype;
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

  -- v66 (F2): دفعة جاءت من حوالة مُبلَّغ عنها ⇒ تعود الحوالة «بانتظار المراجعة» (لا تبقى «اعتُمدت» بلا دفعة)
  for cl in select * from hoa_payment_claims where approved_payment_id = pay.id for update loop
    update hoa_payment_claims set status = 'pending', approved_payment_id = null, decided_at = null, decided_by = null
     where id = cl.id;
    insert into hoa_audit (user_id, association_id, owner_id, actor, source, action, before, after)
    values (office, cl.association_id, cl.owner_id, actor, 'claims', 'claim_reopen',
            jsonb_build_object('claim_id', cl.id, 'status', cl.status, 'payment_id', pay.id),
            jsonb_build_object('claim_id', cl.id, 'status', 'pending', 'reversal_id', pid));
  end loop;

  -- (v60 كان يقرأ s.late بلا مالك — المالك المحذوف كان يُسقط العكس بخطأ «record not assigned»)
  return jsonb_build_object('payment_id', pid, 'reversed', pay.amount, 'fund_balance', newbal,
    'months_late', r_late, 'partial_amount', r_partial, 'prepaid_months', r_prepaid);
end $$;
revoke all on function public.watheq_reverse_owner_payment(uuid, uuid) from public, anon;
grant execute on function public.watheq_reverse_owner_payment(uuid, uuid) to authenticated, service_role;

-- ── ٦) أعداد الطلبات في الشفافية (تستبدل v63) ─────────────────────
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
  -- v66: طلبات الصيانة أعدادًا فقط — الأوصاف قد تحوي أسماء فلا تُعرض أبدًا
  res := res || jsonb_build_object('requests', (select jsonb_build_object(
      'open', count(*) filter (where r.status in ('new', 'in_progress')),
      'closed', count(*) filter (where r.status in ('done', 'rejected')),
      'avg_days_to_close', round(avg(extract(epoch from (r.closed_at - r.created_at)) / 86400.0)
                                 filter (where r.status = 'done' and r.closed_at is not null), 1))
    from hoa_requests r where r.association_id = a.id));
  return res || jsonb_build_object('collection_pct',
    case when (res->>'owners_total')::int > 0
         then round(100.0 * (res->>'owners_paid')::int / (res->>'owners_total')::int)::int else null end);
end $$;
revoke all on function public.watheq_hoa_building_data(uuid) from public, anon, authenticated;

-- ── ٧) البوابة (تستبدل v64) ─────────────────────────────────────
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
               'receipt_no', p.receipt_no, 'payer_name', p.payer_name, 'unit_label', p.unit_label,
               'mullak_registered', coalesce(p.mullak_registered, false))
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
    -- v66: حوالات أبلغ عنها هذا المالك وحالتها، وطلبات الصيانة التي فتحها (له وحده)
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'amount', c.amount, 'transfer_date', c.transfer_date,
               'bank_ref', c.bank_ref, 'status', c.status, 'reject_reason', c.reject_reason,
               'approved_payment_id', c.approved_payment_id, 'created_at', c.created_at) order by c.created_at desc)
        from (select * from hoa_payment_claims c0 where c0.owner_id = l.owner_id and c0.association_id = l.association_id
                and c0.user_id = l.user_id order by c0.created_at desc limit 10) c), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'category', r.category, 'location', r.location,
               'description', r.description, 'status', r.status, 'manager_note', r.manager_note,
               'created_at', r.created_at, 'updated_at', r.updated_at, 'closed_at', r.closed_at) order by r.created_at desc)
        from (select * from hoa_requests r0 where r0.owner_id = l.owner_id and r0.association_id = l.association_id
                and r0.user_id = l.user_id order by r0.created_at desc limit 10) r), '[]'::jsonb),
    'building', watheq_hoa_building_data(l.association_id)
  ) into res;
  return res;
end $$;
revoke all on function public.watheq_hoa_portal(text) from public, anon, authenticated;
grant execute on function public.watheq_hoa_portal(text) to service_role;

-- ── ٨) حذف الحساب يشمل الجداول الجديدة (تستبدل v64) ───────────────
create or replace function public.watheq_purge_office_hoa(p_office uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_sig int; n_doc int; n_link int; n_exp int; n_pay int; n_aud int; n_assoc int;
begin
  if p_office is null then raise exception 'office required'; end if;
  if auth.uid() is not null then raise exception 'not authorized'; end if;
  perform set_config('watheq.purge', '1', true);
  -- v66: الحوالات (تشير إلى الدفعات) وطلبات الصيانة وسجلها أولًا
  delete from hoa_payment_claims where user_id = p_office;
  delete from hoa_request_log where user_id = p_office;
  delete from hoa_requests where user_id = p_office;
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

commit;

-- ── فحص: صف واحد ──
select
  to_regclass('public.hoa_payment_claims') is not null as جدول_الحوالات,
  to_regclass('public.hoa_requests') is not null as جدول_طلبات_الصيانة,
  has_table_privilege('authenticated', 'public.hoa_payment_claims', 'insert') as إدراج_الحوالة_مباشرة_يجب_false,
  has_table_privilege('service_role', 'public.hoa_requests', 'insert') as إدراج_الطلب_بمفتاح_الخدمة_مباشرة_يجب_false,
  has_function_privilege('authenticated', 'public.watheq_hoa_claim_submit(text, numeric, date, text, text, text)', 'execute') as البوابة_لـauthenticated_يجب_false,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name like 'mullak_%') as أعمدة_ملاك_المتوقع_4,
  (select count(*) from pg_trigger where tgname = 'watheq_payment_mullak_guard' and not tgisinternal) as حارس_علامة_ملاك,
  (select count(*) from public.hoa_payment_claims where status = 'pending') as حوالات_معلّقة;
