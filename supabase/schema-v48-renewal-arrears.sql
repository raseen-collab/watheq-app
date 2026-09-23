-- ============================================================
-- وثيق — schema-v48: شطب جزء من الدين المرحَّل — بأثر
--
-- التجديد كان يسأل عن متأخرات المدة المنتهية: «إلغاء = سُدّدت بالكامل ولا
-- تُرحَّل» — فتُمحى بلا أثر: إن استُلمت نقدًا لم تدخل الدفتر ولا تقرير المالك،
-- وإن تُنوزل عنها ضاع أنها كانت دينًا. (العطل نفسه الذي أُصلح في إعادة
-- التأجير، v45.) الآن للتجديد ثلاثة مصائر: تُرحَّل، أو «استلمتُها» (سداد نقدي
-- في الدفتر)، أو «تنازلتُ عنها» (شطب بسببه).
--
-- والشطب هنا جزئي بالضرورة: الوحدة قد يكون عليها دين مرحَّل قديم لا يُشطب
-- مع متأخرات التجديد. p_amount اختياري — بدونه يُشطب الدين كله كالسابق
-- (فشاشة «الديون المرحَّلة» لا تتغيّر).
--
-- يتطلب v43 و v45. لا يغيّر بيانات. آمن للتكرار.
-- ============================================================

begin;

drop function if exists watheq_write_off_carried(uuid, text, uuid);
create or replace function watheq_write_off_carried(p_tenant uuid, p_note text, p_actor uuid default null, p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; amt numeric;
begin
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  select user_id into office from properties where id = t.property_id;
  if auth.uid() is not null then
    if not watheq_perm(office, 'edit_units') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'اذكر سبب الشطب — يُحفظ في السجل'; end if;
  if coalesce(t.carried_debt, 0) <= 0 then raise exception 'لا دين مرحَّل على هذه الوحدة'; end if;
  amt := round(coalesce(p_amount, t.carried_debt), 2);
  if amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if amt > t.carried_debt + 0.005 then
    raise exception 'المبلغ أكبر من الدين المرحَّل (%)', round(t.carried_debt, 2);
  end if;
  insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
  values (office, p_tenant, t.property_id, 'repair', 0, amt,
          'شطب ' || case when amt < t.carried_debt - 0.005 then 'جزء من دين مرحَّل' else 'دين مرحَّل' end
          || ' على ' || coalesce(t.name, 'الساكن') || ' (' || amt || ' من ' || round(t.carried_debt, 2) || ') — ' || btrim(p_note), actor);
  update tenants set carried_debt = round(t.carried_debt - amt, 2) where id = p_tenant;
  return jsonb_build_object('written_off', amt, 'carried_debt', round(t.carried_debt - amt, 2));
end $$;
revoke all on function watheq_write_off_carried(uuid, text, uuid, numeric) from public, anon;
grant execute on function watheq_write_off_carried(uuid, text, uuid, numeric) to authenticated;

commit;

select p.oid::regprocedure as الدالة,
       case when has_function_privilege('anon', p.oid, 'execute') then 'نعم ❌' else 'لا ✅' end as يستدعيها_الزائر
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'watheq_write_off_carried';
