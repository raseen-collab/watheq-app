-- ============================================================
-- وثيق — schema-v9: حسابات الموظفين (المرحلة الأولى: القاعدة)
--
-- الفكرة: بيانات المكتب تبقى مربوطة بحساب المالك كما هي — صفر ترحيل.
-- يُضاف جدول عضوية «فلان موظف عند فلان بدور كذا»، وتتحول كل سياسة من
-- «ترى صفّك» إلى «ترى صفّك أو صفوف مكتبٍ أنت عضو فيه بصلاحية تكفي».
--
-- الأدوار:
--   manager   مدير: كل شيء عدا الاشتراك والفوترة وإدارة الموظفين
--   collector محصّل: يسجّل الدفعات والملاحظات ويقرأ — لا يحذف ولا يعدّل عقودًا
--   viewer    مشاهد: قراءة فقط
--
-- ضمانة عدم الانكسار: الدوال الثلاث تُرجع true فورًا حين يكون
-- المستخدم هو المالك نفسه، وجدول العضوية يبدأ فارغًا — فسلوك
-- الحسابات الحالية كلها لا يتغير حرفًا واحدًا بعد تشغيل هذا الملف.
--
-- التشغيل: Supabase → SQL Editor → الصق كاملًا → Run.
-- الملف آمن لإعادة التشغيل (drop if exists / create or replace).
-- ============================================================

-- ---------- 1) جدول العضوية ----------
create table if not exists team_members (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  member_id  uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('manager','collector','viewer')),
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);
alter table team_members enable row level security;

-- المالك يدير موظفيه؛ الموظف يرى عضويته هو فقط (ليعرف أي مكاتب عنده)
drop policy if exists team_owner_all on team_members;
create policy team_owner_all on team_members
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists team_member_read_self on team_members;
create policy team_member_read_self on team_members
  for select using (auth.uid() = member_id);

-- ---------- 2) دعوات الانضمام (برمز، بلا بريد ولا خدمات خارجية) ----------
create table if not exists team_invites (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  code       text not null unique,
  role       text not null check (role in ('manager','collector','viewer')),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    uuid references auth.users(id),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table team_invites enable row level security;

drop policy if exists invites_owner_all on team_invites;
create policy invites_owner_all on team_invites
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------- 3) دوال الصلاحية ----------
-- security definer حتى لا تدور سياسات team_members على نفسها،
-- وsearch_path مسمّر — درس تدقيق الدوال في أغسطس.
create or replace function watheq_can_read(office uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select office = auth.uid()
      or exists (select 1 from team_members
                 where owner_id = office and member_id = auth.uid());
$$;

create or replace function watheq_can_collect(office uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select office = auth.uid()
      or exists (select 1 from team_members
                 where owner_id = office and member_id = auth.uid()
                   and role in ('manager','collector'));
$$;

create or replace function watheq_can_manage(office uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select office = auth.uid()
      or exists (select 1 from team_members
                 where owner_id = office and member_id = auth.uid()
                   and role = 'manager');
$$;

revoke all on function watheq_can_read(uuid),
                       watheq_can_collect(uuid),
                       watheq_can_manage(uuid) from public, anon;
grant execute on function watheq_can_read(uuid),
                          watheq_can_collect(uuid),
                          watheq_can_manage(uuid) to authenticated;

-- ---------- 4) من سجّل القيد؟ ----------
alter table payments  add column if not exists created_by uuid default auth.uid();
alter table expenses  add column if not exists created_by uuid default auth.uid();
alter table property_notes    add column if not exists created_by uuid default auth.uid();
alter table association_notes add column if not exists created_by uuid default auth.uid();
update payments set created_by = user_id where created_by is null;
update expenses set created_by = user_id where created_by is null;

-- ---------- 5) إعادة كتابة السياسات ----------
-- النمط: select ← can_read · تسجيل الدفعات والملاحظات ← can_collect
-- · بقية الكتابة ← can_manage · الحذف المدمّر (عقار/جمعية) ← المالك وحده.

-- properties
drop policy if exists prop_owner_all on properties;
drop policy if exists prop_read on properties;
drop policy if exists prop_write on properties;
drop policy if exists prop_delete on properties;
create policy prop_read   on properties for select using (watheq_can_read(user_id));
create policy prop_write  on properties for insert with check (watheq_can_manage(user_id));
create policy prop_update on properties for update
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));
create policy prop_delete on properties for delete using (auth.uid() = user_id);

