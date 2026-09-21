-- ============================================================
-- وثيق — schema-v41: عمود التقويم الافتراضي (كان مفقودًا)
--
-- العطل: الإعدادات ترسل default_calendar في كل حفظ، ولا ملف SQL في
-- المشروع يُنشئ العمود — فكان كل حفظ للإعدادات يفشل برسالة:
--   Could not find the 'default_calendar' column of 'profiles'
-- ظهر عند تبديل الحساب إلى مزدوج، لكنه يصيب أي تعديل في الإعدادات.
--
-- آمن للتشغيل أكثر من مرة: «if not exists» والقيد يُعاد إنشاؤه.
-- ============================================================

alter table public.profiles
  add column if not exists default_calendar text not null default 'gregorian';

alter table public.profiles drop constraint if exists profiles_default_calendar_chk;
alter table public.profiles add constraint profiles_default_calendar_chk
  check (default_calendar in ('gregorian', 'hijri'));

/* الإعدادات يعدّلها صاحب الحساب — كبقية أعمدة ملفه */
grant update (default_calendar) on public.profiles to authenticated;

/* رسالة الخطأ ذكرت «schema cache»: نطلب من واجهة Supabase إعادة قراءة
   الهيكل فورًا بدل انتظارها */
notify pgrst, 'reload schema';

-- فحص: يجب أن يُرجع صفًّا واحدًا
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'default_calendar';
