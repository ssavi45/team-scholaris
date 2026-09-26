create table public.project_meetings (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  time_zone text not null,
  agenda text not null default '' check (char_length(agenda) <= 10000),
  notes text not null default '' check (char_length(notes) <= 20000),
  join_url text not null default '',
  attendee_ids uuid[] not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  cancelled_at timestamptz
);
create index project_meetings_schedule on public.project_meetings(project_id,starts_at,id);
alter table public.project_meetings enable row level security;
revoke all on public.project_meetings from anon, authenticated;
grant select on public.project_meetings to authenticated;
create policy meetings_read on public.project_meetings for select to authenticated using (public.can_access_project(project_id));

create function public.record_meeting_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare event text;
begin
  if TG_OP = 'INSERT' then event := 'meeting.created';
  elsif new.cancelled_at is not null and old.cancelled_at is null then event := 'meeting.cancelled';
  else
    if (new.title,new.starts_at,new.ends_at,new.time_zone,new.agenda,new.join_url,new.attendee_ids)
      is distinct from (old.title,old.starts_at,old.ends_at,old.time_zone,old.agenda,old.join_url,old.attendee_ids) then
      insert into public.activity_events(project_id,actor_id,event_type,entity_type,entity_id,metadata)
        values(new.project_id,auth.uid(),'meeting.updated','meetings',new.id,jsonb_build_object('title',new.title));
    end if;
    if new.notes is not distinct from old.notes then return new; end if;
    event := 'meeting.notes_updated';
  end if;
  insert into public.activity_events(project_id,actor_id,event_type,entity_type,entity_id,metadata)
    values(new.project_id,auth.uid(),event,'meetings',new.id,jsonb_build_object('title',new.title));
  return new;
end;
$$;
revoke all on function public.record_meeting_activity() from public, anon, authenticated;
create trigger meetings_history after insert or update on public.project_meetings for each row execute function public.record_meeting_activity();

create function public.save_project_meeting(
  p_project_id uuid, p_meeting_id uuid, p_revision integer, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_time_zone text,
  p_agenda text, p_notes text, p_join_url text, p_attendee_ids uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare p public.projects; m public.project_meetings; access text; attendees uuid[];
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  select * into p from public.projects where id = p_project_id for update;
  select access_level into access from public.project_members where project_id = p_project_id and user_id = auth.uid();
  if p.id is null or p.deleted_at is not null or p.status <> 'active' or access is null or access not in ('owner','member') then
    raise exception 'This project is read-only or unavailable' using errcode = '42501';
  end if;
  if p_meeting_id is null or p_revision is null or p_revision < 0 or p_title is null or char_length(btrim(p_title)) not between 1 and 160
    or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
    or p_starts_at < timestamptz '2000-01-01 00:00:00+00' or p_ends_at >= timestamptz '2101-01-01 00:00:00+00'
    or p_agenda is null or char_length(p_agenda) > 10000 or p_notes is null or char_length(p_notes) > 20000
    or p_time_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_time_zone)
    or p_attendee_ids is null or array_position(p_attendee_ids,null) is not null or cardinality(p_attendee_ids) > 500
    or p_join_url is null or char_length(p_join_url) > 2048
    or (p_join_url <> '' and p_join_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:]\\]*)?$') then
    raise exception 'Check the title, dates, time zone, attendees, and HTTPS meeting link.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct a order by a),'{}'::uuid[]) into attendees from unnest(p_attendee_ids) a;
  select * into m from public.project_meetings where id = p_meeting_id and project_id = p_project_id;
  if m.id is not null and access <> 'owner' and m.created_by <> auth.uid() then
    raise exception 'Only the organizer or project owner can manage this meeting.' using errcode = '42501';
  end if;
  -- An identical retry is safe after a lost response, for both create and update.
  if m.id is not null and m.cancelled_at is null and m.revision = p_revision + 1
    and (p_revision > 0 or m.created_by = auth.uid())
    and (m.title,m.starts_at,m.ends_at,m.time_zone,m.agenda,m.notes,m.join_url,m.attendee_ids)
      is not distinct from (btrim(p_title),p_starts_at,p_ends_at,p_time_zone,p_agenda,p_notes,p_join_url,attendees) then return; end if;
  if (p_revision = 0 and m.id is not null) or (p_revision > 0 and (m.id is null or m.revision <> p_revision or m.cancelled_at is not null)) then
    raise exception 'This meeting changed or was cancelled. Copy your edits, close the form, and refresh before trying again.' using errcode = '40001';
  end if;
  -- Existing attendees may remain as historical attribution after leaving. New
  -- selections must be current project members, including read-only viewers.
  if exists(select 1 from unnest(attendees) a where not exists(select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = a)
    and not (a = any(coalesce(m.attendee_ids,'{}'::uuid[])))) then
    raise exception 'Choose attendees from the current project team.' using errcode = '22023';
  end if;
  if p_revision = 0 then
    insert into public.project_meetings(id,project_id,title,starts_at,ends_at,time_zone,agenda,notes,join_url,attendee_ids,created_by)
      values(p_meeting_id,p_project_id,btrim(p_title),p_starts_at,p_ends_at,p_time_zone,p_agenda,p_notes,p_join_url,attendees,auth.uid());
  else
    if (m.title,m.starts_at,m.ends_at,m.time_zone,m.agenda,m.notes,m.join_url,m.attendee_ids)
      is not distinct from (btrim(p_title),p_starts_at,p_ends_at,p_time_zone,p_agenda,p_notes,p_join_url,attendees) then return; end if;
    update public.project_meetings set title = btrim(p_title),starts_at = p_starts_at,ends_at = p_ends_at,time_zone = p_time_zone,
      agenda = p_agenda,notes = p_notes,join_url = p_join_url,attendee_ids = attendees,revision = revision + 1,updated_at = now() where id = m.id;
  end if;
