-- ============================================================
-- وثيق — schema-v46: تصحيح دين مستأجر سابق — بأثر
--
-- إعادات التأجير التي تمّت قبل إصلاحات 22 سبتمبر قد تكون أرشفت الدين ناقصًا:
--   • «إلغاء = سُوّي» كان يؤرشفه بصفر بلا أثر (نقدًا استُلم أم تُنوزل عنه).
--   • مهلة السماح كانت تُسقط قسطًا حلّ قبل الخروج بأيام.
-- «فحص سلامة البيانات» يعيد حساب الدين من نسخة صفّ المستأجر المحفوظة في
-- الأرشيف ويعرض الفرق. هذه الدالة تضبطه — ويُحفظ الأثر: من، ومتى، ومن كم
-- إلى كم. ثم يُسوّى من «الديون المرحَّلة» كأي دين: سداد نقدي، أو شطب.
--
-- يتطلب v43 و v45. لا يغيّر بيانات عند تشغيله. آمن للتكرار.
-- ============================================================

create or replace function watheq_correct_past_debt(p_past uuid, p_amount numeric, p_note text, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pt past_tenancies%rowtype; actor uuid;
begin
  select * into pt from past_tenancies where id = p_past for update;
  if not found then raise exception 'السجل غير موجود'; end if;
  if auth.uid() is not null then
    if not watheq_perm(pt.user_id, 'edit_units') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> pt.user_id then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'المبلغ غير صالح'; end if;
  if p_amount < pt.debt_paid - 0.005 then
    raise exception 'لا يقلّ الدين عمّا سُدّد منه (%)', round(pt.debt_paid, 2);
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'اذكر سبب التصحيح — يُحفظ في السجل'; end if;

  insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
  values (pt.user_id, pt.unit_row_id, pt.property_id, 'repair', 0, p_amount,
          'تصحيح دين ' || pt.name || ': من ' || pt.debt_amount || ' إلى ' || round(p_amount, 2) || ' — ' || btrim(p_note), actor);

  update past_tenancies
     set debt_amount = round(p_amount, 2),
         /* صار عليه متبقٍّ ⇒ يُفتح للمتابعة (ما لم يكن مشطوبًا أو عند التنفيذ) */
         debt_status = case when round(p_amount, 2) - debt_paid > 0.005 and debt_status = 'settled' then 'open'
                            when round(p_amount, 2) - debt_paid <= 0.005 then 'settled'
                            else debt_status end
   where id = p_past;
  return jsonb_build_object('debt_amount', round(p_amount, 2));
end $$;
revoke all on function watheq_correct_past_debt(uuid, numeric, text, uuid) from public, anon;
grant execute on function watheq_correct_past_debt(uuid, numeric, text, uuid) to authenticated;

select 'watheq_correct_past_debt' as الدالة,
       (select count(*) from pg_proc where proname = 'watheq_correct_past_debt') as موجودة;
