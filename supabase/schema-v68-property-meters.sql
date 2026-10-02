-- ============================================================
-- وثيق — schema-v68: عدادات العقار الرئيسية (طلب مكتب عمرو باعبدالله، 2 أكتوبر 2026)
--
-- العمارة فيها أكثر من عداد مشترك: كهرباء المصعد، كهرباء الخدمات،
-- وعداد ماء أو اثنان. كل عداد: نوعه، ووصفه، ورقم حسابه.
-- (عدادا كل شقة موجودان أصلًا منذ v15: tenants.elec_account / water_account)
--
-- عمود jsonb واحد على العقار بدل جدول مستقل: العدادات تُقرأ وتُحفظ مع
-- العقار دائمًا، وتحميها سياسات RLS والحارس الحاليان على properties بلا
-- سياسة جديدة. الشكل: [{"type":"elec"|"water","label":"المصعد","account":"30012345678"}]
--
-- آمن للتشغيل أكثر من مرة. يُشغَّل قبل رفع الكود.
-- ============================================================

alter table public.properties add column if not exists meters jsonb;

-- قيد الشكل: مصفوفة حتى 30 عدادًا (أو فارغ). التفصيل يُنظَّف في الواجهة قبل الحفظ.
alter table public.properties drop constraint if exists properties_meters_shape;
alter table public.properties add constraint properties_meters_shape
  check (meters is null or (jsonb_typeof(meters) = 'array' and jsonb_array_length(meters) <= 30));

-- ─── التحقق (المتوقع: صف واحد jsonb ثم قيد واحد) ───
select column_name as العمود, data_type as النوع
  from information_schema.columns
 where table_schema = 'public' and table_name = 'properties' and column_name = 'meters';
select count(*) as قيد_العدادات from pg_constraint where conname = 'properties_meters_shape';
