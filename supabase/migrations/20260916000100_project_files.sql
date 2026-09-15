-- Create table for general project files (datasets, reference papers, notebooks, assets)
create table public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 255),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800), -- 50 MB max per file
  mime_type text not null default 'application/octet-stream',
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_files_project_id_idx on public.project_files(project_id);
create index project_files_uploaded_by_idx on public.project_files(uploaded_by);
create unique index project_files_project_name_idx on public.project_files(project_id, lower(name));

-- Storage quota enforcement: 500 MB (524,288,000 bytes) cumulative per project
create or replace function public.check_project_file_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  total_storage bigint;
begin
  select coalesce(sum(size_bytes), 0) into total_storage
  from public.project_files
  where project_id = new.project_id
    and id <> new.id;

  if (total_storage + new.size_bytes) > 524288000 then
    raise exception 'Project storage quota of 500 MB exceeded' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke all on function public.check_project_file_quota() from public, anon, authenticated;
create trigger check_project_file_quota_trigger
before insert or update of size_bytes, project_id on public.project_files
for each row execute function public.check_project_file_quota();

-- Create private storage bucket
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Storage access helper
create or replace function public.project_file_storage_allowed(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    join public.project_members m on m.project_id = p.id
    join auth.users u on u.id = m.user_id
    where p.id::text = split_part(p_name, '/', 1)
      and p.deleted_at is null
      and m.user_id = auth.uid()
      and u.email_confirmed_at is not null
      and (
        case
          when p_write then p.status = 'active' and m.access_level in ('owner', 'member')
          else true
        end
      )
  );
$$;
revoke all on function public.project_file_storage_allowed(text, boolean) from public, anon;
grant execute on function public.project_file_storage_allowed(text, boolean) to authenticated;

-- Storage policies
create policy project_files_storage_read on storage.objects for select to authenticated
using (bucket_id = 'project-files' and public.project_file_storage_allowed(name, false));

create policy project_files_storage_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-files'
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}(-[^/]+)?$'
  and public.project_file_storage_allowed(name, true)
);

create policy project_files_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'project-files'
  and public.project_file_storage_allowed(name, true)
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = split_part(name, '/', 1) and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.project_files pf
      where pf.storage_path = name and pf.uploaded_by = auth.uid()
    )
    or not exists (
      select 1 from public.project_files pf where pf.storage_path = name
    )
  )
);

-- Table access helper functions (security definer to avoid direct unprivileged auth.users access in RLS)
create or replace function public.can_upload_project_file(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    join public.project_members m on m.project_id = p.id
    join auth.users u on u.id = m.user_id
    where p.id = p_project_id
      and p.deleted_at is null
      and p.status = 'active'
      and m.user_id = auth.uid()
      and m.access_level in ('owner', 'member')
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.can_upload_project_file(uuid) from public, anon;
grant execute on function public.can_upload_project_file(uuid) to authenticated;

create or replace function public.can_manage_project_file(p_project_id uuid, p_uploaded_by uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    join public.project_members m on m.project_id = p.id
    join auth.users u on u.id = m.user_id
    where p.id = p_project_id
      and p.deleted_at is null
      and p.status = 'active'
      and m.user_id = auth.uid()
      and (m.access_level = 'owner' or p_uploaded_by = auth.uid())
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.can_manage_project_file(uuid, uuid) from public, anon;
grant execute on function public.can_manage_project_file(uuid, uuid) to authenticated;

-- Table RLS
alter table public.project_files enable row level security;
revoke all on public.project_files from anon, authenticated;
grant select, insert, update, delete on public.project_files to authenticated;

create policy project_files_select on public.project_files for select to authenticated
using (public.can_access_project(project_id));

create policy project_files_insert on public.project_files for insert to authenticated
with check (
  public.can_upload_project_file(project_id)
  and uploaded_by = auth.uid()
);

create policy project_files_update on public.project_files for update to authenticated
using (public.can_manage_project_file(project_id, uploaded_by))
with check (public.can_manage_project_file(project_id, uploaded_by));

create policy project_files_delete on public.project_files for delete to authenticated
using (public.can_manage_project_file(project_id, uploaded_by));

-- RPC for loading files with uploader information
create or replace function public.get_project_files(p_project_id uuid)
returns table(
  id uuid,
  project_id uuid,
  name text,
  storage_path text,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid,
  uploader_name text,
  created_at timestamptz,
  updated_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_project(p_project_id) then
    raise exception 'Project unavailable' using errcode = '42501';
  end if;
  return query
  select
    f.id,
    f.project_id,
    f.name,
    f.storage_path,
    f.size_bytes,
    f.mime_type,
    f.uploaded_by,
    coalesce(nullif(btrim(p.name), ''), 'Scholar') as uploader_name,
    f.created_at,
    f.updated_at
  from public.project_files f
  left join public.profiles p on p.id = f.uploaded_by
  where f.project_id = p_project_id
  order by f.created_at desc;
end;
$$;
revoke all on function public.get_project_files(uuid) from public, anon;
grant execute on function public.get_project_files(uuid) to authenticated;

