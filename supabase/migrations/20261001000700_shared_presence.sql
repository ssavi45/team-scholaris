-- Ephemeral presence and per-actor budgets shared by every pilot gateway.
create table public.paper_shared_presence (
  peer_id uuid primary key, actor_id uuid not null references auth.users(id) on delete cascade,
  file_id uuid not null references public.paper_files(id) on delete cascade, epoch uuid not null,
  cursor jsonb, expires_at timestamptz not null
);
create index paper_presence_file on public.paper_shared_presence(file_id,expires_at);
create table public.paper_shared_rates (
  actor_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check(bucket in ('operation','cursor')), minute bigint not null, count integer not null,
  primary key(actor_id,bucket)
);
alter table public.paper_shared_presence enable row level security;
alter table public.paper_shared_rates enable row level security;
revoke all on public.paper_shared_presence,public.paper_shared_rates from public,anon,authenticated,service_role;

create function public.paper_shared_presence(p_actor uuid,p_file uuid,p_peer uuid,p_epoch uuid,p_cursor jsonb default null,p_leave boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare project uuid;
begin
  select project_id into project from public.paper_files where id=p_file;
  perform 1 from public.projects where id=project for update;
  if not exists(select 1 from public.projects p join public.project_members m on m.project_id=p.id join auth.users u on u.id=m.user_id
    where p.id=project and p.deleted_at is null and m.user_id=p_actor and u.email_confirmed_at is not null) then
    raise exception 'Paper unavailable.' using errcode='42501';
  end if;
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

create function public.paper_shared_rate(p_actor uuid,p_bucket text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare slot bigint := floor(extract(epoch from clock_timestamp())/60); hits integer;
begin
  if p_bucket not in ('operation','cursor') then raise exception 'Invalid budget.' using errcode='22023'; end if;
  -- Serialize one actor's counts across independent gateway processes.
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null for update;
  if not found then raise exception 'Account unavailable.' using errcode='42501'; end if;
  delete from public.paper_shared_rates where minute<slot-1;
  insert into public.paper_shared_rates values(p_actor,p_bucket,slot,1)
    on conflict(actor_id,bucket) do update set minute=excluded.minute,
      count=case when public.paper_shared_rates.minute=excluded.minute then public.paper_shared_rates.count+1 else 1 end
    returning count into hits;
  return hits<=case when p_bucket='cursor' then 300 else 120 end;
end $$;
revoke all on function public.paper_shared_presence(uuid,uuid,uuid,uuid,jsonb,boolean),public.paper_shared_rate(uuid,text) from public,anon,authenticated;
grant execute on function public.paper_shared_presence(uuid,uuid,uuid,uuid,jsonb,boolean),public.paper_shared_rate(uuid,text) to service_role;
