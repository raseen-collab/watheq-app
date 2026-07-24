-- ============================================================
-- وثيق — ترقية المخطط (الإصدار 3)
-- تنبيهات تليجرام للمالك + كشوف الحساب والفواتير
-- شغّله في: Supabase → SQL Editor → New query → Run
-- آمن تمامًا: إضافي بالكامل، لا يمسّ أي بيانات قائمة
-- ============================================================

-- ==================== 1) قناة تنبيهات المالك (تليجرام) ====================
alter table public.profiles add column if not exists telegram_chat_id text;
alter table public.profiles add column if not exists notify_enabled boolean default true;
-- عدد الأيام قبل الاستحقاق التي يُرسل عندها التنبيه
alter table public.profiles add column if not exists notify_days_before integer default 5;
alter table public.profiles add column if not exists last_digest_at timestamptz;

-- ==================== 2) بيانات الفوترة ====================
-- تظهر في كشف الحساب والفواتير
alter table public.profiles add column if not exists billing_name text;      -- الاسم/المنشأة
alter table public.profiles add column if not exists vat_number text;        -- الرقم الضريبي (اختياري)
alter table public.profiles add column if not exists cr_number text;         -- السجل التجاري (اختياري)
alter table public.profiles add column if not exists billing_phone text;

-- ==================== 3) سجل الفواتير الصادرة ====================
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  invoice_no text not null,
  issue_date date default current_date,
  due_date date,
  period_label text,           -- مثال: الدفعة ٣ من ١٢
  amount numeric(12,2) default 0,
  status text default 'issued' check (status in ('issued','paid','void')),
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_inv_user on public.invoices(user_id);
create index if not exists idx_inv_tenant on public.invoices(tenant_id);

alter table public.invoices enable row level security;
drop policy if exists invoices_owner on public.invoices;
create policy invoices_owner on public.invoices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ==================== 4) عدّاد أرقام الفواتير لكل مستخدم ====================
alter table public.profiles add column if not exists invoice_counter integer default 0;

create or replace function public.next_invoice_no(p_user uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare n integer;
begin
  update public.profiles set invoice_counter = coalesce(invoice_counter,0) + 1
  where id = p_user returning invoice_counter into n;
  return 'INV-' || to_char(now(),'YYYY') || '-' || lpad(n::text, 4, '0');
end;
$$;
