-- ============================================================
-- وثيق — schema-v13
-- 1) السماح بصفوف التراجع السالبة في السجل
-- 2) رابط مالك مجمّع: رابط واحد لكل عقارات المالك
-- ============================================================

-- (1) القيد القديم payments_amount_positive يرفض التراجع السالب — وقد أثبتت
-- الدالة الذرّية نفسها: فشل الإدراج أعاد كل شيء كما كان. الصحيح: لا صفر،
-- والسالب مسموح لأنه تراجع موثّق لا خطأ إدخال (الواجهة لا تسمح بإدخاله يدويًّا).
alter table payments drop constraint if exists payments_amount_positive;
alter table payments drop constraint if exists payments_amount_nonzero;
alter table payments add constraint payments_amount_nonzero check (amount <> 0);

-- (2) رابط المالك المجمّع: owner_name بدل property_id.
-- property_id يصير اختياريًّا؛ أحدهما إلزامي لا كلاهما.
alter table owner_links alter column property_id drop not null;
alter table owner_links add column if not exists owner_name text;
alter table owner_links drop constraint if exists owner_links_scope_chk;
alter table owner_links add constraint owner_links_scope_chk
  check ((property_id is not null and owner_name is null) or (property_id is null and owner_name is not null));
create index if not exists owner_links_owner_idx on owner_links (user_id, owner_name);
