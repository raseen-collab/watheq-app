-- ============================================================
-- وثيق — schema-v25: تواصل الفريق داخل المنصة
--
-- ليست محادثة عامة تنافس واتساب — بل رسائل مربوطة بالسياق: الرسالة
-- تُعلَّق على وحدة أو عقار، فتُقرأ ومعها من هو المستأجر وكم المتأخر،
-- وتبقى في السجل بدل أن تضيع في قروب. ويمكن تحويل أي رسالة إلى مهمة
-- موكّلة لموظف تُغلق عند إنجازها.
--
-- الأمان: مقصورة على المكتب — كل من يقرأ المكتب يقرأ رسائله، والكتابة
-- لأعضائه، والحذف لمن يملك صلاحية التراجع وحده (كسائر السجلات).
-- ============================================================

create table if not exists office_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,                    -- معرّف المكتب (كسائر الجداول)
  author_id    uuid not null default auth.uid(),
  body         text not null check (length(btrim(body)) between 1 and 2000),
  property_id  uuid references properties(id) on delete set null,
  tenant_id    uuid references tenants(id) on delete set null,
  assigned_to  uuid,                              -- مهمة موكّلة لموظف
  done_at      timestamptz,
  done_by      uuid,
  created_at   timestamptz not null default now()
);

create index if not exists office_messages_office_idx on office_messages (user_id, created_at desc);
create index if not exists office_messages_open_idx   on office_messages (user_id, done_at) where assigned_to is not null;

alter table office_messages enable row level security;

drop policy if exists msg_read   on office_messages;
drop policy if exists msg_insert on office_messages;
drop policy if exists msg_update on office_messages;
drop policy if exists msg_delete on office_messages;

-- القراءة: كل من له وصول لهذا المكتب
create policy msg_read on office_messages for select using (watheq_can_read(user_id));
-- الكتابة: أعضاء المكتب، والكاتب هو نفسه لا غيره
create policy msg_insert on office_messages for insert
  with check (watheq_can_read(user_id) and author_id = auth.uid());
-- الإغلاق/إعادة الفتح: الكاتب أو المُوكَّل إليه أو المدير
create policy msg_update on office_messages for update
  using (watheq_can_read(user_id) and (author_id = auth.uid() or assigned_to = auth.uid() or watheq_perm(user_id, 'undo_actions')))
  with check (watheq_can_read(user_id));
-- الحذف: صلاحية التراجع وحدها — الرسائل سجلّ لا تُمحى اعتباطًا
create policy msg_delete on office_messages for delete using (watheq_perm(user_id, 'undo_actions'));

-- بثّ التغييرات لحظيًّا للمتصلين (Supabase Realtime)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'office_messages') then
    alter publication supabase_realtime add table office_messages;
  end if;
exception when others then null;   -- النشرة غير موجودة في بعض الإعدادات
end $$;

-- ---------- تقييد السياق بالمكتب نفسه ----------
-- بلا هذا، يستطيع عضو ربط رسالته بمعرّف عقار من مكتب آخر: لا يسرّب شيئًا
-- (السياسات تمنع قراءة ذلك العقار)، لكنه مرجع متقاطع لا معنى له ويشوّش
-- السجل. نتحقق أن العقار والوحدة والموظف المُوكَّل كلهم من هذا المكتب.
create or replace function public.guard_office_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.property_id is not null and not exists (
       select 1 from properties p where p.id = new.property_id and p.user_id = new.user_id) then
    raise exception 'العقار لا يتبع هذا المكتب';
  end if;

  if new.tenant_id is not null and not exists (
       select 1 from tenants t join properties p on p.id = t.property_id
        where t.id = new.tenant_id and p.user_id = new.user_id) then
    raise exception 'الوحدة لا تتبع هذا المكتب';
  end if;

  if new.assigned_to is not null
     and new.assigned_to <> new.user_id
     and not exists (select 1 from team_members tm
                      where tm.owner_id = new.user_id and tm.member_id = new.assigned_to) then
    raise exception 'لا يمكن تكليف شخص خارج المكتب';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_office_message on office_messages;
create trigger trg_guard_office_message
  before insert or update on office_messages
  for each row execute function public.guard_office_message();
