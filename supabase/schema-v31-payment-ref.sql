-- ============================================================
-- وثيق — schema-v31: تاريخ السداد الفعلي ومرجع الحوالة
--
-- المكتب يراجع كشف حسابه البنكي ويطابقه بما سجّله. وحتى الآن كل دفعة
-- تُسجَّل بتاريخ إدخالها لا بتاريخ وصول المال: المستأجر يحوّل الخميس
-- والمكتب يسجّل الأحد، فيبحث عن حوالة الأحد في البنك ولا يجدها.
--
-- التاريخان مختلفان ولا يغني أحدهما عن الآخر:
--   paid_on    = يوم وصول المال (يُطابَق بالبنك)  ← يحدّده المستخدم
--   created_at = لحظة التسجيل في وثيق (للتدقيق) ← يضعه النظام
--
-- ونضيف مرجع الحوالة: آخر أرقام العملية أو رقم الإيصال — بدونه لا تُطابَق
-- حوالتان بنفس المبلغ في اليوم نفسه.
-- ============================================================

alter table payments add column if not exists reference text;
comment on column payments.reference is 'مرجع الحوالة أو رقم الإيصال — لمطابقة كشف البنك';

create index if not exists payments_ref_idx on payments (user_id, reference) where reference is not null;

-- الدالة الذرّية تقبل المرجع (معامل اختياري — لا يكسر أي استدعاء قائم)
create or replace function watheq_record_payment(
  p_tenant uuid, p_amount numeric, p_method text default 'transfer',
  p_note text default null, p_paid_on date default null, p_actor uuid default null,
  p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tenants%rowtype; office uuid; actor uuid; rent numeric; pool numeric;
        completed int; newpaid int; newpartial numeric; pid uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  select user_id into office from properties where id = t.property_id for update;

  if auth.uid() is not null then
    if not watheq_perm(office, 'record_payments') then raise exception 'not authorized'; end if;
    actor := auth.uid();
  else
    if p_actor is null or p_actor <> office then raise exception 'not authorized'; end if;
    actor := p_actor;
  end if;

  -- لا تاريخ سداد في المستقبل: خطأ إدخال شائع يفسد مطابقة البنك
  if p_paid_on is not null and p_paid_on > (current_date + 1) then
    raise exception 'تاريخ السداد في المستقبل';
  end if;

  rent := coalesce(t.rent_amount, 0);
  if rent <= 0 then raise exception 'قيمة الدفعة غير محدّدة لهذا العقد'; end if;
  pool       := greatest(0, coalesce(t.partial_amount, 0)) + p_amount;
  completed  := floor(pool / rent);
  newpartial := round(pool - completed * rent, 2);
  newpaid    := greatest(0, coalesce(t.paid_periods, 0)) + completed;

  update tenants set paid_periods = newpaid, partial_amount = newpartial where id = p_tenant;
  update properties set collected = coalesce(collected, 0) + p_amount where id = t.property_id;
  insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by, reference)
  values (office, p_tenant, t.property_id, coalesce(p_paid_on, current_date), p_amount,
          coalesce(nullif(p_method, ''), 'transfer'), completed, p_note, actor, nullif(btrim(p_reference), ''))
  returning id into pid;
  return jsonb_build_object('paid_periods', newpaid, 'partial_amount', newpartial,
                            'completed', completed, 'payment_id', pid);
end $$;

-- ============================================================
-- تعديل الدفعة: التاريخ والمرجع فقط
--
-- سياسة التحديث الحالية تسمح للمحصّل بتعديل أي عمود — بما فيه المبلغ.
-- وتغيير المبلغ بعد التسجيل يفسد الحساب: عدّاد الدفعات المسدَّدة يبقى كما
-- هو بينما يتغيّر المال، فيختلّ صافي المالك ومطابقة البنك.
--
-- المطلوب عمليًّا شيء واحد: تصحيح تاريخ وصول الحوالة أو إضافة مرجعها بعد
-- مراجعة كشف البنك. فنقصر التعديل عليهما بصلاحيات الأعمدة — لا بالسياسة،
-- لأن السياسة تسمح بالصف كله ولا تفرّق بين أعمدته.
-- ============================================================
revoke update on payments from authenticated;
grant  update (paid_on, reference, note) on payments to authenticated;