-- associations
drop policy if exists assoc_owner_all on associations;
drop policy if exists assoc_read on associations;
drop policy if exists assoc_write on associations;
drop policy if exists assoc_update on associations;
drop policy if exists assoc_delete on associations;
create policy assoc_read   on associations for select using (watheq_can_read(user_id));
create policy assoc_write  on associations for insert with check (watheq_can_manage(user_id));
create policy assoc_update on associations for update
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));
create policy assoc_delete on associations for delete using (auth.uid() = user_id);

-- tenants (عبر العقار — العقد بيانات حساسة: كتابتها للمدير لا المحصّل)
drop policy if exists tenants_via_prop on tenants;
drop policy if exists tenants_read on tenants;
drop policy if exists tenants_write on tenants;
create policy tenants_read on tenants for select using (
  exists (select 1 from properties p
          where p.id = tenants.property_id and watheq_can_read(p.user_id)));
create policy tenants_write on tenants for all using (
  exists (select 1 from properties p
          where p.id = tenants.property_id and watheq_can_manage(p.user_id)))
  with check (
  exists (select 1 from properties p
          where p.id = tenants.property_id and watheq_can_manage(p.user_id)));

-- payments (جوهر عمل المحصّل: يسجّل ويعدّل، لا يحذف)
drop policy if exists payments_select_own on payments;
drop policy if exists payments_insert_own on payments;
drop policy if exists payments_update_own on payments;
drop policy if exists payments_delete_own on payments;
create policy payments_select on payments for select using (watheq_can_read(user_id));
create policy payments_insert on payments for insert with check (watheq_can_collect(user_id));
create policy payments_update on payments for update
  using (watheq_can_collect(user_id)) with check (watheq_can_collect(user_id));
create policy payments_delete on payments for delete using (watheq_can_manage(user_id));

-- expenses (تمسّ صافي المالك — للمدير)
drop policy if exists expenses_owner_all on expenses;
drop policy if exists expenses_read on expenses;
drop policy if exists expenses_write on expenses;
create policy expenses_read  on expenses for select using (watheq_can_read(user_id));
create policy expenses_write on expenses for all
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));

-- invoices
drop policy if exists invoices_owner on invoices;
drop policy if exists invoices_read on invoices;
drop policy if exists invoices_write on invoices;
create policy invoices_read  on invoices for select using (watheq_can_read(user_id));
create policy invoices_write on invoices for all
  using (watheq_can_collect(user_id)) with check (watheq_can_collect(user_id));

-- compliance_items · listings · seeker_requests · owner_links
drop policy if exists compliance_owner_all on compliance_items;
drop policy if exists compliance_read on compliance_items;
drop policy if exists compliance_write on compliance_items;
create policy compliance_read  on compliance_items for select using (watheq_can_read(user_id));
create policy compliance_write on compliance_items for all
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));

drop policy if exists listings_owner_all on listings;
drop policy if exists listings_read on listings;
drop policy if exists listings_write on listings;
create policy listings_read  on listings for select using (watheq_can_read(user_id));
create policy listings_write on listings for all
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));

drop policy if exists requests_owner_all on seeker_requests;
drop policy if exists requests_read on seeker_requests;
drop policy if exists requests_write on seeker_requests;
create policy requests_read  on seeker_requests for select using (watheq_can_read(user_id));
create policy requests_write on seeker_requests for all
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));

drop policy if exists owner_links_owner_all on owner_links;
drop policy if exists owner_links_read on owner_links;
drop policy if exists owner_links_write on owner_links;
create policy owner_links_read  on owner_links for select using (watheq_can_read(user_id));
create policy owner_links_write on owner_links for all
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));

-- property_notes (الملاحظات عمل يومي — المحصّل يكتبها)
drop policy if exists propnotes_via_prop on property_notes;
drop policy if exists propnotes_read on property_notes;
drop policy if exists propnotes_write on property_notes;
create policy propnotes_read on property_notes for select using (
  exists (select 1 from properties p
          where p.id = property_notes.property_id and watheq_can_read(p.user_id)));
