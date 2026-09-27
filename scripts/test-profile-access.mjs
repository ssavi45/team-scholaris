import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Local-only, rollback-only fixtures. No real accounts or stored files are changed.
const [owner, member, stranger, project, photo, draft] = Array.from({ length: 6 }, () => randomUUID())
const path = `${owner}/${photo}.webp`
const draftPath = `${owner}/${draft}.webp`
const claim = (id) => `select set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true);`
const query = `begin;
insert into auth.users(id,email,email_confirmed_at) values
('${owner}','profile-owner-${owner}@example.test',now()),
('${member}','profile-member-${member}@example.test',now()),
('${stranger}','profile-stranger-${stranger}@example.test',now());
insert into public.projects(id,owner_id,name) values ('${project}','${owner}','Profile access fixture');
insert into public.project_members(project_id,user_id,access_level) values
('${project}','${owner}','owner'),('${project}','${member}','member');
insert into storage.objects(bucket_id,name,owner_id,metadata) values
('profile-avatars','${path}','${owner}','{"mimetype":"image/webp","size":128}'),
('profile-avatars','${draftPath}','${owner}','{"mimetype":"image/webp","size":128}');
update public.profiles set avatar_path='${path}',avatar_preset=7 where id='${owner}';
set local role authenticated;
${claim(owner)}
do $$ declare p public.profiles; saved public.profiles; begin
  select * into p from public.profiles where id='${owner}';
  if p.username !~ '^profileowner[a-z0-9]*_[a-f0-9]{8}$' then raise exception 'Generated username invalid'; end if;
  saved := public.save_account_profile(p.updated_at,'Fixture Scholar',p.username,'email',7,p.avatar_path,'University','Research');
  if saved.badge_display <> 'email' or saved.name <> 'Fixture Scholar' then raise exception 'Profile save failed'; end if;
  begin
    perform public.save_account_profile('2000-01-01','Stale',p.username,'email',7,p.avatar_path,'','');
    raise exception 'Stale save accepted';
  exception when serialization_failure then null; end;
end $$;
${claim(member)}
do $$ begin
  if (select count(*) from public.get_project_avatars('${project}')) <> 2 then raise exception 'Team avatars missing'; end if;
  if not exists(select 1 from storage.objects where name='${path}') then raise exception 'Saved teammate photo inaccessible'; end if;
  if exists(select 1 from storage.objects where name='${draftPath}') then raise exception 'Draft photo leaked'; end if;
  if exists(select 1 from public.profiles where id='${owner}') then raise exception 'Private profile leaked'; end if;
end $$;
${claim(stranger)}
do $$ begin
  if exists(select 1 from storage.objects where name='${path}') then raise exception 'Photo leaked to stranger'; end if;
  begin
    perform public.get_project_avatars('${project}');
    raise exception 'Stranger read team avatars';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.project_members where project_id='${project}' and user_id='${member}';
set local role authenticated;
${claim(member)}
do $$ begin
  if public.can_read_teammate_avatar('${path}') then raise exception 'Removed member retains access'; end if;
end $$;
rollback;`
try {
  execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  })
  console.log('PASS: generated usernames, profile saves, stale-save rejection, teammate avatar access, private draft/profile isolation, stranger and removed-member denial. Fixtures rolled back.')
} catch (error) {
  console.error(String(error.stderr || error.message))
  process.exitCode = 1
}
