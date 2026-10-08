-- Puravigal POS production-oriented PostgreSQL foundation.
-- India-first, UAE-ready, globally extensible.
create extension if not exists pgcrypto;

create table if not exists organizations(
 id uuid primary key default gen_random_uuid(), name text not null, legal_name text,
 country_code char(2) not null default 'IN', currency_code char(3) not null default 'INR',
 timezone text not null default 'Asia/Kolkata', locale text not null default 'en-IN',
 tax_registration_number text, tax_registration_type text, address jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists stores(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, code text, address jsonb not null default '{}'::jsonb, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,code)
);
create table if not exists users(
 id uuid primary key default gen_random_uuid(), email text not null unique, password_hash text,
 display_name text not null, phone text, is_verified boolean not null default false,
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists sessions(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
 token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists organization_users(
 organization_id uuid not null references organizations(id) on delete cascade,
 user_id uuid not null references users(id) on delete cascade,
 role text not null default 'staff' check(role in('owner','admin','manager','cashier','inventory')),
 created_at timestamptz not null default now(), primary key(organization_id,user_id)
);
create table if not exists role_permissions(
 role text not null, permission text not null, primary key(role,permission)
);
create table if not exists business_settings(
 organization_id uuid primary key references organizations(id) on delete cascade,
 invoice_prefix text not null default 'INV', invoice_next bigint not null default 1,
 tax_mode text not null default 'exclusive', negative_stock_allowed boolean not null default false,
 default_payment_method text not null default 'cash', receipt_width text not null default '80mm',
 updated_at timestamptz not null default now()
);
create table if not exists categories(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, is_active boolean not null default true, created_at timestamptz not null default now(),
 unique(organization_id,name)
);
create table if not exists brands(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, is_active boolean not null default true, unique(organization_id,name)
);
create table if not exists units(
 id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id) on delete cascade,
 code text not null, name text not null, decimals smallint not null default 0 check(decimals between 0 and 6),
 unique(organization_id,code)
);
create table if not exists tax_profiles(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, country_code char(2) not null, tax_code text, rate numeric(9,4) not null default 0,
 components jsonb not null default '[]'::jsonb, effective_from date, effective_to date,
 is_zero_rated boolean not null default false, is_exempt boolean not null default false,
 unique(organization_id,name)
);
create table if not exists products(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 category_id uuid references categories(id), brand_id uuid references brands(id), unit_id uuid references units(id),
 name text not null, sku text, barcode text, description text,
 purchase_price numeric(19,4) not null default 0 check(purchase_price>=0),
 selling_price numeric(19,4) not null default 0 check(selling_price>=0), currency_code char(3) not null default 'INR',
 tax_profile_id uuid references tax_profiles(id), hsn_sac text, min_stock numeric(19,4) not null default 0,
 stock_tracking boolean not null default true, image_url text, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,sku), unique(organization_id,barcode)
);
create table if not exists customers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, phone text, email text, tax_id text, address jsonb not null default '{}'::jsonb,
 notes text, credit_limit numeric(19,4) not null default 0, opening_balance numeric(19,4) not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists suppliers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, phone text, email text, tax_id text, address jsonb not null default '{}'::jsonb,
 notes text, opening_balance numeric(19,4) not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists invoices(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 store_id uuid not null references stores(id), customer_id uuid references customers(id),
 invoice_number text not null, status text not null default 'draft' check(status in('draft','issued','partially_paid','paid','cancelled','refunded')),
 invoice_type text not null default 'tax_invoice', currency_code char(3) not null,
 subtotal numeric(19,4) not null default 0, discount_total numeric(19,4) not null default 0,
 taxable_total numeric(19,4) not null default 0, tax_total numeric(19,4) not null default 0,
 grand_total numeric(19,4) not null default 0, paid_total numeric(19,4) not null default 0,
 tax_snapshot jsonb not null default '{}'::jsonb, buyer_snapshot jsonb not null default '{}'::jsonb,
 seller_snapshot jsonb not null default '{}'::jsonb, created_by uuid references users(id),
 idempotency_key text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,store_id,invoice_number), unique(organization_id,idempotency_key)
);
create table if not exists invoice_items(
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references invoices(id) on delete restrict,
 product_id uuid references products(id), description text not null, quantity numeric(19,4) not null check(quantity>0),
 unit_price numeric(19,4) not null check(unit_price>=0), discount_amount numeric(19,4) not null default 0,
 taxable_amount numeric(19,4) not null default 0, tax_rate numeric(9,4) not null default 0,
 tax_amount numeric(19,4) not null default 0, line_total numeric(19,4) not null
);
create table if not exists payments(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 invoice_id uuid references invoices(id), method text not null, amount numeric(19,4) not null check(amount>0),
 currency_code char(3) not null, status text not null default 'paid',
 reference text, metadata jsonb not null default '{}'::jsonb, created_by uuid references users(id), created_at timestamptz not null default now()
);
create table if not exists stock_balances(
 organization_id uuid not null references organizations(id) on delete cascade,
 store_id uuid not null references stores(id) on delete cascade,
 product_id uuid not null references products(id) on delete cascade,
 quantity numeric(19,4) not null default 0, updated_at timestamptz not null default now(),
 primary key(organization_id,store_id,product_id)
);
create table if not exists stock_movements(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 store_id uuid not null references stores(id), product_id uuid not null references products(id),
 movement_type text not null check(movement_type in('opening','purchase','sale','sale_return','purchase_return','damage','adjustment','transfer_in','transfer_out')),
 quantity numeric(19,4) not null, unit_cost numeric(19,4) not null default 0, reference_type text,
 reference_id uuid, reason text, created_by uuid references users(id), created_at timestamptz not null default now(),
 idempotency_key text
);
create table if not exists suppliers_purchases(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 store_id uuid not null references stores(id), supplier_id uuid references suppliers(id),
 purchase_number text not null, status text not null default 'received',
 currency_code char(3) not null, subtotal numeric(19,4) not null default 0,
 tax_total numeric(19,4) not null default 0, total numeric(19,4) not null default 0,
 paid_total numeric(19,4) not null default 0, created_by uuid references users(id),
 created_at timestamptz not null default now(), unique(organization_id,store_id,purchase_number)
);
create table if not exists purchase_items(
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references suppliers_purchases(id) on delete restrict,
 product_id uuid not null references products(id), quantity numeric(19,4) not null check(quantity>0),
 unit_cost numeric(19,4) not null check(unit_cost>=0), tax_amount numeric(19,4) not null default 0,
 line_total numeric(19,4) not null
);
create table if not exists returns(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 store_id uuid not null references stores(id), invoice_id uuid references invoices(id),
 customer_id uuid references customers(id), return_number text not null, status text not null default 'completed',
 reason text, total numeric(19,4) not null default 0, created_by uuid references users(id), created_at timestamptz not null default now(),
 unique(organization_id,store_id,return_number)
);
create table if not exists return_items(
 id uuid primary key default gen_random_uuid(), return_id uuid not null references returns(id) on delete restrict,
 invoice_item_id uuid references invoice_items(id), product_id uuid references products(id),
 quantity numeric(19,4) not null check(quantity>0), refund_amount numeric(19,4) not null default 0
);
create table if not exists refund_transactions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 return_id uuid references returns(id), payment_id uuid references payments(id), method text not null,
 amount numeric(19,4) not null check(amount>0), status text not null default 'completed',
 reference text, created_at timestamptz not null default now()
);
create table if not exists invoice_deliveries(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 invoice_id uuid not null references invoices(id), channel text not null check(channel in('print','whatsapp','email','sms','share')),
 status text not null default 'queued', destination text, provider_reference text, error_message text,
 attempts int not null default 0, next_retry_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists plans(
 id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, price numeric(19,4) not null default 0,
 currency_code char(3) not null default 'INR', billing_period text not null default 'monthly', is_active boolean not null default true
);
create table if not exists plan_entitlements(
 plan_id uuid not null references plans(id) on delete cascade, feature text not null,
 limit_value bigint, primary key(plan_id,feature)
);
create table if not exists organization_subscriptions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 plan_id uuid not null references plans(id), status text not null default 'active',
 starts_at timestamptz not null default now(), ends_at timestamptz, metadata jsonb not null default '{}'::jsonb
);
create table if not exists usage_counters(
 organization_id uuid not null references organizations(id) on delete cascade, feature text not null,
 period_start date not null, count bigint not null default 0, primary key(organization_id,feature,period_start)
);
create table if not exists notifications(
 id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id) on delete cascade,
 user_id uuid references users(id) on delete cascade, type text not null, title text not null, body text not null,
 read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists import_jobs(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 entity_type text not null, status text not null default 'uploaded', source_filename text,
 total_rows int default 0, valid_rows int default 0, invalid_rows int default 0,
 errors jsonb not null default '[]'::jsonb, mapping jsonb not null default '{}'::jsonb,
 created_by uuid references users(id), created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists offline_operations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 device_id text not null, operation_key text not null, operation_type text not null,
 payload jsonb not null, status text not null default 'queued', conflict jsonb,
 created_at timestamptz not null default now(), processed_at timestamptz,
 unique(organization_id,operation_key)
);
create table if not exists audit_logs(
 id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id),
 user_id uuid references users(id), action text not null, entity_type text, entity_id uuid,
 before_data jsonb, after_data jsonb, ip_address inet, user_agent text, created_at timestamptz not null default now()
);

