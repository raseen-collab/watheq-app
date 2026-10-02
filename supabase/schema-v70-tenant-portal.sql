-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v70: رابط المستأجر في إدارة الأملاك + تنبيه تليجرام فوري (3 أكتوبر 2026)
--
-- الفكرة نفسها في بوابة مالك الجمعية (v61/v66) لكن للمستأجر:
-- رابط خاص يُرسل واتساب، بلا حساب ولا كلمة مرور. يرى فيه المستأجر:
--   • عقده: الدفعة القادمة وتاريخها، وسجل دفعاته في المدة الحالية.
--   • المتأخر عليه — ظاهر افتراضيًّا، والمكتب يخفيه لكل وحدة (show_balance).
--   • «أرسلت الحوالة» (نص فقط) — يراجعها المكتب: يعتمدها فتُسجَّل الدفعة بدالة
--     التسجيل نفسها (watheq_record_payment) أو يرفضها بسبب يراه المستأجر.
--   • طلبات الصيانة (نص فقط) — يتابع المكتب حالتها.
--
-- الأمان:
--   ١) الرمز 64 خانة hex من gen_random_uuid ×2. رابط فعّال واحد لكل وحدة.
--   ٢) الرابط مربوط بالمستأجر نفسه: يُبطَل تلقائيًّا عند الإخلاء أو تغيير اسم
--      المستأجر (إعادة التأجير)، والتحقق يتكرر عند كل فتح — فلا يرى مستأجر
--      سابق بيانات من بعده.
--   ٣) لا هوية ولا جوال ولا ملاحظات داخلية في الصفحة: قائمة حقول محددة فقط.
--   ٤) دوال الصفحة لمفتاح الخدمة وحده (خادم Next)، ولا تمرّ على anon أبدًا.
--   ٥) حدود: 3 حوالات معلّقة و5 طلبات مفتوحة لكل وحدة؛ المبلغ والتاريخ يُفحصان.
--   ٦) الاشتراك المنتهي: الصفحة للقراءة فقط (لا بلاغات جديدة).
--   ٧) عكس دفعة جاءت من حوالة ⇒ تعود الحوالة «بانتظار المراجعة» (مشغّل).
--
-- تنبيه تليجرام: watheq_portal_notify_info تُرجع محادثة المكتب وبيانات البلاغ
-- لخادم Next ليرسل تنبيهًا فوريًّا — للمستأجر هنا ولمالك الجمعية (v66) أيضًا.
--
-- يتطلب v66 و v67. آمن للتكرار. معاملة واحدة. لا يغيّر أي بيانات قائمة.
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════
begin;

do $$ begin
  if to_regprocedure('public.watheq_record_payment(uuid, numeric, text, text, date, uuid, text)') is null
     or to_regprocedure('public.watheq_hoa_link_resolve(text)') is null
     or to_regprocedure('public.watheq_product_state(uuid, text)') is null
     or to_regprocedure('public.watheq_today()') is null then
    raise exception 'شغّل schema-v66 و schema-v67 أولًا';
  end if;
end $$;

-- اسم موحَّد للمقارنة: مسافات مضغوطة وحروف صغيرة
create or replace function public.watheq_norm_name(p text)
returns text language sql immutable as $$
  select lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')))
$$;

