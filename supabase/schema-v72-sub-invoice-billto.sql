-- ============================================================
-- schema-v72 — اسم ومنشأة «إلى» لكل فاتورة اشتراك (5 أكتوبر 2026)
--
-- السبب: مشترك يدير أملاك غيره (عمرو باعبدالله يدير «أملاك ورثة سعيد محمد
-- باعبدالله») ويريد الفاتورة باسم الجهة المالكة لا باسم حسابه.
-- الاسم يُحفظ على الدفعة نفسها، فإعادة الطباعة لاحقًا تخرج بالاسم ذاته
-- ولا يتغيّر أي شيء في الحساب نفسه.
--
-- فارغ = يُستعمل اسم الحساب ومنشأته كما كان.
-- الجدول يُقرأ ويُكتب بمفتاح الخدمة من لوحة الإدارة فقط — لا سياسات جديدة.
-- آمن لإعادة التشغيل.
-- ============================================================

alter table public.subscription_payments
  add column if not exists bill_to_name text,
  add column if not exists bill_to_org  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_bill_to_len') then
    alter table public.subscription_payments
      add constraint subscription_payments_bill_to_len
      check (coalesce(char_length(bill_to_name), 0) <= 120
         and coalesce(char_length(bill_to_org),  0) <= 120);
  end if;
end $$;

-- تحقّق: يجب أن يعيد صفّين (bill_to_name, bill_to_org)
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'subscription_payments'
   and column_name in ('bill_to_name', 'bill_to_org')
 order by column_name;
