-- ============================================================
-- وثيق — schema-v20: تقويم العقد + نافذة الاستحقاق القريب
-- 1) tenants.calendar: 'gregorian' (افتراضي) أو 'hijri' — عقد هجري تُحسب
--    أقساطه بالأشهر الهجرية (أم القرى) فلا يزحف الاستحقاق 3–5 أيام كل قسط.
-- 2) profiles.due_soon_days: كم يومًا قبل الاستحقاق يُعدّ «قريبًا» في اللوحة
--    (افتراضيًّا 7). كل مكتب يختار.
-- ملاحظة: «متأخر» صار يبدأ من اليوم التالي للاستحقاق (كان يبدأ صباح يوم
-- الاستحقاق نفسه) — تغيير في الكود لا في القاعدة، وفترة السماح تُضاف فوقه.
-- ============================================================
alter table tenants add column if not exists calendar text not null default 'gregorian'
  check (calendar in ('gregorian','hijri'));
alter table profiles add column if not exists due_soon_days int not null default 7
  check (due_soon_days between 1 and 60);
grant update (due_soon_days) on public.profiles to authenticated;
