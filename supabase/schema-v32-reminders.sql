-- ============================================================
-- وثيق — schema-v32: سجل العقار يصير متابعة لا أرشيفًا
--
-- سجل العقار اليوم ملاحظات نصّية بلا موعد ولا حالة: تُكتب فتُنسى. وطلب
-- المكتب دقيق: «بيقابلنا مشاكل وإصلاحات وتكون تذكير لينا» — أي متابعة لا
-- توثيق. الفرق أن التوثيق يُقرأ حين يُبحث عنه، والمتابعة تأتي إليك.
--
-- ثلاثة حقول تكفي:
--   due_date  متى يجب أن يُفعل — بدونه لا يُذكِّر النظام بشيء
--   done_at   انتهى (ومتى) — بدونه تتراكم القديمة وتُفقد الثقة بالقائمة
--   kind      صيانة · تجديد · حكومي · مالي · أخرى — للفرز والتقارير
--   unit      يخصّ وحدة بعينها؟ فيظهر التذكير عليها
-- ============================================================

alter table property_notes add column if not exists due_date date;
alter table property_notes add column if not exists done_at  timestamptz;
alter table property_notes add column if not exists kind     text default 'other'
  check (kind in ('maintenance', 'renewal', 'government', 'financial', 'other'));
alter table property_notes add column if not exists unit     text;
alter table property_notes add column if not exists done_by  uuid;

comment on column property_notes.due_date is 'موعد التنفيذ — يظهر في الملخص اليومي وعلى بطاقة العقار';
comment on column property_notes.done_at  is 'وقت إنجاز المهمة — الفارغ يعني مفتوحة';

-- التذكيرات المفتوحة تُقرأ يوميًّا لكل عقارات المكتب
create index if not exists propnotes_due_idx on property_notes (property_id, due_date)
  where done_at is null and due_date is not null;

-- إغلاق المهمة: من يملك add_notes يكتب ويُغلق (لا يحتاج صلاحية أعلى)
drop policy if exists propnotes_upd on property_notes;
create policy propnotes_upd on property_notes for update
  using (exists (select 1 from properties p
                 where p.id = property_notes.property_id and watheq_perm(p.user_id, 'add_notes')))
  with check (exists (select 1 from properties p
                 where p.id = property_notes.property_id and watheq_perm(p.user_id, 'add_notes')));
