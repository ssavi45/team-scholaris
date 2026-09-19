-- Table for real-time project discussions and co-author chat
create table public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  content text not null check (length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_messages_project_time_idx on public.project_messages(project_id, created_at asc);
create index project_messages_sender_idx on public.project_messages(sender_id);

-- Enable Realtime replication on project_messages
alter table public.project_messages replica identity full;
alter publication supabase_realtime add table public.project_messages;

-- RLS policies
alter table public.project_messages enable row level security;
revoke all on public.project_messages from anon, authenticated;
grant select, insert, update, delete on public.project_messages to authenticated;

-- Read: any member or viewer of the project
create policy project_messages_select on public.project_messages for select to authenticated
using (public.can_access_project(project_id));

-- Insert: active members or owners
create policy project_messages_insert on public.project_messages for insert to authenticated
with check (
  public.can_upload_project_file(project_id)
  and sender_id = auth.uid()
);

-- Update: sender only
create policy project_messages_update on public.project_messages for update to authenticated
using (public.can_manage_project_file(project_id, sender_id))
with check (public.can_manage_project_file(project_id, sender_id));

-- Delete: sender or project owner
create policy project_messages_delete on public.project_messages for delete to authenticated
using (public.can_manage_project_file(project_id, sender_id));

-- RPC for fetching messages joined with sender profile and project role
create or replace function public.get_project_messages(
  p_project_id uuid,
  p_limit integer default 100
)
returns table(
  id uuid,
  project_id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar text,
  sender_role text,
  content text,
  created_at timestamptz,
  updated_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_project(p_project_id) then
    raise exception 'Project unavailable' using errcode = '42501';
  end if;

  return query
  select
    m.id,
    m.project_id,
    m.sender_id,
    coalesce(nullif(btrim(p.name), ''), 'Scholar') as sender_name,
    p.avatar_url as sender_avatar,
    coalesce(pm.access_level, 'member') as sender_role,
    m.content,
    m.created_at,
    m.updated_at
  from public.project_messages m
  left join public.profiles p on p.id = m.sender_id
  left join public.project_members pm on pm.project_id = m.project_id and pm.user_id = m.sender_id
  where m.project_id = p_project_id
  order by m.created_at asc
  limit coalesce(nullif(p_limit, 0), 100);
end;
$$;
revoke all on function public.get_project_messages(uuid, integer) from public, anon;
grant execute on function public.get_project_messages(uuid, integer) to authenticated;

