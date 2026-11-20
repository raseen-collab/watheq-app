-- ═══════════════════════════════════════════════════════════════════
-- schema-v90 — اسم الموظف + تجهيز صلاحياته وعقاراته قبل انضمامه (19 نوفمبر 2026)
--
-- المشكلة: team_members.member_name لم يكن يُملأ أبدًا عند الانضمام برمز الدعوة،
-- فكل الموظفين يظهرون «موظف» في الإعدادات وفي «سجل العمليات».
-- الحل:
--   ١) العمود (إن لم يكن موجودًا) + تعبئة الموجودين من اسم التسجيل (profiles.full_name).
--   ٢) watheq_redeem_invite يحفظ اسم الموظف لحظة انضمامه.
--   ٣) صاحب المكتب يقدر يعدّل الاسم من الإعدادات (منحة عمود member_name فقط).
--   ٤) طلب «الصلاحيات حتى العقارات قبل الإضافة»: رمز الدعوة يحمل الاسم والصلاحيات
--      المخصّصة والعقارات المسموحة، وتنتقل للموظف لحظة إدخاله الرمز — فلا لحظة
--      يرى فيها أكثر مما حُدّد له.
-- آمن للتكرار. شغّله كاملًا في Supabase → SQL Editor — بعد v89 (يحتاج عمود property_ids).
-- ═══════════════════════════════════════════════════════════════════
begin;

alter table public.team_members add column if not exists member_name text;

-- تعبئة الموجودين بلا اسم من اسم تسجيلهم
update public.team_members tm
   set member_name = nullif(btrim(p.full_name), '')
  from public.profiles p
 where p.id = tm.member_id
   and (tm.member_name is null or btrim(tm.member_name) = '')
   and nullif(btrim(p.full_name), '') is not null;

-- طول معقول
alter table public.team_members drop constraint if exists team_members_name_len;
alter table public.team_members add constraint team_members_name_len
  check (member_name is null or char_length(member_name) <= 60);

-- صاحب المكتب يعدّل الاسم (سياسة team_owner_update القائمة تحصره في موظفيه)
grant update (member_name) on public.team_members to authenticated;

-- ── الدعوة تحمل الإعداد مسبقًا ──
alter table public.team_invites add column if not exists member_name text;
alter table public.team_invites add column if not exists perms jsonb not null default '{}'::jsonb;
alter table public.team_invites add column if not exists property_ids uuid[];

create or replace function public.watheq_invite_setup_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare bad int; k text; clean jsonb := '{}'::jsonb;
begin
  new.member_name := left(nullif(btrim(coalesce(new.member_name, '')), ''), 60);
  -- الصلاحيات: مفاتيح معروفة وقيم منطقية فقط (التراجع والحذف للمدير بالدور لا باستثناء)
  if new.perms is null or jsonb_typeof(new.perms) <> 'object' then new.perms := '{}'::jsonb; end if;
  for k in select jsonb_object_keys(new.perms) loop
    if k = any(array['record_payments','issue_invoices','send_reminders','add_notes','edit_tenants',
                     'renew_contracts','move_out','manage_expenses','manage_listings','manage_compliance',
                     'view_financials','owner_links','export_data','view_activity'])
       and jsonb_typeof(new.perms -> k) = 'boolean' then
      clean := clean || jsonb_build_object(k, new.perms -> k);
    end if;
  end loop;
  new.perms := clean;
  -- العقارات: من عقارات المكتب نفسه فقط
  if new.property_ids is not null then
    new.property_ids := array(select distinct x from unnest(new.property_ids) x where x is not null);
    select count(*) into bad from unnest(new.property_ids) x
     where not exists (select 1 from properties p where p.id = x and p.user_id = new.owner_id);
    if bad > 0 then
      raise exception using errcode = 'P0001', message = 'عقار ليس من عقارات المكتب — أعد تحميل الصفحة واختر من القائمة';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists team_invites_setup_guard on public.team_invites;
create trigger team_invites_setup_guard before insert or update on public.team_invites
  for each row execute function public.watheq_invite_setup_guard();
revoke all on function public.watheq_invite_setup_guard() from public, anon, authenticated;

-- الانضمام برمز: يحفظ الاسم من اسم التسجيل
create or replace function watheq_redeem_invite(invite_code text)
returns text language plpgsql security definer
set search_path = public as $$
declare inv team_invites%rowtype; nm text;
begin
  select * into inv from team_invites
   where code = invite_code and used_at is null and expires_at > now()
   for update;
  if not found then
    return 'invalid';                      -- رمز خاطئ أو مستهلك أو منتهٍ
  end if;
  if inv.owner_id = auth.uid() then
    return 'self';                         -- المالك لا ينضم لنفسه
  end if;
  select left(nullif(btrim(full_name), ''), 60) into nm from profiles where id = auth.uid();
  -- الاسم: ما كتبه صاحب المكتب في الدعوة أولًا، وإلا اسم التسجيل.
  -- الصلاحيات والعقارات: كما جُهّزت في الدعوة (null = كل العقارات).
  insert into team_members (owner_id, member_id, role, member_name, perms, property_ids)
  values (inv.owner_id, auth.uid(), inv.role, coalesce(inv.member_name, nm),
          coalesce(inv.perms, '{}'::jsonb), inv.property_ids)
  on conflict (owner_id, member_id) do update
    set role = excluded.role,
        perms = excluded.perms,
        property_ids = excluded.property_ids,
        member_name = coalesce(inv.member_name, team_members.member_name, excluded.member_name);
  update team_invites set used_by = auth.uid(), used_at = now()
   where id = inv.id;
  return 'ok';
end $$;
revoke all on function watheq_redeem_invite(text) from public, anon;
grant execute on function watheq_redeem_invite(text) to authenticated;

notify pgrst, 'reload schema';
commit;

select
  (select count(*) from team_members) as الموظفون,
  (select count(*) from team_members where member_name is not null) as بأسماء,
  (select count(*) from information_schema.columns where table_name = 'team_invites'
     and column_name in ('member_name','perms','property_ids')) = 3 as أعمدة_الدعوة;
