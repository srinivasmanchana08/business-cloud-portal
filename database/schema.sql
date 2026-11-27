-- =====================================================
-- Manchana Srinivas portal - full database setup
-- Run in the Supabase SQL Editor. Safe to re-run.
-- =====================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  company_type text not null default 'Both' check (company_type in ('Customer','Supplier','Both')),
  credit_days integer not null default 0 check (credit_days >= 0),
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entry_date date not null,
  voucher_no text,
  vehicle_number text,
  particulars text,
  quantity numeric(14,3) not null default 0,
  rate numeric(14,2) not null default 0,
  purchase_total numeric(14,2) not null default 0,
  seller text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entry_date date not null,
  voucher_no text,
  vehicle_number text,
  quantity numeric(14,3) not null default 0,
  rate numeric(14,2) not null default 0,
  gross_total numeric(14,2) not null default 0,
  unload_date date,
  unload_quantity numeric(14,3) not null default 0,
  payment_due_date date,
  purchase_reference text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  payment_date date not null,
  direction text not null check (direction in ('received','paid')),
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  notes text,
  created_at timestamptz not null default now()
);

-- Vehicle rent: rent paid per purchase vehicle (deducted from the margin
-- on the Vehicle Tracking page).
create table if not exists public.vehicle_rents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entry_date date not null,            -- purchase / loading date
  vehicle_number text not null,
  paid_date date,                      -- empty = not paid yet
  amount numeric(14,2) check (amount is null or amount >= 0),
  account_name text,                   -- who the rent was paid to
  notes text,
  created_at timestamptz not null default now()
);

-- Purchase orders placed with suppliers (the API exposes this as /api/orders).
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_date date not null,
  po_number text,
  quantity numeric(14,3) not null default 0,
  rate numeric(14,2) not null default 0,
  order_total numeric(14,2) not null default 0,
  delivery_date date,
  status text,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- ownership column (the API sets owner_id from the signed-in user) ----------

alter table public.companies       add column if not exists owner_id uuid references auth.users(id) default auth.uid();
alter table public.purchases       add column if not exists owner_id uuid references auth.users(id) default auth.uid();
alter table public.sales           add column if not exists owner_id uuid references auth.users(id) default auth.uid();
alter table public.payments        add column if not exists owner_id uuid references auth.users(id) default auth.uid();
alter table public.vehicle_rents   add column if not exists owner_id uuid references auth.users(id) default auth.uid();
alter table public.purchase_orders add column if not exists owner_id uuid references auth.users(id) default auth.uid();

-- ---------- businesses: DDGS and Maize and Turmeric ----------
-- Existing rows become "DDGS". Companies stay shared by both businesses.

alter table public.purchases       add column if not exists business text not null default 'DDGS';
alter table public.sales           add column if not exists business text not null default 'DDGS';
alter table public.payments        add column if not exists business text not null default 'DDGS';
alter table public.vehicle_rents   add column if not exists business text not null default 'DDGS';
alter table public.purchase_orders add column if not exists business text not null default 'DDGS';

do $$
declare t text;
begin
  foreach t in array array['purchases','sales','payments','vehicle_rents','purchase_orders'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_business_check');
    execute format('alter table public.%I add constraint %I check (business in (''DDGS'', ''Maize and Turmeric''))', t, t || '_business_check');
    execute format('create index if not exists %I on public.%I(business)', t || '_business_idx', t);
  end loop;
end $$;

-- ---------- indexes ----------

create index if not exists purchases_company_idx       on public.purchases(company_id);
create index if not exists sales_company_idx           on public.sales(company_id);
create index if not exists payments_company_idx        on public.payments(company_id);
create index if not exists payments_date_idx           on public.payments(payment_date);
create index if not exists vehicle_rents_company_idx   on public.vehicle_rents(company_id);
create index if not exists vehicle_rents_vehicle_idx   on public.vehicle_rents(vehicle_number);
create index if not exists purchase_orders_company_idx on public.purchase_orders(company_id);

-- The API lists the newest 500 rows of each table.
create index if not exists companies_created_idx       on public.companies(created_at desc);
create index if not exists purchases_created_idx       on public.purchases(created_at desc);
create index if not exists sales_created_idx           on public.sales(created_at desc);
create index if not exists payments_created_idx        on public.payments(created_at desc);
create index if not exists vehicle_rents_created_idx   on public.vehicle_rents(created_at desc);
create index if not exists purchase_orders_created_idx on public.purchase_orders(created_at desc);

-- ---------- Row Level Security: each user only sees/changes their own rows ----------

do $$
declare t text;
begin
  foreach t in array array['companies','purchases','sales','payments','vehicle_rents','purchase_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- ---------- dashboard totals (used by GET /api/dashboard and /api/bootstrap) ----------
-- Runs as the caller (security invoker), so Row Level Security still applies.
-- p_business = null -> all businesses.

create or replace function public.dashboard_totals(p_business text default null)
returns table (purchases numeric, sales numeric, collected numeric, disbursed numeric)
language sql
stable
security invoker
as $$
  select
    coalesce((select sum(purchase_total) from public.purchases where p_business is null or business = p_business), 0),
    coalesce((select sum(gross_total)    from public.sales     where p_business is null or business = p_business), 0),
    coalesce((select sum(amount) from public.payments where direction = 'received' and (p_business is null or business = p_business)), 0),
    coalesce((select sum(amount) from public.payments where direction = 'paid'     and (p_business is null or business = p_business)), 0);
$$;

grant execute on function public.dashboard_totals(text) to authenticated;

-- ---------- if you already have rows without an owner, assign them (replace the UUID) ----------
-- update public.companies set owner_id = 'YOUR-USER-UUID' where owner_id is null;
-- (repeat for purchases, sales, payments, vehicle_rents, purchase_orders)
