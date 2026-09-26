-- SETTINGS-01: owner management, retry receipts and recoverable Trash.
alter table public.projects add column settings_revision integer not null default 1 check (settings_revision > 0);
create index projects_trash_owner_time on public.projects(owner_id, deleted_at desc, id desc) where deleted_at is not null;

create function public.advance_project_settings_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.name, new.description, new.owner_id, new.status, new.deleted_at)
    is distinct from (old.name, old.description, old.owner_id, old.status, old.deleted_at) then
    new.settings_revision := old.settings_revision + 1;
    new.updated_at := now();
  else
    new.settings_revision := old.settings_revision;
  end if;
  return new;
end;
$$;
revoke all on function public.advance_project_settings_revision() from public, anon, authenticated;
create trigger project_settings_revision before update on public.projects
for each row execute function public.advance_project_settings_revision();

create function public.project_recovery_days() returns integer
language sql immutable set search_path = '' as $$ select 30; $$;
revoke all on function public.project_recovery_days() from public, anon;
grant execute on function public.project_recovery_days() to authenticated;

-- Receipts contain a request digest and minimal result, not research contents.
-- Never expose them directly: a successful transfer/delete can remove read access.
create table public.project_settings_operations (
  caller_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_hash bytea not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (caller_id, operation_id)
);
alter table public.project_settings_operations enable row level security;
revoke all on public.project_settings_operations from public, anon, authenticated;

create function public.get_project_settings(p_project_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'project', jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description,
      'owner_id', p.owner_id, 'status', p.status, 'created_at', p.created_at,
      'updated_at', p.updated_at, 'settings_revision', p.settings_revision),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id,
      'name', coalesce(nullif(btrim(pr.name), ''), 'Teammate'), 'access_level', m.access_level,
      'eligible_owner', m.access_level = 'member' and u.email_confirmed_at is not null)
      order by pr.name, m.user_id), '[]'::jsonb)
      from public.project_members m join public.profiles pr on pr.id = m.user_id
      join auth.users u on u.id = m.user_id where m.project_id = p.id),
    'has_google_meetings', exists(select 1 from public.project_meetings m
      where m.project_id = p.id and m.meeting_provider = 'google')
  ) from public.projects p where p.id = p_project_id and public.can_access_project(p.id);
$$;
revoke all on function public.get_project_settings(uuid) from public, anon;
grant execute on function public.get_project_settings(uuid) to authenticated;

create function public.list_deleted_owned_projects(
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 21
) returns table(id uuid, name text, deleted_at timestamptz, recover_until timestamptz,
  settings_revision integer, can_restore boolean, restore_blocked_reason text)
language plpgsql stable security definer set search_path = '' as $$
declare at_limit boolean;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  if (p_before_at is null) <> (p_before_id is null) then raise exception 'Invalid Trash cursor' using errcode = '22023'; end if;
  select count(*) >= public.max_owned_projects() into at_limit from public.projects p
    where p.owner_id = auth.uid() and p.deleted_at is null;
  return query select p.id, p.name, p.deleted_at,
    p.deleted_at + make_interval(days => public.project_recovery_days()), p.settings_revision,
    p.deleted_at + make_interval(days => public.project_recovery_days()) > now() and not at_limit,
    case when p.deleted_at + make_interval(days => public.project_recovery_days()) <= now() then 'expired'
      when at_limit then 'quota' else null end
    from public.projects p where p.owner_id = auth.uid() and p.deleted_at is not null
      and (p_before_at is null or (p.deleted_at, p.id) < (p_before_at, p_before_id))
    order by p.deleted_at desc, p.id desc limit greatest(1, least(coalesce(p_limit, 21), 51));
end;
$$;
revoke all on function public.list_deleted_owned_projects(timestamptz,uuid,integer) from public, anon;
grant execute on function public.list_deleted_owned_projects(timestamptz,uuid,integer) to authenticated;

