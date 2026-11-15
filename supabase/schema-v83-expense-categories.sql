-- ============================================================
-- وثيق — schema-v83: تصنيفا «رواتب وأجور» و«عقود دورية» في المصروفات (15 نوفمبر 2026)
--
-- العطل: دفعة 14 نوفمبر أضافت التصنيفين في الواجهة (salaries, contracts)، لكن جدول
-- expenses القديم (schema-v8) عليه قيد CHECK يقبل التصنيفات الخمسة الأولى فقط ⇒
-- حفظ مصروف «رواتب وأجور» يُرفض، وتظهر رسالة مضلِّلة «شغّل schema-v8».
-- والقوالب الشهرية بهذين التصنيفين لا تُرحَّل (يُتخطّى القالب بصمت).
--
-- الإصلاح: حذف أي قيد CHECK على عمود category في expenses (أيًّا كان اسمه) وإنشاء
-- قيد واحد بالتصنيفات السبعة، ونفس القيد على expense_templates.
-- آمن للتشغيل أكثر من مرة. شغّله في Supabase → SQL Editor → Run.
-- ============================================================

begin;

do $$
declare c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname in ('expenses', 'expense_templates')
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%category%'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end $$;

alter table public.expenses add constraint expenses_category_check
  check (category in ('maintenance', 'utilities', 'government', 'cleaning', 'salaries', 'contracts', 'other')) not valid;

alter table public.expense_templates add constraint expense_templates_category_check
  check (category in ('maintenance', 'utilities', 'government', 'cleaning', 'salaries', 'contracts', 'other')) not valid;

commit;

notify pgrst, 'reload schema';

-- تحقّق: يجب أن يظهر القيدان وفيهما salaries و contracts
select rel.relname as الجدول, con.conname as القيد, pg_get_constraintdef(con.oid) as التعريف
  from pg_constraint con join pg_class rel on rel.oid = con.conrelid
 where rel.relname in ('expenses', 'expense_templates') and con.contype = 'c'
   and pg_get_constraintdef(con.oid) ilike '%category%';
