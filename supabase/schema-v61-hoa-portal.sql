-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v61: بوابة الملّاك في اتحاد الملاك (30 سبتمبر 2026)
--
-- الفكرة: كل مالك وحدة يصله رابط خاص عبر واتساب (بلا حساب ولا كلمة مرور)
-- يرى فيه ما يخصّه وحده: حالة اشتراكه، دفعاته وسنداتها، ومستندات الجمعية
-- (محاضر، إشعارات، تعاميم) — ويعتمد أو يرفض ما يحتاج توقيعًا.
--
-- ١) hoa_member_links — رابط واحد فعّال لكل مالك. الرمز 64 خانة hex من
--    gen_random_uuid (قرابة 244 بتًّا عشوائيًّا). الإبطال بتاريخ لا بالحذف.
-- ٢) hoa_documents — نسخة المستند كما صدرت (HTML منظَّف) مع بصمة sha256.
--    لا يُعدَّل بعد الإصدار؛ الشيء الوحيد المسموح: الإلغاء (cancelled_at).
-- ٣) hoa_signatures — سجل إلحاقي فقط: «اطّلع» مرة، و«اعتمد/رفض» مرة، ولا
--    يُعدَّل القرار ولا يُحذف بعد تسجيله (مشغّل يمنع ذلك حتى بمفتاح الخدمة).
--    يُحفظ مع القرار: الاسم المكتوب، الوقت، IP، المتصفح، وبصمة المستند —
--    دليل موثَّق على الاطلاع والموافقة، لكنه ليس توقيعًا إلكترونيًّا معتمدًا (نفاذ).
-- ٤) الصلاحيات: موظفو المكتب يقرؤون (watheq_can_read). إنشاء الرابط وإبطاله
--    بصلاحية «تسجيل الدفعات»، وإصدار المستند وإلغاؤه لمدير المكتب — عبر دوال
--    فقط. صفحة المالك العامة لا تمرّ على anon إطلاقًا: دوال البوابة
--    (watheq_hoa_portal*) لمفتاح الخدمة وحده، تُستدعى من خادم Next.
--
-- يتطلب schema-v60 (watheq_today و watheq_hoa_accrue_locked).
-- آمن للتكرار. معاملة واحدة. لا يغيّر أي بيانات قائمة.
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

do $$ begin
  if to_regprocedure('public.watheq_today()') is null
     or to_regprocedure('public.watheq_hoa_accrue_locked(public.associations)') is null then
    raise exception 'شغّل schema-v60 أولًا';
  end if;
end $$;

-- ── ١) الجداول ─────────────────────────────────────────────────
create table if not exists public.hoa_member_links (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  association_id uuid not null references public.associations(id) on delete cascade,
  owner_id       uuid not null references public.owners(id) on delete cascade,
  token          text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  created_by     uuid,
  revoked_at     timestamptz,
  last_seen_at   timestamptz
);
create unique index if not exists hoa_member_links_one_active
  on public.hoa_member_links (owner_id) where revoked_at is null;
create index if not exists hoa_member_links_assoc_idx on public.hoa_member_links (association_id);

create table if not exists public.hoa_documents (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  association_id     uuid not null references public.associations(id) on delete cascade,
  kind               text not null check (kind in ('minutes','notice','circular','budget','other')),
  title              text not null check (char_length(btrim(title)) between 1 and 200),
  body_html          text not null default '' check (char_length(body_html) <= 200000),
  body_sha256        text,
  requires_signature boolean not null default false,
  closes_at          date,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  cancelled_at       timestamptz
);
create index if not exists hoa_documents_assoc_idx on public.hoa_documents (association_id, created_at desc);

