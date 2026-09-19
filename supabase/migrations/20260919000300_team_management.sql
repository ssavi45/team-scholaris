-- Membership writes stay behind verified, narrowly scoped RPCs. Lock the project
-- first, matching invitation acceptance, so team changes cannot race an invite.
create function public.update_project_member(
  p_project_id uuid, p_user_id uuid, p_access_level text, p_display_role text,
  p_expected_access_level text, p_expected_display_role text
) returns void language plpgsql security definer set search_path = '' as $$
declare p public.projects; m public.project_members;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  select * into p from public.projects where id = p_project_id for update;
  if not found or p.owner_id <> auth.uid() or p.status <> 'active' or p.deleted_at is not null then
    raise exception 'Only the owner of an active project can manage the team' using errcode = '42501';
  end if;
  select * into m from public.project_members where project_id = p.id and user_id = p_user_id;
  if not found then raise exception 'This person is no longer on the team. Refresh and try again.' using errcode = '40001'; end if;
  if m.access_level is distinct from p_expected_access_level or m.display_role is distinct from p_expected_display_role then
    raise exception 'This membership changed. Refresh the team before editing again.' using errcode = '40001';
  end if;
  if p_access_level is null or
    (m.user_id = p.owner_id and p_access_level <> 'owner') or
    (m.user_id <> p.owner_id and p_access_level not in ('member', 'viewer')) then
    raise exception 'Owner access cannot be assigned or changed here' using errcode = '22023';
  end if;
  if char_length(btrim(p_display_role)) > 120 then
    raise exception 'Research roles must be 120 characters or fewer' using errcode = '22023';
  end if;
  update public.project_members set access_level = p_access_level, display_role = nullif(btrim(p_display_role), '') where id = m.id;
  update public.projects set updated_at = now() where id = p.id;
end;
$$;
revoke all on function public.update_project_member(uuid,uuid,text,text,text,text) from public, anon;
grant execute on function public.update_project_member(uuid,uuid,text,text,text,text) to authenticated;

create function public.remove_project_member(p_project_id uuid, p_user_id uuid, p_expected_access_level text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.projects; m public.project_members;
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  select * into p from public.projects where id = p_project_id for update;
  if not found or p.owner_id <> auth.uid() or p.status <> 'active' or p.deleted_at is not null then
    raise exception 'Only the owner of an active project can manage the team' using errcode = '42501';
  end if;
  if p_user_id = p.owner_id then raise exception 'The project owner cannot be removed' using errcode = '22023'; end if;
  select * into m from public.project_members where project_id = p.id and user_id = p_user_id;
  if not found or m.access_level is distinct from p_expected_access_level then
    raise exception 'This membership changed. Refresh the team before removing anyone.' using errcode = '40001';
  end if;
  -- Preserve messages, papers, files, profiles, and their author attribution.
  delete from public.project_members where id = m.id;
  update public.project_invitations set revoked_at = now()
    where project_id = p.id and accepted_at is null and revoked_at is null
      and email = (select lower(email) from auth.users where id = p_user_id);
  update public.projects set updated_at = now() where id = p.id;
end;
$$;
revoke all on function public.remove_project_member(uuid,uuid,text) from public, anon;
grant execute on function public.remove_project_member(uuid,uuid,text) to authenticated;

create function public.leave_project(p_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.verified_caller_email() is null then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  perform 1 from public.projects where id = p_project_id and deleted_at is null for update;
  if not found or not public.can_access_project(p_project_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
  if exists (select 1 from public.projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'The project owner cannot leave' using errcode = '22023';
  end if;
  -- Members may leave archived projects too; leaving does not edit project content.
  delete from public.project_members where project_id = p_project_id and user_id = auth.uid();
  update public.project_invitations set revoked_at = now()
    where project_id = p_project_id and email = public.verified_caller_email() and accepted_at is null and revoked_at is null;
  update public.projects set updated_at = now() where id = p_project_id;
end;
$$;
revoke all on function public.leave_project(uuid) from public, anon;
grant execute on function public.leave_project(uuid) to authenticated;
