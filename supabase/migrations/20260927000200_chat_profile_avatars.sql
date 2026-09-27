-- Share only avatar presentation with current teammates, never private profile fields.
create function public.get_project_avatars(p_project_id uuid)
returns table(user_id uuid, avatar_preset integer, avatar_path text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_project(p_project_id) then
    raise exception 'Project unavailable' using errcode = '42501';
  end if;
  return query select p.id, p.avatar_preset, p.avatar_path
    from public.profiles p join public.project_members m on m.user_id = p.id
    where m.project_id = p_project_id;
end;
$$;
revoke all on function public.get_project_avatars(uuid) from public, anon;
grant execute on function public.get_project_avatars(uuid) to authenticated;

create function public.can_read_teammate_avatar(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.project_members teammate on teammate.user_id = p.id
    join public.project_members caller on caller.project_id = teammate.project_id
    join public.projects project on project.id = caller.project_id
    where p.avatar_path = p_path and caller.user_id = auth.uid()
      and project.deleted_at is null
  );
$$;
revoke all on function public.can_read_teammate_avatar(text) from public, anon;
grant execute on function public.can_read_teammate_avatar(text) to authenticated;

create policy profile_avatar_teammate_read on storage.objects for select to authenticated
using (bucket_id = 'profile-avatars' and public.can_read_teammate_avatar(name));
