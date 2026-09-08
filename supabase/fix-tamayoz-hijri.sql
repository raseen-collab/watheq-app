-- إصلاح لمرة واحدة: وحدات مكتب تميز التطوير رُفعت من ملف بتواريخ هجرية
-- قبل وجود عمود calendar → تُحوَّل إلى الدورة الهجرية فيطابق الاستحقاق عقودهم.
-- (شغّله بعد schema-v20)
update tenants set calendar = 'hijri'
where property_id in (
  select id from properties
  where user_id = (select id from auth.users where email = 'an.zughaibi@gmail.com')
);
select count(*) as "وحدات صارت هجرية" from tenants
where calendar = 'hijri' and property_id in (
  select id from properties where user_id = (select id from auth.users where email = 'an.zughaibi@gmail.com'));
