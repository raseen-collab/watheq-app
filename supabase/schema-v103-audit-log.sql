-- ============================================================
-- وثيق — schema-v103 (24 نوفمبر 2026) — سجل كل تغيير
--
-- طلب عبيد: «أي مدخل في أي خانة من جميع الموظفين لا يضيع».
-- كل إضافة أو تعديل أو حذف على جداول المكتب يُكتب هنا تلقائيًّا:
-- من فعله (auth.uid())، ومتى، والصف قبل التعديل كاملًا، وما تغيّر.
-- فإن حُذف قيد بالخطأ أو عُدّل، يبقى أصله هنا ويمكن إرجاعه.
--
-- • إضافة فقط: جدول جديد + triggers. لا حذف ولا تعديل لأي بيانات قائمة.
-- • الكتابة من الـtrigger وحده (SECURITY DEFINER). لا أحد يكتب أو يعدّل أو يحذف
--   من المتصفح — حتى صاحب المكتب. القراءة لصاحب المكتب والمدير (watheq_can_manage).
-- • الـtrigger لا يُسقط عملية المستخدم أبدًا: أي خطأ فيه يُتجاهل وتمضي الدفعة.
-- • الحذف يُسجَّل BEFORE (قبل اختفاء الصف) فيُعرف مكتب الوحدة حتى عند الحذف المتسلسل.
-- • الاسم zzz_ ليعمل بعد حرّاس zz_scope_guard/zz_entitlement_guard: حذف يرفضه حارس لا يُسجَّل.
-- • لا تُنسخ أعمدة الرموز وعناوين IP.
-- ============================================================

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,                 -- المكتب
  table_name text not null,
  row_id     text,
  op         text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  actor      uuid,                          -- null = الخادم/رابط المستأجر/المهام المجدولة
  at         timestamptz not null default now(),
  old_row    jsonb,                         -- UPDATE/DELETE: الصف كاملًا قبل التغيير
  new_row    jsonb                          -- INSERT: الصف كاملًا · UPDATE: الحقول المتغيّرة فقط
);
create index if not exists audit_log_office_at on public.audit_log (user_id, at desc);
create index if not exists audit_log_row on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using (watheq_can_manage(user_id));
revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;

-- ── الـtrigger ─────────────────────────────────────────────
-- tg_argv[0]: كيف يُعرف المكتب — 'user' (عمود user_id) · 'property' · 'association'
create or replace function public.watheq_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb; n jsonb; ch jsonb; office uuid; rid text; k text;
  noise constant text[] := array['updated_at', 'collected'];
begin
  begin
    if tg_op <> 'INSERT' then o := to_jsonb(old) - 'ip' - 'token' - 'token_hash'; end if;
    if tg_op <> 'DELETE' then n := to_jsonb(new) - 'ip' - 'token' - 'token_hash'; end if;

    if tg_op = 'UPDATE' then
      ch := '{}'::jsonb;
      for k in select jsonb_object_keys(n) loop
        if (o -> k) is distinct from (n -> k) and not (k = any (noise)) then ch := ch || jsonb_build_object(k, n -> k); end if;
      end loop;
      if ch = '{}'::jsonb then return null; end if;   -- لا تغيير حقيقي
      n := ch;
    end if;

    rid := coalesce(o, n) ->> 'id';
    if tg_argv[0] = 'property' then
      select p.user_id into office from public.properties p where p.id = (coalesce(o, n) ->> 'property_id')::uuid;
      if office is null then   -- العقار حُذف في العملية نفسها: مكتبه من سجل حذفه
        select a.user_id into office from public.audit_log a
         where a.table_name = 'properties' and a.row_id = coalesce(o, n) ->> 'property_id' order by a.id desc limit 1;
      end if;
    elsif tg_argv[0] = 'association' then
      select s.user_id into office from public.associations s where s.id = (coalesce(o, n) ->> 'association_id')::uuid;
      if office is null then
        select a.user_id into office from public.audit_log a
         where a.table_name = 'associations' and a.row_id = coalesce(o, n) ->> 'association_id' order by a.id desc limit 1;
      end if;
    else
      office := (coalesce(o, n) ->> 'user_id')::uuid;
    end if;

    if office is not null then
      insert into public.audit_log (user_id, table_name, row_id, op, actor, old_row, new_row)
      values (office, tg_table_name, rid, tg_op, auth.uid(), o, n);
    end if;
  exception when others then
    null;   -- السجل لا يُسقط عملية المستخدم أبدًا
  end;
  if tg_op = 'DELETE' then return old; end if;   -- BEFORE DELETE يجب أن يُرجع الصف
  return null;
end $$;
revoke all on function public.watheq_audit() from public, anon, authenticated;

-- ── ربطه بالجداول ──────────────────────────────────────────
do $$
declare
  spec text[] := array[
    'properties:user', 'tenants:property', 'property_notes:property',
    'payments:user', 'expenses:user', 'expense_templates:user', 'ledger_adjustments:user', 'past_tenancies:user',
    'trust_ledger:user', 'office_ledger:user', 'tenant_requests:user', 'tenant_payment_claims:user',
    'maintenance_vendors:user', 'office_messages:user', 'compliance_items:user',
    'listings:user', 'listing_shows:user', 'seeker_requests:user',
    'associations:user', 'owners:association', 'association_notes:association',
    'association_expenses:user', 'association_budgets:user', 'hoa_documents:user',
    'hoa_requests:user', 'hoa_payment_claims:user'
  ];
  s text; t text; m text;
begin
  foreach s in array spec loop
    t := split_part(s, ':', 1); m := split_part(s, ':', 2);
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists zzz_audit_iu on public.%I', t);
    execute format('drop trigger if exists zzz_audit_d on public.%I', t);
    execute format('create trigger zzz_audit_iu after insert or update on public.%I for each row execute function public.watheq_audit(%L)', t, m);
    execute format('create trigger zzz_audit_d before delete on public.%I for each row execute function public.watheq_audit(%L)', t, m);
  end loop;
end $$;
