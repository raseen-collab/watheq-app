-- ============================================================
-- وثيق — schema-v30: تحصين المصروفات
--
-- المصروف اليوم أربعة حقول (تاريخ · تصنيف · مبلغ · ملاحظة). وهذا يكفي
-- للعرض لا للاعتماد المالي، وينتج أخطاء حقيقية في المكاتب:
--
-- 1) من يتحمّلها؟ مصروف تسويق المكتب كان يُخصم من صافي المالك كأنه عليه.
--    → billable: هل تُخصم من المالك أم على المكتب.
-- 2) من دفعها؟ مدفوعة من تحصيل العقار أم من جيب المكتب (يُستردّ) أم دفعها
--    المالك مباشرة (لا تمسّ نقد المكتب إطلاقًا).
--    → paid_by
-- 3) مستحقة أم مسدّدة؟ فاتورة صيانة وصلت ولم تُدفع تُظهر صافيًا أقل مما هو.
--    → status
-- 4) بلا مورّد ولا رقم فاتورة لا يمكن مراجعة الصرف مع المالك عند الخلاف.
--    → vendor · invoice_no
-- ============================================================

alter table expenses add column if not exists billable boolean not null default true;
alter table expenses add column if not exists paid_by text not null default 'collections'
  check (paid_by in ('collections', 'office', 'owner'));
alter table expenses add column if not exists status text not null default 'paid'
  check (status in ('paid', 'due'));
alter table expenses add column if not exists vendor text;
alter table expenses add column if not exists invoice_no text;

comment on column expenses.billable   is 'تُخصم من صافي المالك (true) أم على المكتب (false)';
comment on column expenses.paid_by    is 'collections: من تحصيل العقار · office: من المكتب ويُستردّ · owner: دفعها المالك مباشرة';
comment on column expenses.status     is 'paid: مدفوعة · due: مستحقة لم تُدفع بعد';

-- فهرس للتقرير المجمّع عبر كل العقارات لفترة
create index if not exists expenses_office_period_idx on expenses (user_id, spent_on desc, property_id);