create table if not exists public.hoa_signatures (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  association_id uuid not null,
  document_id    uuid not null references public.hoa_documents(id) on delete cascade,
  owner_id       uuid references public.owners(id) on delete set null,
  owner_name     text,
  unit           text,
  link_id        uuid references public.hoa_member_links(id) on delete set null,
  decision       text not null check (decision in ('approve','reject','seen')),
  typed_name     text check (typed_name is null or char_length(typed_name) <= 80),
  comment        text check (comment is null or char_length(comment) <= 500),
  doc_sha256     text,
  signed_at      timestamptz not null default now(),
  ip             text check (ip is null or char_length(ip) <= 64),
  user_agent     text check (user_agent is null or char_length(user_agent) <= 300),
  check (decision = 'seen' or char_length(btrim(coalesce(typed_name, ''))) between 1 and 80)
);
-- «اطّلع» مرة، وقرار (اعتماد/رفض) مرة — لكل مالك في كل مستند
create unique index if not exists hoa_signatures_one_decision
  on public.hoa_signatures (document_id, owner_id) where decision in ('approve','reject');
create unique index if not exists hoa_signatures_one_seen
  on public.hoa_signatures (document_id, owner_id) where decision = 'seen';
create index if not exists hoa_signatures_doc_idx on public.hoa_signatures (document_id);

-- ── ٢) عدم القابلية للتعديل ────────────────────────────────────
-- المستند: لا يتغيّر نصّه ولا عنوانه ولا جمعيته بعد الإصدار؛ الإلغاء فقط (مرة).
create or replace function public.watheq_hoa_doc_immutable()
returns trigger language plpgsql as $$
begin
  if (new.id, new.user_id, new.association_id, new.kind, new.title, new.body_html, new.body_sha256,
      new.requires_signature, new.closes_at, new.created_by, new.created_at)
     is distinct from
     (old.id, old.user_id, old.association_id, old.kind, old.title, old.body_html, old.body_sha256,
      old.requires_signature, old.closes_at, old.created_by, old.created_at)
     or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at)
     or (new.cancelled_at is null and old.cancelled_at is not null) then
    raise exception 'المستند الصادر لا يُعدَّل — ألغِه وأصدر نسخة جديدة' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists watheq_hoa_doc_immutable on public.hoa_documents;
create trigger watheq_hoa_doc_immutable before update on public.hoa_documents
  for each row execute function public.watheq_hoa_doc_immutable();

-- التوقيع: لا تعديل ولا حذف. المسموح فقط ما تفعله القاعدة نفسها:
-- فكّ الربط عند حذف المالك/الرابط (set null)، والحذف المتسلسل مع المستند.
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
  -- DELETE: فقط حين يكون المستند نفسه قد حُذف (حذف الجمعية بالتسلسل)
  if exists (select 1 from public.hoa_documents d where d.id = old.document_id) then
    raise exception 'القرار المسجَّل لا يُحذف' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists watheq_hoa_sig_append_only on public.hoa_signatures;
create trigger watheq_hoa_sig_append_only before update or delete on public.hoa_signatures
  for each row execute function public.watheq_hoa_sig_append_only();

-- ── ٣) RLS والصلاحيات ─────────────────────────────────────────
alter table public.hoa_member_links enable row level security;
alter table public.hoa_documents    enable row level security;
alter table public.hoa_signatures   enable row level security;

-- الرمز يفتح صفحة المالك ويوقّع باسمه — لا يراه إلا من يملك إنشاءه
drop policy if exists hoa_links_read on public.hoa_member_links;
create policy hoa_links_read on public.hoa_member_links for select
  using (watheq_perm(user_id, 'record_payments'));
drop policy if exists hoa_docs_read on public.hoa_documents;
create policy hoa_docs_read on public.hoa_documents for select using (watheq_can_read(user_id));
drop policy if exists hoa_sigs_read on public.hoa_signatures;
create policy hoa_sigs_read on public.hoa_signatures for select using (watheq_can_read(user_id));

