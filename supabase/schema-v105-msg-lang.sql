-- ============================================================
-- وثيق — schema-v105 (24 نوفمبر 2026 — طلب مكتب الأولى) — لغة المراسلة للمستأجر
-- عربي (الافتراضي) · English · both (العربي ثم الإنجليزي في رسالة واحدة).
-- إضافة عمود فقط؛ كل الوحدات القائمة تبقى «عربي» كما كانت.
-- ============================================================
alter table public.tenants add column if not exists msg_lang text not null default 'ar';
alter table public.tenants drop constraint if exists tenants_msg_lang_chk;
alter table public.tenants add constraint tenants_msg_lang_chk check (msg_lang in ('ar', 'en', 'both'));

-- صفحة المستأجر (/r/t) تُعرض بلغته: نضيف msg_lang لحقول المستأجر المكشوفة — التعريف نفسه حرفيًّا + سطر واحد
CREATE OR REPLACE FUNCTION public.watheq_tenant_portal(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l tenant_portal_links%rowtype; t tenants%rowtype; tj jsonb; pj jsonb; oj jsonb; since timestamptz; st text;
begin
  l := watheq_tenant_link_resolve(p_token);
  if l.id is null then return null; end if;
  select * into t from tenants where id = l.tenant_id;
  tj := to_jsonb(t);
  select to_jsonb(p) into pj from properties p where p.id = l.property_id;
  select to_jsonb(r) into oj from profiles r where r.id = l.user_id;
  since := case when t.term_started_at is not null and isfinite(t.term_started_at) then t.term_started_at end;
  select s.state into st from watheq_product_state(l.user_id, 'property') s;

  update tenant_portal_links set last_seen_at = now() where id = l.id;

  return jsonb_build_object(
    -- حقول محدّدة فقط: لا هوية ولا جوال ولا ملاحظات داخلية ولا حالة التنفيذ
    'tenant', jsonb_build_object(
      'name', tj->'name', 'unit', tj->'unit', 'unit_type', tj->'unit_type', 'vat_mode', tj->'vat_mode',
      'rent_amount', tj->'rent_amount', 'contract_start', tj->'contract_start', 'contract_end', tj->'contract_end',
      'payment_frequency', tj->'payment_frequency', 'contract_periods', tj->'contract_periods',
      'paid_periods', tj->'paid_periods', 'partial_amount', tj->'partial_amount',
      'billing_anchor_day', tj->'billing_anchor_day', 'status', tj->'status', 'move_out_date', tj->'move_out_date',
      'calendar', tj->'calendar', 'first_due', tj->'first_due', 'carried_debt', tj->'carried_debt',
      'contract_no', tj->'contract_no', 'rooms', tj->'rooms', 'baths', tj->'baths', 'acs', tj->'acs',
      'elec_account', tj->'elec_account', 'water_account', tj->'water_account',
      'msg_lang', tj->'msg_lang'),
    'property', jsonb_build_object(
      'name', pj->'name', 'city', pj->'city', 'address', pj->'address', 'property_type', pj->'property_type',
      'usage', pj->'usage', 'vat_enabled', pj->'vat_enabled', 'vat_rate', pj->'vat_rate', 'vat_inclusive', pj->'vat_inclusive',
      'grace_days', pj->'grace_days', 'soon_days', pj->'soon_days', 'imminent_days', pj->'imminent_days',
      'expiring_days', pj->'expiring_days'),
    'office', jsonb_build_object(
      'org_name', oj->'org_name', 'billing_name', oj->'billing_name', 'billing_phone', oj->'billing_phone',
      'cr_number', oj->'cr_number', 'vat_number', oj->'vat_number',
      'due_soon_days', oj->'due_soon_days', 'due_imminent_days', oj->'due_imminent_days', 'expiring_days', oj->'expiring_days',
      'plan', oj->'plan', 'trial_ends_at', oj->'trial_ends_at', 'subscribed_until', oj->'subscribed_until'),
    'show_balance', l.show_balance,
    'active', coalesce(st, 'expired') <> 'expired',
    'today', watheq_today(),
    -- دفعات المدة الحالية (مثل كشف الحساب في اللوحة) — بلا ملاحظات تشغيلية
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'paid_on', p.paid_on, 'amount', p.amount, 'method', p.method,
               'reference', p.reference, 'periods_covered', p.periods_covered, 'reverses', p.reverses,
               'applies_to', p.applies_to, 'created_at', p.created_at)
             order by p.paid_on, p.created_at)
        from (select * from payments p0
               where p0.tenant_id = l.tenant_id and p0.user_id = l.user_id
                 and (since is null or p0.created_at >= since)
               order by p0.paid_on desc, p0.created_at desc limit 500) p), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'amount', c.amount, 'transfer_date', c.transfer_date,
               'bank_ref', c.bank_ref, 'status', c.status, 'reject_reason', c.reject_reason,
               'recorded_amount', c.recorded_amount, 'created_at', c.created_at) order by c.created_at desc)
        from (select * from tenant_payment_claims c0 where c0.tenant_id = l.tenant_id
                and watheq_norm_name(c0.tenant_name) = watheq_norm_name(l.tenant_name)
                order by c0.created_at desc limit 10) c), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'category', r.category, 'location', r.location,
               'description', r.description, 'status', r.status, 'manager_note', r.manager_note,
               'created_at', r.created_at, 'updated_at', r.updated_at, 'closed_at', r.closed_at,
               -- سجل المراحل بتواريخها وردّ المكتب في كل مرحلة (بلا هوية من غيّرها)
               'log', coalesce((select jsonb_agg(jsonb_build_object('to', a.detail->>'to', 'note', a.detail->>'note', 'at', a.created_at) order by a.id)
                                  from tenant_portal_audit a
                                 where a.action = 'request_status' and a.detail->>'request_id' = r.id::text
                                   and a.user_id = l.user_id), '[]'::jsonb)) order by r.created_at desc)
        from (select * from tenant_requests r0 where r0.tenant_id = l.tenant_id
                and watheq_norm_name(r0.tenant_name) = watheq_norm_name(l.tenant_name)
                order by r0.created_at desc limit 10) r), '[]'::jsonb)
  );
end $function$;
revoke all on function public.watheq_tenant_portal(text) from public, anon, authenticated;
