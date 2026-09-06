-- وثيق — schema-v17: رقم العقد (طلب مكتب 150 عقارًا، سبتمبر 2026)
-- التواريخ تبقى ميلادية في القاعدة (كل الحسابات عليها)، والهجري عرضٌ وإدخال.
alter table tenants add column if not exists contract_no text;
create index if not exists tenants_contract_no_idx on tenants (property_id, contract_no);