revoke all on public.hoa_member_links, public.hoa_documents, public.hoa_signatures from public, anon, authenticated;
grant select on public.hoa_member_links, public.hoa_documents, public.hoa_signatures to authenticated;
grant select, insert, update on public.hoa_member_links, public.hoa_documents, public.hoa_signatures to service_role;
revoke delete, truncate on public.hoa_signatures from service_role;

-- ── ٤) دوال المكتب (authenticated) ────────────────────────────
create or replace function public.watheq_hoa_link_get_or_create(p_owner uuid)
returns text language plpgsql security definer set search_path = public as $$
declare o owners%rowtype; office uuid; tok text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into o from owners where id = p_owner;
  if not found then raise exception 'المالك غير موجود'; end if;
  select user_id into office from associations where id = o.association_id;
  if office is null or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;

  -- كل اطّلاع على رابط مالك يُوثَّق (الرابط يخوّل الاعتماد باسمه)
  insert into hoa_audit (user_id, association_id, owner_id, actor, source, action)
  values (office, o.association_id, p_owner, auth.uid(), 'portal', 'link_view');

  select token into tok from hoa_member_links where owner_id = p_owner and revoked_at is null;
  if found then return tok; end if;

  insert into hoa_member_links (user_id, association_id, owner_id, token, created_by)
  values (office, o.association_id, p_owner,
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          auth.uid())
  on conflict (owner_id) where revoked_at is null do nothing;
  -- ضغطتان متزامنتان: الثانية تأخذ رابط الأولى
  select token into tok from hoa_member_links where owner_id = p_owner and revoked_at is null;
  return tok;
end $$;

create or replace function public.watheq_hoa_link_revoke(p_owner uuid)
returns int language plpgsql security definer set search_path = public as $$
declare office uuid; n int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select a.user_id into office from owners o join associations a on a.id = o.association_id where o.id = p_owner;
  if office is null or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  update hoa_member_links set revoked_at = now()
   where owner_id = p_owner and user_id = office and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.watheq_hoa_document_create(
  p_assoc uuid, p_kind text, p_title text, p_body_html text,
  p_requires_signature boolean default false, p_closes_at date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare office uuid; body text := coalesce(p_body_html, ''); did uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select user_id into office from associations where id = p_assoc;
  if office is null or not watheq_can_manage(office) then raise exception 'not authorized'; end if;
  if p_kind is null or p_kind not in ('minutes','notice','circular','budget','other') then
    raise exception 'نوع المستند غير معروف';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200 then
    raise exception 'عنوان المستند مطلوب (200 حرف كحد أقصى)';
  end if;
  if char_length(body) > 200000 then raise exception 'نص المستند أطول من المسموح'; end if;
  -- التنظيف الكامل في الخادم (lib/hoaSanitize.ts) وعند العرض؛ هنا حاجز أخير لمن يستدعي الدالة مباشرة
  if body ~* '<\s*/?\s*(script|iframe|object|embed|style|link|meta|base|form|svg|math)\M'
     or body ~* '<[^>]*\son[a-z]+\s*='
     or body ~* '<[^>]*(javascript|vbscript|data)\s*:' then
    raise exception 'نص المستند يحتوي عناصر غير مسموحة';
  end if;
  if p_closes_at is not null and p_closes_at < watheq_today() then
    raise exception 'آخر موعد للرد لا يكون في الماضي';
  end if;
  insert into hoa_documents (user_id, association_id, kind, title, body_html, body_sha256,
                             requires_signature, closes_at, created_by)
  values (office, p_assoc, p_kind, btrim(p_title), body,
          encode(sha256(convert_to(body, 'UTF8')), 'hex'),
          coalesce(p_requires_signature, false),
          case when coalesce(p_requires_signature, false) then p_closes_at end, auth.uid())
  returning id into did;
  return did;
end $$;

create or replace function public.watheq_hoa_document_cancel(p_doc uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare office uuid; n int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select user_id into office from hoa_documents where id = p_doc;
  if office is null or not watheq_can_manage(office) then raise exception 'not authorized'; end if;
  update hoa_documents set cancelled_at = now() where id = p_doc and cancelled_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.watheq_hoa_link_get_or_create(uuid) from public, anon;
revoke all on function public.watheq_hoa_link_revoke(uuid) from public, anon;
revoke all on function public.watheq_hoa_document_create(uuid, text, text, text, boolean, date) from public, anon;
revoke all on function public.watheq_hoa_document_cancel(uuid) from public, anon;
grant execute on function public.watheq_hoa_link_get_or_create(uuid) to authenticated;
grant execute on function public.watheq_hoa_link_revoke(uuid) to authenticated;
grant execute on function public.watheq_hoa_document_create(uuid, text, text, text, boolean, date) to authenticated;
grant execute on function public.watheq_hoa_document_cancel(uuid) to authenticated;

-- ── ٥) دوال البوابة العامة (مفتاح الخدمة فقط) ───────────────────
-- الرابط الفعّال بشرط أن المالك ما زال في جمعيته وأن الجمعية لنفس المكتب.
-- المجهول والمُبطَل يرجعان null بالطريقة نفسها.
create or replace function public.watheq_hoa_link_resolve(p_token text)
returns public.hoa_member_links language plpgsql stable security definer set search_path = public as $$
declare l hoa_member_links%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select k.* into l from hoa_member_links k
    join owners o on o.id = k.owner_id and o.association_id = k.association_id
    join associations a on a.id = k.association_id and a.user_id = k.user_id
   where k.token = p_token and k.revoked_at is null;
  if not found then return null; end if;
  return l;
end $$;

create or replace function public.watheq_hoa_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l hoa_member_links%rowtype; a associations%rowtype; o owners%rowtype; res jsonb;
begin
  l := watheq_hoa_link_resolve(p_token);
  if l.id is null then return null; end if;

  -- الاستحقاق الشهري قبل العرض: لا يرى المالك رصيدًا قبل استحقاق هذا الشهر
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
               'method', p.method, 'reference', p.reference, 'periods_covered', p.periods_covered, 'receipt_no', p.receipt_no, 'payer_name', p.payer_name, 'unit_label', p.unit_label)
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
       where d.association_id = l.association_id and d.user_id = l.user_id and d.cancelled_at is null), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- فتح مستند: يُرجعه مع قرار هذا المالك وحده، ويسجّل «اطّلع» مرة واحدة