create policy propnotes_write on property_notes for all using (
  exists (select 1 from properties p
          where p.id = property_notes.property_id and watheq_can_collect(p.user_id)))
  with check (
  exists (select 1 from properties p
          where p.id = property_notes.property_id and watheq_can_collect(p.user_id)));

-- owners (ملّاك الجمعية: تحديث حالة السداد للمحصّل، الإضافة والحذف للمدير)
drop policy if exists owners_via_assoc on owners;
drop policy if exists owners_read on owners;
drop policy if exists owners_update on owners;
drop policy if exists owners_cud on owners;
create policy owners_read on owners for select using (
  exists (select 1 from associations a
          where a.id = owners.association_id and watheq_can_read(a.user_id)));
create policy owners_update on owners for update using (
  exists (select 1 from associations a
          where a.id = owners.association_id and watheq_can_collect(a.user_id)))
  with check (
  exists (select 1 from associations a
          where a.id = owners.association_id and watheq_can_collect(a.user_id)));
create policy owners_cud on owners for insert with check (
  exists (select 1 from associations a
          where a.id = owners.association_id and watheq_can_manage(a.user_id)));
drop policy if exists owners_delete on owners;
create policy owners_delete on owners for delete using (
  exists (select 1 from associations a
          where a.id = owners.association_id and watheq_can_manage(a.user_id)));

-- association_notes
drop policy if exists assocnotes_via_assoc on association_notes;
drop policy if exists assocnotes_read on association_notes;
drop policy if exists assocnotes_write on association_notes;
create policy assocnotes_read on association_notes for select using (
  exists (select 1 from associations a
          where a.id = association_notes.association_id and watheq_can_read(a.user_id)));
create policy assocnotes_write on association_notes for all using (
  exists (select 1 from associations a
          where a.id = association_notes.association_id and watheq_can_collect(a.user_id)))
  with check (
  exists (select 1 from associations a
          where a.id = association_notes.association_id and watheq_can_collect(a.user_id)));

-- association_budgets (موازنة الجمعية — للمدير)
drop policy if exists budgets_select_own on association_budgets;
drop policy if exists budgets_insert_own on association_budgets;
drop policy if exists budgets_update_own on association_budgets;
drop policy if exists budgets_delete_own on association_budgets;
drop policy if exists budgets_read on association_budgets;
drop policy if exists budgets_write on association_budgets;
create policy budgets_read  on association_budgets for select using (watheq_can_read(user_id));
create policy budgets_write on association_budgets for all
  using (watheq_can_manage(user_id)) with check (watheq_can_manage(user_id));

-- advisor_log: يبقى شخصيًّا — أسئلة كل مستخدم وحصّته له وحده. لا تغيير.
-- profiles: تبقى profiles_self كما هي — لا موظف يقرأ صف مالكه مباشرة؛
-- بيانات الفوترة تمرّ عبر الدالة الآمنة أدناه فقط.

-- ---------- 6) بيانات المُصدِر للموظف (بلا فتح جدول profiles) ----------
-- المستندات تحتاج اسم المنشأة والرقم الضريبي — لا الخطة ولا الاشتراك.
create or replace function watheq_office_profile(office uuid)
returns table (org_name text, billing_name text, vat_number text,
               cr_number text, billing_phone text)
language sql stable security definer
set search_path = public as $$
  select p.org_name, p.billing_name, p.vat_number, p.cr_number, p.billing_phone
  from profiles p
  where p.id = office and watheq_can_read(office);
$$;
revoke all on function watheq_office_profile(uuid) from public, anon;
grant execute on function watheq_office_profile(uuid) to authenticated;

-- ---------- 7) قبول الدعوة ----------
-- security definer لأن المنضمّ لا يملك قراءة دعوات غيره ولا الكتابة
-- في team_members — الدالة تتحقق وتنفّذ ذرّيًّا وتحرق الرمز.
create or replace function watheq_redeem_invite(invite_code text)
returns text language plpgsql security definer
set search_path = public as $$
declare inv team_invites%rowtype;
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
  insert into team_members (owner_id, member_id, role)
  values (inv.owner_id, auth.uid(), inv.role)
  on conflict (owner_id, member_id) do update set role = excluded.role;
  update team_invites set used_by = auth.uid(), used_at = now()
   where id = inv.id;
  return 'ok';
end $$;
revoke all on function watheq_redeem_invite(text) from public, anon;
grant execute on function watheq_redeem_invite(text) to authenticated;
