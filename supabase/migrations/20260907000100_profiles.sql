create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, avatar_url) on public.profiles to authenticated;

create policy "Read own profile" on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy "Update own profile" on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create function public.create_user_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''), 120));
  return new;
end;
$$;
revoke all on function public.create_user_profile() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_user_profile();

create function public.touch_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.touch_profile() from public, anon, authenticated;
create trigger on_profile_updated before update on public.profiles
for each row execute function public.touch_profile();

insert into public.profiles (id, name)
select id, left(coalesce(raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'full_name', ''), 120)
from auth.users on conflict (id) do nothing;
