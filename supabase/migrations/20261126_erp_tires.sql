-- The usual tire and axles for each model, learned from the ERP production schedule by the erp-load function.
create table if not exists public.rs_erp_tires (
  model_code text primary key,
  tire text not null,
  axle text not null default '',
  seen_at timestamptz not null default now()
);
alter table public.rs_erp_tires enable row level security;
-- Only the erp-load function (service role) reads and writes it; the app gets tires on each rs_erp_loads row.
