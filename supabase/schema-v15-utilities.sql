-- وثيق — schema-v15: أرقام حسابات الكهرباء والماء لكل وحدة
-- (قراءات العدادات كانت موجودة أصلًا في مخالصة الإخلاء؛ هنا تُضاف أرقام الحسابات
--  التي تُستخدم في الاستعلام ونقل الخدمة، وتُحمل من مستأجر إلى التالي مع الوحدة)
alter table tenants add column if not exists elec_account text;
alter table tenants add column if not exists water_account text;
