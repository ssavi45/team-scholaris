create table public.project_tasks (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 5000),
  created_by uuid not null references public.profiles(id),
  assignee_id uuid references public.profiles(id),
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  due_date date check (due_date between date '1900-01-01' and date '9999-12-31'),
  completed_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status = 'done') = (completed_at is not null))
);
create index project_tasks_list_idx on public.project_tasks(project_id, created_at desc, id) where deleted_at is null;
create index project_tasks_assignee_idx on public.project_tasks(project_id, assignee_id) where deleted_at is null;
alter table public.project_tasks enable row level security;
revoke all on public.project_tasks from anon, authenticated;
grant select on public.project_tasks to authenticated;
create policy tasks_read on public.project_tasks for select to authenticated
using (deleted_at is null and public.can_access_project(project_id));

-- Durable, minimal events for the later Activity build. No client event writes.
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_events_project_time_idx on public.activity_events(project_id, created_at desc, id);
alter table public.activity_events enable row level security;
revoke all on public.activity_events from anon, authenticated;
grant select on public.activity_events to authenticated;
create policy activity_read on public.activity_events for select to authenticated using (public.can_access_project(project_id));

create function public.record_task_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare event text;
begin
  if TG_OP = 'INSERT' then event := 'task.created';
  elsif new.deleted_at is not null and old.deleted_at is null then event := 'task.deleted';
  elsif new.assignee_id is null and old.assignee_id is not null then event := 'task.unassigned';
  elsif new.status <> old.status then event := 'task.status_changed';
  else event := 'task.updated'; end if;
  insert into public.activity_events(project_id,actor_id,event_type,entity_type,entity_id,metadata)
  values(new.project_id,auth.uid(),event,'task',new.id,jsonb_build_object('title',new.title,'status',new.status));
  return new;
end;
$$;
revoke all on function public.record_task_event() from public, anon, authenticated;
create trigger tasks_history after insert or update on public.project_tasks for each row execute function public.record_task_event();

create function public.save_project_task(
  p_project_id uuid, p_task_id uuid, p_revision integer, p_title text,
  p_description text, p_assignee_id uuid, p_status text, p_priority text, p_due_date date
) returns public.project_tasks language plpgsql security definer set search_path = '' as $$
declare p public.projects; t public.project_tasks; access text; changed public.project_tasks;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  select * into p from public.projects where id = p_project_id for update;
  select access_level into access from public.project_members where project_id = p_project_id and user_id = auth.uid();
  if p.id is null or p.deleted_at is not null or p.status <> 'active' or access is null or access not in ('owner','member') then
    raise exception 'This project is read-only or unavailable' using errcode = '42501';
  end if;
  if p_task_id is null or p_revision is null or p_revision < 0 or p_title is null or char_length(btrim(p_title)) not between 1 and 160
    or p_description is null or char_length(p_description) > 5000 or p_status is null or p_status not in ('todo','in_progress','blocked','done')
    or p_priority is null or p_priority not in ('low','normal','high') or (p_due_date is not null and p_due_date not between date '1900-01-01' and date '9999-12-31') then
    raise exception 'Check the task title, description, status, priority, and due date' using errcode = '22023';
  end if;
  select * into t from public.project_tasks where id = p_task_id and project_id = p_project_id;
  if p_revision = 0 and t.id is not null then
    -- Retry after a lost response is safe only for the identical initial creation.
    if t.created_by = auth.uid() and t.revision = 1 and t.deleted_at is null and t.title = btrim(p_title)
      and t.description = p_description and t.assignee_id is not distinct from p_assignee_id and t.status = p_status
      and t.priority = p_priority and t.due_date is not distinct from p_due_date then return t; end if;
    raise exception 'This task was already created. Close this form and refresh the list.' using errcode = '40001';
  end if;
  if p_revision > 0 then
    if t.id is null or t.deleted_at is not null or t.revision <> p_revision then
      raise exception 'This task changed or was removed. Copy your edits, close the form, and refresh before trying again.' using errcode = '40001';
    end if;
    if access <> 'owner' and t.created_by <> auth.uid() then
      if t.assignee_id is distinct from auth.uid() then raise exception 'Only the owner or task creator can edit this task' using errcode = '42501'; end if;
      if t.title is distinct from btrim(p_title) or t.description is distinct from p_description or t.assignee_id is distinct from p_assignee_id
        or t.priority is distinct from p_priority or t.due_date is distinct from p_due_date then
        raise exception 'Assignees can change task status only' using errcode = '42501';
      end if;
    end if;
  end if;
  if p_assignee_id is not null and not exists (select 1 from public.project_members where project_id = p_project_id and user_id = p_assignee_id and access_level in ('owner','member')) then
    -- Completed tasks keep their original assignee after departure/demotion.
    if not (p_revision > 0 and t.status = 'done' and p_status = 'done' and t.assignee_id is not distinct from p_assignee_id) then
      raise exception 'Choose a current owner or member, or leave the task unassigned' using errcode = '22023';
    end if;
  end if;
  if p_revision = 0 then
    insert into public.project_tasks(id,project_id,title,description,created_by,assignee_id,status,priority,due_date,completed_at)
    values(p_task_id,p_project_id,btrim(p_title),p_description,auth.uid(),p_assignee_id,p_status,p_priority,p_due_date,case when p_status = 'done' then now() end)
    returning * into changed;
  else
    if t.title = btrim(p_title) and t.description = p_description and t.assignee_id is not distinct from p_assignee_id
      and t.status = p_status and t.priority = p_priority and t.due_date is not distinct from p_due_date then return t; end if;
    update public.project_tasks set title = btrim(p_title), description = p_description, assignee_id = p_assignee_id,
      status = p_status, priority = p_priority, due_date = p_due_date,
      completed_at = case when p_status = 'done' then coalesce(t.completed_at,now()) end,
      revision = revision + 1, updated_at = now() where id = t.id returning * into changed;
  end if;
  return changed;
