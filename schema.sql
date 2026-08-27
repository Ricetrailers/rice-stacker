-- Rice Stacker — Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- ============ tables ============

create table if not exists public.rs_profiles (
  id         text primary key,
  name       text not null,
  kind       text not null default 'trailer',      -- 'trailer' | 'truck'
  grp        text not null default '',             -- folder path, e.g. 'Deckovers/HD'
  width      double precision not null,
  height     double precision not null,
  ox         double precision not null default 0,
  oy         double precision not null default 0,
  polylines  jsonb not null,
  added      bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.rs_loads (
  id         text primary key,
  load_no    text not null default '',
  customer   text not null default '',
  ship_date  text not null default '',
  notes      text not null default '',
  placements jsonb not null default '[]',
  photos     jsonb not null default '[]',          -- [{id, file, ts}] file = storage path
  created    bigint not null default 0,
  updated    bigint not null default 0,
  version    integer not null default 0,           -- bumped on every save (conflict check)
  updated_at timestamptz not null default now()
);

create table if not exists public.rs_folders (
  path       text primary key                       -- keeps empty folders alive
);

create table if not exists public.rs_settings (
  key        text primary key,                      -- 'keys', 'seedRev', ...
  value      jsonb not null
);

-- ============ row level security ============
-- One company, one team: any signed-in user can read and write everything.
-- (Accounts are created by the owner in Authentication -> Users; sign-ups are
-- disabled by default when you turn off email signups in Auth settings.)

alter table public.rs_profiles enable row level security;
alter table public.rs_loads    enable row level security;
alter table public.rs_folders  enable row level security;
alter table public.rs_settings enable row level security;

drop policy if exists "team all" on public.rs_profiles;
create policy "team all" on public.rs_profiles for all to authenticated using (true) with check (true);
drop policy if exists "team all" on public.rs_loads;
create policy "team all" on public.rs_loads    for all to authenticated using (true) with check (true);
drop policy if exists "team all" on public.rs_folders;
create policy "team all" on public.rs_folders  for all to authenticated using (true) with check (true);
drop policy if exists "team all" on public.rs_settings;
create policy "team all" on public.rs_settings for all to authenticated using (true) with check (true);

-- ============ photo storage ============

insert into storage.buckets (id, name, public)
values ('load-photos', 'load-photos', false)
on conflict (id) do nothing;

drop policy if exists "team read photos" on storage.objects;
create policy "team read photos" on storage.objects
  for select to authenticated using (bucket_id = 'load-photos');
drop policy if exists "team write photos" on storage.objects;
create policy "team write photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'load-photos');
drop policy if exists "team delete photos" on storage.objects;
create policy "team delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'load-photos');