-- ── ١) الجداول ─────────────────────────────────────────────────
create table if not exists public.tenant_portal_links (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  property_id   uuid not null references public.properties(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  tenant_name   text not null,                    -- الاسم عند الإنشاء — تغيّره يُبطل الرابط
  token         text not null unique check (token ~ '^[0-9a-f]{64}$'),
  show_balance  boolean not null default true,    -- إظهار المتأخر للمستأجر
  created_at    timestamptz not null default now(),
  created_by    uuid,
  revoked_at    timestamptz,
  last_seen_at  timestamptz
);
create unique index if not exists tenant_portal_links_one_active
  on public.tenant_portal_links (tenant_id) where revoked_at is null;
create index if not exists tenant_portal_links_prop_idx on public.tenant_portal_links (property_id);

create table if not exists public.tenant_payment_claims (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  property_id         uuid not null references public.properties(id) on delete cascade,
  tenant_id           uuid references public.tenants(id) on delete cascade,
  link_id             uuid references public.tenant_portal_links(id) on delete set null,
  tenant_name         text,
  unit                text,
  amount              numeric(12,2) not null check (amount > 0),
  transfer_date       date not null,
  bank_ref            text check (bank_ref is null or char_length(bank_ref) <= 80),
  note                text check (note is null or char_length(note) <= 300),
  status              text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_payment_id uuid references public.payments(id) on delete set null,
  recorded_amount     numeric(12,2),                -- ما سُجّل فعلًا (قد يختلف: الضريبة المضافة أو تصحيح المكتب)
  reject_reason       text check (reject_reason is null or char_length(reject_reason) between 3 and 300),
  ip                  text check (ip is null or char_length(ip) <= 64),
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  decided_by          uuid,
  check (status <> 'rejected' or reject_reason is not null)
);
create index if not exists tenant_claims_office_idx on public.tenant_payment_claims (user_id, status, created_at desc);
create index if not exists tenant_claims_tenant_idx on public.tenant_payment_claims (tenant_id, status);
create index if not exists tenant_claims_payment_idx on public.tenant_payment_claims (approved_payment_id) where approved_payment_id is not null;

create table if not exists public.tenant_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  property_id   uuid not null references public.properties(id) on delete cascade,
  tenant_id     uuid references public.tenants(id) on delete cascade,
  link_id       uuid references public.tenant_portal_links(id) on delete set null,
  tenant_name   text,
  unit          text,
  category      text not null check (category in ('plumbing', 'electric', 'elevator', 'cleaning', 'security', 'ac', 'other')),
  location      text not null check (location in ('common', 'unit')),
  description   text not null check (char_length(btrim(description)) between 3 and 1000),
  status        text not null default 'new' check (status in ('new', 'in_progress', 'done', 'rejected')),
  manager_note  text check (manager_note is null or char_length(manager_note) <= 500),
  ip            text check (ip is null or char_length(ip) <= 64),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists tenant_requests_office_idx on public.tenant_requests (user_id, status, created_at desc);
create index if not exists tenant_requests_tenant_idx on public.tenant_requests (tenant_id, status);

-- سجل موحَّد: إنشاء الرابط وإبطاله، قرارات الحوالات، حالات الطلبات
create table if not exists public.tenant_portal_audit (
  id          bigserial primary key,
  user_id     uuid not null,
  property_id uuid,
  tenant_id   uuid,
  actor       uuid,
  action      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists tenant_portal_audit_idx on public.tenant_portal_audit (user_id, created_at desc);
-- مراحل طلب الصيانة تُعرض للمستأجر (تم الاستلام ← تمت المراجعة ← تمت الصيانة)
create index if not exists tenant_portal_audit_req_idx on public.tenant_portal_audit ((detail->>'request_id'), id)
  where action = 'request_status';

-- ── ٢) RLS والصلاحيات: قراءة لموظفي المكتب، والكتابة عبر الدوال فقط ──
alter table public.tenant_portal_links   enable row level security;
alter table public.tenant_payment_claims enable row level security;
alter table public.tenant_requests       enable row level security;
alter table public.tenant_portal_audit   enable row level security;

-- الرمز يفتح صفحة المستأجر — لا يراه إلا من يملك إنشاءه
drop policy if exists tenant_links_read on public.tenant_portal_links;
create policy tenant_links_read on public.tenant_portal_links for select using (watheq_perm(user_id, 'record_payments'));
drop policy if exists tenant_claims_read on public.tenant_payment_claims;
create policy tenant_claims_read on public.tenant_payment_claims for select using (watheq_can_read(user_id));
drop policy if exists tenant_requests_read on public.tenant_requests;
create policy tenant_requests_read on public.tenant_requests for select using (watheq_can_read(user_id));
drop policy if exists tenant_audit_read on public.tenant_portal_audit;
create policy tenant_audit_read on public.tenant_portal_audit for select using (watheq_can_read(user_id));

revoke all on public.tenant_portal_links, public.tenant_payment_claims, public.tenant_requests, public.tenant_portal_audit
  from public, anon, authenticated, service_role;
grant select on public.tenant_portal_links, public.tenant_payment_claims, public.tenant_requests, public.tenant_portal_audit
  to authenticated, service_role;
-- حذف الحساب (مفتاح الخدمة) يحذف صفوفه
grant delete on public.tenant_portal_links, public.tenant_payment_claims, public.tenant_requests, public.tenant_portal_audit
  to service_role;
revoke all on sequence public.tenant_portal_audit_id_seq from public, anon, authenticated;

-- حارس الاشتراك (v67) على الجداول الجديدة: المكتب المنتهي لا يُنشئ روابط ولا يقرّر
do $$
declare t text;
begin
  if to_regprocedure('public.watheq_entitlement_guard()') is not null then
    foreach t in array array['tenant_portal_links', 'tenant_payment_claims', 'tenant_requests'] loop
      execute format('drop trigger if exists zz_entitlement_guard on public.%I', t);
      execute format('create trigger zz_entitlement_guard before insert or update or delete on public.%I
                      for each row execute function public.watheq_entitlement_guard(%L)', t, 'property');
    end loop;
  end if;
end $$;

-- ── ٣) الإبطال التلقائي: الإخلاء أو تغيير اسم المستأجر ─────────────
create or replace function public.watheq_tenant_link_autorevoke()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (coalesce(new.status, 'active') = 'vacated' and coalesce(old.status, 'active') <> 'vacated')
     or watheq_norm_name(new.name) <> watheq_norm_name(old.name) then
    update tenant_portal_links set revoked_at = now() where tenant_id = new.id and revoked_at is null;
  end if;
  return new;
end $$;
revoke all on function public.watheq_tenant_link_autorevoke() from public, anon, authenticated;
drop trigger if exists watheq_tenant_link_autorevoke on public.tenants;
create trigger watheq_tenant_link_autorevoke after update of status, name on public.tenants
  for each row execute function public.watheq_tenant_link_autorevoke();

-- عكس دفعة جاءت من حوالة ⇒ تعود الحوالة «بانتظار المراجعة» (لا تبقى «اعتُمدت» بلا دفعة).
-- يغطي «عكس دفعة» و«تراجع عن آخر دفعة» معًا لأن كليهما يُدرج سطر عكس.
create or replace function public.watheq_tenant_claim_reopen()
returns trigger language plpgsql security definer set search_path = public as $$
declare c tenant_payment_claims%rowtype;
begin
  if new.reverses is null then return new; end if;
  for c in select * from tenant_payment_claims where approved_payment_id = new.reverses for update loop
    update tenant_payment_claims set status = 'pending', approved_payment_id = null, recorded_amount = null,
           decided_at = null, decided_by = null where id = c.id;
    insert into tenant_portal_audit (user_id, property_id, tenant_id, actor, action, detail)
    values (c.user_id, c.property_id, c.tenant_id, new.created_by, 'claim_reopen',
            jsonb_build_object('claim_id', c.id, 'payment_id', new.reverses, 'reversal_id', new.id));
  end loop;
  return new;
end $$;
revoke all on function public.watheq_tenant_claim_reopen() from public, anon, authenticated;
drop trigger if exists watheq_tenant_claim_reopen on public.payments;
create trigger watheq_tenant_claim_reopen after insert on public.payments
  for each row when (new.reverses is not null) execute function public.watheq_tenant_claim_reopen();

-- ── ٤) دوال المكتب (authenticated) ────────────────────────────
-- الرابط: يُنشأ إن لم يوجد. صلاحية «تسجيل الدفعات» (الرابط يستقبل بلاغات مالية).
create or replace function public.watheq_tenant_link_get_or_create(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; k tenant_portal_links%rowtype; prev boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into t from tenants where id = p_tenant;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  select user_id into office from properties where id = t.property_id;
  if office is null or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  if coalesce(t.status, 'active') = 'vacated' then raise exception 'الوحدة شاغرة — لا رابط لمستأجر أخلى'; end if;
  if watheq_norm_name(t.name) = '' then raise exception 'أدخل اسم المستأجر أولًا'; end if;

  select * into k from tenant_portal_links where tenant_id = p_tenant and revoked_at is null;
  if not found then
    -- خيار «إظهار المتأخر» يبقى كما ضبطه المكتب لهذا المستأجر في رابط سابق
    select show_balance into prev from tenant_portal_links
     where tenant_id = p_tenant and watheq_norm_name(tenant_name) = watheq_norm_name(t.name)
     order by created_at desc limit 1;
    insert into tenant_portal_links (user_id, property_id, tenant_id, tenant_name, token, show_balance, created_by)
    values (office, t.property_id, t.id, btrim(t.name),
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            coalesce(prev, true), auth.uid())
    on conflict (tenant_id) where revoked_at is null do nothing;
    -- ضغطتان متزامنتان: الثانية تأخذ رابط الأولى
    select * into k from tenant_portal_links where tenant_id = p_tenant and revoked_at is null;
    insert into tenant_portal_audit (user_id, property_id, tenant_id, actor, action, detail)
    values (office, t.property_id, t.id, auth.uid(), 'link_create', jsonb_build_object('link_id', k.id));
  end if;
  return jsonb_build_object('token', k.token, 'show_balance', k.show_balance,
                            'created_at', k.created_at, 'last_seen_at', k.last_seen_at);
end $$;

create or replace function public.watheq_tenant_link_revoke(p_tenant uuid)
returns int language plpgsql security definer set search_path = public as $$
declare office uuid; pid uuid; n int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select p.user_id, p.id into office, pid from tenants t join properties p on p.id = t.property_id where t.id = p_tenant;
  if office is null or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  update tenant_portal_links set revoked_at = now()
   where tenant_id = p_tenant and user_id = office and revoked_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    insert into tenant_portal_audit (user_id, property_id, tenant_id, actor, action)
    values (office, pid, p_tenant, auth.uid(), 'link_revoke');
  end if;
  return n;
end $$;

create or replace function public.watheq_tenant_link_set_balance(p_tenant uuid, p_show boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare office uuid; pid uuid; n int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select p.user_id, p.id into office, pid from tenants t join properties p on p.id = t.property_id where t.id = p_tenant;
  if office is null or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  update tenant_portal_links set show_balance = coalesce(p_show, true)
   where tenant_id = p_tenant and user_id = office and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'أنشئ رابط المستأجر أولًا'; end if;
  insert into tenant_portal_audit (user_id, property_id, tenant_id, actor, action, detail)
  values (office, pid, p_tenant, auth.uid(), 'link_balance', jsonb_build_object('show_balance', coalesce(p_show, true)));
  return coalesce(p_show, true);
end $$;

-- اعتماد الحوالة: يمرّ بدالة التسجيل نفسها (القفل، الصلاحية، العدّاد، الجزئي، المحصَّل).
-- المبلغ يحدّده المكتب في نافذة التسجيل (في «مضافة فوق الإيجار» يُسجَّل قبل الضريبة).
-- قفل صف الحوالة يمنع الاعتماد مرتين؛ والضغطة الثانية ترجع «معتمدة سابقًا».
create or replace function public.watheq_tenant_claim_approve(p_claim uuid, p_amount numeric,
  p_method text default 'transfer', p_note text default null, p_paid_on date default null, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c tenant_payment_claims%rowtype; office uuid; t tenants%rowtype; r jsonb; pay payments%rowtype;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into c from tenant_payment_claims where id = p_claim for update;
  if not found then raise exception 'البلاغ غير موجود'; end if;
  select user_id into office from properties where id = c.property_id;
  if office is null or office is distinct from c.user_id or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  if c.status = 'approved' then
    return jsonb_build_object('duplicate', true, 'claim_id', c.id, 'payment_id', c.approved_payment_id);
  end if;
  if c.status = 'rejected' then raise exception 'رُفض هذا البلاغ من قبل'; end if;
  if c.tenant_id is null then raise exception 'الوحدة حُذفت — سجّل المبلغ يدويًّا إن لزم'; end if;
  select * into t from tenants where id = c.tenant_id;
  if not found or t.property_id is distinct from c.property_id then raise exception 'الوحدة نُقلت أو حُذفت — سجّل المبلغ يدويًّا'; end if;
  -- المستأجر تغيّر بعد البلاغ (إعادة تأجير): الاعتماد كان سيُسجّل المبلغ للمستأجر الجديد
  if coalesce(t.status, 'active') = 'vacated' or watheq_norm_name(t.name) <> watheq_norm_name(c.tenant_name) then
    raise exception 'تغيّر مستأجر الوحدة بعد البلاغ — لا يُعتمد هنا. سجّله على المستأجر السابق أو ارفضه';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;

  r := watheq_record_payment(p_tenant => c.tenant_id, p_amount => round(p_amount, 2),
         p_method => coalesce(nullif(p_method, ''), 'transfer'),
         p_note => coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'حوالة أبلغ عنها المستأجر'),
         p_paid_on => coalesce(p_paid_on, c.transfer_date),
         p_reference => coalesce(nullif(btrim(coalesce(p_reference, '')), ''), c.bank_ref));
  select * into pay from payments where id = (r->>'payment_id')::uuid;
  if not found or pay.tenant_id is distinct from c.tenant_id then raise exception 'تعارض في تسجيل الحوالة'; end if;

  update tenant_payment_claims set status = 'approved', approved_payment_id = pay.id, recorded_amount = pay.amount,
         decided_at = now(), decided_by = auth.uid() where id = c.id;
  insert into tenant_portal_audit (user_id, property_id, tenant_id, actor, action, detail)
  values (office, c.property_id, c.tenant_id, auth.uid(), 'claim_approve',
          jsonb_build_object('claim_id', c.id, 'claimed', c.amount, 'recorded', pay.amount, 'payment_id', pay.id));
  return r || jsonb_build_object('claim_id', c.id);
end $$;

create or replace function public.watheq_tenant_claim_reject(p_claim uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c tenant_payment_claims%rowtype; office uuid; rs text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into c from tenant_payment_claims where id = p_claim for update;
  if not found then raise exception 'البلاغ غير موجود'; end if;
  select user_id into office from properties where id = c.property_id;
  if office is null or office is distinct from c.user_id or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  if c.status <> 'pending' then raise exception 'البلاغ ليس بانتظار المراجعة'; end if;
  if char_length(rs) not between 3 and 300 then raise exception 'اكتب سبب الرفض (3–300 حرف) — يظهر للمستأجر'; end if;
  update tenant_payment_claims set status = 'rejected', reject_reason = rs, decided_at = now(), decided_by = auth.uid() where id = c.id;
  insert into tenant_portal_audit (user_id, property_id, tenant_id, actor, action, detail)
  values (office, c.property_id, c.tenant_id, auth.uid(), 'claim_reject', jsonb_build_object('claim_id', c.id, 'amount', c.amount, 'reason', rs));
  return true;
end $$;

-- حالة طلب الصيانة: بصلاحية تعديل الوحدات (من يتابع الصيانة) أو تسجيل الدفعات
create or replace function public.watheq_tenant_request_set_status(p_request uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r tenant_requests%rowtype; office uuid; nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into r from tenant_requests where id = p_request for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  select user_id into office from properties where id = r.property_id;
  if office is null or office is distinct from r.user_id
     or not (watheq_perm(office, 'edit_units') or watheq_perm(office, 'record_payments')) then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in ('new', 'in_progress', 'done', 'rejected') then raise exception 'حالة غير معروفة'; end if;
  if nt is not null and char_length(nt) > 500 then raise exception 'الملاحظة أطول من المسموح'; end if;
  if p_status = 'rejected' and nt is null and r.manager_note is null then raise exception 'اكتب سبب الرفض — يظهر للمستأجر'; end if;
  update tenant_requests set status = p_status, manager_note = coalesce(nt, manager_note), updated_at = now(),
         closed_at = case when p_status in ('done', 'rejected') then coalesce(closed_at, now()) else null end
   where id = r.id;
  insert into tenant_portal_audit (user_id, property_id, tenant_id, actor, action, detail)
  values (office, r.property_id, r.tenant_id, auth.uid(), 'request_status',
          jsonb_build_object('request_id', r.id, 'from', r.status, 'to', p_status, 'note', nt));
  return jsonb_build_object('id', r.id, 'status', p_status, 'manager_note', coalesce(nt, r.manager_note));
end $$;

revoke all on function public.watheq_tenant_link_get_or_create(uuid) from public, anon;
revoke all on function public.watheq_tenant_link_revoke(uuid) from public, anon;
revoke all on function public.watheq_tenant_link_set_balance(uuid, boolean) from public, anon;
revoke all on function public.watheq_tenant_claim_approve(uuid, numeric, text, text, date, text) from public, anon;
revoke all on function public.watheq_tenant_claim_reject(uuid, text) from public, anon;
revoke all on function public.watheq_tenant_request_set_status(uuid, text, text) from public, anon;
grant execute on function public.watheq_tenant_link_get_or_create(uuid) to authenticated;
grant execute on function public.watheq_tenant_link_revoke(uuid) to authenticated;
grant execute on function public.watheq_tenant_link_set_balance(uuid, boolean) to authenticated;
grant execute on function public.watheq_tenant_claim_approve(uuid, numeric, text, text, date, text) to authenticated;
grant execute on function public.watheq_tenant_claim_reject(uuid, text) to authenticated;
grant execute on function public.watheq_tenant_request_set_status(uuid, text, text) to authenticated;

-- ── ٥) دوال الصفحة العامة (مفتاح الخدمة فقط) ───────────────────
-- الرابط الفعّال بشرط: المستأجر نفسه ما زال في الوحدة (لم يُخلِ ولم يتغيّر اسمه)،
-- والوحدة في عقار المكتب نفسه. المجهول والمُبطَل يرجعان null بالطريقة نفسها.
create or replace function public.watheq_tenant_link_resolve(p_token text)
returns public.tenant_portal_links language plpgsql stable security definer set search_path = public as $$
declare l tenant_portal_links%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select k.* into l from tenant_portal_links k
    join tenants t on t.id = k.tenant_id and t.property_id = k.property_id
    join properties p on p.id = k.property_id and p.user_id = k.user_id
   where k.token = p_token and k.revoked_at is null
     and coalesce(t.status, 'active') <> 'vacated'
     and watheq_norm_name(t.name) = watheq_norm_name(k.tenant_name);
  if not found then return null; end if;
  return l;
end $$;

create or replace function public.watheq_tenant_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l tenant_portal_links%rowtype; t tenants%rowtype; tj jsonb; pj jsonb; oj jsonb; since timestamptz; st text;
begin
  l := watheq_tenant_link_resolve(p_token);
  if l.id is null then return null; end if;
  select * into t from tenants where id = l.tenant_id;
  tj := to_jsonb(t);
  select to_jsonb(p) into pj from properties p where p.id = l.property_id;
  select to_jsonb(r) into oj from profiles r where r.id = l.user_id;
  since := case when t.term_started_at is not null and isfinite(t.term_started_at) then t.term_started_at end;
  select s.state into st from watheq_product_state(l.user_id, 'property') s;

  update tenant_portal_links set last_seen_at = now() where id = l.id;

  return jsonb_build_object(
    -- حقول محدّدة فقط: لا هوية ولا جوال ولا ملاحظات داخلية ولا حالة التنفيذ
    'tenant', jsonb_build_object(
      'name', tj->'name', 'unit', tj->'unit', 'unit_type', tj->'unit_type', 'vat_mode', tj->'vat_mode',
      'rent_amount', tj->'rent_amount', 'contract_start', tj->'contract_start', 'contract_end', tj->'contract_end',
      'payment_frequency', tj->'payment_frequency', 'contract_periods', tj->'contract_periods',
      'paid_periods', tj->'paid_periods', 'partial_amount', tj->'partial_amount',
      'billing_anchor_day', tj->'billing_anchor_day', 'status', tj->'status', 'move_out_date', tj->'move_out_date',
      'calendar', tj->'calendar', 'first_due', tj->'first_due', 'carried_debt', tj->'carried_debt',
      'contract_no', tj->'contract_no', 'rooms', tj->'rooms', 'baths', tj->'baths', 'acs', tj->'acs',
      'elec_account', tj->'elec_account', 'water_account', tj->'water_account'),
    'property', jsonb_build_object(
      'name', pj->'name', 'city', pj->'city', 'address', pj->'address', 'property_type', pj->'property_type',
      'usage', pj->'usage', 'vat_enabled', pj->'vat_enabled', 'vat_rate', pj->'vat_rate', 'vat_inclusive', pj->'vat_inclusive',
      'grace_days', pj->'grace_days', 'soon_days', pj->'soon_days', 'imminent_days', pj->'imminent_days',
      'expiring_days', pj->'expiring_days'),
    'office', jsonb_build_object(
      'org_name', oj->'org_name', 'billing_name', oj->'billing_name', 'billing_phone', oj->'billing_phone',
      'cr_number', oj->'cr_number', 'vat_number', oj->'vat_number',
      'due_soon_days', oj->'due_soon_days', 'due_imminent_days', oj->'due_imminent_days', 'expiring_days', oj->'expiring_days',
      'plan', oj->'plan', 'trial_ends_at', oj->'trial_ends_at', 'subscribed_until', oj->'subscribed_until'),
    'show_balance', l.show_balance,
    'active', coalesce(st, 'expired') <> 'expired',
    'today', watheq_today(),
    -- دفعات المدة الحالية (مثل كشف الحساب في اللوحة) — بلا ملاحظات تشغيلية
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'paid_on', p.paid_on, 'amount', p.amount, 'method', p.method,
               'reference', p.reference, 'periods_covered', p.periods_covered, 'reverses', p.reverses,
               'applies_to', p.applies_to, 'created_at', p.created_at)
             order by p.paid_on, p.created_at)
        from (select * from payments p0
               where p0.tenant_id = l.tenant_id and p0.user_id = l.user_id
                 and (since is null or p0.created_at >= since)
               order by p0.paid_on desc, p0.created_at desc limit 500) p), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'amount', c.amount, 'transfer_date', c.transfer_date,
               'bank_ref', c.bank_ref, 'status', c.status, 'reject_reason', c.reject_reason,
               'recorded_amount', c.recorded_amount, 'created_at', c.created_at) order by c.created_at desc)
        from (select * from tenant_payment_claims c0 where c0.tenant_id = l.tenant_id
                and watheq_norm_name(c0.tenant_name) = watheq_norm_name(l.tenant_name)
                order by c0.created_at desc limit 10) c), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'category', r.category, 'location', r.location,
               'description', r.description, 'status', r.status, 'manager_note', r.manager_note,
               'created_at', r.created_at, 'updated_at', r.updated_at, 'closed_at', r.closed_at,
               -- سجل المراحل بتواريخها وردّ المكتب في كل مرحلة (بلا هوية من غيّرها)
               'log', coalesce((select jsonb_agg(jsonb_build_object('to', a.detail->>'to', 'note', a.detail->>'note', 'at', a.created_at) order by a.id)
                                  from tenant_portal_audit a
                                 where a.action = 'request_status' and a.detail->>'request_id' = r.id::text
                                   and a.user_id = l.user_id), '[]'::jsonb)) order by r.created_at desc)
        from (select * from tenant_requests r0 where r0.tenant_id = l.tenant_id
                and watheq_norm_name(r0.tenant_name) = watheq_norm_name(l.tenant_name)
                order by r0.created_at desc limit 10) r), '[]'::jsonb)
  );
