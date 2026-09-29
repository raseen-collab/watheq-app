-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v59: إصلاح دالة سداد الجمعيات + فرادة فواتير الاشتراك
-- (30 سبتمبر 2026)
--
-- ١) watheq_record_owner_payment (schema-v27) تقرأ assoc.monthly_fee، بينما
--    جدول associations في schema.sql عموده «fee» — والتطبيق كله (اللوحة
--    والبوت والتقارير) يقرأ fee ويكتبه. إن لم يكن عمود monthly_fee موجودًا
--    في القاعدة الحيّة فكل تسجيل سداد لمالك يفشل بخطأ
--    «record "assoc" has no field "monthly_fee"».
--    هذا الملف آمن في الحالتين:
--      • العمود monthly_fee موجود ⇒ لا تغيير على الدالة (ونعدّ الصفوف التي
--        يختلف فيها monthly_fee عن fee لتقرّر أنت).
--      • غير موجود ⇒ نأخذ تعريف الدالة الحيّ (pg_get_functiondef) ونستبدل
--        assoc.monthly_fee بـ assoc.fee حرفيًّا، ونتوقف بخطأ إن لم نجد النص.
--    CREATE OR REPLACE يُبقي المالك والصلاحيات (v47) كما هي.
--
-- ٢) subscription_payments.invoice_no: فهرس فريد — شرط لإعادة المحاولة عند
--    التصادم في app/admin/subs/actions.ts. لا يُنشأ إن وُجدت أرقام مكرَّرة
--    (يُذكر عددها في سطر الفحص) ولا إن لم يوجد الجدول.
--
-- آمن للتكرار. معاملة واحدة. لا يغيّر بيانات.
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════

begin;

do $$
declare
  fn       regprocedure := to_regprocedure('public.watheq_record_owner_payment(uuid, numeric, text, text, uuid)');
  has_mf   boolean;
  def      text;
  mismatch bigint;
  dups     bigint;
begin
  -- ── ١) دالة سداد الجمعيات ──
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'associations' and column_name = 'monthly_fee'
  ) into has_mf;

  if fn is null then
    raise exception 'watheq_record_owner_payment(uuid, numeric, text, text, uuid) غير موجودة — شغّل schema-v27 أولًا';
  end if;

  if has_mf then
    execute 'select count(*) from public.associations where monthly_fee is distinct from fee' into mismatch;
    perform set_config('watheq.v59_mismatch', mismatch::text, false);
    raise notice 'associations.monthly_fee موجود — الدالة لم تُعدَّل. صفوف يختلف فيها monthly_fee عن fee: %', mismatch;
  else
    def := pg_get_functiondef(fn);
    if position('assoc.monthly_fee' in def) > 0 then
      execute replace(def, 'assoc.monthly_fee', 'assoc.fee');
      raise notice 'watheq_record_owner_payment: assoc.monthly_fee → assoc.fee';
    elsif position('assoc.fee' in def) > 0 then
      raise notice 'watheq_record_owner_payment تقرأ assoc.fee أصلًا — لا تغيير';
    else
      raise exception 'لم يُعثر على assoc.monthly_fee ولا assoc.fee في تعريف الدالة — راجعها يدويًّا، لم يُغيَّر شيء';
    end if;
  end if;

  -- ── ٢) فرادة رقم فاتورة الاشتراك ──
  if to_regclass('public.subscription_payments') is null then
    perform set_config('watheq.v59_invoice', 'no table', false);
  else
    execute 'select count(*) from (select invoice_no from public.subscription_payments
              where invoice_no is not null group by invoice_no having count(*) > 1) d' into dups;
    if dups > 0 then
      perform set_config('watheq.v59_invoice', 'skipped: ' || dups || ' duplicated numbers', false);
      raise notice 'subscription_payments: % أرقام مكرَّرة — لم يُنشأ الفهرس الفريد', dups;
    else
      execute 'create unique index if not exists subscription_payments_invoice_no_uniq
               on public.subscription_payments (invoice_no)';
      perform set_config('watheq.v59_invoice', 'unique', false);
    end if;
  end if;
end $$;

-- فحص واحد: المتوقع بلا عمود monthly_fee ⇒ false | fee | … ؛ ومعه ⇒ true | monthly_fee | عدد الاختلاف
commit;

select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'associations' and column_name = 'monthly_fee')
    as has_monthly_fee_column,
  case
    when pg_get_functiondef(to_regprocedure('public.watheq_record_owner_payment(uuid, numeric, text, text, uuid)')) like '%assoc.monthly_fee%' then 'monthly_fee'
    when pg_get_functiondef(to_regprocedure('public.watheq_record_owner_payment(uuid, numeric, text, text, uuid)')) like '%assoc.fee%' then 'fee'
    else 'unknown'
  end as function_uses,
  nullif(current_setting('watheq.v59_mismatch', true), '') as monthly_fee_vs_fee_mismatch_rows,
  nullif(current_setting('watheq.v59_invoice', true), '') as sub_invoice_no;
