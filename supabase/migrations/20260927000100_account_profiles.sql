-- Account preferences are independent of project permissions and memberships.
alter table public.profiles
  add column username text,
  add column badge_display text not null default 'username' check (badge_display in ('username', 'email')),
  add column avatar_preset integer not null default 1 check (avatar_preset between 1 and 10),
  add column avatar_path text,
  add column affiliation text not null default '' check (char_length(affiliation) <= 120),
  add column bio text not null default '' check (char_length(bio) <= 300);

create function public.assign_profile_username() returns trigger
language plpgsql security definer set search_path = '' as $$
declare stem text; candidate text;
begin
  if new.username is not null then return new; end if;
  select left(regexp_replace(lower(split_part(coalesce(u.email, ''), '@', 1)), '[^a-z0-9]', '', 'g'), 16)
    into stem from auth.users u where u.id = new.id;
  stem := coalesce(nullif(stem, ''), 'scholar');
  loop
    candidate := stem || '_' || left(replace(gen_random_uuid()::text, '-', ''), 8);
    perform pg_advisory_xact_lock(hashtextextended('profile-username:' || candidate, 0));
    exit when not exists (select 1 from public.profiles where username = candidate);
  end loop;
  new.username := candidate;
  return new;
end;
$$;
revoke all on function public.assign_profile_username() from public, anon, authenticated;
create trigger assign_profile_username before insert or update on public.profiles
  for each row execute function public.assign_profile_username();
update public.profiles set username = null where username is null;
alter table public.profiles alter column username set not null;
alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9_]{2,29}$');
alter table public.profiles add constraint profiles_username_unique unique (username);
alter table public.profiles add constraint profiles_avatar_path_owner check (
  avatar_path is null or avatar_path ~ ('^' || id::text || '/[0-9a-f-]{36}\.webp$')
);

-- No browser can modify managed fields directly or set arbitrary avatar URLs.
revoke update (name, avatar_url) on public.profiles from authenticated;
revoke update on public.profiles from authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 1048576, array['image/webp']);

create function public.can_upload_profile_avatar(p_name text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.verified_caller_email() is null
    or p_name !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.webp$') then return false; end if;
  -- Serialize uploads per user. At most four immutable images (including drafts).
  perform 1 from public.profiles where id = auth.uid() for update;
  return (select count(*) < 4 from storage.objects
    where bucket_id = 'profile-avatars' and split_part(name, '/', 1) = auth.uid()::text);
end;
$$;
revoke all on function public.can_upload_profile_avatar(text) from public, anon;
grant execute on function public.can_upload_profile_avatar(text) to authenticated;

create policy profile_avatar_read on storage.objects for select to authenticated
using (bucket_id = 'profile-avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy profile_avatar_insert on storage.objects for insert to authenticated
with check (bucket_id = 'profile-avatars' and public.can_upload_profile_avatar(name));
-- Objects are immutable. Referenced images cannot be removed.
create policy profile_avatar_delete on storage.objects for delete to authenticated
using (bucket_id = 'profile-avatars' and split_part(name, '/', 1) = auth.uid()::text
  and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.avatar_path = name));

create function public.save_account_profile(
  p_expected_updated_at timestamptz, p_name text, p_username text,
  p_badge_display text, p_avatar_preset integer, p_avatar_path text,
  p_affiliation text, p_bio text
) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare profile public.profiles; stored storage.objects; normalized text := lower(btrim(p_username));
begin
  if public.verified_caller_email() is null then
    raise exception 'Verified sign-in required' using errcode = '42501';
  end if;
  if normalized is null or normalized !~ '^[a-z0-9][a-z0-9_]{2,29}$'
    or p_name is null or char_length(btrim(p_name)) not between 1 and 120
    or p_badge_display is null or p_badge_display not in ('username', 'email')
    or p_avatar_preset is null or p_avatar_preset not between 1 and 10
    or p_affiliation is null or char_length(p_affiliation) > 120
    or p_bio is null or char_length(p_bio) > 300 then
    raise exception 'Check the profile fields and try again' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('profile-username:' || normalized, 0));
  select * into profile from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile unavailable' using errcode = '42501'; end if;
  -- Retrying an acknowledged or lost-response save is a no-op if fields match.
  if (profile.name, profile.username, profile.badge_display, profile.avatar_preset,
      profile.avatar_path, profile.affiliation, profile.bio) is not distinct from
     (btrim(p_name), normalized, p_badge_display, p_avatar_preset, p_avatar_path, btrim(p_affiliation), btrim(p_bio)) then
    return profile;
  end if;
  if profile.updated_at is distinct from p_expected_updated_at then
    raise exception 'Your profile changed in another tab. Reload the saved profile before saving again.' using errcode = '40001';
  end if;
  if exists (select 1 from public.profiles where username = normalized and id <> auth.uid()) then
    raise exception 'That username is already taken. Try another.' using errcode = '23505';
  end if;
  if p_avatar_path is not null then
    if p_avatar_path !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.webp$') then
      raise exception 'Invalid profile image' using errcode = '22023';
    end if;
    select * into stored from storage.objects where bucket_id = 'profile-avatars' and name = p_avatar_path for key share;
    if not found or stored.owner_id is distinct from auth.uid()::text
      or stored.metadata->>'mimetype' is distinct from 'image/webp'
      or coalesce((stored.metadata->>'size')::bigint, 0) not between 1 and 1048576 then
      raise exception 'Upload a valid profile image before saving' using errcode = '22023';
    end if;
  end if;
  update public.profiles set name = btrim(p_name), username = normalized,
    badge_display = p_badge_display, avatar_preset = p_avatar_preset, avatar_path = p_avatar_path,
    affiliation = btrim(p_affiliation), bio = btrim(p_bio)
  where id = auth.uid() returning * into profile;
  return profile;
end;
$$;
revoke all on function public.save_account_profile(timestamptz,text,text,text,integer,text,text,text) from public, anon;
grant execute on function public.save_account_profile(timestamptz,text,text,text,integer,text,text,text) to authenticated;