end $$;

-- «أرسلت الحوالة». الرموز: ok · invalid_link · inactive · no_rent · bad_amount · bad_date · bad_ref · too_many
create or replace function public.watheq_tenant_claim_submit(p_token text, p_amount numeric, p_date date,
  p_ref text default null, p_note text default null, p_ip text default null)
returns text language plpgsql security definer set search_path = public as $$
declare l tenant_portal_links%rowtype; t tenants%rowtype; rent numeric; amt numeric := round(p_amount, 2);
        ref text := nullif(btrim(coalesce(p_ref, '')), ''); nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  l := watheq_tenant_link_resolve(p_token);
  if l.id is null then return 'invalid_link'; end if;
  if (select s.state from watheq_product_state(l.user_id, 'property') s) = 'expired' then return 'inactive'; end if;
  select * into t from tenants where id = l.tenant_id for update;   -- يسلسل عدّ المعلّقة
  rent := coalesce(t.rent_amount, 0);
  if rent <= 0 then return 'no_rent'; end if;
  -- سقف معقول: 60 دفعة شاملة الضريبة + الدين المرحَّل (يمنع رقمًا عبثيًّا)
  if amt is null or amt <= 0 or amt > rent * 1.15 * 60 + greatest(coalesce(t.carried_debt, 0), 0) then return 'bad_amount'; end if;
  if p_date is null or p_date > watheq_today() or p_date < watheq_today() - 90 then return 'bad_date'; end if;
  if (ref is not null and char_length(ref) > 80) or (nt is not null and char_length(nt) > 300) then return 'bad_ref'; end if;
  if (select count(*) from tenant_payment_claims where tenant_id = t.id and status = 'pending') >= 3 then return 'too_many'; end if;
  insert into tenant_payment_claims (user_id, property_id, tenant_id, link_id, tenant_name, unit, amount, transfer_date, bank_ref, note, ip)
  values (l.user_id, l.property_id, t.id, l.id, btrim(t.name), t.unit, amt, p_date, ref, nt, left(p_ip, 64));
  update tenant_portal_links set last_seen_at = now() where id = l.id;
  return 'ok';
