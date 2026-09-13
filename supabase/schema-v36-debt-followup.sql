-- ============================================================
-- وثيق — schema-v36: متابعة الديون المرحَّلة
--
-- محاكاة سبع سنوات أظهرت تراكم 13.6 مليون ريال ديونًا مرحَّلة عند مكتب
-- واحد. الرقم صحيح حسابيًّا، لكنه رقم أعمى: لا يُعرف متى نشأ الدين، ولا
-- آخر متابعة له، ولا هل سُوّي أو شُطب أو أُحيل للتنفيذ.
--
-- الدين بلا متابعة يتحوّل بعد سنوات إلى رقم لا يجرؤ أحد على لمسه: لا
-- يُطالَب به ولا يُشطب، ويُفسد كل تقرير يظهر فيه.
--
-- ثلاثة حقول تكفي:
--   debt_since   متى نشأ — يحدد التقادم وأولوية المتابعة
--   debt_status  open / promised / settled / written_off / legal
--   debt_note    آخر ما جرى (وعد بالسداد، رقم قضية، سبب الشطب)
-- ============================================================

alter table tenants add column if not exists debt_since  date;
alter table tenants add column if not exists debt_status text default 'open'
  check (debt_status in ('open', 'promised', 'settled', 'written_off', 'legal'));
alter table tenants add column if not exists debt_note   text;
alter table tenants add column if not exists debt_updated_at timestamptz;

comment on column tenants.debt_since  is 'تاريخ نشوء الدين المرحَّل — للتقادم وترتيب المتابعة';
comment on column tenants.debt_status is 'open: مفتوح · promised: وعد بالسداد · settled: سُوّي · written_off: شُطب · legal: أُحيل للتنفيذ';

create index if not exists tenants_debt_idx on tenants (property_id, debt_status)
  where carried_debt > 0;

/* الدين الذي يُسجَّل أول مرة يأخذ تاريخ اليوم تلقائيًّا، ويُمسح تاريخه عند
   تصفيره — فلا يبقى تاريخ نشوء لدين لم يعد قائمًا. */
create or replace function watheq_touch_debt() returns trigger
language plpgsql as $$
begin
  if coalesce(new.carried_debt, 0) > 0 and coalesce(old.carried_debt, 0) = 0 then
    new.debt_since := coalesce(new.debt_since, current_date);
    new.debt_status := coalesce(nullif(new.debt_status, ''), 'open');
  elsif coalesce(new.carried_debt, 0) = 0 and coalesce(old.carried_debt, 0) > 0 then
    new.debt_since := null; new.debt_note := null; new.debt_status := 'open';
  end if;
  if coalesce(new.carried_debt, 0) <> coalesce(old.carried_debt, 0)
     or coalesce(new.debt_status, '') <> coalesce(old.debt_status, '') then
    new.debt_updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_touch_debt on tenants;
create trigger trg_touch_debt before update on tenants
  for each row execute function watheq_touch_debt();