-- Internal implementation is callable only through fixed-action wrappers below.
-- Lock order: operation -> quota user(s) in sorted lock-key order -> project.
-- Quota lock keys exactly match create_project(hashtextextended(user_id, 0)).
-- Team/content RPCs lock projects but never acquire quota locks afterward.
create function public.apply_project_settings_operation(
  p_project_id uuid, p_expected_revision integer, p_operation_id uuid, p_action text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); p public.projects; receipt public.project_settings_operations;
  fingerprint bytea; recipient uuid; lock_key bigint; result jsonb; requested_status text;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  if p_project_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision < 1
    or p_action is null or p_action not in ('details','archive','transfer','trash','restore') or p_payload is null then
    raise exception 'Invalid settings request' using errcode = '22023';
  end if;
  fingerprint := extensions.digest(jsonb_build_object('project', p_project_id, 'revision', p_expected_revision,
    'action', p_action, 'payload', p_payload)::text, 'sha256');
  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_operation_id::text, 1));
  select * into receipt from public.project_settings_operations
    where caller_id = caller and operation_id = p_operation_id;
  if found then
    if receipt.request_hash <> fingerprint then raise exception 'This operation ID belongs to a different request' using errcode = '22023'; end if;
    return receipt.result;
  end if;

  if p_action = 'transfer' then recipient := (p_payload->>'recipient_id')::uuid; end if;
  for lock_key in select distinct hashtextextended(u::text, 0) from unnest(array[caller, recipient]) u
    where u is not null order by 1 loop
    perform pg_advisory_xact_lock(lock_key);
  end loop;
  select * into p from public.projects where id = p_project_id for update;
  if not found or p.owner_id <> caller then raise exception 'Only the current project owner can do this' using errcode = '42501'; end if;
  if p.settings_revision <> p_expected_revision then
    raise exception 'Project settings changed. Your changes were not saved. Refresh and review before trying again.' using errcode = '40001';
  end if;
  if p_action <> 'restore' and p.deleted_at is not null then raise exception 'This project is in Trash' using errcode = '42501'; end if;

  case p_action
    when 'details' then
      if p.status <> 'active' then raise exception 'Unarchive this project before editing its details' using errcode = '42501'; end if;
      if p_payload->>'name' is null or char_length(btrim(p_payload->>'name')) not between 1 and 120
        or p_payload->>'description' is null or char_length(p_payload->>'description') > 5000 then
        raise exception 'Use a name of 1-120 characters and a description of at most 5,000 characters' using errcode = '22023';
      end if;
      if (p.name, p.description) is distinct from (btrim(p_payload->>'name'), btrim(p_payload->>'description')) then
        update public.projects set name = btrim(p_payload->>'name'), description = btrim(p_payload->>'description') where id = p.id;
      end if;
    when 'archive' then
      if p_payload->>'archived' is null then raise exception 'Choose an archive state' using errcode = '22023'; end if;
      requested_status := case when (p_payload->>'archived')::boolean then 'archived' else 'active' end;
      if p.status <> requested_status then update public.projects set status = requested_status where id = p.id; end if;
    when 'transfer' then
      if p.status <> 'active' then raise exception 'Unarchive this project before transferring ownership' using errcode = '42501'; end if;
      if recipient is null or recipient = caller or not exists (
        select 1 from public.project_members m join auth.users u on u.id = m.user_id
        where m.project_id = p.id and m.user_id = recipient and m.access_level = 'member' and u.email_confirmed_at is not null
      ) then raise exception 'Choose another verified current member. Viewers must first be promoted in Team.' using errcode = '22023'; end if;
      if (select count(*) from public.projects where owner_id = recipient and deleted_at is null) >= public.max_owned_projects() then
        raise exception 'The selected member has reached the owned-project limit' using errcode = 'P0001';
      end if;
      -- Demote first for the unique owner index; deferred constraints check the final state.
      update public.project_members set access_level = 'member' where project_id = p.id and user_id = caller;
      update public.project_members set access_level = 'owner' where project_id = p.id and user_id = recipient;
      update public.projects set owner_id = recipient where id = p.id;
      update public.project_invitations set revoked_at = now() where project_id = p.id and accepted_at is null and revoked_at is null;
    when 'trash' then
      update public.project_invitations set revoked_at = now() where project_id = p.id and accepted_at is null and revoked_at is null;
      update public.projects set deleted_at = now() where id = p.id;
    when 'restore' then
      if p.deleted_at is null then raise exception 'This project is not in Trash. Refresh your dashboard.' using errcode = '40001'; end if;
      if p.deleted_at + make_interval(days => public.project_recovery_days()) <= clock_timestamp() then
        raise exception 'The 30-day self-service recovery window has expired' using errcode = '22023';
      end if;
      if (select count(*) from public.projects where owner_id = caller and deleted_at is null) >= public.max_owned_projects() then
        raise exception 'Free an owned-project slot before restoring. Archived projects also count toward the limit.' using errcode = 'P0001';
      end if;
      update public.projects set deleted_at = null, status = 'archived' where id = p.id;
  end case;
  select jsonb_build_object('project_id', id, 'action', p_action, 'revision', settings_revision)
    into result from public.projects where id = p.id;
  insert into public.project_settings_operations(caller_id, operation_id, project_id, request_hash, result)
    values(caller, p_operation_id, p.id, fingerprint, result);
  return result;