end $$;

-- طلب صيانة. الرموز: ok · invalid_link · inactive · bad_category · bad_location · bad_text · too_many
create or replace function public.watheq_tenant_request_submit(p_token text, p_category text, p_location text,
  p_description text, p_ip text default null)
returns text language plpgsql security definer set search_path = public as $$
declare l tenant_portal_links%rowtype; t tenants%rowtype;
        d text := btrim(regexp_replace(coalesce(p_description, ''), '[ \t]+', ' ', 'g'));
begin
  l := watheq_tenant_link_resolve(p_token);
  if l.id is null then return 'invalid_link'; end if;
  if (select s.state from watheq_product_state(l.user_id, 'property') s) = 'expired' then return 'inactive'; end if;
  if p_category is null or p_category not in ('plumbing', 'electric', 'elevator', 'cleaning', 'security', 'ac', 'other') then return 'bad_category'; end if;
  if p_location is null or p_location not in ('common', 'unit') then return 'bad_location'; end if;
  if char_length(d) not between 3 and 1000 then return 'bad_text'; end if;
  select * into t from tenants where id = l.tenant_id for update;
  if (select count(*) from tenant_requests where tenant_id = t.id and status in ('new', 'in_progress')) >= 5 then return 'too_many'; end if;
  insert into tenant_requests (user_id, property_id, tenant_id, link_id, tenant_name, unit, category, location, description, ip)
  values (l.user_id, l.property_id, t.id, l.id, btrim(t.name), t.unit, p_category, p_location, d, left(p_ip, 64));
  update tenant_portal_links set last_seen_at = now() where id = l.id;
  return 'ok';
