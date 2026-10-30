-- ============================================================
-- وثيق — schema-v77: «أقل عدد غرف» في طلبات الباحثين (29 أكتوبر 2026)
--
-- زبون يطلب «شقة ٣ غرف» كانت تُطابَق له شقة غرفتين: الطلب لا يحفظ الغرف.
-- عمود واحد اختياري، بلا تعديل على بيانات قائمة ولا على الصلاحيات.
-- آمن للتشغيل أكثر من مرة.
-- ============================================================

alter table public.seeker_requests
  add column if not exists rooms_min smallint
  check (rooms_min is null or (rooms_min >= 1 and rooms_min <= 20));

-- يُحدِّث ذاكرة PostgREST فيعرف العمود فورًا بلا انتظار
notify pgrst, 'reload schema';

-- التحقق: يجب أن يرجع صفًّا واحدًا: rooms_min | smallint
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'seeker_requests' and column_name = 'rooms_min';
