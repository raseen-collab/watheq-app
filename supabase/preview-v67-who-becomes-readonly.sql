-- قراءة فقط — شغّله قبل schema-v67: من سيصير حسابه «قراءة فقط» فور التطبيق؟
-- (القاعدة نفسها: باقة مدفوعة سارية أو ضمن 5 أيام سماح، أو تجربة سارية — وإلا منتهٍ)
with s as (
  select p.id, coalesce(p.org_name, p.full_name) as الحساب, p.account_type, p.plan,
         p.trial_ends_at, p.subscribed_until,
         case
           when lower(coalesce(p.plan,'')) in ('basic','pro','full') and (p.subscribed_until is null or p.subscribed_until >= now()) then 'مدفوع'
           when lower(coalesce(p.plan,'')) in ('basic','pro','full') and p.subscribed_until > now() - interval '5 days' then 'سماح'
           when p.trial_ends_at >= now() then 'تجربة'
           else 'منتهٍ ← قراءة فقط'
         end as الحالة_بعد_التطبيق,
         -- جهة الجمعيات: في الحساب المزدوج تُملأ hoa_plan من plan عند التطبيق (فلا تتغير)
         case when p.account_type in ('both', 'hoa_manager') then
           case
             when lower(coalesce(p.plan,'')) in ('basic','pro','full') and (p.subscribed_until is null or p.subscribed_until >= now()) then 'مدفوع'
             when lower(coalesce(p.plan,'')) in ('basic','pro','full') and p.subscribed_until > now() - interval '5 days' then 'سماح'
             when p.trial_ends_at >= now() then 'تجربة'
             else 'منتهٍ ← قراءة فقط'
           end end as حالة_الجمعيات
    from profiles p
   where p.account_type is not null
)
select الحساب, account_type, plan, trial_ends_at::date as نهاية_التجربة, subscribed_until::date as نهاية_الاشتراك,
       الحالة_بعد_التطبيق, حالة_الجمعيات,
       (select count(*) from properties pr where pr.user_id = s.id and not coalesce(pr.is_demo, false)) as عقارات,
       (select count(*) from associations a where a.user_id = s.id) as جمعيات
  from s
 order by (الحالة_بعد_التطبيق = 'منتهٍ ← قراءة فقط') desc, الحساب;
