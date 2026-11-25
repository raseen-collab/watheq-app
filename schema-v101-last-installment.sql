-- ============================================================
-- v101 — القسط الأخير المختلف (24 نوفمبر 2026)
-- عقود «إيجار» تقسّم الإجمالي على أقساط مقرَّبة ويأخذ الأخير الكسر:
--   20,000 سنويًّا شهريًّا = 1,667 × 11 + 1,663
-- tenants.last_installment فارغ = كل الأقساط بقيمة rent_amount، والحساب في كل
-- الدوال هو نفسه حرفيًّا (المسار القديم لا يتغيّر). إضافة عمود ودالتين فقط،
-- وتعديل أربع دوال دفع بإضافة فرع للعقود التي فيها قسط أخير مختلف.
--
-- الرصيد بالمال (credit) لعقد فيه قسط أخير L ومدته n:
--   credit = مجموع أول paid قسطًا + الجزئي      (القسط رقم n بقيمة L)
-- والتقسيم العكسي يحترم الأخير: لا يكتمل القسط n إلا بـ L كاملًا.
-- لا حذف ولا تعديل بيانات.
-- ============================================================
alter table public.tenants add column if not exists last_installment numeric(12,2);
do $$ begin
  alter table public.tenants add constraint tenants_last_installment_chk
    check (last_installment is null or (last_installment > 0 and last_installment <= 100000000));
exception when duplicate_object then null; end $$;

