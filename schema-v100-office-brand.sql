-- ============================================================
-- v100 — هوية المكتب في ترويسة اللوحة (24 نوفمبر 2026)
-- طلب «الأولى»: شعار المكتب واسمه أعلى اللوحة بدل «وثيق».
--   brand_logo   : صورة صغيرة (data URL — png/jpeg/webp فقط، لا svg) ≤ 120 ألف حرف
--   brand_header : اختياري، يفعّله صاحب المكتب من الإعدادات (الافتراضي كما هو)
-- الموظف يرى هوية مكتبه عبر watheq_my_entitlements (لا يقرأ صف المالك مباشرة).
-- إضافة أعمدة فقط — لا حذف ولا تعديل بيانات.
-- ============================================================
alter table public.profiles add column if not exists brand_logo text;
alter table public.profiles add column if not exists brand_header boolean not null default false;

do $$ begin
  alter table public.profiles add constraint profiles_brand_logo_chk check (
    brand_logo is null or (length(brand_logo) <= 120000
      and brand_logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'));
exception when duplicate_object then null; end $$;

grant insert (brand_logo, brand_header), update (brand_logo, brand_header) on public.profiles to authenticated;

CREATE OR REPLACE FUNCTION public.watheq_my_entitlements()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_office uuid; r profiles%rowtype; ps record; hs record;
begin
  select coalesce((select tm.owner_id from team_members tm where tm.member_id = auth.uid() limit 1), auth.uid())
    into v_office;
  if v_office is null then return null; end if;
  select * into r from profiles where id = v_office;
  select * into ps from watheq_product_state(v_office, 'property');
  select * into hs from watheq_product_state(v_office, 'hoa');
  return jsonb_build_object(
    'office_id', v_office, 'account_type', r.account_type,
    'plan', r.plan, 'hoa_plan', r.hoa_plan,
    'trial_ends_at', r.trial_ends_at, 'subscribed_until', r.subscribed_until,
    'property', jsonb_build_object('state', ps.state, 'plan', ps.plan),
    'hoa', jsonb_build_object('state', hs.state, 'plan', hs.plan),
    -- هوية المكتب على المستندات: الموظف يصدر مستندات مكتبه لا ملفه الشخصي
    'issuer', jsonb_build_object('org_name', r.org_name, 'full_name', r.full_name,
      'billing_name', r.billing_name, 'vat_number', r.vat_number, 'cr_number', r.cr_number,
      'billing_phone', r.billing_phone,
      -- (v100) هوية المكتب في ترويسة اللوحة
      'brand_logo', r.brand_logo, 'brand_header', r.brand_header),
    'windows', jsonb_build_object('due_soon_days', r.due_soon_days,
      'due_imminent_days', r.due_imminent_days, 'expiring_days', r.expiring_days));
end $function$;

revoke all on function public.watheq_my_entitlements() from public, anon;
grant execute on function public.watheq_my_entitlements() to authenticated;
