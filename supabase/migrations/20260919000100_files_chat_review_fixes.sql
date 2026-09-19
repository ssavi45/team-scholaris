-- Restrict file mutations to the supported rename operation. Object identity,
-- uploader attribution and quota accounting must not be client-editable.
revoke update on public.project_files from authenticated;
grant update (name, updated_at) on public.project_files to authenticated;

create or replace function public.can_manage_project_file(p_project_id uuid, p_uploaded_by uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    join public.project_members m on m.project_id = p.id
    join auth.users u on u.id = m.user_id
    where p.id = p_project_id and p.deleted_at is null and p.status = 'active'
      and m.user_id = auth.uid() and m.access_level in ('owner', 'member')
      and (m.access_level = 'owner' or p_uploaded_by = auth.uid())
      and u.email_confirmed_at is not null
  );
$$;

create or replace function public.check_project_file_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  total_storage bigint;
  stored storage.objects%rowtype;
begin
  -- Serialize concurrent registrations before calculating the project total.
  perform 1 from public.projects where id = new.project_id for update;
  if tg_op = 'INSERT' then
    if split_part(new.storage_path, '/', 1) <> new.project_id::text then
      raise exception 'Storage object belongs to another project' using errcode = '23514';
    end if;
    select * into stored from storage.objects
      where bucket_id = 'project-files' and name = new.storage_path for key share;
    if not found or stored.owner_id is distinct from new.uploaded_by::text
      or (stored.metadata->>'size')::bigint is distinct from new.size_bytes then
      raise exception 'File must match an uploaded object owned by its uploader' using errcode = '23514';
    end if;
    new.mime_type := coalesce(nullif(stored.metadata->>'mimetype', ''), 'application/octet-stream');
    new.created_at := now();
  end if;
  select coalesce(sum(size_bytes), 0) into total_storage
    from public.project_files where project_id = new.project_id and id <> new.id;
  if total_storage + new.size_bytes > 524288000 then
    raise exception 'Project storage quota of 500 MB exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Referenced objects remain immutable until their file record is removed.
-- Staged uploads can only be removed by their uploader or the project owner.
drop policy project_files_storage_delete on storage.objects;
create policy project_files_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'project-files'
  and public.project_file_storage_allowed(name, true)
  and not exists (select 1 from public.project_files f where f.storage_path = name)
  and (owner_id = auth.uid()::text or exists (
    select 1 from public.projects p
    where p.id::text = split_part(name, '/', 1) and p.owner_id = auth.uid()
  ))
);

-- Chat currently supports sending and deletion, not rewriting messages or
-- changing their sender, project, channel, or timestamps through direct UPDATE.
revoke update, insert on public.project_messages from authenticated;
grant insert (project_id, sender_id, content, channel) on public.project_messages to authenticated;
drop policy project_messages_update on public.project_messages;

create or replace function public.get_project_messages(
  p_project_id uuid, p_limit integer default 100, p_channel text default null
)
returns table (
  id uuid, project_id uuid, channel text, sender_id uuid, sender_name text,
  sender_avatar text, sender_role text, content text,
  created_at timestamptz, updated_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_project(p_project_id) then
    raise exception 'Project unavailable' using errcode = '42501';
  end if;
  -- Select the newest bounded window first, then return it in reading order.
  return query
  select m.id, m.project_id, m.channel, m.sender_id,
    coalesce(nullif(btrim(p.name), ''), 'Scholar'), p.avatar_url,
    coalesce(pm.access_level, 'member'), m.content, m.created_at, m.updated_at
  from (
    select msg.* from public.project_messages msg
    where msg.project_id = p_project_id and (p_channel is null or msg.channel = p_channel)
    order by msg.created_at desc, msg.id desc
    limit greatest(1, least(coalesce(nullif(p_limit, 0), 100), 100))
  ) m
  left join public.profiles p on p.id = m.sender_id
  left join public.project_members pm on pm.project_id = m.project_id and pm.user_id = m.sender_id
  order by m.created_at asc, m.id asc;
end;
$$;
