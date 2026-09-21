-- ============================================================
-- وثيق — schema-v43: أثرٌ لكل تصحيح عدّاد
--
-- بعد v42 صار التراجع عن رصيد افتتاحي يصحّح العدّاد وحده بلا صفّ دفعة —
-- وهذا صحيح نقديًّا، لكنه صامت: لا يُعرف من صحّح ولا متى ولا بكم. وفي
-- نظام محاسبي، تعديل بلا أثر أسوأ من السطر الوهمي الذي حلّ محلّه.
--
-- وتنفيذ v42 نفسه كشف الحاجة: حذف عشرة عكوس وهمية (174,050 ريال في ستة
-- عقارات) ولم يحفظ أيّ الوحدات كانت — فالقائمة لا تُستعاد الآن.
--
-- الحلّ: جدول لتعديلات لا نقد فيها، تكتبه الدوال وحدها، ويقرؤه «سجل
-- الحركات المالية» جنبًا إلى جنب مع الدفعات والمصروفات. وأي إصلاح
-- بيانات قادم يكتب ما سيحذفه هنا قبل أن يحذفه.
-- ============================================================

begin;

create table if not exists public.ledger_adjustments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,                 -- المكتب
  tenant_id   uuid,
  property_id uuid,
  kind        text not null check (kind in ('counter', 'repair')),
  delta       int,                           -- تغيّر العدّاد (−1 عند التراجع)
  amount      numeric(12,2),                 -- للإصلاح: المبلغ المحذوف · للعدّاد: قيمة الدفعة المرجعية
  note        text not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists ledger_adj_office_idx on public.ledger_adjustments (user_id, created_at desc);

alter table public.ledger_adjustments enable row level security;
drop policy if exists ledger_adj_read on public.ledger_adjustments;
create policy ledger_adj_read on public.ledger_adjustments for select
  to authenticated using (watheq_can_read(user_id));
/* لا سياسة كتابة: يكتبه التراجع ودوال الإصلاح وحدها (security definer) */
grant select on public.ledger_adjustments to authenticated;


-- التراجع: الفرع الافتتاحي يكتب أثرًا بدل الصمت
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
    back    := 0;
    periods := 1;
    newpaid := greatest(0, coalesce(t.paid_periods, 0) - 1);
    update tenants set paid_periods = newpaid where id = p_tenant;
    pid := null;
    /* أثر التصحيح: من، ومتى، وعلى أي وحدة — بلا نقد في الدفتر */
    insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
    values (office, p_tenant, t.property_id, 'counter', -1, t.rent_amount,
            'تصحيح عدّاد: دفعة سُدّدت قبل وثيق (رصيد افتتاحي) — بلا أثر نقدي', actor);
  end if;

  return jsonb_build_object('paid_periods', newpaid, 'reversed', back,
                            'paid_on', last_pay.paid_on, 'payment_id', pid,
                            'opening_balance', last_pay.id is null);
end $$;

revoke all on function watheq_undo_payment(uuid, uuid) from public, anon;
grant execute on function watheq_undo_payment(uuid, uuid) to authenticated;

commit;

-- فحص
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='ledger_adjustments') as الجدول,
  (select count(*) from pg_policies where tablename='ledger_adjustments') as السياسات;
