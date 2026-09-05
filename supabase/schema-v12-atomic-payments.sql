-- ============================================================
-- وثيق — schema-v12: تسجيل الدفعة والتراجع كعملية ذرّية واحدة في القاعدة
--
-- لماذا: كان تسجيل الدفعة ثلاث كتابات منفصلة من المتصفح (سطر السجل،
-- عدّاد المستأجر، محصَّل العقار) بمنطق مكرر في اللوحة وفي البوت. نتائجه:
--   1) المحصّل: سطر السجل يُقبل وتحديث العدّاد يُرفض بصمت (سياسة v9)
--      → دفعة مسجّلة والوحدة تبقى «متأخرة».
--   2) موظفان في نفس اللحظة: كلاهما يقرأ 7 ويكتب 8 — دفعة تضيع من العدّاد
--      وتبقى في السجل → كشف المالك لا يطابق العدّاد.
--   3) البوت (service role) يسجّل «بواسطة» فارغًا.
-- الحل: دالة واحدة تقفل صف المستأجر، تتحقق من الصلاحية، وتكتب الثلاثة
-- في معاملة واحدة — أو لا تكتب شيئًا. المنطق مطابق لـ applyPayment في
-- lib/contracts.ts (الجزئي يُضمّ إلى الجديد ويُحوَّل إلى دفعات كاملة).
-- ============================================================

create or replace function watheq_record_payment(
  p_tenant  uuid,
  p_amount  numeric,
  p_method  text default 'transfer',
  p_note    text default null,
  p_paid_on date default null,
  p_actor   uuid default null      -- للبوت فقط (service role): معرّف صاحب الحساب
)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  t          tenants%rowtype;
  office     uuid;
  actor      uuid;
  rent       numeric;
  pool       numeric;
  completed  int;
  newpaid    int;
  newpartial numeric;
  pid        uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ يجب أن يكون أكبر من صفر';
  end if;

  -- قفل صف المستأجر: أي تسجيل متزامن ينتظر دوره ويقرأ القيمة المحدَّثة
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  select user_id into office from properties where id = t.property_id for update;

  -- الصلاحية: مستخدم مسجَّل يحتاج can_collect؛ البوت بلا جلسة يمرّر صاحب الحساب
  if auth.uid() is not null then
    if not watheq_can_collect(office) then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  rent := coalesce(t.rent_amount, 0);
  if rent <= 0 then raise exception 'قيمة الدفعة غير محدّدة لهذا العقد'; end if;

  pool       := greatest(0, coalesce(t.partial_amount, 0)) + p_amount;
  completed  := floor(pool / rent);
  newpartial := round(pool - completed * rent, 2);
  newpaid    := greatest(0, coalesce(t.paid_periods, 0)) + completed;

  update tenants set paid_periods = newpaid, partial_amount = newpartial where id = p_tenant;
  update properties set collected = coalesce(collected, 0) + p_amount where id = t.property_id;
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by)
  values (office, p_tenant, t.property_id, coalesce(p_paid_on, current_date), p_amount,
          coalesce(nullif(p_method, ''), 'transfer'), completed, p_note, actor)
  returning id into pid;

  return jsonb_build_object('paid_periods', newpaid, 'partial_amount', newpartial,
                            'completed', completed, 'payment_id', pid);
end $$;

create or replace function watheq_undo_payment(p_tenant uuid, p_actor uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  t       tenants%rowtype;
  office  uuid;
  actor   uuid;
  rent    numeric;
  newpaid int;
  pid     uuid;
begin
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  select user_id into office from properties where id = t.property_id for update;

  -- التراجع يمسّ أرقام المالك: للمدير فقط (المحصّل يسجّل ولا يلغي)
  if auth.uid() is not null then
    if not watheq_can_manage(office) then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  if coalesce(t.paid_periods, 0) <= 0 then raise exception 'لا دفعات مسجّلة للتراجع عنها'; end if;
  rent    := coalesce(t.rent_amount, 0);
  newpaid := t.paid_periods - 1;

  update tenants set paid_periods = newpaid where id = p_tenant;
  update properties set collected = coalesce(collected, 0) - rent where id = t.property_id;
  -- صف سالب لا حذف: الأثر محفوظ والمجاميع صحيحة
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by)
  values (office, p_tenant, t.property_id, current_date, -rent, 'other', -1, 'تراجع عن دفعة', actor)
  returning id into pid;

  return jsonb_build_object('paid_periods', newpaid, 'reversed', rent, 'payment_id', pid);
end $$;

revoke all on function watheq_record_payment(uuid, numeric, text, text, date, uuid) from public, anon;
revoke all on function watheq_undo_payment(uuid, uuid) from public, anon;
grant execute on function watheq_record_payment(uuid, numeric, text, text, date, uuid) to authenticated, service_role;
grant execute on function watheq_undo_payment(uuid, uuid) to authenticated, service_role;