end;
$$;
revoke all on function public.save_project_meeting(uuid,uuid,integer,text,timestamptz,timestamptz,text,text,text,text,uuid[]) from public, anon;
grant execute on function public.save_project_meeting(uuid,uuid,integer,text,timestamptz,timestamptz,text,text,text,text,uuid[]) to authenticated;

create function public.cancel_project_meeting(p_project_id uuid,p_meeting_id uuid,p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.projects; m public.project_meetings; access text;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  select * into p from public.projects where id = p_project_id for update;
  select access_level into access from public.project_members where project_id = p_project_id and user_id = auth.uid();
  if p.id is null or p.deleted_at is not null or p.status <> 'active' or access is null or access not in ('owner','member') then
    raise exception 'This project is read-only or unavailable' using errcode = '42501';
  end if;
  select * into m from public.project_meetings where id = p_meeting_id and project_id = p_project_id;
  if m.id is null then raise exception 'Meeting unavailable' using errcode = '40001'; end if;
  if access <> 'owner' and m.created_by <> auth.uid() then raise exception 'Only the organizer or owner can cancel this meeting.' using errcode = '42501'; end if;
  if m.cancelled_at is not null and m.revision = p_revision + 1 then return; end if;
  if m.revision is distinct from p_revision or m.cancelled_at is not null then raise exception 'This meeting changed. Close and refresh before cancelling.' using errcode = '40001'; end if;
  update public.project_meetings set cancelled_at = now(),updated_at = now(),revision = revision + 1 where id = m.id;
end;
$$;
revoke all on function public.cancel_project_meeting(uuid,uuid,integer) from public, anon;
grant execute on function public.cancel_project_meeting(uuid,uuid,integer) to authenticated;

create function public.get_project_meetings(p_project_id uuid,p_view text default 'upcoming',p_limit integer default 21,
  p_cursor_at timestamptz default null,p_cursor_id uuid default null,p_meeting_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.can_access_project(p_project_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
  if p_view is null or p_view not in ('upcoming','past','cancelled') or (p_cursor_at is null) <> (p_cursor_id is null) then raise exception 'Invalid meeting view' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(list) order by case when p_view = 'upcoming' then list.starts_at end asc,
    case when p_view <> 'upcoming' then list.starts_at end desc,list.id),'[]'::jsonb) into result
  from (
    select m.*,coalesce(nullif(btrim(p.name),''),'Former teammate') as organizer_name,
      (select coalesce(jsonb_agg(jsonb_build_object('user_id',a,'name',coalesce(nullif(btrim(ap.name),''),'Former teammate'),
        'is_member',exists(select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = a)) order by a),'[]'::jsonb)
        from unnest(m.attendee_ids) a left join public.profiles ap on ap.id = a) as attendees
    from public.project_meetings m left join public.profiles p on p.id = m.created_by
    where m.project_id = p_project_id and (
      (p_meeting_id is not null and m.id = p_meeting_id) or (p_meeting_id is null
        and (case p_view when 'cancelled' then m.cancelled_at is not null when 'past' then m.cancelled_at is null and m.ends_at < now() else m.cancelled_at is null and m.ends_at >= now() end)
        and (p_cursor_at is null or (p_view = 'upcoming' and (m.starts_at,m.id) > (p_cursor_at,p_cursor_id))
          or (p_view <> 'upcoming' and (m.starts_at < p_cursor_at or (m.starts_at = p_cursor_at and m.id > p_cursor_id))))))
    order by case when p_view = 'upcoming' then m.starts_at end asc,case when p_view <> 'upcoming' then m.starts_at end desc,m.id
    limit greatest(1,least(coalesce(p_limit,21),51))
  ) list;
  return result;
end;
$$;
revoke all on function public.get_project_meetings(uuid,text,integer,timestamptz,uuid,uuid) from public, anon;
grant execute on function public.get_project_meetings(uuid,text,integer,timestamptz,uuid,uuid) to authenticated;

create or replace function public.get_project_activity(
  p_project_id uuid, p_limit integer default 31, p_category text default null,
  p_actor_id uuid default null, p_from timestamptz default null, p_to timestamptz default null,
  p_before_at timestamptz default null, p_before_id uuid default null
) returns table(id uuid, actor_id uuid, actor_name text, event_type text, category text,
  entity_id uuid, metadata jsonb, created_at timestamptz, target_exists boolean, owner_only boolean)
language plpgsql stable security definer set search_path = '' as $$
declare is_owner boolean;
begin
  if not public.can_access_project(p_project_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
  select p.owner_id = auth.uid() into is_owner from public.projects p where p.id = p_project_id;
  if p_category is not null and p_category not in ('project','team','files','paper','chat','tasks','meetings') then raise exception 'Invalid activity category' using errcode = '22023'; end if;
  if (p_before_at is null) <> (p_before_id is null) or (p_from is not null and p_to is not null and p_from >= p_to) then raise exception 'Invalid activity range' using errcode = '22023'; end if;
  return query
    select e.id,e.actor_id,coalesce(nullif(btrim(a.name),''),case when e.actor_id is null then 'System' else 'Former teammate' end),
      e.event_type,case when e.entity_type = 'task' then 'tasks' when e.entity_type = 'invitation' then 'team' else e.entity_type end,
      e.entity_id,e.metadata,e.created_at,
      case e.entity_type
        when 'task' then exists(select 1 from public.project_tasks t where t.id = e.entity_id and t.project_id = p_project_id and t.deleted_at is null)
        when 'files' then exists(select 1 from public.project_files f where f.id = e.entity_id and f.project_id = p_project_id)
        when 'chat' then exists(select 1 from public.project_messages m where m.id = e.entity_id and m.project_id = p_project_id)
        when 'team' then exists(select 1 from public.project_members m where m.user_id = e.entity_id and m.project_id = p_project_id)
        when 'invitation' then exists(select 1 from public.project_invitations i where i.id = e.entity_id and i.project_id = p_project_id)
        when 'paper' then exists(select 1 from public.paper_workspaces w where w.project_id = p_project_id)
        when 'meetings' then exists(select 1 from public.project_meetings m where m.id = e.entity_id and m.project_id = p_project_id)
        when 'project' then true else false end,
      e.visibility = 'owner'
    from (
      select ev.* from public.activity_events ev
      where ev.project_id = p_project_id and (ev.visibility = 'project' or is_owner)
        and (p_category is null or (case when ev.entity_type = 'task' then 'tasks' when ev.entity_type = 'invitation' then 'team' else ev.entity_type end) = p_category)
        and (p_actor_id is null or ev.actor_id = p_actor_id)
        and (p_from is null or ev.created_at >= p_from) and (p_to is null or ev.created_at < p_to)
        and (p_before_at is null or (ev.created_at,ev.id) < (p_before_at,p_before_id))
      order by ev.created_at desc,ev.id desc limit greatest(1,least(coalesce(p_limit,31),101))
    ) e left join public.profiles a on a.id = e.actor_id
    order by e.created_at desc,e.id desc;
end;
$$;
revoke all on function public.get_project_activity(uuid,integer,text,uuid,timestamptz,timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.get_project_activity(uuid,integer,text,uuid,timestamptz,timestamptz,timestamptz,uuid) to authenticated;

