-- ============================================================
-- وثيق — schema-v58 (30 سبتمبر 2026) — ثلاثة حُرّاس للمال في دوال الدفعات
--
-- ١) عكس دفعة «أقدم» بعد تعديل الإيجار (watheq_reverse_payment)
--    v56 يعيد تقييم الدفعة بإيجار اليوم بعدد الأقساط التي أكملتها هي. لكن قسطًا
--    أكملته دفعتان معًا لا يُنسب لإحداهما: إيجار 1000، دفع 600 ثم 600، صار الإيجار
--    1200، عكسُ الأولى يترك «جزئي 800» والصحيح 600. لا صيغة آمنة لتوزيعه، فالقاعدة:
--    إن تغيّر الإيجار منذ الدفعة وسُجّلت بعدها دفعة إيجار لم تُعكس ⟵ يُرفض العكس
--    برسالة واضحة (اعكس الأحدث أولًا — العكس بالترتيب العكسي صحيح دائمًا).
-- ٢) تاريخ سداد خارج المعقول (watheq_record_payment)
--    كانت تقبل 1901-01-01 فيدخل المبلغ دفاتر سنة لا وجود لها ويختفي من تقرير
--    الشهر. المقبول: من (بداية العقد − سنة) حتى (اليوم بتوقيت الرياض + يوم).
-- ٣) التراجع عن رصيد افتتاحي جزئي (watheq_undo_payment)
--    من سُجّل له 400 قبل وثيق (بلا دفعة كاملة) ثم تراجع: كان السجل يقول «دفعة
--    سُدّدت» بمبلغ قسط كامل (1000)، والمُزال فعلًا 400. الآن المبلغ والنص الصحيحان.
--
-- الدوال الحيّة تُرقَّع في موضعها (لا تُستبدل بنسخة المستودع) — كنمط v56.
-- إن لم يُعثر على أي سطر متوقَّع يتوقف الملف كله بلا أي تغيير.
-- يتطلّب v56 (عمود rent_at_payment وwatheq_pay_effect). آمن للتكرار.
-- ============================================================
begin;

do $$
declare def text;
  /* ١) العكس — الحارس قبل سطر الرصيد الذي أضافه v56 */
  a1 text := 'credit := coalesce(t.paid_periods, 0) * coalesce(t.rent_amount, 0) + coalesce(t.partial_amount, 0) - watheq_pay_effect(pay.amount';
  b1 text := '/* v58 (30 سبتمبر 2026): قسط أكملته دفعتان لا يُعاد تقييمه بإيجار جديد بأمان */
    if pay.rent_at_payment is not null and pay.rent_at_payment <> coalesce(t.rent_amount, 0)
       and exists (select 1 from payments q
                    where q.tenant_id = pay.tenant_id and q.id <> pay.id and q.amount > 0
                      and coalesce(q.applies_to, ''rent'') = ''rent'' and q.past_tenancy_id is null
                      and q.created_at >= pay.created_at
                      and not exists (select 1 from payments r where r.reverses = q.id)) then
      raise exception ''v58: تغيّر الإيجار بعد هذه الدفعة (من % إلى %) وسُجّلت بعدها دفعات — اعكس الدفعات الأحدث أولًا أو صحّح يدويًّا'',
        pay.rent_at_payment, t.rent_amount;
    end if;
    ' || a1;
  /* ٢) التسجيل — الحارس بعد سطر «تاريخ السداد في المستقبل» */
  a2 text := 'if p_paid_on is not null and p_paid_on > (current_date + 1) then raise exception ''تاريخ السداد في المستقبل''; end if;';
  b2 text := a2 || '
  /* v58 (30 سبتمبر 2026): تاريخ سداد خارج المعقول */
  if p_paid_on is not null and (
       p_paid_on > ((now() at time zone ''Asia/Riyadh'')::date + 1)
       or p_paid_on < coalesce((t.contract_start - interval ''1 year'')::date, date ''2000-01-01'')) then
    raise exception ''v58: تاريخ السداد % غير منطقي — المقبول من % حتى %'', p_paid_on,
      coalesce((t.contract_start - interval ''1 year'')::date, date ''2000-01-01''),
      ((now() at time zone ''Asia/Riyadh'')::date + 1);
  end if;';
  /* ٣) التراجع عن رصيد افتتاحي */
  a3 text := 's.paid - coalesce(t.paid_periods, 0), t.rent_amount,';
  b3 text := 's.paid - coalesce(t.paid_periods, 0), least(credit, coalesce(t.rent_amount, 0)),';
  a4 text := '''تصحيح عدّاد: دفعة سُدّدت قبل وثيق (رصيد افتتاحي) — بلا أثر نقدي''';
  b4 text := 'case when credit < coalesce(t.rent_amount, 0) then ''تصحيح عدّاد: سداد جزئي ('' || round(credit, 2) || '') سُجّل قبل وثيق (رصيد افتتاحي) — بلا أثر نقدي'' else ' || a4 || ' end';
begin
  -- ١
  def := pg_get_functiondef('public.watheq_reverse_payment(uuid, uuid)'::regprocedure);
  if position('v58:' in def) = 0 then
    if position(a1 in def) = 0 then raise exception 'v58 reverse_payment: السطر المتوقع غير موجود (هل طُبّق v56؟) — لم يُعدَّل شيء'; end if;
    execute replace(def, a1, b1);
  end if;
  -- ٢
  def := pg_get_functiondef('public.watheq_record_payment(uuid, numeric, text, text, date, uuid, text)'::regprocedure);
  if position('v58:' in def) = 0 then
    if position(a2 in def) = 0 then raise exception 'v58 record_payment: السطر المتوقع غير موجود — لم يُعدَّل شيء'; end if;
    execute replace(def, a2, b2);
  end if;
  -- ٣
  def := pg_get_functiondef('public.watheq_undo_payment(uuid, uuid)'::regprocedure);
  if position('سداد جزئي ('' ||' in def) = 0 then
    if position(a3 in def) = 0 or position(a4 in def) = 0 then
      raise exception 'v58 undo_payment: السطر المتوقع غير موجود — لم يُعدَّل شيء';
    end if;
    execute replace(replace(def, a3, b3), a4, b4);
  end if;
end $$;

commit;

-- التحقق — آخر أمر، فمحرر Supabase يعرض نتيجته وحدها. المتوقع: true في الأعمدة الثلاثة.
select
  position('v58:' in pg_get_functiondef('public.watheq_reverse_payment(uuid, uuid)'::regprocedure)) > 0 as عكس_الأقدم_محروس,
  position('v58:' in pg_get_functiondef('public.watheq_record_payment(uuid, numeric, text, text, date, uuid, text)'::regprocedure)) > 0 as تاريخ_السداد_محروس,
  position('سداد جزئي ('' ||' in pg_get_functiondef('public.watheq_undo_payment(uuid, uuid)'::regprocedure)) > 0 as تراجع_الافتتاحي_مُصحَّح;
