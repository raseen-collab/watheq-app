-- ============================================================
-- وثيق v106 — ملاحظة الدفعة تتسع لرسالة التحويل كاملة (24 نوفمبر 2026 — طلب مكتب الأولى)
--
-- المكتب يلصق رسالة البنك («تم تحويل 1,500 ر.س من … مرجع …») في ملاحظة سند القبض.
-- تسجيل الدفعة (watheq_record_payment) لا يقصّ الملاحظة، لكن تعديلها (watheq_edit_payment)
-- كان يقصّها عند 500 حرف والمرجع عند 80 — تعديل المبلغ وحده كان سيقطع رسالة طويلة بصمت.
-- هنا: الملاحظة حتى 1000 حرف والمرجع حتى 200 — نفس حدود الواجهة. لا شيء آخر يتغيّر في الدالة.
-- يُعاد إنشاء الدالة من تعريفها الحالي نفسه (CREATE OR REPLACE يُبقي المالك والصلاحيات)،
-- ويتوقف إن لم يجد السطرين بالضبط — فلا يُطبَّق على تعريف غير متوقَّع.
-- ============================================================
do $$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.watheq_edit_payment(uuid,numeric,text,date,text,text)'::regprocedure);
  d2 := replace(d,  $q$left(nullif(btrim(coalesce(p_note, '')), ''), 500)$q$,      $q$left(nullif(btrim(coalesce(p_note, '')), ''), 1000)$q$);
  d2 := replace(d2, $q$left(nullif(btrim(coalesce(p_reference, '')), ''), 80)$q$,  $q$left(nullif(btrim(coalesce(p_reference, '')), ''), 200)$q$);
  if d2 = d or position('p_note, '''')), ''''), 1000)' in d2) = 0 or position('p_reference, '''')), ''''), 200)' in d2) = 0 then
    if position('p_note, '''')), ''''), 1000)' in d) > 0 then
      raise notice 'v106 مطبّق سابقًا'; return;
    end if;
    raise exception 'v106: تعريف watheq_edit_payment غير المتوقَّع — لم يُغيَّر شيء';
  end if;
  execute d2;
end $$;

revoke all on function public.watheq_edit_payment(uuid,numeric,text,date,text,text) from public, anon;
grant execute on function public.watheq_edit_payment(uuid,numeric,text,date,text,text) to authenticated;
