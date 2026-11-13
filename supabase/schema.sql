-- That Waffle Place admin & WhatsApp automation schema.
-- Paste this into the Supabase SQL editor and run it once.
-- It is safe to run again. Admin emails go in add-admin.local.sql, which stays out of git.

create table if not exists public.admins (
  email text primary key check (email = lower(email))
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where email = lower(auth.jwt() ->> 'email')
  );
$$;

create or replace function public.today_ist()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  price_rupees integer check (price_rupees >= 0),
  photo_url text,
  scene text not null default 'umber' check (scene in ('umber', 'dune', 'lily', 'umber-deep')),
  position integer not null default 0,
  is_visible boolean not null default true
);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  discount text not null check (length(trim(discount)) > 0),
  starts_on date not null,
  ends_on date not null,
  terms text not null check (length(trim(terms)) > 0),
  poster_url text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table if not exists public.site_settings (
  id integer primary key default 1 check (id = 1),
  hours text not null default ''
);

-- WhatsApp Automation: Customers, Broadcasts & Delivery Logs
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text not null unique check (phone ~ '^\+91[6-9][0-9]{9}$'),
  is_subscribed boolean not null default true,
  opted_in_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  source text not null default 'website' check (source in ('website', 'counter', 'import'))
);

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references public.offers(id) on delete cascade,
  template_name text not null default 'twp_offer_broadcast',
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('draft', 'scheduled', 'processing', 'completed', 'failed', 'cancelled')),
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.broadcast_logs (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid references public.broadcasts(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  phone text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'failed')),
  meta_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

-- Opt out helper RPC (callable by webhook or customer)
create or replace function public.opt_out_customer(target_phone text)
returns boolean
language plpgsql
security definer
as $$
declare
  cleaned_phone text;
begin
  cleaned_phone := trim(target_phone);
  if not cleaned_phone ~ '^\+91' then
    cleaned_phone := '+91' || cleaned_phone;
  end if;

  update public.customers
  set is_subscribed = false,
      unsubscribed_at = now()
  where phone = cleaned_phone;

  return found;
end;
$$;

insert into public.site_settings (id) values (1) on conflict (id) do nothing;

insert into public.menu_items (name, description, photo_url, scene, position)
select * from (values
  ('that red one', 'Red velvet, cream, a dusting of crumbs.', 'assets/photo-red-velvet.webp', 'umber', 1),
  ('that crunchy one', 'Golden waffle over a crisp chocolate layer.', 'assets/photo-crunch-plate.webp', 'dune', 2),
  ('that fruity one', 'Dark waffle packed with strawberry cream.', 'assets/photo-fruit-pair.webp', 'lily', 3),
  ('that cold one', 'Ice cream, sandwiched between waffles.', 'assets/photo-cold-pair.webp', 'umber-deep', 4)
) as seed (name, description, photo_url, scene, position)
where not exists (select 1 from public.menu_items);

alter table public.admins enable row level security;
alter table public.menu_items enable row level security;
alter table public.offers enable row level security;
alter table public.site_settings enable row level security;
alter table public.customers enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_logs enable row level security;

revoke all on public.admins from anon, authenticated;
grant select on public.menu_items, public.offers, public.site_settings to anon, authenticated;
grant insert, update, delete on public.menu_items, public.offers to authenticated;
grant update on public.site_settings to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.opt_out_customer(text) to anon, authenticated;

-- Public can insert opt-ins to customers
grant insert on public.customers to anon, authenticated;
grant select, insert, update, delete on public.customers, public.broadcasts, public.broadcast_logs to authenticated;

-- Policies for public reading
drop policy if exists "public reads visible menu" on public.menu_items;
create policy "public reads visible menu" on public.menu_items
  for select to anon, authenticated using (is_visible);

drop policy if exists "public reads live offers" on public.offers;
create policy "public reads live offers" on public.offers
  for select to anon, authenticated
  using (is_visible and public.today_ist() between starts_on and ends_on);

drop policy if exists "public reads settings" on public.site_settings;
create policy "public reads settings" on public.site_settings
  for select to anon, authenticated using (true);

drop policy if exists "public can opt in" on public.customers;
create policy "public can opt in" on public.customers
  for insert to anon, authenticated with check (is_subscribed = true);

-- Policies for admins
drop policy if exists "admins manage menu" on public.menu_items;
create policy "admins manage menu" on public.menu_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage offers" on public.offers;
create policy "admins manage offers" on public.offers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins update settings" on public.site_settings;
create policy "admins update settings" on public.site_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage customers" on public.customers;
create policy "admins manage customers" on public.customers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage broadcasts" on public.broadcasts;
create policy "admins manage broadcasts" on public.broadcasts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins view broadcast logs" on public.broadcast_logs;
create policy "admins view broadcast logs" on public.broadcast_logs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Photos and posters. Under 5 MB, images only, as the client brief asks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "admins upload media" on storage.objects;
create policy "admins upload media" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "admins change media" on storage.objects;
create policy "admins change media" on storage.objects
  for update to authenticated using (bucket_id = 'media' and public.is_admin());

drop policy if exists "admins delete media" on storage.objects;
create policy "admins delete media" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and public.is_admin());
