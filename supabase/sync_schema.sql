-- That Waffle Place: Excel Live Sync Schema & Realtime Setup
-- Safe to run multiple times in Supabase SQL editor.

-- 1. Devices authorized to send sync payloads
create table if not exists public.sync_devices (
  device_id text primary key,
  device_name text not null,
  api_key_hash text not null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2. Durable synchronized records ingested from Excel
create table if not exists public.synced_records (
  id uuid primary key default gen_random_uuid(),
  sheet_name text not null,
  row_id text not null,
  row_number integer,
  data jsonb not null default '{}'::jsonb,
  content_hash text not null,
  sync_version bigint not null default 0,
  is_deleted boolean not null default false,
  device_id text references public.sync_devices(device_id) on delete set null,
  created_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  constraint uq_synced_records_sheet_row unique (sheet_name, row_id)
);

-- 3. Audit log of sync batches for observability
create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  device_id text,
  sheet_name text not null,
  sync_version bigint not null,
  is_full_sync boolean not null default true,
  records_count integer not null default 0,
  upserted_count integer not null default 0,
  deleted_count integer not null default 0,
  content_hash text,
  status text not null default 'success' check (status in ('success', 'partial', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

-- 4. Fast query indexes
create index if not exists idx_synced_records_active 
  on public.synced_records (sheet_name) 
  where not is_deleted;

create index if not exists idx_synced_records_version 
  on public.synced_records (sheet_name, sync_version);

create index if not exists idx_synced_records_row_id 
  on public.synced_records (row_id);

create index if not exists idx_sync_logs_sheet_time 
  on public.sync_logs (sheet_name, created_at desc);

-- 5. Row-Level Security (RLS)
alter table public.sync_devices enable row level security;
alter table public.synced_records enable row level security;
alter table public.sync_logs enable row level security;

-- Revoke dangerous privileges from anon / authenticated
revoke all on public.sync_devices from anon, authenticated;
revoke all on public.sync_logs from anon, authenticated;

-- Public read access: Anon and authenticated users can ONLY read active, non-deleted records
drop policy if exists "public reads active synced records" on public.synced_records;
create policy "public reads active synced records" on public.synced_records
  for select to anon, authenticated
  using (not is_deleted);

-- Admins full access
drop policy if exists "admins manage synced records" on public.synced_records;
create policy "admins manage synced records" on public.synced_records
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins view sync logs" on public.sync_logs;
create policy "admins view sync logs" on public.sync_logs
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admins manage sync devices" on public.sync_devices;
create policy "admins manage sync devices" on public.sync_devices
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6. Enable Supabase Realtime publication
-- This broadcasts insert/update/delete events to the web frontend
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'synced_records'
  ) then
    alter publication supabase_realtime add table public.synced_records;
  end if;
exception
  when others then
    -- Some self-hosted or standard postgres environments don't have publication pre-created
    null;
end $$;
