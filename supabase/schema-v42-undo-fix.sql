-- ============================================================
-- وثيق — schema-v42: التراجع عن الدفعة — عطلان وإصلاح البيانات
--
-- اكتُشف من حالة حقيقية (حسن خليل — عمارة رباح الحربى):
--   الوحدة أُضيفت برصيد افتتاحي «دفعات سُدّدت حتى اليوم = 1» بلا صفّ دفعة.
--   ضُغط «تراجع عن آخر دفعة» فلم تجد الدالة دفعة تعكسها — فرجعت لسلوك
--   احتياطي: أنقصت العدّاد **وكتبت −13,000 في دفتر الدفعات**.
--   ثم سُجّلت 12,500 جزئيًّا.
--   حالة الوحدة صحيحة (متبقٍ 500)، لكن الدفتر يقول إن المكتب ردّ 13,000
--   لم تُسجَّل أصلًا: صافي الوحدة −500، وتقرير المالك يُظهر محصَّلًا سالبًا.
--
-- العطل (١): التراجع عن رصيد افتتاحي يكتب نقدًا لم يمرّ بالدفتر.
--   الصواب: يصحّح العدّاد وحده. لا صفّ دفعة، ولا مساس بالمحصَّل.
--
-- العطل (٢): الدالة تختار «آخر دفعة موجبة» ولا تستبعد ما عُكس منها —
--   رغم أن تعليقها يقول «لم يُتراجع عنها بعد». فالتراجع مرتين يعكس
--   الدفعة نفسها مرتين: المجموع صحيح لكن الخصم الثاني يُنسب لشهر خاطئ.
--
-- يُشغَّل مرة واحدة. آمن للتكرار.
-- ============================================================

begin;

-- ── ١) الدالة المُصلَحة ─────────────────────────────────────
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

  /* آخر دفعة موجبة **لم يُعكس مثيلها بعد**: رتبتها بين مثيلاتها (نفس
     المبلغ والتاريخ) أكبر من عدد العكوس المسجَّلة لذلك المبلغ والتاريخ.
     قبل هذا كان التراجع الثاني يختار الدفعة المعكوسة نفسها. */
  select p.* into last_pay from payments p
   where p.tenant_id = p_tenant and p.amount > 0
     and (select count(*) from payments q
           where q.tenant_id = p_tenant and q.amount = p.amount and q.paid_on = p.paid_on
             and q.created_at <= p.created_at)
       > (select count(*) from payments r
           where r.tenant_id = p_tenant and r.amount = -p.amount and r.paid_on = p.paid_on)
   order by p.created_at desc limit 1;

  if found then
    back    := last_pay.amount;
    periods := greatest(1, coalesce(last_pay.periods_covered, 1));
    newpaid := greatest(0, coalesce(t.paid_periods, 0) - periods);
    update tenants set paid_periods = newpaid where id = p_tenant;
    update properties set collected = greatest(0, coalesce(collected, 0) - back) where id = t.property_id;
    insert into payments (user_id, tenant_id, property_id, paid_on, amount, method, periods_covered, note, created_by)
    values (office, p_tenant, t.property_id, last_pay.paid_on, -back, 'other', -periods,
            'تراجع عن دفعة بتاريخ ' || last_pay.paid_on::text, actor)
    returning id into pid;
  else
    /* رصيد افتتاحي: لا دفعة في الدفتر تُعكس — فلا نكتب نقدًا لم يمرّ به.
       نصحّح العدّاد وحده. (كان هنا −rent_amount يُكتب في الدفتر.) */
    back    := 0;
    periods := 1;
    newpaid := greatest(0, coalesce(t.paid_periods, 0) - 1);
    update tenants set paid_periods = newpaid where id = p_tenant;
    pid := null;
  end if;

  return jsonb_build_object('paid_periods', newpaid, 'reversed', back,
                            'paid_on', last_pay.paid_on, 'payment_id', pid,
                            'opening_balance', last_pay.id is null);
end $$;

revoke all on function watheq_undo_payment(uuid, uuid) from public, anon;
grant execute on function watheq_undo_payment(uuid, uuid) to authenticated;


-- ── ٢) إصلاح البيانات ───────────────────────────────────────
/* بصمة العكس الوهمي دقيقة: المسار الاحتياطي كتب الملاحظة «تراجع عن دفعة»
   بلا « بتاريخ …» (لأن الدفعة الأصلية لم توجد). المسار السليم يكتب
   التاريخ دائمًا. فالحذف محصور في هذه البصمة وحدها. */
create temp table _phantom on commit drop as
select id, property_id, amount
from payments
where amount < 0 and note = 'تراجع عن دفعة';

delete from payments where id in (select id from _phantom);

/* المحصَّل المخزَّن يُعاد حسابه من الدفتر للعقارات المتأثرة فقط */
update properties p
set collected = greatest(0, coalesce((select sum(x.amount) from payments x where x.property_id = p.id), 0))
where p.id in (select distinct property_id from _phantom);

-- ── ٣) التقرير ──────────────────────────────────────────────
select
  (select count(*) from _phantom)                         as عكوس_وهمية_حُذفت,
  (select coalesce(sum(-amount), 0) from _phantom)        as مجموعها,
  (select count(distinct property_id) from _phantom)      as عقارات_أُعيد_حساب_محصَّلها;

commit;

/* ── ٤) للمراجعة لا للتنفيذ: عكوس مكرَّرة من التراجع المزدوج ──
   لا تُصلَح تلقائيًّا — المجموع فيها صحيح، والخطأ في الشهر المنسوب.
   شغّل هذا وحده؛ إن أرجع صفوفًا أرسلها للمراجعة. */
-- select r.tenant_id, r.paid_on, -r.amount as المبلغ, count(*) as عدد_العكوس,
--   (select count(*) from payments p where p.tenant_id = r.tenant_id
--      and p.amount = -r.amount and p.paid_on = r.paid_on) as عدد_الأصول
-- from payments r where r.amount < 0 and r.note like 'تراجع عن دفعة بتاريخ%'
-- group by r.tenant_id, r.paid_on, r.amount
-- having count(*) > (select count(*) from payments p where p.tenant_id = r.tenant_id
--      and p.amount = -r.amount and p.paid_on = r.paid_on);
