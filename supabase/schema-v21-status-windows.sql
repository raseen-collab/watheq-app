-- ============================================================
-- وثيق — schema-v21: نوافذ الحالة بمستويين + تجاوز لكل عقار
--
-- حالات المستأجر بحسب قربه من الاستحقاق (كل مكتب يختار أرقامه):
--   منتظم  = لا استحقاق خلال نافذة «قريب»
--   قريب   = الاستحقاق خلال N يوم (due_soon_days — افتراضي 10)
--   مستحق  = الاستحقاق خلال M يوم أقرب (due_imminent_days — افتراضي 5)
--   يستحق اليوم، ثم متأخر من اليوم التالي (+ فترة السماح إن وُجدت)
-- الافتراضي على مستوى المكتب (profiles)، ويمكن لكل عقار تجاوزه (properties).
-- ============================================================
alter table profiles add column if not exists due_imminent_days int not null default 5
  check (due_imminent_days between 1 and 60);
grant update (due_imminent_days) on public.profiles to authenticated;

alter table properties add column if not exists soon_days int
  check (soon_days is null or soon_days between 1 and 60);
alter table properties add column if not exists imminent_days int
  check (imminent_days is null or imminent_days between 1 and 60);
