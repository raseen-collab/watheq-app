-- ============================================================
-- وثيق — schema-v27: رصيد صندوق الجمعية بعملية ذرّية
--
-- بقي هذا المسار على النمط القديم بعد إصلاح الدفعات: الواجهة تقرأ الرصيد
-- ثم تكتب (رصيد + مبلغ). موظفان يسجّلان في اللحظة نفسها: كلاهما يقرأ نفس
-- الرصيد ويكتب فوق الآخر — فيضيع مبلغ من الصندوق بلا أثر. ومع فشل صامت
-- (لا فحص للخطأ في الواجهة) لا يعرف أحد.
--
-- الحل: زيادة/نقص الرصيد داخل القاعدة بقفل الصف، مع تحقق الصلاحية.
-- ============================================================
create or replace function watheq_adjust_fund(p_assoc uuid, p_delta numeric)
returns numeric language plpgsql security definer
set search_path = public as $$
declare a associations%rowtype; newbal numeric;
begin
  select * into a from associations where id = p_assoc for update;
  if not found then raise exception 'الجمعية غير موجودة'; end if;
  if auth.uid() is not null and not watheq_perm(a.user_id, 'record_payments') then
    raise exception 'not authorized';
  end if;
  newbal := round(coalesce(a.fund_balance, 0) + coalesce(p_delta, 0), 2);
  update associations set fund_balance = newbal where id = p_assoc;
  return newbal;
end $$;

revoke all on function watheq_adjust_fund(uuid, numeric) from public, anon;
grant execute on function watheq_adjust_fund(uuid, numeric) to authenticated, service_role;

-- وتسجيل اشتراك المالك يحرّك الصندوق داخل العملية نفسها بدل كتابتين
create or replace function watheq_record_owner_payment(
  p_owner uuid, p_amount numeric, p_method text default 'transfer',
  p_note text default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o owners%rowtype; assoc associations%rowtype; office uuid; actor uuid;
        fee numeric; pool numeric; months int; newpartial numeric; newlate int; pid uuid; newbal numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  select * into o from owners where id = p_owner for update;
  if not found then raise exception 'المالك غير موجود'; end if;
  select * into assoc from associations where id = o.association_id for update;
  office := assoc.user_id;

  if auth.uid() is not null then
    if not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  fee := coalesce(assoc.monthly_fee, 0);
  if fee <= 0 then raise exception 'اشتراك الجمعية الشهري غير محدَّد'; end if;

  pool       := greatest(0, coalesce(o.partial_amount, 0)) + p_amount;
  months     := floor(pool / fee);
  newpartial := round(pool - months * fee, 2);
  newlate    := greatest(0, coalesce(o.months_late, 0) - months);

  update owners set months_late = newlate, partial_amount = newpartial,
                    last_paid = case when months > 0 then current_date else last_paid end
   where id = p_owner;

  -- الرصيد داخل القفل نفسه: لا سباق ولا مبلغ يضيع
  newbal := round(coalesce(assoc.fund_balance, 0) + p_amount, 2);
  update associations set fund_balance = newbal where id = assoc.id;

  insert into payments (user_id, owner_id, association_id, paid_on, amount, method,
                        periods_covered, note, created_by)
  values (office, p_owner, assoc.id, current_date, p_amount,
          coalesce(nullif(p_method, ''), 'transfer'), months, p_note, actor)
  returning id into pid;

  return jsonb_build_object('months_late', newlate, 'partial_amount', newpartial,
                            'months', months, 'payment_id', pid, 'fund_balance', newbal);
end $$;