/* القسط الأخير الفعّال أو null (مدة معروفة ≥ 2 وقيمة تختلف عن القسط) */
create or replace function public.watheq_last_inst(p_rent numeric, p_periods int, p_last numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p_last > 0 and coalesce(p_periods, 0) >= 2 and coalesce(p_rent, 0) > 0
              and abs(p_last - p_rent) >= 0.005 then round(p_last, 2) end
$$;

/* الرصيد بالمال من العدّاد — يساوي paid*rent + partial حرفيًّا حين لا قسط مختلف */
create or replace function public.watheq_credit_of(p_paid int, p_partial numeric, p_rent numeric, p_periods int, p_last numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when public.watheq_last_inst(p_rent, p_periods, p_last) is null
    then coalesce(p_paid, 0) * coalesce(p_rent, 0) + coalesce(p_partial, 0)
    else round(coalesce(p_paid, 0) * p_rent + coalesce(p_partial, 0)
               + case when coalesce(p_paid, 0) >= p_periods then p_last - p_rent else 0 end, 2) end
$$;

/* تقسيم الرصيد إلى أقساط مكتملة + جزئي — يفوّض لـ watheq_split_credit حين لا قسط مختلف */
create or replace function public.watheq_split_credit_t(credit numeric, rent numeric, periods int, last_amt numeric,
  out paid integer, out partial numeric)
language plpgsql immutable set search_path = public as $$
declare full_amt numeric; l numeric;
begin
  l := public.watheq_last_inst(rent, periods, last_amt);
  if l is null then
    select s.paid, s.partial into paid, partial from public.watheq_split_credit(credit, rent) s;
    return;
  end if;
  credit   := greatest(0, round(credit, 2));
  full_amt := (periods - 1) * rent + l;
  if credit >= full_amt - 0.005 then
    paid    := periods + floor(greatest(0, credit - full_amt) / rent);
    partial := round(greatest(0, credit - full_amt) - (paid - periods) * rent, 2);
  else
    paid    := least(floor(credit / rent)::int, periods - 1);
    partial := round(credit - paid * rent, 2);
  end if;
end $$;

revoke all on function public.watheq_last_inst(numeric, int, numeric) from public, anon;
revoke all on function public.watheq_credit_of(int, numeric, numeric, int, numeric) from public, anon;
revoke all on function public.watheq_split_credit_t(numeric, numeric, int, numeric) from public, anon;
grant execute on function public.watheq_last_inst(numeric, int, numeric) to authenticated, service_role;
grant execute on function public.watheq_credit_of(int, numeric, numeric, int, numeric) to authenticated, service_role;
grant execute on function public.watheq_split_credit_t(numeric, numeric, int, numeric) to authenticated, service_role;

/* تعديل الدوال الأربع بالاستبدال النصي — كل استبدال يُتحقق أنه وقع، وإلا يتوقف الترحيل كله */
do $mig$
declare d text; o text;
begin
  -- 1) تسجيل دفعة
  d := pg_get_functiondef('public.watheq_record_payment(uuid,numeric,text,text,date,uuid,text)'::regprocedure); o := d;
  d := replace(d, $a$  newpaid    := greatest(0, coalesce(t.paid_periods, 0)) + completed;
$a$, $b$  newpaid    := greatest(0, coalesce(t.paid_periods, 0)) + completed;
  /* v101: القسط الأخير المختلف — التقسيم يحترم قيمة الأخير */
  if watheq_last_inst(t.rent_amount, t.contract_periods, t.last_installment) is not null then
    select s.paid, s.partial into newpaid, newpartial
      from watheq_split_credit_t(watheq_credit_of(greatest(0, coalesce(t.paid_periods, 0)), greatest(0, coalesce(t.partial_amount, 0)),
                                                  rent, t.contract_periods, t.last_installment) + p_amount,
                                 rent, t.contract_periods, t.last_installment) s;
    completed := newpaid - greatest(0, coalesce(t.paid_periods, 0));
  end if;
$b$);
  if d = o then raise exception 'v101: record_payment لم يتغيّر'; end if;
  execute d;

  -- 2) عكس دفعة
  d := pg_get_functiondef('public.watheq_reverse_payment(uuid,uuid)'::regprocedure); o := d;
  d := replace(d, 'credit := coalesce(t.paid_periods, 0) * coalesce(t.rent_amount, 0) + coalesce(t.partial_amount, 0) - watheq_pay_effect(',
                  'credit := watheq_credit_of(coalesce(t.paid_periods, 0), coalesce(t.partial_amount, 0), coalesce(t.rent_amount, 0), t.contract_periods, t.last_installment) - watheq_pay_effect(');
  if d = o then raise exception 'v101: reverse_payment (credit) لم يتغيّر'; end if; o := d;
  d := replace(d, 's := watheq_split_credit(credit, t.rent_amount);', 's := watheq_split_credit_t(credit, t.rent_amount, t.contract_periods, t.last_installment);');
  if d = o then raise exception 'v101: reverse_payment (split) لم يتغيّر'; end if;
  execute d;

  -- 3) تعديل دفعة
  d := pg_get_functiondef('public.watheq_edit_payment(uuid,numeric,text,date,text,text)'::regprocedure); o := d;
  d := replace(d, 'credit := coalesce(t.paid_periods, 0) * t.rent_amount + coalesce(t.partial_amount, 0) + delta;',
                  'credit := watheq_credit_of(coalesce(t.paid_periods, 0), coalesce(t.partial_amount, 0), t.rent_amount, t.contract_periods, t.last_installment) + delta;');
  if d = o then raise exception 'v101: edit_payment (credit) لم يتغيّر'; end if; o := d;
  d := replace(d, 's := watheq_split_credit(credit, t.rent_amount);', 's := watheq_split_credit_t(credit, t.rent_amount, t.contract_periods, t.last_installment);');
  if d = o then raise exception 'v101: edit_payment (split) لم يتغيّر'; end if;
  execute d;

  -- 4) التراجع عن آخر دفعة
  d := pg_get_functiondef('public.watheq_undo_payment(uuid,uuid)'::regprocedure); o := d;
  d := replace(d, 'credit := coalesce(t.paid_periods, 0) * coalesce(t.rent_amount, 0) + coalesce(t.partial_amount, 0);',
                  'credit := watheq_credit_of(coalesce(t.paid_periods, 0), coalesce(t.partial_amount, 0), coalesce(t.rent_amount, 0), t.contract_periods, t.last_installment);');
  if d = o then raise exception 'v101: undo_payment (credit) لم يتغيّر'; end if; o := d;
  d := replace(d, '), t.rent_amount);', '), t.rent_amount, t.contract_periods, t.last_installment);');
  d := replace(d, 'watheq_split_credit(', 'watheq_split_credit_t(');
  if d = o then raise exception 'v101: undo_payment (split) لم يتغيّر'; end if;
  execute d;
end $mig$;

-- v101b: بوابة المستأجر تعرض القسط الأخير المختلف بقيمته (حقل إضافي في JSON فقط)
do $mig$
declare d text; o text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'watheq_tenant_portal';
  o := d;
  d := replace(d, $a$'contract_periods', tj->'contract_periods',$a$, $b$'contract_periods', tj->'contract_periods', 'last_installment', tj->'last_installment',$b$);
  if d = o then raise exception 'v101b: portal unchanged'; end if;
  execute d;
end $mig$;
