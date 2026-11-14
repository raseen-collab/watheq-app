-- ============================================================
-- وثيق — schema-v82: بنود إشعار انتهاء العقد (14 نوفمبر 2026)
--
-- طلب مكتب «الأولى» (من خطابهم الورقي): في إشعار الانتهاء تُذكر الرسوم
-- الإدارية للتجديد، والأجرة اليومية بعد نهاية العقد بموجب مادة فيه، وشرط
-- «لا تجديد مع وجود متأخرات»، وقيمة الإيجار عند التجديد.
-- كلها إعدادات مكتب اختيارية (الإعدادات ← إشعار انتهاء العقد). ما لم يُضبط
-- لا يظهر في النص — المكاتب الأخرى لا يتغيّر إشعارها حرفًا.
--
-- آمن للتشغيل أكثر من مرة.
-- ============================================================
alter table public.profiles add column if not exists notice_admin_fee numeric(12,2) check (notice_admin_fee is null or notice_admin_fee >= 0);
alter table public.profiles add column if not exists notice_daily_rent numeric(12,2) check (notice_daily_rent is null or notice_daily_rent >= 0);
alter table public.profiles add column if not exists notice_daily_article text check (notice_daily_article is null or char_length(notice_daily_article) <= 40);
alter table public.profiles add column if not exists notice_no_renew_arrears boolean not null default false;
alter table public.profiles add column if not exists notice_show_rent boolean not null default false;

comment on column public.profiles.notice_admin_fee is 'رسوم إدارية تُذكر في إشعار الانتهاء عند التجديد (اختياري)';
comment on column public.profiles.notice_daily_rent is 'أجرة يومية بعد نهاية العقد حتى الإخلاء — تُذكر في الإشعار (اختياري)';
comment on column public.profiles.notice_daily_article is 'رقم مادة العقد التي تنص على الأجرة اليومية، مثل 12/3';

notify pgrst, 'reload schema';

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
          and column_name like 'notice_%') as أعمدة_الإشعار_المتوقع_5;