end;
$$;
revoke all on function public.save_project_task(uuid,uuid,integer,text,text,uuid,text,text,date) from public, anon;
grant execute on function public.save_project_task(uuid,uuid,integer,text,text,uuid,text,text,date) to authenticated;

create function public.delete_project_task(p_project_id uuid, p_task_id uuid, p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.projects; t public.project_tasks; access text;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  select * into p from public.projects where id = p_project_id for update;
  select access_level into access from public.project_members where project_id = p_project_id and user_id = auth.uid();
  if p.id is null or p.deleted_at is not null or p.status <> 'active' or access is null or access not in ('owner','member') then
    raise exception 'This project is read-only or unavailable' using errcode = '42501';
  end if;
  select * into t from public.project_tasks where id = p_task_id and project_id = p_project_id;
  if t.id is null or t.deleted_at is not null or t.revision is distinct from p_revision then
    raise exception 'This task changed or was removed. Refresh before deleting.' using errcode = '40001';
  end if;
  if access <> 'owner' and t.created_by <> auth.uid() then raise exception 'Only the owner or task creator can delete this task' using errcode = '42501'; end if;
  update public.project_tasks set deleted_at = now(), updated_at = now(), revision = revision + 1 where id = t.id;
end;
$$;
revoke all on function public.delete_project_task(uuid,uuid,integer) from public, anon;
grant execute on function public.delete_project_task(uuid,uuid,integer) to authenticated;

create function public.get_project_tasks(p_project_id uuid)
returns table(id uuid,project_id uuid,title text,description text,created_by uuid,creator_name text,assignee_id uuid,assignee_name text,status text,priority text,due_date date,completed_at timestamptz,revision integer,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_project(p_project_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
  return query select t.id,t.project_id,t.title,t.description,t.created_by,c.name,t.assignee_id,a.name,t.status,t.priority,t.due_date,t.completed_at,t.revision,t.created_at,t.updated_at
    from public.project_tasks t join public.profiles c on c.id = t.created_by left join public.profiles a on a.id = t.assignee_id
    where t.project_id = p_project_id and t.deleted_at is null;
end;
$$;
revoke all on function public.get_project_tasks(uuid) from public, anon;
grant execute on function public.get_project_tasks(uuid) to authenticated;

create function public.get_project_task_summary(p_project_id uuid, p_today date)
returns table(open_count bigint,overdue_count bigint,mine_count bigint,done_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_project(p_project_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
  return query select count(*) filter(where status <> 'done'), count(*) filter(where status <> 'done' and due_date < p_today),
    count(*) filter(where status <> 'done' and assignee_id = auth.uid()),count(*) filter(where status = 'done')
    from public.project_tasks where project_id = p_project_id and deleted_at is null;
end;
$$;
revoke all on function public.get_project_task_summary(uuid,date) from public, anon;
grant execute on function public.get_project_task_summary(uuid,date) to authenticated;

create function public.unassign_departing_member_tasks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects where id = old.project_id) then return null; end if;
  if TG_OP = 'DELETE' or (old.access_level in ('owner','member') and new.access_level = 'viewer') then
    update public.project_tasks set assignee_id = null, updated_at = now(), revision = revision + 1
      where project_id = old.project_id and assignee_id = old.user_id and status <> 'done' and deleted_at is null;
  end if;
  return null;
end;
$$;
revoke all on function public.unassign_departing_member_tasks() from public, anon, authenticated;
create trigger membership_task_cleanup after delete or update of access_level on public.project_members
for each row execute function public.unassign_departing_member_tasks();