create or replace function public.watheq_hoa_portal_doc(p_token text, p_doc uuid, p_ip text default null, p_ua text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l hoa_member_links%rowtype; d hoa_documents%rowtype; o owners%rowtype; aname text;
begin
  l := watheq_hoa_link_resolve(p_token);
  if l.id is null then return null; end if;
  select * into d from hoa_documents
   where id = p_doc and association_id = l.association_id and user_id = l.user_id and cancelled_at is null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into o from owners where id = l.owner_id;
  select name into aname from associations where id = l.association_id;

  update hoa_member_links set last_seen_at = now() where id = l.id;
  insert into hoa_signatures (user_id, association_id, document_id, owner_id, owner_name, unit, link_id,
                              decision, doc_sha256, ip, user_agent)
  values (l.user_id, l.association_id, d.id, l.owner_id, o.name, o.unit, l.id, 'seen', d.body_sha256,
          left(p_ip, 64), left(p_ua, 300))
  on conflict (document_id, owner_id) where decision = 'seen' do nothing;

  return jsonb_build_object('status', 'ok',
    'association', jsonb_build_object('name', aname),
    'owner', jsonb_build_object('name', o.name, 'unit', o.unit),
    'today', watheq_today(),
    'document', jsonb_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'body_html', d.body_html,
                  'body_sha256', d.body_sha256, 'created_at', d.created_at,
                  'requires_signature', d.requires_signature, 'closes_at', d.closes_at),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('decision', s.decision, 'signed_at', s.signed_at,
                        'typed_name', s.typed_name) order by s.signed_at)
                        from hoa_signatures s where s.document_id = d.id and s.owner_id = l.owner_id), '[]'::jsonb));
