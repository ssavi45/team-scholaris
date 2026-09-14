create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254),
  access_level text not null check (access_level in ('member', 'viewer')),
  token_hash bytea not null unique,
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_pending_email on public.project_invitations(project_id, email)
where accepted_at is null and revoked_at is null;
create index invitations_email_idx on public.project_invitations(email);
alter table public.project_invitations enable row level security;
-- All access is through narrow functions; token hashes are never exposed to clients.
revoke all on public.project_invitations from anon, authenticated;

create function public.verified_caller_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = (select auth.uid()) and email_confirmed_at is not null;
$$;
revoke all on function public.verified_caller_email() from public, anon;
grant execute on function public.verified_caller_email() to authenticated;

create function public.invite_expiry_days() returns integer
language sql immutable set search_path = '' as $$ select 7; $$;
revoke all on function public.invite_expiry_days() from public, anon;
grant execute on function public.invite_expiry_days() to authenticated;

create function public.create_project_invitation(p_project_id uuid, p_email text, p_access_level text)
returns table(invitation_id uuid, invitation_token text, recipient_email text, project_name text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare p public.projects; normalized text := lower(btrim(p_email)); raw_token text; invitation public.project_invitations;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  select * into p from public.projects where id = p_project_id for update;
  if not found or p.owner_id <> auth.uid() or p.status <> 'active' or p.deleted_at is not null then
    raise exception 'Only the owner of an active project may invite people' using errcode = '42501';
  end if;
  if normalized is null or char_length(normalized) > 254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_access_level is null or p_access_level not in ('member', 'viewer') then
    raise exception 'Provide a valid email and member or viewer access' using errcode = '22023';
  end if;
  if exists (select 1 from public.project_members m join auth.users u on u.id = m.user_id
    where m.project_id = p.id and lower(u.email) = normalized) then
    raise exception 'This person is already on the team' using errcode = '22023';
  end if;
  if exists (select 1 from public.project_invitations i where i.project_id = p.id and i.email = normalized and i.created_at > now() - interval '60 seconds') then
    raise exception 'Wait one minute before inviting this email again' using errcode = 'P0001';
  end if;
  if (select count(*) from public.project_invitations i where i.project_id = p.id and i.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Project invitation limit reached. Try again later.' using errcode = 'P0001';
  end if;
  update public.project_invitations set revoked_at = now() where project_id = p.id and email = normalized and accepted_at is null and revoked_at is null;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.project_invitations(project_id,email,access_level,token_hash,invited_by,expires_at)
  values (p.id,normalized,p_access_level,extensions.digest(raw_token, 'sha256'),auth.uid(), now() + make_interval(days => public.invite_expiry_days())) returning * into invitation;
  return query select invitation.id, raw_token, normalized, p.name, invitation.expires_at;
end;
$$;
revoke all on function public.create_project_invitation(uuid,text,text) from public, anon;
grant execute on function public.create_project_invitation(uuid,text,text) to authenticated;

create function public.list_project_invitations(p_project_id uuid default null, p_token text default null)
returns table(id uuid, project_id uuid, project_name text, email text, access_level text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare caller_email text := public.verified_caller_email();
begin
  if caller_email is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid() and p.deleted_at is null) then
    raise exception 'Project unavailable' using errcode = '42501';
  end if;
  return query select i.id,i.project_id,p.name,i.email,i.access_level,i.expires_at,i.accepted_at,i.revoked_at
  from public.project_invitations i join public.projects p on p.id = i.project_id
  where p.deleted_at is null and (
    (p_project_id is not null and i.project_id = p_project_id)
    or (p_project_id is null and i.email = caller_email and p.status = 'active' and p.owner_id = i.invited_by
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
  ) and (p_token is null or i.token_hash = extensions.digest(p_token, 'sha256'))
  order by i.created_at desc limit 100;
end;
$$;
revoke all on function public.list_project_invitations(uuid,text) from public, anon;
grant execute on function public.list_project_invitations(uuid,text) to authenticated;

create function public.accept_project_invitation(p_invitation_id uuid default null, p_token text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller_email text := public.verified_caller_email(); i public.project_invitations; p public.projects; target uuid;
begin
  if caller_email is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  if p_token is not null then
    select project_id into target from public.project_invitations where token_hash = extensions.digest(p_token, 'sha256');
  else select project_id into target from public.project_invitations where id = p_invitation_id;
  end if;
  -- Match lock order with invitation creation; serialize acceptance/archiving/ownership changes.
  select * into p from public.projects where id = target for update;
  if not found or p.status <> 'active' or p.deleted_at is not null then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  select * into i from public.project_invitations where project_id = p.id and
    ((p_token is not null and token_hash = extensions.digest(p_token, 'sha256')) or (p_token is null and id = p_invitation_id)) for update;
  if not found or i.email <> caller_email or i.invited_by <> p.owner_id or i.revoked_at is not null then
    raise exception 'Invitation unavailable for this account' using errcode = '42501';
  end if;
  if i.accepted_at is not null then
    if i.accepted_by = auth.uid() and exists (select 1 from public.project_members where project_id = p.id and user_id = auth.uid()) then return p.id; end if;
    raise exception 'Invitation already used' using errcode = '42501';
  end if;
  if i.expires_at <= now() then raise exception 'Invitation expired' using errcode = '42501'; end if;
  insert into public.project_members(project_id,user_id,access_level) values (p.id,auth.uid(),i.access_level)
  on conflict (project_id,user_id) do nothing;
  update public.project_invitations set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  update public.projects set updated_at = now() where id = p.id;
  return p.id;
end;
$$;
revoke all on function public.accept_project_invitation(uuid,text) from public, anon;
grant execute on function public.accept_project_invitation(uuid,text) to authenticated;

create function public.revoke_project_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid; p public.projects;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  select project_id into target from public.project_invitations where id = p_invitation_id;
  select * into p from public.projects where id = target for update;
  if not found or p.owner_id <> auth.uid() or p.status <> 'active' or p.deleted_at is not null then raise exception 'Project unavailable' using errcode = '42501'; end if;
  update public.project_invitations set revoked_at = now() where id = p_invitation_id and accepted_at is null;
end;
$$;
revoke all on function public.revoke_project_invitation(uuid) from public, anon;
grant execute on function public.revoke_project_invitation(uuid) to authenticated;

create function public.get_project_team(p_project_id uuid)
returns table(user_id uuid,name text,access_level text,display_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_project(p_project_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
  return query select m.user_id,p.name,m.access_level,m.display_role
  from public.project_members m join public.profiles p on p.id = m.user_id where m.project_id = p_project_id order by m.joined_at;
end;
$$;
revoke all on function public.get_project_team(uuid) from public, anon;
grant execute on function public.get_project_team(uuid) to authenticated;
