-- ============================================================
-- وثيق — schema-v11: سجل العمليات (من سجّل الدفعة، ولمن، ومتى بالساعة)
-- ============================================================

-- وقت التسجيل الفعلي بالثانية — paid_on تاريخ السداد فقط ولا يكفي للتدقيق
alter table payments add column if not exists created_at timestamptz not null default now();
create index if not exists payments_office_created_idx on payments (user_id, created_at desc);

-- أسماء من سجّلوا القيود في هذا المكتب: المالك + موظفوه.
-- security definer لأن الموظف لا يقرأ صفوف زملائه في team_members،
-- والسجل بلا أسماء لا يفيد. تُرجع لمن يحق له قراءة المكتب فقط.
create or replace function watheq_actor_names(office uuid)
returns table (actor_id uuid, actor_name text)
language sql stable security definer
set search_path = public as $$
  select p.id, coalesce(p.full_name, p.org_name, 'صاحب المكتب')
  from profiles p where p.id = office and watheq_can_read(office)
  union all
  select tm.member_id, coalesce(tm.member_name, 'موظف')
  from team_members tm where tm.owner_id = office and watheq_can_read(office);
$$;
revoke all on function watheq_actor_names(uuid) from public, anon;
grant execute on function watheq_actor_names(uuid) to authenticated;