end;
$$;
revoke all on function public.apply_project_settings_operation(uuid,integer,uuid,text,jsonb) from public, anon, authenticated;

create function public.update_project_details(p_project_id uuid, p_expected_revision integer, p_operation_id uuid, p_name text, p_description text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.apply_project_settings_operation(p_project_id, p_expected_revision, p_operation_id, 'details', jsonb_build_object('name', p_name, 'description', p_description));
$$;
create function public.set_project_archived(p_project_id uuid, p_expected_revision integer, p_operation_id uuid, p_archived boolean)
returns jsonb language sql security definer set search_path = '' as $$
  select public.apply_project_settings_operation(p_project_id, p_expected_revision, p_operation_id, 'archive', jsonb_build_object('archived', p_archived));
$$;
create function public.transfer_project_ownership(p_project_id uuid, p_expected_revision integer, p_operation_id uuid, p_recipient_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.apply_project_settings_operation(p_project_id, p_expected_revision, p_operation_id, 'transfer', jsonb_build_object('recipient_id', p_recipient_id));
$$;
create function public.trash_project(p_project_id uuid, p_expected_revision integer, p_operation_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.apply_project_settings_operation(p_project_id, p_expected_revision, p_operation_id, 'trash', '{}'::jsonb);
$$;
create function public.restore_project(p_project_id uuid, p_expected_revision integer, p_operation_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.apply_project_settings_operation(p_project_id, p_expected_revision, p_operation_id, 'restore', '{}'::jsonb);
$$;
revoke all on function public.update_project_details(uuid,integer,uuid,text,text),
  public.set_project_archived(uuid,integer,uuid,boolean), public.transfer_project_ownership(uuid,integer,uuid,uuid),
  public.trash_project(uuid,integer,uuid), public.restore_project(uuid,integer,uuid) from public, anon;
grant execute on function public.update_project_details(uuid,integer,uuid,text,text),
  public.set_project_archived(uuid,integer,uuid,boolean), public.transfer_project_ownership(uuid,integer,uuid,uuid),
  public.trash_project(uuid,integer,uuid), public.restore_project(uuid,integer,uuid) to authenticated;

-- Ordinary reads remain unchanged: Trash metadata has its own narrow owner RPC.
-- No client writes to projects/members, no deletion of research or storage data,
-- no external Google requests, and no duplicate client-written Activity events.
