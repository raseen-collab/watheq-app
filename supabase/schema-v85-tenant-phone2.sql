-- ============================================================
-- وثيق — schema-v85: جوال إضافي للمستأجر (15 نوفمبر 2026)
--
-- طلب مكتب تميز: مستأجر له رقمان (مثلًا رقمه ورقم زوجته/شريكه/ولي الأمر).
-- عمود واحد اختياري؛ الرقم الأول يبقى الأساسي للتذكير الجماعي والرابط،
-- والإضافي يظهر في البطاقة ويُرسل إليه التذكير/الاتصال بزر مستقل، ويُرفع
-- من الإكسل بعمود «جوال إضافي» ويُصدَّر معه.
-- آمن للتشغيل أكثر من مرة. Supabase → SQL Editor → Run.
-- ============================================================
alter table public.tenants add column if not exists phone2 text;
alter table public.tenants drop constraint if exists tenants_phone2_len;
alter table public.tenants add constraint tenants_phone2_len check (phone2 is null or char_length(phone2) <= 30);
notify pgrst, 'reload schema';
select column_name as العمود_يجب_phone2 from information_schema.columns where table_name = 'tenants' and column_name = 'phone2';
