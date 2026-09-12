-- ============================================================
-- وثيق — schema-v34: التراجع يعكس الدفعة الحقيقية
--
-- التراجع اليوم ينشئ صفًّا سالبًا بقيمة «الإيجار الحالي» وبتاريخ «اليوم».
-- وهذا يكسر شيئين:
--
-- 1) الشهر الخطأ: دفعة استُلمت في أغسطس ويُتراجع عنها في سبتمبر تُنقص
--    تحصيل سبتمبر ويبقى أغسطس منتفخًا. والمكتب يقرأ «التحصيل شهرًا بشهر»
--    فيجد شهرًا مضخَّمًا وآخر منقوصًا بلا سبب ظاهر.
--
-- 2) المبلغ الخطأ: إن تغيّر الإيجار بعد التسجيل، أو كانت الدفعة جزئية أو
--    بمبلغ مختلف، يُعكَس مبلغ لم يُستلم أصلًا — فيختلّ الصافي.
--
-- الصحيح: نعكس آخر دفعة موجبة فعلية بمبلغها وتاريخها، ونُنقص العدّاد
-- بعدد الفترات التي غطّتها هي لا بواحد ثابت.
-- ============================================================

create or replace function watheq_undo_payment(p_tenant uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; last_pay payments%rowtype;
        back numeric; periods int; newpaid int; pid uuid;
begin
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  select user_id into office from properties where id = t.property_id for update;

  if auth.uid() is not null then
    if not watheq_perm(office, 'undo_actions') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  if coalesce(t.paid_periods, 0) <= 0 then raise exception 'لا دفعات مسجّلة للتراجع عنها'; end if;

  /* آخر دفعة موجبة لم يُتراجع عنها بعد — نعكسها هي بمبلغها وتاريخها */
  select * into last_pay from payments
   where tenant_id = p_tenant and amount > 0
   order by created_at desc limit 1;

  if found then
    back    := last_pay.amount;
    periods := greatest(1, coalesce(last_pay.periods_covered, 1));
  else
    -- رصيد افتتاحي بلا سجل دفعة: نعود للسلوك القديم
    back    := coalesce(t.rent_amount, 0);
    periods := 1;
  end if;

  newpaid := greatest(0, coalesce(t.paid_periods, 0) - periods);
  update tenants set paid_periods = newpaid where id = p_tenant;
  update properties set collected = greatest(0, coalesce(collected, 0) - back) where id = t.property_id;

  /* صفّ سالب لا حذف: الأثر محفوظ للتدقيق. وبتاريخ الدفعة الأصلية حتى
     يُصحَّح الشهر الذي دخلت فيه لا الشهر الجاري. */
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by)
  values (office, p_tenant, t.property_id,
          coalesce(last_pay.paid_on, current_date), -back, 'other', -periods,
          'تراجع عن دفعة' || coalesce(' بتاريخ ' || last_pay.paid_on::text, ''), actor)
  returning id into pid;

  return jsonb_build_object('paid_periods', newpaid, 'reversed', back,
                            'paid_on', coalesce(last_pay.paid_on, current_date), 'payment_id', pid);
end $$;

revoke all on function watheq_undo_payment(uuid, uuid) from public, anon;
grant execute on function watheq_undo_payment(uuid, uuid) to authenticated;
