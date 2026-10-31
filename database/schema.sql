create extension if not exists pgcrypto;

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

create index if not exists purchases_company_idx on public.purchases(company_id);
create index if not exists sales_company_idx on public.sales(company_id);
create index if not exists payments_company_idx on public.payments(company_id);
create index if not exists payments_date_idx on public.payments(payment_date);

-- Ownership column: the API sets owner_id from the signed-in user.
alter table public.companies add column if not exists owner_id uuid references auth.users(id) default auth.uid();
alter table public.purchases add column if not exists owner_id uuid references auth.users(id) default auth.uid();
alter table public.sales     add column if not exists owner_id uuid references auth.users(id) default auth.uid();
alter table public.payments  add column if not exists owner_id uuid references auth.users(id) default auth.uid();

-- Row Level Security: each user only sees/changes their own rows.
alter table public.companies enable row level security;
alter table public.purchases enable row level security;
alter table public.sales enable row level security;
alter table public.payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','purchases','sales','payments'] loop
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- If you already have rows without an owner, assign them (replace the UUID):
-- update public.companies set owner_id = 'YOUR-USER-UUID' where owner_id is null;
-- (repeat for purchases, sales, payments)
