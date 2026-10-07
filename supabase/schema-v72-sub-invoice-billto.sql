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


-- ============================================================
-- توقيع صاحب المنصة على فواتير الاشتراك (5 أكتوبر 2026)
-- صورة PNG/JPEG واحدة تُحفظ مرة، وتُطبع تلقائيًّا في خانة «التوقيع».
-- جدول إعدادات عام للمنصة، يُقرأ ويُكتب بمفتاح الخدمة من لوحة الإدارة فقط:
-- RLS مفعّل بلا أي سياسة = لا قراءة ولا كتابة لأي مستخدم عادي.
-- ============================================================
create table if not exists public.platform_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
-- Supabase من 30 أكتوبر 2026 لا يمنح الجداول الجديدة تلقائيًّا: الصلاحية صريحة لمفتاح الخدمة
grant select, insert, update, delete on public.platform_settings to service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_settings_value_len') then
    alter table public.platform_settings
      add constraint platform_settings_value_len check (coalesce(char_length(value), 0) <= 400000);
  end if;
end $$;

-- تحقّق (صفّ واحد): bill_to_columns = 2 و platform_settings_ready = true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'subscription_payments'
      and column_name in ('bill_to_name', 'bill_to_org'))         as bill_to_columns,
  to_regclass('public.platform_settings') is not null              as platform_settings_ready;
