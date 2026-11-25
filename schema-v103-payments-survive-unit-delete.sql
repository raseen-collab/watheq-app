-- ============================================================
-- v103 — الدفعات تبقى بعد حذف الوحدة (24 نوفمبر 2026)
-- فحص المحاسب: «المحصَّل» في عقارين لمكتب التميز أكبر من مجموع الدفعات بـ 31,599 ريال.
-- السبب: payments.tenant_id كان ON DELETE CASCADE — حذف صفّ وحدة يمحو سندات قبضها
-- معه، بينما نافذة الحذف تَعِد «الدفعات لا تُحذف» (ويُختم عليها اسم الدافع قبل الحذف
-- لهذا الغرض). الآن SET NULL مثل الفواتير والأمانات: السند يبقى باسمه ووحدته.
-- لا تعديل لأي صفّ — القيد وحده. (الدفعات التي حُذفت سابقًا تُستعاد من النسخ اليومية.)
-- ============================================================
alter table public.payments drop constraint if exists payments_tenant_id_fkey;
alter table public.payments add constraint payments_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete set null not valid;
alter table public.payments validate constraint payments_tenant_id_fkey;
