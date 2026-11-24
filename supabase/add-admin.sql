-- That Waffle Place - Add Production Admin User
-- Run this script in the Supabase SQL Editor to authorize sfourhospitality@gmail.com
insert into public.admins (email)
values ('sfourhospitality@gmail.com')
on conflict (email) do nothing;
