create or replace function public.read_paper_state(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id=p_project for update;
  if not public.can_access_project(p_project) or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'Paper unavailable.' using errcode='42501';
  end if;
  return jsonb_build_object('settings',(select jsonb_build_object('revision',revision,'main_file',main_file) from public.paper_workspaces where project_id=p_project),
    'files',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('shared_epoch',d.epoch) order by f.path) from public.paper_files f left join public.paper_shared_documents d on d.file_id=f.id where f.project_id=p_project),'[]'));
end $$;

-- Serialize a person's cross-project connection budget as well as each room.
-- Project -> actor advisory lock; no operation takes these in reverse order.
create or replace function public.paper_shared_presence(p_actor uuid,p_file uuid,p_peer uuid,p_epoch uuid,p_cursor jsonb default null,p_leave boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare project uuid;
begin
  select project_id into project from public.paper_files where id=p_file;
  perform 1 from public.projects where id=project for update;
  if not exists(select 1 from public.projects p join public.project_members m on m.project_id=p.id join auth.users u on u.id=m.user_id
    where p.id=project and p.deleted_at is null and m.user_id=p_actor and u.email_confirmed_at is not null) then
    raise exception 'Paper unavailable.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('paper-presence:'||p_actor::text,0));
  delete from public.paper_shared_presence where expires_at<=clock_timestamp();
  if p_leave then delete from public.paper_shared_presence where peer_id=p_peer and actor_id=p_actor; return '[]'; end if;
  if not exists(select 1 from public.paper_shared_documents where file_id=p_file and epoch=p_epoch) then
    raise exception 'Session changed.' using errcode='PT409';
  end if;
  if p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048) then
    raise exception 'Invalid cursor.' using errcode='22023';
  end if;
  if exists(select 1 from public.paper_shared_presence where peer_id=p_peer and (actor_id<>p_actor or file_id<>p_file or epoch<>p_epoch)) then
    raise exception 'Presence identity changed.' using errcode='42501';
  end if;
  if not exists(select 1 from public.paper_shared_presence where peer_id=p_peer) and
    ((select count(*) from public.paper_shared_presence where actor_id=p_actor)>=10 or
     (select count(*) from public.paper_shared_presence where file_id=p_file)>=50) then
    raise exception 'Too many connected sessions.' using errcode='54000';
  end if;
  insert into public.paper_shared_presence values(p_peer,p_actor,p_file,p_epoch,p_cursor,clock_timestamp()+interval '10 seconds')
    on conflict(peer_id) do update set cursor=excluded.cursor,expires_at=excluded.expires_at;
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.peer_id,'userId',r.actor_id,'name',left(coalesce(nullif(pr.name,''),'Coauthor'),80),
    'color',(array['#b45309','#2563eb','#9333ea','#c2410c','#0f766e'])[1+((('x'||substr(r.actor_id::text,1,8))::bit(32)::bigint)%5)::integer],
    'cursor',r.cursor) order by r.actor_id,r.peer_id)
    from public.paper_shared_presence r join public.project_members m on m.user_id=r.actor_id and m.project_id=project
    join auth.users u on u.id=r.actor_id and u.email_confirmed_at is not null
    join public.profiles pr on pr.id=r.actor_id where r.file_id=p_file and r.epoch=p_epoch and r.expires_at>clock_timestamp()),'[]');
end $$;
