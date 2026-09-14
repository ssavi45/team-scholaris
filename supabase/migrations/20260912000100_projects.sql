create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  owner_id uuid not null references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'archived')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_id_idx on public.projects(owner_id);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  access_level text not null check (access_level in ('owner', 'member', 'viewer')),
  display_role text check (char_length(display_role) <= 120),
  joined_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index project_members_user_id_idx on public.project_members(user_id);
create unique index project_one_owner_idx on public.project_members(project_id) where access_level = 'owner';

-- Deferred checks allow project + owner membership to be created atomically.
create function public.check_project_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid; actual_owner uuid;
begin
  if TG_TABLE_NAME = 'projects' then target := new.id;
  elsif TG_OP = 'DELETE' then target := old.project_id;
  else target := new.project_id;
  end if;
  select owner_id into actual_owner from public.projects where id = target;
  if found and not exists (
    select 1 from public.project_members
    where project_id = target and user_id = actual_owner and access_level = 'owner'
  ) then raise exception 'Project must have exactly one matching owner membership'; end if;
  if TG_TABLE_NAME = 'project_members' then
    if TG_OP = 'UPDATE' then
      if old.project_id <> new.project_id then
        if exists (select 1 from public.projects p where p.id = old.project_id and not exists (
          select 1 from public.project_members m where m.project_id = p.id and m.user_id = p.owner_id and m.access_level = 'owner'
        )) then raise exception 'Project must retain its owner membership'; end if;
      end if;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.check_project_owner() from public, anon, authenticated;
create constraint trigger projects_owner_check after insert or update on public.projects
deferrable initially deferred for each row execute function public.check_project_owner();
create constraint trigger members_owner_check after insert or update or delete on public.project_members
deferrable initially deferred for each row execute function public.check_project_owner();

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
revoke all on public.projects, public.project_members from anon, authenticated;
grant select on public.projects, public.project_members to authenticated;

-- Security definer avoids recursive RLS through the membership table.
-- The caller can only ask whether THEY can see the supplied project.
create function public.can_access_project(project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p where p.id = project_id and p.deleted_at is null
    and exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = (select auth.uid()))
  );
$$;
revoke all on function public.can_access_project(uuid) from public, anon;
grant execute on function public.can_access_project(uuid) to authenticated;
create policy "Members read projects" on public.projects for select to authenticated
using (public.can_access_project(id));
create policy "Members read project membership" on public.project_members for select to authenticated
using (public.can_access_project(project_id));

-- Backend limit has one configurable definition; keep the frontend UX constant aligned.
create function public.max_owned_projects() returns integer
language sql immutable set search_path = '' as $$ select 5; $$;
revoke all on function public.max_owned_projects() from public, anon;
grant execute on function public.max_owned_projects() to authenticated;

create function public.create_project(project_name text, project_description text default '')
returns setof public.projects
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); created public.projects;
begin
  if caller is null or not exists (select 1 from auth.users where id = caller and email_confirmed_at is not null) then
    raise exception 'A verified account is required' using errcode = '42501';
  end if;
  if project_name is null or char_length(btrim(project_name)) not between 1 and 120
    or char_length(coalesce(project_description, '')) > 5000 then
    raise exception 'Enter a name of 1-120 characters and a description of at most 5000 characters' using errcode = '22023';
  end if;
  -- Serialize this user's creates, including requests from different tabs/devices.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  if (select count(*) from public.projects where owner_id = caller and deleted_at is null) >= public.max_owned_projects() then
    raise exception 'Owned project limit reached' using errcode = 'P0001';
  end if;
  insert into public.projects(name, description, owner_id)
  values (btrim(project_name), btrim(coalesce(project_description, '')), caller) returning * into created;
  insert into public.project_members(project_id, user_id, access_level) values (created.id, caller, 'owner');
  return next created;
end;
$$;
revoke all on function public.create_project(text, text) from public, anon;
grant execute on function public.create_project(text, text) to authenticated;