create index if not exists idx_products_org on products(organization_id);
create index if not exists idx_products_barcode on products(organization_id,barcode);
create index if not exists idx_products_name on products(organization_id,name);
create index if not exists idx_stock_product on stock_movements(organization_id,product_id,created_at);
create index if not exists idx_stock_balance_product on stock_balances(organization_id,product_id);
create index if not exists idx_invoices_org_date on invoices(organization_id,created_at);
create index if not exists idx_payments_invoice on payments(invoice_id,created_at);
create index if not exists idx_purchases_org_date on suppliers_purchases(organization_id,created_at);
create index if not exists idx_audit_org_date on audit_logs(organization_id,created_at);
create index if not exists idx_notifications_user on notifications(user_id,read_at,created_at);
create index if not exists idx_offline_status on offline_operations(organization_id,status,created_at);

insert into role_permissions(role,permission) values
('owner','*'),('admin','*'),
('manager','billing'),('manager','products'),('manager','inventory'),('manager','purchases'),('manager','customers'),('manager','suppliers'),('manager','reports'),
('cashier','billing'),('cashier','customers'),
('inventory','products'),('inventory','inventory'),('inventory','purchases')
on conflict do nothing;

insert into plans(code,name,price,currency_code,billing_period) values
('free','Free',0,'INR','monthly'),('standard','Standard',0,'INR','monthly')
on conflict(code) do nothing;

-- Idempotency and operational hardening added after initial foundation.
alter table if not exists suppliers_purchases add column if not exists idempotency_key text;
alter table if not exists returns add column if not exists idempotency_key text;
create unique index if not exists ux_purchase_idempotency on suppliers_purchases(organization_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists ux_return_idempotency on returns(organization_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists ux_stock_movement_idempotency on stock_movements(organization_id,idempotency_key) where idempotency_key is not null;
create index if not exists idx_sessions_user_active on sessions(user_id,revoked_at,expires_at);
create index if not exists idx_org_users_user on organization_users(user_id,organization_id);
create index if not exists idx_invoice_items_invoice on invoice_items(invoice_id);
create index if not exists idx_returns_invoice on returns(invoice_id,created_at);
create index if not exists idx_purchase_items_purchase on purchase_items(purchase_id);

-- Reference masters used by onboarding and regional defaults.
insert into units(organization_id,code,name,decimals)
select null,'PCS','Piece',0
where not exists(select 1 from units where organization_id is null and code='PCS');

