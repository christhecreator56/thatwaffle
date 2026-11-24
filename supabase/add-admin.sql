-- ====================================================================
-- That Waffle Place — Supabase Setup Query
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ====================================================================

-- 1. Ensure pgcrypto is enabled for secure password hashing
create extension if not exists pgcrypto;

-- 2. Grant admin privileges to the email in public.admins
insert into public.admins (email)
values ('sfourhospitality@gmail.com')
on conflict (email) do nothing;

-- 3. Create or update the Supabase Auth user with confirmed email & password
do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = 'sfourhospitality@gmail.com';
  
  if v_user_id is null then
    -- Create new confirmed user in Supabase Auth
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'sfourhospitality@gmail.com',
      crypt('twp@vad2026', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Admin"}'::jsonb,
      now(),
      now(),
      ''
    );
  else
    -- Update existing user password and confirm email
    update auth.users
    set encrypted_password = crypt('twp@vad2026', gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = v_user_id;
  end if;
end $$;

