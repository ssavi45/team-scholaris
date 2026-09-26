-- Credentials and OAuth state are inaccessible to browser roles, even through
-- REST. Ciphertexts are encrypted by the Edge Function with a separate key.
create table public.google_calendar_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  google_sub text not null,
  email text not null,
  refresh_cipher text not null,
  updated_at timestamptz not null default now()
);
create table public.google_calendar_oauth_states (
  state_hash text primary key,
  browser_hash text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  verifier text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
revoke all on public.google_calendar_connections, public.google_calendar_oauth_states from public, anon, authenticated;
grant all on public.google_calendar_connections, public.google_calendar_oauth_states to service_role;
create index google_oauth_expiry on public.google_calendar_oauth_states(expires_at);

alter table public.project_meetings add column meeting_provider text not null default 'external' check (meeting_provider in ('external','google'));
alter table public.project_meetings add column google_owner_id uuid references public.profiles(id);
alter table public.project_meetings add column google_status text check (google_status in ('pending','ready','error','cancelled'));
alter table public.project_meetings add column google_error text;

create table public.google_calendar_operations (
  meeting_id uuid primary key references public.project_meetings(id) on delete cascade,
  google_sub text not null,
  event_id text not null unique,
  lease_id uuid,
  lease_until timestamptz,
  revision integer,
  event_created boolean not null default false
);
alter table public.google_calendar_operations enable row level security;
revoke all on public.google_calendar_operations from public, anon, authenticated;
grant all on public.google_calendar_operations to service_role;

create function public.consume_google_oauth_state(p_hash text,p_browser text)
returns setof public.google_calendar_oauth_states language sql security definer set search_path = '' as $$
  delete from public.google_calendar_oauth_states where state_hash = p_hash and browser_hash = p_browser and expires_at > now() returning *;
$$;
revoke all on function public.consume_google_oauth_state(text,text) from public, anon, authenticated;
grant execute on function public.consume_google_oauth_state(text,text) to service_role;

create function public.guard_google_meeting_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.meeting_provider is distinct from old.meeting_provider or new.google_owner_id is distinct from old.google_owner_id
    or new.google_status is distinct from old.google_status or new.google_error is distinct from old.google_error then
    raise exception 'Google connection fields are server-managed' using errcode = '42501';
  end if;
  if old.meeting_provider = 'google' then
    if exists(select 1 from public.google_calendar_operations o where o.meeting_id = old.id and o.lease_until > now()) then
      raise exception 'Google is synchronizing this meeting. Wait a moment, then retry.' using errcode = '40001';
    end if;
    if new.join_url is distinct from old.join_url then raise exception 'The Google Meet link is managed automatically.' using errcode = '22023'; end if;
    if (new.title,new.starts_at,new.ends_at,new.time_zone,new.agenda,new.cancelled_at)
      is distinct from (old.title,old.starts_at,old.ends_at,old.time_zone,old.agenda,old.cancelled_at) then
      new.google_status := 'pending'; new.google_error := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_google_meeting_changes() from public, anon, authenticated;
create trigger guard_google_meetings before update on public.project_meetings for each row execute function public.guard_google_meeting_changes();

-- Only the verified Edge Function may acquire an operation. It passes the
-- authenticated caller ID, never an untrusted ID from the request body.
create function public.begin_google_meeting(p_user_id uuid,p_meeting_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.project_meetings; p public.projects; c public.google_calendar_connections; o public.google_calendar_operations; access text; lease uuid;
begin
  select project_id into p.id from public.project_meetings where id = p_meeting_id;
  select * into p from public.projects where id = p.id for update;
  select * into m from public.project_meetings where id = p_meeting_id;
  select access_level into access from public.project_members where project_id = p.id and user_id = p_user_id;
  if m.id is null or p.id is null or p.deleted_at is not null or p.status <> 'active' or access is null or access not in ('owner','member') then
    raise exception 'Project unavailable or read-only.' using errcode = '42501';
  end if;
  if (m.meeting_provider = 'external' and (m.created_by <> p_user_id or m.cancelled_at is not null))
    or (m.meeting_provider = 'google' and m.google_owner_id is distinct from p_user_id) then
    raise exception 'Only the connected meeting organizer can manage its Google event.' using errcode = '42501';
  end if;
  select * into c from public.google_calendar_connections where user_id = p_user_id;
  if c.user_id is null then raise exception 'Connect Google from Meetings first.' using errcode = '22023'; end if;
  select * into o from public.google_calendar_operations where meeting_id = m.id for update;
  if o.meeting_id is not null and o.google_sub <> c.google_sub then raise exception 'Reconnect the Google account originally used for this meeting.' using errcode = '22023'; end if;
  if o.lease_until > now() then raise exception 'This meeting is already synchronizing. Wait a moment, then refresh.' using errcode = '40001'; end if;
  lease := gen_random_uuid();
  insert into public.google_calendar_operations(meeting_id,google_sub,event_id,lease_id,lease_until,revision)
    values(m.id,c.google_sub,'scholaris' || replace(m.id::text,'-',''),lease,now() + interval '3 minutes',m.revision)
    on conflict(meeting_id) do update set lease_id = excluded.lease_id,lease_until = excluded.lease_until,revision = excluded.revision returning * into o;
  update public.project_meetings set meeting_provider = 'google',google_owner_id = p_user_id,google_status = 'pending',google_error = null where id = m.id returning * into m;
  return jsonb_build_object('meeting',to_jsonb(m),'operation',to_jsonb(o));
end;
$$;
revoke all on function public.begin_google_meeting(uuid,uuid) from public, anon, authenticated;
grant execute on function public.begin_google_meeting(uuid,uuid) to service_role;

create function public.finish_google_meeting(p_user_id uuid,p_meeting_id uuid,p_lease uuid,p_status text,p_url text,p_error text,p_created boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.project_meetings; p public.projects; o public.google_calendar_operations;
begin
  select project_id into p.id from public.project_meetings where id = p_meeting_id;
  select * into p from public.projects where id = p.id for update;
  select * into m from public.project_meetings where id = p_meeting_id;
  select * into o from public.google_calendar_operations where meeting_id = p_meeting_id for update;
  if o.lease_id is distinct from p_lease or p_lease is null then raise exception 'Operation expired. Refresh the meeting.' using errcode = '40001'; end if;
  if p_status not in ('pending','ready','error','cancelled') or p_status is null
    or (p_status = 'ready' and (p_url is null or p_url !~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$')) then raise exception 'Invalid Google result' using errcode = '22023'; end if;
  update public.google_calendar_operations set lease_id = null,lease_until = null,event_created = event_created or p_created where meeting_id = p_meeting_id;
  if m.google_owner_id is distinct from p_user_id or m.revision <> o.revision or p.deleted_at is not null or p.status <> 'active'
    or not exists(select 1 from public.project_members where project_id = p.id and user_id = p_user_id and access_level in ('owner','member')) then
    update public.project_meetings set google_status = 'error',google_error = 'Access or meeting details changed during synchronization. The Google organizer must review the calendar event.' where id = p_meeting_id;
    return;
  end if;
  -- Provider-only status changes do not invalidate an open notes draft. A new
  -- link does, since the ordinary save RPC carries the previous link value.
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  update public.project_meetings set google_status = p_status,google_error = left(p_error,500),
    join_url = case when p_status = 'ready' then p_url else join_url end,
    revision = revision + case when p_status = 'ready' and join_url <> p_url then 1 else 0 end,
    updated_at = case when p_status = 'ready' and join_url <> p_url then now() else updated_at end where id = p_meeting_id;
end;
$$;
revoke all on function public.finish_google_meeting(uuid,uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.finish_google_meeting(uuid,uuid,uuid,text,text,text,boolean) to service_role;
