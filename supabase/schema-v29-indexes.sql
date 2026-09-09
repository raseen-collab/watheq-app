-- ============================================================
-- وثيق — schema-v29: فهارس المسارات الساخنة
--
-- ظهرت في دراسة مكتب بـ30 عقارًا و400 وحدة: أكثر استعلامين تكرارًا في
-- المنصة يفتقران إلى فهرس مركّب، فيمسح Postgres الجدول كاملًا في كل مرة.
--
--   1) كشف الفترة وتقرير المالك ومؤشر «المحصَّل هذا الشهر»:
--      payments where property_id = ? and paid_on between ? and ?
--   2) المصروفات في تقرير المالك:
--      expenses where property_id = ? and spent_on between ? and ?
--   3) سجل مدفوعات المستأجر: payments where tenant_id = ?
--
-- بلا هذه الفهارس يبطؤ كل كشف مع نمو جدول الدفعات (سنة واحدة لمكتب
-- بـ400 وحدة ≈ 4,800 دفعة، وأربع سنوات ≈ 20,000).
-- ============================================================
create index if not exists payments_prop_date_idx on payments (property_id, paid_on desc);
create index if not exists payments_tenant_idx    on payments (tenant_id, paid_on desc);
create index if not exists expenses_prop_date_idx on expenses (property_id, spent_on desc);
create index if not exists expenses_office_idx    on expenses (user_id, spent_on desc);
-- المتأخرات والاستحقاقات تُحسب في الكود من جدول الوحدات كاملًا لكل عقار
create index if not exists tenants_prop_status_idx on tenants (property_id, status);
