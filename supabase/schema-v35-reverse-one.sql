-- ============================================================
-- وثيق — schema-v35: عكس دفعة بعينها
--
-- «التراجع» يعكس آخر دفعة فقط. ومن اكتشف بعد شهرين أن دفعة قديمة سُجّلت
-- بمبلغ أكبر مما استُلم، كان عليه التراجع عن كل الدفعات التي بعدها ثم
-- إعادة تسجيلها — عمل طويل يفتح باب أخطاء جديدة.
--
-- هنا يعكس المكتب الدفعة الخاطئة وحدها: صفّ سالب يطابقها مبلغًا وتاريخًا،
-- فيُصحَّح الشهر الذي دخلت فيه، ويُنقص العدّاد بعدد فتراتها.
-- ثم يسجّل المبلغ الصحيح كدفعة عادية إن أراد.
--
-- لا حذف: الصفّان يبقيان في السجل، فيرى المدقّق ما حدث ومن فعله.
-- ============================================================

create or replace function watheq_reverse_payment(p_payment uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; t tenants%rowtype; office uuid; actor uuid;
        periods int; newpaid int; pid uuid; already numeric;
begin
  select * into pay from payments where id = p_payment for update;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  if pay.amount <= 0 then raise exception 'هذا الصفّ عكسٌ أصلًا ولا يُعكس'; end if;

  select * into t from tenants where id = pay.tenant_id for update;
  if not found then raise exception 'الوحدة غير موجودة'; end if;
  select user_id into office from properties where id = pay.property_id for update;

  if auth.uid() is not null then
    if not watheq_perm(office, 'undo_actions') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  /* عُكست من قبل؟ صفّ سالب بنفس المبلغ والتاريخ يشير إليها في الملاحظة */
  select coalesce(sum(-amount), 0) into already from payments
   where tenant_id = pay.tenant_id and amount < 0 and note like '%' || p_payment::text || '%';
  if already >= pay.amount then raise exception 'سبق عكس هذه الدفعة'; end if;

  periods := greatest(1, coalesce(pay.periods_covered, 1));
  newpaid := greatest(0, coalesce(t.paid_periods, 0) - periods);

  update tenants set paid_periods = newpaid where id = pay.tenant_id;
  update properties set collected = greatest(0, coalesce(collected, 0) - pay.amount) where id = pay.property_id;

  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by)
  values (office, pay.tenant_id, pay.property_id, pay.paid_on, -pay.amount, 'other', -periods,
          'عكس دفعة ' || pay.paid_on::text || ' — ' || p_payment::text, actor)
  returning id into pid;

  return jsonb_build_object('paid_periods', newpaid, 'reversed', pay.amount,
                            'paid_on', pay.paid_on, 'payment_id', pid);
end $$;

revoke all on function watheq_reverse_payment(uuid, uuid) from public, anon;
grant execute on function watheq_reverse_payment(uuid, uuid) to authenticated;