end $$;

-- ── ٦) تنبيه تليجرام الفوري: بيانات الإرسال لخادم Next (مستأجر أو مالك جمعية) ──
-- لا ترجع الرمز ولا شيئًا لا يحتاجه نص التنبيه. null = لا محادثة مربوطة (لا إرسال).
create or replace function public.watheq_portal_notify_info(p_kind text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare chat text; tl tenant_portal_links%rowtype; hl hoa_member_links%rowtype; res jsonb;
begin
  if p_kind = 'tenant' then
    tl := watheq_tenant_link_resolve(p_token);
    if tl.id is null then return null; end if;
    select telegram_chat_id into chat from profiles where id = tl.user_id;
    if nullif(btrim(coalesce(chat, '')), '') is null then return null; end if;
    select jsonb_build_object('chat_id', chat, 'place', p.name, 'unit', t.unit, 'name', t.name)
      into res from tenants t join properties p on p.id = t.property_id where t.id = tl.tenant_id;
    return res;
  elsif p_kind = 'hoa' then
    hl := watheq_hoa_link_resolve(p_token);
    if hl.id is null then return null; end if;
    select telegram_chat_id into chat from profiles where id = hl.user_id;
    if nullif(btrim(coalesce(chat, '')), '') is null then return null; end if;
    select jsonb_build_object('chat_id', chat, 'place', a.name, 'unit', o.unit, 'name', o.name)
      into res from owners o join associations a on a.id = o.association_id where o.id = hl.owner_id;
    return res;
  end if;
  return null;
end $$;

revoke all on function public.watheq_tenant_link_resolve(text) from public, anon, authenticated;
revoke all on function public.watheq_tenant_portal(text) from public, anon, authenticated;
revoke all on function public.watheq_tenant_claim_submit(text, numeric, date, text, text, text) from public, anon, authenticated;
revoke all on function public.watheq_tenant_request_submit(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.watheq_portal_notify_info(text, text) from public, anon, authenticated;
grant execute on function public.watheq_tenant_portal(text) to service_role;
grant execute on function public.watheq_tenant_claim_submit(text, numeric, date, text, text, text) to service_role;
grant execute on function public.watheq_tenant_request_submit(text, text, text, text, text) to service_role;
grant execute on function public.watheq_portal_notify_info(text, text) to service_role;

notify pgrst, 'reload schema';
commit;

-- ─── التحقق — صف واحد ───
select
  to_regclass('public.tenant_portal_links') is not null   as جدول_الروابط,
  to_regclass('public.tenant_payment_claims') is not null as جدول_الحوالات,
  to_regclass('public.tenant_requests') is not null       as جدول_الطلبات,
  (select count(*) from pg_trigger where tgname in ('watheq_tenant_link_autorevoke', 'watheq_tenant_claim_reopen') and not tgisinternal) as المشغلات_المتوقع_2,
  has_function_privilege('anon', 'public.watheq_tenant_portal(text)', 'execute') as الصفحة_لـanon_يجب_false,
  has_function_privilege('authenticated', 'public.watheq_tenant_claim_submit(text, numeric, date, text, text, text)', 'execute') as البلاغ_لـauthenticated_يجب_false,
  has_table_privilege('authenticated', 'public.tenant_payment_claims', 'insert') as إدراج_مباشر_يجب_false;