end $$;

-- القرار: كل الشروط داخل القاعدة بقراءة واحدة متسقة
create or replace function public.watheq_hoa_sign(p_token text, p_doc uuid, p_decision text,
  p_typed_name text, p_comment text default null, p_ip text default null, p_ua text default null)
returns text language plpgsql security definer set search_path = public as $$
declare l hoa_member_links%rowtype; d hoa_documents%rowtype; o owners%rowtype;
        nm text := btrim(regexp_replace(coalesce(p_typed_name, ''), '\s+', ' ', 'g')); n int;
begin
  l := watheq_hoa_link_resolve(p_token);
  if l.id is null then return 'invalid_link'; end if;
  select * into d from hoa_documents
   where id = p_doc and association_id = l.association_id and user_id = l.user_id;
  if not found then return 'not_found'; end if;
  if d.cancelled_at is not null then return 'cancelled'; end if;
  if not d.requires_signature then return 'not_required'; end if;
  if d.closes_at is not null and d.closes_at < watheq_today() then return 'closed'; end if;
  if p_decision is null or p_decision not in ('approve','reject') then return 'bad_decision'; end if;
  if char_length(nm) not between 1 and 80 then return 'bad_name'; end if;
  if exists (select 1 from hoa_signatures where document_id = d.id and owner_id = l.owner_id
               and decision in ('approve','reject')) then
    return 'duplicate';
  end if;
  select * into o from owners where id = l.owner_id;

  update hoa_member_links set last_seen_at = now() where id = l.id;
  insert into hoa_signatures (user_id, association_id, document_id, owner_id, owner_name, unit, link_id,
                              decision, typed_name, comment, doc_sha256, ip, user_agent)
  values (l.user_id, l.association_id, d.id, l.owner_id, o.name, o.unit, l.id, p_decision, nm,
          nullif(left(btrim(coalesce(p_comment, '')), 500), ''), d.body_sha256, left(p_ip, 64), left(p_ua, 300))
  on conflict (document_id, owner_id) where decision in ('approve','reject') do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'ok' else 'duplicate' end;
end $$;

revoke all on function public.watheq_hoa_link_resolve(text) from public, anon, authenticated;
revoke all on function public.watheq_hoa_portal(text) from public, anon, authenticated;
revoke all on function public.watheq_hoa_portal_doc(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.watheq_hoa_sign(text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.watheq_hoa_portal(text) to service_role;
grant execute on function public.watheq_hoa_portal_doc(text, uuid, text, text) to service_role;
grant execute on function public.watheq_hoa_sign(text, uuid, text, text, text, text, text) to service_role;

commit;

-- ── فحص: صف واحد ──
select
  to_regclass('public.hoa_member_links') is not null as جدول_الروابط,
  to_regclass('public.hoa_documents') is not null   as جدول_المستندات,
  to_regclass('public.hoa_signatures') is not null  as جدول_القرارات,
  (select count(*) from pg_policies where tablename in ('hoa_member_links','hoa_documents','hoa_signatures')) as السياسات_المتوقع_3,
  (select count(*) from information_schema.triggers where trigger_name in
     ('watheq_hoa_doc_immutable','watheq_hoa_sig_append_only')) as المشغّلات_المتوقع_3,
  has_function_privilege('anon', 'public.watheq_hoa_portal(text)', 'execute') as البوابة_لـanon_يجب_false,
  has_function_privilege('authenticated', 'public.watheq_hoa_sign(text, uuid, text, text, text, text, text)', 'execute') as التوقيع_لـauthenticated_يجب_false,
  has_table_privilege('authenticated', 'public.hoa_signatures', 'update') as تعديل_القرار_يجب_false,
  (select count(*) from public.hoa_member_links where revoked_at is null) as روابط_فعّالة;
