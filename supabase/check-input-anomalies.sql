-- ═══════════════════════════════════════════════════════════════════
-- وثيق — فحص أخطاء الإدخال في إدارة الأملاك (قراءة فقط · كل المكاتب)
-- 30 سبتمبر 2026 — بعد حادثة مكتب «التميز» (معتصم): أول استحقاق هجري
-- بشهر وسنة خاطئين، ودفعة 8,299 بدل 1,700 على عقد 10,000، وتجديد مبكر.
--
-- استعلام SELECT واحد (لا يكتب شيئًا) يُرجع كل الحالات في جدول واحد:
--   ١) first_due_far       أول استحقاق بعد بداية العقد بأكثر من فترة سداد واحدة
--   ٢) overpaid_term       المدفوع على المدة الحالية أكبر من قيمة العقد
--   ٣) term_near_start     بداية مدة (term_started_at) خلال 60 يومًا من بداية العقد، أو تجديد سبق
--                          نهاية المدة السابقة بأكثر من 30 يومًا («تجديد مبكر»)
--   ٤) near_duplicate_pay  دفعتان للمستأجر نفسه خلال 3 أيام بفرق مبلغ ≤ 1٪
-- الأعمدة: المكتب، العقار، المستأجر، الوحدة، والأرقام المعنية. لا هوية ولا جوال.
--
-- ملاحظات على الدقة:
--   • «فترة واحدة» بالأشهر الميلادية (+ يومان سماح). في العقد الهجري الفترة
--     أقصر ببضعة أيام، فالحدّ هنا متساهل قليلًا (لا يُبلّغ عن حالة سليمة).
--   • قيمة العقد = الإيجار × عدد الفترات (الافتراضي سنة بدورة الدفع كما في التطبيق).
--     الضريبة: إن كانت «مضافة فوق الإيجار» والوحدة خاضعة لها (نفس قاعدة
--     unitVatApplies) تُقارن الدفعات بالقيمة شاملةً الضريبة — الحدّ الأعلى،
--     فلا يُبلَّغ عن مستأجر دفع الضريبة فوق الإيجار. عمود contract_value يعرض القيمة
--     قبل الضريبة، وvalue_with_vat بعدها.
--   • ٣ يشمل التجديدات العادية أيضًا (بعد التجديد تصير بداية العقد نهاية المدة
--     السابقة، فيقع وقت التجديد قربها). العمود days_term_before_start موجب = جُدّد
--     قبل نهاية المدة السابقة بهذا العدد من الأيام: أكبر من 30 = «تجديد مبكر».
--
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════
with t as (
  select te.id, te.property_id, te.name, te.unit, te.rent_amount, te.payment_frequency, te.calendar,
         te.contract_start, te.first_due, te.contract_periods, te.paid_periods, te.partial_amount,
         te.term_started_at, te.billing_anchor_day, te.status, te.vat_mode, te.unit_type,
         pr.name as property, pr.user_id as office_id, pr.vat_enabled, pr.vat_rate, pr.vat_inclusive, pr.property_type,
         coalesce(nullif(te.contract_periods, 0),
           case te.payment_frequency when 'daily' then 365 when 'weekly' then 52 when 'quarterly' then 4 when 'trimester' then 3
                when 'semiannual' then 2 when 'annual' then 1 else 12 end) as periods,
         case te.payment_frequency when 'daily' then interval '1 day' when 'weekly' then interval '7 days'
              when 'quarterly' then interval '3 months' when 'trimester' then interval '4 months'
              when 'semiannual' then interval '6 months' when 'annual' then interval '12 months' else interval '1 month' end as one_period,
         -- نفس قاعدة unitVatApplies: تجاوز الوحدة ← نوع الوحدة ← نوع العقار؛ و«مضافة» = vat_inclusive = false
         (coalesce(pr.vat_enabled, false) and coalesce(pr.vat_inclusive, true) = false and (
            te.vat_mode = 'on'
            or (coalesce(te.vat_mode, 'auto') not in ('on', 'off') and (
                 (te.unit_type is not null and lower(te.unit_type) in ('shop', 'office', 'warehouse', 'land'))
                 or (te.unit_type is null and lower(coalesce(pr.property_type, '')) in ('commercial', 'office', 'warehouse', 'shop', 'showroom')))))) as vat_added
    from tenants te join properties pr on pr.id = te.property_id
   where coalesce(te.status, 'active') <> 'vacated'
),
tv as (
  select t.*, round(coalesce(t.rent_amount, 0) * t.periods, 2) as contract_value,
         round(coalesce(t.rent_amount, 0) * t.periods * case when t.vat_added then 1 + coalesce(nullif(t.vat_rate, 0), 15) / 100.0 else 1 end, 2) as value_with_vat,
         round(coalesce(t.paid_periods, 0) * coalesce(t.rent_amount, 0) + coalesce(t.partial_amount, 0), 2) as paid_by_counter,
         (select round(coalesce(sum(p.amount), 0), 2) from payments p
           where p.tenant_id = t.id and coalesce(p.applies_to, 'rent') = 'rent'
             and (t.term_started_at is null or not isfinite(t.term_started_at) or p.created_at >= t.term_started_at)) as paid_by_ledger
    from t
),
findings as (
  -- ١) أول استحقاق بعيد
  select 'first_due_far' as check_name, office_id, property, name as tenant, unit,
         contract_start::text as contract_start, first_due::text as first_due,
         (first_due::date - contract_start::date) as days_value,
         null::numeric as amount_1, null::numeric as amount_2, null::numeric as amount_3,
         payment_frequency || ' · ' || coalesce(calendar, 'gregorian') ||
           ' · أول استحقاق بعد البداية بـ' || (first_due::date - contract_start::date) || ' يومًا (الحد: فترة واحدة)' as details
    from tv
   where first_due is not null and contract_start is not null
     and first_due::date > (contract_start::date + one_period + interval '2 days')::date
  union all
  -- ٢) المدفوع أكثر من قيمة العقد (العدّاد أو سجل الدفعات)
  select 'overpaid_term', office_id, property, name, unit, contract_start::text, first_due::text,
         null, contract_value, greatest(paid_by_counter, paid_by_ledger), value_with_vat,
         'قيمة المدة ' || contract_value || case when vat_added then ' (شاملة الضريبة ' || value_with_vat || ')' else '' end ||
           ' · بالعدّاد ' || paid_by_counter || ' · بسجل الدفعات ' || paid_by_ledger ||
           ' · زيادة ' || round(greatest(paid_by_counter - contract_value, paid_by_ledger - value_with_vat), 2)
    from tv
   where coalesce(rent_amount, 0) > 0
     and (paid_by_counter > contract_value + greatest(1, contract_value * 0.001)
          or paid_by_ledger > value_with_vat + greatest(1, value_with_vat * 0.001))
  union all
  -- ٣) بداية مدة قريبة من بداية العقد
  select 'term_near_start', office_id, property, name, unit, contract_start::text, first_due::text,
         (contract_start::date - (term_started_at at time zone 'Asia/Riyadh')::date),
         null, null, null,
         'term_started_at ' || to_char(term_started_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') ||
           ' · days_term_before_start = ' || (contract_start::date - (term_started_at at time zone 'Asia/Riyadh')::date) ||
           case when (contract_start::date - (term_started_at at time zone 'Asia/Riyadh')::date) > 30 then ' · تجديد مبكر' else '' end ||
           ' · paid_periods ' || coalesce(paid_periods, 0)
    from tv
   where term_started_at is not null and isfinite(term_started_at) and contract_start is not null
     and (abs(contract_start::date - (term_started_at at time zone 'Asia/Riyadh')::date) <= 60
          -- وكل تجديد سبق نهاية المدة السابقة بأكثر من 30 يومًا (قاعدة «تجديد مبكر» في فحص البيانات)
          or (contract_start::date - (term_started_at at time zone 'Asia/Riyadh')::date) > 30)
  union all
  -- ٤) دفعتان متقاربتان متشابهتان
  select 'near_duplicate_pay', tv.office_id, tv.property, tv.name, tv.unit, p1.paid_on::text, p2.paid_on::text,
         abs(p2.paid_on - p1.paid_on), p1.amount, p2.amount, round(abs(p1.amount - p2.amount), 2),
         'دفعة ' || p1.amount || ' بتاريخ ' || p1.paid_on || ' و' || p2.amount || ' بتاريخ ' || p2.paid_on ||
           ' · ' || coalesce(p1.applies_to, 'rent') || '/' || coalesce(p2.applies_to, 'rent')
    from tv
    join payments p1 on p1.tenant_id = tv.id
    join payments p2 on p2.tenant_id = tv.id and p2.id > p1.id
   where p1.amount > 0 and p2.amount > 0 and p1.reverses is null and p2.reverses is null
     and not exists (select 1 from payments r where r.reverses in (p1.id, p2.id))
     and abs(p2.paid_on - p1.paid_on) <= 3
     and abs(p1.amount - p2.amount) <= 0.01 * greatest(p1.amount, p2.amount)
)
select f.check_name as "الفحص", pf.org_name as "المكتب", f.property as "العقار", f.tenant as "المستأجر", f.unit as "الوحدة",
       f.contract_start as "بداية_العقد_أو_الدفعة1", f.first_due as "أول_استحقاق_أو_الدفعة2", f.days_value as "أيام",
       f.amount_1 as "مبلغ_1", f.amount_2 as "مبلغ_2", f.amount_3 as "مبلغ_3", f.details as "التفاصيل"
  from findings f left join profiles pf on pf.id = f.office_id
 order by f.check_name, pf.org_name nulls last, f.property, f.unit;
