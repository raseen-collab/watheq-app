-- ============================================================
-- وثيق — schema-v86: أتعاب إدارة بمبلغ ثابت ودورية (15 نوفمبر 2026)
--
-- طلب مكتب تميز: ليست كل العمائر بنسبة — بعضها مبلغ مقتطع (شهري، أو كل ٦ أشهر،
-- أو سنوي، أو مرة واحدة فقط).
--   mgmt_fee_mode   : 'pct' (النسبة من المحصَّل — كما كان) أو 'fixed' (مبلغ ثابت).
--   mgmt_fee_amount : المبلغ بالريال عند 'fixed'.
--   mgmt_fee_period : 'month' (× أشهر الفترة) · 'half' · 'year' · 'once'.
--   mgmt_fee_on     : تاريخ الاستحقاق للدوريات غير الشهرية (ثم كل ٦/١٢ شهرًا بعده؛
--                     «مرة واحدة» = هذا التاريخ فقط). يُخصم المبلغ في كل تقرير تقع في
--                     فترته أحد الاستحقاقات.
-- كل العمائر الحالية تبقى على النسبة بلا تغيير. آمن للتشغيل أكثر من مرة.
-- Supabase → SQL Editor → Run.
-- ============================================================
alter table public.properties add column if not exists mgmt_fee_mode text not null default 'pct';
alter table public.properties add column if not exists mgmt_fee_amount numeric(14,2);
alter table public.properties add column if not exists mgmt_fee_period text not null default 'month';
alter table public.properties add column if not exists mgmt_fee_on date;
alter table public.properties drop constraint if exists properties_mgmt_fee_mode_check;
alter table public.properties add constraint properties_mgmt_fee_mode_check check (mgmt_fee_mode in ('pct', 'fixed'));
alter table public.properties drop constraint if exists properties_mgmt_fee_amount_check;
alter table public.properties add constraint properties_mgmt_fee_amount_check check (mgmt_fee_amount is null or mgmt_fee_amount >= 0);
alter table public.properties drop constraint if exists properties_mgmt_fee_period_check;
alter table public.properties add constraint properties_mgmt_fee_period_check check (mgmt_fee_period in ('month', 'half', 'year', 'once'));
notify pgrst, 'reload schema';
select count(*) as الأعمدة_يجب_4 from information_schema.columns
 where table_schema = 'public' and table_name = 'properties'
   and column_name in ('mgmt_fee_mode', 'mgmt_fee_amount', 'mgmt_fee_period', 'mgmt_fee_on');
