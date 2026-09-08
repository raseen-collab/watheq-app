-- ============================================================
-- وثيق — schema-v22: ملاحظات مكتب تميز التطوير (سبتمبر 2026)
-- 1) استخدام العقار: عوائل / عزّاب / مختلط (سكني-تجاري)
-- 2) نوع الوحدة + الغرف ودورات المياه والمكيفات
-- 3) أول تاريخ استحقاق مستقل عن بداية العقد (العقد يبدأ 1/1 والدفعة 5/1)
-- 4) نافذة «تنتهي قريبًا» للعقود يحددها المكتب (كانت 60 يومًا ثابتة)، مع تجاوز لكل عقار
-- ============================================================

alter table properties add column if not exists usage text
  check (usage is null or usage in ('families','singles','mixed','commercial'));
alter table properties add column if not exists expiring_days int
  check (expiring_days is null or expiring_days between 1 and 180);

alter table tenants add column if not exists unit_type text
  check (unit_type is null or unit_type in ('apartment','annex','studio','room','shop','office','warehouse','land','villa','other'));
alter table tenants add column if not exists rooms int check (rooms is null or rooms between 0 and 50);
alter table tenants add column if not exists baths int check (baths is null or baths between 0 and 50);
alter table tenants add column if not exists acs int check (acs is null or acs between 0 and 50);
alter table tenants add column if not exists first_due date;

alter table profiles add column if not exists expiring_days int not null default 60
  check (expiring_days between 1 and 180);
grant update (expiring_days) on public.profiles to authenticated;
