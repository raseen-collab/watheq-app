-- ============================================================
-- وثيق — schema-v49: التجديد يُعلَن ولا يُخمَّن
--
-- ⚠️ الترتيب: ارفع ملفات الواجهة أولًا وانتظر Ready في Vercel، ثم شغّل هذا.
--    (الواجهة الجديدة تُعلن التجديد؛ القاعدة بعد هذا لا تبدأ مدة إلا بالإعلان.
--     لو شُغّل قبل الواجهة، فتجديدٌ من الواجهة القديمة لا يبدأ مدة جديدة.)
--
-- العطل (مكتب عمرو باعبدالله، 24 سبتمبر): كانت القاعدة تخمّن التجديد من
-- أي حفظ ينقل البداية ≥ 25 يومًا للأمام مع تصفير المسدَّد — فتبدأ «مدة جديدة»
-- وتنقل الدفعات المسجّلة إلى «العقد السابق». كُتبت لمن يجدّد بالتعديل، وافترضت
-- أن تصحيح التاريخ أيامٌ معدودة. المكتب صحّح بأشهر، فاختفت دفعة وهيب (6,000)
-- من عقده، و«تجديد» التعديل لا يسأل عن متأخرات المدة المنتهية فتُمحى.
--
-- الآن: renewContract (زرّ «تجديد العقد» وتجديد البوت) يُرسل term_started_at
-- علامةً، والقاعدة تضع الوقت بنفسها (لا يؤرّخ متصفح مدةً بالماضي ليخفي دفعات).
-- وتعديل البيانات تصحيحٌ دائمًا. وإعادة التأجير كما هي (شاغرة ← مؤجّرة).
-- الإرجاع إلى '-infinity' مسموح — لإصلاح ما فعله التخمين.
--
-- يتطلب v44. لا يغيّر بيانات. آمن للتكرار.
-- ============================================================

begin;

create or replace function tenants_term_boundary()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.term_started_at := coalesce(new.term_started_at, '-infinity'::timestamptz);
  elsif old.status = 'vacated' and new.status is distinct from 'vacated' then
    new.term_started_at := now();                                   -- إعادة تأجير
  elsif new.term_started_at is distinct from old.term_started_at then
    if new.term_started_at is null or new.term_started_at = '-infinity'::timestamptz then
      new.term_started_at := '-infinity'::timestamptz;               -- إرجاع: كل الدفعات لهذا العقد
    else
      new.term_started_at := now();                                  -- تجديد مُعلَن — الوقت من الخادم
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tenants_term_boundary_trg on tenants;
create trigger tenants_term_boundary_trg
  before insert or update of status, contract_start, paid_periods, partial_amount, term_started_at on tenants
  for each row execute function tenants_term_boundary();

-- ملاحظة العدّاد: «تجديد» حين يُعلَن فقط — وتصحيح التعديل يُسمّى باسمه
create or replace function tenants_counter_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare office uuid; note text;
begin
  if current_setting('watheq.in_fn', true) = '1' then return new; end if;
  if tg_op = 'UPDATE'
     and new.paid_periods is not distinct from old.paid_periods
     and new.partial_amount is not distinct from old.partial_amount then return new; end if;
  if tg_op = 'INSERT' and coalesce(new.paid_periods, 0) = 0 and coalesce(new.partial_amount, 0) = 0 then return new; end if;

  select user_id into office from properties where id = new.property_id;
  note := case
    when tg_op = 'INSERT' then 'رصيد افتتاحي عند الإضافة: ' || coalesce(new.paid_periods, 0) || ' دفعات'
                              || case when coalesce(new.partial_amount, 0) > 0 then ' + جزئي ' || new.partial_amount else '' end
    when old.status = 'vacated' and new.status = 'active' then 'إعادة تأجير: تصفير العدّاد (كان ' || coalesce(old.paid_periods, 0) || ')'
    when new.term_started_at is distinct from old.term_started_at and new.term_started_at <> '-infinity'::timestamptz
         then 'تجديد العقد: بدأت مدة جديدة (كان المسدَّد ' || coalesce(old.paid_periods, 0) || ')'
    else 'تعديل يدوي للعدّاد: من ' || coalesce(old.paid_periods, 0) || ' إلى ' || coalesce(new.paid_periods, 0)
         || case when new.partial_amount is distinct from old.partial_amount
                 then ' · الجزئي من ' || coalesce(old.partial_amount, 0) || ' إلى ' || coalesce(new.partial_amount, 0) else '' end
  end;
  insert into ledger_adjustments (user_id, tenant_id, property_id, kind, delta, amount, note, created_by)
  values (office, new.id, new.property_id, 'counter',
          coalesce(new.paid_periods, 0) - case when tg_op = 'INSERT' then 0 else coalesce(old.paid_periods, 0) end,
          new.rent_amount, note, auth.uid());
  return new;
end $$;

commit;

-- ── التحقق ─────────────────────────────────────────────────
-- ١) الواجهة تستطيع إعلان التجديد (وإلا يفشل كل تجديد)
select 'الواجهة تكتب علامة التجديد' as الفحص,
       case when has_column_privilege('authenticated', 'public.tenants', 'term_started_at', 'UPDATE') then 'نعم ✅' else 'لا ❌ — أرسل هذا فورًا' end as النتيجة;

-- ٢) وحدات «جدّدها» التخمين في اليوم الذي سُجّلت فيه دفعة قبله — دفعات قد تكون اختفت من عقدها
select pr.name as العقار, t.unit as الوحدة, t.name as المستأجر, t.contract_start as البداية,
       t.term_started_at::date as بدأت_المدة, sum(p.amount) as دفعات_قبلها_بيوم
from tenants t
join properties pr on pr.id = t.property_id
join payments p on p.tenant_id = t.id and p.created_at <  t.term_started_at
                                       and p.created_at >= t.term_started_at - interval '1 day'
                                       and coalesce(p.applies_to, 'rent') = 'rent'
where t.term_started_at > '-infinity'::timestamptz and coalesce(pr.is_demo, false) = false
group by 1, 2, 3, 4, 5 having sum(p.amount) > 0
order by 5 desc;
