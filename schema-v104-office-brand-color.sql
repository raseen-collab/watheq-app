-- ============================================================
-- v104 — لون المكتب وشعاره على كل مستند (25 نوفمبر 2026)
-- طلب «الأولى»: شعارهم ولونهم (كحلي) على السندات والفواتير وكل مستند.
-- عُمِّم لكل مكتب: brand_color اختياري (#RRGGBB)، بلا لون = لون وثيق.
-- الشعار (v100) صار يظهر في المستندات أيضًا، وبلا شعار يبقى أول حرف من اسم المكتب.
-- الروابط العامة (بوابة المستأجر وسنده) تعيد اللون والشعار لتطبعهما بالهوية نفسها.
-- إضافة عمود وحقول JSON فقط — لا حذف ولا تعديل بيانات.
-- ============================================================
alter table public.profiles add column if not exists brand_color text;
do $$ begin
  alter table public.profiles add constraint profiles_brand_color_chk
    check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');
exception when duplicate_object then null; end $$;
grant insert (brand_color), update (brand_color) on public.profiles to authenticated;

do $mig$
declare d text; o text;
begin
  -- 1) هوية المكتب للمالك والموظف (المستندات من اللوحة)
  select pg_get_functiondef('public.watheq_my_entitlements()'::regprocedure) into d; o := d;
  d := replace(d, $a$'brand_logo', r.brand_logo, 'brand_header', r.brand_header)$a$,
                  $b$'brand_logo', r.brand_logo, 'brand_header', r.brand_header, 'brand_color', r.brand_color)$b$);
  if d = o then raise exception 'v104: entitlements unchanged'; end if;
  execute d;

  -- 2) بوابة المستأجر (كشف الحساب من الرابط)
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'watheq_tenant_portal'; o := d;
  d := replace(d, $a$'org_name', oj->'org_name', 'billing_name', oj->'billing_name', 'billing_phone', oj->'billing_phone',$a$,
                  $b$'org_name', oj->'org_name', 'billing_name', oj->'billing_name', 'billing_phone', oj->'billing_phone',
      'brand_logo', oj->'brand_logo', 'brand_color', oj->'brand_color',$b$);
  if d = o then raise exception 'v104: tenant_portal unchanged'; end if;
  execute d;

  -- 3) سند القبض من رابط المستأجر
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'watheq_tenant_receipt'; o := d;
  d := replace(d, $a$'office', jsonb_build_object('org_name', oj->'org_name', 'billing_name', oj->'billing_name',$a$,
                  $b$'office', jsonb_build_object('org_name', oj->'org_name', 'billing_name', oj->'billing_name',
      'brand_logo', oj->'brand_logo', 'brand_color', oj->'brand_color',$b$);
  if d = o then raise exception 'v104: tenant_receipt unchanged'; end if;
  execute d;
end $mig$;
