-- ============================================================
-- وثيق — schema-v65: حذف مالك له دفعات (30 سبتمبر 2026)
--
-- قيد حيّ على الدفعات (payments_has_subject) يشترط وجود مستأجر أو مالك.
-- منذ v60 صار حذف المالك يُبقي دفعاته (باسمه ووحدته المحفوظين) ويفصل الرابط
-- فقط — فيصطدم بالقيد ويفشل الحذف برسالة إنجليزية.
-- الإصلاح: الدفعة صالحة إن كانت مرتبطة بمستأجر أو مالك أو جمعية أو عقد سابق.
-- لا يغيّر أي بيانات، وكل صف قائم يحقق القيد الجديد (هو أوسع من السابق).
-- ============================================================
begin;
alter table public.payments drop constraint if exists payments_has_subject;
alter table public.payments add constraint payments_has_subject check (
  tenant_id is not null or owner_id is not null or association_id is not null or past_tenancy_id is not null);
commit;

select pg_get_constraintdef(oid) as القيد_الجديد
from pg_constraint where conrelid = 'public.payments'::regclass and conname = 'payments_has_subject';
