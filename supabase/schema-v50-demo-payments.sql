-- ============================================================
-- وثيق — schema-v50: وسم الدفعات التجريبية على الدفعة نفسها
-- ============================================================
-- المشكلة: فصل بيانات التجربة عن الحقيقية كان يستدلّ على «الدفعة تجريبية»
-- من عقارها (payments.property_id → properties.is_demo). لكن المفتاح مُعرَّف:
--
--     property_id uuid references public.properties(id) on delete set null
--
-- أي أن حذف عقار **لا يحذف دفعاته — يُفرّغ مرجعها**. فمن جرّب البيانات
-- التجريبية ثم حذف عقارًا تجريبيًّا واحدًا من شاشة العقارات (بدل زر «حذف
-- البيانات التجريبية») تبقى ~30 دفعة بلا عقار، فتُقرأ في لوحة الإدارة على
-- أنها دفعات حقيقية: الحساب يقفز إلى مرحلة «يسجّل دفعات»، ويزيد القمع،
-- وتزيد «الدفعات المسجّلة» في نبض تليجرام، وتُبنى عليها إحاطة المستشار.
--
-- الحل: الوسم على الصفّ نفسه لا على علاقته. عمود لا يتأثر بحذف العقار.
--
-- آمن للتشغيل أكثر من مرة.
-- ============================================================

alter table payments add column if not exists is_demo boolean not null default false;

comment on column payments.is_demo is
  'دفعة من بذرة التجربة — تُستثنى من أرقام لوحة الإدارة ولا تتأثر بحذف عقارها';

-- ترحيل الصفوف القائمة: كل دفعة عقارُها تجريبي تُوسم الآن
update payments p
   set is_demo = true
  from properties pr
 where p.property_id = pr.id
   and pr.is_demo
   and p.is_demo = false;

-- والدفعات التي فقدت عقارها سابقًا: تُوسم إن كان صاحبها لم يُدخل إلا بذرة التجربة
update payments p
   set is_demo = true
 where p.property_id is null
   and p.is_demo = false
   and exists (select 1 from properties x where x.user_id = p.user_id and x.is_demo)
   and not exists (select 1 from properties x where x.user_id = p.user_id and not x.is_demo);

create index if not exists payments_demo_idx on payments (user_id) where is_demo;

-- ── تحقّق ──
-- المتوقع: صفر دفعات تجريبية بلا وسم
select count(*) as "دفعات تجريبية غير موسومة"
  from payments p join properties pr on pr.id = p.property_id
 where pr.is_demo and not p.is_demo;

select count(*) as "إجمالي الدفعات الموسومة" from payments where is_demo;
