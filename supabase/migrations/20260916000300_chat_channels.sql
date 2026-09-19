-- Migration to add research channel support to project_messages
alter table public.project_messages
  add column if not exists channel text not null default 'discussion'
  check (channel in ('discussion', 'announcements', 'ideas', 'experiments', 'general'));

create index if not exists project_messages_channel_time_idx
  on public.project_messages(project_id, channel, created_at asc);

-- Update get_project_messages to support optional channel filtering
drop function if exists public.get_project_messages(uuid, integer);
drop function if exists public.get_project_messages(uuid, integer, text);

create or replace function public.get_project_messages(
  p_project_id uuid,
  p_limit integer default 100,
  p_channel text default null
)
returns table(
  id uuid,
  project_id uuid,
  channel text,
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
    m.channel,
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
    and (p_channel is null or m.channel = p_channel)
  order by m.created_at asc
  limit coalesce(nullif(p_limit, 0), 100);
end;
$$;

revoke all on function public.get_project_messages(uuid, integer, text) from public, anon;
grant execute on function public.get_project_messages(uuid, integer, text) to authenticated;

