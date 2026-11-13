-- ============================================================
-- وثيق — schema-v79: وحدات «ضمن عقد» وحدة أخرى (13 نوفمبر 2026)
--
-- مستأجر واحد بعقد واحد يشمل عدة شقق (مثلًا عقد يشمل ش3–ش10). المكتب يريد كل
-- شقة وحدةً مستقلة برقمها (لطلبات الصيانة والعدادات والسجل)، لكن المبلغ واحد
-- مكتوب على شقة «رئيسية». بلا هذا العمود كانت بقية الشقق تُرفض في الرفع
-- («قيمة الدفعة مفقودة») أو تظهر «إيجار صفر — بيانات ناقصة».
--
-- covered_by = الوحدة الرئيسية التي عليها مبلغ العقد ودفعاته.
-- الوحدة المشمولة: إيجارها 0، لا دفعات عليها، ولا تظهر متأخرة أبدًا.
--
-- آمن للتشغيل أكثر من مرة. شغّله في Supabase → SQL Editor → Run.
-- ============================================================

alter table public.tenants add column if not exists covered_by uuid
  references public.tenants(id) on delete set null;

create index if not exists tenants_covered_by_idx on public.tenants(covered_by) where covered_by is not null;

alter table public.tenants drop constraint if exists tenants_covered_not_self;
alter table public.tenants add constraint tenants_covered_not_self
  check (covered_by is null or covered_by <> id);

-- الوحدة الرئيسية من العقار نفسه، وليست هي نفسها مشمولة (لا سلاسل)
create or replace function public.tenants_covered_guard()
returns trigger language plpgsql set search_path = public as $$
declare lead record;
begin
  if new.covered_by is null then return new; end if;
  select id, property_id, covered_by into lead from public.tenants where id = new.covered_by;
  if not found then raise exception 'الوحدة الرئيسية غير موجودة'; end if;
  if lead.property_id <> new.property_id then raise exception 'الوحدة الرئيسية من عقار آخر'; end if;
  if lead.covered_by is not null then raise exception 'الوحدة الرئيسية نفسها ضمن عقد وحدة أخرى'; end if;
  -- المشمولة لا تحمل مبلغًا ولا دفعات: المال كله على الرئيسية
  new.rent_amount := 0; new.paid_periods := 0; new.partial_amount := 0; new.carried_debt := 0;
  return new;
end $$;

drop trigger if exists tenants_covered_guard on public.tenants;
create trigger tenants_covered_guard before insert or update of covered_by, rent_amount, paid_periods, partial_amount, carried_debt, property_id
  on public.tenants for each row execute function public.tenants_covered_guard();

-- وحدة صارت «رئيسية» لا تُجعل مشمولة وعليها مشمولات
create or replace function public.tenants_lead_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.covered_by is not null and exists (select 1 from public.tenants c where c.covered_by = new.id) then
    raise exception 'هذه الوحدة عليها وحدات مشمولة — لا تُجعل ضمن عقد غيرها';
  end if;
  return new;
end $$;

drop trigger if exists tenants_lead_guard on public.tenants;
create trigger tenants_lead_guard before update of covered_by on public.tenants
  for each row execute function public.tenants_lead_guard();

-- الوحدة المشمولة حين تُخلى تصير شاغرة عادية: يُفك ربطها، فإعادة تأجيرها
-- (watheq_relet_unit) تحفظ إيجار المستأجر الجديد ولا يُصفّره الحارس أعلاه.
-- (الاسم يبدأ بـ«clear» ليسبق «guard» أبجديًّا — ترتيب تشغيل المشغّلات في Postgres)
create or replace function public.tenants_covered_clear_on_vacate()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.covered_by is not null and coalesce(new.status, 'active') = 'vacated' then
    new.covered_by := null;
  end if;
  return new;
end $$;

drop trigger if exists tenants_covered_clear_on_vacate on public.tenants;
create trigger tenants_covered_clear_on_vacate before insert or update of status, covered_by on public.tenants
  for each row execute function public.tenants_covered_clear_on_vacate();

-- لا دفعة على وحدة مشمولة (حماية خلف الواجهة): الدفعة تُسجَّل على الرئيسية،
-- وإلا زاد «المحصَّل» بلا قسط يقابله لأن الحارس يُبقي دفعات المشمولة صفرًا.
create or replace function public.payments_not_on_covered()
returns trigger language plpgsql set search_path = public as $$
declare lead_unit text;
begin
  if new.tenant_id is null then return new; end if;
  select l.unit into lead_unit from public.tenants c join public.tenants l on l.id = c.covered_by
   where c.id = new.tenant_id;
  if found then
    raise exception 'هذه الوحدة ضمن عقد الوحدة % — سجّل الدفعة عليها', coalesce(lead_unit, 'الرئيسية');
  end if;
  return new;
end $$;

drop trigger if exists payments_not_on_covered on public.payments;
create trigger payments_not_on_covered before insert on public.payments
  for each row execute function public.payments_not_on_covered();
