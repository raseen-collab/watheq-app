-- ============================================================
-- v102 — نقل دفعة بين «أقساط» و«دين مرحَّل» (24 نوفمبر 2026)
-- فحص المحاسب: دفعة سُجّلت قسطًا وهي سداد للدين المرحَّل (أو العكس) كانت تحتاج
-- عكسًا يدويًّا ثم إعادة تسجيل — خطوتان قد تنقطع بينهما. هنا خطوة واحدة ذرّية،
-- على نمط watheq_payment_to_trust: عكس الأصل (صفّ عكس ظاهر في السجل) ثم
-- تسجيل المبلغ نفسه بتاريخه وطريقته ومرجعه تحت التصنيف الصحيح بسند جديد.
-- لا حذف ولا تعديل لصفوف قائمة — السجل يحكي ما حدث.
-- ============================================================
create or replace function public.watheq_reclassify_payment(p_payment uuid, p_to text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; t tenants%rowtype; office uuid; rev jsonb; rec jsonb; v_from text; nid uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if p_to not in ('rent', 'carried') then raise exception 'التصنيف غير صالح'; end if;
  select * into pay from payments where id = p_payment for update;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  select user_id into office from properties where id = pay.property_id;
  if not watheq_perm(office, 'undo_actions') or not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
  v_from := coalesce(pay.applies_to, 'rent');
  if pay.amount <= 0 or pay.reverses is not null or pay.tenant_id is null or pay.past_tenancy_id is not null
     or pay.association_id is not null or pay.owner_id is not null or v_from not in ('rent', 'carried') then
    raise exception 'تُنقل دفعات الإيجار والدين المرحَّل للوحدة الحالية فقط';
  end if;
  if v_from = p_to then raise exception 'الدفعة مصنّفة كذلك أصلًا'; end if;
  if exists (select 1 from payments where reverses = p_payment) then raise exception 'هذه الدفعة معكوسة أصلًا'; end if;

  rev := watheq_reverse_payment(p_payment);   -- يعيد العدّاد أو الدين ويضيف صفّ العكس (ويرفض دفعة مدة سابقة)
  select * into t from tenants where id = pay.tenant_id;

  if p_to = 'carried' then
    -- يرفض إن كان المبلغ أكبر من الدين المرحَّل — فيُلغى العكس معه (المعاملة كلها)
    rec := watheq_record_carried_payment(pay.tenant_id, pay.amount, pay.paid_on, pay.method, pay.reference, null);
  else
    rec := watheq_record_payment(pay.tenant_id, pay.amount, pay.method, null, pay.paid_on, null, pay.reference);
  end if;
  nid := (rec->>'payment_id')::uuid;
  update payments set note = left(concat_ws(' — ',
           case when p_to = 'carried' then 'سداد دين مرحَّل' end,
           'منقولة من ' || case when v_from = 'rent' then 'الأقساط' else 'الدين المرحَّل' end
             || coalesce(' (سند ' || pay.receipt_no || ')', ''),
           nullif(pay.note, '')), 1000)
   where id = nid;
  return jsonb_build_object('reversal', rev, 'new_payment', rec, 'payment_id', nid, 'from', v_from, 'to', p_to);
end $$;

revoke all on function public.watheq_reclassify_payment(uuid, text) from public, anon;
grant execute on function public.watheq_reclassify_payment(uuid, text) to authenticated;
